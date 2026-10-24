import assert from "node:assert/strict";
import { planYoutubeDirections, representativeVideos, targetedVideos,
  discoverCreatorChannels, independentContentGroup,
  hasRecentPublicUpload,
  reconcileChannel, selectTranscriptSegments,
  isDirectCulturalSubjectChannel, semanticTranscriptWindows,
  rankCreatorChannels, presentYoutubeResult,
  shouldDeepenCreatorInventory, hasUnreviewedGroundedCreatorProspect } from "../src/youtube-research.mjs";
import { channelInventory, exactChannelVideos, latestChannelUpload,
  recentCreatorViewContext } from "../src/youtube-research-client.mjs";
import { clusterCulturalSignals, redundantCreatorQuery, keywordBaselineQueries } from "../src/youtube-discovery.mjs";
import { buildCreatorReviewPacket, creatorReviewMetrics,
  buildCreatorDiscoveryComparison, creatorDiscoveryComparisonMetrics } from "../src/youtube-evaluation.mjs";
import { classifyCreatorChannelFromInventory,
  extractCreatorTranscript, chooseCreatorTranscript } from "../src/creator-intelligence.mjs";

const tag = { id: "urn:tag:keyword:qloo:trail_running", name: "Trail Running", type: "urn:tag:keyword:qloo" };
const clustered = clusterCulturalSignals([
  { id: "outdoor-1", name: "Outdoor Enthusiasts", type: tag.type, affinity: 0.9 },
  { id: "outdoor-2", name: "Outdoor Lifestyle", type: tag.type, affinity: 0.8 },
  { id: "adventure", name: "Outdoor Adventure", type: tag.type, affinity: 0.7 },
  { id: "design", name: "Independent Design", type: tag.type, affinity: 0.6 },
]);
assert.equal(clustered.all.length, 3);
assert.deepEqual(clustered.all[0].members.map((item) => item.id), ["outdoor-1", "outdoor-2"]);
assert(clustered.selected.some((item) => item.id === "design"));
assert.equal(redundantCreatorQuery("trail running documentary", "trail running documentary video"), true);
assert.equal(redundantCreatorQuery("trail running documentary", "gear repair workshop"), false);
assert.equal(keywordBaselineQueries("outdoor apparel", "ongoing").length, 3);
let searchPageCalls = 0;
const discovery = await discoverCreatorChannels([
  { q: "trail running documentary", signalIds: [tag.id], family: "direct" },
  { q: "trail running story", signalIds: [tag.id], family: "format" },
], { maxPages: 2, searchPage: async (query, { pageToken }) => {
  searchPageCalls += 1;
  if (query === "trail running story") return { hits: [{ channelId: "A", videoId: "video000001",
    title: "Trail running story" }], nextPageToken: null };
  return pageToken ? { hits: [{ channelId: "C", videoId: "video000003",
    title: "Trail running documentary" }], nextPageToken: "more" } :
    { hits: [{ channelId: "A", videoId: "video000001", title: "Trail running documentary" },
      { channelId: "B", videoId: "video000002", title: "Trail running documentary" }],
    nextPageToken: "next" };
} });
assert.equal(searchPageCalls, 3);
assert.equal(discovery.candidates.size, 3);
assert.equal(discovery.searchYield[0].newChannels, 3);
assert.equal(discovery.searchYield[0].stopReason, "page_budget");
assert.equal(discovery.searchYield[1].overlappingChannels, 1);
let lowYieldCalls = 0;
const lowYield = await discoverCreatorChannels([
  { q: "trail running documentary", signalIds: [tag.id] },
  { q: "outdoor trail film", signalIds: [tag.id] },
], { searchPage: async (query) => {
  lowYieldCalls += 1;
  return query.startsWith("trail") ? { hits: [
    { channelId: "A", title: "Trail running documentary" },
    { channelId: "B", title: "Trail running documentary" }], nextPageToken: null } :
    { hits: [{ channelId: "A", title: "Outdoor trail film" },
      { channelId: "B", title: "Outdoor trail film" },
      { channelId: "C", title: "Outdoor trail film" }], nextPageToken: "next" };
} });
assert.equal(lowYieldCalls, 2);
assert.equal(lowYield.searchYield[1].stopReason, "low_marginal_discovery");
assert.equal(lowYield.candidates.size, 3);
const viewSample = await recentCreatorViewContext("UC1234567890123456789012", [
  { id: "00000000001", title: "Recent upload", publishedAt: "2026-10-01", url: "https://example.test/1" },
  { id: "00000000002", title: "Earlier upload", publishedAt: "2026-09-01", url: "https://example.test/2",
    viewCount: 400 },
], { list: async (_resource, params) => {
  assert.equal(params.id, "00000000001,00000000002");
  return { items: [{ id: "00000000001", snippet: { channelId: "UC1234567890123456789012" },
    statistics: { viewCount: "1200" } },
  { id: "00000000002", snippet: { channelId: "UC1234567890123456789012" },
    statistics: { viewCount: "450" } }] };
} });
assert.deepEqual(viewSample.map((item) => item.viewCount), [1200, 450]);
const assessedIds = [];
const comparison = await buildCreatorDiscoveryComparison({
  qlooQueries: [{ q: "trail running", channelIds: ["A", "B"], pages: 1 }],
  keywordQueries: [{ q: "outdoor creator", channelIds: ["B", "C"], pages: 1 }],
  category: "outdoors", campaignMode: "ongoing",
  assessCandidate: async (id) => { assessedIds.push(id); return { state: "unknown" }; },
});
assert.deepEqual(assessedIds, ["A", "B", "C"]);
assert.equal(comparison.cases.every((item) => item.adjudicatedLabel === null), true);
assert.deepEqual(creatorDiscoveryComparisonMetrics(comparison, 2).qloo,
  { discovered: 2, adjudicated: 0, precisionAtK: null });
