import { createHash } from "node:crypto";
import pg from "pg";

const FRESH_MS = 20 * 60 * 1000;
const RETAIN_MS = 29 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMITS = { search: 85, shared: 800 };
// Every YouTube Data API v3 list method used here costs one unit in its
// corresponding Google quota bucket. Keep this explicit if methods change.
const QUOTA_UNITS = { search: 1, channels: 1, playlistItems: 1, videos: 1 };
let pool;

export function youtubeRequestLimits(env = process.env) {
  const read = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new Error(`${name} must be a positive integer.`);
    }
    return Number(raw);
  };
  return { search: read("YOUTUBE_SEARCH_24H_LIMIT", DEFAULT_LIMITS.search),
    shared: read("YOUTUBE_SHARED_24H_LIMIT", DEFAULT_LIMITS.shared) };
}

export function youtubeQuotaUnits(resource) {
  if (!Object.hasOwn(QUOTA_UNITS, resource)) throw new Error("Unsupported YouTube API resource.");
  return QUOTA_UNITS[resource];
}

export class YoutubeAppBudgetError extends Error {
  constructor(bucket, limit) {
    super(`Creator research app ${bucket} budget exhausted (${limit} requests per rolling 24 hours).`);
    this.name = "YoutubeAppBudgetError";
    this.code = "YOUTUBE_APP_BUDGET_EXHAUSTED";
    this.bucket = bucket;
    this.limit = limit;
  }
}

function db() {
  if (!process.env.DATABASE_URL) throw new Error("Creator research storage is not configured.");
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  return pool;
}

export function youtubeRequestHash(resource, params) {
  const canonical = JSON.stringify([resource, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))]);
  return createHash("sha256").update(canonical).digest("hex");
}

function projected(resource, payload) {
  const items = payload.items.map((item) => {
    if (resource === "search") return { id: { videoId: item.id?.videoId }, snippet: {
      channelId: item.snippet?.channelId, title: item.snippet?.title, publishedAt: item.snippet?.publishedAt } };
    if (resource === "channels") return { id: item.id, etag: item.etag, snippet: {
      title: item.snippet?.title, description: item.snippet?.description, country: item.snippet?.country },
      contentDetails: { relatedPlaylists: { uploads: item.contentDetails?.relatedPlaylists?.uploads } } };
    if (resource === "playlistItems") return { contentDetails: { videoId: item.contentDetails?.videoId } };
    return { id: item.id, etag: item.etag, snippet: {
      channelId: item.snippet?.channelId, title: item.snippet?.title,
      description: item.snippet?.description, tags: item.snippet?.tags,
      publishedAt: item.snippet?.publishedAt, categoryId: item.snippet?.categoryId,
      liveBroadcastContent: item.snippet?.liveBroadcastContent },
      statistics: item.statistics ? { viewCount: item.statistics.viewCount,
        likeCount: item.statistics.likeCount, commentCount: item.statistics.commentCount } : undefined,
      contentDetails: item.contentDetails ? { duration: item.contentDetails.duration,
        caption: item.contentDetails.caption } : undefined,
      liveStreamingDetails: item.liveStreamingDetails ? {} : undefined,
      paidProductPlacementDetails: item.paidProductPlacementDetails ? {
        hasPaidProductPlacement: item.paidProductPlacementDetails.hasPaidProductPlacement } : undefined };
  });
  return JSON.parse(JSON.stringify({ items, nextPageToken: resource === "playlistItems" ? payload.nextPageToken : undefined }));
}

// The per-key advisory lock spans the provider call, so two API processes do not
// spend quota on the same cold request. The quota lock makes reservations atomic.
export async function withYoutubeRequest(resource, params, load) {
  youtubeQuotaUnits(resource);
  const hash = youtubeRequestHash(resource, params);
  const bucket = resource === "search" ? "search" : "shared";
  const limit = youtubeRequestLimits()[bucket];
  const client = await db().connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [hash]);
    const cached = await client.query(
      `select payload_json from private.provider_cache
       where provider = 'youtube' and resource_type = $2 and resource_key = $1
         and request_hash = $1 and scope = 'shared' and last_status = 'succeeded'
         and fresh_until > now() and retain_until > now() limit 1`, [hash, resource]);
    if (cached.rows.length) return cached.rows[0].payload_json;

    let id;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(224, $1)", [bucket === "search" ? 1 : 2]);
      const used = await client.query(
        `select count(*)::integer as used from private.youtube_api_requests
         where quota_bucket = $1 and reserved_at > now() - interval '24 hours'`, [bucket]);
      if (used.rows[0].used >= limit) throw new YoutubeAppBudgetError(bucket, limit);
      const inserted = await client.query(
        `insert into private.youtube_api_requests(request_hash, resource, quota_bucket)
         values ($1,$2,$3) returning id`, [hash, resource, bucket]);
      id = inserted.rows[0].id;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    try {
      const response = await load();
      const compact = projected(resource, response);
      const payloadHash = createHash("sha256").update(JSON.stringify(compact)).digest("hex");
      await client.query(
        `insert into private.provider_cache(provider,resource_type,resource_key,request_hash,scope,
           payload_json,payload_hash,fetched_at,fresh_until,retain_until)
         values ('youtube',$2,$1,$1,'shared',$3::jsonb,$4,now(),now() + $5::interval,now() + $6::interval)
         on conflict (provider,resource_type,resource_key,request_hash) where scope = 'shared'
         do update set payload_json = excluded.payload_json, payload_hash = excluded.payload_hash,
           fetched_at = excluded.fetched_at, fresh_until = excluded.fresh_until,
           retain_until = excluded.retain_until, updated_at = now()`,
        [hash, resource, JSON.stringify(compact), payloadHash,
          `${FRESH_MS} milliseconds`, `${RETAIN_MS} milliseconds`]);
      await client.query(
        `update private.youtube_api_requests set status = 'succeeded',
           fresh_until = reserved_at + $2::interval, retain_until = reserved_at + $3::interval
         where id = $1`, [id, `${FRESH_MS} milliseconds`, `${RETAIN_MS} milliseconds`]);
      return compact;
    } catch (error) {
      await client.query("update private.youtube_api_requests set status = 'failed' where id = $1", [id]);
      throw error;
    }
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [hash]); }
    finally { client.release(); }
  }
}

export async function purgeDueYoutubeRequests() {
  const cache = await db().query("delete from private.provider_cache where retain_until <= now()");
  const result = await db().query(
    `delete from private.youtube_api_requests
     where (retain_until is not null and retain_until <= now())
        or (status <> 'succeeded' and reserved_at <= now() - interval '29 days')`);
  return result.rowCount + cache.rowCount;
}
