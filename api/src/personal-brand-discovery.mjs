import pg from "pg";
import { personalQlooDescribe, personalQlooRecommendBrands } from "./personal-qloo.mjs";
import { isOutsideProductScope } from "./discovery.mjs";
import { comparableName, normalizeQlooBrands, searchWikidataBrands, selectedWikidataBrand } from "./brand-resolution.mjs";
import { fileBrandWebSource, processPersonalBrandRun } from "./personal-brand.mjs";
import { officialDomainOf, withWebSearch } from "./web-research.mjs";

const QLOO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIKIDATA_QID = /^Q[1-9]\d*$/;
const IDENTITY_TERMS = ["socks", "backpacks", "clothing", "apparel", "equipment", "gear", "mountaineering", "retail", "footwear"];
class IdentityReviewError extends Error {}
let pool;
function db() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

export function selectBrandLeads(results, seedQlooId, limit = 8) {
  const seen = new Set([seedQlooId]);
  const leads = [];
  for (const item of Array.isArray(results) ? results : []) {
    const id = item?.entity_id;
    const name = String(item?.name ?? "").trim();
    if (!QLOO_UUID.test(id ?? "") || seen.has(id) || name.length < 2 || name.length > 120 ||
        isOutsideProductScope(item)) continue;
    seen.add(id);
    const normalized = normalizeQlooBrands({ results: [item] })[0];
    leads.push({ qlooId: id, name, description: String(item.properties?.short_description ?? item.properties?.description ?? "").slice(0, 280),
      qlooWebsite: normalized?.website ?? null });
    if (leads.length >= limit) break;
  }
  return leads;
}

function websiteHost(value) {
  try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, "") : null; }
  catch { return null; }
}

function identityTerm(description) {
  const lower = String(description ?? "").toLowerCase();
  return IDENTITY_TERMS.find((term) => new RegExp(`\\b${term}\\b`).test(lower)) ?? null;
}

function officialTitleNamesBrand(title, name) {
  return comparableName(title).includes(comparableName(name));
}

export async function verifyOfficialBrandEvidence(lead, website, { search = withWebSearch } = {}) {
  const domain = officialDomainOf(website);
  const term = identityTerm(lead.description);
  if (!domain || !term || !comparableName(lead.name)) return null;
  const result = await search(`${lead.name} ${term}`, { includeDomains: [domain], focus: term });
  const page = (result.results ?? []).find((item) => item.inspected === true &&
    officialDomainOf(item.url) === domain && officialTitleNamesBrand(item.title, lead.name) &&
    new RegExp(`\\b${term}\\b`, "i").test(`${item.title} ${item.snippet}`) &&
    /^[a-f0-9]{64}$/.test(item.sourceHash ?? ""));
  return page ? { url: page.url, title: page.title, snippet: page.snippet,
    sourceHash: page.sourceHash, inspected: true } : null;
}

export async function discoverOfficialBrandEvidence(lead, { search = withWebSearch } = {}) {
  const term = identityTerm(lead.description);
  if (!term) return null;
  const result = await search(`${lead.name} ${term} official`, { focus: term });
  const normalizedName = comparableName(lead.name).replace(/\s/g, "");
  const domains = [...new Set((result.results ?? []).filter((item) => item.inspected === true &&
    officialTitleNamesBrand(item.title, lead.name) && new RegExp(`\\b${term}\\b`, "i").test(`${item.title} ${item.snippet}`))
    .map((item) => officialDomainOf(item.url)).filter((domain) =>
      domain && domain.split(".")[0].replace(/[^a-z0-9]/g, "") === normalizedName))];
  if (domains.length !== 1) return null;
  const evidence = await verifyOfficialBrandEvidence(lead, `https://${domains[0]}`, { search });
  return evidence ? { website: `https://${domains[0]}`, evidence } : null;
}

