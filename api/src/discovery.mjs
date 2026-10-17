import { qlooCall } from "./qloo.mjs";
import { searchChannelLeads, importChannel, topicsInText } from "./youtube.mjs";
import { makeRunPlan } from "./planning.mjs";

function category(entity) {
  const text = `${entity.name} ${entity.properties?.short_description ?? ""}`.toLowerCase();
  if (/apparel|clothing|footwear|fashion|wear|outerwear/.test(text)) return "Apparel";
  if (/equipment|gear|retailer|retail/.test(text)) return "Retail & gear";
  if (/travel|camping|booking|destination|hospitality|experience/.test(text)) return "Travel & experiences";
  if (/community|association|club|nonprofit|non-profit/.test(text)) return "Community";
  if (/software|platform|digital|app/.test(text)) return "Digital service";
  return "Brand";
}

export function isOutsideProductScope(entity) {
  const text = `${entity.name} ${entity.properties?.short_description ?? ""}`;
  return /\b(magazine|publisher|publication|podcast|radio station|newsletter|newspaper)\b/i.test(text);
}

export function makeConcept(seed, partner, goal, bridge) {
  const topic = bridge || "a shared interest";
  const hasCreator = partner.kind === "Creator";
  const formats = {
    "New audience": "Shared introduction",
    "Cultural credibility": "Community story",
    "Co-created product": "Limited prototype",
    "Content collaboration": hasCreator ? "Joint video pilot" : "Shared story pilot",
    "Event / experience": "Small live session",
    Sponsorship: hasCreator ? "Sponsored video pilot" : "Sponsored experience pilot",
  };
  const format = formats[goal] ?? "Collaboration pilot";
  const deliverable = goal === "Co-created product" ? `A prototype built around ${topic}`
    : goal === "Event / experience" ? `One small session about ${topic} with a documented recap`
    : hasCreator ? `One video about ${topic} with a clear role for each partner`
    : `One co-authored story or small experience about ${topic}`;
  const seedRole = `Provide the ${topic} perspective, access, or materials it can credibly support.`;
  const partnerRole = partner.kind === "Creator" ? `Bring a distinct ${topic} perspective and make the pilot with ${seed.name}.` : `Provide the ${topic} perspective, access, or materials it can credibly support.`;
  return {
    title: `${seed.name} × ${partner.name}: ${topic}`,
    summary: `Test a ${format.toLowerCase()} around ${topic} with ${seed.name} and ${partner.name}.`,
    format,
    topic,
    seedRole,
    partnerRole,
    deliverable,
    measure: "Did the pilot draw relevant interest and give both partners a reason to continue?",
    steps: [
      `Agree on one audience question about ${topic} and confirm both partners want to explore it.`,
      `Assign roles, permissions, and a small budget; produce ${deliverable.toLowerCase()}.`,
      "Review response with both partners and decide whether a larger collaboration is justified.",
    ],
    validation: `Check that ${topic} matters to the intended audience; confirm partner interest, rights, timing, and budget before production.`,
  };
}

function publicError(envelope, action) {
  if (envelope.status === "needs_input") return `We found more than one possible ${action}. Please try a more specific name.`;
  if (envelope.status === "empty") return `We could not find enough information for that ${action}. Try another name.`;
  if (envelope.error?.code === "QLOO_AUTH") return "Partnership research is temporarily unavailable. Please try again later.";
  return "Partnership research is temporarily unavailable. Please try again shortly.";
}

