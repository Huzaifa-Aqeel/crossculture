import pg from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import { personalQlooEntityTags, personalQlooRecommendCulturalEntities } from "./personal-qloo.mjs";
import { classifyCreatorChannel, extractCreatorMetadata,
  classifyCreatorChannelFromInventory, extractCreatorTranscript,
  chooseCreatorTranscript, llmJson } from "./creator-intelligence.mjs";
import { selectedVideoTranscript } from "./youtube-transcript.mjs";
import { searchCreatorVideoPage, channelSummary, channelInventory,
  exactChannelVideos, latestChannelUpload, recentCreatorViewContext } from "./youtube-research-client.mjs";
import { clusterCulturalSignals, redundantCreatorQuery, shouldExpandCreatorSearch,
  summarizeCreatorDiscovery } from "./youtube-discovery.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let pool;
const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }));

const directionSchema = z.object({ queries: z.array(z.object({ q: z.string().min(4).max(90),
  signalIds: z.array(z.string()).min(1).max(3),
  family: z.enum(["direct", "practice", "expression", "adjacent", "format"]).optional(),
}).strict()).min(1).max(12) }).strict();

export async function planYoutubeDirections(brandName, tags, { classify = llmJson,
  clusters = [] } = {}) {
  const allowed = new Set(tags.map((tag) => tag.id));
  const clusterBySignal = new Map(clusters.flatMap((cluster) => cluster.members.map((member) =>
    [member.id, cluster.id])));
  const response = await classify(`Plan distinct US YouTube VIDEO searches across the most promising supplied cultural directions, up to twelve searches total.
Search for creator activities, demonstrations or documentary subjects, not the starting brand or its corporate profile.
Use natural short search phrases, not questions. Do not assert customer demographics, audience overlap or sponsorship.
Each query must cite 1 to 3 exact supplied tag IDs. When evidence supports it, vary direct interest, practice, cultural expression, adjacent subject, and content format. Do not force every family for every signal. Give each query a family.
Affinity values from the same response can prioritize which tags receive searches; never treat them as creator scores or compare values from different response types.
Do not invent a named person, location, brand or event.`,
  { brandName, tags: tags.map(({ id, name, type, affinity }) => ({ id, name, type,
    affinity: Number.isFinite(affinity) ? affinity : null })) },
  directionSchema, { maxTokens: 1300 });
  const name = brandName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const used = new Map(); const output = [];
  for (const item of response.queries) {
    const q = item.q.replace(/\s+/g, " ").trim();
    const primary = item.signalIds[0];
    const clusterId = clusterBySignal.get(primary) ?? primary;
    if (!item.signalIds.every((id) => allowed.has(id)) || !primary ||
        output.some((prior) => redundantCreatorQuery(prior.q, q)) ||
        q.toLowerCase().includes(name) || /[?\r\n]/.test(q) ||
        /\b(?:customers|audience|sponsor|partnership)\b/i.test(q) ||
        (used.get(clusterId) ?? 0) >= 3) continue;
    used.set(clusterId, (used.get(clusterId) ?? 0) + 1);
    output.push({ q, signalIds: item.signalIds,
      clusterIds: [...new Set(item.signalIds.map((id) => clusterBySignal.get(id) ?? id))],
      family: item.family ?? "direct" });
    if (output.length >= 12) break;
  }
  return output;
}

