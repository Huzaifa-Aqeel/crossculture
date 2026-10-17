// LIVE end-to-end Brand × Brand v4 scoring check.
// Real Qloo calls (bounded: describe x2, rank x1, entity_tags x2; the repeat run uses cache),
// real local Supabase. US brands only. Skips cleanly without a Qloo credential.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

for (const line of (await readFile(new URL("../../.env.local", import.meta.url), "utf8")).trim().split(/\r?\n/)) {
  const equal = line.indexOf("=");
  if (equal < 1 || line.startsWith("#")) continue;
  const key = line.slice(0, equal);
  if (key.startsWith("QLOO_") && !process.env[key]) process.env[key] = line.slice(equal + 1).replace(/^"|"$/g, "");
}
if (!process.env.QLOO_API_KEY) {
  console.log("LIVE Brand × Brand check skipped: QLOO_API_KEY is not configured.");
  process.exit(0);
}

const { createProject } = await import("../src/projects.mjs");
const { startPersonalRun, claimPersonalRun, getPersonalRun, createPersonalProposal } = await import("../src/personal-research.mjs");
const { processPersonalBrandRun } = await import("../src/personal-brand.mjs");
const { personalQlooDescribe, personalQlooEntityTags } = await import("../src/personal-qloo.mjs");
const { normalizeQlooBrands, searchWikidataBrands, selectedWikidataBrand, selectResolvedBrand } = await import("../src/brand-resolution.mjs");

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
process.env.DATABASE_URL = vars.DB_URL;
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
const anon = createClient(vars.API_URL, vars.ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
const db = new pg.Pool({ connectionString: vars.DB_URL });

const suffix = randomUUID().slice(0, 8);
const email = `crossculture-v4-live-${suffix}@example.test`;
let userId;
let seedId;
let partnerId;
try {
  const signup = await anon.auth.signUp({ email, password: `LocalCheck-${randomUUID()}!` });
  assert.ifError(signup.error);
  userId = signup.data.user.id;
  assert.ifError((await admin.auth.admin.updateUserById(userId, { email_confirm: true })).error);

  // Resolve both brands through the real cultural provider and confirm exact matches.
  const resolved = {};
  for (const [name, qid] of [["Patagonia", "Q1660552"], ["Hipcamp", "Q20714382"]]) {
    const described = await personalQlooDescribe(userId, { entity: name, type: "brand" });
    const exact = described.results?.find((item) => item?.name === name);
    assert.ok(described.status === "ok" && exact?.entity_id, `${name} did not resolve to an exact cultural brand match.`);
    const found = await searchWikidataBrands(name);
    const business = found.find((item) => item.id === qid);
    assert.ok(business, `${name} did not resolve to the expected US business record.`);
    const selected = await selectedWikidataBrand(business);
    const resolution = { qloo: { candidates: normalizeQlooBrands({ results: [exact] }) },
      wikidata: { candidates: [selected] } };
    const identity = selectResolvedBrand(resolution, exact.entity_id, qid);
    assert.equal(identity.identityStatus, "verified");
    resolved[name] = { qlooId: exact.entity_id, qid, website: selected.website };
  }
  seedId = (await db.query("insert into catalog.entities(kind,canonical_name,canonical_url,official_website,identity_status) values('brand','Patagonia',$1,$1,'verified') returning id", [resolved.Patagonia.website])).rows[0].id;
  partnerId = (await db.query("insert into catalog.entities(kind,canonical_name,canonical_url,official_website,identity_status) values('brand','Hipcamp',$1,$1,'verified') returning id", [resolved.Hipcamp.website])).rows[0].id;
  for (const [entityId, data] of [[seedId, resolved.Patagonia], [partnerId, resolved.Hipcamp]]) {
    await db.query("insert into catalog.entity_identifiers(entity_id,provider,external_id,status) values($1,'qloo',$2,'confirmed'),($1,'wikidata',$3,'confirmed')",
      [entityId, data.qlooId, data.qid]);
  }

  const project = await createProject(userId, { seedEntityId: seedId, name: "Patagonia partnership research", objective: "content_collaboration" });
  const start = await startPersonalRun(userId, { projectId: project.id, mode: "direct_pair", partnerType: "brand",
    researchMode: "live_brand", partnerEntityId: partnerId, idempotencyKey: randomUUID() });
  const run = await claimPersonalRun("v4-live-worker");
  assert.equal(run.id, start.runId);
  assert.equal(await processPersonalBrandRun(run, "v4-live-worker"), true);

  const finished = await getPersonalRun(userId, start.runId);
  assert.ok(["completed", "partial"].includes(finished.status));
  assert.equal(finished.matches.length, 1);
  const match = finished.matches[0];
  assert.equal(match.scoringVersion, "4.0.1");
  assert.equal(match.evidence.contractVersion, 2);
  assert.equal(match.evidence.sample, false);
  assert.ok(["eligible", "conditional", "insufficient_evidence", "excluded"].includes(match.score.status));
  assert.ok(match.score.ratings && Object.keys(match.score.ratings).length === 3);
  // entity_tags only yields broad tag bridges, so C can never exceed the broad anchor here.
  assert.ok(match.score.ratings.C === null || match.score.ratings.C === 0.5);
  if (typeof match.score.displayScore === "number") {
    assert.ok(["eligible", "conditional"].includes(match.score.status));
    assert.equal(match.score.displayScore % 5, 0);
  } else {
    assert.equal(match.score.status, "insufficient_evidence");
  }
  // Bridge lineage: every bridge cites two distinct frozen Qloo sources.
  const sourceIds = new Set(match.evidence.sources.map((source) => source.id));
  for (const bridge of match.evidence.bridges) {
    assert.equal(new Set(bridge.qlooSourceIds).size, 2);
    for (const id of bridge.qlooSourceIds) assert.ok(sourceIds.has(id));
  }
  const qlooSources = match.evidence.sources.filter((source) => source.kind === "qloo_response");
  assert.ok(qlooSources.length >= 2, "expected both entity tag responses in frozen evidence");
  const snapshots = await db.query("select version,scoring_version from public.assessment_snapshots where match_id=$1", [match.id]);
  assert.equal(snapshots.rows.length, 1);
  assert.equal(snapshots.rows[0].scoring_version, "4.0.1");
  // No concept or brief is created during scoring.
  assert.equal(match.concept, null);
  assert.equal(match.briefId, null);
  const proposal = await createPersonalProposal(userId, match.id);
  assert.match(proposal.markdown, /## Partnership overview/);

  // Second identical run: cache hits only, new match, first snapshot untouched.
  const second = await startPersonalRun(userId, { projectId: project.id, mode: "direct_pair", partnerType: "brand",
    researchMode: "live_brand", partnerEntityId: partnerId, idempotencyKey: randomUUID() });
  const claimed = await claimPersonalRun("v4-live-worker-2");
  assert.equal(claimed.id, second.runId);
  assert.equal(await processPersonalBrandRun(claimed, "v4-live-worker-2"), true);
  const rerun = await getPersonalRun(userId, second.runId);
  assert.equal(rerun.matches[0].scoringVersion, "4.0.1");
  const providerRefs = (await db.query("select provider_refs_json from public.analysis_runs where id=$1", [second.runId])).rows[0].provider_refs_json;
  assert.ok(providerRefs.filter((ref) => ref.provider === "qloo").every((ref) => ref.cacheStatus === "fresh"),
    "second run must reuse the private Qloo cache");
  const firstSnapshots = await db.query("select version,input_hash from public.assessment_snapshots where match_id=$1", [match.id]);
  assert.equal(firstSnapshots.rows.length, 1);
  const cached = await personalQlooEntityTags(userId, resolved.Patagonia.qlooId);
  assert.equal(cached.cacheStatus, "fresh");
  console.log(`LIVE Brand × Brand v4 check passed: status=${match.score.status}, C=${match.score.ratings.C}, R=${match.score.ratings.R}, G=${match.score.ratings.G}, bridges=${match.evidence.bridges.length}, activity=${match.evidence.partnerActivity.length}, displayScore=${match.score.displayScore ?? "withheld"}.`);
} finally {
  const { closeQloo } = await import("../src/qloo.mjs");
  await closeQloo().catch(() => {});
  if (userId) {
    await db.query("delete from private.qloo_responses where owner_user_id=$1", [userId]).catch(() => {});
    await admin.auth.admin.deleteUser(userId);
  }
  if (seedId || partnerId) await db.query("delete from catalog.source_items where entity_id=any($1::uuid[])", [[seedId, partnerId].filter(Boolean)]);
  if (seedId || partnerId) await db.query("delete from catalog.entity_identifiers where entity_id=any($1::uuid[])", [[seedId, partnerId].filter(Boolean)]);
  if (seedId || partnerId) await db.query("delete from catalog.entities where id=any($1::uuid[])", [[seedId, partnerId].filter(Boolean)]);
  await db.end();
}
