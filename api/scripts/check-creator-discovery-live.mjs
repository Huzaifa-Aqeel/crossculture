// Bounded local live verification: real Qloo, configured LLM and official YouTube API.
// Run only with explicit LIVE_CREATOR_CHECK=1. The test user is removed afterward.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createProject } from "../src/projects.mjs";
import { resolveBrand, selectedWikidataBrand, selectResolvedBrand,
  comparableName } from "../src/brand-resolution.mjs";
import { personalQlooDescribe } from "../src/personal-qloo.mjs";
import { persistSelectedBrand } from "../src/catalog.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun } from "../src/personal-research.mjs";
import { processCreatorResearchRun } from "../src/creator-research.mjs";
import { classifyCreatorChannel, extractCreatorMetadata, chooseCreatorTranscript,
  planCreatorQueries } from "../src/creator-intelligence.mjs";
import { inspectChannel, searchCreatorLeads } from "../src/youtube.mjs";
import { closeQloo } from "../src/qloo.mjs";

if (process.env.LIVE_CREATOR_CHECK !== "1") throw new Error("Set LIVE_CREATOR_CHECK=1 for this bounded live check.");
const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) {
  throw new Error("Local Supabase only.");
}
process.env.DATABASE_URL = vars.DB_URL;
process.env.YOUTUBE_TRANSCRIPTS_ENABLED = process.env.CREATOR_TEST_TRANSCRIPTS === "1" ? "true" : "false";
const seedBrand = process.env.CREATOR_TEST_BRAND || "Patagonia";
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const anon = createClient(vars.API_URL, vars.ANON_KEY, options);
const db = new pg.Pool({ connectionString: vars.DB_URL });
let userId;
let runId;
try {
  const startedAt = new Date();
  const suffix = randomUUID().slice(0, 8);
  const signup = await anon.auth.signUp({ email: `crossculture-creator-live-${suffix}@example.test`,
    password: `LocalCheck-${randomUUID()}!` });
  assert.ifError(signup.error);
  userId = signup.data.user.id;
  assert.ifError((await admin.auth.admin.updateUserById(userId, { email_confirm: true })).error);
  let seed = await db.query(`select e.id from catalog.entities e join catalog.entity_identifiers i
    on i.entity_id=e.id and i.provider='qloo' and i.status='confirmed'
    where e.canonical_name=$1 and e.kind='brand' and e.identity_status='verified' limit 1`, [seedBrand]);
  let seedIdentity = "existing_verified_catalog";
  if (!seed.rows[0] && process.env.CREATOR_TEST_SEED_BOOTSTRAP === "1") {
    const resolved = await resolveBrand(seedBrand, { qloo: (_operation, args) =>
      personalQlooDescribe(userId, args) });
    const cultural = resolved.qloo.candidates.find((item) =>
      comparableName(item.name) === comparableName(seedBrand));
    assert.ok(cultural, `No exact Qloo identity for ${seedBrand}.`);
    let selection;
    for (const candidate of resolved.wikidata.candidates.filter((item) =>
      comparableName(item.name) === comparableName(seedBrand))) {
      const detailed = await selectedWikidataBrand(candidate);
      const next = selectResolvedBrand({ ...resolved,
        wikidata: { ...resolved.wikidata, candidates: [detailed] } }, cultural.id, detailed.id);
      if (next.identityStatus === "verified") { selection = next; break; }
    }
    assert.ok(selection, `No independent official-domain identity confirmation for ${seedBrand}.`);
    const confirmed = await persistSelectedBrand(selection);
    assert.equal(confirmed.identityStatus, "verified");
    seed = { rows: [{ id: confirmed.id }] };
    seedIdentity = { qlooId: confirmed.qlooId, wikidataQid: confirmed.wikidataQid,
      officialUrl: confirmed.canonicalUrl };
  }
  assert.ok(seed.rows[0], `A confirmed ${seedBrand} seed is required.`);
  const project = await createProject(userId, { seedEntityId: seed.rows[0].id,
    name: "US creator discovery verification", objective: "content_collaboration" });
  const started = await startPersonalRun(userId, { projectId: project.id, mode: "discovery",
    partnerType: "creator", researchMode: "live_youtube", idempotencyKey: randomUUID() });
  runId = started.runId;
  const testCandidates = Number(process.env.CREATOR_TEST_CANDIDATES ?? 2);
  if (!Number.isInteger(testCandidates) || testCandidates < 1 || testCandidates > 6) {
    throw new Error("CREATOR_TEST_CANDIDATES must be 1–6 for a bounded live test.");
  }
  await db.query(`update public.analysis_runs set plan_json=jsonb_set(plan_json,'{maxCandidates}',$2::jsonb)
    where id=$1`, [runId, JSON.stringify(testCandidates)]);
  const run = await claimPersonalRun("creator-live-verification-worker");
  assert.equal(run.id, runId);
  await db.query("update public.analysis_runs set lease_until=now()+interval '10 minutes' where id=$1", [runId]);
  const diagnostics = [];
  const planningCoverage = [];
  const searchCoverage = [];
  const returnedChannels = [];
  const transcriptContinuity = [];
  const seenLeadIds = new Set();
  await processCreatorResearchRun(run, "creator-live-verification-worker", {
    inspect: inspectChannel,
    plan: async (input) => {
      const entry = { suppliedNamedTypes: Object.fromEntries(
        [...new Set((input.namedEntities ?? []).map((item) => item.type))].map((type) =>
          [type, input.namedEntities.filter((item) => item.type === type).length])),
        suppliedNamedEntities: (input.namedEntities ?? []).map(({ id, name, type, responseId }) =>
          ({ id, name, type, responseId })) };
      planningCoverage.push(entry);
      try {
        const diagnosticName = process.env.CREATOR_TEST_NAMED_ENTITY?.trim();
        if (diagnosticName) {
          const named = (input.namedEntities ?? []).find((item) =>
            item.name.toLowerCase() === diagnosticName.toLowerCase() && item.responseId);
          assert.ok(named, `Qloo did not supply the named diagnostic subject ${diagnosticName}.`);
          const diagnosticQuery = process.env.CREATOR_TEST_NAMED_QUERY?.trim() || `${named.name} ending explained`;
          assert.ok(diagnosticQuery.toLowerCase().includes(named.name.toLowerCase()) &&
            diagnosticQuery.length <= 100, "Diagnostic search must retain the exact Qloo name.");
          const direction = { q: diagnosticQuery, objective: input.objective,
            rationale: "Bounded named-entity diagnostic from the actual Qloo response.",
            signalIds: [named.id], regionCode: "US", relevanceLanguage: "en",
            namedEntityId: named.id, namedEntityName: named.name,
            namedEntityType: named.type, qlooResponseIds: [named.responseId],
            plannerVersion: "creator-search-v4-diagnostic" };
          entry.acceptedDirections = [{ q: direction.q, namedEntityType: named.type }];
          return [direction];
        }
        const planned = await planCreatorQueries(input);
        entry.acceptedDirections = planned.map((item) => ({ q: item.q,
          namedEntityId: item.namedEntityId ?? null,
          namedEntityType: item.namedEntityType ?? null,
          qlooResponseIds: item.qlooResponseIds ?? [] }));
        return process.env.CREATOR_TEST_PLAN_ONLY === "1" ? [] : planned;
      }
      catch (error) { diagnostics.push({ stage: "search_planning",
        message: String(error?.message ?? error).slice(0, 240) }); throw error; }
    },
    chooseTranscript: async (profile, metadata, tags, attempted, question, options) => {
      const hit = options?.targetedVideos?.[0];
      transcriptContinuity.push({ channelId: profile.id, discoveryVideoId: hit?.sourceId ?? null,
        outsideLatestSample: Boolean(hit && !profile.videos.some((video) => video.sourceId === hit.sourceId)),
        sourceRole: hit?.sourceRole ?? null });
      return chooseCreatorTranscript(profile, metadata, tags, attempted, question, options);
    },
    search: async (query) => {
      try {
        const leads = await searchCreatorLeads(query, { onDiagnostics: (item) =>
          searchCoverage.push(item) });
        returnedChannels.push({ query, channels: leads.map((lead) => ({
          channelId: lead.id, videoId: lead.videoId })) });
        const duplicatesAcrossQueries = leads.filter((lead) => seenLeadIds.has(lead.id)).length;
        for (const lead of leads) seenLeadIds.add(lead.id);
        searchCoverage[searchCoverage.length - 1].duplicatesAcrossQueries = duplicatesAcrossQueries;
        return leads;
      } catch (error) {
        searchCoverage.push({ query, status: "unavailable", reason: String(error?.message ?? "unknown").slice(0, 120) });
        throw error;
      }
    },
    classifyChannel: async (channel, seedName) => {
      try { return await classifyCreatorChannel(channel, seedName); }
      catch (error) { diagnostics.push({ stage: "channel_classification",
        kind: error?.constructor?.name ?? "unknown", issues: error?.issues?.map((issue) => ({
          path: issue.path, code: issue.code, message: issue.message })).slice(0, 6) ?? null,
        message: String(error?.message ?? "").slice(0, 120) });
        throw error; }
    },
    extract: (profile, options) => extractCreatorMetadata(profile, { ...options,
      onError: (error) => diagnostics.push({ stage: "metadata_extraction",
        kind: error?.constructor?.name ?? "unknown", issues: error?.issues?.map((issue) => ({
          path: issue.path, code: issue.code, message: issue.message })).slice(0, 6) ?? null,
        message: String(error?.message ?? "").slice(0, 120) }) }),
    onCandidateError: (stage, _reference, error) => diagnostics.push({ stage,
      message: error instanceof Error ? error.message : "unknown" }),
  });
  const finished = await getPersonalRun(userId, runId);
  const after = await db.query(`select quota_bucket,count(*)::integer as used
    from private.youtube_api_requests where reserved_at>=$1 group by quota_bucket`, [startedAt]);
  const usage = Object.fromEntries(after.rows.map((item) => [item.quota_bucket, item.used]));
  const seedTags = await db.query(`select normalized_result_json->'results' as tags
    from private.qloo_responses where owner_user_id=$1 and operation='qloo_entity_tags'
    order by collected_at desc limit 1`, [userId]);
  const signalRows = await db.query(`select e.canonical_name,s.id,s.external_item_id,s.source_url,
    s.metadata_observations_json->>'sourceRole' as source_role,
    jsonb_array_length(s.transcript_observations_json) as transcript_observation_count,
    s.metadata_observations_json->'culturalSignals' as signals,
    s.metadata_observations_json->'demonstratedFormats' as formats
    from public.source_items s join catalog.entities e on e.id=s.entity_id
    where s.analysis_run_id=$1`, [runId]);
  const signals = Object.fromEntries([...new Set(signalRows.rows.map((row) => row.canonical_name))]
    .map((name) => [name, [...new Set(signalRows.rows.filter((row) => row.canonical_name === name)
      .flatMap((row) => (row.signals ?? []).map((item) => item.phrase)))].slice(0, 15)]));
  const formatBySourceId = new Map(signalRows.rows.map((row) =>
    [`personal:${row.id}`, (row.formats ?? []).map((item) => ({
      name: item.name, basisField: item.basisField, basisText: item.basisText }))]));
  const sourceLineage = signalRows.rows.filter((row) => row.source_role === "discovery_hit" ||
    (row.signals ?? []).some((signal) => /half dome/i.test(signal.phrase)))
    .map((row) => ({ channelName: row.canonical_name, videoId: row.external_item_id,
      sourceUrl: row.source_url, sourceRole: row.source_role,
      transcriptObservationCount: row.transcript_observation_count,
      culturalSignals: (row.signals ?? []).map((signal) => ({ phrase: signal.phrase,
        centrality: signal.centrality, basisField: signal.basisField, basisText: signal.basisText })) }));
  const funnel = { directions: finished.result.directions ?? [],
    leads: finished.result.candidates?.filter((item) => item.channelId).length ?? 0,
    sampled: finished.result.research?.filter((item) => item.sampleSize > 0).length ?? 0,
    assessed: finished.matches.length,
    bridges: finished.result.research?.filter((item) => item.bridgeCount > 0).length ?? 0,
    groups: finished.result.groups, youtubeRequests: usage,
    seedTagNames: (seedTags.rows[0]?.tags ?? []).map((item) => item.name).slice(0, 15),
    signals, sourceLineage,
    savedAssessments: finished.matches.map((match) => ({ name: match.partnerName,
      scoreStatus: match.score?.status ?? null, displayScore: match.score?.displayScore ?? null,
      ratings: match.score?.ratings ?? null, reasonCodes: match.score?.reasonCodes ?? null,
      findings: match.score?.findings ?? null,
      scoringVersion: match.scoringVersion, evidenceStatus: match.evidenceStatus,
      sampleSize: match.evidence?.creatorSample?.videoIds?.length ?? 0,
      sources: (match.evidence?.sources ?? []).filter((source) => source.sourceUrl)
        .slice(0, 4).map((source) => ({ url: source.sourceUrl, role: source.sourceRole ?? null })),
      bridges: (match.evidence?.bridges ?? []).map((bridge) => ({ name: bridge.name,
        qlooSourceIds: bridge.qlooSourceIds, partnerSourceIds: bridge.partnerSourceIds,
        partnerUrls: bridge.partnerSourceIds.map((id) => match.evidence?.sources?.find((source) =>
          source.id === id)?.sourceUrl).filter(Boolean) })),
      partnerActivity: (match.evidence?.partnerActivity ?? []).map((item) => ({
        centrality: item.centrality, summary: item.summary, sourceIds: item.sourceIds })),
      capabilities: (match.evidence?.capabilities ?? []).map((item) => ({
        id: item.id, status: item.status, sourceIds: item.sourceIds,
        formatBasis: item.sourceIds?.flatMap((id) => formatBySourceId.get(id) ?? []),
        sourceUrls: item.sourceIds?.map((id) => match.evidence?.sources?.find((source) =>
          source.id === id)?.sourceUrl).filter(Boolean) })) })),
    researchCoverage: finished.result.research?.map((item) => ({
      channelId: item.channelId, analyzedVideos: item.analyzedVideos,
      bridgeReview: item.bridgeReview, commercialCoverage: item.commercialCoverage,
      transcriptStopReason: item.transcriptStopReason,
      transcriptStatus: item.transcriptStatus,
      transcriptPlans: item.transcriptPlans?.map((plan) => ({ videoId: plan.videoId,
        researchQuestion: plan.researchQuestion })) })) ?? [],
    candidates: finished.result.candidates?.map((item) => ({ channelId: item.channelId ?? null,
      name: item.name ?? "Unconfirmed creator lead",
      status: item.status, sourceUrl: item.sourceUrl, sampleSize: item.sampleSize ?? 0,
      channelType: item.channelType ?? null, channelTypeReason: item.channelTypeReason ?? null,
      identitySourceUrl: item.identitySourceUrl ?? null,
      channelCountry: item.channelCountry ?? null,
      audienceGeographyStatus: item.audienceGeographyStatus ?? null,
      direction: item.direction ?? null,
      analyzedVideos: finished.result.research?.find((research) => research.channelId === item.channelId)?.analyzedVideos ?? null,
      failedMetadataBatches: finished.result.research?.find((research) => research.channelId === item.channelId)?.failedMetadataBatches ?? null,
      bridgeCount: item.bridgeCount ?? 0,
      scoreStatus: item.scoreStatus ?? null })) };
  console.log(JSON.stringify({ seedBrand, seedIdentity, runStatus: finished.status,
    testOnlyUsCountryFilter: false, transcriptsEnabled: process.env.YOUTUBE_TRANSCRIPTS_ENABLED === "true",
    funnel, planningCoverage, searchCoverage, returnedChannels, transcriptContinuity, diagnostics }, null, 2));
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await closeQloo();
  await db.end();
}
