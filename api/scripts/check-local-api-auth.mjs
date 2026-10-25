import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:")) throw new Error("Local Supabase only.");
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const publicClient = createClient(vars.API_URL, vars.ANON_KEY, options);
const email = `crossculture-api-check-${randomUUID().slice(0, 8)}@example.test`;
const password = `LocalCheck-${randomUUID()}!`;
const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
assert.ifError(createError);
const server = spawn(process.execPath, ["src/server.mjs"], {
  cwd: new URL("../", import.meta.url).pathname,
  env: { ...process.env, API_HOST: "127.0.0.1", API_PORT: "8799", SUPABASE_URL: vars.API_URL,
    SUPABASE_ANON_KEY: vars.ANON_KEY, DATABASE_URL: vars.DB_URL, RESEARCH_WORKER_FUNCTION_NAME: "" },
  stdio: "ignore",
});
const base = "http://127.0.0.1:8799";
const database = new pg.Client({ connectionString: vars.DB_URL });
await database.connect();

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "API did not start");
  assert.equal((await fetch(`${base}/internal/research/wake`, { method: "POST" })).status, 404);
  const anonymous = await fetch(`${base}/me`);
  assert.equal(anonymous.status, 401);
  assert.equal((await fetch(`${base}/youtube/runs`)).status, 404);
  const spoofed = await fetch(`${base}/me`, { headers: { authorization: "Bearer invalid", "x-user-id": created.user.id } });
  assert.equal(spoofed.status, 401);
  const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
  assert.ifError(signInError);
  const headers = { authorization: `Bearer ${signedIn.session.access_token}` };
  const verified = await fetch(`${base}/me`, { headers });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).id, created.user.id);
  const retiredCreatorRuns = await fetch(`${base}/youtube/runs`, { headers });
  assert.equal(retiredCreatorRuns.status, 404);
  const retiredCreatorStart = await fetch(`${base}/youtube/runs`, { method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ resolutionId: randomUUID(), qlooId: randomUUID(),
      campaignMode: "ongoing" }) });
  assert.equal(retiredCreatorStart.status, 404);
  for (const route of ["/demo/entities/resolve", "/runs", "/pairs", "/concepts/test"]) {
    const retired = await fetch(`${base}${route}`, { method: "POST", headers });
    assert.equal(retired.status, 404, `${route} must be retired`);
  }
  const retiredCreatorLookup = await fetch(`${base}/entities/resolve`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ name: "Any brand", purpose: "creator" }),
  });
  assert.equal(retiredCreatorLookup.status, 400);
  const retiredYoutubeLookup = await fetch(`${base}/entities/resolve`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ name: "Any brand", purpose: "youtube_seed" }),
  });
  assert.equal(retiredYoutubeLookup.status, 400);
  const staleConfirmation = await fetch(`${base}/entities/confirm`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ resolutionId: randomUUID(), qlooId: "fake" }) });
  assert.equal(staleConfirmation.status, 404);
  const json = { ...headers, "content-type": "application/json" };
  const malformed = await fetch(`${base}/projects`, { method: "POST", headers: json, body: "{" });
  assert.equal(malformed.status, 400, "Malformed input is a client error, not an outage");
  const oversized = await fetch(`${base}/projects`, { method: "POST", headers: json,
    body: JSON.stringify({ name: "x".repeat(20_000) }) });
  assert.equal(oversized.status, 413);
  const brand = await database.query(`select e.id,e.canonical_name as name from catalog.entities e
    join catalog.entity_identifiers i on i.entity_id=e.id and i.provider='qloo' and i.status='confirmed'
    where e.kind='brand' limit 1`);
  if (brand.rows[0]) {
    const project = { name: "Confirmation state check", objective: "product_bundle",
      seedEntityId: brand.rows[0].id };
    const unconfirmed = await fetch(`${base}/projects`, { method: "POST", headers: json,
      body: JSON.stringify(project) });
    assert.equal(unconfirmed.status, 400);
    // Confirmation lives in Postgres, so a restart or another API instance sees it.
    await database.query(`insert into private.seed_confirmations(user_id,entity_id)
      values ($1,$2)`, [created.user.id, brand.rows[0].id]);
    const confirmed = await fetch(`${base}/projects`, { method: "POST", headers: json,
      body: JSON.stringify(project) });
    assert.equal(confirmed.status, 201);
    const firstProject = (await confirmed.json()).project;
    // Same brand, country and goal: new research joins the existing project.
    const again = await fetch(`${base}/projects`, { method: "POST", headers: json,
      body: JSON.stringify({ ...project, name: "Second attempt" }) });
    assert.equal(again.status, 200, "Reusing a project is not a new one");
    assert.equal((await again.json()).project.id, firstProject.id);
    const otherGoal = await fetch(`${base}/projects`, { method: "POST", headers: json,
      body: JSON.stringify({ ...project, objective: "cross_sell" }) });
    const otherGoalProject = (await otherGoal.json()).project;
    assert.notEqual(otherGoalProject.id, firstProject.id);
    // A project without research is a draft, and its goal can still change.
    const listed = (await (await fetch(`${base}/projects`, { headers })).json()).projects;
    assert.equal(listed.find((item) => item.id === otherGoalProject.id).latestRunStatus, null);
    const regoaled = await fetch(`${base}/projects/${otherGoalProject.id}`, { method: "PATCH", headers: json,
      body: JSON.stringify({ name: "Draft · Bundle", objective: "product_bundle", notes: "" }) });
    assert.equal(regoaled.status, 200);
    assert.equal((await regoaled.json()).project.objective, "product_bundle");
    // Product search before a project exists is limited to a confirmed or owned brand.
    const strangerProducts = await fetch(`${base}/entities/${crypto.randomUUID()}/commerce-products?market=US&query=pan`,
      { headers });
    assert.equal(strangerProducts.status, 400);
    const invalidProject = await fetch(`${base}/projects`, { method: "POST", headers: json,
      body: JSON.stringify({ ...project, name: "" }) });
    assert.equal(invalidProject.status, 400);
    assert.match((await invalidProject.json()).message, /^Enter a project name/);
  }
  await database.query(`insert into private.brand_lookups(user_id,purpose,query)
    select $1,'commerce_seed','limit check' from generate_series(1,10)`, [created.user.id]);
  const limited = await fetch(`${base}/entities/resolve`, { method: "POST", headers: json,
    body: JSON.stringify({ name: "Any brand", purpose: "commerce_seed" }) });
  assert.equal(limited.status, 429, "The hourly lookup limit is shared through Postgres");
  if (brand.rows[0]) {
    // The user's brand from an existing project starts research directly, only in its own country.
    const lookup = (market) => fetch(`${base}/entities/resolve`, { method: "POST", headers: json,
      body: JSON.stringify({ name: brand.rows[0].name.toUpperCase(), purpose: "commerce_seed", market }) });
    const known = await lookup("US");
    assert.equal(known.status, 200, "A known brand needs no new lookup");
    assert.equal((await known.json()).known?.id, brand.rows[0].id);
    assert.equal((await lookup("GB")).status, 429, "Another country is a new lookup");
  }
  console.log("Local API rejects anonymous/spoofed identity and accepts a verified Supabase user.");
} finally {
  server.kill("SIGTERM");
  await database.end();
  await admin.auth.admin.deleteUser(created.user.id);
}
