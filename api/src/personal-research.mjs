import { randomUUID } from "node:crypto";
import pg from "pg";
import { samplePreviewEvidence } from "./evidence-ledger.mjs";
import { validatedChannelReference } from "./youtube.mjs";
import { processCreatorResearchRun } from "./creator-research.mjs";
import { purgeDueCreatorObservations } from "./youtube-retention.mjs";
import { processPersonalBrandRun } from "./personal-brand.mjs";
import { processPersonalBrandDiscoveryRun } from "./personal-brand-discovery.mjs";
import { proposalTemplate } from "./proposal-template.mjs";
import { validateNewRunObjective } from "./new-run-objectives.mjs";

let pool;
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const variants = new Set(["brand", "creator"]);
const modes = new Set(["discovery", "direct_pair"]);
const workerId = `research-worker-${randomUUID()}`;

function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  }
  return pool;
}

function bad(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

const sample = {
  brand: { name: "Sample partner brand", kind: "brand", uri: "urn:crossculture:sample:brand" },
  creator: { name: "Sample YouTube creator", kind: "youtube_creator", uri: "urn:crossculture:sample:creator" },
};

async function sampleEntity(client, variant) {
  const item = sample[variant];
  const result = await client.query(`insert into catalog.entities(kind,canonical_name,canonical_url,description,identity_status,facts_json)
    values ($1,$2,$3,'Synthetic preview identity. No real account or partnership is represented.','unverified','{"sample":true}'::jsonb)
    on conflict (canonical_url) where canonical_url is not null do update set canonical_name=excluded.canonical_name
    returning id`, [item.kind, item.name, item.uri]);
  return result.rows[0].id;
}

export async function startPersonalRun(userId, input) {
  if (!uuid(input?.projectId) || !uuid(input?.idempotencyKey) || !modes.has(input.mode) || !variants.has(input.partnerType)) {
    bad("Choose a project, preview mode, and partner type.");
  }
  const researchMode = input.researchMode ?? "sample";
  if (!["sample", "live_youtube", "live_brand"].includes(researchMode)) bad("Choose a supported research mode.");
  const excludedPartnerEntityIds = input.excludedPartnerEntityIds ?? [];
  if (!Array.isArray(excludedPartnerEntityIds) || excludedPartnerEntityIds.length > 20 ||
      excludedPartnerEntityIds.some((id) => !uuid(id)) ||
      new Set(excludedPartnerEntityIds).size !== excludedPartnerEntityIds.length) {
    bad("Choose valid partner exclusions.");
  }
  if (researchMode === "live_youtube" && (input.partnerType !== "creator" ||
      (input.mode === "direct_pair" ? !input.creatorChannel : input.creatorChannel != null))) {
    bad("Choose creator discovery or provide a specific creator channel.");
  }
  if (researchMode === "live_brand" && (input.partnerType !== "brand" ||
      (input.mode === "direct_pair" ? !uuid(input.partnerEntityId) : input.partnerEntityId != null))) {
    bad("Choose brand discovery or select a confirmed partner brand for comparison.");
  }
  const creatorChannel = researchMode === "live_youtube" && input.mode === "direct_pair"
    ? validatedChannelReference(input.creatorChannel) : null;
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [userId, input.projectId]);
    const existing = await client.query(`select id,project_id,kind,match_type,specified_partner_id,constraints_json from public.analysis_runs
      where user_id=$1 and idempotency_key=$2`, [userId, input.idempotencyKey]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.project_id !== input.projectId || row.kind !== input.mode || row.match_type !== (input.partnerType === "brand" ? "brand_brand" : "brand_youtube_creator") ||
          (row.constraints_json?.researchMode ?? "sample") !== researchMode ||
          (researchMode === "live_youtube" && input.mode === "direct_pair" &&
            row.constraints_json?.creatorChannel !== creatorChannel) ||
          JSON.stringify(row.constraints_json?.excludedPartnerEntityIds ?? []) !== JSON.stringify(excludedPartnerEntityIds) ||
          (row.constraints_json?.positioningDirection ?? null) !== (typeof input.positioningDirection === "string" ? input.positioningDirection.trim() || null : null) ||
          (researchMode === "live_brand" && input.mode === "direct_pair" && row.specified_partner_id !== input.partnerEntityId)) {
        bad("This request has already been used for another search.", 409);
      }
      await client.query("commit");
      return { runId: row.id, reused: true };
    }
    const project = await client.query(`select id,seed_entity_id,objective from public.projects
      where id=$1 and user_id=$2`, [input.projectId, userId]);
    if (!project.rows[0]) bad("Project not found.", 404);
    const positioningDirection = validateNewRunObjective(project.rows[0].objective, input.partnerType, input.positioningDirection);
    if (researchMode === "live_brand" && input.mode === "direct_pair") {
      if (input.partnerEntityId === project.rows[0].seed_entity_id) bad("Choose a different partner brand.");
      const partner = await client.query(`select e.id from catalog.entities e
        join catalog.entity_identifiers i on i.entity_id=e.id and i.provider='qloo' and i.status='confirmed'
        where e.id=$1 and e.kind='brand'`, [input.partnerEntityId]);
      if (!partner.rows[0]) bad("Select a confirmed partner brand for this comparison.");
    }
    const recent = await client.query(`select count(*)::integer as total,
      count(*) filter (where status in ('queued','running'))::integer as active
      from public.analysis_runs where user_id=$1 and project_id=$2 and created_at>now()-interval '1 day'`, [userId, input.projectId]);
    if (recent.rows[0].active) bad("A project preview is still running.", 409);
    if (recent.rows[0].total >= 30) bad("Today's project preview limit has been reached.", 429);
    const partnerId = researchMode === "live_brand" && input.mode === "direct_pair" ? input.partnerEntityId
      : input.mode === "direct_pair" && researchMode === "sample" ? await sampleEntity(client, input.partnerType) : null;
    const previous = await client.query(`select f.id,f.action,m.partner_entity_id from public.feedback f
      join public.analysis_runs r on r.id=f.analysis_run_id and r.user_id=f.user_id
      left join public.matches m on m.id=f.match_id and m.user_id=f.user_id
      where f.user_id=$1 and r.project_id=$2 and f.undone_at is null
      order by f.created_at desc limit 20`, [userId, input.projectId]);
    const constraints = researchMode === "sample"
      ? { sample: true, researchMode, partnerType: input.partnerType, mode: input.mode,
        ...(positioningDirection ? { positioningDirection } : {}) }
      : { sample: false, researchMode, partnerType: input.partnerType, mode: input.mode,
        excludedPartnerEntityIds,
        ...(positioningDirection ? { positioningDirection } : {}),
        ...(creatorChannel ? { creatorChannel } : {}) };
    const plan = researchMode === "sample" ? { version: 1, sampleOnly: true, maxCandidates: 1, maxProviderCalls: 0 }
      : { version: 1, sampleOnly: false, maxCandidates: input.mode === "discovery" ? 8 : 1,
        maxProviderCalls: researchMode === "live_brand" ? input.mode === "discovery" ? 60 : 16
          : input.mode === "discovery" ? 60 : 16,
        sources: researchMode === "live_brand" ? ["qloo", "wikidata", "web"]
          : ["qloo", "youtube_data_api_v3", "llm"],
        score: "v4_if_eligible" };
    const result = await client.query(`insert into public.analysis_runs(user_id,project_id,seed_entity_id,specified_partner_id,
      kind,match_type,objective,constraints_json,plan_json,feedback_snapshot_json,idempotency_key)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11) returning id`,
    [userId, input.projectId, project.rows[0].seed_entity_id, partnerId, input.mode,
      input.partnerType === "brand" ? "brand_brand" : "brand_youtube_creator", project.rows[0].objective,
      JSON.stringify(constraints), JSON.stringify(plan), JSON.stringify({ events: previous.rows }), input.idempotencyKey]);
    await client.query("commit");
    return { runId: result.rows[0].id, reused: false };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function listPersonalRuns(userId, projectId) {
  if (!uuid(projectId)) bad("Project not found.", 404);
  const project = await db().query("select id from public.projects where id=$1 and user_id=$2", [projectId, userId]);
  if (!project.rows[0]) bad("Project not found.", 404);
  const result = await db().query(`select id,kind,"match_type" as "matchType",status,stage,
    constraints_json->>'partnerType' as "partnerType",result_json as result,
    created_at as "createdAt" from public.analysis_runs where user_id=$1 and project_id=$2
    order by created_at desc limit 30`, [userId, projectId]);
  return result.rows;
}