// Business records are screened as leads. Only a matching official website on
// both provider records permits automatic identity binding for deeper research.
// Ambiguous and missing records remain visible for explicit confirmation.
export async function screenBrandLeads(leads, { search = searchWikidataBrands,
  detail = selectedWikidataBrand, maxScreened = leads.length } = {}) {
  const output = [];
  for (const [index, lead] of leads.entries()) {
    const base = { name: lead.name, description: lead.description, businessStatus: "not_checked", culturalSignals: [],
      businessRecordUrl: null, officialWebsite: null, businessIdentity: null, businessOptions: [], verifiedIdentity: null,
      lookupCalls: 0 };
    if (index >= maxScreened) { output.push(base); continue; }
    try {
      const matches = (await search(lead.name)).filter((item) =>
        comparableName(item.name) === comparableName(lead.name));
      if (!matches.length) { output.push({ ...base, businessStatus: "not_found", lookupCalls: 1 }); continue; }
      // Keep the lookup bounded. More than three exact-name records require
      // explicit review because an unseen record could share the same site.
      const details = await Promise.all(matches.slice(0, 3).map((item) => detail(item)));
      const options = details.filter((item) => WIKIDATA_QID.test(item?.id ?? "") && item.website)
        .map((item) => ({ wikidataQid: item.id, website: item.website, description: item.description,
          wikidataUrl: item.wikidataUrl ?? `https://www.wikidata.org/wiki/${item.id}` }));
      const qlooHost = websiteHost(lead.qlooWebsite);
      const matching = qlooHost && matches.length <= 3
        ? options.filter((item) => websiteHost(item.website) === qlooHost) : [];
      const business = matching.length === 1 ? matching[0] : options.length === 1 && matches.length === 1 ? options[0] : null;
      const corroborated = matching.length === 1 && QLOO_UUID.test(lead.qlooId ?? "");
      output.push({ ...base, businessStatus: corroborated ? "corroborated"
        : matches.length > 1 ? "ambiguous" : qlooHost && options.length ? "conflicting" : "record_found",
      lookupCalls: 1 + details.length,
      businessRecordUrl: business?.wikidataUrl ?? (matches.length === 1 ? details[0]?.wikidataUrl ?? null : null),
      officialWebsite: business?.website ?? null,
      businessIdentity: business ? { wikidataQid: business.wikidataQid, website: business.website } : null,
      businessOptions: options,
      verifiedIdentity: corroborated ? { qlooId: lead.qlooId,
        wikidataQid: business.wikidataQid, website: business.website } : null });
    } catch { output.push({ ...base, businessStatus: "unavailable", lookupCalls: 1 }); }
  }
  return output;
}

// Reuse a canonical entity only when both typed identifiers and its website
// remain consistent. Any collision leaves the lead for manual confirmation.
export async function ensureVerifiedDiscoveredBrand(lead, verifiedIdentity) {
  if (!verifiedIdentity || !QLOO_UUID.test(verifiedIdentity.qlooId ?? "") ||
      !verifiedIdentity.website ||
      (verifiedIdentity.wikidataQid && !WIKIDATA_QID.test(verifiedIdentity.wikidataQid)) ||
      (websiteHost(lead.qlooWebsite) !== websiteHost(verifiedIdentity.website) &&
        !(verifiedIdentity.officialEvidence?.inspected === true &&
          websiteHost(verifiedIdentity.officialEvidence.url) === websiteHost(verifiedIdentity.website) &&
          /^[a-f0-9]{64}$/.test(verifiedIdentity.officialEvidence.sourceHash ?? "")))) return null;
  const client = await db().connect();
  try {
    await client.query("begin");
    const identifiers = await client.query(`select entity_id from catalog.entity_identifiers
      where status='confirmed' and ((provider='qloo' and external_id=$1)
        or (provider='wikidata' and external_id=$2)) for update`,
    [verifiedIdentity.qlooId, verifiedIdentity.wikidataQid ?? null]);
    const ids = [...new Set(identifiers.rows.map((row) => row.entity_id))];
    if (ids.length > 1) throw new IdentityReviewError("Conflicting confirmed brand identifiers.");
    const byUrl = await client.query("select id from catalog.entities where canonical_url=$1 for update",
      [verifiedIdentity.website]);
    if (byUrl.rows[0] && ids.length && byUrl.rows[0].id !== ids[0]) throw new IdentityReviewError("Brand website belongs to another entity.");
    const entityId = ids[0] ?? byUrl.rows[0]?.id ?? (await client.query(`insert into catalog.entities
      (kind,canonical_name,canonical_url,official_website,identity_status)
      values ('brand',$1,$2,$2,'verified') returning id`,
    [lead.name, verifiedIdentity.website])).rows[0].id;
    const entity = await client.query(`select kind,canonical_name,official_website from catalog.entities
      where id=$1 for update`, [entityId]);
    if (entity.rows[0]?.kind !== "brand" ||
        comparableName(entity.rows[0].canonical_name) !== comparableName(lead.name) ||
        (entity.rows[0].official_website && websiteHost(entity.rows[0].official_website) !== websiteHost(verifiedIdentity.website))) {
      throw new IdentityReviewError("Existing business identity requires review.");
    }
    const others = await client.query(`select provider,external_id from catalog.entity_identifiers
      where entity_id=$1 and provider in ('qloo','wikidata') and status='confirmed' for update`, [entityId]);
    if (others.rows.some((row) => row.external_id !== (row.provider === "qloo"
      ? verifiedIdentity.qlooId : verifiedIdentity.wikidataQid))) throw new IdentityReviewError("Existing business identifiers require review.");
    for (const [provider, externalId, externalUrl] of [
      ["qloo", verifiedIdentity.qlooId, null],
      ["wikidata", verifiedIdentity.wikidataQid, `https://www.wikidata.org/wiki/${verifiedIdentity.wikidataQid}`],
    ].filter((item) => item[1])) {
      const inserted = await client.query(`insert into catalog.entity_identifiers
        (entity_id,provider,external_id,external_url,status,verified_at)
        values ($1,$2,$3,$4,'confirmed',now())
        on conflict (provider,external_id) where status='confirmed'
        do update set verified_at=now() returning entity_id`, [entityId, provider, externalId, externalUrl]);
      if (inserted.rows[0]?.entity_id !== entityId) throw new IdentityReviewError("Confirmed identifier belongs to another brand.");
    }
    await client.query(`update catalog.entities set official_website=$2,identity_status='verified',updated_at=now()
      where id=$1`, [entityId, verifiedIdentity.website]);
    if (verifiedIdentity.officialEvidence) {
      const filed = await fileBrandWebSource(client, entityId, verifiedIdentity.officialEvidence, "business_identity");
      if (!filed) throw new IdentityReviewError("Official identity evidence belongs to another brand.");
    }
    await client.query("commit");
    return entityId;
  } catch (error) {
    await client.query("rollback");
    if (error instanceof IdentityReviewError || error?.code === "23505") return null;
    throw error;
  } finally { client.release(); }
}