assert.equal(creatorDiscoveryComparisonMetrics(comparison, 2).sharedCandidates, 1);
await assert.rejects(() => buildCreatorDiscoveryComparison({
  qlooQueries: [{ channelIds: [], pages: 2 }], keywordQueries: [{ channelIds: [], pages: 1 }],
  assessCandidate: async () => null }), /equal search-call budgets/);
const videos = Array.from({ length: 40 }, (_, index) => ({ id: String(index).padStart(11, "0"),
  title: index === 39 ? "Trail running documentary" : `Video ${index}`,
  description: index === 39 ? "Trail running in the mountains" : "Other topic",
  tags: [], publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }));
const representative = representativeVideos(videos, 12);
assert.equal(representative.length, 12);
assert(representative.some((item) => Number(item.id) <= 3));
assert(representative.some((item) => Number(item.id) >= 36));
assert(representative.some((item) => Number(item.id) >= 18 && Number(item.id) <= 22));
assert.deepEqual(representativeVideos(videos, 12), representative);
const topicVideos = Array.from({ length: 30 }, (_, index) => ({
  id: String(index).padStart(11, "0"),
  title: index === 7 ? "Repairing a climbing jacket" : "Gaming match replay",
  description: index === 7 ? "Equipment repair and mountain travel" : "Gaming stream highlights",
  tags: index === 7 ? ["repair", "outdoors"] : ["gaming"],
  publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }));
const mixedInventory = Array.from({ length: 100 }, (_, index) => ({
  id: String(index).padStart(11, "0"), title: index < 80 ? "Technology review" : "Outdoor hike",
  description: "Public upload", tags: [], publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }));
const baseline = representativeVideos(mixedInventory, 12);
assert(baseline.filter((item) => item.title === "Technology review").length >= 8);
assert(baseline.filter((item) => item.title === "Outdoor hike").length <= 4);
assert.equal(independentContentGroup({ title: "Mountain trail race interview clip", id: "00000000000" }),
  independentContentGroup({ title: "Mountain trail race interview excerpt", id: "00000000001" }));
const directSignal = { phrase: "Trail Running", basisText: "Trail running outdoors",
  centrality: "central" };
