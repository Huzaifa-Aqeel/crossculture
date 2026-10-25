import { createHash } from "node:crypto";
import pg from "pg";
import { persistSelectedBrand } from "./catalog.mjs";
import { durableCommerceDecision } from "./brand-commerce.mjs";
import { researchNativeCommerce } from "./commerce-native.mjs";
import { researchContextCommerce } from "./commerce-context.mjs";
import { memoryRowsFromRun, opportunityKeyFor, recordResearchMemory } from "./research-memory.mjs";

let pool;
const db = () => pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// A run that cannot succeed on retry fails at once instead of repeating research.
const permanent = (message) => Object.assign(new Error(message), { retryable: false });
const SEED_ENTRY_FAILURES = new Set(["seed_identity_unverified", "seed_storefront_unverified"]);

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
  persistBrand = persistSelectedBrand, recordMemory = recordResearchMemory } = {}) {
  const seed = await db().query(`select e.id,e.identity_status as "identityStatus",
    e.facts_json->>'commerceIdentitySourceUrl' as "identitySourceUrl",
    e.facts_json->>'commerceStorefrontProofUrl' as "storefrontProofUrl",
    e.facts_json->>'commerceOfficialWebsite' as "proofOfficialWebsite",
    e.facts_json->>'commerceShopId' as "verifiedShopId",
    e.facts_json->>'commerceQlooId' as "proofQlooId",
    e.facts_json->>'commerceConfirmedAt' as "identityVerifiedAt",
    e.canonical_name as name,e.description,
    coalesce(e.official_website,e.canonical_url) as website,i.external_id as "qlooId"
    from catalog.entities e left join catalog.entity_identifiers i on i.entity_id=e.id
      and i.provider='qloo' and i.status='confirmed'
    where e.id=$1 and e.kind='brand' limit 1`, [run.seed_entity_id]);
  if (!seed.rows[0] || seed.rows[0].identityStatus !== "verified")
    throw permanent("Starting brand has no verified business identity.");
  const contextSeed = !seed.rows[0].qlooId;
  if (contextSeed && (process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED !== "1" ||
      run.kind !== "discovery" || !run.constraints_json?.commerceRequirements?.heroProduct))
    throw permanent("Product-context discovery requires a selected product and an enabled verified path.");
  if (!run.constraints_json?.commerceRequirements?.heroProduct) {
    throw permanent("Research requires a chosen starting product.");
  }
  let partner = null;
  if (run.kind === "direct_pair") {
    const selected = await db().query(`select e.id,e.canonical_name as name,e.description,
      e.identity_status as "identityStatus",
      coalesce(e.official_website,e.canonical_url) as website,i.external_id as "qlooId",
      e.facts_json->>'commerceIdentitySourceUrl' as "identitySourceUrl",
      e.facts_json->>'commerceStorefrontProofUrl' as "storefrontProofUrl",
      e.facts_json->>'commerceOfficialWebsite' as "proofOfficialWebsite",
      e.facts_json->>'commerceShopId' as "verifiedShopId",
      e.facts_json->>'commerceQlooId' as "proofQlooId",
      e.facts_json->>'commerceConfirmedAt' as "identityVerifiedAt"
      from catalog.entities e join catalog.entity_identifiers i on i.entity_id=e.id
        and i.provider='qloo' and i.status='confirmed'
      where e.id=$1 and e.kind='brand' limit 1`, [run.specified_partner_id]);
    if (!selected.rows[0]?.qlooId) throw permanent("Selected partner has no confirmed cultural identity.");
    const row = selected.rows[0];
    partner = { qlooId: row.qlooId, name: row.name, officialWebsite: row.website,
      description: row.description, entityId: row.id, identityStatus: row.identityStatus,
      identitySourceUrl: row.identitySourceUrl, storefrontProofUrl: row.storefrontProofUrl,
      proofOfficialWebsite: row.proofOfficialWebsite, verifiedShopId: row.verifiedShopId,
      proofQlooId: row.proofQlooId, identityVerifiedAt: row.identityVerifiedAt };
  }
  const request = { ownerUserId: run.user_id,
    seed: { id: seed.rows[0].id, name: seed.rows[0].name,
      identityStatus: seed.rows[0].identityStatus, officialWebsite: seed.rows[0].website,
      description: seed.rows[0].description, qlooId: seed.rows[0].qlooId,
      identitySourceUrl: seed.rows[0].identitySourceUrl,
      storefrontProofUrl: seed.rows[0].storefrontProofUrl,
      proofOfficialWebsite: seed.rows[0].proofOfficialWebsite,
      verifiedShopId: seed.rows[0].verifiedShopId,
      proofQlooId: seed.rows[0].proofQlooId,
      identityVerifiedAt: seed.rows[0].identityVerifiedAt },
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
  // Starting-brand checks depend on live public sites and can fail briefly.
  // Retry before recording an empty partial run; the final attempt is kept.
  if (!foundDecisions.length && SEED_ENTRY_FAILURES.has(result.coverage) && (run.attempt ?? 3) < 3) {
    throw Object.assign(new Error("Starting brand check temporarily unavailable."),
      { code: "seed_identity_unavailable" });
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
        description: item.partnerDescription ?? null }, identityStatus: "verified" });
      const opportunityKey = opportunityKeyFor(run.objective, item.references);
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
      result.coverage === "no_partner_product_fit" ? "completed"
        : ["catalog_rate_limited", "research_time_limit_reached"].includes(result.stopReason) ||
        !decisions.length ? "partial" : "completed",
      JSON.stringify({ sample: false, commerce: true, policyVersion: "brand-commerce-v1.1",
        discoveryBasis: result.discoveryBasis, coverage: result.coverage,
        ...(result.contextStages ? { contextStages: result.contextStages } : {}),
        ...(result.seedIdentityDiagnostics?.length
          ? { seedIdentityDiagnostics: result.seedIdentityDiagnostics } : {}),
        stopReason: result.stopReason, discoveryReturnedCount: result.discoveryReturnedCount,
        catalogCallsUsed: result.catalogCallsUsed,
        candidates: result.candidates?.map(({ memory, ...candidate }) => candidate), decisions,
        message: result.coverage === "no_partner_product_fit"
          ? "None of the culturally related brands sell products that add value to this product for your goal."
          : result.stopReason === "catalog_rate_limited"
          ? "Product research was interrupted. The assessed opportunities are partial."
          : result.stopReason === "research_time_limit_reached"
            ? "Product research reached its time limit. Reviewed opportunities are partial."
          : decisions.length ? "Product opportunities assessed. Refresh offers before use."
            : "No verified product opportunity was found within this research budget." })]);
    await connection.query("commit");
  } catch (error) { await connection.query("rollback"); throw error; }
  finally { connection.release(); }
  // Research memory is a later-run hint; failing to record it never fails the run.
  if (!contextSeed) {
    await recordMemory(memoryRowsFromRun({ objective: run.objective,
      market: request.market, candidates: result.candidates }))
      .catch((error) => console.error("Research memory not recorded:", error.message));
  }
  return true;
}
