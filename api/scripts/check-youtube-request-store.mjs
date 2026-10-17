import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { withYoutubeRequest, youtubeRequestHash, youtubeRequestLimits,
  youtubeQuotaUnits } from "../src/youtube-request-store.mjs";

if (!process.env.DATABASE_URL) throw new Error("Local DATABASE_URL required.");
assert.deepEqual(youtubeRequestLimits({}), { search: 85, shared: 800 });
assert.deepEqual(youtubeRequestLimits({ YOUTUBE_SEARCH_24H_LIMIT: "95",
  YOUTUBE_SHARED_24H_LIMIT: "1200" }), { search: 95, shared: 1200 });
for (const invalid of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
  assert.throws(() => youtubeRequestLimits({ YOUTUBE_SEARCH_24H_LIMIT: invalid }),
    /YOUTUBE_SEARCH_24H_LIMIT must be a positive integer/);
}
assert.deepEqual(["search", "channels", "playlistItems", "videos"].map(youtubeQuotaUnits),
  [1, 1, 1, 1]);
assert.throws(() => youtubeQuotaUnits("captions"), /Unsupported YouTube API resource/);
const resource = "search";
const params = { part: "snippet", q: `SAMPLE US gear ${randomUUID()}`, maxResults: 1 };
const hash = youtubeRequestHash(resource, params);
assert.equal(hash, youtubeRequestHash(resource, { q: params.q, maxResults: 1, part: "snippet" }));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const createdHashes = [hash];
const previousSearchLimit = process.env.YOUTUBE_SEARCH_24H_LIMIT;
const previousSharedLimit = process.env.YOUTUBE_SHARED_24H_LIMIT;
await db.connect();
try {
  let calls = 0;
  const load = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { items: [{ id: { videoId: "abc12345678" },
      snippet: { channelId: "UC1234567890123456789012", title: "SAMPLE US video" } }] };
  };
  const [first, concurrent] = await Promise.all([
    withYoutubeRequest(resource, params, load), withYoutubeRequest(resource, params, load)]);
  assert.deepEqual(concurrent, first, "Concurrent identical requests must share one durable reservation.");
  const second = await withYoutubeRequest(resource, params, async () => {
    calls += 1;
    throw new Error("Duplicate request reached the provider.");
  });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  const rows = await db.query(
    `select status, quota_bucket, fresh_until, retain_until, reserved_at
     from private.youtube_api_requests where request_hash = $1`, [hash]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].status, "succeeded");
  assert.equal(rows.rows[0].quota_bucket, "search");
  assert.ok(Date.parse(rows.rows[0].fresh_until) > Date.now());
  assert.ok(Date.parse(rows.rows[0].retain_until) - Date.parse(rows.rows[0].reserved_at) <= 29 * 86400000);
  const payload = await db.query(`select payload_json from private.provider_cache
    where provider='youtube' and resource_key=$1 and request_hash=$1 and scope='shared'`, [hash]);
  assert.equal(payload.rowCount, 1);
  assert.deepEqual(payload.rows[0].payload_json, first);
  assert.ok(!JSON.stringify(payload.rows[0].payload_json).includes("fixture-only-key"));

  const count = async (bucket) => Number((await db.query(`select count(*)::integer as used
    from private.youtube_api_requests where quota_bucket=$1
      and reserved_at > now() - interval '24 hours'`, [bucket])).rows[0].used);
  const beforeSearch = await count("search");
  process.env.YOUTUBE_SEARCH_24H_LIMIT = String(beforeSearch + 2);
  const searchParams = Array.from({ length: 3 }, () => ({ part: "snippet",
    q: `SAMPLE concurrent US ${randomUUID()}` }));
  createdHashes.push(...searchParams.map((item) => youtubeRequestHash("search", item)));
  const searchResults = await Promise.allSettled(searchParams.map((item) =>
    withYoutubeRequest("search", item, load)));
  assert.equal(searchResults.filter((item) => item.status === "fulfilled").length, 2,
    "Two distinct requests reserve the last two search slots atomically.");
  const rejectedSearch = searchResults.find((item) => item.status === "rejected")?.reason;
  assert.equal(rejectedSearch?.code, "YOUTUBE_APP_BUDGET_EXHAUSTED");
  assert.equal(rejectedSearch?.bucket, "search");
  assert.equal(await count("search"), beforeSearch + 2);
  const cachedParams = searchParams[searchResults.findIndex((item) => item.status === "fulfilled")];
  const cachedAtLimit = await withYoutubeRequest("search", cachedParams, async () => {
    throw new Error("A fresh cached response spent another search slot.");
  });
  assert.deepEqual(cachedAtLimit, first, "Cache reuse must precede app-budget enforcement.");

  const beforeShared = await count("shared");
  process.env.YOUTUBE_SHARED_24H_LIMIT = String(beforeShared + 1);
  const channelParams = Array.from({ length: 2 }, () => ({ part: "snippet",
    id: `UC${randomUUID().replace(/-/g, "").slice(0, 22)}` }));
  createdHashes.push(...channelParams.map((item) => youtubeRequestHash("channels", item)));
  const sharedResults = await Promise.allSettled(channelParams.map((item) =>
    withYoutubeRequest("channels", item, async () => ({ items: [] }))));
  assert.equal(sharedResults.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(sharedResults.find((item) => item.status === "rejected")?.reason?.bucket, "shared");
  assert.equal(await count("shared"), beforeShared + 1);
} finally {
  if (previousSearchLimit === undefined) delete process.env.YOUTUBE_SEARCH_24H_LIMIT;
  else process.env.YOUTUBE_SEARCH_24H_LIMIT = previousSearchLimit;
  if (previousSharedLimit === undefined) delete process.env.YOUTUBE_SHARED_24H_LIMIT;
  else process.env.YOUTUBE_SHARED_24H_LIMIT = previousSharedLimit;
  await db.query("delete from private.provider_cache where provider='youtube' and request_hash = any($1)", [createdHashes]);
  await db.query("delete from private.youtube_api_requests where request_hash = any($1)", [createdHashes]);
  await db.end();
}
console.log("Persistent YouTube 85/800 defaults, configurable boundaries, atomic concurrent reservations, cross-process cache and one-unit method accounting passed; no provider call ran.");