assert.equal(shouldDeepenCreatorInventory([tag], { culturalSignals: [
  { ...directSignal, videoId: "00000000000" }] }, [],
[{ id: "00000000000" }]), false);
assert.equal(shouldDeepenCreatorInventory([tag], { culturalSignals: [
  { ...directSignal, videoId: "00000000000" },
  { ...directSignal, videoId: "00000000001" }] }, [],
[{ id: "00000000000" }]), true);
assert.equal(shouldDeepenCreatorInventory([tag], { culturalSignals: [{ phrase: "Gaming",
  basisText: "Gaming stream", centrality: "central", videoId: "00000000000" }] }, [],
[{ id: "00000000000" }]), false);
assert.equal(hasUnreviewedGroundedCreatorProspect(videos,
  new Set(videos.slice(0, 39).map((video) => video.id)), [],
  { culturalSignals: [] }, [], [tag]), true);
assert.equal(hasUnreviewedGroundedCreatorProspect(videos.map((video) => ({
  ...video, title: "General upload", description: "Trail Running appears only in boilerplate" })),
new Set(videos.slice(0, 2).map((video) => video.id)), [],
{ culturalSignals: [] }, [], [tag]), false);
const targeted = targetedVideos(videos, [{ videoId: videos[39].id }], [tag],
  representative.map((item) => item.id));
assert(targeted.every((item) => !representative.some((other) => other.id === item.id)));
const segments = Array.from({ length: 500 }, (_, index) => ({
  offsetMs: index * 1000, durationMs: 1000,
  text: index >= 300 && index < 310 ? "trail running on a ridge" : "another topic" }));
const focused = selectTranscriptSegments(segments, [tag.name], { targeted: true });
assert(focused.some((item) => item.offsetMs === 305_000));
assert(focused.some((item) => item.offsetMs < 80_000));
assert(focused.length <= 400);
const semantic = await semanticTranscriptWindows(segments, [tag.name], {
  classify: async () => ({ starts: [300, 999, 300] }) });
assert.deepEqual(semantic, [300]);
assert(selectTranscriptSegments(segments, [tag.name], { semanticStarts: semantic })
  .some((item) => item.offsetMs === 305_000));

const directions = await planYoutubeDirections("Example Brand", [tag], { classify: async () => ({ queries: [
  { q: "Example Brand channel", signalIds: [tag.id] },
  { q: "trail running documentary", signalIds: [tag.id] },
  { q: "invented direction", signalIds: ["invented"] },
] }) });
assert.deepEqual(directions.map((item) => item.q), ["trail running documentary"]);
let plannedSignals;
await planYoutubeDirections("Example Brand", [{ ...tag, affinity: 0.83 }], {
  classify: async (_prompt, input) => { plannedSignals = input.tags; return { queries: [
    { q: "trail running race preparation", signalIds: [tag.id] },
    { q: "mountain trail running documentary", signalIds: [tag.id] },
    { q: "trail running training diary", signalIds: [tag.id] },
    { q: "trail running fourth variant", signalIds: [tag.id] },
  ] }; } });
assert.equal(plannedSignals[0].affinity, 0.83);

const broadInventory = { name: "Independent creator", videos: Array.from({ length: 45 }, (_, index) => ({
  sourceId: String(index).padStart(11, "0"), title: `Trail running video ${index}`,
  description: "Public upload", publishedAt: "2026-01-01T00:00:00Z" })) };
let selectionBatches = 0;
const laterChoice = await chooseCreatorTranscript(broadInventory, { culturalSignals: [] }, [tag], [],
  "Could another outdoor video resolve this connection?", { classify: async (_prompt, input) => {
    selectionBatches += 1;
    return { choice: selectionBatches === 3 ? {
      videoId: input.options[0].videoId,
      researchQuestion: "Could another outdoor video resolve this connection?",
      whyThisVideo: "It covers another period of the channel's uploads.",
      predictedDecisionImpact: "Its spoken content could challenge the current view.",
    } : null };
  } });
assert.equal(selectionBatches, 3);
assert.equal(laterChoice.videoId, broadInventory.videos[40].sourceId);
let signalFreeBatches = 0;
assert.equal(await chooseCreatorTranscript({ name: "Independent creator", videos:
  broadInventory.videos.map((video) => ({ ...video, title: "General video",
    description: "Public upload" })) }, { culturalSignals: [] }, [tag], [],
"Could another subject change our conclusion?", {
  classify: async () => { signalFreeBatches += 1; return { choice: null }; } }), null);