export function representativeVideos(videos, limit = 12) {
  if (!Array.isArray(videos) || !videos.length) return [];
  const ordered = [...videos].filter((video) => video?.id).sort((a, b) =>
    String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")));
  const count = Math.min(limit, ordered.length);
  if (count === ordered.length) return ordered;
  // Equal upload-count strata preserve the observed topic distribution while
  // covering the publication timeline. The stable hash makes replays identical.
  return Array.from({ length: count }, (_, stratum) => {
    const start = Math.floor(stratum * ordered.length / count);
    const end = Math.floor((stratum + 1) * ordered.length / count);
    const hash = createHash("sha256").update(`${ordered[0].channelId ?? ordered[0].id}:${
      stratum}`).digest().readUInt32BE(0);
    return ordered[start + hash % Math.max(1, end - start)];
  });
}

const terms = (value) => String(value ?? "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
export function independentContentGroup(video) {
  const title = String(video?.title ?? "").toLowerCase()
    .replace(/\b(?:clip|short|highlights?|excerpt|part\s*\d+)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return title.split(/\s+/).filter(Boolean).length >= 4 ? title : `video:${video?.id ?? "unknown"}`;
}
const comparableName = (value) => String(value ?? "").toLowerCase()
  .replace(/\b(?:official|topic|music)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function isDirectCulturalSubjectChannel(profile, tags, directions) {
  const signalIds = new Set(directions.flatMap((item) => item.signalIds));
  return tags.some((item) => item.type === "urn:entity:artist" && signalIds.has(item.id) &&
    comparableName(profile.name) === comparableName(item.name));
}

function transcriptWindows(segments) {
  const windows = [];
  for (let start = 0; start < segments.length; start += 60)
    windows.push({ start, slice: segments.slice(start, start + 80) });
  return windows;
}

export function selectTranscriptSegments(segments, phrases,
  { targeted = false, semanticStarts = [] } = {}) {
  if (!Array.isArray(segments) || segments.length <= 240) return segments ?? [];
  const windows = [];
  const words = new Set(phrases.flatMap(terms));
  for (const { start, slice } of transcriptWindows(segments)) {
    const score = slice.reduce((total, item) => total +
      terms(item.text).filter((word) => words.has(word)).length, 0);
    windows.push({ start, slice, score });
  }
  const selected = new Map();
  for (const index of [0, Math.floor((windows.length - 1) / 2), windows.length - 1])
    selected.set(windows[index].start, windows[index]);
  for (const start of semanticStarts.slice(0, 2)) {
    const window = windows.find((item) => item.start === start);
    if (window && selected.size < 5) selected.set(start, window);
  }
  if (targeted) for (const window of [...windows].sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, 4)) { if (selected.size < 5) selected.set(window.start, window); }
  return [...new Map([...selected.values()].sort((a, b) => a.start - b.start)
    .flatMap((item) => item.slice).map((item) => [item.offsetMs, item])).values()]
    .slice(0, 500);
}

const semanticWindowSchema = z.object({ starts: z.array(z.number().int().nonnegative()).max(2) }).strict();

export async function semanticTranscriptWindows(segments, phrases, { classify = llmJson } = {}) {
  if (!Array.isArray(segments) || segments.length <= 240) return [];
  const windows = transcriptWindows(segments);
  const outlines = windows.map(({ start, slice }) => ({ start,
    excerpts: [0, 10, 20, 30, 40, 50, 60, 70].flatMap((index) =>
      slice[index]?.text ? [slice[index].text.slice(0, 130)] : []) }));
  const response = await classify(`Select at most two transcript windows whose spoken content could substantively support OR challenge the supplied cultural questions. Consider meaning and synonyms, not only matching words. A generic passing mention is weak. Return only exact supplied start indices. These excerpts are incomplete; do not infer a verdict.`,
  { questions: phrases.slice(0, 12), windows: outlines }, semanticWindowSchema,
  { maxTokens: 150 });
  const allowed = new Set(windows.map((item) => item.start));
  return [...new Set(response.starts)].filter((start) => allowed.has(start)).slice(0, 2);
}
export function targetedVideos(videos, searchHits, tags, excludedIds, limit = 8) {
  const excluded = new Set(excludedIds);
  const hitIds = new Set(searchHits.map((hit) => hit.videoId));
  const words = new Set(tags.flatMap((tag) => terms(tag.name)));
  return [...videos].filter((video) => !excluded.has(video.id)).map((video) => ({ video,
    hit: hitIds.has(video.id) ? 1 : 0,
    overlap: terms(`${video.title} ${video.description.slice(0, 300)} ${video.tags.join(" ")}`)
      .filter((word) => words.has(word)).length,
  })).sort((a, b) => b.hit - a.hit || b.overlap - a.overlap ||
    String(b.video.publishedAt ?? "").localeCompare(String(a.video.publishedAt ?? "")))
    .filter((item) => item.hit || item.overlap).slice(0, limit).map((item) => item.video);
}

function metadataProfile(inventory, sampled) {
  return { id: inventory.id, name: inventory.name, videos: sampled.map((video) => ({
    sourceId: video.id, ownerId: inventory.id, title: video.title,
    description: video.description, tags: video.tags, publishedAt: video.publishedAt,
    sourceUrl: video.url, duration: video.duration,
  })) };
}

async function observedTranscript(channelId, video, phrases, { targeted = false } = {}) {
  // Extraction inspects a bounded mix of general and query-relevant windows.
  // A second brand may need different windows from the same video; keep those
  // observations separate rather than treating one brand's sample as complete.
  const scopeKey = createHash("sha256").update(JSON.stringify({ version: 4, targeted,
    phrases: [...new Set(phrases.map((value) => String(value).toLowerCase().trim()))].sort() }))
    .digest("hex");
  const cached = await db().query(`select status,observations_json from private.youtube_transcript_observations
    where video_id=$1 and channel_id=$2 and scope_key=$3 and retain_until>now()`,
  [video.id, channelId, scopeKey]);
  if (cached.rows[0]) return { videoId: video.id, status: cached.rows[0].status,
    findings: cached.rows[0].observations_json, cacheStatus: "fresh" };
  const transcript = await selectedVideoTranscript(video.id, { enabled: true });
  let findings = [];
  if (transcript.status === "available") {
    try {
      const semanticStarts = await semanticTranscriptWindows(transcript.segments, phrases)
        .catch(() => []);
      findings = await extractCreatorTranscript(video.id,
        selectTranscriptSegments(transcript.segments, phrases, { targeted, semanticStarts }));
    }
    catch { return { videoId: video.id, status: "analysis_unavailable", findings: [] }; }
  }
  if (["available", "no_captions"].includes(transcript.status)) await db().query(`insert into private.youtube_transcript_observations
    (video_id,scope_key,channel_id,status,observations_json) values ($1,$2,$3,$4,$5::jsonb)
    on conflict (video_id,scope_key) do update set channel_id=excluded.channel_id,status=excluded.status,
      observations_json=excluded.observations_json,observed_at=now(),retain_until=now()+interval '15 days'`,
  [video.id, scopeKey, channelId, transcript.status, JSON.stringify(findings)]);
  return { videoId: video.id, status: transcript.status, findings, cacheStatus: "new" };
}

const connectionSchema = z.object({ connections: z.array(z.object({
  tagId: z.string(), state: z.enum(["supported", "unknown", "contradicted"]),
  representativeVideoIds: z.array(z.string()).max(12),
  targetedVideoIds: z.array(z.string()),
  counterVideoIds: z.array(z.string()).max(12),
  observationIds: z.array(z.string()).max(20),
  reason: z.string().min(8).max(260),
}).strict()).max(10) }).strict();

export async function reconcileChannel(tags, representative, targeted, metadata, transcripts,
  { classify = llmJson, campaignMode = "ongoing" } = {}) {
  const sampled = [...new Map([...representative, ...targeted].map((item) => [item.id, item])).values()];
  const sampledIds = new Set(sampled.map((item) => item.id));
  const repIds = new Set(representative.map((item) => item.id));
  const targetIds = new Set(targeted.map((item) => item.id));
  const tagIds = new Set(tags.map((item) => item.id));
  const extracted = metadata.culturalSignals ?? [];
  const validSignals = extracted.filter((item) => sampledIds.has(item.videoId) &&
    ["title", "description", "tags"].includes(item.basisField) &&
    sampled.some((video) => video.id === item.videoId &&
      (item.basisField === "tags" ? video.tags.join(" ") : video[item.basisField])
        ?.toLowerCase().includes(String(item.basisText ?? "").toLowerCase())));
  const findings = transcripts.flatMap((item) => item.findings ?? [])
    .filter((item) => sampledIds.has(item.videoId) && typeof item.sourceUrl === "string");
  const observations = new Map([
    ...validSignals.map((item, index) => [`m${index}`, { ...item, source: "metadata" }]),
    ...findings.map((item, index) => [`t${index}`, { ...item, source: "transcript" }]),
  ]);
  const output = await classify(`Assess ONLY the supplied brand cultural tags against observed channel content.
Use representative videos to judge whether a topic is recurring; targeted videos only establish depth.
Reject incidental, generic, guest-only, paid-only and historic-only associations as positive proof. Critical content is a challenge, not support.
Assess channel-content alignment. Neutral but substantive activity coverage can support content alignment when repeated across representative videos; do not claim personal endorsement from it. Use transcript observations for stance and depth. A missing transcript is unknown, not negative.
Return exactly the supplied observation IDs and video IDs that bear on each tag. Do not cite a video without a matching observation.
Do not infer audience overlap, sales, or a brand partnership.
Explain the observed content in plain language; do not mention providers, APIs, models or internal research steps.
State 'supported' only for specific evidence across independent videos; otherwise 'unknown' or 'contradicted'.`,
  { tags, representative: representative.map((video) => ({ id: video.id, title: video.title,
    description: video.description.slice(0, 400), publishedAt: video.publishedAt })),
    targeted: targeted.map((video) => ({ id: video.id, title: video.title,
      description: video.description.slice(0, 400), publishedAt: video.publishedAt })),
    observations: [...observations].map(([id, value]) => ({ id, ...value })) },
  connectionSchema, { maxTokens: 1900 });
  const seen = new Set();
  return output.connections.filter((item) => tagIds.has(item.tagId) && !seen.has(item.tagId) &&
    (seen.add(item.tagId), true)).map((item) => {
    const rep = [...new Set(item.representativeVideoIds)].filter((id) => repIds.has(id));
    const repGroups = new Set(rep.map((id) => independentContentGroup(
      representative.find((video) => video.id === id))));
    const reviewedGroups = new Set(representative.map(independentContentGroup));
    const target = [...new Set(item.targetedVideoIds)].filter((id) => targetIds.has(id));
    const counter = [...new Set(item.counterVideoIds)].filter((id) => sampledIds.has(id));
    const cited = new Set([...rep, ...target]);
    const citedObservations = [...new Set(item.observationIds)].map((id) => observations.get(id))
      .filter((value) => value && cited.has(value.videoId));
    const grounded = [...new Set(citedObservations.map((x) => x.videoId))];
    const transcriptGrounded = citedObservations.some((x) => x.source === "transcript" &&
      ["central", "substantive"].includes(x.centrality) &&
      ["cultural_reference", "expertise"].includes(x.kind) &&
      ["creator", "unknown"].includes(x.speaker) &&
      ["supportive", "neutral"].includes(x.stance));
    const citedContradiction = citedObservations.some((x) => x.source === "transcript" &&
      (x.kind === "contradiction" || x.stance === "critical"));
    const minimumRecurring = campaignMode === "one_off" ? 1 :
      Math.max(2, Math.ceil(reviewedGroups.size / 4));
    const recentRepresentative = new Set([...representative]
      .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))
      .slice(0, Math.max(1, Math.ceil(representative.length / 3)))
      .map((video) => video.id));
    const currentInSample = rep.some((id) => recentRepresentative.has(id));
    const quarter = (video) => {
      const date = Date.parse(video?.publishedAt ?? "");
      if (!Number.isFinite(date)) return null;
      const parsed = new Date(date);
      return `${parsed.getUTCFullYear()}-Q${Math.floor(parsed.getUTCMonth() / 3) + 1}`;
    };
    const availablePeriods = new Set(representative.map(quarter).filter(Boolean));
    const matchingPeriods = new Set(rep.map((id) => quarter(
      representative.find((video) => video.id === id))).filter(Boolean));
    const continuousInSample = availablePeriods.size < 2 || matchingPeriods.size >= 2;
    const independentTargetEvidence = citedObservations.some((x) => x.source === "transcript" &&
      target.includes(x.videoId) && ["creator", "unknown"].includes(x.speaker) &&
      ["supportive", "neutral"].includes(x.stance) && x.centrality === "central" &&
      ["cultural_reference", "expertise"].includes(x.kind));
    const supported = item.state === "supported" && repGroups.size >= minimumRecurring &&
      rep.every((id) => grounded.includes(id)) && grounded.length >= minimumRecurring &&
      transcriptGrounded && !citedContradiction && !counter.length &&
      (campaignMode === "one_off" || currentInSample && continuousInSample) &&
      (campaignMode !== "one_off" || independentTargetEvidence);
    const evidence = [...new Set(item.observationIds)].flatMap((id) => {
      const observation = observations.get(id);
      const video = sampled.find((entry) => entry.id === observation?.videoId);
      if (!video || !cited.has(video.id)) return [];
      return [{ videoId: video.id, source: observation.source,
        observation: observation.source === "transcript"
          ? observation.observation ?? `Discusses ${observation.entity}` : observation.phrase,
        subject: observation.source === "transcript" ? observation.entity : observation.phrase,
        kind: observation.kind ?? null, centrality: observation.centrality ?? null,
        speaker: observation.speaker ?? null, stance: observation.stance ?? null,
        url: observation.source === "transcript" ? observation.sourceUrl : video.url }];
    }).slice(0, 8);
    const signal = tags.find((tag) => tag.id === item.tagId);
    const directEvidence = citedObservations.some((observation) =>
      String(observation.source === "transcript" ? observation.entity : observation.phrase)
        .trim().toLowerCase() === String(signal?.name ?? "").trim().toLowerCase());
    return { tagId: item.tagId, tagName: signal?.name,
      qlooAffinity: signal?.type?.endsWith(":qloo") && Number.isFinite(signal.affinity)
        ? signal.affinity : null, directEvidence,
      state: supported ? "supported" : item.state === "contradicted" && counter.length ? "contradicted" : "unknown",
      reason: item.reason, representativeVideoIds: rep, targetedVideoIds: target,
      counterVideoIds: counter, transcriptGrounded, currentInSample,
      continuousInSample, evidence,
      samplePrevalence: { matched: repGroups.size, reviewed: reviewedGroups.size } };
  });
}

export function shouldDeepenCreatorInventory(tags, metadata, preliminary, representative = []) {
  const representativeIds = new Set(representative.map((video) => video.id));
  const directMetadata = (metadata.culturalSignals ?? []).filter((signal) =>
    ["central", "substantive"].includes(signal.centrality) && tags.some((tag) =>
      `${signal.phrase} ${signal.basisText}`.toLowerCase().includes(tag.name.toLowerCase())));
  const directIds = new Set(directMetadata.map((signal) => signal.videoId));
  return directIds.size >= 2 && [...directIds].some((id) => representativeIds.has(id)) ||
    preliminary.some((connection) => {
      const observed = new Set(connection.evidence.filter((entry) =>
        ["central", "substantive"].includes(entry.centrality)).map((entry) => entry.videoId));
      return observed.size >= 2 && [...observed].some((id) => representativeIds.has(id));
    });
}

export function hasUnreviewedGroundedCreatorProspect(available, attempted, targeted,
  metadata, connections, tags = []) {
  const attemptedIds = attempted instanceof Set ? attempted : new Set(attempted);
  const grounded = new Set([
    ...targeted.map((video) => video.id),
    ...(metadata.culturalSignals ?? []).filter((signal) =>
      ["central", "substantive", "contradictory"].includes(signal.centrality))
      .map((signal) => signal.videoId),
    ...connections.flatMap((connection) => connection.evidence.map((entry) => entry.videoId)),
  ]);
  const namedPhrases = tags.map((tag) => String(tag.name ?? "").trim().toLowerCase())
    .filter((name) => name.length >= 5);
  return available.some((video) => !attemptedIds.has(video.id) && (
    grounded.has(video.id) || namedPhrases.some((name) =>
      `${video.title ?? ""} ${(video.tags ?? []).join(" ")}`.toLowerCase().includes(name))));
}

export function hasRecentPublicUpload(publishedAt, now = new Date()) {
  const observed = Date.parse(publishedAt ?? "");
  if (!Number.isFinite(observed) || observed > now.getTime()) return false;
  const month = now.getUTCMonth() - 3;
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), month + 1, 0)).getUTCDate();
  const cutoff = Date.UTC(now.getUTCFullYear(), month,
    Math.min(now.getUTCDate(), lastDay), now.getUTCHours(), now.getUTCMinutes(),
    now.getUTCSeconds(), now.getUTCMilliseconds());
  return observed >= cutoff;
}

