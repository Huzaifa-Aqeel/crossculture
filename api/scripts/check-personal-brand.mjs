import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun, createPersonalProposal } from "../src/personal-research.mjs";
import { brandResearchUnknowns, processPersonalBrandRun } from "../src/personal-brand.mjs";
import { personalQlooDescribe, personalQlooRank } from "../src/personal-qloo.mjs";
import { qlooCacheIdentity, readQlooCache } from "../src/qloo-cache.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
process.env.DATABASE_URL = vars.DB_URL;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const alice = createClient(vars.API_URL, vars.ANON_KEY, options);
const bob = createClient(vars.API_URL, vars.ANON_KEY, options);
const db = new pg.Pool({ connectionString: vars.DB_URL });
const users = [];
const suffix = randomUUID().slice(0, 8);
const password = `LocalCheck-${randomUUID()}!`;
const qlooIds = [`sample-us-seed-${suffix}`, `sample-us-partner-${suffix}`];
const tagsUnavailable = async () => ({ tags: [], responseId: null, inputHash: null,
  cacheStatus: "unavailable", sampleData: false, status: "unavailable" });
const broad = [{ specificity: "broad" }];
assert.deepEqual(brandResearchUnknowns(broad, null, [], []),
  ["Specific named cultural connection", "Partner business research was not completed"]);
assert.deepEqual(brandResearchUnknowns(broad, { territoryResults: [], capabilityResults: [] }, [],
  [{ status: "unsupported" }]),
  ["Specific named cultural connection", "Partner activity was not established in retrieved sources",
    "Goal capability was not established in retrieved sources"]);
