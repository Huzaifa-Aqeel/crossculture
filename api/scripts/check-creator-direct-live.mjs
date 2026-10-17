// One bounded real direct-pair check. Prints structured provenance only; never raw captions.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun } from "../src/personal-research.mjs";
import { processCreatorResearchRun } from "../src/creator-research.mjs";
import { selectedVideoTranscript } from "../src/youtube-transcript.mjs";
import { closeQloo } from "../src/qloo.mjs";

if (process.env.LIVE_CREATOR_CHECK !== "1") throw new Error("Set LIVE_CREATOR_CHECK=1.");
const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:"))
  throw new Error("Local Supabase only.");
process.env.DATABASE_URL = vars.DB_URL;
process.env.YOUTUBE_TRANSCRIPTS_ENABLED = process.env.CREATOR_DIRECT_TRANSCRIPTS === "0" ? "false" : "true";
const creatorChannel = process.env.CREATOR_DIRECT_CHANNEL || "@Darwinonthetrail";
const seedBrand = process.env.CREATOR_DIRECT_BRAND || "Patagonia";
const autonomousTranscripts = process.env.CREATOR_AUTONOMOUS_TRANSCRIPTS === "1";
const authOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, authOptions);
const anon = createClient(vars.API_URL, vars.ANON_KEY, authOptions);
const db = new pg.Pool({ connectionString: vars.DB_URL });
let userId;
try {
  const seed = await db.query(`select e.id from catalog.entities e join catalog.entity_identifiers i
    on i.entity_id=e.id and i.provider='qloo' and i.status='confirmed'
    where e.canonical_name=$1 and e.kind='brand' and e.identity_status='verified' limit 1`, [seedBrand]);
  assert.ok(seed.rows[0], `Confirmed ${seedBrand} seed required.`);
  const signup = await anon.auth.signUp({ email: `creator-direct-${randomUUID().slice(0, 8)}@example.test`,
    password: `LocalCheck-${randomUUID()}!` });
  assert.ifError(signup.error);
  userId = signup.data.user.id;
  assert.ifError((await admin.auth.admin.updateUserById(userId, { email_confirm: true })).error);
  const project = await createProject(userId, { seedEntityId: seed.rows[0].id,
    name: "US creator direct verification", objective: "content_collaboration" });
  const started = await startPersonalRun(userId, { projectId: project.id, mode: "direct_pair",
    partnerType: "creator", researchMode: "live_youtube", creatorChannel,
    idempotencyKey: randomUUID() });
  const run = await claimPersonalRun("creator-direct-live-worker");
  assert.equal(run.id, started.runId);
  await db.query("update public.analysis_runs set lease_until=now()+interval '10 minutes' where id=$1", [run.id]);
  let transcriptAttempts = 0;
  const diagnostics = [];
  const transcriptOverrides = autonomousTranscripts ? {} : {
    chooseTranscript: async (profile, _metadata, _tags, attemptedIds, question) => {
      const video = profile.videos.find((item) => item.sourceId === "FlU9ChJFC1c");
      if (!question || !video || attemptedIds.includes(video.sourceId)) return null;
      return { videoId: video.sourceId, researchQuestion: question,
        whyThisVideo: "A recent official upload discusses outdoor trail experience.",
        predictedDecisionImpact: "Spoken references may clarify cultural context and capability." };
    },
    retrieveTranscript: async (videoId) => {
      if (transcriptAttempts++ > 0) return { videoId, status: "not_attempted", segments: [], fetchedAt: null };
      return selectedVideoTranscript(videoId);
    },
  };
  await processCreatorResearchRun(run, "creator-direct-live-worker", {
    ...transcriptOverrides,
    onCandidateError: (stage, _reference, error) => diagnostics.push({ stage,
      message: String(error?.message ?? "unknown").slice(0, 180) }),
  });
  const finished = await getPersonalRun(userId, run.id);
  const rows = await db.query(`select external_item_id,source_url,transcript_observations_json,
    transcript_observed_at,transcript_expires_at,metadata_observations_json
    from public.source_items where analysis_run_id=$1 and transcript_expires_at is not null`, [run.id]);
  const namedVideo = await db.query(`select external_item_id,source_url,metadata_observations_json
    from public.source_items where analysis_run_id=$1 and external_item_id='TBMurjUZHLA'`, [run.id]);
  const transcripts = rows.rows.map((row) => ({ videoId: row.external_item_id, sourceUrl: row.source_url,
    observedAt: row.transcript_observed_at, expiresAt: row.transcript_expires_at,
    findings: (row.transcript_observations_json ?? []).map((item) => ({
      videoId: item.videoId, offsetMs: item.offsetMs, entity: item.entity,
      kind: item.kind, centrality: item.centrality })) }));
  console.log(JSON.stringify({ status: finished.status, seedBrand, creatorChannel, autonomousTranscripts,
    matches: finished.matches.map((match) => ({ partnerName: match.partnerName,
      scoreStatus: match.score?.status, displayScore: match.score?.displayScore,
      ratings: match.score?.ratings ?? null, reasonCodes: match.score?.reasonCodes ?? null,
      scoringVersion: match.scoringVersion, bridges: match.evidence?.bridges?.map((bridge) => ({
        name: bridge.name, qlooSourceIds: bridge.qlooSourceIds,
        partnerSourceIds: bridge.partnerSourceIds })) ?? [],
      partnerActivity: match.evidence?.partnerActivity?.map((item) => ({
        summary: item.summary, bridgeIds: item.bridgeIds, sourceIds: item.sourceIds })) ?? [],
      sourceCount: match.evidence?.sources?.length ?? 0 })),
    research: finished.result.research, namedVideo: namedVideo.rows.map((item) => ({
      videoId: item.external_item_id, sourceUrl: item.source_url,
      culturalSignals: item.metadata_observations_json?.culturalSignals ?? [] })),
    transcripts, transcriptAttempts, diagnostics }, null, 2));
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await closeQloo();
  await db.end();
}
