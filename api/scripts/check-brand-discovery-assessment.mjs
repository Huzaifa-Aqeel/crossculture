// Synthetic local fixture for the discovery lead → verified identity → v4 path.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun, orderBrandDiscoveryMatches,
  recordPersonalFeedback } from "../src/personal-research.mjs";
import { ensureVerifiedDiscoveredBrand, processPersonalBrandDiscoveryRun, screenBrandLeads } from "../src/personal-brand-discovery.mjs";
import { processPersonalBrandRun } from "../src/personal-brand.mjs";

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
const suffix = randomUUID().slice(0, 8);
const testQid = `Q${100000000 + Number.parseInt(suffix, 16)}`;
const conflictQid = `Q${200000000 + Number.parseInt(suffix, 16)}`;
const ordered = orderBrandDiscoveryMatches([
  { partnerEntityId: "c", evidenceStatus: "valid", score: { status: "conditional", displayScore: 90, confidence: "high" } },
  { partnerEntityId: "d", evidenceStatus: "valid", score: { status: "eligible", displayScore: 70, confidence: "medium" } },
  { partnerEntityId: "b", evidenceStatus: "valid", score: { status: "eligible", displayScore: 70, confidence: "high" } },
  { partnerEntityId: "a", evidenceStatus: "valid", score: { status: "insufficient_evidence", displayScore: null } },
  { partnerEntityId: "e", evidenceStatus: "stale", score: { status: "eligible", displayScore: 100, confidence: "high" } },
]);
assert.deepEqual(ordered.map((item) => item.partnerEntityId), ["b", "d", "c", "a", "e"]);
const seedQlooId = randomUUID();
const leadQlooId = randomUUID();
const ambiguousQlooId = randomUUID();
let userId;
let seedId;
let partnerId;
let officialOnlyId;
try {
  const email = `crossculture-discovery-assessment-${suffix}@example.test`;
  const password = `LocalCheck-${randomUUID()}!`;
  const signup = await anon.auth.signUp({ email, password });
  assert.ifError(signup.error);
  userId = signup.data.user.id;
  assert.ifError((await admin.auth.admin.updateUserById(userId, { email_confirm: true })).error);
  assert.ifError((await anon.auth.signInWithPassword({ email, password })).error);
  seedId = (await db.query(`insert into catalog.entities(kind,canonical_name,identity_status)
    values('brand',$1,'verified') returning id`, [`SAMPLE US seed ${suffix}`])).rows[0].id;
  await db.query(`insert into catalog.entity_identifiers(entity_id,provider,external_id,status)
    values($1,'qloo',$2,'confirmed')`, [seedId, seedQlooId]);
  const project = await createProject(userId, { seedEntityId: seedId,
    name: "SAMPLE US collaborator assessment", objective: "content_collaboration" });
  const started = await startPersonalRun(userId, { projectId: project.id, mode: "discovery",
    partnerType: "brand", researchMode: "live_brand", idempotencyKey: randomUUID() });
  const run = await claimPersonalRun("brand-discovery-assessment-fixture");
  assert.equal(run.id, started.runId);
  run.plan_json.maxProviderCalls = 100;
  const leads = [
    ...Array.from({ length: 5 }, (_, index) => ({ entity_id: randomUUID(),
      name: `SAMPLE US unresolved ${index} ${suffix}`,
      properties: { short_description: "Synthetic unresolved identity" } })),
    { entity_id: leadQlooId, name: `SAMPLE US partner ${suffix}`,
      properties: { short_description: "Synthetic partner" } },
    { entity_id: ambiguousQlooId, name: `SAMPLE US ambiguous ${suffix}`,
      properties: { website: `https://other-${suffix}.example` } },
  ];
  const noTags = async () => ({ status: "unavailable", responseId: null, tags: [], sampleData: false });
  const optionsForRun = {
    recommend: async () => ({ envelope: { status: "ok", results: leads },
      responseId: null, cacheStatus: "synthetic", sampleData: false }),
    screen: (items) => screenBrandLeads(items, {
      search: async (name) => name.includes("unresolved") ? [] :
        [{ id: name.includes("ambiguous") ? conflictQid : testQid, name }],
      detail: async (item) => ({ ...item,
        website: item.id === testQid ? `https://www.sample-${suffix}.example` : `https://conflict-${suffix}.example`,
        wikidataUrl: `https://www.wikidata.org/wiki/${item.id}` }),
    }),
    tags: noTags,
    verifyOfficial: async () => null,
    discoverOfficial: async () => null,
    describe: async (_owner, context) => ({ status: "ok", results: [{ entity_id: leadQlooId,
      name: context.entity, properties: { website: `https://sample-${suffix}.example` } }] }),
    assess: (researchRun, workerId, config) => processPersonalBrandRun(researchRun, workerId, {
      ...config, tags: noTags,
      rank: async () => ({ envelope: { status: "unavailable" }, responseId: null,
        cacheStatus: "unavailable" }),
    }),
  };
  assert.equal(await processPersonalBrandDiscoveryRun(run, "brand-discovery-assessment-fixture", optionsForRun), true);
  const finished = await getPersonalRun(userId, started.runId);
  assert.equal(finished.status, "partial");
  assert.equal(finished.result.assessedCount, 1);
  assert.equal(finished.result.screenedCount, 7,
    "A verified sixth lead is screened after five unresolved identities within the run budget");
  assert.equal(finished.matches.length, 1);
  assert.equal(finished.matches[0].score.status, "insufficient_evidence");
  assert.equal(finished.matches[0].scoringVersion, "4.0.1");
  assert.equal(finished.result.candidates[5].matchId, finished.matches[0].id);
  assert.equal(finished.result.candidates[5].businessStatus, "corroborated");
  assert.equal(finished.result.candidates[5].researchStatus, "research_incomplete");
  assert.equal(finished.result.candidates[6].businessStatus, "conflicting");
  assert.equal(finished.result.candidates[6].matchId, undefined);
  assert.ok(finished.result.candidates.slice(0, 5).every((item) => item.businessStatus === "not_found"));
  assert.ok(finished.result.candidates.every((item) => !Object.hasOwn(item, "verifiedIdentity") &&
    !Object.hasOwn(item, "businessIdentity") &&
    !Object.hasOwn(item, "businessOptions") &&
    !Object.hasOwn(item, "qlooId")));
  partnerId = finished.matches[0].partnerEntityId;
  const verified = await db.query(`select e.identity_status,i.provider,i.external_id from catalog.entities e
    join catalog.entity_identifiers i on i.entity_id=e.id and i.status='confirmed'
    where e.id=$1 order by i.provider`, [partnerId]);
  assert.equal(verified.rows[0].identity_status, "verified");
  assert.deepEqual(verified.rows.map((row) => row.provider), ["qloo", "wikidata"]);
  assert.equal(verified.rows.find((row) => row.provider === "qloo").external_id, leadQlooId);
  assert.equal(verified.rows.find((row) => row.provider === "wikidata").external_id, testQid);
  const identity = { qlooId: leadQlooId, wikidataQid: testQid,
    website: `https://www.sample-${suffix}.example` };
  assert.equal(await ensureVerifiedDiscoveredBrand({ name: leads[5].name,
    qlooWebsite: `https://sample-${suffix}.example` }, identity), partnerId);
  assert.equal(await ensureVerifiedDiscoveredBrand({ name: leads[5].name,
    qlooWebsite: `https://sample-${suffix}.example` }, { ...identity, wikidataQid: conflictQid }), null);
  const officialUrl = `https://official-only-${suffix}.example/products`;
  officialOnlyId = await ensureVerifiedDiscoveredBrand({ name: `SAMPLE US official-only ${suffix}`,
    qlooWebsite: null }, { qlooId: randomUUID(), wikidataQid: null,
    website: `https://official-only-${suffix}.example`, officialEvidence: {
      inspected: true, url: officialUrl, title: "SAMPLE official products",
      snippet: "SAMPLE official product category", sourceHash: "a".repeat(64),
    } });
  assert.ok(officialOnlyId);
  const officialIdentifiers = await db.query(`select provider from catalog.entity_identifiers
    where entity_id=$1 and status='confirmed'`, [officialOnlyId]);
  assert.deepEqual(officialIdentifiers.rows.map((row) => row.provider), ["qloo"]);
  const officialSource = await db.query(`select source_url from catalog.source_items
    where entity_id=$1 and source_type='business_identity'`, [officialOnlyId]);
  assert.equal(officialSource.rows[0].source_url, officialUrl);
  await recordPersonalFeedback(userId, { runId: started.runId,
    matchId: finished.matches[0].id, action: "reject" });
  const repeatedStart = await startPersonalRun(userId, { projectId: project.id, mode: "discovery",
    partnerType: "brand", researchMode: "live_brand", idempotencyKey: randomUUID() });
  const repeatedRun = await claimPersonalRun("brand-discovery-exclusion-fixture");
  assert.equal(repeatedRun.id, repeatedStart.runId);
  repeatedRun.plan_json.maxProviderCalls = 100;
  assert.equal(await processPersonalBrandDiscoveryRun(repeatedRun, "brand-discovery-exclusion-fixture", optionsForRun), true);
  const repeatedMatch = (await getPersonalRun(userId, repeatedStart.runId)).matches[0];
  assert.equal(repeatedMatch.score.status, "excluded");
  assert.equal(repeatedMatch.evidence.constraints[0].kind, "user");
  console.log("SAMPLE US discovery assessment passed: corroborated lead became one v4 match; conflicting identity stayed unassessed.");
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  for (const id of [seedId, partnerId, officialOnlyId].filter(Boolean)) {
    await db.query("delete from catalog.source_items where entity_id=$1", [id]);
    await db.query("delete from catalog.entity_identifiers where entity_id=$1", [id]);
    await db.query("delete from catalog.entities where id=$1", [id]);
  }
  await db.end();
}