assert.deepEqual(brandResearchUnknowns([], null, [], []), ["Shared cultural territory"]);
let seedId;
let partnerId;
try {
  for (const [client, label] of [[alice, "a"], [bob, "b"]]) {
    const email = `crossculture-brand-${label}-${suffix}@example.test`;
    const signup = await client.auth.signUp({ email, password });
    assert.ifError(signup.error);
    users.push(signup.data.user.id);
    assert.ifError((await admin.auth.admin.updateUserById(signup.data.user.id, { email_confirm: true })).error);
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  }
  seedId = (await db.query("insert into catalog.entities(kind,canonical_name,identity_status) values('brand',$1,'verified') returning id", [`SAMPLE US brand ${suffix}`])).rows[0].id;
  partnerId = (await db.query("insert into catalog.entities(kind,canonical_name,identity_status) values('brand',$1,'verified') returning id", [`SAMPLE US partner ${suffix}`])).rows[0].id;
  for (const [entityId, qlooId, qid] of [[seedId, qlooIds[0], "Q1"], [partnerId, qlooIds[1], "Q2"]]) {
    await db.query("insert into catalog.entity_identifiers(entity_id,provider,external_id,status) values($1,'qloo',$2,'confirmed'),($1,'wikidata',$3,'confirmed')", [entityId, qlooId, qid]);
  }
  const project = await createProject(users[0], { seedEntityId: seedId, name: "SAMPLE US brand research", objective: "content_collaboration" });
  const input = { projectId: project.id, mode: "direct_pair", partnerType: "brand", researchMode: "live_brand",
    partnerEntityId: partnerId, idempotencyKey: randomUUID() };
  assert.equal((await startPersonalRun(users[0], input)).reused, false);
  const start = await startPersonalRun(users[0], input);
  assert.equal(start.reused, true);
  await assert.rejects(startPersonalRun(users[0], { ...input, partnerEntityId: seedId }), /already been used/);
  await assert.rejects(startPersonalRun(users[1], { ...input, idempotencyKey: randomUUID() }), (error) => error.statusCode === 404);
  const run = await claimPersonalRun("brand-fixture-worker");
  assert.equal(run.id, start.runId);
  assert.equal(await processPersonalBrandRun(run, "brand-fixture-worker", {
    rank: async () => ({ envelope: { status: "unavailable" }, responseId: null, cacheStatus: "unavailable" }),
    tags: tagsUnavailable,
  }), true);
  const finished = await getPersonalRun(users[0], start.runId);
  assert.equal(finished.status, "partial");
  assert.equal(finished.result.researchCoverage, "cultural_bridge_missing");
  assert.equal(finished.matches.length, 1);
  const match = finished.matches[0];
  assert.equal(match.evidence.sample, false);
  assert.equal(match.evidence.contractVersion, 2);
  assert.equal(match.evidence.sources.length, 2);
  assert.equal(match.evidence.claims.length, 2);
  assert.deepEqual(match.evidence.unknowns.includes("Cultural relationship signal"), true);
  assert.deepEqual(match.evidence.unknowns.includes("Shared cultural territory"), true);
  assert.equal(match.evidence.unknowns.includes("Partner activity was not established in retrieved sources"), false);
  assert.equal(match.evidence.unknowns.includes("Goal capability was not established in retrieved sources"), false);
  assert.deepEqual(match.evidence.bridges, []);
  // v4 scorer output: honest insufficient evidence, no legacy two-score shape.
  assert.equal(match.scoringVersion, "4.0.1");
  assert.equal(match.score.status, "insufficient_evidence");
  assert.equal(match.score.opportunityScore, null);
  assert.equal(match.score.displayScore, null);
  assert.deepEqual(match.score.ratings, { C: null, R: null, G: null });
  assert.ok(match.score.reasonCodes.includes("no_qloo_supported_pair_bridge"));
  assert.ok(match.score.reasonCodes.includes("no_partner_activity_evidence"));
  assert.ok(match.score.reasonCodes.includes("capability_evidence_absent"));
  assert.equal(match.score.confidence, "low");
  // Scoring never creates concepts or briefs; proposal drafting is user-triggered.
  assert.equal(match.concept, null);
  assert.equal(match.briefId, null);
  const proposal = await createPersonalProposal(users[0], match.id);
  assert.equal(proposal.reused, false);
  assert.match(proposal.markdown, /## Partnership overview/);
  assert.doesNotMatch(proposal.markdown, /A cultural relationship signal makes this pair/);
  const again = await createPersonalProposal(users[0], match.id);
  assert.equal(again.reused, true);
  assert.equal(again.id, proposal.id);
  await assert.rejects(createPersonalProposal(users[1], match.id), (error) => error.statusCode === 404);
  const afterProposal = await getPersonalRun(users[0], start.runId);
  assert.match(afterProposal.matches[0].briefMarkdown, /## Partnership overview/);
  assert.equal(afterProposal.matches[0].concept.format, "Exploratory partnership discussion");
  assert.equal(await getPersonalRun(users[1], start.runId), null);
  const other = await bob.from("analysis_runs").select("id").eq("id", start.runId);
  assert.ifError(other.error); assert.equal(other.data.length, 0);
  const own = await alice.from("analysis_runs").select("id").eq("id", start.runId);
  assert.ifError(own.error); assert.equal(own.data.length, 1);
  let providerCalls = 0;
  const fakeProvider = async () => {
    providerCalls += 1;
    return { status: "ok", results: [{ entity_id: qlooIds[1], affinity: 0.61 }] };
  };
  const first = await personalQlooRank(users[0], qlooIds[0], qlooIds[1], { provider: fakeProvider });
  const second = await personalQlooRank(users[0], qlooIds[0], qlooIds[1], { provider: fakeProvider });
  assert.equal(providerCalls, 1);
  assert.equal(first.responseId, second.responseId);
  assert.equal(first.sampleData, true);
  assert.equal(second.sampleData, true);
  assert.equal(second.cacheStatus, "fresh");
  const otherIdentity = qlooCacheIdentity({ operation: "qloo_rank",
    context: { options: [qlooIds[1]], option_type: "brand", signals: [qlooIds[0]] }, ownerUserId: users[1] });
  assert.equal((await readQlooCache(otherIdentity)).status, "missing");
  let describeCalls = 0;
  const described = { status: "ok", results: [{ entity_id: qlooIds[0], name: "SAMPLE US brand" }] };
  const describeProvider = async () => { describeCalls += 1; return described; };
  assert.equal((await personalQlooDescribe(users[0], { entity: "SAMPLE US brand", type: "brand" }, { provider: describeProvider })).cacheStatus, "new");
  assert.equal((await personalQlooDescribe(users[0], { type: "brand", entity: "SAMPLE US brand" }, { provider: describeProvider })).cacheStatus, "fresh");
  assert.equal(describeCalls, 1);
  const next = await startPersonalRun(users[0], { ...input, idempotencyKey: randomUUID() });
  const claimed = await claimPersonalRun("brand-fixture-worker-2");
  assert.equal(claimed.id, next.runId);
  await processPersonalBrandRun(claimed, "brand-fixture-worker-2", { rank: async () => second, tags: tagsUnavailable });
  const sampleBlocked = await getPersonalRun(users[0], next.runId);
  assert.equal(sampleBlocked.matches[0].evidence.sources.filter((source) => source.kind === "qloo_response").length, 0);
  assert.equal(sampleBlocked.matches[0].scoringVersion, "4.0.1");
  assert.equal(sampleBlocked.matches[0].score.status, "insufficient_evidence");
  // The first match's snapshot is untouched: still one version with its original input hash.
  const firstMatchSnapshots = await db.query("select version,input_hash,scoring_version from public.assessment_snapshots where match_id=$1 order by version", [match.id]);
  assert.equal(firstMatchSnapshots.rows.length, 1);
  assert.equal(firstMatchSnapshots.rows[0].version, 1);
  assert.equal(firstMatchSnapshots.rows[0].scoring_version, "4.0.1");
  const excludedStart = await startPersonalRun(users[0], { ...input, idempotencyKey: randomUUID(),
    excludedPartnerEntityIds: [partnerId] });
  const excludedRun = await claimPersonalRun("brand-exclusion-fixture");
  assert.equal(excludedRun.id, excludedStart.runId);
  assert.equal(await processPersonalBrandRun(excludedRun, "brand-exclusion-fixture", {
    rank: async () => ({ envelope: { status: "unavailable" }, responseId: null }),
    tags: tagsUnavailable }), true);
  const excludedMatch = (await getPersonalRun(users[0], excludedStart.runId)).matches[0];
  assert.equal(excludedMatch.score.status, "excluded");
  assert.equal(excludedMatch.evidence.constraints[0].kind, "user");
  assert.equal(excludedMatch.evidence.constraints[0].blocking, true);
  console.log("SAMPLE US Brand × Brand run: confirmed identities, private cache, sample isolation, v4 honest insufficient-evidence scoring, separated proposal drafting and RLS passed. No provider call ran.");
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  if (seedId || partnerId) await db.query("delete from catalog.source_items where entity_id=any($1::uuid[])", [[seedId, partnerId].filter(Boolean)]);
  if (seedId || partnerId) await db.query("delete from catalog.entity_identifiers where entity_id=any($1::uuid[])", [[seedId, partnerId].filter(Boolean)]);
  if (seedId || partnerId) await db.query("delete from catalog.entities where id=any($1::uuid[])", [[seedId, partnerId].filter(Boolean)]);
  await db.end();
}