async function researchCandidate(candidate, tags, profile, campaignMode, initialIdentity, activity) {
  const configuredInventory = Number(process.env.YOUTUBE_RESEARCH_MAX_INVENTORY ?? 600);
  const maxVideos = Number.isSafeInteger(configuredInventory)
    ? Math.max(50, Math.min(1000, configuredInventory)) : 600;
  let inventory = await channelInventory(candidate.channelId, {
    profile, maxVideos: Math.min(150, maxVideos), firstPage: activity.firstPage,
    requiredVideoId: activity.videoId });
  if (!inventory || !inventory.videos.length) return null;
  const directionIds = new Set(candidate.directions.flatMap((item) => item.signalIds));
  const focusTags = tags.filter((item) => directionIds.has(item.id)).slice(0, 6);
  if (!focusTags.length) return null;
  let representative = representativeVideos(inventory.videos);
  const identity = initialIdentity.kind === "creator" ? initialIdentity :
    await classifyCreatorChannelFromInventory(profile, representative).catch(() => ({ kind: "unknown" }));
  const inventoried = new Set(inventory.videos.map((item) => item.id));
  const missingHitIds = [...new Set(candidate.hits.map((item) => item.videoId))]
    .filter((id) => !inventoried.has(id)).slice(0, 8);
  const exactHits = await exactChannelVideos(inventory.id, missingHitIds);
  let targeted = targetedVideos([...inventory.videos, ...exactHits], candidate.hits, focusTags,
    representative.map((video) => video.id));
  let selected = [...representative, ...targeted];
  let metadata = await extractCreatorMetadata(metadataProfile(inventory, selected), { tags: focusTags });
  let deepened = false;
  let expansionIssue = null;
  if (inventory.hasMore) {
    const preliminary = await reconcileChannel(focusTags, representative, targeted, metadata, [],
      { campaignMode }).catch(() => []);
    const potential = shouldDeepenCreatorInventory(focusTags, metadata, preliminary, representative);
    if (potential) {
      try {
        const expanded = await channelInventory(candidate.channelId, { profile, maxVideos,
          maxListed: 10000 });
        if (expanded?.videos.length) {
          const expandedRepresentative = representativeVideos(expanded.videos);
          const expandedTargeted = targetedVideos([...expanded.videos, ...exactHits],
            candidate.hits, focusTags, expandedRepresentative.map((video) => video.id));
          const expandedSelected = [...expandedRepresentative, ...expandedTargeted];
          const selectedIds = new Set(expandedSelected.map((video) => video.id));
          const reusable = { ...metadata,
            culturalSignals: metadata.culturalSignals.filter((item) => selectedIds.has(item.videoId)),
            demonstratedFormats: metadata.demonstratedFormats.filter((item) => selectedIds.has(item.videoId)),
            collaborationObservations: metadata.collaborationObservations.filter((item) => selectedIds.has(item.videoId)),
            sourceCoverage: { extractedVideoIds: metadata.sourceCoverage.extractedVideoIds
              .filter((id) => selectedIds.has(id)) } };
          const expandedMetadata = await extractCreatorMetadata(metadataProfile(expanded, expandedSelected),
            { tags: focusTags, reusable });
          inventory = expanded;
          representative = expandedRepresentative;
          targeted = expandedTargeted;
          selected = expandedSelected;
          metadata = expandedMetadata;
          deepened = true;
        }
      } catch (error) { expansionIssue = error.code ?? "expanded_inventory_unavailable"; }
    }
  }
  const available = [...new Map([...inventory.videos, ...exactHits]
    .map((video) => [video.id, video])).values()];
  const byId = new Map(available.map((video) => [video.id, video]));
  const signalCount = (video) => metadata.culturalSignals?.filter((item) =>
    item.videoId === video.id && ["central", "substantive"].includes(item.centrality)).length ?? 0;
  const representativeByProspect = [...representative].sort((a, b) =>
    signalCount(b) - signalCount(a));
  const transcripts = [];
  let connections = [];
  let transcriptStopReason = "no_useful_video";
  const attempted = new Set();
  const transcriptQuestions = [];
  for (let turn = 0; ; turn += 1) {
    const unresolved = connections.filter((item) => item.state !== "supported");
    const previouslySupported = connections.some((item) => item.state === "supported");
    const focusConnection = previouslySupported
      ? connections.find((item) => item.state === "supported") : unresolved[0];
    const focus = (focusConnection && focusTags.find((tag) => tag.id === focusConnection.tagId)) ?? focusTags[0];
    const researchQuestion = previouslySupported
      ? `Could independent content from another period contradict the apparent ${focus.name} connection?`
      : `Does this creator repeatedly and substantively discuss ${focus.name} in their own voice, beyond the discovery video?`;
    let video = turn === 0 ? (targeted[0] ?? representativeByProspect[0]) :
      turn === 1 ? representativeByProspect.find((item) => !attempted.has(item.id)) : null;
    if (!video) {
      const choices = metadataProfile(inventory, available);
      let proposed;
      try {
        proposed = await chooseCreatorTranscript(choices, metadata, focusTags,
          [...attempted], researchQuestion, { targetedVideos: candidate.hits.filter((hit) =>
            byId.has(hit.videoId)).map((hit) => ({
            sourceId: hit.videoId, title: hit.title, description: "",
            publishedAt: hit.publishedAt, sourceRole: "discovery_hit" })),
            challenge: previouslySupported,
            evidenceState: connections.map((item) => ({ tag: item.tagName,
              state: item.state, samplePrevalence: item.samplePrevalence,
              observations: item.evidence.map((entry) => entry.observation).slice(0, 5) })) });
      } catch {
        transcriptStopReason = "selection_unavailable";
        break;
      }
      video = byId.get(proposed?.videoId);
      if (!video) { transcriptStopReason = "no_decision_changing_video"; break; }
      if (!selected.some((item) => item.id === video.id)) {
        selected.push(video);
        targeted.push(video);
        metadata = await extractCreatorMetadata(metadataProfile(inventory, selected),
          { tags: focusTags, reusable: metadata });
      }
    }
    attempted.add(video.id);
    transcriptQuestions.push({ videoId: video.id, question: researchQuestion });
    transcripts.push(await observedTranscript(inventory.id, video,
      [...focusTags.map((tag) => tag.name), ...(metadata.culturalSignals ?? []).map((item) => item.phrase)],
      { targeted: targeted.some((item) => item.id === video.id) }));
    connections = await reconcileChannel(focusTags, representative, targeted, metadata, transcripts,
      { campaignMode });
    transcriptStopReason = "unresolved";
    // Once both discovery and representative content have had a chance, do not
    // scan an arbitrary remainder of uploads without a source-grounded prospect.
    if (turn >= 1 && !hasUnreviewedGroundedCreatorProspect(available, attempted,
      targeted, metadata, connections, focusTags)) {
      transcriptStopReason = "no_grounded_prospect";
      break;
    }
  }
  const supported = connections.filter((item) => item.state === "supported");
  const completeSample = (metadata.sourceCoverage?.extracted ?? 0) >= selected.length;
  const availableCaptions = transcripts.filter((item) => item.status === "available").length;
  const evidencePeriods = new Set(supported.flatMap((item) => item.representativeVideoIds)
    .map((id) => selected.find((video) => video.id === id)?.publishedAt)
    .filter(Boolean).map((date) => {
      const parsed = new Date(date);
      return `${parsed.getUTCFullYear()}-Q${Math.floor(parsed.getUTCMonth() / 3) + 1}`;
    }));
  const confidence = !inventory.hasMore && completeSample && representative.length >= 8 &&
    availableCaptions >= 2 && (!supported.length || evidencePeriods.size >= 2)
    ? "high" : completeSample && representative.length >= 6 &&
    availableCaptions >= 1 ? "medium" : "low";
  const citedIds = new Set(connections.flatMap((item) => [...item.representativeVideoIds,
    ...item.targetedVideoIds, ...item.counterVideoIds]));
  const sources = selected.filter((item) => citedIds.has(item.id)).map((item) => ({ id: item.id,
    title: item.title, url: item.url, publishedAt: item.publishedAt,
    sampleRole: representative.some((x) => x.id === item.id) ? "representative" : "targeted" }));
  const status = supported.length && identity.kind === "creator" &&
    (!inventory.hasMore || deepened) ? "shortlisted" : "unverified";
  const collaborationHistory = [...new Map((metadata.collaborationObservations ?? [])
    .filter((item) => item.kind === "explicit_sponsorship_disclosure")
    .flatMap((item) => {
      const video = selected.find((entry) => entry.id === item.videoId);
      return video ? [[`${item.videoId}:${item.partnerName ?? ""}`, {
        partnerName: item.partnerName ?? null, videoId: video.id,
        videoTitle: video.title, url: video.url, publishedAt: video.publishedAt,
        disclosure: item.basisText }]] : [];
    })).values()].slice(0, 6);
  const viewContext = status === "shortlisted"
    ? await recentCreatorViewContext(inventory.id, inventory.videos).catch(() => []) : [];
  return { channelId: inventory.id, name: inventory.name, url: inventory.url,
    status,
    identityStatus: identity.kind, confidence, connections,
    collaborationHistory: { state: collaborationHistory.length ? "observed" : "not_observed",
      observations: collaborationHistory }, viewContext,
    sourceVideos: sources, coverage: { inventoryCount: inventory.inventoryCount,
      uploadsReported: inventory.uploadsReported, hasMore: inventory.hasMore,
      representativeCount: representative.length, targetedCount: targeted.length,
      transcriptAvailable: transcripts.filter((item) => item.status === "available").length,
      transcriptUnavailable: transcripts.filter((item) => item.status !== "available").length,
      discoveryHitsOutsideInventory: missingHitIds.length,
      exactDiscoveryHitsResolved: exactHits.length,
      deepened, expansionIssue,
      metadataExtracted: metadata.sourceCoverage?.extracted ?? 0,
      metadataFailed: metadata.sourceCoverage?.failedBatches ?? 0,
      transcriptStopReason, transcriptQuestions },
    discoveryDirections: candidate.directions, observedAt: new Date().toISOString() };
}

