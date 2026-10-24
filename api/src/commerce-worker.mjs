import { createHash } from "node:crypto";
import pg from "pg";
import { persistSelectedBrand } from "./catalog.mjs";
import { durableCommerceDecision } from "./brand-commerce.mjs";
import { researchNativeCommerce } from "./commerce-native.mjs";
import { researchContextCommerce } from "./commerce-context.mjs";

let pool;
const db = () => pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function groupedItems(result) {
  const output = [];
  for (const status of ["supported", "needs_verification", "unsupported"]) {
    for (const group of result.opportunities?.[status] ?? []) {
      for (const item of [group.best, ...group.otherOpportunities]) output.push(item);
    }
  }
  return output;
}

export async function processCommerceRun(run, workerId, { research = researchNativeCommerce,
  researchContext = researchContextCommerce,
  persistBrand = persistSelectedBrand } = {}) {
  const seed = await db().query(`select e.id,e.identity_status as "identityStatus",
    e.facts_json->>'commerceIdentitySourceUrl' as "identitySourceUrl",
    e.canonical_name as name,e.description,
    coalesce(e.official_website,e.canonical_url) as website,i.external_id as "qlooId"
    from catalog.entities e left join catalog.entity_identifiers i on i.entity_id=e.id
      and i.provider='qloo' and i.status='confirmed'
    where e.id=$1 and e.kind='brand' limit 1`, [run.seed_entity_id]);
  if (!seed.rows[0] || seed.rows[0].identityStatus !== "verified")
    throw new Error("Starting brand has no verified business identity.");
  const contextSeed = !seed.rows[0].qlooId;
  if (contextSeed && (process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED !== "1" ||
      run.kind !== "discovery" || !run.constraints_json?.commerceRequirements?.heroProduct))
    throw new Error("Product-context discovery requires a selected product and an enabled verified path.");
  let partner = null;
  if (run.kind === "direct_pair") {
    const selected = await db().query(`select e.canonical_name as name,e.description,
      coalesce(e.official_website,e.canonical_url) as website,i.external_id as "qlooId"
      from catalog.entities e join catalog.entity_identifiers i on i.entity_id=e.id
        and i.provider='qloo' and i.status='confirmed'
      where e.id=$1 and e.kind='brand' limit 1`, [run.specified_partner_id]);
    if (!selected.rows[0]?.qlooId) throw new Error("Selected partner has no confirmed cultural identity.");
    partner = { qlooId: selected.rows[0].qlooId, name: selected.rows[0].name,
      officialWebsite: selected.rows[0].website, description: selected.rows[0].description };
  }
  const request = { ownerUserId: run.user_id,
    seed: { id: seed.rows[0].id, name: seed.rows[0].name,
      identityStatus: seed.rows[0].identityStatus, officialWebsite: seed.rows[0].website,
      description: seed.rows[0].description, qlooId: seed.rows[0].qlooId,
      identitySourceUrl: seed.rows[0].identitySourceUrl },
    seedQlooId: seed.rows[0].qlooId, objective: run.objective,
    specifiedPartner: partner, market: run.constraints_json?.market ?? "US",
    userConstraints: run.constraints_json?.commerceRequirements ?? {},
    maxCatalogCalls: run.plan_json?.maxCatalogCalls ?? (partner ? 56 :
      run.constraints_json?.commerceRequirements?.heroProduct ? 160 : 88) };
  const result = await (contextSeed ? researchContext(request) : research(request));
  const foundDecisions = groupedItems(result);
  if (!foundDecisions.length && result.stopReason === "catalog_rate_limited") {
    throw Object.assign(new Error("Catalog temporarily rate limited."),
      { code: "catalog_rate_limited" });
  }
  const decisions = [];
  const connection = await db().connect();
  try {
    await connection.query("begin");
    const lock = await connection.query(`select status,worker_id from public.analysis_runs where id=$1 for update`, [run.id]);
    if (lock.rows[0]?.status !== "running" || lock.rows[0]?.worker_id !== workerId) {
      await connection.query("rollback"); return false;
    }
    for (const item of foundDecisions) {
      const partnerEntity = await persistBrand({ qloo: { id: item.partnerId,
        name: item.partnerName, website: item.partnerWebsite,
        description: null }, identityStatus: "verified" });
      const opportunityKey = digest([run.objective, item.seedProductId, item.seedVariantId,
        item.references?.seed?.sellerId, item.partnerProductId, item.partnerVariantId,
        item.references?.partner?.sellerId]);
      const match = await connection.query(`insert into public.matches
        (user_id,analysis_run_id,brand_entity_id,partner_entity_id,opportunity_key)
        values ($1,$2,$3,$4,$5)
        on conflict (analysis_run_id,partner_entity_id,opportunity_key)
          where opportunity_key is not null do update set updated_at=now()
        returning id`, [run.user_id, run.id, run.seed_entity_id, partnerEntity.id, opportunityKey]);
      const decision = durableCommerceDecision(item, {
        qlooResponseIds: [...(result.qlooResponseId ? [result.qlooResponseId] : []),
          ...(result.qlooResponseIds ?? []),
          ...(item.qlooEvidenceIds ?? [])],
        identitySourceRefs: [...new Set([item.seedIdentitySourceUrl,
          item.identitySourceUrl].filter(Boolean))],
        culturalSourceRefs: item.culturalSourceUrls ?? [],
        externalSourceRefs: item.externalSourceUrls ?? [],
        externalFindings: item.externalFindings ?? [],
        market: run.constraints_json?.market ?? "US" });
      const prior = await connection.query(`select coalesce(max(version),0)::integer as version
        from public.assessment_snapshots where match_id=$1`, [match.rows[0].id]);
      const version = prior.rows[0].version + 1;
      await connection.query(`insert into public.assessment_snapshots
        (user_id,match_id,version,objective,input_hash,scoring_version,
         evidence_json,score_json,source_refs_json,qloo_response_ids)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::uuid[])`,
      [run.user_id, match.rows[0].id, version, run.objective, digest(decision),
        decision.policyVersion, JSON.stringify({ commerce: decision,
          sample: false, claims: [], sources: [], unknowns: item.assessment.materialUnknowns }),
        JSON.stringify(item.assessment), JSON.stringify([
          ...decision.identitySourceRefs, ...decision.culturalSourceRefs,
          ...decision.externalSourceRefs]),
        decision.qlooResponseIds]);
      decisions.push({ matchId: match.rows[0].id, partnerName: item.partnerName,
        status: item.assessment.status, policyVersion: decision.policyVersion,
        rank: decisions.length + 1 });
    }
    await connection.query(`update public.analysis_runs set status=$3,stage='Complete',
      result_json=$4::jsonb,finished_at=now(),lease_until=null,worker_id=null,updated_at=now()
      where id=$1 and worker_id=$2`, [run.id, workerId,
      ["catalog_rate_limited", "research_time_limit_reached"].includes(result.stopReason) ||
        !decisions.length ? "partial" : "completed",
      JSON.stringify({ sample: false, commerce: true, policyVersion: "brand-commerce-v1.1",
        discoveryBasis: result.discoveryBasis, coverage: result.coverage,
        ...(result.contextStages ? { contextStages: result.contextStages } : {}),
        stopReason: result.stopReason, discoveryReturnedCount: result.discoveryReturnedCount,
        catalogCallsUsed: result.catalogCallsUsed,
        candidates: result.candidates, decisions,
        message: result.stopReason === "catalog_rate_limited"
          ? "Product research was interrupted. The assessed opportunities are partial."
          : result.stopReason === "research_time_limit_reached"
            ? "Product research reached its time limit. Reviewed opportunities are partial."
          : decisions.length ? "Product opportunities assessed. Refresh offers before use."
            : "No verified product opportunity was found within this research budget." })]);
    await connection.query("commit");
    return true;
  } catch (error) { await connection.query("rollback"); throw error; }
  finally { connection.release(); }
}
