import { officialDomainOf, withWebSearch, withWebExtract } from "./web-research.mjs";

const EXCLUDED_HOSTS = /(?:^|\.)(?:youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|x\.com)$/i;
const words = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function creatorOfficialDomain(profile) {
  const nameKey = words(profile?.name).replace(/\s+/g, "");
  if (nameKey.length < 5) return null;
  for (const match of String(profile?.summary ?? "").matchAll(/https:\/\/[^\s<>"']+/g)) {
    const domain = officialDomainOf(match[0].replace(/[.,;)]+$/, ""));
    if (domain && !EXCLUDED_HOSTS.test(domain) &&
        domain.split(".")[0].replace(/[^a-z0-9]/g, "").includes(nameKey)) return domain;
  }
  return null;
}

export function creatorCommercialQuestion(profile, metadata) {
  const domain = creatorOfficialDomain(profile);
  if (!domain) return null;
  const observed = (metadata.collaborationObservations ?? []).find((item) =>
    item.partnerName && ["explicit_sponsorship_disclosure", "affiliate_reference",
      "product_review_or_mention"].includes(item.kind));
  if (!observed) return null;
  const focus = observed.kind === "explicit_sponsorship_disclosure" ? "sponsored" : "collaboration";
  return { domain, partnerName: observed.partnerName, kind: observed.kind,
    query: `${profile.name} ${observed.partnerName} ${focus}`, focus };
}

export function commercialMetadataForResearch(metadata, transcriptFindings = []) {
  const fromTranscript = transcriptFindings.filter((item) =>
    ["explicit_sponsorship_disclosure", "affiliate_reference"].includes(item.kind) &&
    /^[A-Z][A-Za-z0-9]*(?:[ -][A-Z][A-Za-z0-9]*)*$/.test(item.entity ?? "") &&
    String(item.entity).length >= 5).map((item) => ({
      partnerName: item.entity,
      kind: item.kind,
      videoId: item.videoId, sourceUrl: item.sourceUrl, offsetMs: item.offsetMs,
    }));
  return { ...metadata, collaborationObservations: [
    ...(metadata.collaborationObservations ?? []), ...fromTranscript] };
}

// A page hit only locates a candidate source. Both named parties and a concrete
// action must appear in the inspected passage before it becomes an observation.
export function verifiedCreatorCommercialPage(item, profile, question) {
  if (item?.inspected !== true || !/^[a-f0-9]{64}$/.test(item.sourceHash ?? "") ||
      officialDomainOf(item.url) !== question.domain) return false;
  const passage = words(item.snippet);
  const creator = words(profile.name);
  const partner = words(question.partnerName);
  return Boolean(creator && partner && passage.includes(creator) && passage.includes(partner) &&
    /\b(?:sponsor(?:ed|s)?|partner(?:ed|ship|s)?|collaborat(?:ed|ion|es)?|creat(?:ed|es)?|produc(?:ed|es)?)\b/.test(passage) &&
    !/\b(?:rumou?r|alleged|might|may|could|planned|not sponsored|not partnered)\b/.test(passage));
}

export async function researchCreatorCommercial(profile, metadata,
  { search = withWebSearch, extract = withWebExtract } = {}) {
  const question = creatorCommercialQuestion(profile, metadata);
  if (!question) return { coverage: "not_performed", observations: [], reason: "no_specific_official_question" };
  try {
    const response = await search(question.query, { includeDomains: [question.domain], focus: question.focus });
    const inspected = [...(response.results ?? [])];
    if (!inspected.length && response.leads?.[0]?.url) {
      const lead = response.leads.find((item) => officialDomainOf(item.url) === question.domain);
      if (lead) inspected.push(...((await extract(lead.url, { focus: question.focus,
        title: lead.title ?? "" })).results ?? []));
    }
    const observations = inspected.filter((item) => verifiedCreatorCommercialPage(item, profile, question))
      .slice(0, 2).map((item) => ({ item, partnerName: question.partnerName,
        kind: "documented_collaboration", originalKind: question.kind }));
    return { coverage: observations.length ? "supported" : "inconclusive", observations,
      reason: observations.length ? null : "no_attributed_official_statement",
      cacheStatus: response.cacheStatus ?? null };
  } catch (error) {
    return { coverage: "not_completed", observations: [],
      reason: /daily provider limit/.test(String(error?.message)) ? "web_budget_exhausted" : "web_unavailable" };
  }
}
