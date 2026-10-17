import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, processPersonalRun, getPersonalRun,
  listPersonalRuns, recordPersonalFeedback, undoPersonalFeedback, updatePersonalBrief, workOnePersonalRun } from "../src/personal-research.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
process.env.DATABASE_URL = vars.DB_URL;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const userA = createClient(vars.API_URL, vars.ANON_KEY, options);
const userB = createClient(vars.API_URL, vars.ANON_KEY, options);
const anonymous = createClient(vars.API_URL, vars.ANON_KEY, options);
const pool = new pg.Pool({ connectionString: vars.DB_URL });
const suffix = randomUUID().slice(0, 8);
const password = `LocalCheck-${randomUUID()}!`;
const users = [];
let seedId;
let apiProcess;

try {
  for (const [client, label] of [[userA, "a"], [userB, "b"]]) {
    const email = `crossculture-preview-${label}-${suffix}@example.test`;
    const { data: signup, error } = await client.auth.signUp({ email, password });
    assert.ifError(error);
    users.push(signup.user.id);
    assert.ifError((await admin.auth.admin.updateUserById(signup.user.id, { email_confirm: true })).error);
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  }
  seedId = (await pool.query("insert into catalog.entities(kind,canonical_name) values ('brand',$1) returning id", [`Sample seed ${suffix}`])).rows[0].id;
  await pool.query("insert into catalog.entity_identifiers(entity_id,provider,external_id,status) values ($1,'qloo',$2,'confirmed')", [seedId, `mock-${suffix}`]);
  const project = await createProject(users[0], { seedEntityId: seedId, name: "Sample research", objective: "content_collaboration" });
  const input = { projectId: project.id, mode: "discovery", partnerType: "brand", idempotencyKey: randomUUID() };
  const first = await startPersonalRun(users[0], input);
  assert.equal((await startPersonalRun(users[0], input)).runId, first.runId);
  await assert.rejects(startPersonalRun(users[1], { ...input, idempotencyKey: randomUUID() }), (error) => error.statusCode === 404);
  assert.equal(await getPersonalRun(users[1], first.runId), null);
  const claimed = await claimPersonalRun("worker-old");
  assert.equal(claimed.id, first.runId);
  await pool.query("update public.analysis_runs set lease_until=now()-interval '1 second' where id=$1", [first.runId]);
  const recovered = await claimPersonalRun("worker-new");
  assert.equal(recovered.id, first.runId);
  assert.equal(recovered.attempt, 2);
  assert.equal(await processPersonalRun(claimed, "worker-old"), false);
  assert.equal(await processPersonalRun(recovered, "worker-new"), true);
  const completed = await getPersonalRun(users[0], first.runId);
  assert.equal(completed.status, "completed");
  assert.equal(completed.matches.length, 1);
  assert.equal(completed.matches[0].evidence.sample, true);
  assert.equal(completed.matches[0].evidence.contractVersion, 1);
  assert.equal(completed.matches[0].evidence.sources[0].kind, "sample_fixture");
  assert.equal(completed.matches[0].evidence.claims[0].sourceIds[0], completed.matches[0].evidence.sources[0].id);
  assert.equal(completed.matches[0].score.status, "unscored");
  const frozen = await pool.query(`select source_refs_json,qloo_response_ids,input_hash
    from public.assessment_snapshots where id=$1`, [completed.matches[0].assessmentId]);
  assert.equal(frozen.rows[0].source_refs_json[0].kind, "sample_fixture");
  assert.deepEqual(frozen.rows[0].qloo_response_ids, []);
  assert.match(frozen.rows[0].input_hash, /^[a-f0-9]{64}$/);
  assert.match(completed.matches[0].briefMarkdown, /SAMPLE PREVIEW/);
  const counts = await pool.query(`select
    (select count(*) from public.assessment_snapshots where match_id=$1) as assessments,
    (select count(*) from public.concepts where match_id=$1) as concepts,
    (select count(*) from public.briefs where match_id=$1) as briefs`, [completed.matches[0].id]);
  assert.deepEqual(Object.values(counts.rows[0]).map(Number), [1, 1, 1]);
  const own = await userA.from("analysis_runs").select("id").eq("id", first.runId);
  const other = await userB.from("analysis_runs").select("id").eq("id", first.runId);
  const anon = await anonymous.from("analysis_runs").select("id").eq("id", first.runId);
  assert.ifError(own.error); assert.ifError(other.error);
  assert.equal(own.data.length, 1);
  assert.equal(other.data.length, 0);
  assert.ok(anon.error || anon.data.length === 0);
  const matchId = completed.matches[0].id;
  const saved = await recordPersonalFeedback(users[0], { runId: first.runId, matchId, action: "save" });
  assert.ok((await getPersonalRun(users[0], first.runId)).matches[0].savedAt);
  assert.equal(await undoPersonalFeedback(users[1], saved.id), false);
  assert.equal(await undoPersonalFeedback(users[0], saved.id), true);
  assert.equal((await getPersonalRun(users[0], first.runId)).matches[0].savedAt, null);
  await recordPersonalFeedback(users[0], { runId: first.runId, matchId, action: "reject" });
  const second = await startPersonalRun(users[0], { ...input, idempotencyKey: randomUUID() });
  const next = await claimPersonalRun("worker-feedback");
  assert.equal(next.id, second.runId);
  await processPersonalRun(next, "worker-feedback");
  assert.equal((await getPersonalRun(users[0], second.runId)).status, "partial");
  assert.equal((await listPersonalRuns(users[0], project.id)).length, 2);
  const creator = await startPersonalRun(users[0], { projectId: project.id, mode: "direct_pair", partnerType: "creator", idempotencyKey: randomUUID() });
  const creatorClaim = await claimPersonalRun("worker-creator");
  assert.equal(creatorClaim.id, creator.runId);
  assert.equal(await processPersonalRun(creatorClaim, "worker-creator"), true);
  const creatorRun = await getPersonalRun(users[0], creator.runId);
  assert.equal(creatorRun.status, "completed");
  assert.equal(creatorRun.matches[0].partnerName, "Sample YouTube creator");
  assert.equal(creatorRun.matches[0].evidence.sample, true);
  const exhausted = await startPersonalRun(users[0], { projectId: project.id, mode: "direct_pair", partnerType: "creator", idempotencyKey: randomUUID() });
  await pool.query(`update public.analysis_runs set status='running',attempt=3,lease_until=now()-interval '1 second',worker_id='lost-worker' where id=$1`, [exhausted.runId]);
  await workOnePersonalRun("worker-reaper");
  assert.equal((await getPersonalRun(users[0], exhausted.runId)).status, "failed");
  const brief = completed.matches[0];
  const changed = await updatePersonalBrief(users[0], brief.briefId, { revision: brief.briefRevision, markdown: `${brief.briefMarkdown}\n\nUser question: Can both teams commit?` });
  assert.equal(changed.revision, 2);
  await assert.rejects(updatePersonalBrief(users[0], brief.briefId, { revision: 1, markdown: brief.briefMarkdown }), (error) => error.statusCode === 409);
  await assert.rejects(updatePersonalBrief(users[1], brief.briefId, { revision: 2, markdown: brief.briefMarkdown }), (error) => error.statusCode === 404);
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const apiPort = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  apiProcess = spawn(process.execPath, ["src/server.mjs"], { cwd: new URL("../", import.meta.url),
    env: { ...process.env, API_HOST: "127.0.0.1", API_PORT: String(apiPort), SUPABASE_URL: vars.API_URL, SUPABASE_ANON_KEY: vars.ANON_KEY },
    stdio: "ignore" });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { ready = (await fetch(`http://127.0.0.1:${apiPort}/health`)).ok; if (ready) break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, "Personal API did not start locally");
  const tokenA = (await userA.auth.getSession()).data.session.access_token;
  const tokenB = (await userB.auth.getSession()).data.session.access_token;
  const route = `http://127.0.0.1:${apiPort}/personal/runs/${first.runId}`;
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await fetch(route, { headers: { authorization: `Bearer ${tokenB}` } })).status, 404);
  const owned = await fetch(route, { headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(owned.status, 200);
  assert.equal((await owned.json()).run.matches[0].id, matchId);
  for (const objective of ["awareness", "new_audience"]) {
    await pool.query("update public.projects set objective=$2 where id=$1", [project.id, objective]);
    assert.equal((await getPersonalRun(users[0], first.runId)).matches[0].id, matchId);
    for (const partnerType of ["brand", "creator"]) for (const mode of ["discovery", "direct_pair"]) {
      await assert.rejects(startPersonalRun(users[0], { projectId: project.id, mode, partnerType,
        idempotencyKey: randomUUID() }), /not available/);
    }
  }
  await pool.query("update public.projects set objective='repositioning' where id=$1", [project.id]);
  for (const mode of ["discovery", "direct_pair"]) {
    await assert.rejects(startPersonalRun(users[0], { projectId: project.id, mode, partnerType: "brand",
      idempotencyKey: randomUUID() }), /positioning direction/);
    await assert.rejects(startPersonalRun(users[0], { projectId: project.id, mode, partnerType: "creator",
      positioningDirection: "Contemporary craft", idempotencyKey: randomUUID() }), /not available/);
  }
  const positioningInput = { projectId: project.id, mode: "discovery", partnerType: "brand",
    positioningDirection: "  Contemporary craft  ", idempotencyKey: randomUUID() };
  const positioningRun = await startPersonalRun(users[0], positioningInput);
  assert.equal((await startPersonalRun(users[0], positioningInput)).runId, positioningRun.runId);
  const positioningRow = await pool.query("select objective,constraints_json from public.analysis_runs where id=$1", [positioningRun.runId]);
  assert.equal(positioningRow.rows[0].objective, "repositioning");
  assert.equal(positioningRow.rows[0].constraints_json.positioningDirection, "Contemporary craft");
  assert.equal((await getPersonalRun(users[0], positioningRun.runId)).positioningDirection, "Contemporary craft");
  await assert.rejects(startPersonalRun(users[0], { ...positioningInput,
    positioningDirection: "Another direction" }), /already been used/);
  await pool.query("update public.analysis_runs set status='failed' where id=$1", [positioningRun.runId]);
  for (const [objective, partnerTypes] of [
    ["co_created_product", ["brand"]],
    ["content_collaboration", ["brand", "creator"]],
    ["repositioning", ["brand"]],
    ["sponsorship", ["creator"]],
  ]) {
    await pool.query("update public.projects set objective=$2 where id=$1", [project.id, objective]);
    for (const partnerType of partnerTypes) for (const mode of ["discovery", "direct_pair"]) {
      const allowed = await startPersonalRun(users[0], { projectId: project.id, mode, partnerType,
        ...(objective === "repositioning" ? { positioningDirection: "Contemporary craft" } : {}),
        idempotencyKey: randomUUID() });
      const stored = await pool.query("select objective,match_type,kind,constraints_json from public.analysis_runs where id=$1", [allowed.runId]);
      assert.equal(stored.rows[0].objective, objective);
      assert.equal(stored.rows[0].match_type, partnerType === "brand" ? "brand_brand" : "brand_youtube_creator");
      assert.equal(stored.rows[0].kind, mode);
      if (objective === "repositioning") assert.equal(stored.rows[0].constraints_json.positioningDirection, "Contemporary craft");
      await pool.query("update public.analysis_runs set status='failed' where id=$1", [allowed.runId]);
    }
  }
  await pool.query("update public.projects set objective='sponsorship' where id=$1", [project.id]);
  for (const mode of ["discovery", "direct_pair"]) {
    await assert.rejects(startPersonalRun(users[0], { projectId: project.id, mode, partnerType: "brand",
      idempotencyKey: randomUUID() }), /not available/);
  }
  await pool.query("update public.projects set objective='co_created_product' where id=$1", [project.id]);
  for (const mode of ["discovery", "direct_pair"]) {
    await assert.rejects(startPersonalRun(users[0], { projectId: project.id, mode, partnerType: "creator",
      idempotencyKey: randomUUID() }), /not available/);
  }
  console.log("Personal sample discovery/direct pair, restart recovery, immutable assessment, feedback, brief revision and two-user isolation passed.");
} finally {
  if (apiProcess) apiProcess.kill("SIGTERM");
  for (const id of users) await admin.auth.admin.deleteUser(id);
  if (seedId) await pool.query("delete from catalog.entities where id=$1", [seedId]);
  await pool.end();
}
