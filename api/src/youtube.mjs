import { withYoutubeRequest, youtubeRequestHash, youtubeRequestLimits,
  youtubeQuotaUnits, YoutubeAppBudgetError } from "./youtube-request-store.mjs";

const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_SEARCH_RESULTS = 12;
const MAX_CANDIDATES = 5;
const MAX_VIDEOS = 20;
const CACHE_MS = 20 * 60 * 1000;
const RIGHTS_MS = 29 * 24 * 60 * 60 * 1000;
const cache = new Map();
const inflight = new Map();
const quota = { search: [], shared: [] };

export const topics = [
  ["smartphones", /smartphone|iphone|android|pixel phone|galaxy phone|mobile phone/i],
  ["cameras", /camera|photography|videography|lens|filmmaking/i],
  ["computers", /computer|laptop|macbook|desktop|tablet|ipad|pc build/i],
  ["audio", /audio|headphone|speaker|earbud|microphone|sound/i],
  ["electric vehicles", /electric vehicle|\bev\b|tesla|rivian|electric car/i],
  ["gaming", /gaming|videogame|video game|playstation|xbox|nintendo/i],
  ["artificial intelligence", /artificial intelligence|\bai\b|machine learning/i],
  ["product design", /product design|industrial design|design process|interface design/i],
  ["outdoor adventure", /hiking|camping|climbing|backpacking|outdoor adventure/i],
  ["sustainability", /sustainab|climate|recycling|environmental/i],
  ["architecture", /architecture|architectural|interior design|urbanism/i],
  ["food and cooking", /cooking|recipe|restaurant|chef|baking/i],
  ["music", /music|concert|songwriting|album review|musician/i],
  ["science", /science|physics|biology|chemistry|research lab/i],
  ["travel", /travel|destination|tourism|road trip/i],
  ["beauty", /beauty|skincare|makeup|cosmetics/i],
];

function apiKey() {
  const key = process.env.YOUTUBE_API_KEY || process.env.YT_apikey;
  if (!key) throw new Error("Creator research is not available right now.");
  return key;
}

function reserve(resource) {
  youtubeQuotaUnits(resource);
  const bucket = resource === "search" ? "search" : "shared";
  const ceiling = youtubeRequestLimits()[bucket];
  const recent = Date.now() - 24 * 60 * 60 * 1000;
  quota[bucket] = quota[bucket].filter((at) => at > recent);
  if (quota[bucket].length >= ceiling) throw new YoutubeAppBudgetError(bucket, ceiling);
  quota[bucket].push(Date.now());
}

export async function youtubeHttpError(response) {
  let reason = "";
  try {
    const payload = await response.json();
    reason = String(payload?.error?.errors?.[0]?.reason ?? "");
  } catch { /* HTTP status still identifies a failed provider request. */ }
  let code; let message;
  if (["quotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"].includes(reason)) {
    code = "YOUTUBE_GOOGLE_QUOTA_EXHAUSTED";
    message = "Creator research provider quota exhausted.";
  } else if (response.status === 429 || /rateLimitExceeded|servingLimitExceeded|limitExceeded/.test(reason)) {
    code = "YOUTUBE_GOOGLE_RATE_LIMITED";
    message = "Creator research provider rate limit reached.";
  } else {
    code = "YOUTUBE_GOOGLE_API_ERROR";
    message = "Creator research is temporarily unavailable.";
  }
  const error = new Error(message);
  error.code = code;
  error.httpStatus = response.status;
  return error;
}

function requestKey(resource, params) {
  return `${resource}:${JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}`;
}

async function get(resource, params, fetchFn = fetch) {
  const key = requestKey(resource, params);
  const stored = cache.get(key);
  if (stored && stored.until > Date.now()) return stored.value;
  if (inflight.has(key)) return inflight.get(key);
  const pending = (async () => {
    const load = async () => {
      const url = new URL(`${API}/${resource}`);
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
      url.searchParams.set("key", apiKey());
      let response;
      try { response = await fetchFn(url, { signal: AbortSignal.timeout(12000) }); }
      catch { throw new Error("Creator research is temporarily unavailable. Please try again."); }
      if (!response.ok) {
        if ([403, 429].includes(response.status)) throw await youtubeHttpError(response);
        throw new Error("We could not read this public creator information right now.");
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.items)) throw new Error("Unexpected creator research response.");
      return payload;
    };
    // Injected fetch is reserved for local fixtures. Real traffic requires the
    // database-backed quota ledger and cross-process request cache.
    const payload = fetchFn === fetch ? await withYoutubeRequest(resource, params, load)
      : (reserve(resource), await load());
    cache.set(key, { value: payload, until: Date.now() + CACHE_MS });
    return payload;
  })();
  inflight.set(key, pending);
  try { return await pending; } finally { inflight.delete(key); }
}