export async function processPersonalBrandDiscoveryRun(run, workerId,
  { recommend = personalQlooRecommendBrands, screen = screenBrandLeads,
    describe = personalQlooDescribe, verifyOfficial = verifyOfficialBrandEvidence,
    discoverOfficial = discoverOfficialBrandEvidence,
    ensureEntity = ensureVerifiedDiscoveredBrand,
    assess = processPersonalBrandRun } = {}) {
  if (run.constraints_json?.researchMode !== "live_brand" || run.kind !== "discovery" ||
      run.match_type !== "brand_brand" || run.specified_partner_id) {
    throw new Error("Unsupported brand discovery run.");
  }
  const seed = await db().query(`select i.external_id from catalog.entities e
    join catalog.entity_identifiers i on i.entity_id=e.id and i.provider='qloo' and i.status='confirmed'
    where e.id=$1 and e.kind='brand' limit 1`, [run.seed_entity_id]);
  const qlooId = seed.rows[0]?.external_id;
  if (!QLOO_UUID.test(qlooId ?? "")) throw new Error("Confirm the starting brand before finding partners.");
  const discovery = await recommend(run.user_id, qlooId);
  if (discovery.sampleData) throw new Error("Sample cultural results cannot be used as live partner discovery.");
  const envelope = discovery.envelope ?? {};
  const leads = selectBrandLeads(envelope.results, qlooId);
  const candidates = leads.map((lead) => ({ name: lead.name, description: lead.description,
    businessStatus: "not_checked", culturalSignals: [], businessRecordUrl: null, officialWebsite: null }));
  const assessments = [];
  // The existing run plan is the global operation ceiling. Reserve the direct
  // pair budget for each assessment; spend the rest progressively on identity.
  let remaining = Number.isInteger(run.plan_json?.maxProviderCalls) ? run.plan_json.maxProviderCalls - 1 : 34;
  let screenedCount = 0;
  const maxCandidates = Math.min(leads.length, run.plan_json?.maxCandidates ?? 8);
  const assessCandidate = async (index) => {
    const candidate = candidates[index];
    if (!candidate.verifiedIdentity || remaining < 16 || assessments.length >= 3) return;
    candidate.businessStatus = "corroborated";
    candidate.officialWebsite = candidate.verifiedIdentity.website;
    candidate.businessRecordUrl = candidate.verifiedIdentity.wikidataQid
      ? `https://www.wikidata.org/wiki/${candidate.verifiedIdentity.wikidataQid}` : null;
    const partnerId = await ensureEntity(leads[index], candidate.verifiedIdentity);
    if (!partnerId || partnerId === run.seed_entity_id) {
      candidate.researchStatus = "identity_needs_review";
      return;
    }
    try {
      remaining -= 16;
      const assessment = await assess(run, workerId, { discoveryPartnerId: partnerId, finalizeRun: false });
      if (!assessment || typeof assessment !== "object" || !assessment.matchId) throw new Error("Pair assessment was incomplete.");
      assessments.push(assessment);
      candidate.matchId = assessment.matchId;
      candidate.scoreStatus = assessment.scoreStatus;
      candidate.displayScore = assessment.displayScore;
      candidate.confidence = assessment.confidence;
      candidate.researchStatus = assessment.researchCoverage === "performed" ? "researched" : "research_incomplete";
    } catch { candidate.researchStatus = "research_unavailable"; }
  };
  for (let index = 0; index < maxCandidates && assessments.length < 3; index += 1) {
    if (remaining <= 16) break;
    const lead = leads[index];
    const candidate = (await screen([lead]))[0];
    if (!candidate) break;
    candidates[index] = candidate;
    screenedCount += 1;
    remaining -= candidate.lookupCalls ?? 1;
    if (!candidate.verifiedIdentity && !lead.qlooWebsite && candidate.businessOptions?.length === 1 && remaining > 17) {
      remaining -= 1;
      const option = candidate.businessOptions[0];
      try {
        const evidence = await verifyOfficial(lead, option.website);
        if (evidence) candidate.verifiedIdentity = { qlooId: lead.qlooId,
          wikidataQid: option.wikidataQid, website: option.website, officialEvidence: evidence };
      } catch { /* Identity stays review-needed. */ }
    }
    await assessCandidate(index);
  }
  // Spend any remaining identity budget on harder cases only after the cheap,
  // unique official records have had a chance to reach assessment.
  for (let index = 0; index < screenedCount && assessments.length < 3 && remaining > 18; index += 1) {
    const lead = leads[index]; const candidate = candidates[index];
    if (candidate.verifiedIdentity || lead.qlooWebsite) continue;
    if (candidate.businessOptions?.length && remaining > 17) {
      remaining -= 1;
      try {
        const described = await describe(run.user_id, { entity: lead.name, type: "brand" });
        const exact = described?.status === "ok" && !described.sampleData
          ? normalizeQlooBrands(described).find((item) => item.id === lead.qlooId) : null;
        const matching = candidate.businessOptions.filter((item) => websiteHost(item.website) === websiteHost(exact?.website));
        if (matching.length === 1) {
          lead.qlooWebsite = exact.website;
          candidate.verifiedIdentity = { qlooId: lead.qlooId,
            wikidataQid: matching[0].wikidataQid, website: matching[0].website };
        }
      } catch { /* Identity stays review-needed. */ }
    }
    if (!candidate.verifiedIdentity && !lead.qlooWebsite && remaining > 18) {
      remaining -= 2;
      try {
        const official = await discoverOfficial(lead);
        const competing = candidate.businessOptions?.some((item) =>
          websiteHost(item.website) === websiteHost(official?.website));
        if (official && !competing) candidate.verifiedIdentity = { qlooId: lead.qlooId,
          wikidataQid: null, website: official.website, officialEvidence: official.evidence };
      } catch { /* Identity stays review-needed. */ }
    }
    await assessCandidate(index);
  }
  const publicCandidates = candidates.map(({ verifiedIdentity, businessIdentity, businessOptions, lookupCalls, ...candidate }) => candidate);
  const scored = assessments.filter((item) => ["eligible", "conditional"].includes(item.scoreStatus));
  const client = await db().connect();
  try {
    await client.query("begin");
    const locked = await client.query("select status,worker_id from public.analysis_runs where id=$1 for update", [run.id]);
    if (locked.rows[0]?.status !== "running" || locked.rows[0]?.worker_id !== workerId) {
      await client.query("rollback"); return false;
    }
    await client.query(`update public.analysis_runs set status=$2,stage='Partner research ready',
      provider_refs_json=$3::jsonb,result_json=$4::jsonb,finished_at=now(),lease_until=null,
      worker_id=null,updated_at=now() where id=$1`, [run.id, scored.length ? "completed" : "partial",
      JSON.stringify([{ provider: "qloo", operation: "qloo_recommend",
        responseId: discovery.responseId ?? null, cacheStatus: discovery.cacheStatus,
        status: envelope.status ?? "unavailable" },
      ...assessments.flatMap((item) => item.providerRefs ?? [])]),
      JSON.stringify({ sample: false, researchType: "brand_discovery", count: publicCandidates.length,
        screenedCount, assessedCount: assessments.length, scoredCount: scored.length, candidates: publicCandidates,
        message: publicCandidates.length
          ? scored.length
            ? "Research-backed partner options are ready. Scored opportunities and leads needing more evidence are shown separately."
            : "Partner leads are ready. Some need identity confirmation or more source evidence before an opportunity score is available."
          : "No suitable brand leads were returned. Try a different starting brand or compare a specific partner." })]);
    await client.query("commit");
    return true;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