export function rankCreatorChannels(channels, campaignMode = "ongoing") {
  const features = (channel) => {
    const supported = channel.connections.filter((item) => item.state === "supported");
    const representative = new Set(supported.flatMap((item) => item.representativeVideoIds));
    const spoken = new Set(supported.flatMap((item) => item.evidence
      .filter((entry) => entry.source === "transcript" &&
        ["creator", "unknown"].includes(entry.speaker) &&
        ["supportive", "neutral"].includes(entry.stance) &&
        ["central", "substantive"].includes(entry.centrality))
      .map((entry) => entry.videoId)));
    const centralSpoken = new Set(supported.flatMap((item) => item.evidence)
      .filter((entry) => entry.source === "transcript" &&
        ["creator", "unknown"].includes(entry.speaker) &&
        ["supportive", "neutral"].includes(entry.stance) && entry.centrality === "central")
      .map((entry) => entry.videoId)).size;
    const contradicted = channel.connections.filter((item) => item.state === "contradicted" ||
      item.counterVideoIds.length).length;
    const newestEvidence = channel.sourceVideos.filter((video) =>
      representative.has(video.id) || spoken.has(video.id))
      .map((video) => Date.parse(video.publishedAt ?? "") || 0)
      .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);
    const directBridges = supported.filter((item) => item.directEvidence).length;
    const qlooAffinity = supported.map((item) => item.qlooAffinity)
      .filter(Number.isFinite).reduce((highest, value) => Math.max(highest, value), -Infinity);
    const prevalence = supported.reduce((best, item) => {
      const matched = item.samplePrevalence?.matched ?? item.representativeVideoIds.length;
      const reviewed = item.samplePrevalence?.reviewed ?? channel.coverage?.representativeCount ?? 0;
      return reviewed && matched * best.reviewed > best.matched * reviewed
        ? { matched, reviewed } : best;
    }, { matched: 0, reviewed: 1 });
    const periods = new Set(channel.sourceVideos.filter((video) =>
      representative.has(video.id) && video.publishedAt).map((video) => {
      const parsed = new Date(video.publishedAt);
      return `${parsed.getUTCFullYear()}-Q${Math.floor(parsed.getUTCMonth() / 3) + 1}`;
    })).size;
    return { bridges: supported.length, representative: representative.size,
      spoken: spoken.size, centralSpoken, contradicted, newestEvidence,
      directBridges, qlooAffinity, prevalence, periods,
      confidence: { high: 2, medium: 1, low: 0 }[channel.confidence] ?? 0 };
  };
  const precedence = campaignMode === "one_off"
    ? ["centralSpoken", "spoken", "directBridges", "bridges", "prevalence", "periods", "representative", "contradicted", "qlooAffinity", "newestEvidence", "confidence"]
    : ["bridges", "prevalence", "periods", "directBridges", "representative", "spoken", "centralSpoken", "contradicted", "qlooAffinity", "newestEvidence", "confidence"];
  return [...channels].sort((a, b) => {
    const left = features(a); const right = features(b);
    for (const key of precedence) {
      const difference = key === "prevalence"
        ? right.prevalence.matched * left.prevalence.reviewed -
          left.prevalence.matched * right.prevalence.reviewed
        : key === "contradicted" ? left[key] - right[key] : right[key] - left[key];
      if (difference) return difference;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function startYoutubeRun(userId, { brandName, brandQlooId, campaignMode = "ongoing" }) {
  if (!UUID.test(userId ?? "") || !UUID.test(brandQlooId ?? "") ||
      typeof brandName !== "string" || brandName.trim().length < 2 || brandName.length > 120 ||
      !["ongoing", "one_off"].includes(campaignMode)) {
    throw new Error("Choose a confirmed cultural brand.");
  }
  const recent = await db().query(`select count(*)::integer as n from public.youtube_research_runs
    where user_id=$1 and created_at>now()-interval '1 day'`, [userId]);
  if (recent.rows[0].n >= 10) { const error = new Error("Today's creator research limit has been reached.");
    error.statusCode = 429; throw error; }
  const result = await db().query(`insert into public.youtube_research_runs
    (user_id,brand_name,brand_qloo_id,campaign_mode) values ($1,$2,$3,$4) returning id`,
  [userId, brandName.trim(), brandQlooId, campaignMode]);
  return { runId: result.rows[0].id };
}

export function presentYoutubeResult(result) {
  if (!result || typeof result !== "object") return {};
  return { campaignMode: result.campaignMode,
    culturalConnections: (result.culturalConnections ?? []).map((item) => ({ name: item.name })),
    channels: (result.channels ?? []).map((channel) => ({
      name: channel.name, url: channel.url, confidence: channel.confidence,
      collaborationHistory: channel.collaborationHistory ?? { state: "not_observed", observations: [] },
      viewContext: channel.viewContext ?? [],
      connections: (channel.connections ?? []).map((item) => ({
        tagName: item.tagName, state: item.state,
        samplePrevalence: item.samplePrevalence ?? null,
        reason: /\b(?:qloo|youtube|api|llm|model|transcript)\b/i.test(item.reason ?? "")
          ? "The linked content shows this cultural connection in the reviewed videos."
          : item.reason,
        hasChallenges: item.state === "contradicted" || item.counterVideoIds?.length > 0,
        evidence: (item.evidence ?? []).map((entry) => ({
          source: entry.source, observation: entry.observation, url: entry.url,
        })),
      })),
      sourceVideos: (channel.sourceVideos ?? []).map((video) => ({
        title: video.title, url: video.url, publishedAt: video.publishedAt,
        sampleRole: video.sampleRole,
      })),
      coverage: { inventoryCount: channel.coverage?.inventoryCount ?? 0,
        hasMore: Boolean(channel.coverage?.hasMore),
        representativeCount: channel.coverage?.representativeCount ?? 0,
        targetedCount: channel.coverage?.targetedCount ?? 0,
        transcriptAvailable: channel.coverage?.transcriptAvailable ?? 0,
        transcriptUnavailable: channel.coverage?.transcriptUnavailable ?? 0 },
    })),
    coverage: { searchDirections: result.coverage?.searchDirections ?? 0,
      candidateChannels: result.coverage?.candidateChannels ?? 0,
      channelsReviewed: result.coverage?.channelsReviewed ?? 0,
      complete: Boolean(result.coverage?.complete) } };
}

export async function getYoutubeRun(userId, id) {
  if (!UUID.test(id ?? "")) return null;
  const result = await db().query(`select id,brand_name as "brandName",campaign_mode as "campaignMode",status,stage,
    result_json as result,error_code as "errorCode",created_at as "createdAt",finished_at as "finishedAt"
    from public.youtube_research_runs where id=$1 and user_id=$2 and retain_until>now()`, [id, userId]);
  const run = result.rows[0];
  return run ? { ...run, result: presentYoutubeResult(run.result) } : null;
}

export async function discoverCreatorChannels(directions, { searchPage = searchCreatorVideoPage,
  maxPages = 2 } = {}) {
  const candidates = new Map(); const queryChannels = [];
  const searchIssues = []; const searchRecords = [];
  for (const direction of directions) {
    const record = { q: direction.q, family: direction.family,
      signalIds: direction.signalIds, clusterIds: direction.clusterIds,
      channelIds: [], pages: 0, stopReason: "complete" };
    const queryIds = new Set(); let pageToken = null;
    try {
      do {
        const page = await searchPage(direction.q, { pageToken, maxResults: 20 });
        record.pages += 1;
        let usefulNew = 0; let repeated = 0;
        const queryTerms = new Set(terms(direction.q));
        for (const hit of page.hits) {
          if (queryIds.has(hit.channelId)) continue;
          queryIds.add(hit.channelId);
          const novel = !candidates.has(hit.channelId);
          if (novel && terms(hit.title).some((word) => queryTerms.has(word))) usefulNew += 1;
          else repeated += 1;
          const item = candidates.get(hit.channelId) ?? { channelId: hit.channelId,
            directions: [], hits: [] };
          if (!item.directions.some((x) => x.q === direction.q)) item.directions.push({
            q: direction.q, signalIds: direction.signalIds });
          item.hits.push(hit);
          candidates.set(hit.channelId, item);
        }
        pageToken = page.nextPageToken;
        if (!shouldExpandCreatorSearch({ usefulNew, repeated, nextPageToken: pageToken,
          pages: record.pages, maxPages })) {
          record.stopReason = pageToken ? record.pages >= maxPages
            ? "page_budget" : "low_marginal_discovery" : "no_next_page";
          break;
        }
      } while (pageToken);
    } catch (error) {
      searchIssues.push(error.code ?? "search_unavailable");
      record.stopReason = error.code ?? "search_unavailable";
    }
    record.channelIds = [...queryIds];
    queryChannels.push(record.channelIds);
    searchRecords.push(record);
  }
  return { candidates, queryChannels, searchIssues,
    searchYield: summarizeCreatorDiscovery(searchRecords) };
}

export async function listYoutubeRuns(userId) {
  const result = await db().query(`select id,brand_name as "brandName",campaign_mode as "campaignMode",status,stage,
    created_at as "createdAt",finished_at as "finishedAt"
    from public.youtube_research_runs where user_id=$1 and retain_until>now()
    order by created_at desc limit 30`, [userId]);
  return result.rows;
}

export async function workOneYoutubeRun() {
  await db().query(`update public.youtube_research_runs set status='queued',stage='queued',updated_at=now()
    where status='running' and updated_at<now()-interval '45 minutes' and retain_until>now()`);
  const claimed = await db().query(`update public.youtube_research_runs set status='running',stage='cultural_research',updated_at=now()
    where id=(select id from public.youtube_research_runs where status='queued' and retain_until>now()
      order by created_at for update skip locked limit 1)
    returning id,user_id,brand_name,brand_qloo_id,campaign_mode`);
  const run = claimed.rows[0];
  if (!run) return false;
  const heartbeat = setInterval(() => void db().query(`update public.youtube_research_runs
    set updated_at=now() where id=$1 and status='running'`, [run.id]).catch(() => {}), 60_000);
  heartbeat.unref();
  const stage = async (name) => db().query(`update public.youtube_research_runs set stage=$2,updated_at=now()
    where id=$1`, [run.id, name]);
  try {
    const qloo = await personalQlooEntityTags(run.user_id, run.brand_qloo_id);
    if (qloo.status !== "ok" || qloo.sampleData || !qloo.responseId)
      throw new Error("Brand cultural evidence unavailable.");
    // Qloo's entity-tag response can mix place, music and product taxonomies.
    // Only its own cultural namespace can seed this cultural search path.
    const originalTags = qloo.tags.filter((tag) => tag.type?.endsWith(":qloo") &&
      tag.name?.trim().length >= 3);
    const grouped = clusterCulturalSignals(originalTags);
    let tags = grouped.selected.map((cluster) => cluster.primary);
    const qlooResponseIds = tags.length ? [qloo.responseId] : [];
    if (!tags.length) {
      const named = [];
      for (const type of ["artist", "place", "movie"]) {
        try {
          const result = await personalQlooRecommendCulturalEntities(run.user_id,
            run.brand_qloo_id, type);
          if (!result.responseId || result.sampleData ||
              !["ok", "partial"].includes(result.envelope?.status)) continue;
          qlooResponseIds.push(result.responseId);
          named.push(...(result.envelope.results ?? []).filter((item) =>
            item.subtype === `urn:entity:${type}` && UUID.test(item.entity_id ?? "") &&
            typeof item.name === "string" && item.name.trim().length >= 3)
            .slice(0, 2).map((item) => ({ id: item.entity_id, name: item.name.trim(),
              type: item.subtype, affinity: Number.isFinite(item.affinity) ? item.affinity : null })));
        } catch { /* A separate Qloo cultural type may still be available. */ }
      }
      tags = named;
    }
    if (!tags.length) {
      await db().query(`update public.youtube_research_runs set status='partial',stage='finished',
        result_json=$2::jsonb,finished_at=now(),updated_at=now() where id=$1`, [run.id,
        JSON.stringify({ culturalConnections: [], channels: [],
          coverage: { complete: false, reason: "cultural_directions_unavailable" } })]);
      clearInterval(heartbeat);
      return true;
    }
    const directions = await planYoutubeDirections(run.brand_name, tags,
      { clusters: grouped.selected });
    if (!directions.length) throw new Error("No grounded creator search directions.");
    await stage("finding_creators");
    const configuredPages = Number(process.env.YOUTUBE_SEARCH_MAX_PAGES ?? 2);
    const maxSearchPages = Number.isSafeInteger(configuredPages)
      ? Math.max(1, Math.min(3, configuredPages)) : 2;
    const { candidates, queryChannels, searchIssues, searchYield } =
      await discoverCreatorChannels(directions, { maxPages: maxSearchPages });
    await stage("checking_channels");
    // Give every grounded cultural direction an early screening turn. A media
    // channel with many search hits must not crowd out a distinct creator niche.
    const orderIds = []; const seenChannels = new Set();
    const longestQueue = Math.max(0, ...queryChannels.map((queue) => queue.length));
    for (let rank = 0; rank < longestQueue; rank += 1) for (const queue of queryChannels) {
      const id = queue[rank];
      if (id && !seenChannels.has(id)) { seenChannels.add(id); orderIds.push(id); }
    }
    const ordered = orderIds.map((id) => candidates.get(id));
    const results = []; const candidateIssues = [];
    let screenedProfiles = 0; let eligibleProfiles = 0; let processedCandidates = 0;
    let inactiveProfiles = 0; let activityUnverifiedProfiles = 0;
    for (const candidate of ordered) {
      const shortlisted = results.filter((item) => item.status === "shortlisted").length;
      if (shortlisted >= 10) break;
      processedCandidates += 1;
      try {
        const profile = await channelSummary(candidate.channelId);
        screenedProfiles += 1;
        if (!profile) continue;
        const activity = await latestChannelUpload(candidate.channelId, profile);
        if (activity.state === "unknown") {
          activityUnverifiedProfiles += 1;
          candidateIssues.push("activity_unverified");
          continue;
        }
        if (activity.state === "empty" || !hasRecentPublicUpload(activity.publishedAt)) {
          inactiveProfiles += 1;
          continue;
        }
        if (isDirectCulturalSubjectChannel(profile, tags, candidate.directions)) continue;
        const channelType = await classifyCreatorChannel({ id: profile.id, name: profile.name,
          summary: profile.description }, run.brand_name).catch(() => ({ kind: "unknown" }));
        if (channelType.kind === "organization") continue;
        eligibleProfiles += 1;
        const found = await researchCandidate(candidate, tags, profile, run.campaign_mode,
          channelType, activity);
        if (found) results.push(found);
      } catch (error) {
        candidateIssues.push(error.code ?? "candidate_unavailable");
        if (["youtube_budget", "youtube_provider_limit"].includes(error.code)) break;
        if (process.env.DEBUG_PERSONAL_RUNS === "1") process.stderr.write(
          `Creator candidate ${candidate.channelId}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    const ranked = rankCreatorChannels(results.filter((item) => item.status === "shortlisted"),
      run.campaign_mode);
    await db().query(`insert into private.youtube_research_audit(run_id,audit_json)
      values ($1,$2::jsonb) on conflict (run_id) do update set audit_json=excluded.audit_json,
      retain_until=now()+interval '15 days'`, [run.id, JSON.stringify({
      brandName: run.brand_name, campaignMode: run.campaign_mode,
      qlooResponseIds, culturalSignals: tags.map(({ id, name, type, affinity }) =>
        ({ id, name, type, affinity })),
      originalCulturalSignals: originalTags,
      culturalClusters: grouped.all.map((cluster) => ({ id: cluster.id, name: cluster.name,
        members: cluster.members })),
      searchDirections: directions, searchYield,
      reviewed: results, unreviewedCandidateCount: Math.max(0, ordered.length - processedCandidates),
      inactiveProfiles, activityUnverifiedProfiles,
      searchIssueCount: searchIssues.length, candidateIssueCount: candidateIssues.length,
      observedAt: new Date().toISOString() })]);
    const result = { culturalConnections: tags.map((tag) => ({ id: tag.id, name: tag.name,
      affinity: tag.affinity })), qlooResponseIds,
      campaignMode: run.campaign_mode, channels: ranked,
      coverage: { searchDirections: directions.length, candidateChannels: candidates.size,
        searchYield,
        profilesScreened: screenedProfiles, eligibleProfiles,
        inactiveProfiles, activityUnverifiedProfiles,
        channelsReviewed: results.length, unreviewedCandidateCount: Math.max(0,
          ordered.length - processedCandidates), searchIssues: searchIssues.length,
        candidateIssues: candidateIssues.length,
        complete: ordered.length <= processedCandidates && !searchIssues.length && !candidateIssues.length } };
    const status = result.coverage.complete ? "completed" : "partial";
    await db().query(`update public.youtube_research_runs set status=$2,stage='finished',result_json=$3::jsonb,
      finished_at=now(),updated_at=now() where id=$1`, [run.id, status, JSON.stringify(result)]);
  } catch (error) {
    if (process.env.DEBUG_PERSONAL_RUNS === "1") process.stderr.write(
      `Creator run ${run.id}: ${error instanceof Error ? error.message : String(error)}\n`);
    await db().query(`update public.youtube_research_runs set status='failed',stage='finished',
      error_code=$2,finished_at=now(),updated_at=now() where id=$1`,
    [run.id, String(error?.code ?? "research_unavailable").slice(0, 80)]);
  }
  clearInterval(heartbeat);
  return true;
}

export async function purgeYoutubeResearch() {
  await db().query("delete from public.youtube_research_runs where retain_until<=now()");
  await db().query("delete from private.youtube_channel_cache where retain_until<=now()");
  await db().query("delete from private.youtube_channel_profile_cache where retain_until<=now()");
  await db().query("delete from private.youtube_video_cache where retain_until<=now()");
  await db().query("delete from private.youtube_transcript_observations where retain_until<=now()");
  await db().query("delete from private.youtube_research_audit where retain_until<=now()");
  await db().query("delete from private.youtube_research_requests where reserved_at<now()-interval '2 days'");
}
