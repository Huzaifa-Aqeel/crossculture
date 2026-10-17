import pg from "pg";
import { createHash } from "node:crypto";
import { freezeEvidenceInput } from "./evidence-ledger.mjs";
import { personalQlooRank, personalQlooEntityTags } from "./personal-qloo.mjs";
import { classifySignals, classifyExclusions, scoreAssessment, SCORING_VERSION, requiredCapabilities } from "./scoring.ts";
import { assessmentConstraints } from "./assessment-constraints.mjs";
import { assessmentNeedsAppend } from "./assessment-reuse.mjs";
import { researchPartnerEvidence, officialDomainOf, classifyMention } from "./web-research.mjs";

let pool;
function db() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

async function identitySource(client, entityId, qid) {
  if (!/^Q[1-9]\d*$/.test(qid ?? "")) {
    const official = await client.query(`select id from catalog.source_items where entity_id=$1
      and platform='web' and source_type='business_identity' and expires_at > now()
      order by collected_at desc limit 1`, [entityId]);
    return official.rows[0]?.id ?? null;
  }
  const url = `https://www.wikidata.org/wiki/${qid}`;
  const result = await client.query(`insert into catalog.source_items(entity_id,platform,source_type,external_item_id,
    source_url,excerpt,rights_json) values($1,'wikidata','business_identity',$2,$3,
    'Selected structured business identity record','{"storage":"permitted","cross_user_reuse":"permitted"}'::jsonb)
    on conflict (platform,source_url)
    do update set collected_at=catalog.source_items.collected_at
    returning id,entity_id`, [entityId, qid, url]);
  if (result.rows[0].entity_id !== entityId) throw new Error("Business identity record belongs to another entity.");
  return result.rows[0].id;
}

function tagFamily(type) {
  if (typeof type !== "string") return null;
  const parts = type.split(":");
  return parts.length >= 4 ? parts.slice(2).join(":") : null;
}

function activityProjectKey(item, territory) {
  if (typeof item.projectKey === "string" && item.projectKey.trim()) return item.projectKey.trim().toLowerCase();
  try {
    const url = new URL(item.url);
    // Category landing pages are one ongoing product territory, even if split
    // into men's/women's navigation pages.
    if (/\/(?:c|category|categories)\//i.test(url.pathname)) {
      return `category:${url.hostname}:${String(territory).toLowerCase()}`;
    }
  } catch { /* The source validator will reject the URL later. */ }
  return `project:${String(item.title ?? item.url ?? "").toLowerCase()
    .replace(/\s*[|–—-]\s*[^|–—-]+$/, "").replace(/[^a-z0-9]+/g, " ").trim()}`.slice(0, 240);
}

const NON_CULTURAL_TAG_FAMILIES = new Set([
  "cost_description:place", "hotel_rating:place", "credit_card:place", "inclusivity:place",
]);
const GENERIC_TAG_NAMES = new Set(["tourist attraction", "friendship", "lifestyle", "popular", "discover"]);

function usableCulturalTag(tag) {
  const family = tagFamily(tag.type);
  const name = String(tag.name ?? "").trim().toLowerCase();
  return Boolean(family && !NON_CULTURAL_TAG_FAMILIES.has(family) && name.length >= 4 &&
    !GENERIC_TAG_NAMES.has(name));
}

// Versioned official-domain search terms per required capability (v4 §7 allowlist).
const CAPABILITY_TERMS = {
  distribution_channel: ["store", "shop", "collection"],
  activation_channel: ["event", "tour", "pop-up"],
  cultural_storytelling: ["journal", "editorial", "campaign"],
  making_or_delivery_capability: ["workshop", "manufacturing", "production"],
  content_creation_capability: ["campaign", "video", "journal"],
  integration_or_channel_capability: ["partnership", "collaboration", "sponsor"],
};