assert.equal(signalFreeBatches, 1);
assert.equal(await chooseCreatorTranscript(broadInventory, { culturalSignals: [] }, [tag],
  broadInventory.videos.map((video) => video.sourceId), "Is anything unresolved?",
  { classify: async () => { throw new Error("No candidate should be sent for selection."); } }), null);
let challengeFirst;
await chooseCreatorTranscript({ name: "Creator", videos: [
  { sourceId: "00000000000", title: "Recent trail video", description: "",
    publishedAt: "2025-01-01T00:00:00Z" },
  { sourceId: "00000000001", title: "Earlier repairs", description: "",
    publishedAt: "2020-01-01T00:00:00Z" },
  { sourceId: "00000000002", title: "New trail trip", description: "",
    publishedAt: "2026-01-01T00:00:00Z" },
] }, { culturalSignals: [] }, [tag], ["00000000000"],
"Could independent content from another period challenge this connection?",
{ challenge: true, classify: async (_prompt, input) => {
  challengeFirst = input.options[0].videoId;
  return { choice: null };
} });
assert.equal(challengeFirst, "00000000001");

const artist = { id: "artist-qloo-id", name: "Clairo", type: "urn:entity:artist" };
const artistDirection = [{ q: "indie pop music culture", signalIds: [artist.id] }];
assert.equal(isDirectCulturalSubjectChannel({ name: "Clairo Official" },
  [artist], artistDirection), true);
assert.equal(isDirectCulturalSubjectChannel({ name: "Independent music commentary" },
  [artist], artistDirection), false);
assert.equal(isDirectCulturalSubjectChannel({ name: "Clairo Official" },
  [artist], [{ q: "trail running", signalIds: [tag.id] }]), false);

const sample = [0, 1, 2, 3].map((index) => ({ id: String(index).padStart(11, "0"),
  title: `Trail running episode ${index}`, description: "Trail running across mountain routes",
  tags: [], publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }));
const meta = { culturalSignals: [sample[0], sample[3]].map((video) => ({ videoId: video.id,
  phrase: "Trail running", basisField: "description", basisText: "Trail running across mountain routes" })) };
const transcript = [{ findings: [{ videoId: sample[0].id, entity: "Trail running",
  centrality: "substantive", kind: "cultural_reference",
  speaker: "creator", stance: "supportive",
  sourceUrl: `https://www.youtube.com/watch?v=${sample[0].id}&t=30s` }] }];
const good = { connections: [{ tagId: tag.id, state: "supported",
  representativeVideoIds: [sample[0].id, sample[3].id], targetedVideoIds: [], counterVideoIds: [],
  observationIds: ["m0", "m1", "t0"], reason: "The topic recurs in independently sampled channel content." }] };
const checked = await reconcileChannel([tag], sample, [], meta, transcript,
  { classify: async () => good });
assert.equal(checked[0].state, "supported");
const noTranscript = await reconcileChannel([tag], sample, [], meta, [],
  { classify: async () => ({ connections: [{ ...good.connections[0], observationIds: ["m0", "m1"] }] }) });
assert.equal(noTranscript[0].state, "unknown");
const contentAlignment = await reconcileChannel([tag], sample, [], meta,
  [{ findings: [{ ...transcript[0].findings[0], speaker: "unknown", stance: "neutral",
    observation: "The spoken passage discusses trail running preparation." }] }],
  { classify: async () => good });
assert.equal(contentAlignment[0].state, "supported");
assert.deepEqual(contentAlignment[0].samplePrevalence, { matched: 2, reviewed: 4 });
const oldOnly = await reconcileChannel([tag], sample, [], { culturalSignals: sample.slice(0, 2)
  .map((video) => ({ videoId: video.id, phrase: "Trail running",
    basisField: "description", basisText: "Trail running across mountain routes" })) }, transcript,
{ classify: async () => ({ connections: [{ ...good.connections[0],
  representativeVideoIds: [sample[0].id, sample[1].id] }] }) });