export function orderBrandDiscoveryMatches(matches) {
  const group = (row) => row.evidenceStatus !== "valid" ? 4 : ({ eligible: 0, conditional: 1,
    insufficient_evidence: 2, excluded: 3 })[row.score?.status] ?? 4;
  const confidence = { high: 0, medium: 1, low: 2 };
  return [...matches].sort((left, right) => {
    const leftGroup = group(left); const rightGroup = group(right);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    if (leftGroup < 2) {
      const scoreGap = (right.score?.displayScore ?? -1) - (left.score?.displayScore ?? -1);
      if (scoreGap) return scoreGap;
      const confidenceGap = (confidence[left.score?.confidence] ?? 3) - (confidence[right.score?.confidence] ?? 3);
      if (confidenceGap) return confidenceGap;
    }
    return left.partnerEntityId.localeCompare(right.partnerEntityId);
  });
}

export async function getPersonalRun(userId, runId) {
  if (!uuid(runId)) return null;
  const run = await db().query(`select r.id,r.project_id as "projectId",r.kind,r.match_type as "matchType",
    r.status,r.stage,r.attempt,r.result_json as result,r.error_code as "errorCode",
    r.constraints_json->>'positioningDirection' as "positioningDirection",
    r.created_at as "createdAt",e.canonical_name as "seedName"
    from public.analysis_runs r join catalog.entities e on e.id=r.seed_entity_id
    where r.id=$1 and r.user_id=$2`, [runId, userId]);
  if (!run.rows[0]) return null;
  if (run.rows[0].matchType === "brand_youtube_creator") await purgeDueCreatorObservations();
  const matches = await db().query(`select m.id,m.partner_entity_id as "partnerEntityId",m.eligibility,m.saved_at as "savedAt",m.note,
    e.canonical_name as "partnerName",a.id as "assessmentId",a.evidence_json as evidence,
    a.score_json as score,a.scoring_version as "scoringVersion",a.version as "assessmentVersion",
    a.validity_status as "evidenceStatus",
    c.id as "conceptId",coalesce(c.edited_json,c.draft_json) as concept,
    b.id as "briefId",b.content_markdown as "briefMarkdown",b.revision as "briefRevision",
    b.validity_status as "briefStatus"
    from public.matches m join catalog.entities e on e.id=m.partner_entity_id
    left join lateral (select * from public.assessment_snapshots where match_id=m.id and user_id=$2 order by version desc limit 1) a on true
    left join lateral (select * from public.concepts where match_id=m.id and user_id=$2 order by version desc limit 1) c on true
    left join lateral (select * from public.briefs where match_id=m.id and user_id=$2 order by updated_at desc limit 1) b on true
    where m.analysis_run_id=$1 and m.user_id=$2 order by m.created_at`, [runId, userId]);
  const orderedMatches = run.rows[0].kind === "discovery"
    ? orderBrandDiscoveryMatches(matches.rows) : matches.rows;
  return { ...run.rows[0], matches: orderedMatches };
}

