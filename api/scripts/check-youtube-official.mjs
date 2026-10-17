import assert from "node:assert/strict";
import { findChannels, searchChannelLeads, searchCreatorLeads, importChannel, normalizeYouTubeVideo,
  youtubeHttpError } from "../src/youtube.mjs";

process.env.YOUTUBE_API_KEY = "fixture-only-key";
const channelId = "UC1234567890123456789012";
const otherId = "UCabcdefghijklmnopqrstuv";
const videoIds = ["abc12345678", "abc12345679", "abc12345670", "abc12345671"];
const calls = [];
const fetchFn = async (url) => {
  calls.push({ method: url.pathname.split("/").at(-1), params: Object.fromEntries(url.searchParams) });
  const method = calls.at(-1).method;
  if (method === "search") return { ok: true, json: async () => ({ items: [
    { id: { videoId: videoIds[0] }, snippet: { channelId, title: "SAMPLE US hiking review", publishedAt: "2026-09-01T12:00:00Z" } },
    { id: { videoId: videoIds[1] }, snippet: { channelId } },
    { id: { videoId: videoIds[2] }, snippet: { channelId: otherId, title: "SAMPLE US camping review" } } ] }) };
  if (method === "channels") return { ok: true, json: async () => ({ items: [{ id: channelId, etag: "fixture-etag",
    snippet: { title: "SAMPLE US creator", description: "Synthetic creator for local checks", country: "US" },
    contentDetails: { relatedPlaylists: { uploads: "UUfixture" } } }] }) };
  if (method === "playlistItems") return { ok: true, json: async () => ({ nextPageToken: "fixture-next", items: [
    ...videoIds.map((videoId) => ({ contentDetails: { videoId } })), { contentDetails: { videoId: videoIds[0] } }] }) };
  if (method === "videos") return { ok: true, json: async () => ({ items: videoIds.map((id, index) => ({ id, etag: `fixture-${index}`,
    snippet: { channelId, title: `SAMPLE hiking gear review ${index}`, description: "Backpacking gear used in a review.",
      tags: ["hiking"], publishedAt: "2026-09-01T12:00:00Z", categoryId: "22" },
    contentDetails: { duration: index === 0 ? "PT1M" : "PT14M", caption: "true" },
    statistics: { viewCount: "1234", likeCount: "42" } })) }) };
  throw new Error(`Unexpected method ${method}`);
};
assert.deepEqual(await findChannels("outdoor adventure", { fetchFn }), [channelId, otherId]);
const leads = await searchChannelLeads("outdoor adventure", { fetchFn });
assert.equal(leads.length, 2, "Videos from one canonical channel are deduplicated by channel ID");
assert.equal(leads[0].id, channelId);
assert.equal(leads[0].searchSource.url, `https://www.youtube.com/watch?v=${videoIds[0]}`);
assert.equal(leads[1].searchSource.url, `https://www.youtube.com/watch?v=${videoIds[2]}`);
const profile = await importChannel(channelId, { fetchFn });
assert.equal(profile.id, channelId);
assert.equal(profile.videoCount, 4);
assert.equal(profile.videos[0].counts.views, 1234);
assert.equal(profile.videos[0].format, "short_form_uncertain");
assert.equal(profile.videos[0].captionIndicator, true);
assert.equal(profile.videos[0].evidenceStatus, "observed");
assert.equal(Object.hasOwn(profile, "signals"), false, "The adapter must not emit derived creator categories");
assert.ok(Date.parse(profile.retainUntil) - Date.parse(profile.collectedAt) < 30 * 24 * 60 * 60 * 1000);
assert.equal(normalizeYouTubeVideo({ id: videoIds[0], snippet: { channelId: otherId, title: "wrong owner", publishedAt: "2026-09-01T12:00:00Z" } }, channelId), null);
assert.deepEqual(calls.map((call) => call.method), ["search", "channels", "playlistItems", "videos"]);
assert.equal(calls[0].params.regionCode, "US");
assert.equal(calls[0].params.maxResults, "12");
assert.equal(calls[1].params.id, channelId);
assert.equal(calls[2].params.maxResults, "20");
assert.equal(calls[3].params.part, "snippet,statistics,contentDetails,topicDetails,paidProductPlacementDetails");
const providerFailure = (status, reason) => ({ status, ok: false,
  json: async () => ({ error: { errors: [{ reason }] } }) });
assert.equal((await youtubeHttpError(providerFailure(403, "quotaExceeded"))).code,
  "YOUTUBE_GOOGLE_QUOTA_EXHAUSTED");
assert.equal((await youtubeHttpError(providerFailure(403, "dailyLimitExceeded"))).code,
  "YOUTUBE_GOOGLE_QUOTA_EXHAUSTED");
assert.equal((await youtubeHttpError(providerFailure(429, "rateLimitExceeded"))).code,
  "YOUTUBE_GOOGLE_RATE_LIMITED");
assert.equal((await youtubeHttpError(providerFailure(403, "forbidden"))).code,
  "YOUTUBE_GOOGLE_API_ERROR", "A permission error is not falsely labeled quota exhaustion.");
await assert.rejects(searchCreatorLeads("SAMPLE US provider quota failure", {
  fetchFn: async () => providerFailure(403, "quotaExceeded") }),
  (error) => error.code === "YOUTUBE_GOOGLE_QUOTA_EXHAUSTED");
console.log("Official YouTube adapter checks passed with synthetic US channel/video fixtures; no provider call ran.");