assert.equal(oldOnly[0].state, "unknown");
const oneVideo = await reconcileChannel([tag], sample, [], meta, transcript,
  { classify: async () => ({ connections: [{ ...good.connections[0],
    representativeVideoIds: [sample[0].id], observationIds: ["m0", "t0"] }] }) });
assert.equal(oneVideo[0].state, "unknown");
const guest = await reconcileChannel([tag], sample, [], meta,
  [{ findings: [{ ...transcript[0].findings[0], speaker: "guest" }] }],
  { classify: async () => good });
assert.equal(guest[0].state, "unknown");
const critical = await reconcileChannel([tag], sample, [], meta,
  [{ findings: [{ ...transcript[0].findings[0], stance: "critical" }] }],
  { classify: async () => good });
assert.equal(critical[0].state, "unknown");
const interviewer = await reconcileChannel([tag], sample, [], meta,
  [{ findings: [{ ...transcript[0].findings[0], speaker: "interviewer" }] }],
  { classify: async () => good });
assert.equal(interviewer[0].state, "unknown");
const repeatedClip = [...sample];
repeatedClip[3] = { ...sample[3], title: sample[0].title };
const duplicated = await reconcileChannel([tag], repeatedClip, [], meta, transcript,
  { classify: async () => good });
assert.equal(duplicated[0].state, "unknown");
const oneOff = await reconcileChannel([tag], sample, [videos[39]], meta, transcript,
  { campaignMode: "one_off", classify: async () => ({ connections: [{ ...good.connections[0],
    representativeVideoIds: [sample[0].id], targetedVideoIds: [],
    observationIds: ["m0", "t0"] }] }) });
assert.equal(oneOff[0].state, "unknown");
const focusedDeep = await reconcileChannel([tag], sample, [videos[39]], meta,
  [{ findings: [{ ...transcript[0].findings[0], videoId: videos[39].id,
    centrality: "central", sourceUrl: `https://www.youtube.com/watch?v=${videos[39].id}&t=30s` }] }],
  { campaignMode: "one_off", classify: async () => ({ connections: [{ ...good.connections[0],
    representativeVideoIds: [sample[0].id], targetedVideoIds: [videos[39].id],
    observationIds: ["m0", "t0"] }] }) });
assert.equal(focusedDeep[0].state, "supported");

const creatorEvidence = { source: "transcript", videoId: sample[0].id,
  speaker: "creator", stance: "supportive", centrality: "central" };
const creator = (name, rep, central) => ({ name, confidence: "medium",
  connections: [{ state: "supported", representativeVideoIds: rep,
    counterVideoIds: [], evidence: central ? [creatorEvidence] : [] }],
  sourceVideos: sample.map((video) => ({ id: video.id, publishedAt: video.publishedAt })) });
const broad = creator("Broad", [sample[0].id, sample[1].id], false);
const deep = creator("Deep", [sample[0].id], true);
assert.equal(rankCreatorChannels([deep, broad], "ongoing")[0].name, "Broad");
assert.equal(rankCreatorChannels([broad, deep], "one_off")[0].name, "Deep");
const highAffinity = { ...broad, name: "Higher brand signal", connections: [{
  ...broad.connections[0], qlooAffinity: 0.8 }] };
const lowAffinity = { ...broad, name: "Lower brand signal", connections: [{
  ...broad.connections[0], qlooAffinity: 0.5 }] };
assert.equal(rankCreatorChannels([lowAffinity, highAffinity], "ongoing")[0].name,
  "Higher brand signal");

const channelId = `UC${"a".repeat(22)}`;
const activityNow = new Date("2026-10-24T12:00:00.000Z");
assert.equal(hasRecentPublicUpload("2026-07-24T12:00:00.000Z", activityNow), true);
assert.equal(hasRecentPublicUpload("2026-07-24T11:59:59.000Z", activityNow), false);
assert.equal(hasRecentPublicUpload("2026-10-25T00:00:00.000Z", activityNow), false);
assert.equal(hasRecentPublicUpload("2026-02-28T12:00:00.000Z",
  new Date("2026-05-31T12:00:00.000Z")), true);