export async function recordPersonalFeedback(userId, input) {
  if (!uuid(input?.runId) || !uuid(input?.matchId) || !["save", "reject"].includes(input.action)) bad("Choose Save or Pass for this partnership.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 160) : null;
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query(`insert into public.feedback(user_id,analysis_run_id,match_id,action,reason)
      select $1,m.analysis_run_id,m.id,$4,$5 from public.matches m
      where m.id=$2 and m.analysis_run_id=$3 and m.user_id=$1 returning id`, [userId, input.matchId, input.runId, input.action, reason]);
    if (!result.rows[0]) bad("Partnership not found.", 404);
    await client.query(`update public.matches set saved_at=$3,updated_at=now() where id=$1 and user_id=$2`,
      [input.matchId, userId, input.action === "save" ? new Date() : null]);
    await client.query("commit");
    return { id: result.rows[0].id, action: input.action };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function undoPersonalFeedback(userId, feedbackId) {
  if (!uuid(feedbackId)) return false;
  const client = await db().connect();
  try {
    await client.query("begin");
    const changed = await client.query(`update public.feedback set undone_at=now()
      where id=$1 and user_id=$2 and undone_at is null returning match_id`, [feedbackId, userId]);
    if (!changed.rows[0]) { await client.query("rollback"); return false; }
    const matchId = changed.rows[0].match_id;
    const effective = await client.query(`select action from public.feedback where match_id=$1 and user_id=$2
      and undone_at is null order by created_at desc,id desc limit 1`, [matchId, userId]);
    await client.query(`update public.matches set saved_at=$3,updated_at=now() where id=$1 and user_id=$2`,
      [matchId, userId, effective.rows[0]?.action === "save" ? new Date() : null]);
    await client.query("commit");
    return true;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function updatePersonalBrief(userId, briefId, input) {
  if (!uuid(briefId) || !Number.isInteger(input?.revision) || typeof input?.markdown !== "string") bad("Check the brief before saving.");
  const markdown = input.markdown.trim();
  if (markdown.length < 20 || markdown.length > 20000) bad("Keep the brief between 20 and 20,000 characters.");
  const changed = await db().query(`update public.briefs set content_markdown=$3,revision=revision+1,updated_at=now()
    where id=$1 and user_id=$2 and revision=$4 and validity_status='valid'
    returning revision,content_markdown as markdown`, [briefId, userId, markdown, input.revision]);
  if (changed.rows[0]) return changed.rows[0];
  const exists = await db().query("select revision from public.briefs where id=$1 and user_id=$2", [briefId, userId]);
  if (!exists.rows[0]) bad("Brief not found.", 404);
  bad("This brief changed since you opened it. Reload before saving.", 409);
}

// Proposal drafts are user-triggered only; scoring never creates concepts or briefs.
export async function createPersonalProposal(userId, matchId) {
  if (!uuid(matchId)) bad("Partnership not found.", 404);
  const client = await db().connect();
  try {
    await client.query("begin");
    const match = await client.query(`select m.id,
        seed.canonical_name as "seedName",partner.canonical_name as "partnerName",r.objective,
        (select external_id from catalog.entity_identifiers where entity_id=m.brand_entity_id and provider='wikidata' and status='confirmed' limit 1) as "seedQid",
        (select external_id from catalog.entity_identifiers where entity_id=m.partner_entity_id and provider='wikidata' and status='confirmed' limit 1) as "partnerQid"
      from public.matches m
      join catalog.entities seed on seed.id=m.brand_entity_id
      join catalog.entities partner on partner.id=m.partner_entity_id
      join public.analysis_runs r on r.id=m.analysis_run_id
      where m.id=$1 and m.user_id=$2`, [matchId, userId]);
    if (!match.rows[0]) { await client.query("rollback"); bad("Partnership not found.", 404); }
    const existing = await client.query(`select id,content_markdown as markdown,revision from public.briefs
      where match_id=$1 and user_id=$2 order by updated_at desc limit 1`, [matchId, userId]);
    if (existing.rows[0]) {
      await client.query("commit");
      return { id: existing.rows[0].id, markdown: existing.rows[0].markdown,
        revision: existing.rows[0].revision, reused: true };
    }
    const assessment = await client.query(`select id,score_json from public.assessment_snapshots
      where match_id=$1 and user_id=$2 order by version desc limit 1`, [matchId, userId]);
    if (!assessment.rows[0]) { await client.query("rollback"); bad("Research must finish before a proposal can start.", 409); }
    const row = match.rows[0];
    const scoreJson = assessment.rows[0].score_json ?? {};
    const title = `${row.seedName} × ${row.partnerName}: research hypothesis`;
    const draft = { title, format: "Exploratory partnership discussion",
      hypothesis: Number.isFinite(scoreJson.displayScore)
        ? `The evidence-based opportunity index is ${scoreJson.displayScore}/100; confirm interest and terms before any commitment.`
        : scoreJson.status === "excluded"
          ? "This pair is excluded by a verified constraint; keep this draft for records only."
          : "A cultural connection has not been fully evidenced yet; verify the open questions first.",
      roles: { seed: "Clarify the partnership goal and the audience question.",
        partner: "Confirm interest and a complementary contribution." },
      deliverable: "A small pilot only after both brands validate the cultural angle.",
      validation: "Find original campaign examples for both brands, verify the connection, then check feasibility and interest." };
    const concept = await client.query(`insert into public.concepts(user_id,match_id,base_assessment_id,version,title,format,draft_json)
      values($1,$2,$3,1,$4,$5,$6::jsonb) returning id`,
      [userId, matchId, assessment.rows[0].id, title.slice(0, 300), draft.format, JSON.stringify(draft)]);
    const markdown = proposalTemplate({ seedName: row.seedName, partnerName: row.partnerName,
      objective: row.objective,
      sourceUrls: [row.seedQid, row.partnerQid]
        .filter((qid) => /^Q[1-9]\d*$/.test(qid ?? ""))
        .map((qid) => `https://www.wikidata.org/wiki/${qid}`) });
    const brief = await client.query(`insert into public.briefs(user_id,match_id,concept_id,assessment_id,content_markdown)
      values($1,$2,$3,$4,$5) returning id,revision`, [userId, matchId, concept.rows[0].id, assessment.rows[0].id, markdown]);
    await client.query("commit");
    return { id: brief.rows[0].id, markdown, revision: brief.rows[0].revision, reused: false };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function claimPersonalRun(id = workerId) {
  const result = await db().query(`with ready as (
    select id from public.analysis_runs where
      ((status='queued' and available_at<=now()) or (status='running' and lease_until<now()))
      and attempt<3 and (constraints_json->>'sample'='true' or constraints_json->>'researchMode' in ('live_youtube','live_brand'))
    order by available_at,created_at for update skip locked limit 1
  ) update public.analysis_runs r set status='running',stage=case
    when r.constraints_json->>'researchMode'='live_youtube' then 'Collecting public YouTube metadata'
    when r.constraints_json->>'researchMode'='live_brand' and r.kind='discovery' then 'Finding brand partners'
    when r.constraints_json->>'researchMode'='live_brand' then 'Checking the selected brands'
    else 'Preparing sample preview' end,
    attempt=attempt+1,lease_until=now()+interval '2 minutes',worker_id=$1,updated_at=now()
    from ready where r.id=ready.id returning r.id,r.user_id,r.project_id,r.seed_entity_id,
    r.specified_partner_id,r.objective,r.kind,r.match_type,r.constraints_json,r.plan_json,r.feedback_snapshot_json,r.attempt`, [id]);
  return result.rows[0] ?? null;
}

export async function processPersonalRun(run, id = workerId) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const locked = await client.query(`select status,worker_id from public.analysis_runs where id=$1 for update`, [run.id]);
    if (locked.rows[0]?.status !== "running" || locked.rows[0]?.worker_id !== id) {
      await client.query("rollback"); return false;
    }
    const variant = run.constraints_json.partnerType;
    const partnerId = run.specified_partner_id ?? await sampleEntity(client, variant);
    const excluded = run.feedback_snapshot_json?.events?.some((item) =>
      item.partner_entity_id === partnerId && item.action === "reject");
    if (excluded) {
      await client.query(`update public.analysis_runs set status='partial',stage='Complete',
        result_json='{"sample":true,"message":"The sample partner was passed over in earlier feedback."}'::jsonb,
        finished_at=now(),lease_until=null,worker_id=null,updated_at=now() where id=$1`, [run.id]);
      await client.query("commit"); return true;
    }
    const seed = await client.query("select canonical_name from catalog.entities where id=$1", [run.seed_entity_id]);
    const partner = sample[variant];
    const match = await client.query(`insert into public.matches(user_id,analysis_run_id,brand_entity_id,partner_entity_id)
      values ($1,$2,$3,$4) on conflict (analysis_run_id,partner_entity_id) do update set updated_at=public.matches.updated_at
      returning id`, [run.user_id, run.id, run.seed_entity_id, partnerId]);
    const matchId = match.rows[0].id;
    const previous = await client.query("select id from public.assessment_snapshots where match_id=$1 and version=1", [matchId]);
    if (!previous.rows[0]) {
      const frozen = await samplePreviewEvidence({ userId: run.user_id, seedEntityId: run.seed_entity_id,
        partnerEntityId: partnerId, objective: run.objective, variant });
      const score = { status: "unscored", reason: "No verified evidence; no fit or opportunity score is available." };
      const assessment = await client.query(`insert into public.assessment_snapshots(user_id,match_id,version,objective,input_hash,
        scoring_version,evidence_json,score_json,source_refs_json,qloo_response_ids)
        values ($1,$2,1,$3,$4,'unscored-sample-v1',$5::jsonb,$6::jsonb,$7::jsonb,$8::uuid[]) returning id`,
      [run.user_id, matchId, run.objective, frozen.inputHash, JSON.stringify(frozen.evidence), JSON.stringify(score),
        JSON.stringify(frozen.sourceRefsJson), frozen.qlooResponseIds]);
      const title = `${seed.rows[0].canonical_name} × ${partner.name}: sample pilot`;
      const draft = { sample: true, title, format: variant === "creator" ? "Sample content pilot" : "Sample co-created pilot",
        hypothesis: "Explore a partnership only after both parties confirm a specific cultural connection and practical fit.",
        roles: { seed: "Define the goal and provide the brand perspective.", partner: "Confirm interest and propose a complementary contribution." },
        deliverable: "A small pilot agreed by both partners.", validation: "Verify source evidence, audience relevance, rights, budget and willingness to participate." };
      const concept = await client.query(`insert into public.concepts(user_id,match_id,base_assessment_id,version,title,format,draft_json)
        values ($1,$2,$3,1,$4,$5,$6::jsonb) returning id`,
      [run.user_id, matchId, assessment.rows[0].id, title, draft.format, JSON.stringify(draft)]);
      const markdown = proposalTemplate({ seedName: seed.rows[0].canonical_name,
        partnerName: partner.name, objective: run.objective, sample: true });
      await client.query(`insert into public.briefs(user_id,match_id,concept_id,assessment_id,content_markdown)
        values ($1,$2,$3,$4,$5)`, [run.user_id, matchId, concept.rows[0].id, assessment.rows[0].id, markdown]);
    }
    await client.query(`update public.analysis_runs set status='completed',stage='Complete',
      result_json=$2::jsonb,finished_at=now(),lease_until=null,worker_id=null,updated_at=now()
      where id=$1`, [run.id, JSON.stringify({ sample: true, count: 1, message: "Sample workflow preview. No live evidence or scores were used." })]);
    await client.query("commit");
    return true;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function failPersonalRun(run, error, id = workerId) {
  const terminal = run.attempt >= 3;
  await db().query(`update public.analysis_runs set status=$3,stage=$4,error_code=$6,
    available_at=case when $5 then available_at else now()+interval '10 seconds' end,
    lease_until=null,worker_id=null,finished_at=case when $5 then now() else null end,updated_at=now()
    where id=$1 and worker_id=$2 and status='running'`,
  [run.id, id, terminal ? "failed" : "queued", terminal ? "Complete" : "Retrying research", terminal,
    run.constraints_json?.researchMode === "live_youtube" ? "creator_research_unavailable"
      : run.constraints_json?.researchMode === "live_brand" ? "brand_research_unavailable" : "sample_preview_failed"]);
  if (process.env.DEBUG_PERSONAL_RUNS === "1") process.stderr.write(`Personal run failed: ${error instanceof Error ? error.message : String(error)}\n`);
}

export async function workOnePersonalRun(id = workerId) {
  await db().query(`update public.analysis_runs set status='failed',stage='Complete',
    error_code='sample_preview_retry_exhausted',lease_until=null,worker_id=null,
    finished_at=now(),updated_at=now() where status='running' and lease_until<now()
    and attempt>=3 and (constraints_json->>'sample'='true' or constraints_json->>'researchMode' in ('live_youtube','live_brand'))`);
  const run = await claimPersonalRun(id);
  if (!run) return false;
  const heartbeat = run.constraints_json?.researchMode === "live_youtube" ? setInterval(() => {
    db().query(`update public.analysis_runs set lease_until=now()+interval '2 minutes'
      where id=$1 and worker_id=$2 and status='running'`, [run.id, id]).catch(() => {});
  }, 30000) : null;
  heartbeat?.unref();
  try { await (run.constraints_json?.researchMode === "live_youtube"
    ? processCreatorResearchRun(run, id)
    : run.constraints_json?.researchMode === "live_brand" && run.kind === "discovery"
      ? processPersonalBrandDiscoveryRun(run, id)
      : run.constraints_json?.researchMode === "live_brand" ? processPersonalBrandRun(run, id)
      : processPersonalRun(run, id)); }
  catch (error) { await failPersonalRun(run, error, id); }
  finally { if (heartbeat) clearInterval(heartbeat); }
  return true;
}
