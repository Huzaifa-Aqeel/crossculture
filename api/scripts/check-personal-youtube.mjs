import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun } from "../src/personal-research.mjs";
import { processCreatorResearchRun } from "../src/creator-research.mjs";

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
let seedId;
let creatorId;
try {
  for (const [client, label] of [[alice, "a"], [bob, "b"]]) {
    const email = `crossculture-youtube-${label}-${suffix}@example.test`;
    const signup = await client.auth.signUp({ email, password });
    assert.ifError(signup.error);
    users.push(signup.data.user.id);
    assert.ifError((await admin.auth.admin.updateUserById(signup.data.user.id, { email_confirm: true })).error);
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  }
  seedId = (await db.query("insert into catalog.entities(kind,canonical_name) values ('brand',$1) returning id", [`SAMPLE US outdoor brand ${suffix}`])).rows[0].id;
  await db.query("insert into catalog.entity_identifiers(entity_id,provider,external_id,status) values ($1,'qloo',$2,'confirmed')", [seedId, `sample-${suffix}`]);
  const project = await createProject(users[0], { seedEntityId: seedId, name: "SAMPLE creator research", objective: "content_collaboration" });
  const input = { projectId: project.id, mode: "direct_pair", partnerType: "creator", researchMode: "live_youtube",
    creatorChannel: "@MKBHD", idempotencyKey: randomUUID() };
  const started = await startPersonalRun(users[0], input);
  assert.equal((await startPersonalRun(users[0], input)).runId, started.runId);
  await assert.rejects(startPersonalRun(users[0], { ...input, creatorChannel: "@AnotherCreator", idempotencyKey: input.idempotencyKey }),
    (error) => error.statusCode === 409);
  const claimed = await claimPersonalRun("youtube-fixture-worker");
  assert.equal(claimed.id, started.runId);
  const channelId = "UC1234567890123456789012";
  const collectedAt = new Date().toISOString();
  const videoIds = ["abc12345678", "abc12345679"];
  const fixture = { id: channelId, name: "SAMPLE US technology creator", sourceProvider: "youtube_data_api_v3",
    videoRequestHash: "a".repeat(64), videos: videoIds.map((sourceId, index) => ({
      sourceId, ownerId: channelId, sourceUrl: `https://www.youtube.com/watch?v=${sourceId}`,
      evidenceStatus: "observed", title: `SAMPLE US tech video ${index + 1}`,
      publishedAt: "2026-09-01T12:00:00.000Z", collectedAt,
      retainUntil: new Date(Date.parse(collectedAt) + 29 * 86400000).toISOString(),
    })) };
  process.env.YOUTUBE_TRANSCRIPTS_ENABLED = "true";
  assert.equal(await processCreatorResearchRun(claimed, "youtube-fixture-worker", {
    importCreator: async () => fixture,
    inspect: async () => ({ id: channelId, name: fixture.name, summary: "I make sample videos." }),
    classifyChannel: async () => ({ kind: "creator", basisField: "summary",
      basisText: "I make sample videos", reason: "The sample channel describes a person making videos." }),
    tags: async () => ({ status: "ok", tags: [{ id: "sample-cultural-tag", name: "hiking" }], responseId: null }),
    extract: async () => ({ culturalSignals: [], demonstratedFormats: [], collaborationObservations: [],
      sourceCoverage: { sampled: 2, extracted: 2, failedBatches: 0 }, extractionVersion: "creator-metadata-v4" }),
    findTags: async () => ({ status: "unavailable", tags: [], responseId: null }),
    chooseTranscript: async (_profile, _metadata, _tags, attempted) => attempted.length ? null
      : { videoId: videoIds[0], researchQuestion: "Check whether hiking is substantively discussed.",
        whyThisVideo: "Its title might relate to the open cultural question.",
        predictedDecisionImpact: "A finding could support or refute a cultural observation." },
    retrieveTranscript: async (videoId) => ({ videoId, status: "available", fetchedAt: new Date().toISOString(),
      segments: [{ offsetMs: 1000, durationMs: 2000, text: "DO_NOT_STORE_PRIVATE_SPEECH hiking" }] }),
    extractTranscript: async (videoId) => [{ videoId, offsetMs: 1000, durationMs: 2000,
      entity: "hiking", centrality: "substantive", kind: "cultural_reference",
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}&t=1s`, extractionVersion: "fixture-v1" }],
  }), true);
  delete process.env.YOUTUBE_TRANSCRIPTS_ENABLED;
  const finished = await getPersonalRun(users[0], started.runId);
  assert.equal(finished.status, "partial");
  assert.equal(finished.matches.length, 1);
  assert.equal(finished.matches[0].evidence.sample, false);
  assert.equal(finished.matches[0].evidence.sources.length, 2);
  assert.equal(finished.matches[0].evidence.creatorSample.videoIds.length, 2);
  assert.equal(finished.matches[0].score.status, "insufficient_evidence");
  assert.equal(finished.matches[0].score.displayScore, null);
  assert.equal(finished.matches[0].scoringVersion, "4.0.1");
  assert.equal(await getPersonalRun(users[1], started.runId), null);
  const sources = await db.query("select id,entity_id,request_hash from public.source_items where analysis_run_id=$1", [started.runId]);
  assert.equal(sources.rowCount, 2);
  assert.ok(sources.rows.every((source) => source.request_hash === fixture.videoRequestHash));
  creatorId = sources.rows[0].entity_id;
  const otherSources = await bob.from("source_items").select("id").eq("analysis_run_id", started.runId);
  assert.ifError(otherSources.error);
  assert.equal(otherSources.data.length, 0);
  const ownSources = await alice.from("source_items").select("id").eq("analysis_run_id", started.runId);
  assert.ifError(ownSources.error);
  assert.equal(ownSources.data.length, 2);
  const reusedRun = await startPersonalRun(users[0], { ...input, idempotencyKey: randomUUID() });
  const reusedClaim = await claimPersonalRun("youtube-fixture-worker");
  assert.equal(reusedClaim.id, reusedRun.runId);
  assert.equal(await processCreatorResearchRun(reusedClaim, "youtube-fixture-worker", {
    importCreator: async () => fixture,
    inspect: async () => ({ id: channelId, name: fixture.name, summary: "I make sample videos." }),
    classifyChannel: async () => ({ kind: "creator", reason: "Sample creator identity." }),
    tags: async () => ({ status: "ok", tags: [{ id: "sample-cultural-tag", name: "hiking" }], responseId: null }),
    extract: async () => { throw new Error("Reusable metadata must skip a second LLM extraction."); },
  }), true);
  assert.equal((await getPersonalRun(users[0], reusedRun.runId)).matches[0].evidence.creatorSample.videoIds.length, 2);
  const excludedStart = await startPersonalRun(users[0], { ...input, idempotencyKey: randomUUID(),
    excludedPartnerEntityIds: [creatorId] });
  const excludedRun = await claimPersonalRun("youtube-exclusion-fixture");
  assert.equal(excludedRun.id, excludedStart.runId);
  assert.equal(await processCreatorResearchRun(excludedRun, "youtube-exclusion-fixture", {
    importCreator: async () => fixture,
    inspect: async () => ({ id: channelId, name: fixture.name, summary: "I make sample videos." }),
    classifyChannel: async () => ({ kind: "creator", reason: "Sample creator identity." }),
    tags: async () => ({ status: "ok", tags: [{ id: "sample-cultural-tag", name: "hiking" }], responseId: null }),
    extract: async () => { throw new Error("Metadata should be reused for excluded creator."); },
  }), true);
  const excludedMatch = (await getPersonalRun(users[0], excludedStart.runId)).matches[0];
  assert.equal(excludedMatch.score.status, "excluded");
  assert.equal(excludedMatch.evidence.constraints[0].blocking, true);
  const discoveryStart = await startPersonalRun(users[0], { projectId: project.id,
    mode: "discovery", partnerType: "creator", researchMode: "live_youtube",
    idempotencyKey: randomUUID() });
  const discoveryRun = await claimPersonalRun("youtube-discovery-lineage-fixture");
  assert.equal(discoveryRun.id, discoveryStart.runId);
  const hitId = "abc12345680";
  const searchHash = "b".repeat(64);
  const identityUrl = "https://sample-creator.example/contact";
  process.env.YOUTUBE_TRANSCRIPTS_ENABLED = "true";
  assert.equal(await processCreatorResearchRun(discoveryRun, "youtube-discovery-lineage-fixture", {
    plan: async () => [{ q: "SAMPLE hiking creator" }],
    recommendEntities: async () => ({ envelope: { status: "empty", results: [] }, responseId: null }),
    search: async () => [{ id: channelId, videoId: hitId,
      searchSource: { title: "SAMPLE discovery hit", url: `https://www.youtube.com/watch?v=${hitId}`,
        publishedAt: "2026-09-02T12:00:00.000Z", collectedAt, requestHash: searchHash } }],
    importCreator: async () => ({ ...fixture, country: "GB" }),
    inspect: async () => ({ id: channelId, name: fixture.name,
      summary: "I make sample videos.", country: "GB" }),
    classifyChannel: async () => ({ kind: "unknown", reason: "Description alone is inconclusive." }),
    verifyIdentity: async () => ({ kind: "creator", operatorName: fixture.name,
      reason: "SAMPLE independently corroborated operator.", identityEvidence: {
        url: identityUrl, title: "SAMPLE creator contact", inspected: true,
        snippet: `${fixture.name} contact information`, sourceHash: "c".repeat(64) } }),
    tags: async () => ({ status: "ok", tags: [{ id: "sample-cultural-tag", name: "hiking" }], responseId: null }),
    extract: async () => { throw new Error("Discovery should reuse existing metadata."); },
    chooseTranscript: async (_profile, _metadata, _tags, attempted) => attempted.length ? null
      : { videoId: hitId, researchQuestion: "Check an observed cultural subject.",
        whyThisVideo: "This search hit may discuss the subject.",
        predictedDecisionImpact: "A finding could clarify the creator's cultural context." },
    retrieveTranscript: async (videoId) => ({ videoId, status: "available", fetchedAt: new Date().toISOString(),
      segments: [{ offsetMs: 2000, durationMs: 1000, text: "DO_NOT_STORE_DISCOVERY_SPEECH hiking" }] }),
    extractTranscript: async (videoId) => [
      { videoId, offsetMs: 2000, durationMs: 1000,
        entity: "hiking", centrality: "substantive", kind: "cultural_reference",
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}&t=2s`, extractionVersion: "fixture-v1" },
      { videoId, offsetMs: 2000, durationMs: 1000,
        entity: "trail shoes", centrality: "substantive", kind: "product_mention",
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}&t=2s`, extractionVersion: "fixture-v1" },
      { videoId, offsetMs: 2000, durationMs: 1000,
        entity: "filming", centrality: "substantive", kind: "expertise",
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}&t=2s`, extractionVersion: "fixture-v1" },
    ],
  }), true);
  delete process.env.YOUTUBE_TRANSCRIPTS_ENABLED;
  const discoveryResult = await getPersonalRun(users[0], discoveryStart.runId);
  const discovered = discoveryResult.matches[0];
  assert.equal(discoveryResult.result.candidates[0].status, "assessed",
    "A non-US channel country is not a mandatory production exclusion.");
  assert.equal(discoveryResult.result.candidates[0].channelCountry, "GB");
  assert.equal(discoveryResult.result.candidates[0].audienceGeographyStatus, "unknown");
  assert.ok(discovered.evidence.unknowns.includes("Target-market audience geography"));
  assert.equal(discoveryResult.result.candidates[0].identitySourceUrl, identityUrl);
  assert.ok(discovered.evidence.sources.some((item) => item.sourceUrl === identityUrl));
  assert.ok(discovered.evidence.claims.some((item) => item.id === "claim:creator_identity"));
  assert.equal(discovered.evidence.creatorSample.videoIds.length, 2);
  assert.equal(discovered.evidence.sources.length, 4);
  assert.equal(discovered.evidence.sources.find((item) => item.videoId === hitId)?.sourceRole, "discovery_hit");
  assert.equal(discovered.evidence.creatorSample.videoIds.includes(hitId), false);
  assert.ok(discovered.evidence.claims.some((claim) => claim.text.includes("trail shoes")));
  assert.ok(discovered.evidence.claims.some((claim) => claim.text.includes("filming")));
  assert.equal(discovered.evidence.bridges.some((bridge) =>
    ["trail shoes", "filming"].includes(bridge.name.toLowerCase())), false);
  const hitRow = await db.query(`select request_hash,metadata_observations_json,transcript_observations_json,
    transcript_expires_at,transcript_observed_at,retain_until,collected_at
    from public.source_items where analysis_run_id=$1 and external_item_id=$2`, [discoveryStart.runId, hitId]);
  assert.equal(hitRow.rows[0].request_hash, searchHash);
  assert.equal(hitRow.rows[0].metadata_observations_json.sourceRole, "discovery_hit");
  assert.equal(hitRow.rows[0].transcript_observations_json[0].videoId, hitId);
  assert.ok(!JSON.stringify(hitRow.rows[0]).includes("DO_NOT_STORE_DISCOVERY_SPEECH"));
  assert.ok(Date.parse(hitRow.rows[0].transcript_expires_at) -
    Date.parse(hitRow.rows[0].transcript_observed_at) <= 15 * 86400000);
  assert.ok(Date.parse(hitRow.rows[0].retain_until) - Date.parse(hitRow.rows[0].collected_at) <= 29 * 86400000);
  for (const code of ["YOUTUBE_APP_BUDGET_EXHAUSTED", "YOUTUBE_GOOGLE_QUOTA_EXHAUSTED"]) {
    const failureStart = await startPersonalRun(users[0], { projectId: project.id,
      mode: "discovery", partnerType: "creator", researchMode: "live_youtube",
      idempotencyKey: randomUUID() });
    const failureRun = await claimPersonalRun(`youtube-${code.toLowerCase()}-fixture`);
    assert.equal(failureRun.id, failureStart.runId);
    await processCreatorResearchRun(failureRun, `youtube-${code.toLowerCase()}-fixture`, {
      tags: async () => ({ status: "ok", tags: [{ id: "sample-cultural-tag", name: "hiking" }],
        responseId: null }),
      recommendEntities: async () => ({ envelope: { status: "empty", results: [] }, responseId: null }),
      plan: async () => [{ q: "SAMPLE hiking creator" }],
      search: async () => { const error = new Error("Synthetic quota failure."); error.code = code; throw error; },
    });
    const failed = await getPersonalRun(users[0], failureStart.runId);
    assert.equal(failed.status, "partial");
    assert.equal(failed.result.candidates[0].providerFailureCode, code,
      "The saved discovery trace must retain app-vs-Google quota provenance.");
  }
  const observations = await db.query(`select id,transcript_observations_json,transcript_observed_at,
    transcript_expires_at from public.source_items where analysis_run_id=$1
    and transcript_expires_at is not null`, [started.runId]);
  assert.equal(observations.rowCount, 1);
  assert.ok(Date.parse(observations.rows[0].transcript_expires_at) -
    Date.parse(observations.rows[0].transcript_observed_at) <= 15 * 86400000);
  assert.ok(!JSON.stringify(observations.rows[0].transcript_observations_json).includes("DO_NOT_STORE_PRIVATE_SPEECH"));
  assert.ok(!JSON.stringify(finished).includes("DO_NOT_STORE_PRIVATE_SPEECH"));
  await db.query(`update public.source_items set transcript_observed_at=now()-interval '14 days',
    transcript_expires_at=now()-interval '1 second' where id=$1`, [observations.rows[0].id]);
  const expiredTranscript = await db.query("select private.purge_due_creator_observations(10) as count");
  assert.equal(expiredTranscript.rows[0].count, 1);
  const afterTranscript = await getPersonalRun(users[0], started.runId);
  assert.equal(afterTranscript.matches[0].evidenceStatus, "redacted");
  const cleared = await db.query("select transcript_observations_json from public.source_items where id=$1", [observations.rows[0].id]);
  assert.deepEqual(cleared.rows[0].transcript_observations_json, []);
  await db.query(`update public.source_items set collected_at=now()-interval '29 days',
    fresh_until=now()-interval '28 days',retain_until=now()-interval '1 second'
    where analysis_run_id=any($1::uuid[])`, [[started.runId, reusedRun.runId]]);
  await db.query("update catalog.entities set youtube_name_until=now()-interval '1 second' where id=$1", [creatorId]);
  const purged = await db.query("select private.purge_due_personal_youtube_sources(10) as count");
  assert.equal(purged.rows[0].count, 4);
  const redacted = await getPersonalRun(users[0], started.runId);
  assert.equal(redacted.matches[0].evidenceStatus, "redacted");
  assert.equal(redacted.matches[0].score.displayScore, undefined);
  assert.equal(redacted.matches[0].partnerName, `YouTube channel ${channelId}`);
  console.log("SAMPLE US signed-in creator runs, frozen sample, private metadata reuse, timed observation redaction, v4 insufficient-evidence assessment and RLS passed; no provider call ran.");
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  if (seedId) await db.query("delete from catalog.entities where id=$1", [seedId]);
  if (creatorId) await db.query("delete from catalog.source_items where entity_id=$1 and source_url=$2",
    [creatorId, "https://sample-creator.example/contact"]);
  if (creatorId) await db.query("delete from catalog.entities where id=$1", [creatorId]);
  await db.end();
}
// The worker module holds its own idle pool; fixture cleanup above is complete.
process.exit(0);
