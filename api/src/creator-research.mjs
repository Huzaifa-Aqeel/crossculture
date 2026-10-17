import pg from "pg";
import { createHash } from "node:crypto";
import { freezeEvidenceInput } from "./evidence-ledger.mjs";
import { importChannel, inspectChannel, searchCreatorLeads } from "./youtube.mjs";
import { selectedVideoTranscript } from "./youtube-transcript.mjs";
import { personalQlooEntityTags, personalQlooFindTags, personalQlooResolveNamedEntity,
  personalQlooRecommendNamedEntity, personalQlooRankNamedEntity } from "./personal-qloo.mjs";
import { planCreatorQueries, extractCreatorMetadata, chooseCreatorTranscript,
  extractCreatorTranscript, classifyCreatorChannel } from "./creator-intelligence.mjs";
import { classifySignals, classifyExclusions, scoreAssessment, SCORING_VERSION, requiredCapabilities } from "./scoring.ts";
import { assessmentConstraints } from "./assessment-constraints.mjs";
import { assessmentNeedsAppend } from "./assessment-reuse.mjs";
import { commercialMetadataForResearch, researchCreatorCommercial } from "./creator-commercial.mjs";
import { verifyCreatorOperator } from "./creator-identity.mjs";
import { fileBrandWebSource } from "./personal-brand.mjs";

let pool;
const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }));
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const HASH = /^[a-f0-9]{64}$/;
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const qlooRef = (id) => ({ kind: "qloo_response", id });
const sourceId = (id) => `personal:${id}`;
const metadataHash = (profile, video, tags = []) => createHash("sha256").update(JSON.stringify({
  summary: profile.summary ?? "", title: video.title, description: video.description ?? "",
  tags: video.tags ?? [], etag: video.etag ?? null,
  seedTags: tags.slice(0, 12).map((tag) => tag.id).sort() })).digest("hex");

async function reusableMetadata(userId, seedId, profile, seedTags) {
  if (!profile.videos?.length) return null;
  const records = await db().query(`select s.external_item_id,s.metadata_observations_json as observations
    from public.source_items s join public.analysis_runs r on r.id=s.analysis_run_id
    where s.user_id=$1 and r.seed_entity_id=$2 and s.owner_channel_id=$3
      and s.request_hash=$4 and s.retain_until>now()
    order by s.collected_at desc`, [userId, seedId, profile.id, profile.videoRequestHash]);
  const byId = new Map();
  for (const row of records.rows) {
    const video = profile.videos.find((item) => item.sourceId === row.external_item_id);
    const observation = row.observations;
    if (video && !byId.has(video.sourceId) && observation?.extractionStatus === "complete" &&
        observation?.metadataHash === metadataHash(profile, video, seedTags) &&
        observation.extractionVersion === "creator-metadata-v4" &&
        Array.isArray(observation.culturalSignals) && Array.isArray(observation.demonstratedFormats) &&
        Array.isArray(observation.collaborationObservations)) byId.set(video.sourceId, observation);
  }
  if (!byId.size) return null;
  return { culturalSignals: [...byId.values()].flatMap((item) => item.culturalSignals),
    demonstratedFormats: [...byId.values()].flatMap((item) => item.demonstratedFormats),
    collaborationObservations: [...byId.values()].flatMap((item) => item.collaborationObservations),
    sourceCoverage: { sampled: profile.videos.length, extracted: byId.size,
      extractedVideoIds: [...byId.keys()], failedBatches: 0, reused: byId.size },
    extractionVersion: "creator-metadata-v4" };
}

function validateProfile(profile) {
  if (!CHANNEL.test(profile?.id ?? "") || profile.sourceProvider !== "youtube_data_api_v3" ||
      !HASH.test(profile.videoRequestHash ?? "") || !Array.isArray(profile.videos)) {
    throw new Error("Public creator identity or video provenance is incomplete.");
  }
  const videos = profile.videos.slice(0, 20);
  for (const item of videos) if (!VIDEO.test(item.sourceId ?? "") || item.ownerId !== profile.id ||
      item.sourceUrl !== `https://www.youtube.com/watch?v=${item.sourceId}` ||
      !Number.isFinite(Date.parse(item.collectedAt)) || !Number.isFinite(Date.parse(item.retainUntil))) {
    throw new Error("Public creator video provenance is incomplete.");
  }
  return videos;
}

export function creatorBridgeCandidates(seedTags, metadata) {
  const tags = (seedTags.tags ?? []).filter((tag) => tag.id && tag.name && normalized(tag.name));
  const found = new Map();
  for (const observation of metadata.culturalSignals ?? []) {
    const phrase = normalized(observation.phrase);
    if (!phrase || !["central", "substantive"].includes(observation.centrality)) continue;
    for (const tag of tags) {
      if (phrase !== normalized(tag.name)) continue;
      const previous = found.get(tag.id) ?? { tag, observations: [] };
      previous.observations.push(observation);
      found.set(tag.id, previous);
    }
  }
  return [...found.values()].slice(0, 3);
}

const NAMED_TYPES = new Map([["urn:entity:artist", "artist"], ["urn:entity:movie", "movie"],
  ["urn:entity:tv_show", "tv_show"], ["urn:entity:book", "book"],
  ["urn:entity:videogame", "videogame"], ["urn:entity:place", "place"],
  ["urn:entity:podcast", "podcast"],
  ["urn:entity:person", "person"], ["urn:entity:brand", "brand"]]);

const MAX_NAMED_RESOLUTIONS = 24;
export function namedResolutionOrder(entries) {
  // Reserve bounded resolution work for exact, independently repeated title
  // subjects even when the model supplied another entity from the same video.
  // The remaining capacity keeps the model's open-ended observations in play.
  const preserved = entries.filter((entry) => entry.observations.some((item) =>
    item.extractionMethod === "official_title_preservation")).slice(0, 8);
  const firstPerVideo = new Map();
  for (const entry of entries) for (const observation of entry.observations) {
    if (!firstPerVideo.has(observation.videoId)) firstPerVideo.set(observation.videoId, entry);
  }
  const selected = [...new Set([...preserved, ...firstPerVideo.values()])]
    .slice(0, MAX_NAMED_RESOLUTIONS);
  for (const entry of entries) if (selected.length < MAX_NAMED_RESOLUTIONS && !selected.includes(entry)) {
    selected.push(entry);
  }
  return selected.slice(0, MAX_NAMED_RESOLUTIONS);
}