assert.equal(hasRecentPublicUpload(null, activityNow), false);
const emptyActivity = await latestChannelUpload(channelId, { playlistId: "uploads" }, {
  now: activityNow, list: async () => ({ items: [] }) });
assert.equal(emptyActivity.state, "empty");
const unknownActivity = await latestChannelUpload(channelId, { playlistId: "uploads" }, {
  now: activityNow, list: async () => ({ items: [{ contentDetails: { videoId: "00000000000" } }] }) });
assert.equal(unknownActivity.state, "unknown");
const allIds = Array.from({ length: 80 }, (_, index) => String(index).padStart(11, "0"));
const requestedPages = [];
const fakeList = async (resource, params) => {
  if (resource === "playlistItems") {
    requestedPages.push(params.pageToken ?? "first");
    const offset = params.pageToken ? 50 : 0;
    return { items: allIds.slice(offset, offset + params.maxResults)
      .map((id) => ({ contentDetails: { videoId: id,
        videoPublishedAt: "2026-09-30T12:00:00.000Z" } })),
    nextPageToken: offset ? undefined : "second" };
  }
  return { items: params.id.split(",").map((id) => ({ id,
    snippet: { channelId, title: `Video ${id}`, description: "", tags: [] },
    contentDetails: { duration: "PT5M" } })) };
};
const activity = await latestChannelUpload(channelId, { playlistId: "uploads" },
  { now: activityNow, list: fakeList });
assert.equal(activity.state, "observed");
assert.equal(hasRecentPublicUpload(activity.publishedAt, activityNow), true);
const inventory = await channelInventory(channelId, { maxVideos: 80,
  profile: { id: channelId, name: "Creator", playlistId: "uploads" }, list: fakeList,
  firstPage: activity.firstPage, requiredVideoId: activity.videoId });
assert.equal(inventory.inventoryCount, 80);
assert.equal(inventory.hasMore, false);
assert.deepEqual(requestedPages, ["first", "second"]);
const manyIds = Array.from({ length: 1200 }, (_, index) => String(index).padStart(11, "0"));
const broadList = async (resource, params) => {
  if (resource === "playlistItems") {
    const offset = Number(params.pageToken ?? 0);
    return { items: manyIds.slice(offset, offset + params.maxResults)
      .map((id) => ({ contentDetails: { videoId: id } })),
    nextPageToken: offset + params.maxResults < manyIds.length
      ? String(offset + params.maxResults) : undefined };
  }
  return { items: params.id.split(",").map((id) => ({ id,
    snippet: { channelId, title: `Video ${id}`, description: "", tags: [] },
    contentDetails: { duration: "PT5M" } })) };
};
const wideInventory = await channelInventory(channelId, { maxVideos: 100, maxListed: 1200,
  profile: { id: channelId, name: "Creator", playlistId: "uploads" }, list: broadList });
assert.equal(wideInventory.listedCount, 1200);
assert.equal(wideInventory.inventoryCount, 100);
assert(wideInventory.videos.some((video) => Number(video.id) > 1000));
assert.equal(wideInventory.hasMore, true);
const exact = await exactChannelVideos(channelId, [allIds[1], allIds[2]], {
  list: async () => ({ items: [{ id: allIds[1], snippet: { channelId, title: "Valid" } },
    { id: allIds[2], snippet: { channelId: `UC${"b".repeat(22)}`, title: "Wrong owner" } }] }) });
assert.deepEqual(exact.map((item) => item.id), [allIds[1]]);
const inferredIdentity = await classifyCreatorChannelFromInventory({ id: channelId,
  name: "Independent creator", description: "" }, [{ id: allIds[0],
  title: "My work", description: "I am Sam, the host of this channel." }],
{ classify: async () => ({ kind: "creator", videoId: allIds[0],
  basisField: "description", basisText: "I am Sam", reason: "The host names themselves." }) });
