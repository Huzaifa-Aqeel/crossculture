import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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
  env: { ...process.env, API_HOST: "127.0.0.1", API_PORT: "8799", SUPABASE_URL: vars.API_URL, SUPABASE_ANON_KEY: vars.ANON_KEY, DATABASE_URL: vars.DB_URL },
  stdio: "ignore",
});
const base = "http://127.0.0.1:8799";

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "API did not start");
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
  console.log("Local API rejects anonymous/spoofed identity and accepts a verified Supabase user.");
} finally {
  server.kill("SIGTERM");
  await admin.auth.admin.deleteUser(created.user.id);
}