export async function discover(input, memory, trace, { qloo = qlooCall, channels = searchChannelLeads, importCreator = importChannel } = {}) {
  if (input.type !== "brand" || !["brand", "creator"].includes(input.partnerType)) throw new Error("Start with a brand and choose brand or YouTube creator partners.");
  const plan = makeRunPlan(input, memory.feedback ?? []);
  trace.push({ step: "plan", plan, at: new Date().toISOString() });
  if (input.partnerType === "creator") return discoverCreatorPartners(input, trace, plan, qloo, channels, importCreator);
  const seedName = String(input.seed ?? "").trim();
  if (seedName.length < 2 || seedName.length > 90) throw new Error("Enter a brand name between 2 and 90 characters.");
  const goal = String(input.goal ?? "Content collaboration");

  const described = input.selectedSeed ? { status: "ok", results: [input.selectedSeed], result_count: 1 } : await qloo("qloo_describe", { entity: seedName, type: "brand" });
  trace.push({ step: input.selectedSeed ? "confirmed_brand" : "describe", status: described.status, count: described.result_count ?? 0, at: new Date().toISOString() });
  if (described.status !== "ok" || !described.results?.[0]?.entity_id) throw new Error(publicError(described, "brand"));
  const seed = { ...described.results[0], kind: "Brand" };
  if (isOutsideProductScope(seed)) throw new Error("This entity is outside the supported brand searches. Try another brand instead.");

  const recommendations = await qloo("qloo_recommend", { target_type: "brand", signals: [seed.entity_id], limit: 20, explain: true });
  trace.push({ step: "recommend", status: recommendations.status, count: recommendations.result_count ?? 0, seedId: seed.entity_id, at: new Date().toISOString() });
  if (!["ok", "partial"].includes(recommendations.status)) throw new Error(publicError(recommendations, "partnership"));

  const seedCategory = category(seed);
  const seedDescription = `${seed.properties?.description ?? ""} ${seed.properties?.short_description ?? ""}`;
  const seedTopics = topicsInText(seedDescription);
  const raw = (recommendations.results ?? []).filter((item) => item.entity_id && item.name && item.entity_id !== seed.entity_id && !isOutsideProductScope(item));
  const excluded = new Set(plan.excludedCandidateIds);
  const avoidsSimilar = plan.avoidCloseCategories;
  const candidates = raw.filter((item) => !excluded.has(item.entity_id)).map((item) => {
    const kind = category(item);
    const description = item.properties?.short_description ?? item.properties?.description ?? "";
    const sameCategory = kind === seedCategory && kind !== "Brand";
    const partnerTopics = topicsInText(`${item.properties?.description ?? ""} ${description}`);
    const sharedTopics = seedTopics.filter((topic) => partnerTopics.includes(topic));
    const bridge = sharedTopics[0];
    const concept = makeConcept(seed, { ...item, kind: "Brand" }, goal, bridge);
    return {
      id: item.entity_id,
      name: item.name,
      summary: description,
      kind,
      sameCategory,
      sharedThemeCount: sharedTopics.length,
      connection: bridge ? `Both brand profiles mention ${bridge}. Partnership research also suggests a cultural connection.` : `Partnership research suggests a cultural connection, but the available brand profiles do not establish a shared theme.`,
      reason: bridge ? `A pilot around ${bridge} could test whether the two perspectives work together.` : "This is an exploratory match. Ask both teams to name a real shared audience question before developing an idea.",
      concept,
      evidenceStrength: bridge ? "Shared profile theme" : "Exploratory match",
      evidenceNotes: bridge ? [`${seed.name}'s profile mentions ${bridge}.`, `${item.name}'s profile mentions ${bridge}.`, "Partnership research suggests cultural affinity; no public source link is available for that signal."] : ["Partnership research suggests cultural affinity; the available profiles do not name a shared theme."],
      evidenceLimit: "Public campaign examples, audience overlap, and partner interest have not been verified.",
      practicalConcern: "Partner interest, audience fit, and commercial terms still need to be confirmed.",
      sourceLinks: [],
    };
  }).filter((item) => item.sharedThemeCount >= (plan.requireStrongerEvidence ? 2 : 1) && (!avoidsSimilar || !item.sameCategory));

  trace.push({ step: "shortlist", candidateCount: candidates.length, feedbackIds: plan.feedbackIds, at: new Date().toISOString() });
  return {
    status: candidates.length ? "completed" : "partial",
    seed: { name: seed.name, summary: seed.properties?.short_description ?? "", kind: seedCategory },
    candidates: candidates.slice(0, 8).map(({ sameCategory, sharedThemeCount, ...item }) => item),
    message: candidates.length ? undefined : "We could not find a partner with a clear shared theme in the available brand profiles. Try a different brand or broaden your criteria.",
    count: candidates.length,
  };
}