function sourceBackedPlaceOrPersonPrefix(entry) {
  if (!entry.observations.some((item) => item.basisField === "title")) return null;
  const match = entry.phrase.match(/^(.+?)\s+(?:hike|climb|trip|tour|review|guide|video|reaction|story|experience)\b/i);
  const prefix = match?.[1]?.trim();
  if (!prefix || prefix.split(/\s+/).length < 2 || prefix.length < 5) return null;
  if (!entry.observations.some((item) => item.basisField === "title" &&
      typeof item.basisText === "string" &&
      new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\b|\\s)`, "i").test(item.basisText))) return null;
  return prefix;
}

function sourceBackedMovieChoice(entry, discoveryLead, description) {
  if (discoveryLead?.namedEntityType !== "movie" ||
      normalized(discoveryLead.namedEntityName) !== normalized(entry.phrase) ||
      !discoveryLead.qlooResponseIds?.length ||
      !entry.observations.some((item) => item.videoId === discoveryLead.videoId)) return null;
  const title = String(discoveryLead.title ?? "");
  const escaped = discoveryLead.namedEntityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const year = title.match(new RegExp(`${escaped}\\s*\\((\\d{4})\\)`, "i"))?.[1];
  if (!year || !/\b(?:film|movie|analysis|breakdown|ending|review)\b/i.test(title)) return null;
  const candidates = (description.envelope?.resolution?.issues ?? [])
    .flatMap((issue) => issue.candidates ?? []).filter((item) =>
      String(item.id).toLowerCase() === String(discoveryLead.namedEntityId).toLowerCase() &&
      normalized(item.name) === normalized(entry.phrase) &&
      item.type === "urn:entity:movie" && String(item.release_year) === year);
  return candidates.length === 1 ? candidates[0].id : null;
}

function sampledMovieChoice(entry, sourceVideos, description) {
  const escaped = entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactName = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu");
  const filmVideo = (sourceVideos ?? []).some((video) =>
    entry.observations.some((item) => item.videoId === video.sourceId) &&
    exactName.test(String(video.title ?? "")) &&
    /\b(?:sequel|film|movie|cinema|scene|ending|analysis|review)\b/i.test(String(video.title ?? "")) &&
    (video.tags ?? []).some((tag) => /^(?:movie|movies|film|films|cinema|filmmaking)$/i.test(tag)));
  if (!filmVideo) return null;
  const candidates = (description.envelope?.resolution?.issues ?? [])
    .flatMap((issue) => issue.candidates ?? []).filter((item) =>
      normalized(item.name) === normalized(entry.phrase) && item.type === "urn:entity:movie");
  return candidates.length === 1 ? candidates[0].id : null;
}

function sourceBackedCulturalBrandReference(entry, sourceVideos) {
  const escaped = entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu");
  return entry.observations.some((observation) => {
    const video = sourceVideos.find((item) => item.sourceId === observation.videoId);
    const title = String(video?.title ?? (observation.basisField === "title"
      ? observation.basisText : ""));
    return named.test(title) &&
      /\b(?:culture|cultural|history|heritage|community|documentary|movement|artistic)\b/i.test(title) &&
      !/\b(?:sponsor|partner|product|gear|equipment|review|unboxing|discount|sale)\b/i.test(title);
  });
}

export function creatorPartnerActivity(admitted, videoSources, creatorName) {
  const perVideo = new Map();
  const order = { contradictory: 5, central: 4, substantive: 3, incidental: 2, unknown: 1 };
  for (const { observation, bridgeId } of admitted) {
    if (!videoSources.has(observation.videoId)) continue;
    const previous = perVideo.get(observation.videoId);
    if (!previous || order[observation.centrality] > order[previous.centrality]) {
      perVideo.set(observation.videoId, { id: `video:${observation.videoId}`,
        summary: `${creatorName} discusses ${observation.phrase} in a public video.`,
        centrality: observation.centrality, firstParty: true, bridgeIds: [bridgeId],
        sourceIds: [sourceId(videoSources.get(observation.videoId))] });
    }
  }
  return [...perVideo.values()].slice(0, 20);
}

function genericFormatArtistObservation(observation, entity, type, sourceVideos) {
  if (type !== "artist" || String(entity.entity_id).toLowerCase() !==
      "d8b73762-b498-483d-8d5e-1c2e6834d827") return false;
  const video = sourceVideos.find((item) => item.sourceId === observation.videoId);
  if (!video || !/\ba\s+#microfilm\b/i.test(String(video.title ?? ""))) return false;
  return !/\b(?:artist|band|musician|music by)\s+Microfilm\b/i.test(
    `${video.title ?? ""} ${video.description ?? ""} ${(video.tags ?? []).join(" ")}`);
}

export async function resolveCreatorBridges(userId, seedQlooId, seedTags, metadata,
  { findTags, describeEntity, recommendEntities, rankEntity = null,
    discoveryLead = null, sourceVideos = [] }) {
  const verified = [];
  const review = [];
  const exactTagNames = new Set((seedTags.tags ?? []).map((tag) => normalized(tag.name)));
  for (const item of creatorBridgeCandidates(seedTags, metadata)) {
    let resolved;
    try { resolved = await findTags(userId, item.tag.name); } catch { continue; }
    if (resolved.status !== "ok" || !resolved.responseId || resolved.sampleData ||
        !resolved.tags.some((tag) => tag.id === item.tag.id && normalized(tag.name) === normalized(item.tag.name))) continue;
    verified.push({ ...item, kind: "tag", qlooId: item.tag.id,
      qlooRefs: [{ responseId: resolved.responseId, inputHash: resolved.inputHash }],
      classification: "direct" });
  }
  const phrases = new Map();
  for (const observation of metadata.culturalSignals ?? []) {
    const key = normalized(observation.phrase);
    if (!key || key.length < 3 || key.length > 80) continue;
    if (observation.centrality === "contradictory") {
      review.push({ phrase: observation.phrase, status: "contradictory_context", videoId: observation.videoId });
      continue;
    }
    if (exactTagNames.has(key)) continue;
    if (!["central", "substantive"].includes(observation.centrality)) continue;
    const entry = phrases.get(key) ?? { phrase: observation.phrase, observations: [] };
    entry.observations.push(observation);
    phrases.set(key, entry);
  }
  const recommendations = new Map();
  for (const entry of namedResolutionOrder([...phrases.values()])) {
    let description;
    const prefix = sourceBackedPlaceOrPersonPrefix(entry);
    let usedPrefix = false;
    let usedIdentifier = false;
    try {
      if (prefix) {
        const candidate = await describeEntity(userId, prefix);
        const candidateEntity = candidate.envelope?.results?.find((entity) =>
          normalized(entity.name) === normalized(prefix));
        const candidateType = candidateEntity?.type ?? candidate.envelope?.interpretation?.entity?.type;
        if (candidate.envelope?.status === "ok" &&
            ["urn:entity:place", "urn:entity:person"].includes(candidateType) &&
            candidate.envelope?.interpretation?.entity?.match === "exact") {
          description = candidate;
          usedPrefix = true;
        }
      }
      description ??= await describeEntity(userId, entry.phrase);
      if (description.envelope?.status === "needs_input") {
        const choice = sourceBackedMovieChoice(entry, discoveryLead, description) ??
          sampledMovieChoice(entry, sourceVideos, description);
        if (choice) {
          description = await describeEntity(userId, choice);
          usedIdentifier = true;
        }
      }
    }
    catch { review.push({ phrase: entry.phrase, status: "resolution_unavailable" }); continue; }
    const matches = (description.envelope?.results ?? []).filter((entity) =>
      entity?.entity_id && normalized(entity.name) === normalized(usedPrefix ? prefix : entry.phrase));
    if (description.envelope?.status !== "ok" || matches.length !== 1 ||
        !description.responseId || description.sampleData) {
      review.push({ phrase: entry.phrase, status: matches.length > 1 ||
        description.envelope?.status === "needs_input" ? "ambiguous_identity" : "unsupported_identity" });
      continue;
    }
    const entity = matches[0];
    const interpretation = description.envelope?.interpretation?.entity;
    if (!interpretation || String(interpretation.entityId ?? "").toLowerCase() !==
        String(entity.entity_id).toLowerCase() ||
        !(interpretation.match === "exact" || usedIdentifier && interpretation.match === "identifier")) {
      review.push({ phrase: entry.phrase, status: "ambiguous_identity" }); continue;
    }
    const resolvedType = entity.type ?? interpretation.type;
    const type = NAMED_TYPES.get(resolvedType) ??
      ([...NAMED_TYPES.values()].includes(resolvedType) ? resolvedType : null);
    const admissibleObservations = entry.observations.filter((observation) =>
      !genericFormatArtistObservation(observation, entity, type, sourceVideos));
    if (!admissibleObservations.length) {
      review.push({ phrase: entry.phrase, status: "generic_format_not_named_entity",
        qlooEntityId: entity.entity_id });
      continue;
    }
    if (type === "brand" && !sourceBackedCulturalBrandReference(entry, sourceVideos)) {
      review.push({ phrase: entry.phrase, status: "commercial_or_product_reference",
        qlooEntityId: entity.entity_id });
      continue;
    }
    if (entry.observations.every((observation) => observation.candidateTypeConstraint === "place_or_person") &&
        !["place", "person"].includes(type)) {
      review.push({ phrase: entry.phrase, status: "unsupported_type" }); continue;
    }
    if (!type || !seedQlooId) {
      review.push({ phrase: entry.phrase, status: "unsupported_type" }); continue;
    }
    if (!recommendations.has(type)) recommendations.set(type, await recommendEntities(userId, seedQlooId, type)
      .catch(() => null));
    let relation = recommendations.get(type);
    const inRecommendation = relation?.envelope?.status === "ok" && relation.responseId && !relation.sampleData &&
      (relation.envelope.results ?? []).some((result) => String(result.entity_id).toLowerCase() ===
        String(entity.entity_id).toLowerCase());
    if (!inRecommendation && rankEntity) {
      // Qloo's top-20 list is a truncated view, not a negative relationship
      // finding. A typed, exact-ID filtered Insights result can recover an
      // omitted pair; its affinity value is never used as a C rating.
      try { relation = await rankEntity(userId, seedQlooId, entity.entity_id, type); }
      catch { relation = null; }
    }
    const inFilteredInsights = !inRecommendation && relation?.envelope?.status === "ok" &&
      relation.responseId && !relation.sampleData &&
      (relation.envelope.results ?? []).some((result) =>
        String(result.entity_id).toLowerCase() === String(entity.entity_id).toLowerCase() &&
        (result.subtype ?? result.type) === `urn:entity:${type}` && Number.isFinite(result.affinity));
    if (!inRecommendation && !inFilteredInsights) {
      review.push({ phrase: entry.phrase, status: relation ? "unsupported_pair_projection" : "relationship_unavailable",
        qlooEntityId: entity.entity_id });
      continue;
    }
    verified.push({ kind: "named", qlooId: entity.entity_id,
      tag: { id: entity.entity_id, name: entity.name, type }, observations: admissibleObservations,
      qlooRefs: [description, relation].map(({ responseId, inputHash }) => ({ responseId, inputHash })),
      classification: "cross_category" });
  }
  const seen = new Set();
  return { verified: verified.filter((item) => {
    if (seen.has(item.qlooId)) return false;
    seen.add(item.qlooId); return true;
  }), review };
}

async function ensureCreator(client, profile) {
  const url = `https://www.youtube.com/channel/${profile.id}`;
  const profileDeadline = Date.parse(profile.retainUntil ?? profile.videos[0]?.retainUntil);
  if (!Number.isFinite(profileDeadline)) throw new Error("Channel metadata retention is unknown.");
  const deadline = new Date(Math.min(profileDeadline, Date.now() + 29 * 86400000));
  const found = await client.query(`insert into catalog.entities(kind,canonical_name,canonical_url,identity_status,youtube_name_until)
    values ('youtube_creator',$1,$2,'verified',$3)
    on conflict (canonical_url) where canonical_url is not null do update set
      canonical_name=excluded.canonical_name,identity_status='verified',
      youtube_name_until=excluded.youtube_name_until,updated_at=now() returning id,kind`,
  [String(profile.name ?? "YouTube creator").slice(0, 160), url, deadline]);
  if (found.rows[0].kind !== "youtube_creator") throw new Error("Channel identity conflicts with another entity.");
  const entityId = found.rows[0].id;
  const identifier = await client.query(`insert into catalog.entity_identifiers(entity_id,provider,external_id,external_url,verified_at,status)
    values ($1,'youtube',$2,$3,now(),'confirmed')
    on conflict (provider,external_id) where status='confirmed' do update set verified_at=now()
    returning entity_id`, [entityId, profile.id, url]);
  if (identifier.rows[0].entity_id !== entityId) throw new Error("Channel identifier belongs to another entity.");
  return entityId;
}

export function creatorCulturalObservations(metadata, transcriptFindings) {
  return [
    ...metadata.culturalSignals,
    ...transcriptFindings.filter((item) => ["cultural_reference", "contradiction"].includes(item.kind))
      .map((item) => ({ videoId: item.videoId, phrase: item.entity,
        centrality: item.centrality })),
  ];
}

export function selectCreatorLeads(leadQueues, ceiling) {
  const selected = [];
  const seen = new Set();
  const ordered = leadQueues.map((queue) => {
    const anchor = queue.direction?.namedEntityId && queue.direction?.qlooResponseIds?.length
      ? queue.direction.namedEntityName : null;
    if (!anchor || anchor.length < 3) return queue;
    const priority = (lead) => {
      const title = String(lead.searchSource?.title ?? "");
      const type = queue.direction.namedEntityType ?? "place";
      const activity = type === "movie"
        ? /\b(?:review|analysis|essay|explain(?:ed|ing)?|discuss(?:ion|ing)?|film|movie|scene|ending|reaction|breakdown)\b/i
        : type === "person"
          ? /\b(?:interview|profile|story|career|training|highlights|analysis|documentary|performance|match|game)\b/i
          : type === "artist"
            ? /\b(?:performance|cover|interview|analysis|music|song|album|concert|lesson)\b/i
            : /\b(?:hik(?:e|ing)|climb(?:ing)?|backpack(?:ing)?|camp(?:ing)?|trail|trek(?:king)?|visit(?:ing)?|trip|adventure|explor(?:e|ing))\b/i;
      if (!new RegExp(`(^|[^\\p{L}\\p{N}])${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu").test(title) ||
          !activity.test(title) ||
          /\b(?:sleeping bag|gear review|tent review|product review|sale|discount)\b/i.test(title)) return 0;
      const begins = title.toLocaleLowerCase().startsWith(anchor.toLocaleLowerCase());
      const next = title.slice(anchor.length).trim();
      const direct = type === "place"
        ? /^(?:hik(?:e|ing)|climb(?:ing)?|backpack(?:ing)?|camp(?:ing)?|trail|trip)\b/i.test(next)
        : activity.test(next);
      return begins && direct
        ? 3 : begins ? 2 : 1;
    };
    // Search-hit titles guide which channel to inspect first. They do not grant
    // a cultural bridge, creator identity, or representative-sample activity.
    return { ...queue, leads: queue.leads.map((lead, index) => ({ lead, index }))
      .sort((a, b) => priority(b.lead) - priority(a.lead) || a.index - b.index)
      .map(({ lead }) => lead) };
  });
  for (let index = 0; selected.length < ceiling &&
      ordered.some((queue) => queue.leads.length > index); index++) {
    for (const queue of ordered) {
      const lead = queue.leads[index];
      if (!lead || seen.has(lead.id)) continue;
      seen.add(lead.id);
      selected.push({ direction: queue.direction, lead });
      if (selected.length >= ceiling) break;
    }
  }
  return selected;
}

export function recentNamedTitleCoverage(profile, namedEntities) {
  const matchedVideos = new Set();
  const matchedEntities = new Set();
  for (const video of profile.videos ?? []) {
    const title = String(video.title ?? "");
    if (/\b(?:sleeping bag|gear review|tent review|product review|sale|discount)\b/i.test(title)) continue;
    for (const entity of namedEntities ?? []) {
      if (!entity.responseId || !entity.id || !entity.name || entity.name.length < 5) continue;
      const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(title)) continue;
      matchedVideos.add(video.sourceId);
      matchedEntities.add(entity.id);
    }
  }
  return { videoCount: matchedVideos.size, entityCount: matchedEntities.size };
}

export function prioritizeCreatorLeadsBySample(references, previews, namedEntities) {
  return references.map((reference, index) => ({ reference, index,
    coverage: previews.has(reference)
      ? recentNamedTitleCoverage(previews.get(reference), namedEntities)
      : { videoCount: 0, entityCount: 0 } }))
    .sort((a, b) => b.coverage.videoCount - a.coverage.videoCount ||
      b.coverage.entityCount - a.coverage.entityCount || a.index - b.index)
    .map((item) => item.reference);
}

export function creatorSamplePreviewLimit(total, maxProviderCalls = 60) {
  // Each uncached official sample needs at most channels, playlistItems and
  // videos list. Leave room for the run's other research under its plan budget.
  const affordable = Math.max(0, Math.floor((maxProviderCalls - 24) / 3));
  return Math.min(12, total, affordable);
}

export function namedDiscoveryTypes(tags) {
  const cultural = (tags ?? []).filter((tag) => String(tag?.type ?? "").endsWith(":qloo"));
  const labels = cultural.map((tag) => String(tag.name ?? "")).join(" ").toLowerCase();
  if (/\b(?:narrativ\w*|filmmak\w*|film\w*|cinema\w*|movie\w*|episodic|screenplay)\b/.test(labels)) {
    return ["movie", "place"];
  }
  if (/\b(?:sport\w*|athlet\w*|fitness|soccer|football|basketball|runner\w*)\b/.test(labels)) {
    return ["person", "place"];
  }
  if (/\b(?:music\w*|artist\w*|guitar\w*|rock|hip hop|song\w*)\b/.test(labels)) {
    return ["artist", "place"];
  }
  return ["place"];
}

function creatorCapabilities(objective, metadata, videoSources, bridgeObservations,
  commercialSources = [], transcriptFindings = []) {
  const formatSource = (metadata.demonstratedFormats ?? []).map((item) => videoSources.get(item.videoId))
    .find(Boolean);
  const productionSkillSource = transcriptFindings.filter((item) => item.kind === "expertise" &&
    /\b(?:filming|video editing|video production|photography|storytelling|scriptwriting)\b/i.test(item.entity))
    .map((item) => videoSources.get(item.videoId)).find(Boolean);
  const culturalSource = bridgeObservations.map((item) => videoSources.get(item.videoId)).find(Boolean);
  const firstVideo = videoSources.values().next().value;
  return requiredCapabilities(objective).map((key) => {
    const id = key === "content_creation_capability" ? formatSource ?? productionSkillSource
      : key === "integration_or_channel_capability" ? commercialSources[0] ?? formatSource
      : key === "cultural_storytelling" ? culturalSource
        : key === "distribution_channel" || key === "activation_channel" ? firstVideo : null;
    return { id: `cap:${key}`, name: key, status: id ? "direct" : "unsupported",
      sourceIds: id ? [String(id).startsWith("catalog:") ? id : sourceId(id)] : [] };
  });
}

export function transcriptQuestion(packet, tags) {
  const accepted = new Set((tags ?? []).map((tag) => normalized(tag.name)));
  const observations = [...packet.metadata.culturalSignals,
    ...packet.transcriptFindings.filter((item) => item.kind === "cultural_reference")
      .map((item) => ({ videoId: item.videoId,
      phrase: item.entity, centrality: item.centrality }))]
    .filter((item) => ["central", "substantive"].includes(item.centrality));
  const lead = packet.discoveryLead;
  const namedHit = lead?.namedEntityId && lead?.qlooResponseIds?.length &&
    typeof lead.namedEntityName === "string" && lead.namedEntityName.trim().length >= 3 &&
    !packet.profile?.videos?.some((video) => video.sourceId === lead.videoId);
  if (namedHit && !observations.some((item) =>
    normalized(item.phrase) === normalized(lead.namedEntityName))) {
    return `Does the discovered video substantively discuss ${lead.namedEntityName}, and what stance does its creator take?`;
  }
  const named = observations.filter((item) => !accepted.has(normalized(item.phrase)));
  const direct = observations.filter((item) => accepted.has(normalized(item.phrase)));
  const distinct = new Set(direct.map((item) => item.videoId));
  const uncertain = packet.metadata.culturalSignals.some((item) =>
    ["incidental", "unknown", "contradictory"].includes(item.centrality));
  if (uncertain && !packet.transcriptFindings.some((item) =>
    ["cultural_reference", "contradiction"].includes(item.kind))) {
    return "Does spoken context establish whether the observed cultural reference is substantive, incidental, or critical?";
  }
  const namedByPhrase = new Map();
  for (const item of named) {
    const key = normalized(item.phrase);
    if (!key) continue;
    if (!namedByPhrase.has(key)) namedByPhrase.set(key, new Set());
    namedByPhrase.get(key).add(item.videoId);
  }
  if ([...namedByPhrase.values()].some((videos) => videos.size < 2)) {
    return "Does another video substantively discuss the named cultural subject, and what stance does the creator take?";
  }
  if (accepted.size && !distinct.size) return "Is a specific brand-linked cultural subject genuinely discussed in this creator's work?";
  if (accepted.size && distinct.size < 2) return "Does another independent video substantively discuss the cultural subject?";
  if (["content_collaboration", "co_created_product"].includes(packet.objective) &&
      !packet.metadata.demonstratedFormats.length &&
      !packet.transcriptFindings.some((item) => item.kind === "expertise")) {
    return "Does this video demonstrate the specific creative or production capability needed for the partnership?";
  }
  if (packet.metadata.collaborationObservations.some((item) =>
    ["affiliate_reference", "product_review_or_mention", "unknown"].includes(item.kind)) &&
      !packet.transcriptFindings.some((item) =>
        ["explicit_sponsorship_disclosure", "affiliate_reference", "contradiction"].includes(item.kind))) {
    return "Does spoken disclosure clarify whether the observed commercial mention is sponsorship, affiliate activity, or an ordinary mention?";
  }
  return null;
}

async function enrichCreatorPackets(packets, seedTags, { chooseTranscript, retrieveTranscript,
  extractTranscript, maxAttempts = 10, deadlineMs = 7 * 60_000 }) {
  if (process.env.YOUTUBE_TRANSCRIPTS_ENABLED !== "true") {
    for (const packet of packets) packet.transcriptStopReason = "not_attempted";
    return 0;
  }
  const deadline = Date.now() + deadlineMs;
  let attempted = 0;
  for (;;) {
    let advanced = false;
    for (const packet of packets) {
      const question = transcriptQuestion(packet, seedTags.tags);
      if (!question) { packet.transcriptStopReason = packet.metadata.sourceCoverage?.failedBatches
        ? "metadata_incomplete" : "evidence_sufficient"; continue; }
      if (packet.transcriptStopReason && !["no_captions", "no_new_findings"].includes(packet.transcriptStopReason)) continue;
      if (attempted >= maxAttempts || Date.now() >= deadline) {
        packet.transcriptStopReason = "budget_exhausted"; continue;
      }
      let choice;
      try { choice = await chooseTranscript(packet.profile, packet.metadata, seedTags.tags ?? [],
        packet.attemptedVideoIds, question, { targetedVideos: packet.discoveryLead ? [{
          sourceId: packet.discoveryLead.videoId, title: packet.discoveryLead.title,
          publishedAt: packet.discoveryLead.publishedAt, sourceRole: "discovery_hit" }] : [] }); }
      catch { packet.transcriptStopReason = "planner_unavailable"; continue; }
      if (!choice) { packet.transcriptStopReason = "no_useful_video"; continue; }
      packet.attemptedVideoIds.push(choice.videoId);
      packet.transcriptPlans.push(choice);
      attempted += 1;
      advanced = true;
      const result = await retrieveTranscript(choice.videoId);
      packet.transcriptStatus.push({ videoId: choice.videoId, status: result.status });
      if (result.status === "not_attempted") { packet.transcriptStopReason = "not_attempted"; continue; }
      if (result.status !== "available") { packet.transcriptStopReason = result.status; continue; }
      try {
        const namedHit = packet.discoveryLead?.videoId === choice.videoId &&
          packet.discoveryLead?.qlooResponseIds?.length && packet.discoveryLead?.namedEntityId;
        const findings = await extractTranscript(choice.videoId, result.segments,
          { focusEntityName: namedHit ? packet.discoveryLead.namedEntityName : null });
        if (findings.length) {
          packet.transcriptFindings.push(...findings);
          packet.transcriptTimes.set(choice.videoId, result.fetchedAt);
          packet.transcriptStopReason = null;
        } else packet.transcriptStopReason = "no_new_findings";
      } catch { packet.transcriptStopReason = "extraction_unavailable"; }
      // result.segments is never copied into a packet, source row, trace or log.
    }
    if (!advanced || attempted >= maxAttempts || Date.now() >= deadline) break;
  }
  for (const packet of packets) if (!packet.transcriptStopReason) {
    packet.transcriptStopReason = transcriptQuestion(packet, seedTags.tags)
      ? "budget_exhausted" : "evidence_sufficient";
  }
  return attempted;
}

async function assessCreator(run, workerId, packet, seed, seedTags,
  { findTags, describeEntity, recommendEntities, rankEntity }) {
  const { profile, metadata, transcriptFindings, discoveryLead } = packet;
  const videos = validateProfile(profile);
  const combined = { culturalSignals: creatorCulturalObservations(metadata, transcriptFindings) };
  const resolution = await resolveCreatorBridges(run.user_id, seed.qloo_id, seedTags, combined,
    { findTags, describeEntity, recommendEntities, rankEntity, discoveryLead,
      sourceVideos: profile.videos });
  const resolved = resolution.verified;
  const client = await db().connect();
  try {
    await client.query("begin");
    const locked = await client.query("select status,worker_id from public.analysis_runs where id=$1 for update", [run.id]);
    if (locked.rows[0]?.status !== "running" || locked.rows[0]?.worker_id !== workerId) {
      await client.query("rollback"); return null;
    }
    const partnerId = await ensureCreator(client, profile);
    if (run.kind === "direct_pair") await client.query(
      "update public.analysis_runs set specified_partner_id=$2 where id=$1", [run.id, partnerId]);
    const match = await client.query(`insert into public.matches(user_id,analysis_run_id,brand_entity_id,partner_entity_id)
      values ($1,$2,$3,$4) on conflict (analysis_run_id,partner_entity_id)
      do update set updated_at=public.matches.updated_at returning id`,
    [run.user_id, run.id, seed.id, partnerId]);
    const sourceRefs = [];
    const identityItems = packet.channelClass.identityEvidenceChain ??
      (packet.channelClass.identityEvidence ? [packet.channelClass.identityEvidence] : []);
    const identitySourceIds = [];
    for (const item of identityItems) {
      const id = await fileBrandWebSource(client, partnerId, item, "creator_identity");
      if (id) { identitySourceIds.push(id); sourceRefs.push({ kind: "catalog_item", id }); }
    }
    const identityComplete = identityItems.length > 0 && identitySourceIds.length === identityItems.length;
    const videoSources = new Map();
    const observationSources = new Map();
    for (const video of videos) {
      const observations = {
        culturalSignals: metadata.culturalSignals.filter((item) => item.videoId === video.sourceId),
        demonstratedFormats: metadata.demonstratedFormats.filter((item) => item.videoId === video.sourceId),
        collaborationObservations: metadata.collaborationObservations.filter((item) => item.videoId === video.sourceId),
        extractionVersion: metadata.extractionVersion, metadataHash: metadataHash(profile, video, seedTags.tags ?? []),
        extractionStatus: (metadata.sourceCoverage.extractedVideoIds ??
          (metadata.sourceCoverage.extracted === videos.length ? videos.map((item) => item.sourceId) : []))
          .includes(video.sourceId) ? "complete" : "incomplete",
        sourceRole: "representative_sample",
        ...(discoveryLead?.videoId === video.sourceId ? { discoveryHit: {
          direction: discoveryLead.direction, requestHash: discoveryLead.requestHash } } : {}) };
      const collected = new Date(video.collectedAt);
      const deadline = new Date(Math.min(Date.parse(video.retainUntil), collected.getTime() + 29 * 86400000));
      const videoFindings = transcriptFindings.filter((item) => item.videoId === video.sourceId);
      const transcriptAt = videoFindings.length ? new Date(packet.transcriptTimes.get(video.sourceId)) : null;
      const transcriptUntil = transcriptAt ? new Date(transcriptAt.getTime() + 14 * 86400000) : null;
      const source = await client.query(`insert into public.source_items(user_id,analysis_run_id,entity_id,
        external_item_id,owner_channel_id,source_url,title,published_at,collected_at,fresh_until,
        retain_until,request_hash,metadata_observations_json,transcript_observations_json,
        transcript_observed_at,transcript_expires_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16)
        on conflict (analysis_run_id,external_item_id) do update set
          metadata_observations_json=excluded.metadata_observations_json,
          transcript_observations_json=excluded.transcript_observations_json,
          transcript_observed_at=excluded.transcript_observed_at,
          transcript_expires_at=excluded.transcript_expires_at returning id`,
      [run.user_id, run.id, partnerId, video.sourceId, profile.id, video.sourceUrl,
        video.title.slice(0, 300), video.publishedAt, collected,
        new Date(Math.min(deadline.getTime(), collected.getTime() + 20 * 60000)),
        deadline, profile.videoRequestHash, JSON.stringify(observations),
        JSON.stringify(videoFindings), transcriptAt, transcriptUntil]);
      videoSources.set(video.sourceId, source.rows[0].id);
      observationSources.set(video.sourceId, source.rows[0].id);
      sourceRefs.push({ kind: "personal_item", id: source.rows[0].id });
    }
    if (discoveryLead && !videoSources.has(discoveryLead.videoId) &&
        VIDEO.test(discoveryLead.videoId) && HASH.test(discoveryLead.requestHash ?? "") &&
        discoveryLead.sourceUrl === `https://www.youtube.com/watch?v=${discoveryLead.videoId}` &&
        Number.isFinite(Date.parse(discoveryLead.collectedAt))) {
      const collected = new Date(discoveryLead.collectedAt);
      const deadline = new Date(Math.min(Date.now() + 29 * 86400000,
        collected.getTime() + 29 * 86400000));
      const hitFindings = transcriptFindings.filter((item) => item.videoId === discoveryLead.videoId);
      const hitTranscriptAt = hitFindings.length ? new Date(packet.transcriptTimes.get(discoveryLead.videoId)) : null;
      const source = await client.query(`insert into public.source_items(user_id,analysis_run_id,entity_id,
        external_item_id,owner_channel_id,source_url,title,published_at,collected_at,fresh_until,
        retain_until,request_hash,metadata_observations_json,transcript_observations_json,
        transcript_observed_at,transcript_expires_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16)
        on conflict (analysis_run_id,external_item_id) do nothing returning id`,
      [run.user_id, run.id, partnerId, discoveryLead.videoId, profile.id,
        discoveryLead.sourceUrl, discoveryLead.title.slice(0, 300), discoveryLead.publishedAt,
        collected, new Date(Math.min(Date.now() + 20 * 60000, deadline.getTime() - 1)),
        deadline, discoveryLead.requestHash, JSON.stringify({ sourceRole: "discovery_hit",
          direction: discoveryLead.direction, extractionStatus: "not_performed" }),
        JSON.stringify(hitFindings), hitTranscriptAt,
        hitTranscriptAt ? new Date(hitTranscriptAt.getTime() + 14 * 86400000) : null]);
      if (source.rows[0]) {
        sourceRefs.push({ kind: "personal_item", id: source.rows[0].id });
        observationSources.set(discoveryLead.videoId, source.rows[0].id);
      }
    }
    const commercialSources = [];
    for (const observation of packet.commercial?.observations ?? []) {
      const id = await fileBrandWebSource(client, partnerId, observation.item, "creator_commercial_activity");
      if (id && !commercialSources.some((source) => source.id === id)) {
        commercialSources.push({ id, observation });
        sourceRefs.push({ kind: "catalog_item", id });
      }
    }
    const qlooInputHashes = [];
    if (seedTags.responseId && !seedTags.sampleData) {
      sourceRefs.push(qlooRef(seedTags.responseId)); qlooInputHashes.push(seedTags.inputHash);
    }
    const bridges = [];
    const admittedActivityObservations = [];
    for (const item of resolved) {
      if ((item.kind === "tag" && !seedTags.responseId) || !observationSources.size) continue;
      for (const ref of item.qlooRefs) {
        if (!sourceRefs.some((source) => source.kind === "qloo_response" && source.id === ref.responseId)) {
          sourceRefs.push(qlooRef(ref.responseId)); qlooInputHashes.push(ref.inputHash);
        }
      }
      const bridgeId = `bridge:${bridges.length + 1}`;
      bridges.push({ id: bridgeId, name: item.tag.name,
        qlooTagId: item.qlooId, family: item.tag.type ?? null,
        specificity: item.kind === "named" ? "named" : "broad",
        classification: item.classification,
        qlooSourceIds: [
          ...(seedTags.responseId ? [`qloo:${seedTags.responseId}`] : []),
          ...item.qlooRefs.map((ref) => `qloo:${ref.responseId}`)],
        partnerSourceIds: [...new Set(item.observations.map((observation) => observationSources.get(observation.videoId))
          .filter(Boolean))].slice(0, 5).map(sourceId), explainabilityBacked: false });
      admittedActivityObservations.push(...item.observations.map((observation) => ({ observation, bridgeId })));
    }
    const partnerActivity = creatorPartnerActivity(admittedActivityObservations, videoSources, profile.name);
    const bridgeObservations = resolved.flatMap((item) => item.observations);
    const capabilities = creatorCapabilities(run.objective, metadata, videoSources, bridgeObservations,
      commercialSources.map(({ id }) => `catalog:${id}`), transcriptFindings);
    const claims = partnerActivity.slice(0, 20).map((item) => ({ id: `claim:${item.id}`,
      kind: "observation", text: item.summary, sourceIds: item.sourceIds }));
    if (identityComplete) claims.push({ id: "claim:creator_identity", kind: "observation",
      text: `An inspected creator page corroborates ${packet.channelClass.operatorName} as the channel operator.`,
      sourceIds: identitySourceIds.map((id) => `catalog:${id}`) });
    const ancillary = new Set();
    for (const item of transcriptFindings) {
      if (!["expertise", "product_mention", "explicit_sponsorship_disclosure",
        "affiliate_reference"].includes(item.kind)) continue;
      const id = videoSources.get(item.videoId) ?? observationSources.get(item.videoId);
      const key = `${item.videoId}:${item.kind}:${normalized(item.entity)}`;
      if (!id || ancillary.has(key) || claims.length >= 27) continue;
      ancillary.add(key);
      claims.push({ id: `claim:caption:${claims.length + 1}`, kind: "observation",
        text: `A selected video contains a source-grounded ${item.kind.replaceAll("_", " ")} observation: ${item.entity}.`,
        sourceIds: [sourceId(id)] });
    }
    for (const { id, observation } of commercialSources) {
      claims.push({ id: `claim:web:${claims.length + 1}`, kind: "observation",
        text: `An inspected official page documents a collaboration involving ${profile.name} and ${observation.partnerName}.`,
        sourceIds: [`catalog:${id}`] });
    }
    const unknowns = ["Audience overlap", "Target-market audience geography",
      "Creator interest", "Commercial feasibility"];
    if (!bridges.length) unknowns.push("Supported cultural connection");
    if (resolution.review.length) unknowns.push("Some observed cultural references remain ambiguous or unsupported");
    if (metadata.sourceCoverage.failedBatches) unknowns.push("Some video metadata could not be analyzed");
    if (!videos.length) unknowns.push("Representative public video sample");
    if (capabilities.some((item) => item.status === "unsupported")) unknowns.push("Objective-specific capability");
    if (packet.channelClass.kind !== "creator" ||
        (identityItems.length > 0 && !identityComplete)) unknowns.push("Independent creator identity");
    if (!profile.country) unknowns.push("Channel country");
    if (packet.transcriptStopReason === "budget_exhausted") unknowns.push("Further caption research was limited");
    if (packet.commercial?.coverage === "not_completed") unknowns.push("Commercial verification was unavailable");
    const frozen = await freezeEvidenceInput({ userId: run.user_id, seedEntityId: seed.id,
      partnerEntityId: partnerId, objective: run.objective, sourceRefs, claims, unknowns,
      qlooInputHashes, bridges, partnerActivity, capabilities,
      constraints: assessmentConstraints(run, partnerId),
      creatorSample: { sourceIds: [...videoSources.values()].map(sourceId),
        videoIds: [...videoSources.keys()], collectedAt: profile.collectedAt ?? new Date().toISOString(),
        complete: videos.length > 0 && metadata.sourceCoverage.extracted === videos.length &&
          (!profile.sampling?.coverage || profile.sampling.coverage === "complete") } }, client);
    const signals = classifySignals(frozen.evidence, run.objective, "brand_youtube");
    const exclusions = classifyExclusions(frozen.evidence);
    const output = scoreAssessment({ snapshotId: match.rows[0].id, snapshotHash: frozen.inputHash,
      scorerVersion: SCORING_VERSION, pairType: "brand_youtube", objective: run.objective,
      brandId: seed.id, partnerId, sourceIds: frozen.evidence.sources.map((source) => source.id),
      culturalConnection: signals.culturalConnection, contentRelevance: signals.contentRelevance,
      goalFit: signals.goalFit, qlooLineageVerified: Boolean((seedTags.responseId && !seedTags.sampleData) ||
        bridges.some((bridge) => bridge.specificity === "named")),
      identityVerified: seed.identity_status === "verified" && packet.channelClass.kind === "creator" &&
        (identityItems.length === 0 || identityComplete),
      hardExclusion: exclusions.hardExclusion,
      hardExclusionEvidenceIds: exclusions.hardExclusionEvidenceIds,
      reviewFlags: signals.reviewFlags,
      confidence: signals.confidence });
    const scoreJson = { ...output, mechanism: signals.mechanism,
      findings: { C: signals.culturalConnection.notes, R: signals.contentRelevance.notes,
        G: signals.goalFit.notes } };
    const prior = await client.query("select version,input_hash,scoring_version,validity_status from public.assessment_snapshots where match_id=$1 order by version desc", [match.rows[0].id]);
    if (assessmentNeedsAppend(prior.rows, frozen.inputHash, SCORING_VERSION)) {
      const version = (prior.rows[0]?.version ?? 0) + 1;
      await client.query(`insert into public.assessment_snapshots(user_id,match_id,version,objective,
        input_hash,scoring_version,evidence_json,score_json,source_refs_json,qloo_response_ids)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::uuid[])`,
      [run.user_id, match.rows[0].id, version, run.objective, frozen.inputHash,
        SCORING_VERSION, JSON.stringify(frozen.evidence), JSON.stringify(scoreJson),
        JSON.stringify(frozen.sourceRefsJson), frozen.qlooResponseIds]);
    }
    await client.query("commit");
    return { channelId: profile.id, matchId: match.rows[0].id, name: profile.name,
      scoreStatus: output.status, displayScore: output.displayScore,
      sampleSize: videos.length, analyzedVideos: metadata.sourceCoverage.extracted,
      failedMetadataBatches: metadata.sourceCoverage.failedBatches,
      bridgeCount: bridges.length, transcriptStatus: packet.transcriptStatus,
      transcriptStopReason: packet.transcriptStopReason,
      bridgeReview: resolution.review,
      commercialCoverage: packet.commercial?.coverage ?? "not_performed",
      sourceUrls: videos.slice(0, 3).map((video) => video.sourceUrl) };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function processCreatorResearchRun(run, workerId, {
  importCreator = importChannel, search = searchCreatorLeads, tags = personalQlooEntityTags,
  plan = planCreatorQueries, extract = extractCreatorMetadata, findTags = personalQlooFindTags,
  describeEntity = personalQlooResolveNamedEntity, recommendEntities = personalQlooRecommendNamedEntity,
  rankEntity = personalQlooRankNamedEntity,
  inspect = inspectChannel, classifyChannel = classifyCreatorChannel,
  verifyIdentity = verifyCreatorOperator,
  chooseTranscript = chooseCreatorTranscript, retrieveTranscript = selectedVideoTranscript,
  extractTranscript = extractCreatorTranscript,
  verifyCommercial = researchCreatorCommercial,
  onCandidateError = null,
} = {}) {
  if (run.constraints_json?.researchMode !== "live_youtube" ||
      run.match_type !== "brand_youtube_creator" || !["direct_pair", "discovery"].includes(run.kind)) {
    throw new Error("Unsupported creator research run.");
  }
  const result = await db().query(`select e.id,e.canonical_name,e.identity_status,
    (select external_id from catalog.entity_identifiers where entity_id=e.id and provider='qloo'
      and status='confirmed' limit 1) as qloo_id from catalog.entities e where e.id=$1`, [run.seed_entity_id]);
  const seed = result.rows[0];
  if (!seed?.qloo_id) throw new Error("The starting brand needs a confirmed cultural identity.");
  let seedTags;
  try { seedTags = await tags(run.user_id, seed.qloo_id); }
  catch { seedTags = { tags: [], responseId: null, status: "unavailable" }; }
  const candidates = [];
  const discoveryLeads = new Map();
  const profiles = [];
  const directions = [];
  const namedResponseIds = [];
  const samplePreviews = new Map();
  let screeningNames = [];
  if (run.kind === "direct_pair") {
    profiles.push(run.constraints_json.creatorChannel);
  } else {
    if (seedTags.status === "ok" && seedTags.tags?.length) {
      const namedEntities = [];
      for (const type of namedDiscoveryTypes(seedTags.tags)) {
        try {
          const related = await recommendEntities(run.user_id, seed.qloo_id, type);
          if (related?.envelope?.status !== "ok" || !related.responseId || related.sampleData) continue;
          namedResponseIds.push({ type, responseId: related.responseId });
          namedEntities.push(...(related.envelope.results ?? []).filter((item) =>
            typeof item.entity_id === "string" && typeof item.name === "string")
            .map((item) => ({ id: item.entity_id, name: item.name, type,
              responseId: related.responseId })));
        } catch { /* Other Qloo-grounded directions remain available. */ }
      }
      screeningNames = namedEntities;
      try { directions.push(...await plan({ brandName: seed.canonical_name,
        objective: run.objective, tags: seedTags.tags, namedEntities })); }
      catch { /* honest partial result below */ }
    }
    const ceiling = Math.min(24, (run.plan_json?.maxCandidates ?? 8) * 3);
    const leadQueues = [];
    for (const direction of directions.slice(0, 5)) {
      try {
        leadQueues.push({ direction, leads: await search(direction.q) });
      } catch (error) { candidates.push({ direction: direction.q, status: "search_unavailable",
        providerFailureCode: typeof error?.code === "string" ? error.code : "YOUTUBE_PROVIDER_UNAVAILABLE" }); }
    }
    for (const { direction, lead } of selectCreatorLeads(leadQueues, ceiling)) {
        candidates.push({ channelId: lead.id, discoveryVideoId: lead.videoId,
          direction: direction.q, sourceUrl: lead.searchSource?.url ?? null,
          status: "lead" });
        if (lead.searchSource) discoveryLeads.set(lead.id, {
          videoId: lead.videoId, direction: direction.q,
          namedEntityId: direction.namedEntityId ?? null,
          namedEntityName: direction.namedEntityName ?? null,
          namedEntityType: direction.namedEntityType ?? null,
          qlooResponseIds: direction.qlooResponseIds ?? [],
          sourceUrl: lead.searchSource.url, title: lead.searchSource.title,
          publishedAt: lead.searchSource.publishedAt,
          collectedAt: lead.searchSource.collectedAt,
          requestHash: lead.searchSource.requestHash });
    }
    profiles.push(...candidates.filter((item) => item.channelId).slice(0, 24).map((item) => item.channelId));
    // Inspect a bounded prefix of the diverse search pool before allocating
    // deep packets. These exact title matches only determine research order;
    // the unchanged extraction, Qloo bridge, identity and v4 gates decide fit.
    if (screeningNames.length) {
      const previewCount = creatorSamplePreviewLimit(profiles.length,
        run.plan_json?.maxProviderCalls ?? 60);
      for (const reference of profiles.slice(0, previewCount)) {
        try { const profile = await importCreator(reference); validateProfile(profile);
          samplePreviews.set(reference, profile); }
        catch (error) { onCandidateError?.("sample_screen", reference, error);
          if (error?.code === "YOUTUBE_APP_BUDGET_EXHAUSTED" ||
              error?.code === "YOUTUBE_GOOGLE_QUOTA_EXHAUSTED") break; }
      }
      profiles.splice(0, previewCount, ...prioritizeCreatorLeadsBySample(
        profiles.slice(0, previewCount), samplePreviews, screeningNames));
    }
  }
  const packets = [];
  let coverageIssue = null;
  for (const reference of profiles) {
    if (packets.length >= Math.min(8, run.plan_json?.maxCandidates ?? 8)) break;
    try {
      const channel = await inspect(reference);
      let channelClass;
      try { channelClass = await classifyChannel(channel, seed.canonical_name); }
      catch (error) {
        if (String(error?.message ?? "").includes("HTTP 429")) {
          coverageIssue = "creator_classification_unavailable";
          const pending = candidates.find((item) => item.channelId === channel.id);
          if (pending) pending.status = "identity_review_needed";
          break;
        }
        channelClass = { kind: "unknown", reason: "Channel ownership was not established." };
      }
      if (channelClass.kind === "unknown") channelClass = await verifyIdentity(channel) ?? channelClass;
      const candidate = candidates.find((item) => item.channelId === channel.id);
      if (candidate) Object.assign(candidate, { name: channel.name,
        channelType: channelClass.kind, channelTypeReason: channelClass.reason,
        identitySourceUrl: channelClass.identityEvidence?.url ?? null,
        channelCountry: channel.country ?? null, audienceGeographyStatus: "unknown" });
      if (channelClass.kind === "organization") {
        if (candidate) candidate.status = "excluded_organization";
        continue;
      }
      const profile = samplePreviews.get(reference) ?? await importCreator(reference);
      validateProfile(profile);
      const reusable = await reusableMetadata(run.user_id, seed.id, profile, seedTags.tags ?? []);
      const metadata = reusable?.sourceCoverage.extracted === profile.videos.length ? reusable
        : await extract(profile, { tags: seedTags.tags ?? [], reusable });
      packets.push({ profile, metadata, objective: run.objective,
        discoveryLead: discoveryLeads.get(profile.id) ?? null,
        transcriptFindings: [], transcriptTimes: new Map(),
        transcriptStatus: [], transcriptPlans: [], attemptedVideoIds: [], transcriptStopReason: null,
        channelClass });
    } catch (error) {
      onCandidateError?.("research", reference, error);
      if (run.kind === "direct_pair") throw error;
      const candidate = candidates.find((item) => item.channelId === reference);
      if (candidate) candidate.status = "research_incomplete";
    }
  }
  const transcriptAttempts = await enrichCreatorPackets(packets, seedTags,
    { chooseTranscript, retrieveTranscript, extractTranscript });
  for (const packet of packets) packet.commercial = await verifyCommercial(packet.profile,
    commercialMetadataForResearch(packet.metadata, packet.transcriptFindings));
  const assessments = [];
  for (const packet of packets) {
    try {
      const assessment = await assessCreator(run, workerId, packet, seed, seedTags,
        { findTags, describeEntity, recommendEntities, rankEntity });
      if (!assessment) return false;
      assessments.push(assessment);
      const candidate = candidates.find((item) => item.channelId === packet.profile.id);
      if (candidate) Object.assign(candidate, { status: "assessed", matchId: assessment.matchId,
        name: assessment.name,
        scoreStatus: assessment.scoreStatus, displayScore: assessment.displayScore,
        sampleSize: assessment.sampleSize, bridgeCount: assessment.bridgeCount,
        transcriptStatus: assessment.transcriptStatus, transcriptStopReason: assessment.transcriptStopReason });
    } catch (error) {
      onCandidateError?.("assessment", packet.profile.id, error);
      if (run.kind === "direct_pair") throw error;
      const candidate = candidates.find((item) => item.channelId === packet.profile.id);
      if (candidate) candidate.status = "assessment_incomplete";
    }
  }
  const scored = assessments.filter((item) => ["eligible", "conditional"].includes(item.scoreStatus));
  const client = await db().connect();
  try {
    await client.query("begin");
    const locked = await client.query("select status,worker_id from public.analysis_runs where id=$1 for update", [run.id]);
    if (locked.rows[0]?.status !== "running" || locked.rows[0]?.worker_id !== workerId) {
      await client.query("rollback"); return false;
    }
    await client.query(`update public.analysis_runs set status=$2,stage='Complete',
      provider_refs_json=$3::jsonb,result_json=$4::jsonb,finished_at=now(),
      lease_until=null,worker_id=null,updated_at=now() where id=$1`,
    [run.id, scored.length ? "completed" : "partial",
      JSON.stringify([{ provider: "youtube_data_api_v3", directions: directions.length,
        channels: assessments.length }, { provider: "qloo", seedResponseId: seedTags.responseId ?? null,
        namedResponseIds }]),
      JSON.stringify({ sample: false, count: assessments.length, researchType: "creator_pair",
        scoringVersion: SCORING_VERSION, directions, candidates, transcriptAttempts, coverageIssue,
        research: assessments.map((item) => ({ channelId: item.channelId,
          matchId: item.matchId, scoreStatus: item.scoreStatus,
          sampleSize: item.sampleSize, analyzedVideos: item.analyzedVideos,
          failedMetadataBatches: item.failedMetadataBatches,
          bridgeCount: item.bridgeCount, transcriptStatus: item.transcriptStatus,
          bridgeReview: item.bridgeReview,
          commercialCoverage: item.commercialCoverage,
          transcriptStopReason: item.transcriptStopReason,
          transcriptPlans: packets.find((packet) => packet.profile.id === item.channelId)?.transcriptPlans ?? [] })),
        groups: { eligible: assessments.filter((item) => item.scoreStatus === "eligible").length,
          conditional: assessments.filter((item) => item.scoreStatus === "conditional").length,
          insufficient: assessments.filter((item) => item.scoreStatus === "insufficient_evidence").length },
        message: assessments.length ? "Creator research is ready with source-linked findings and open questions."
          : coverageIssue ? "Creator identity checks could not finish. The leads need another research attempt."
            : "No creator could be fully researched with the available evidence." })]);
    await client.query("commit");
    return true;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
