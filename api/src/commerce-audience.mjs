import { personalQlooAudienceDemographics, personalQlooEntityTags } from "./personal-qloo.mjs";
import { sharedAudienceTastes } from "./commerce-evidence.mjs";

const QLOO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPECIFIC_TAG = /^urn:tag:(?:aesthetic_property|keyword):qloo:[a-z0-9_]+$/;
const GENERIC = /^(?:design|lifestyle|fashion|indie|minimalist|artsy|creative|home goods|functionality)$/i;
const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function specificTags(result) {
  if (result?.status !== "ok" || result.sampleData === true) return [];
  return (result.tags ?? []).filter((tag) => SPECIFIC_TAG.test(tag.id ?? "") &&
    normalize(tag.name).length >= 8 && !GENERIC.test(normalize(tag.name)));
}

function sharedPatterns(seedTags, partnerTags) {
  const partnerById = new Map(specificTags(partnerTags).map((tag) => [tag.id, tag]));
  return specificTags(seedTags).filter((tag) =>
    normalize(partnerById.get(tag.id)?.name) === normalize(tag.name))
    .slice(0, 3).map((tag) => ({ name: tag.name }));
}

function demographicSignals(result, entityId) {
  if (result?.status !== "ok" || result.sampleData === true) return null;
  const row = result.results?.find((item) =>
    String(item.entity_id ?? "").toLowerCase() === entityId.toLowerCase());
  if (!row) return null;
  const positive = (values) => Object.entries(values ?? {}).filter(([, value]) =>
    typeof value === "number" && Number.isFinite(value) && value > 0)
    .map(([name]) => name);
  return { age: positive(row.query?.age), gender: positive(row.query?.gender) };
}

// Automatic research for an already shortlisted pair. Each Qloo request is
// tied to one verified brand. Separate responses are never blended
// into an overlap percentage, score, cultural gate, or product verdict.
export async function investigateCommerceAudience(ownerUserId, seedQlooId, partnerQlooId,
  { includeDemographics = false, tags = personalQlooEntityTags,
    demographics = personalQlooAudienceDemographics } = {}) {
  if (!QLOO_ID.test(seedQlooId ?? "") || !QLOO_ID.test(partnerQlooId ?? "") ||
      seedQlooId.toLowerCase() === partnerQlooId.toLowerCase()) {
    throw new Error("Two distinct verified cultural brands are required.");
  }
  const [seedTags, partnerTags] = await Promise.all([
    tags(ownerUserId, seedQlooId).catch(() => null),
    tags(ownerUserId, partnerQlooId).catch(() => null),
  ]);
  const tagEvidenceAvailable = seedTags?.status === "ok" && partnerTags?.status === "ok" &&
    seedTags.sampleData !== true && partnerTags.sampleData !== true;
  const patterns = tagEvidenceAvailable ? sharedPatterns(seedTags, partnerTags) : [];
  const connections = patterns.length ? patterns : tagEvidenceAvailable
    ? sharedAudienceTastes(seedTags.tags, partnerTags.tags).map((name) => ({ name })) : [];
  const result = { status: !tagEvidenceAvailable ? "unavailable"
    : connections.length ? "specific_patterns_observed" : "no_specific_pattern_observed",
  connections,
  demographicStatus: "not_requested", sharedDemographicSignals: null };
  if (!includeDemographics || (includeDemographics === "when_specific" && !connections.length)) return result;
  const [seedDemo, partnerDemo] = await Promise.all([
    demographics(ownerUserId, seedQlooId).catch(() => null),
    demographics(ownerUserId, partnerQlooId).catch(() => null),
  ]);
  const seedSignals = demographicSignals(seedDemo, seedQlooId);
  const partnerSignals = demographicSignals(partnerDemo, partnerQlooId);
  if (!seedSignals || !partnerSignals) return { ...result, demographicStatus: "unavailable" };
  const shared = (field) => seedSignals[field].filter((value) =>
    partnerSignals[field].includes(value));
  return { ...result, demographicStatus: "observed", sharedDemographicSignals: {
    age: shared("age").slice(0, 6), gender: shared("gender").slice(0, 2) } };
}
