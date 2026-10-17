import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("="); return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Pool({ connectionString: vars.DB_URL });
const suffix = randomUUID().slice(0, 8);
let userId; let seedId; let creatorId;
try {
  const created = await admin.auth.admin.createUser({ email: `youtube-retention-${suffix}@example.test`,
    password: `Local-${randomUUID()}!`, email_confirm: true });
  assert.ifError(created.error);
  userId = created.data.user.id;
  seedId = (await db.query("insert into catalog.entities(kind,canonical_name) values ('brand',$1) returning id", [`SAMPLE US brand ${suffix}`])).rows[0].id;
  creatorId = (await db.query("insert into catalog.entities(kind,canonical_name) values ('youtube_creator',$1) returning id", [`SAMPLE US creator ${suffix}`])).rows[0].id;
  const rights = { storage: "permitted", cross_user_reuse: "permitted" };
  await assert.rejects(db.query(`insert into catalog.source_items(entity_id,platform,source_type,source_url,
    collected_at,expires_at,rights_json,provider_operation,request_hash,sample_data)
    values ($1,'youtube','video_metadata',$2,now(),now()+interval '30 days',$3::jsonb,
      'videos.list',$4,true)`, [creatorId, `https://www.youtube.com/watch?v=long${suffix}`, JSON.stringify(rights), "b".repeat(64)]),
  /youtube_source_retention_check/);
  await assert.rejects(db.query(`insert into private.provider_cache(provider,resource_type,resource_key,request_hash,
    scope,payload_json,payload_hash,fetched_at,fresh_until,retain_until)
    values ('youtube_transcript','transcript',$1,$2,'shared','{}'::jsonb,$2,now(),now()+interval '1 day',now()+interval '2 days')`,
  [suffix, "c".repeat(64)]), /provider_cache_provider_check/);
  const target = (await db.query(`insert into catalog.source_items(entity_id,platform,source_type,source_url,
    collected_at,expires_at,rights_json,provider_operation,request_hash,sample_data)
    values ($1,'youtube','video_metadata',$2,now()-interval '31 days',now()-interval '2 days',$3::jsonb,
      'videos.list',$4,true) returning id`, [creatorId, `https://www.youtube.com/watch?v=abc${suffix}`, JSON.stringify(rights), "a".repeat(64)])).rows[0].id;
  const other = (await db.query(`insert into catalog.source_items(entity_id,platform,source_type,source_url,
    expires_at,rights_json,sample_data) values ($1,'web','official_page',$2,now()+interval '20 days',$3::jsonb,true) returning id`,
  [creatorId, `https://example.org/sample-${suffix}`, JSON.stringify(rights)])).rows[0].id;
  await db.query(`insert into catalog.cultural_intelligence(entity_id,version,claims_json)
    values ($1,1,$2::jsonb)`, [creatorId, JSON.stringify([
    { label: "SAMPLE expired", source_refs: [{ kind: "catalog_item", id: target }] },
    { label: "SAMPLE independent", source_refs: [{ kind: "catalog_item", id: other }] },
  ])]);
  const runId = (await db.query(`insert into public.analysis_runs(user_id,seed_entity_id,specified_partner_id,kind,match_type,objective,idempotency_key)
    values ($1,$2,$3,'direct_pair','brand_youtube_creator','content_collaboration',$4) returning id`,
  [userId, seedId, creatorId, suffix])).rows[0].id;
  const matchId = (await db.query(`insert into public.matches(user_id,analysis_run_id,brand_entity_id,partner_entity_id)
    values ($1,$2,$3,$4) returning id`, [userId, runId, seedId, creatorId])).rows[0].id;
  const assessments = [];
  for (const [index, sourceId] of [target, other].entries()) {
    const assessmentId = (await db.query(`insert into public.assessment_snapshots(user_id,match_id,version,objective,input_hash,
      scoring_version,evidence_json,score_json,source_refs_json)
      values ($1,$2,$3,'content_collaboration',$4,'fixture-v1',$5::jsonb,'{}'::jsonb,$6::jsonb) returning id`,
    [userId, matchId, index + 1, String(index + 1).repeat(64), JSON.stringify({ sample: true }),
      JSON.stringify([{ kind: "catalog_item", id: sourceId }])])).rows[0].id;
    const conceptId = (await db.query(`insert into public.concepts(user_id,match_id,base_assessment_id,version,title,draft_json)
      values ($1,$2,$3,$4,$5,'{}'::jsonb) returning id`,
    [userId, matchId, assessmentId, index + 1, `SAMPLE concept ${index}`])).rows[0].id;
    await db.query(`insert into public.briefs(user_id,match_id,concept_id,assessment_id,content_markdown)
      values ($1,$2,$3,$4,'SAMPLE brief')`, [userId, matchId, conceptId, assessmentId]);
    assessments.push(assessmentId);
  }
  assert.equal((await db.query("select private.purge_due_youtube_sources(10) as count")).rows[0].count, 1);
  assert.equal((await db.query("select count(*) from catalog.source_items where id=$1", [target])).rows[0].count, "0");
  const rows = (await db.query(`select id,validity_status from public.assessment_snapshots where match_id=$1 order by version`, [matchId])).rows;
  assert.deepEqual(rows.map((row) => row.validity_status), ["redacted", "valid"]);
  assert.deepEqual((await db.query(`select status from public.concepts where match_id=$1 order by version`, [matchId])).rows.map((row) => row.status), ["invalidated", "draft"]);
  assert.deepEqual((await db.query(`select validity_status from public.briefs where match_id=$1 order by created_at,id`, [matchId])).rows.map((row) => row.validity_status).sort(), ["redacted", "valid"]);
  const claims = (await db.query("select claims_json from catalog.cultural_intelligence where entity_id=$1", [creatorId])).rows[0].claims_json;
  assert.deepEqual(claims.map((claim) => claim.label), ["SAMPLE independent"]);
  assert.equal((await db.query("select private.purge_due_youtube_sources(10) as count")).rows[0].count, 0);
  console.log("Local YouTube retention check passed: expired source purged; only dependent claim, assessment, concept and brief redacted.");
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (creatorId) { await db.query("delete from catalog.cultural_intelligence where entity_id=$1", [creatorId]); await db.query("delete from catalog.source_items where entity_id=$1", [creatorId]); }
  if (creatorId) await db.query("delete from catalog.entities where id=$1", [creatorId]);
  if (seedId) await db.query("delete from catalog.entities where id=$1", [seedId]);
  await db.end();
}