// Repositioning needs an observed cultural activity about the user's stated
// association as well as a separately demonstrated storytelling format. A
// match is a conservative evidence gate, never proof of audience perception.
export function positioningActivityEvidence(direction, activities) {
  const ignored = new Set(["brand", "brands", "culture", "cultural", "positioning", "identity",
    "association", "audience", "modern", "better", "stronger", "new"]);
  const words = String(direction ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").match(/[a-z]{4,}/g) ?? [];
  const terms = [...new Set(words.filter((word) => !ignored.has(word))
    .map((word) => word.length >= 6 ? word.slice(0, 5) : word))];
  if (!terms.length) return [];
  return activities.filter((activity) => {
    if (!activity.sourceId) return false;
    const title = String(activity.title ?? "").toLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
    // An inspected activity already passed attribution checks. Require its
    // action title to carry the specific direction; a generic excerpt hit can
    // supply only the separately Qloo-supported territory named by the bridge.
    if (!/\b(?:launch\w*|introduc\w*|creat\w*|design\w*|produc\w*|publish\w*|build\w*)\b/i.test(title)) {
      return false;
    }
    const titleRoots = new Set((title.match(/[a-z]{4,}/g) ?? [])
      .map((word) => word.length >= 6 ? word.slice(0, 5) : word));
    const bridgeRoots = new Set((String(activity.bridgeName ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? [])
      .map((word) => word.length >= 6 ? word.slice(0, 5) : word));
    return terms.some((term) => titleRoots.has(term)) &&
      terms.every((term) => titleRoots.has(term) || bridgeRoots.has(term));
  }).map((activity) => activity.sourceId);
}

export function brandResearchUnknowns(bridges, research, partnerActivity, capabilities) {
  const unknowns = [];
  if (bridges.length === 0) unknowns.push("Shared cultural territory");
  else if (bridges.every((bridge) => bridge.specificity === "broad")) {
    unknowns.push("Specific named cultural connection");
  }
  if (bridges.length > 0 && !research) unknowns.push("Partner business research was not completed");
  else if (research && partnerActivity.length === 0) {
    unknowns.push("Partner activity was not established in retrieved sources");
  }
  if (research && capabilities.every((capability) => capability.status === "unsupported")) {
    unknowns.push("Goal capability was not established in retrieved sources");
  }
  return unknowns;
}

// Web sources are shared public facts filed once per (platform, source_url); a page
// already filed for another entity is skipped rather than re-linked.
async function webSource(client, entityId, item, sourceType) {
  if (item?.inspected !== true || !/^[a-f0-9]{64}$/.test(item.sourceHash ?? "")) return null;
  try {
    if (new URL(item.url).protocol !== "https:") return null;
  } catch { return null; }
  const rights = { storage: "permitted", cross_user_reuse: "permitted", source_hash: item.sourceHash,
    title: String(item.title ?? "").slice(0, 300),
    ...(sourceType === "creator_identity" ? { outbound_links: (item.outboundLinks ?? [])
      .slice(0, 40).map((link) => ({ label: String(link.label ?? "").slice(0, 100),
        url: String(link.url ?? "").slice(0, 500) })) } : {}) };
  const publishedAt = Number.isFinite(Date.parse(item.publishedAt ?? "")) ? item.publishedAt : null;
  const existing = await client.query(
    "select id,entity_id,rights_json,fresh_until,expires_at from catalog.source_items where platform='web' and source_url=$1 for update", [item.url]);
  if (existing.rows[0]) {
    const prior = existing.rows[0];
    if (prior.entity_id !== entityId) return null;
    const changed = prior.rights_json?.source_hash !== item.sourceHash;
    if (changed) {
      await client.query(`update public.assessment_snapshots set validity_status='stale'
        where validity_status='valid' and source_refs_json @> $1::jsonb`,
      [JSON.stringify([{ kind: "catalog_item", id: prior.id }])]);
    }
    if (changed || !prior.fresh_until || new Date(prior.fresh_until) <= new Date() ||
        !prior.expires_at || new Date(prior.expires_at) <= new Date()) {
      await client.query(`update catalog.source_items set source_type=$2,excerpt=$3,published_at=$4,
        rights_json=$5::jsonb,collected_at=now(),fresh_until=now()+interval '7 days',
        expires_at=now()+interval '29 days' where id=$1`,
      [prior.id, sourceType, String(item.snippet ?? item.title ?? "").slice(0, 1000), publishedAt,
        JSON.stringify(rights)]);
    }
    return prior.id;
  }
  const result = await client.query(`insert into catalog.source_items(entity_id,platform,source_type,external_item_id,
    source_url,excerpt,published_at,rights_json,collected_at,fresh_until,expires_at)
    values($1,'web',$2,$3,$4,$5,$6,$7::jsonb,
      now(),now()+interval '7 days',now()+interval '29 days')
    returning id`, [entityId, sourceType,
      createHash("sha256").update(String(item.url)).digest("hex").slice(0, 40),
      String(item.url), String(item.snippet ?? item.title ?? "").slice(0, 1000),
      publishedAt, JSON.stringify(rights)]);
  return result.rows[0].id;
}

export const fileBrandWebSource = webSource;

// A bridge needs a traceable result on the seed side and a grounded association on the
// partner side; intersecting the two entity-tag responses supplies both. Raw pairwise
// affinity is provenance only and never forms a bridge. entity_tags returns broad
// attribute/genre tags, so bridges from this operation stay at the broad anchor.
export function buildBridges(seedTags, partnerTags) {
  if (!seedTags.responseId || !partnerTags.responseId) return [];
  const partnerById = new Map(partnerTags.tags.map((tag) => [tag.id, tag]));
  const bridges = [];
  for (const tag of seedTags.tags) {
    if (!usableCulturalTag(tag)) continue;
    if (!partnerById.has(tag.id)) continue;
    bridges.push({
      id: `bridge:${bridges.length + 1}`,
      name: tag.name,
      qlooTagId: tag.id,
      family: tagFamily(tag.type),
      specificity: "broad",
      qlooSourceIds: [`qloo:${seedTags.responseId}`, `qloo:${partnerTags.responseId}`],
      partnerSourceIds: [],
      explainabilityBacked: false,
    });
  }
  return bridges.slice(0, 8);
}

export async function processPersonalBrandRun(run, workerId, { rank = personalQlooRank, tags = personalQlooEntityTags,
  researchPartner = researchPartnerEvidence, discoveryPartnerId = null, finalizeRun = true } = {}) {
  const partnerEntityId = discoveryPartnerId ?? run.specified_partner_id;
  if (run.constraints_json?.researchMode !== "live_brand" || run.match_type !== "brand_brand" ||
      !partnerEntityId || (run.kind === "direct_pair" && discoveryPartnerId) ||
      (run.kind === "discovery" && (!discoveryPartnerId || run.specified_partner_id)) ||
      !["direct_pair", "discovery"].includes(run.kind)) {
    throw new Error("Unsupported brand research run.");
  }
  const identities = await db().query(`select e.id,e.canonical_name,e.kind,e.canonical_url,e.official_website,e.identity_status,
      (select external_id from catalog.entity_identifiers where entity_id=e.id and provider='qloo' and status='confirmed' limit 1) as qloo_id,
      (select external_id from catalog.entity_identifiers where entity_id=e.id and provider='wikidata' and status='confirmed' limit 1) as wikidata_qid
    from catalog.entities e where e.id=any($1::uuid[])`, [[run.seed_entity_id, partnerEntityId]]);
  const seed = identities.rows.find((item) => item.id === run.seed_entity_id);
  const partner = identities.rows.find((item) => item.id === partnerEntityId);
  if (!seed || !partner || seed.kind !== "brand" || partner.kind !== "brand" ||
      !seed.qloo_id || !partner.qloo_id || seed.id === partner.id) {
    throw new Error("The selected pair needs two distinct confirmed brands.");
  }
  let relationship;
  try { relationship = await rank(run.user_id, seed.qloo_id, partner.qloo_id); }
  catch { relationship = { envelope: { status: "unavailable" }, responseId: null, cacheStatus: "unavailable" }; }
  const result = relationship.envelope?.results?.find((item) => item?.entity_id === partner.qloo_id);
  const hasRelationship = relationship.envelope?.status === "ok" && Number.isFinite(result?.affinity) &&
    Boolean(relationship.responseId) && !relationship.sampleData;
  let seedTags;
  try { seedTags = await tags(run.user_id, seed.qloo_id); }
  catch { seedTags = { tags: [], responseId: null, inputHash: null, cacheStatus: "unavailable", status: "unavailable" }; }
  let partnerTags;
  try { partnerTags = await tags(run.user_id, partner.qloo_id); }
  catch { partnerTags = { tags: [], responseId: null, inputHash: null, cacheStatus: "unavailable", status: "unavailable" }; }
  const tagsUsable = (side) => side.status === "ok" && Boolean(side.responseId) && !side.sampleData;
  const bridges = tagsUsable(seedTags) && tagsUsable(partnerTags) ? buildBridges(seedTags, partnerTags) : [];
  const required = requiredCapabilities(run.objective);
  const capabilityTerms = required.filter((key) => key !== "distinct_territory_presence")
    .map((key) => ({ key, terms: CAPABILITY_TERMS[key] ?? [] })).filter((entry) => entry.terms.length > 0);
  // Bounded public web research for the partner's territory activity and goal
  // capabilities. Skipped entirely without bridges; failure leaves honest unknowns.
  let research = null;
  if (bridges.length > 0) {
    try {
      research = await researchPartner(run.user_id, { brandName: partner.canonical_name,
        entityId: partner.id,
        domain: officialDomainOf(partner.official_website ?? partner.canonical_url), territories: bridges.slice(0, 3).map((bridge) => bridge.name),
        capabilityTerms });
    } catch { research = null; }
  }
  const researchCoverage = bridges.length === 0 ? "cultural_bridge_missing"
    : research?.coverage === "not_completed" || !research ? "not_completed" : "performed";
  const client = await db().connect();
  try {
    await client.query("begin");
    const locked = await client.query("select status,worker_id from public.analysis_runs where id=$1 for update", [run.id]);
    if (locked.rows[0]?.status !== "running" || locked.rows[0]?.worker_id !== workerId) {
      await client.query("rollback"); return false;
    }
    const match = await client.query(`insert into public.matches(user_id,analysis_run_id,brand_entity_id,partner_entity_id)
      values($1,$2,$3,$4) on conflict (analysis_run_id,partner_entity_id)
      do update set updated_at=public.matches.updated_at returning id`,
    [run.user_id, run.id, seed.id, partner.id]);
    const sourceRefs = [];
    const claims = [];
    for (const [brand, label] of [[seed, "starting"], [partner, "partner"]]) {
      const sourceId = await identitySource(client, brand.id, brand.wikidata_qid);
      if (!sourceId) continue;
      sourceRefs.push({ kind: "catalog_item", id: sourceId });
      claims.push({ id: `identity:${label}`, kind: "observation",
        text: `${brand.canonical_name} has a selected public business identity record.`,
        sourceIds: [`catalog:${sourceId}`] });
    }
    if (hasRelationship) {
      sourceRefs.push({ kind: "qloo_response", id: relationship.responseId });
      claims.push({ id: "cultural:query", kind: "observation",
        text: "A cultural relationship signal was returned for this specific brand comparison; its meaning needs original public examples.",
        sourceIds: [`qloo:${relationship.responseId}`] });
    }
    const qlooInputHashes = hasRelationship ? [relationship.inputHash] : [];
    for (const side of [seedTags, partnerTags]) {
      if (!tagsUsable(side)) continue;
      sourceRefs.push({ kind: "qloo_response", id: side.responseId });
      qlooInputHashes.push(side.inputHash);
    }
    for (const bridge of bridges) {
      claims.push({ id: `claim:${bridge.id}`, kind: "observation",
        text: `Cultural research data associates both brands with "${bridge.name}".`,
        sourceIds: [...bridge.qlooSourceIds] });
    }
    const partnerActivity = [];
    const activityEvidence = [];
    const capabilities = [];
    const contradictingSourceIds = [];
    const potentialConflicts = [];
    const filedByUrl = new Map();
    const fileWebSource = async (item, sourceType) => {
      const url = String(item.url ?? "");
      if (filedByUrl.has(url)) return filedByUrl.get(url);
      const sourceId = await webSource(client, partner.id, item, sourceType);
      if (!sourceId) { filedByUrl.set(url, null); return null; }
      const ref = `catalog:${sourceId}`;
      sourceRefs.push({ kind: "catalog_item", id: sourceId });
      filedByUrl.set(url, ref);
      return ref;
    };
    if (research) {
      for (const result of research.territoryResults ?? []) {
        const bridge = bridges.find((item) => item.name.toLowerCase() === String(result.territory).toLowerCase());
        if (!bridge) continue;
        const candidates = [
          ...(result.official ?? []).slice(0, 2).map((item) => ({ ...item, firstParty: true })),
          ...(result.independent ?? []).slice(0, 1).map((item) => ({ ...item, firstParty: false })),
        ];
        for (const item of candidates) {
          const centrality = classifyMention(result.territory, item);
          if (centrality === "incidental" || centrality === "unknown") continue;
          const ref = await fileWebSource(item, item.firstParty ? "official_page" : "press");
          if (!ref) continue;
          partnerActivity.push({ id: `activity:${bridge.id}:${partnerActivity.length + 1}`,
            summary: String(item.summary ?? item.title ?? "").slice(0, 500), centrality, firstParty: item.firstParty,
            bridgeIds: [bridge.id], sourceIds: [ref], projectKey: activityProjectKey(item, result.territory),
            projectVerified: false });
          activityEvidence.push({ sourceId: ref, title: item.title, snippet: item.snippet,
            bridgeName: bridge.name });
          claims.push({ id: `claim:${bridge.id}:w${partnerActivity.length}`, kind: "observation",
            text: `${item.firstParty ? "Partner material" : "Independent coverage"} covers “${bridge.name}”: ${String(item.title ?? "").slice(0, 160)}.`,
            sourceIds: [ref] });
        }
      }
      for (const capability of research.capabilityResults ?? []) {
        for (const item of capability.contradictions ?? []) {
          const ref = await fileWebSource(item, "official_page");
          if (!ref) continue;
          contradictingSourceIds.push(ref);
          potentialConflicts.push({ key: capability.key, sourceId: ref });
          claims.push({ id: `claim:contradiction:${capability.key}:${contradictingSourceIds.length}`,
            kind: "observation", text: `Official material explicitly limits ${capability.key}.`,
            sourceIds: [ref] });
        }
        if (capability.status === "unsupported" || !(capability.matches ?? []).length) {
          capabilities.push({ id: `cap:${capability.key}`, name: capability.key, status: "unsupported", sourceIds: [] });
          continue;
        }
        const ref = await fileWebSource(capability.matches[0], "official_page");
        const directionRefs = run.objective === "repositioning" && capability.key === "cultural_storytelling"
          ? positioningActivityEvidence(run.constraints_json?.positioningDirection, activityEvidence) : null;
        const directionSupported = directionRefs === null || directionRefs.length > 0;
        capabilities.push(ref && directionSupported
          ? { id: `cap:${capability.key}`, name: capability.key, status: capability.status, sourceIds: [ref] }
          : { id: `cap:${capability.key}`, name: capability.key, status: "unsupported", sourceIds: [] });
        if (ref) claims.push({ id: `claim:cap:${capability.key}`, kind: "observation",
          text: `${directionSupported ? "Documented capability relevant to the goal" : "Documented general capability; relevance to the requested direction is unverified"}: “${String(capability.matches[0].title ?? "").slice(0, 160)}”.`,
          sourceIds: [ref] });
        if (directionRefs?.length) claims.push({ id: "claim:positioning-direction", kind: "observation",
          text: `Partner cultural activity addresses the requested positioning direction: “${String(run.constraints_json?.positioningDirection).slice(0, 240)}”.`,
          sourceIds: directionRefs });
      }
    }
    for (const key of required) {
      if (capabilities.some((capability) => capability.id === `cap:${key}`)) continue;
      capabilities.push(key === "distinct_territory_presence" && bridges.length > 0 && tagsUsable(partnerTags)
        ? { id: `cap:${key}`, name: key, status: "direct", sourceIds: [`qloo:${partnerTags.responseId}`] }
        : { id: `cap:${key}`, name: key, status: "unsupported", sourceIds: [] });
    }
    const unknowns = ["Audience overlap", "Partner interest", "Commercial feasibility"];
    if (seed.identity_status !== "verified" || partner.identity_status !== "verified") unknowns.unshift("Confirmed business identity");
    if (!hasRelationship) unknowns.unshift("Cultural relationship signal");
    if (hasRelationship && relationship.cacheStatus === "stale") unknowns.unshift("Cultural relationship source is older");
    unknowns.push(...brandResearchUnknowns(bridges, research, partnerActivity, capabilities));
    if (run.objective === "repositioning" && partnerActivity.length &&
        !claims.some((claim) => claim.id === "claim:positioning-direction")) {
      unknowns.push("Requested positioning direction was not established in partner cultural work");
    }
    if (contradictingSourceIds.length) unknowns.push("Conflicting business evidence needs review");
    const constraints = assessmentConstraints(run, partner.id, potentialConflicts);
    const frozen = await freezeEvidenceInput({ userId: run.user_id, seedEntityId: seed.id,
      partnerEntityId: partner.id, objective: run.objective, sourceRefs, claims, unknowns,
      qlooInputHashes, bridges, partnerActivity, capabilities, constraints }, client);
    const signals = classifySignals(frozen.evidence, run.objective, "brand_brand");
    const exclusions = classifyExclusions(frozen.evidence);
    const output = scoreAssessment({
      snapshotId: match.rows[0].id,
      snapshotHash: frozen.inputHash,
      scorerVersion: SCORING_VERSION,
      pairType: "brand_brand",
      objective: run.objective,
      brandId: seed.id,
      partnerId: partner.id,
      sourceIds: frozen.evidence.sources.map((source) => source.id),
      culturalConnection: signals.culturalConnection,
      contentRelevance: signals.contentRelevance,
      goalFit: signals.goalFit,
      qlooLineageVerified: true,
      identityVerified: seed.identity_status === "verified" && partner.identity_status === "verified",
      hardExclusion: exclusions.hardExclusion,
      hardExclusionEvidenceIds: exclusions.hardExclusionEvidenceIds,
      reviewFlags: [...new Set([...signals.reviewFlags,
        ...(contradictingSourceIds.length ? ["material_contradiction"] : [])])],
      confidence: signals.confidence,
    });
    const scoreJson = { ...output, mechanism: signals.mechanism,
      findings: { C: signals.culturalConnection.notes ?? null, R: signals.contentRelevance.notes ?? null,
        G: signals.goalFit.notes ?? null } };
    // Idempotent by content: identical frozen evidence reuses the existing snapshot;
    // changed evidence becomes the next immutable version. Historical rows stay intact.
    const existingAssessments = await client.query(`select id,version,input_hash,scoring_version,validity_status from public.assessment_snapshots
      where match_id=$1 order by version desc`, [match.rows[0].id]);
    if (assessmentNeedsAppend(existingAssessments.rows, frozen.inputHash, SCORING_VERSION)) {
      const version = (existingAssessments.rows[0]?.version ?? 0) + 1;
      await client.query(`insert into public.assessment_snapshots(user_id,match_id,version,objective,
        input_hash,scoring_version,evidence_json,score_json,source_refs_json,qloo_response_ids)
        values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::uuid[]) returning id`,
      [run.user_id, match.rows[0].id, version, run.objective, frozen.inputHash, SCORING_VERSION,
        JSON.stringify(frozen.evidence), JSON.stringify(scoreJson), JSON.stringify(frozen.sourceRefsJson),
        frozen.qlooResponseIds]);
    }
    const scored = output.status === "eligible" || output.status === "conditional";
    const message = output.status === "eligible"
      ? `Evidence-based opportunity index: ${output.displayScore}/100. Review the findings and open questions before drafting a proposal.`
      : output.status === "conditional"
        ? `Evidence-based opportunity index: ${output.displayScore}/100. Open questions need review before this is execution-ready.`
        : output.status === "excluded"
          ? "This pair is excluded by a verified constraint."
          : "Not enough verified evidence for a score yet. Review what is still unknown below.";
    const providerRefs = [
        { provider: "qloo", operation: "qloo_rank",
          responseId: hasRelationship ? relationship.responseId : null,
          cacheStatus: relationship.cacheStatus, status: relationship.envelope?.status ?? "unavailable" },
        { provider: "qloo", operation: "qloo_entity_tags", side: "seed",
          responseId: seedTags.responseId ?? null, cacheStatus: seedTags.cacheStatus ?? "unavailable",
          status: seedTags.status ?? "unavailable" },
        { provider: "qloo", operation: "qloo_entity_tags", side: "partner",
          responseId: partnerTags.responseId ?? null, cacheStatus: partnerTags.cacheStatus ?? "unavailable",
          status: partnerTags.status ?? "unavailable" },
        ...(research ? [{ provider: "web", operation: "search",
          territories: (research.territoryResults ?? []).length,
          capabilities: (research.capabilityResults ?? []).length }] : []),
      ];
    if (finalizeRun) {
      await client.query(`update public.analysis_runs set status=$2,stage='Complete',
        provider_refs_json=$3::jsonb,result_json=$4::jsonb,finished_at=now(),lease_until=null,worker_id=null,updated_at=now()
        where id=$1`, [run.id, scored ? "completed" : "partial", JSON.stringify(providerRefs),
        JSON.stringify({ sample: false, count: 1, researchType: "brand_pair", scoringVersion: SCORING_VERSION,
          scoreStatus: output.status, displayScore: output.displayScore, bridgeCount: bridges.length,
          researchCoverage, message })]);
    }
    await client.query("commit");
    return finalizeRun ? true : { matchId: match.rows[0].id, scoreStatus: output.status,
      displayScore: output.displayScore, confidence: output.confidence, bridgeCount: bridges.length,
      researchCoverage, providerRefs };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
