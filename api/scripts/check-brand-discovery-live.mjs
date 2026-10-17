// Bounded local end-to-end discovery check with one real US brand and Qloo.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { closeQloo } from "../src/qloo.mjs";
import { personalQlooDescribe, personalQlooRecommendBrands } from "../src/personal-qloo.mjs";
import { searchWikidataBrands, selectedWikidataBrand } from "../src/brand-resolution.mjs";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun } from "../src/personal-research.mjs";
import { processPersonalBrandDiscoveryRun } from "../src/personal-brand-discovery.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) {
  throw new Error("Local Supabase only.");
}
process.env.DATABASE_URL = vars.DB_URL;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const anon = createClient(vars.API_URL, vars.ANON_KEY, options);
const db = new pg.Pool({ connectionString: vars.DB_URL });
let userId;
let seedId;
let createdSeed = false;
const seedName = process.argv[2] ?? "Patagonia";
const diagnosticTarget = process.argv[3] ?? null;
const objective = process.env.BRAND_DISCOVERY_OBJECTIVE ?? "content_collaboration";
const positioningDirection = process.env.BRAND_POSITIONING_DIRECTION?.trim();
if (!["content_collaboration", "co_created_product", "repositioning"].includes(objective)) {
  throw new Error("Use a supported new Brand × Brand objective.");
}
if (objective === "repositioning" && !positioningDirection) {
  throw new Error("Set BRAND_POSITIONING_DIRECTION for a repositioning check.");
}
const seedQid = { Patagonia: "Q1660552", "The North Face": "Q124965868" }[seedName];
if (!seedQid) throw new Error("Use a reviewed US seed: Patagonia or The North Face.");
async function retryOnce(work) {
  try { return await work(); }
  catch { return work(); }
}
try {
  const suffix = randomUUID().slice(0, 8);
  const signup = await anon.auth.signUp({ email: `crossculture-discovery-${suffix}@example.test`,
    password: `LocalCheck-${randomUUID()}!` });
  assert.ifError(signup.error);
  userId = signup.data.user.id;
  assert.ifError((await admin.auth.admin.updateUserById(userId, { email_confirm: true })).error);
  const described = await personalQlooDescribe(userId, { entity: seedName, type: "brand" });
  const exact = described.results?.find((item) => item?.name === seedName);
  assert.ok(described.status === "ok" && exact?.entity_id);
  const business = (await retryOnce(() => searchWikidataBrands(seedName))).find((item) => item.id === seedQid);
  assert.ok(business);
  const detailed = await retryOnce(() => selectedWikidataBrand(business));
  assert.ok(detailed.website);
  const existingSeed = await db.query("select id,canonical_name,identity_status from catalog.entities where canonical_url=$1", [detailed.website]);
  if (existingSeed.rows[0]) {
    assert.equal(existingSeed.rows[0].canonical_name, seedName);
    assert.equal(existingSeed.rows[0].identity_status, "verified");
    seedId = existingSeed.rows[0].id;
    const identifiers = await db.query(`select provider,external_id from catalog.entity_identifiers
      where entity_id=$1 and status='confirmed'`, [seedId]);
    assert.ok(identifiers.rows.every((row) => row.external_id ===
      (row.provider === "qloo" ? exact.entity_id : row.provider === "wikidata" ? seedQid : row.external_id)));
    for (const [provider, externalId] of [["qloo", exact.entity_id], ["wikidata", seedQid]]) {
      if (!identifiers.rows.some((row) => row.provider === provider)) {
        await db.query(`insert into catalog.entity_identifiers(entity_id,provider,external_id,status)
          values($1,$2,$3,'confirmed')`, [seedId, provider, externalId]);
      }
    }
  } else {
    seedId = (await db.query(`insert into catalog.entities(kind,canonical_name,canonical_url,official_website,identity_status)
      values('brand',$1,$2,$2,'verified') returning id`, [seedName, detailed.website])).rows[0].id;
    createdSeed = true;
    await db.query(`insert into catalog.entity_identifiers(entity_id,provider,external_id,status)
      values($1,'qloo',$2,'confirmed'),($1,'wikidata',$3,'confirmed')`, [seedId, exact.entity_id, seedQid]);
  }
  const project = await createProject(userId, { seedEntityId: seedId,
    name: "US brand collaborator discovery", objective });
  const input = { projectId: project.id, mode: "discovery", partnerType: "brand",
    researchMode: "live_brand", idempotencyKey: randomUUID(),
    ...(objective === "repositioning" ? { positioningDirection } : {}) };
  const started = await startPersonalRun(userId, input);
  assert.equal((await startPersonalRun(userId, input)).reused, true);
  const run = await claimPersonalRun("brand-discovery-live-worker");
  assert.equal(run.id, started.runId);
  const discoveryOptions = diagnosticTarget ? { recommend: async (owner, id) => {
    const actual = await personalQlooRecommendBrands(owner, id);
    return { ...actual, envelope: { ...actual.envelope,
      results: actual.envelope.results.filter((item) => item.name === diagnosticTarget) } };
  } } : undefined;
  assert.equal(await processPersonalBrandDiscoveryRun(run, "brand-discovery-live-worker", discoveryOptions), true);
  const finished = await getPersonalRun(userId, started.runId);
  assert.ok(["partial", "completed"].includes(finished.status));
  assert.equal(finished.result.sample, false);
  assert.ok(finished.result.candidates.length > 0 && finished.result.candidates.length <= 8);
  assert.ok(finished.matches.length <= 3);
  assert.equal(finished.result.assessedCount, finished.matches.length);
  assert.ok(finished.matches.every((match) => match.scoringVersion === "4.0.1" &&
    ["eligible", "conditional", "insufficient_evidence", "excluded"].includes(match.score.status)));
  assert.ok(finished.result.candidates.every((item) => item.name && !Object.hasOwn(item, "qlooId")));
  assert.ok(finished.result.candidates.every((item) => Array.isArray(item.culturalSignals) &&
    typeof item.businessStatus === "string" && !Object.hasOwn(item, "qlooWebsite")));
  console.log(`${diagnosticTarget ? `TARGETED LIVE US ${seedName} → ${diagnosticTarget}` : `LIVE US ${seedName}`} ${objective}${positioningDirection ? ` (${positioningDirection})` : ""} funnel: ${finished.result.candidates.length} Qloo leads → ` +
    `${finished.result.screenedCount} screened → ` +
    `${finished.result.candidates.filter((item) => item.businessStatus === "corroborated").length} identity-verified → ` +
    `${finished.matches.length} researched → ` +
    `${finished.matches.filter((item) => item.evidence?.bridges?.length).length} Qloo-bridge-supported → ` +
    `${finished.matches.filter((item) => item.score?.status === "eligible").length} eligible / ` +
    `${finished.matches.filter((item) => item.score?.status === "conditional").length} conditional / ` +
    `${finished.matches.filter((item) => item.score?.status === "insufficient_evidence").length} insufficient.`);
  console.log(`Candidate outcomes: ${finished.result.candidates
    .map((item) => `${item.name}: ${item.businessStatus}${item.researchStatus ? `/${item.researchStatus}` : ""}`).join("; ")}`);
  console.log(`Assessment details: ${finished.matches.map((item) =>
    `${item.partnerName}: ${item.score?.status}, ${item.score?.displayScore ?? "no score"}, ` +
    `C=${item.score?.ratings?.C ?? "null"} R=${item.score?.ratings?.R ?? "null"} G=${item.score?.ratings?.G ?? "null"}; ` +
    `bridges=${(item.evidence?.bridges ?? []).map((bridge) => bridge.name).join("|")}; ` +
    `activity=${item.evidence?.partnerActivity?.length ?? 0}; capabilities=${JSON.stringify(item.evidence?.capabilities ?? [])}; ` +
    `unknowns=${(item.evidence?.unknowns ?? []).join("|")}`).join("; ")}`);
  // Capture the saved snapshot before the diagnostic user is removed. This is
  // bounded, structured provenance; never print provider payloads or credentials.
  const frozenRows = await db.query(`select m.id as match_id,e.canonical_name as partner_name,
      a.id as assessment_id,a.input_hash,a.scoring_version,a.validity_status,
      a.source_refs_json,a.qloo_response_ids,a.evidence_json,a.score_json
    from public.matches m join catalog.entities e on e.id=m.partner_entity_id
    join lateral (select * from public.assessment_snapshots a where a.match_id=m.id
      order by a.version desc limit 1) a on true
    where m.analysis_run_id=$1 and m.user_id=$2 order by e.canonical_name`, [started.runId, userId]);
  assert.equal(frozenRows.rows.length, finished.matches.length);
  const lineage = frozenRows.rows.map((row) => {
    const evidence = row.evidence_json;
    assert.equal(evidence.contractVersion, 2);
    assert.equal(row.scoring_version, "4.0.1");
    return { partner: row.partner_name, matchId: row.match_id, assessmentId: row.assessment_id,
      inputHash: row.input_hash, validity: row.validity_status,
      sourceRefs: row.source_refs_json, qlooResponseIds: row.qloo_response_ids,
      sources: evidence.sources.map((source) => ({ id: source.id, kind: source.kind,
        title: source.title, excerpt: source.excerpt, sourceUrl: source.sourceUrl,
        observedAt: source.observedAt, collectedAt: source.collectedAt,
        freshness: source.freshness, sourceRef: source.sourceRef })),
      claims: evidence.claims, bridges: evidence.bridges,
      partnerActivity: evidence.partnerActivity, capabilities: evidence.capabilities,
      unknowns: evidence.unknowns, score: row.score_json };
  });
  console.log(`Frozen lineage: ${JSON.stringify(lineage)}`);
} finally {
  await closeQloo().catch(() => {});
  if (userId) {
    await db.query("delete from private.qloo_responses where owner_user_id=$1", [userId]).catch(() => {});
    await admin.auth.admin.deleteUser(userId);
  }
  if (seedId && createdSeed) {
    await db.query("delete from catalog.source_items where entity_id=$1", [seedId]);
    await db.query("delete from catalog.entity_identifiers where entity_id=$1", [seedId]);
    await db.query("delete from catalog.entities where id=$1", [seedId]);
  }
  await db.end();
}
