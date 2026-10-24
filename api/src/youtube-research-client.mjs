import pg from "pg";

const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
let pool;
const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));

async function reserve(bucket) {
  const limit = Number(bucket === "search" ? process.env.YOUTUBE_SEARCH_24H_LIMIT ?? 80
    : process.env.YOUTUBE_SHARED_24H_LIMIT ?? 800);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid YouTube request limit.");
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(223, $1)", [bucket === "search" ? 1 : 2]);
    const count = await client.query(`select count(*)::integer as n from private.youtube_research_requests
      where bucket=$1 and reserved_at>now()-interval '24 hours'`, [bucket]);
    if (count.rows[0].n >= limit) {
      const error = new Error("Video research request limit reached. Try again later.");
      error.code = "youtube_budget";
      throw error;
    }
    await client.query("insert into private.youtube_research_requests(bucket) values ($1)", [bucket]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function youtubeList(resource, params, { fetchFn = fetch, reserveFn = reserve } = {}) {
  if (!["search", "channels", "playlistItems", "videos"].includes(resource)) throw new Error("Unsupported video request.");
  const key = process.env.YOUTUBE_API_KEY || process.env.YT_apikey;
  if (!key) throw new Error("Video research is not configured.");
  await reserveFn(resource === "search" ? "search" : "shared");
  const url = new URL(`${API}/${resource}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  url.searchParams.set("key", key);
  let response;
  try { response = await fetchFn(url, { signal: AbortSignal.timeout(12000) }); }
  catch { throw new Error("Video research is temporarily unavailable."); }
  if (!response.ok) {
    const error = new Error(response.status === 429 || response.status === 403
      ? "Video research is rate limited right now." : "Video research is temporarily unavailable.");
    error.code = response.status === 429 || response.status === 403 ? "youtube_provider_limit" : "youtube_provider_error";
    throw error;
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.items)) throw new Error("Invalid video research response.");
  return payload;
}

export async function searchCreatorVideoPage(query, { pageToken = null, maxResults = 20,
  ...options } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 3 || q.length > 100 || /[\r\n]/.test(q)) throw new Error("Invalid video search.");
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 50)
    throw new Error("Invalid video search page size.");
  const payload = await youtubeList("search", { part: "snippet", type: "video", q,
    regionCode: "US", relevanceLanguage: "en", safeSearch: "moderate", maxResults,
    ...(pageToken ? { pageToken } : {}) }, options);
  const hits = payload.items.flatMap((item) => {
    const channelId = item?.snippet?.channelId; const videoId = item?.id?.videoId;
    return CHANNEL.test(channelId ?? "") && VIDEO.test(videoId ?? "") ? [{ channelId, videoId,
      title: String(item.snippet?.title ?? "").slice(0, 250),
      channelName: String(item.snippet?.channelTitle ?? "").slice(0, 160),
      publishedAt: item.snippet?.publishedAt ?? null,
      url: `https://www.youtube.com/watch?v=${videoId}` }] : [];
  });
  return { hits, nextPageToken: payload.nextPageToken ?? null };
}

export async function searchCreatorVideos(query, options = {}) {
  return (await searchCreatorVideoPage(query, { maxResults: 50, ...options })).hits;
}

export async function channelSummary(channelId, { list = youtubeList } = {}) {
  if (!CHANNEL.test(channelId ?? "")) throw new Error("Invalid channel ID.");
  const useCache = list === youtubeList && Boolean(process.env.DATABASE_URL);
  if (useCache) {
    const cached = await db().query(`select profile_json from private.youtube_channel_profile_cache
      where channel_id=$1 and retain_until>now()`, [channelId]);
    if (cached.rows[0]) return { ...cached.rows[0].profile_json, cacheStatus: "fresh" };
  }
  const detail = await list("channels", { part: "snippet,contentDetails,statistics", id: channelId });
  const channel = detail.items.find((item) => item.id === channelId);
  if (!channel) return null;
  const profile = { id: channelId, name: String(channel.snippet?.title ?? "").slice(0, 160),
    description: String(channel.snippet?.description ?? "").slice(0, 500),
    country: channel.snippet?.country ?? null,
    uploadsReported: Number(channel.statistics?.videoCount ?? 0) || null,
    playlistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null };
  if (useCache) await db().query(`insert into private.youtube_channel_profile_cache(channel_id,profile_json)
    values ($1,$2::jsonb) on conflict (channel_id) do update set profile_json=excluded.profile_json,
      observed_at=now(),retain_until=now()+interval '15 days'`, [channelId, JSON.stringify(profile)]);
  return { ...profile, cacheStatus: "new" };
}

// The uploads playlist is the authoritative cheap activity check. Keep its first
// page so an eligible channel can reuse it during inventory retrieval.
export async function latestChannelUpload(channelId, profile, { list = youtubeList,
  now = new Date() } = {}) {
  if (!CHANNEL.test(channelId ?? "")) throw new Error("Invalid channel ID.");
  if (!profile?.playlistId) return { state: "unknown", publishedAt: null, firstPage: null };
  const firstPage = await list("playlistItems", { part: "contentDetails",
    playlistId: profile.playlistId, maxResults: 50 });
  if (!firstPage.items.length) return { state: "empty", publishedAt: null, firstPage };
  const observed = firstPage.items.map((item) => ({
    videoId: item.contentDetails?.videoId,
    time: Date.parse(item.contentDetails?.videoPublishedAt ?? ""),
  })).filter((item) => VIDEO.test(item.videoId ?? "") &&
    Number.isFinite(item.time) && item.time <= now.getTime())
    .sort((a, b) => b.time - a.time);
  if (!observed.length) return { state: "unknown", publishedAt: null, firstPage };
  return { state: "observed", publishedAt: new Date(observed[0].time).toISOString(),
    videoId: observed[0].videoId, firstPage };
}

export async function channelInventory(channelId, { maxVideos = 600, list = youtubeList,
  profile = null, maxListed = maxVideos, firstPage = null, requiredVideoId = null } = {}) {
  if (!CHANNEL.test(channelId ?? "")) throw new Error("Invalid channel ID.");
  if (!Number.isSafeInteger(maxVideos) || maxVideos < 1 || maxVideos > 1000)
    throw new Error("Invalid channel inventory limit.");
  if (!Number.isSafeInteger(maxListed) || maxListed < maxVideos)
    throw new Error("Invalid channel listing limit.");
  const useCache = list === youtubeList && Boolean(process.env.DATABASE_URL);
  if (useCache) {
    const cached = await db().query(`select inventory_json from private.youtube_channel_cache
      where channel_id=$1 and retain_until>now()`, [channelId]);
    const inventory = cached.rows[0]?.inventory_json;
    if (inventory && inventory.detailComplete &&
      (inventory.playlistHasMore === false || inventory.playlistHasMore === true &&
        inventory.listedCount >= maxListed) &&
      inventory.videos.length >= Math.min(maxVideos, inventory.listedCount) &&
      (!requiredVideoId || inventory.videos.some((video) => video.id === requiredVideoId)))
      return { ...inventory, cacheStatus: "fresh" };
  }
  const summary = profile?.playlistId ? profile : await channelSummary(channelId, { list });
  if (!summary) return null;
  const playlistId = summary.playlistId;
  const ids = []; let cursor; let hasMore = false;
  while (playlistId && ids.length < maxListed) {
    const page = !cursor && firstPage ? firstPage : await list("playlistItems", {
      part: "contentDetails", playlistId,
      maxResults: Math.min(50, maxListed - ids.length), ...(cursor ? { pageToken: cursor } : {}) });
    for (const item of page.items) if (VIDEO.test(item.contentDetails?.videoId ?? "")) ids.push(item.contentDetails.videoId);
    cursor = page.nextPageToken;
    hasMore = Boolean(cursor);
    if (!cursor || !page.items.length) break;
  }
  const selectedIds = ids.length <= maxVideos ? ids : (() => {
    const chosen = new Set(ids.slice(0, Math.min(50, Math.ceil(maxVideos / 4))));
    const remaining = maxVideos - chosen.size;
    for (let index = 0; index < remaining; index += 1) {
      const position = Math.round((index + 0.5) * (ids.length - 1) / remaining);
      chosen.add(ids[position]);
    }
    for (const id of ids) { if (chosen.size >= maxVideos) break; chosen.add(id); }
    return ids.filter((id) => chosen.has(id));
  })();
  const videos = [];
  for (let i = 0; i < selectedIds.length; i += 50) {
    const page = await list("videos", { part: "snippet,contentDetails,statistics",
      id: selectedIds.slice(i, i + 50).join(",") });
    for (const item of page.items) {
      if (!VIDEO.test(item.id ?? "") || item.snippet?.channelId !== channelId) continue;
      videos.push({ id: item.id, channelId, title: String(item.snippet?.title ?? "").slice(0, 300),
        description: String(item.snippet?.description ?? "").slice(0, 1200),
        tags: Array.isArray(item.snippet?.tags) ? item.snippet.tags.filter((x) => typeof x === "string").slice(0, 30) : [],
        publishedAt: item.snippet?.publishedAt ?? null, duration: item.contentDetails?.duration ?? null,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      viewCount: item.statistics?.viewCount != null &&
        Number.isSafeInteger(Number(item.statistics.viewCount))
        ? Number(item.statistics.viewCount) : null });
    }
  }
  const inventory = { id: channelId, name: summary.name,
    description: summary.description,
    country: summary.country, url: `https://www.youtube.com/channel/${channelId}`,
    uploadsReported: summary.uploadsReported,
    inventoryCount: videos.length, listedCount: ids.length,
    detailComplete: videos.length === selectedIds.length,
    hasMore: hasMore || ids.length > selectedIds.length, playlistHasMore: hasMore, videos };
  if (useCache) await db().query(`insert into private.youtube_channel_cache(channel_id,inventory_json)
    values ($1,$2::jsonb) on conflict (channel_id) do update set inventory_json=excluded.inventory_json,
      observed_at=now(),retain_until=now()+interval '15 days'`, [channelId, JSON.stringify(inventory)]);
  return { ...inventory, cacheStatus: "new" };
}

export async function exactChannelVideos(channelId, videoIds, { list = youtubeList } = {}) {
  if (!CHANNEL.test(channelId ?? "") || !Array.isArray(videoIds) || videoIds.length > 20 ||
      videoIds.some((id) => !VIDEO.test(id))) throw new Error("Invalid exact video lookup.");
  if (!videoIds.length) return [];
  const requested = [...new Set(videoIds)];
  const useCache = list === youtubeList && Boolean(process.env.DATABASE_URL);
  const cached = useCache ? await db().query(`select video_id,video_json from private.youtube_video_cache
    where channel_id=$1 and video_id=any($2::text[]) and retain_until>now()`,
  [channelId, requested]) : { rows: [] };
  const found = new Map(cached.rows.map((row) => [row.video_id, row.video_json]));
  const missing = requested.filter((id) => !found.has(id));
  if (!missing.length) return requested.map((id) => found.get(id));
  const result = await list("videos", { part: "snippet,contentDetails,statistics", id: missing.join(",") });
  const verified = result.items.flatMap((item) => item.snippet?.channelId === channelId &&
    VIDEO.test(item.id ?? "") ? [{ id: item.id, channelId,
      title: String(item.snippet.title ?? "").slice(0, 300),
      description: String(item.snippet.description ?? "").slice(0, 1200),
      tags: Array.isArray(item.snippet.tags) ? item.snippet.tags.filter((x) => typeof x === "string").slice(0, 30) : [],
      publishedAt: item.snippet.publishedAt ?? null, duration: item.contentDetails?.duration ?? null,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      viewCount: item.statistics?.viewCount != null &&
        Number.isSafeInteger(Number(item.statistics.viewCount))
        ? Number(item.statistics.viewCount) : null }] : []);
  for (const video of verified) {
    found.set(video.id, video);
    if (useCache) await db().query(`insert into private.youtube_video_cache(video_id,channel_id,video_json)
      values ($1,$2,$3::jsonb) on conflict (video_id) do update set channel_id=excluded.channel_id,
      video_json=excluded.video_json,observed_at=now(),retain_until=now()+interval '15 days'`,
    [video.id, channelId, JSON.stringify(video)]);
  }
  return requested.flatMap((id) => found.has(id) ? [found.get(id)] : []);
}

export async function recentCreatorViewContext(channelId, videos, { list = youtubeList } = {}) {
  if (!CHANNEL.test(channelId ?? "")) throw new Error("Invalid channel ID.");
  const recent = [...videos].filter((item) => VIDEO.test(item?.id ?? ""))
    .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))
    .slice(0, 6);
  if (!recent.length) return [];
  // Public counts move over time. Refresh only after a creator qualifies, then
  // store the dated result with that run instead of presenting cache values as current.
  const result = await list("videos", { part: "snippet,statistics",
    id: recent.map((item) => item.id).join(",") });
  const refreshed = new Map(result.items.filter((item) => item.snippet?.channelId === channelId &&
      item.statistics?.viewCount != null)
    .map((item) => [item.id, Number(item.statistics.viewCount)]));
  const observedAt = new Date().toISOString();
  return recent.flatMap((item) => {
    const count = refreshed.get(item.id);
    const duration = String(item.duration ?? "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    const seconds = duration ? Number(duration[1] ?? 0) * 3600 +
      Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0) : null;
    return Number.isSafeInteger(count) && count >= 0 ? [{ id: item.id, title: item.title,
      url: item.url, publishedAt: item.publishedAt, viewCount: count, observedAt,
      length: seconds === null ? null : seconds <= 180 ? "up_to_three_minutes" : "over_three_minutes" }] : [];
  });
}
