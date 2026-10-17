// Manual, bounded official API contract probe. Never run from jobs or tests.
if (process.env.RUN_YOUTUBE_PROBE !== "1") throw new Error("Manual probe flag required.");
const key = process.env.YOUTUBE_API_KEY;
if (!key) throw new Error("YOUTUBE_API_KEY is not configured.");
const base = "https://www.googleapis.com/youtube/v3";
async function read(resource, params) {
  const url = new URL(`${base}/${resource}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  url.searchParams.set("key", key);
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`${resource} returned HTTP ${response.status}`);
  return response.json();
}
const search = await read("search", { part: "snippet", type: "video", q: "backpacking gear review",
  regionCode: "US", relevanceLanguage: "en", safeSearch: "moderate", maxResults: 3 });
console.log(JSON.stringify({ method: "search.list", example: "US backpacking gear review",
  returned: search.items?.length ?? 0, channelIdsPresent: search.items?.every((item) => Boolean(item.snippet?.channelId)) }));
const channels = await read("channels", { part: "snippet,contentDetails,statistics,topicDetails", forHandle: "@MKBHD" });
const channel = channels.items?.[0];
if (!channel?.id || !channel.contentDetails?.relatedPlaylists?.uploads) throw new Error("US creator @MKBHD was not resolved with an uploads playlist.");
console.log(JSON.stringify({ method: "channels.list", example: "@MKBHD", title: channel.snippet?.title,
  idPresent: true, uploadsPlaylistPresent: true, topLevelFields: Object.keys(channel) }));
const playlist = await read("playlistItems", { part: "snippet,contentDetails", playlistId: channel.contentDetails.relatedPlaylists.uploads, maxResults: 5 });
const ids = (playlist.items ?? []).map((item) => item.contentDetails?.videoId).filter(Boolean);
if (!ids.length) throw new Error("No public uploads found for @MKBHD.");
console.log(JSON.stringify({ method: "playlistItems.list", example: "@MKBHD uploads", returned: ids.length,
  nextPageAvailable: Boolean(playlist.nextPageToken) }));
const videos = await read("videos", { part: "snippet,statistics,contentDetails,topicDetails,paidProductPlacementDetails", id: ids.join(",") });
console.log(JSON.stringify({ method: "videos.list", example: "@MKBHD recent uploads", returned: videos.items?.length ?? 0,
  firstVideoFields: videos.items?.[0] ? Object.keys(videos.items[0]) : [],
  snippetFields: videos.items?.[0]?.snippet ? Object.keys(videos.items[0].snippet) : [],
  contentFields: videos.items?.[0]?.contentDetails ? Object.keys(videos.items[0].contentDetails) : [] }));
