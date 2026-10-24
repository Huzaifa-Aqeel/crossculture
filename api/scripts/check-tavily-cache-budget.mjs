// Local credit-budget fixture. Uses a synthetic quota snapshot and mock calls;
// it never contacts Tavily or spends account credits.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { tavilyCreditCapacity, withWebSearch, withWebExtract } from "../src/web-research.mjs";

assert.equal(tavilyCreditCapacity({ account: { plan_limit: 1000, plan_usage: 31 },
  key: { limit: null, usage: 31 } }), 969);
assert.equal(tavilyCreditCapacity({ account: { plan_limit: 1000, plan_usage: 31 },
  key: { limit: 5, usage: 2 } }), 3);
assert.throws(() => tavilyCreditCapacity({ account: {} }), /capacity is unavailable/);

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
assert.ok(vars.DB_URL?.includes("127.0.0.1:"));
process.env.DATABASE_URL = vars.DB_URL;
const db = new pg.Pool({ connectionString: vars.DB_URL });
const previous = [process.env.TAVILY_API_KEY, process.env.TAVILY_API_KEY_2];
const nonce = randomUUID();
const fixtureKey = `fixture-${nonce}`;
const keyHash = createHash("sha256").update(fixtureKey).digest("hex");
delete process.env.TAVILY_API_KEY;
delete process.env.TAVILY_API_KEY_2;
const snapshot = { account: { plan_limit: 1000, plan_usage: 998 }, key: { usage: 998, limit: null } };
try {
  await assert.rejects(withWebSearch(`fixture ${nonce} no-credentials`, { focus: "fixture" },
    () => { throw new Error("A provider call must not occur without credentials"); }),
  /Web research is not configured/);
  process.env.TAVILY_API_KEY = fixtureKey;
  await db.query(`insert into private.provider_cache
    (provider,resource_type,resource_key,request_hash,scope,payload_json,payload_hash,
      fetched_at,fresh_until,retain_until,last_status)
    values ('web','quota_snapshot',$1,$1,'shared',$2::jsonb,$3,now(),
      now()+interval '10 minutes',now()+interval '2 days','succeeded')`,
  [keyHash, JSON.stringify(snapshot), createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")]);
  const queries = ["a", "b", "c"].map((letter) => `fixture ${nonce} ${letter}`);
  let providerCalls = 0;
  const load = async () => { providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { results: [], usage: { credits: 1 } }; };
  const concurrent = await Promise.allSettled(queries.map((query) =>
    withWebSearch(query, { focus: "fixture" }, load)));
  assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 2);
  assert.equal(concurrent.filter((item) => item.status === "rejected" &&
    /Tavily account credits are exhausted/.test(item.reason.message)).length, 1);
  assert.equal(providerCalls, 2, "atomic reservations must prevent a third provider call");
  const reused = await withWebSearch(queries[0], { focus: "fixture" },
    () => { throw new Error("A fresh cached query must not call the provider"); });
  assert.equal(reused.cacheStatus, "fresh");
  await assert.rejects(withWebExtract(`https://fixture.example/${nonce}`, { focus: "fixture" },
    () => { throw new Error("Provider must not be called without available credit"); }),
  /Tavily account credits are exhausted/);
  const firstSnapshot = await db.query(`select fetched_at from private.provider_cache
    where provider='web' and resource_type='quota_snapshot' and resource_key=$1`, [keyHash]);
  const delayedUsage = { ...snapshot, baselineAt: firstSnapshot.rows[0].fetched_at.toISOString(),
    baselineUsage: 998, baselineKeyUsage: 998, lastProviderUsage: 998 };
  await db.query(`update private.provider_cache set payload_json=$2::jsonb,
    fetched_at=now(),fresh_until=now()+interval '10 minutes'
    where provider='web' and resource_type='quota_snapshot' and resource_key=$1`,
  [keyHash, JSON.stringify(delayedUsage)]);
  await assert.rejects(withWebSearch(`fixture ${nonce} delayed-usage`, { focus: "fixture" }, load),
    /Tavily account credits are exhausted/,
  "provider usage lag must not erase local reservations after a snapshot refresh");
  await db.query(`update private.provider_cache set payload_json=$2::jsonb,
    fetched_at=now(),fresh_until=now()+interval '10 minutes'
    where provider='web' and resource_type='quota_snapshot' and resource_key=$1`,
  [keyHash, JSON.stringify({ ...snapshot, account: { plan_limit: 1000, plan_usage: 999 } })]);
  const extracted = await withWebExtract(`https://fixture.example/${nonce}`, { focus: "fixture" },
    async () => ({ results: [], usage: { credits: 0 } }));
  assert.equal(extracted.usage.credits, 0, "a zero-credit failed URL extract releases its reservation");
  const finalSearch = await withWebSearch(`fixture ${nonce} final`, { focus: "fixture" }, load);
  assert.equal(finalSearch.cacheStatus, "new", "zero-cost Extract must not consume the remaining credit");
  await assert.rejects(withWebSearch(`fixture ${nonce} over-limit`, { focus: "fixture" }, load),
    /Tavily account credits are exhausted/);
  console.log("SAMPLE Tavily budget passed: actual credits, atomic concurrency, cache reuse and zero-cost Extract.");
} finally {
  for (const [name, value] of [["TAVILY_API_KEY", previous[0]], ["TAVILY_API_KEY_2", previous[1]]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await db.query("delete from private.provider_cache where provider='web' and resource_type='usage' and payload_json->>'keyHash'=$1", [keyHash]);
  await db.query("delete from private.provider_cache where provider='web' and resource_type='quota_snapshot' and resource_key=$1", [keyHash]);
  await db.query("delete from private.provider_cache where provider='web' and resource_key like $1", [`%${nonce}%`]);
  await db.end();
}