assert.equal(inferredIdentity.kind, "creator");
const inventedIdentity = await classifyCreatorChannelFromInventory({ id: channelId,
  name: "Independent creator", description: "" }, [{ id: allIds[0],
  title: "My work", description: "I am Sam, the host of this channel." }],
{ classify: async () => ({ kind: "creator", videoId: allIds[0],
  basisField: "description", basisText: "I am another person", reason: "Unsupported identity." }) });
assert.equal(inventedIdentity.kind, "unknown");
const previousLlm = Object.fromEntries(["LLM_PROVIDER", "LLM_API_URL", "LLM_API_KEY", "LLM_MODEL"]
  .map((key) => [key, process.env[key]]));
process.env.LLM_PROVIDER = "openai";
process.env.LLM_API_URL = "http://unused.test";
process.env.LLM_API_KEY = "fixture";
process.env.LLM_MODEL = "fixture";
const finding = { offsetMs: 0, phrase: "repair outdoor jackets",
  subject: "outdoor jackets", subjectOffsetMs: 0,
  observation: "The speaker explains repairing outdoor jackets instead of discarding them.",
  centrality: "central", kind: "cultural_reference", speaker: "creator",
  speakerBasis: "I am Sam", stance: "supportive",
  stanceBasis: "instead of throwing them away" };
const caption = [{ offsetMs: 0, durationMs: 4000,
  text: "I am Sam, and I repair outdoor jackets instead of throwing them away." }];
const fakeLlm = (item) => async () => ({ ok: true, status: 200,
  headers: { get: () => null }, json: async () => ({ choices: [{ message: {
    content: JSON.stringify({ findings: [item] }) } }] }) });
try {
  const valid = await extractCreatorTranscript(allIds[0], caption,
    { fetchFn: fakeLlm(finding) });
  assert.equal(valid[0].entity, "outdoor jackets");
  assert.equal(valid[0].speaker, "creator");
  assert.match(valid[0].observation, /repairing outdoor jackets/);
  const unsupportedAction = await extractCreatorTranscript(allIds[0], caption,
    { fetchFn: fakeLlm({ ...finding, observation: "The creator launches a global charity." }) });
  assert.equal(unsupportedAction[0].observation, "Discusses outdoor jackets");
  const inventedSubject = await extractCreatorTranscript(allIds[0], caption,
    { fetchFn: fakeLlm({ ...finding, subject: "unicorns" }) });
  assert.equal(inventedSubject.length, 0);
} finally {
  for (const [key, value] of Object.entries(previousLlm)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
const packet = buildCreatorReviewPacket("run", { brandName: "Test brand",
  campaignMode: "ongoing", culturalSignals: [tag], reviewed: [
    { ...broad, channelId: channelId, url: "https://www.youtube.com/channel/test",
      status: "shortlisted", coverage: {} },
    { ...deep, channelId: `UC${"b".repeat(22)}`, url: "https://www.youtube.com/channel/test2",
      status: "unverified", coverage: {} }],
  unreviewedCandidateCount: 3, searchIssueCount: 0, candidateIssueCount: 0 });
assert.equal(packet.cases[0].reviewerA, null);
assert.equal(creatorReviewMetrics(packet).precisionAt10, null);
packet.cases[0].adjudicatedLabel = "not_relevant";
packet.cases[1].adjudicatedLabel = "relevant";
assert.deepEqual([creatorReviewMetrics(packet).falsePositive,
  creatorReviewMetrics(packet).falseNegative], [1, 1]);
const publicResult = presentYoutubeResult({ qlooResponseIds: ["private-response"],
  culturalConnections: [{ id: tag.id, name: tag.name }],
  channels: [{ ...broad, channelId, url: "https://www.youtube.com/channel/example",
    connections: [{ tagId: tag.id, tagName: tag.name, state: "supported",
      reason: "Source-grounded recurring content.", evidence: [], counterVideoIds: [] }],
    coverage: { inventoryCount: 30, representativeCount: 12 } }],
  coverage: { complete: false } });
assert.equal(JSON.stringify(publicResult).includes("private-response"), false);
assert.equal(JSON.stringify(publicResult).includes(tag.id), false);
assert.equal(JSON.stringify(publicResult).includes(channelId), false);
console.log("YouTube direction, sample, and evidence gates passed.");