function channelFilter(input) {
  const value = String(input ?? "").trim();
  if (CHANNEL_ID.test(value)) return ["id", value];
  if (/^@[A-Za-z0-9._-]{3,30}$/.test(value)) return ["forHandle", value];
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a YouTube channel link or @handle."); }
  if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    throw new Error("Enter a valid YouTube channel link.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 1 && /^@[A-Za-z0-9._-]{3,30}$/.test(segments[0])) return ["forHandle", segments[0]];
  if (segments[0] === "channel" && segments.length === 2 && CHANNEL_ID.test(segments[1])) return ["id", segments[1]];
  if (segments[0] === "user" && segments.length === 2 && /^[A-Za-z0-9._-]+$/.test(segments[1])) return ["forUsername", segments[1]];
  throw new Error("Use a YouTube @handle or channel link so we can identify the right creator.");
}

export function validatedChannelReference(input) {
  const [filter, value] = channelFilter(input);
  return filter === "id" ? value : filter === "forHandle" ? value : `https://www.youtube.com/user/${value}`;
}

function numberOrNull(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isoOrNull(value) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function videoFormat(item) {
  const live = item.snippet?.liveBroadcastContent;
  if (live === "live" || live === "upcoming" || item.liveStreamingDetails) return "live_or_upcoming";
  const duration = item.contentDetails?.duration;
  if (typeof duration === "string" && /^PT(?:(\d+)M)?(?:(\d+)S)?$/.test(duration)) {
    const match = duration.match(/^PT(?:(\d+)M)?(?:(\d+)S)?$/);
    const seconds = Number(match?.[1] ?? 0) * 60 + Number(match?.[2] ?? 0);
    if (seconds > 0 && seconds <= 180) return "short_form_uncertain";
  }
  return "regular_or_unknown";
}

export function normalizeYouTubeVideo(item, expectedChannelId, collectedAt = new Date().toISOString()) {
  if (!VIDEO_ID.test(item?.id ?? "") || item?.snippet?.channelId !== expectedChannelId ||
      typeof item.snippet.title !== "string" || !isoOrNull(item.snippet.publishedAt)) return null;
  return {
    platform: "youtube", provider: "youtube_data_api_v3", evidenceStatus: "observed",
    sourceId: item.id, ownerId: expectedChannelId, sourceUrl: `https://www.youtube.com/watch?v=${item.id}`,
    title: item.snippet.title.slice(0, 300), description: String(item.snippet.description ?? "").slice(0, 5000),
    tags: Array.isArray(item.snippet.tags) ? item.snippet.tags.filter((tag) => typeof tag === "string").slice(0, 40) : [],
    publishedAt: isoOrNull(item.snippet.publishedAt), collectedAt,
    retainUntil: new Date(new Date(collectedAt).getTime() + RIGHTS_MS).toISOString(),
    format: videoFormat(item), formatUncertain: true, duration: item.contentDetails?.duration ?? null,
    captionIndicator: item.contentDetails?.caption === "true", categoryId: item.snippet.categoryId ?? null,
    paidProductPlacementFlag: typeof item.paidProductPlacementDetails?.hasPaidProductPlacement === "boolean"
      ? item.paidProductPlacementDetails.hasPaidProductPlacement : null,
    counts: { views: numberOrNull(item.statistics?.viewCount), likes: numberOrNull(item.statistics?.likeCount),
      comments: numberOrNull(item.statistics?.commentCount) }, etag: item.etag ?? null,
  };
}

export function topicsInText(value) {
  return topics.filter(([, pattern]) => pattern.test(String(value ?? ""))).map(([name]) => name);
}

export async function searchChannelLeads(topic, { fetchFn = fetch } = {}) {
  const query = String(topic ?? "").trim().toLowerCase();
  if (!topics.some(([name]) => name === query)) throw new Error("We could not search creators for that topic.");
  const result = await get("search", { part: "snippet", type: "video", q: query,
    regionCode: "US", relevanceLanguage: "en", safeSearch: "moderate", maxResults: MAX_SEARCH_RESULTS }, fetchFn);
  const leads = new Map();
  for (const item of result.items) {
    const id = item?.snippet?.channelId;
    if (!CHANNEL_ID.test(id ?? "") || leads.has(id)) continue;
    const videoId = item?.id?.videoId;
    leads.set(id, { id, searchSource: VIDEO_ID.test(videoId ?? "") ? {
      title: String(item.snippet?.title ?? "Public video").slice(0, 300),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: isoOrNull(item.snippet?.publishedAt),
    } : null });
    if (leads.size >= MAX_CANDIDATES) break;
  }
  return [...leads.values()];
}

// Research queries are planned from Qloo evidence by the signed-in worker.
// Search results remain leads; channel identity and the representative sample
// are resolved separately by importChannel.
export async function searchCreatorLeads(query, { fetchFn = fetch, onDiagnostics } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 4 || q.length > 100 || /[\r\n]/.test(q)) throw new Error("Invalid creator search direction.");
  const params = { part: "snippet", type: "video", q,
    regionCode: "US", relevanceLanguage: "en", safeSearch: "moderate", maxResults: MAX_SEARCH_RESULTS };
  const result = await get("search", params, fetchFn);
  const collectedAt = new Date().toISOString();
  const requestHash = youtubeRequestHash("search", params);
  const leads = new Map();
  const diagnostics = { query: q, rawResults: result.items.length,
    invalidChannel: 0, invalidVideo: 0, duplicateWithinQuery: 0, validLeads: 0 };
  for (const item of result.items) {
    const channelId = item?.snippet?.channelId;
    const videoId = item?.id?.videoId;
    if (!CHANNEL_ID.test(channelId ?? "")) { diagnostics.invalidChannel += 1; continue; }
    if (!VIDEO_ID.test(videoId ?? "")) { diagnostics.invalidVideo += 1; continue; }
    if (leads.has(channelId)) { diagnostics.duplicateWithinQuery += 1; continue; }
    leads.set(channelId, { id: channelId, videoId,
      searchSource: { title: String(item.snippet?.title ?? "Public video").slice(0, 300),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        publishedAt: isoOrNull(item.snippet?.publishedAt), collectedAt, requestHash } });
  }
  diagnostics.validLeads = leads.size;
  onDiagnostics?.(diagnostics);
  return [...leads.values()];
}

export async function findChannels(topic, options) {
  return (await searchChannelLeads(topic, options)).map((lead) => lead.id);
}

export async function inspectChannel(input, { fetchFn = fetch } = {}) {
  const [filter, value] = channelFilter(input);
  const result = await get("channels", { part: "snippet,contentDetails,statistics,topicDetails", [filter]: value }, fetchFn);
  const channel = result.items[0];
  if (!CHANNEL_ID.test(channel?.id ?? "") || (filter === "id" && channel.id !== value)) {
    throw new Error("We could not confirm that public channel.");
  }
  return { id: channel.id, name: String(channel.snippet?.title ?? "").slice(0, 160),
    summary: String(channel.snippet?.description ?? "").slice(0, 500),
    country: channel.snippet?.country ?? null,
    uploadsAvailable: Boolean(channel.contentDetails?.relatedPlaylists?.uploads),
    sourceProvider: "youtube_data_api_v3" };
}

export async function importChannel(input, { fetchFn = fetch } = {}) {
  const [filter, value] = channelFilter(input);
  const channelResult = await get("channels", { part: "snippet,contentDetails,statistics,topicDetails", [filter]: value }, fetchFn);
  const channel = channelResult.items[0];
  if (!CHANNEL_ID.test(channel?.id ?? "")) throw new Error("We could not confirm that public channel.");
  if (filter === "id" && channel.id !== value) throw new Error("The returned channel ID did not match the requested channel.");
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  const playlist = uploads ? await get("playlistItems", { part: "snippet,contentDetails", playlistId: uploads,
    maxResults: MAX_VIDEOS }, fetchFn) : { items: [], nextPageToken: null };
  const ids = [...new Set(playlist.items.map((item) => item.contentDetails?.videoId).filter((id) => VIDEO_ID.test(id ?? "")))].slice(0, MAX_VIDEOS);
  const videoParams = { part: "snippet,statistics,contentDetails,topicDetails,paidProductPlacementDetails", id: ids.join(",") };
  const details = ids.length ? await get("videos", videoParams, fetchFn) : { items: [] };
  const collectedAt = new Date().toISOString();
  const videos = details.items.map((item) => normalizeYouTubeVideo(item, channel.id, collectedAt)).filter(Boolean);
  return {
    id: channel.id, name: channel.snippet?.title ?? "YouTube creator",
    summary: String(channel.snippet?.description ?? "").slice(0, 500),
    country: channel.snippet?.country ?? null,
    countryEvidence: channel.snippet?.country === "US" ? "channel_metadata_us" : "not_verified_us",
    url: `https://www.youtube.com/channel/${channel.id}`, videoCount: videos.length,
    videos, sampling: { method: "recent_uploads", requested: MAX_VIDEOS,
      returned: videos.length, listed: ids.length, hasMore: Boolean(playlist.nextPageToken),
      coverage: !uploads ? "uploads_unavailable" : !ids.length ? "no_accessible_uploads"
        : videos.length < ids.length ? "some_video_details_unavailable" : "complete",
      formatClassificationUncertain: true },
    collectedAt, retainUntil: new Date(Date.parse(collectedAt) + RIGHTS_MS).toISOString(),
    sourceProvider: "youtube_data_api_v3", sourceEtag: channel.etag ?? null,
    videoRequestHash: youtubeRequestHash("videos", videoParams),
  };
}