async function discoverCreatorPartners(input, trace, plan, qloo, channels, importCreator) {
  const name = String(input.seed ?? "").trim();
  if (name.length < 2 || name.length > 90) throw new Error("Enter a brand name between 2 and 90 characters.");
  const described = input.selectedSeed ? { status: "ok", results: [input.selectedSeed], result_count: 1 } : await qloo("qloo_describe", { entity: name, type: "brand" });
  trace.push({ step: input.selectedSeed ? "confirmed_brand" : "describe", status: described.status, count: described.result_count ?? 0, at: new Date().toISOString() });
  const brand = described.results?.[0];
  if (described.status !== "ok" || !brand?.entity_id || isOutsideProductScope(brand)) throw new Error("We could not confirm that brand. Try a more specific brand name.");
  const summary = brand.properties?.short_description ?? brand.properties?.description ?? "";
  const seed = { name: brand.name, kind: "Brand", summary };
  const signals = topicsInText(`${brand.properties?.description ?? ""} ${summary}`).map((label) => ({ label, count: 1, sources: [] }));
  trace.push({ step: "brand_topics", seedId: brand.entity_id, labels: signals.map((item) => item.label), at: new Date().toISOString() });
  if (!signals.length) throw new Error("We could not find a clear cultural topic for this brand. Try another brand.");

  let bridge;
  for (const signal of signals.slice(plan.contentSignalOffset, plan.contentSignalOffset + 4)) {
    const response = await qloo("qloo_find_tags", { query: signal.label, limit: 3 });
    const tag = matchingTag(response.results, signal.label);
    trace.push({ step: "resolve_topic", topic: signal.label, status: response.status, tagId: tag ? tagId(tag) : undefined, at: new Date().toISOString() });
    if (response.status === "ok" && tag) { bridge = { signal, tagId: tagId(tag) }; break; }
  }
  if (!bridge) throw new Error("We could not confirm a cultural connection for this brand. Try another brand.");

  let leads;
  try { leads = (await channels(bridge.signal.label)).map((lead) => typeof lead === "string" ? { id: lead, searchSource: null } : lead); }
  catch (error) {
    trace.push({ step: "creator_catalog", status: "unavailable", at: new Date().toISOString() });
    return { status: "partial", seed, candidates: [], count: 0,
      message: "Public creator research is temporarily unavailable. Please try again later." };
  }
  trace.push({ step: "creator_catalog", topic: bridge.signal.label, candidateRefs: leads.map((lead) => lead.id), at: new Date().toISOString() });
  const imports = await Promise.allSettled(leads.map((lead) => importCreator(lead.id)));
  const excluded = new Set(plan.excludedCandidateIds);
  const candidates = imports.map((item, index) => item.status === "fulfilled" ? { channel: item.value, lead: leads[index] } : null)
    .filter(Boolean).filter(({ channel, lead }) => !excluded.has(channel.id) && Boolean(lead.searchSource))
    .map(({ channel, lead }) => ({
      id: channel.id, name: channel.name, kind: "Creator", summary: channel.summary || "Public YouTube channel",
      connection: `${seed.name}'s brand profile mentions ${bridge.signal.label}. A YouTube search for that topic surfaced a video from ${channel.name}; the creator's sustained interest has not been assessed.`,
      reason: "Review the linked video and channel with the creator before deciding whether there is a real partnership fit.",
      concept: makeConcept(seed, { name: channel.name, kind: "Creator" }, input.goal, bridge.signal.label),
      evidenceStrength: "Cultural fit unassessed",
      evidenceNotes: [`${seed.name}'s brand profile mentions ${bridge.signal.label}.`,
        `A public YouTube search returned a video from ${channel.name} for this topic. This does not verify a recurring creator theme.`],
      evidenceLimit: "Creator content themes, audience overlap, endorsement, and partner interest have not been verified. This is a search lead, not an assessed recommendation.",
      practicalConcern: "Confirm topic relevance, creator interest, audience fit, rights, and a workable format before proceeding.",
      sourceLinks: lead.searchSource ? [lead.searchSource] : [], channelUrl: channel.url,
    }));
  trace.push({ step: "shortlist", candidateCount: candidates.length, failedImports: imports.filter((item) => item.status === "rejected").length, feedbackIds: plan.feedbackIds, at: new Date().toISOString() });
  return {
    status: "partial",
    seed: { name: seed.name, kind: seed.kind, summary: seed.summary, topics: signals.map((item) => item.label) },
    candidates: candidates.slice(0, 8),
    message: candidates.length ? "These are YouTube search leads, not assessed matches. Review the linked videos and confirm the creator's interest before developing a partnership."
      : "We could not find a public creator lead for this topic. Try a different brand.",
    count: candidates.length,
  };
}

function tagId(result) {
  return result?.tag_id ?? result?.tag_urn ?? result?.urn ?? result?.id ?? result?.tag?.id;
}

export function matchingTag(results, topic) {
  const normalized = topic.toLowerCase().replace(/s$/, "");
  return results?.find((item) => {
    const id = tagId(item);
    const name = String(item?.name ?? "").toLowerCase().replace(/s$/, "");
    return typeof id === "string" && id.startsWith("urn:tag:") && (name === normalized || name.includes(normalized));
  });
}

