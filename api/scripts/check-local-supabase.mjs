import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createProject, getProject, listProjects, updateProject } from "../src/projects.mjs";

const statusPath = process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env";
const raw = await readFile(statusPath, "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) {
  throw new Error("This check runs only against local Supabase.");
}
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const userA = createClient(vars.API_URL, vars.ANON_KEY, options);
const userB = createClient(vars.API_URL, vars.ANON_KEY, options);
const anonymous = createClient(vars.API_URL, vars.ANON_KEY, options);
const pool = new pg.Pool({ connectionString: vars.DB_URL });
process.env.DATABASE_URL = vars.DB_URL;
const suffix = randomUUID().slice(0, 8);
const emailA = `crossculture-check-a-${suffix}@example.test`;
const emailB = `crossculture-check-b-${suffix}@example.test`;
const password = `LocalCheck-${randomUUID()}!`;
const created = [];
let brandId;
let creatorId;

try {
  for (const [client, email] of [[userA, emailA], [userB, emailB]]) {
    const { data: signup, error: signUpError } = await client.auth.signUp({ email, password });
    assert.ifError(signUpError);
    assert.ok(signup.user?.id);
    assert.equal(signup.session, null, "Email confirmation should be required locally");
    created.push(signup.user.id);
    const { error: confirmError } = await admin.auth.admin.updateUserById(signup.user.id, { email_confirm: true });
    assert.ifError(confirmError);
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signInError);
    assert.ok(signedIn.session?.access_token);
    const { data: verified, error: verifyError } = await admin.auth.getUser(signedIn.session.access_token);
    assert.ifError(verifyError);
    assert.equal(verified.user.id, signup.user.id);
  }

  const entities = await pool.query(
    "insert into catalog.entities(kind,canonical_name) values ('brand',$1),('youtube_creator',$2) returning id",
    [`Sample brand ${suffix}`, `Sample creator ${suffix}`],
  );
  [brandId, creatorId] = entities.rows.map((row) => row.id);
  await pool.query("insert into catalog.entity_identifiers(entity_id,provider,external_id,status) values ($1,'qloo',$2,'confirmed')", [brandId, `sample-qloo-${suffix}`]);
  const project = await createProject(created[0], { seedEntityId: brandId, name: "Sample partnership", objective: "content_collaboration" });
  assert.equal(project.seedEntityId, brandId);
  assert.equal((await listProjects(created[0])).length, 1);
  assert.equal((await listProjects(created[1])).length, 0);
  assert.equal(await getProject(created[1], project.id), null);
  assert.equal(await updateProject(created[1], project.id, { name: "Intrusion", objective: "awareness", notes: "No" }), null);
  const edited = await updateProject(created[0], project.id, { name: "Working partnership", objective: "co_created_product", notes: "Ask both teams about timing." });
  assert.equal(edited.notes, "Ask both teams about timing.");
  await assert.rejects(createProject(created[0], { seedEntityId: brandId, name: "Legacy goal", objective: "awareness" }), /goal/);
  await assert.rejects(updateProject(created[0], project.id, { name: "Working partnership", objective: "new_audience", notes: "" }), /goal/);
  await pool.query("update public.projects set objective='awareness' where id=$1", [project.id]);
  const legacyEdited = await updateProject(created[0], project.id, { name: "Historical partnership", objective: "awareness", notes: "Preserved notes." });
  assert.equal(legacyEdited.objective, "awareness");
  assert.equal(legacyEdited.notes, "Preserved notes.");
  const ownProjects = await userA.from("projects").select("id,name");
  const otherProjects = await userB.from("projects").select("id,name");
  const anonProjects = await anonymous.from("projects").select("id");
  assert.ifError(ownProjects.error);
  assert.ifError(otherProjects.error);
  assert.deepEqual(ownProjects.data.map((row) => row.id), [project.id]);
  assert.equal(otherProjects.data.length, 0);
  assert.ok(anonProjects.error || anonProjects.data.length === 0);
  const runA = randomUUID();
  const runB = randomUUID();
  await pool.query(
    `insert into public.analysis_runs(id,user_id,seed_entity_id,kind,match_type,objective,idempotency_key)
     values ($1,$2,$5,'discovery','brand_youtube_creator','awareness',$6),
            ($3,$4,$5,'discovery','brand_youtube_creator','awareness',$7)`,
    [runA, created[0], runB, created[1], brandId, `a-${suffix}`, `b-${suffix}`],
  );
  const aRows = await userA.from("analysis_runs").select("id,user_id");
  const bRows = await userB.from("analysis_runs").select("id,user_id");
  assert.ifError(aRows.error);
  assert.ifError(bRows.error);
  assert.deepEqual(aRows.data.map((row) => row.id), [runA]);
  assert.deepEqual(bRows.data.map((row) => row.id), [runB]);
  const anonRows = await anonymous.from("analysis_runs").select("id");
  assert.ok(anonRows.error || anonRows.data.length === 0, "Anonymous caller saw private runs");

  await assert.rejects(
    pool.query(
      "insert into public.matches(user_id,analysis_run_id,brand_entity_id,partner_entity_id) values ($1,$2,$3,$4)",
      [created[1], runA, brandId, creatorId],
    ),
    (error) => error.code === "23503" || error.code === "23514",
  );
  await assert.rejects(pool.query(
    `insert into public.analysis_runs(user_id,seed_entity_id,project_id,kind,match_type,objective,idempotency_key)
     values ($1,$2,$3,'discovery','brand_brand','awareness',$4)`,
    [created[1], brandId, project.id, `cross-owner-${suffix}`],
  ), (error) => error.code === "23503");
  const { error: resetError } = await userA.auth.resetPasswordForEmail(emailA, { redirectTo: "http://localhost:3000/auth/callback?next=/auth/reset" });
  assert.ifError(resetError);
  console.log("Local Supabase auth, project write/read, two-user RLS and cross-user FK checks passed.");
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id);
  if (brandId) await pool.query("delete from catalog.entities where id = $1", [brandId]);
  if (creatorId) await pool.query("delete from catalog.entities where id = $1", [creatorId]);
  await pool.end();
}
