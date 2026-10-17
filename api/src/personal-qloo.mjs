import { qlooCall } from "./qloo.mjs";
import { qlooCacheIdentity, readQlooCache, storeQlooResponse } from "./qloo-cache.mjs";

const DAY = 24 * 60 * 60 * 1000;

export async function personalQlooDescribe(ownerUserId, context,
  { provider = qlooCall, now = new Date() } = {}) {
  const identity = qlooCacheIdentity({ operation: "qloo_describe", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) {
    return { ...cached.result, cacheStatus: cached.status };
  }
  const envelope = await provider("qloo_describe", context);
  if (!envelope || typeof envelope !== "object" || typeof envelope.status !== "string") {
    throw new Error("Cultural brand lookup returned an invalid response.");
  }
  if (envelope.status === "ok" && Array.isArray(envelope.results)) {
    const resolvedEntityIds = [...new Set(envelope.results.map((item) => item?.entity_id)
      .filter((id) => typeof id === "string" && id))];
    await storeQlooResponse(identity, { result: envelope, providerStatus: envelope.status,
      resolvedEntityIds, rights: { storage: "permitted", scope: "private" },
      collectedAt: now, respondedAt: now, freshUntil: new Date(now.getTime() + DAY),
      retainUntil: new Date(now.getTime() + 7 * DAY), sampleData: provider !== qlooCall });
  }
  return { ...envelope, cacheStatus: "new" };
}

export async function personalQlooRank(ownerUserId, seedQlooId, partnerQlooId,
  { provider = qlooCall, now = new Date() } = {}) {
  if (typeof seedQlooId !== "string" || !seedQlooId ||
      typeof partnerQlooId !== "string" || !partnerQlooId || seedQlooId === partnerQlooId) {
    throw new Error("Two distinct confirmed cultural brand identifiers are required.");
  }
  const context = { options: [partnerQlooId], option_type: "brand", signals: [seedQlooId] };
  const identity = qlooCacheIdentity({ operation: "qloo_rank", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) return {
    envelope: cached.result, responseId: cached.responseId, inputHash: identity.inputHash,
    cacheStatus: cached.status, sampleData: cached.sampleData,
  };
  const envelope = await provider("qloo_rank", context);
  if (!envelope || typeof envelope !== "object" || typeof envelope.status !== "string") {
    throw new Error("Cultural relationship research returned an invalid response.");
  }
  if (envelope.status !== "ok" || !Array.isArray(envelope.results)) {
    return { envelope, responseId: null, inputHash: identity.inputHash, cacheStatus: "uncached", sampleData: provider !== qlooCall };
  }
  const match = envelope.results.find((item) => item?.entity_id === partnerQlooId);
  if (!match || !Number.isFinite(match.affinity)) {
    return { envelope, responseId: null, inputHash: identity.inputHash, cacheStatus: "uncached", sampleData: provider !== qlooCall };
  }
  const saved = await storeQlooResponse(identity, {
    result: envelope, providerStatus: envelope.status, resolvedEntityIds: [partnerQlooId],
    affinities: [{ entityId: partnerQlooId, affinity: match.affinity }],
    relationships: [], explainability: match.explanation ?? null,
    explainabilityStatus: match.explanation ? "available" : "not_returned",
    rights: { storage: "permitted", scope: "private" },
    collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall,
  });
  return { envelope, responseId: saved.id, inputHash: identity.inputHash,
    cacheStatus: "new", sampleData: provider !== qlooCall };
}

// A filtered Insights result checks one creator-observed named entity against
// the seed's exact Qloo ID when the limited recommendation list omits it.
// The caller must still supply independent, source-backed creator evidence.
export async function personalQlooRankNamedEntity(ownerUserId, seedQlooId, entityId, entityType,
  { provider = qlooCall, now = new Date() } = {}) {
  if (!QLOO_UUID.test(seedQlooId ?? "") || !QLOO_UUID.test(entityId ?? "") ||
      seedQlooId.toLowerCase() === entityId.toLowerCase() || !CREATOR_NAMED_TYPES.has(entityType)) {
    throw new Error("Confirmed seed and typed named cultural entity identifiers are required.");
  }
  const context = { options: [entityId], option_type: entityType, signals: [seedQlooId] };
  const identity = qlooCacheIdentity({ operation: "qloo_rank", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status === "fresh" && !(cached.sampleData && provider === qlooCall)) return {
    envelope: cached.result, responseId: cached.responseId, inputHash: identity.inputHash,
    cacheStatus: cached.status, sampleData: cached.sampleData,
  };
  const envelope = await provider("qloo_rank", context);
  const match = envelope?.status === "ok" && Array.isArray(envelope.results)
    ? envelope.results.find((item) => String(item?.entity_id ?? "").toLowerCase() === entityId.toLowerCase() &&
      (item.subtype ?? item.type) === `urn:entity:${entityType}` && Number.isFinite(item.affinity)) : null;
  if (!match) return { envelope, responseId: null, inputHash: identity.inputHash,
    cacheStatus: "uncached", sampleData: provider !== qlooCall };
  const saved = await storeQlooResponse(identity, { result: envelope, providerStatus: envelope.status,
    resolvedEntityIds: [entityId], affinities: [{ entityId, affinity: match.affinity }],
    relationships: [], explainability: match.explainability ?? null,
    explainabilityStatus: match.explainability ? "available" : "not_returned",
    rights: { storage: "permitted", scope: "private" }, collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall });
  return { envelope, responseId: saved.id, inputHash: identity.inputHash,
    cacheStatus: "new", sampleData: provider !== qlooCall };
}

const QLOO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function personalQlooRecommendBrands(ownerUserId, seedQlooId,
  { provider = qlooCall, now = new Date() } = {}) {
  if (!QLOO_UUID.test(seedQlooId ?? "")) throw new Error("A confirmed cultural brand identifier is required.");
  const context = { target_type: "brand", signals: [seedQlooId], limit: 12, explain: true };
  const identity = qlooCacheIdentity({ operation: "qloo_recommend", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) {
    return { envelope: cached.result, responseId: cached.responseId, inputHash: identity.inputHash,
      cacheStatus: cached.status, sampleData: cached.sampleData };
  }
  const envelope = await provider("qloo_recommend", context);
  if (!envelope || typeof envelope !== "object" || typeof envelope.status !== "string") {
    throw new Error("Cultural brand discovery returned an invalid response.");
  }
  if (!["ok", "partial"].includes(envelope.status) || !Array.isArray(envelope.results)) {
    return { envelope, responseId: null, inputHash: identity.inputHash,
      cacheStatus: "uncached", sampleData: provider !== qlooCall };
  }
  const resolvedEntityIds = [...new Set(envelope.results.map((item) => item?.entity_id)
    .filter((id) => typeof id === "string" && QLOO_UUID.test(id)))];
  const saved = await storeQlooResponse(identity, {
    result: envelope, providerStatus: envelope.status, resolvedEntityIds,
    rights: { storage: "permitted", scope: "private" },
    collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall,
  });
  return { envelope, responseId: saved.id, inputHash: identity.inputHash,
    cacheStatus: "new", sampleData: provider !== qlooCall };
}

function normalizeTags(results) {
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of results) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    tags.push({ id, name, type: typeof item?.type === "string" ? item.type : null,
      affinity: Number.isFinite(item?.affinity) ? item.affinity : null });
  }
  return tags;
}

export async function personalQlooEntityTags(ownerUserId, entityId, { provider = qlooCall, now = new Date() } = {}) {
  if (!QLOO_UUID.test(entityId ?? "")) throw new Error("A confirmed cultural brand identifier is required.");
  const context = { entities: [entityId], entity_type: "brand", limit: 20 };
  const identity = qlooCacheIdentity({ operation: "qloo_entity_tags", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) {
    return { tags: normalizeTags(cached.result?.results), responseId: cached.responseId,
      inputHash: identity.inputHash, cacheStatus: cached.status, sampleData: cached.sampleData,
      status: cached.result?.status ?? "ok" };
  }
  const envelope = await provider("qloo_entity_tags", context);
  if (!envelope || typeof envelope !== "object" || typeof envelope.status !== "string") {
    throw new Error("Cultural tag research returned an invalid response.");
  }
  if (envelope.status !== "ok" || !Array.isArray(envelope.results)) {
    return { tags: [], responseId: null, inputHash: identity.inputHash, cacheStatus: "uncached",
      sampleData: provider !== qlooCall, status: envelope.status };
  }
  const tags = normalizeTags(envelope.results);
  const saved = await storeQlooResponse(identity, {
    result: envelope, providerStatus: envelope.status, resolvedEntityIds: tags.map((tag) => tag.id),
    affinities: tags.filter((tag) => Number.isFinite(tag.affinity)).map((tag) => ({ entityId: tag.id, affinity: tag.affinity })),
    rights: { storage: "permitted", scope: "private" },
    collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall,
  });
  return { tags, responseId: saved.id, inputHash: identity.inputHash,
    cacheStatus: "new", sampleData: provider !== qlooCall, status: "ok" };
}

// Resolve a creator-observed cultural phrase to a real Qloo tag. The caller
// must independently validate the video observation and seed-side association.
export async function personalQlooFindTags(ownerUserId, phrase, { provider = qlooCall, now = new Date() } = {}) {
  const query = String(phrase ?? "").trim();
  if (query.length < 3 || query.length > 80) throw new Error("Invalid cultural reference.");
  const context = { query, limit: 5 };
  const identity = qlooCacheIdentity({ operation: "qloo_find_tags", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) {
    return { tags: normalizeTags(cached.result?.results), responseId: cached.responseId,
      inputHash: identity.inputHash, status: cached.result?.status ?? "ok", sampleData: cached.sampleData,
      cacheStatus: cached.status };
  }
  const envelope = await provider("qloo_find_tags", context);
  if (envelope?.status !== "ok" || !Array.isArray(envelope.results)) {
    return { tags: [], responseId: null, inputHash: identity.inputHash,
      status: envelope?.status ?? "unavailable", cacheStatus: "uncached", sampleData: provider !== qlooCall };
  }
  const tags = normalizeTags(envelope.results);
  const saved = await storeQlooResponse(identity, { result: envelope, providerStatus: envelope.status,
    resolvedEntityIds: tags.map((tag) => tag.id),
    rights: { storage: "permitted", scope: "private" }, collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall });
  return { tags, responseId: saved.id, inputHash: identity.inputHash,
    status: "ok", cacheStatus: "new", sampleData: provider !== qlooCall };
}

// Named creator observations use the same private Qloo response cache. A
// resolved name is never enough on its own: callers must verify the exact ID
// in a seed-brand recommendation before admitting a pair bridge.
export async function personalQlooResolveNamedEntity(ownerUserId, phrase,
  { provider = qlooCall, now = new Date() } = {}) {
  const query = String(phrase ?? "").trim();
  if (query.length < 3 || query.length > 100) throw new Error("Invalid named cultural reference.");
  const context = { entity: query };
  const identity = qlooCacheIdentity({ operation: "qloo_describe", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status === "fresh" && !(cached.sampleData && provider === qlooCall)) {
    return { envelope: cached.result, responseId: cached.responseId,
      inputHash: identity.inputHash, sampleData: cached.sampleData, cacheStatus: cached.status };
  }
  const envelope = await provider("qloo_describe", context);
  if (envelope?.status !== "ok" || !Array.isArray(envelope.results)) return {
    envelope, responseId: null, inputHash: identity.inputHash,
    sampleData: provider !== qlooCall, cacheStatus: "uncached" };
  const saved = await storeQlooResponse(identity, { result: envelope, providerStatus: envelope.status,
    resolvedEntityIds: envelope.results.map((item) => item?.entity_id).filter(Boolean),
    rights: { storage: "permitted", scope: "private" }, collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall });
  return { envelope, responseId: saved.id, inputHash: identity.inputHash,
    sampleData: provider !== qlooCall, cacheStatus: "new" };
}

const CREATOR_NAMED_TYPES = new Set(["artist", "movie", "tv_show", "book", "videogame",
  "place", "podcast", "person", "brand"]);
export async function personalQlooRecommendNamedEntity(ownerUserId, seedQlooId, targetType,
  { provider = qlooCall, now = new Date() } = {}) {
  if (!QLOO_UUID.test(seedQlooId ?? "") || !CREATOR_NAMED_TYPES.has(targetType)) {
    throw new Error("Confirmed brand and supported named cultural type are required.");
  }
  const context = { target_type: targetType, signals: [seedQlooId], limit: 20, explain: true };
  const identity = qlooCacheIdentity({ operation: "qloo_recommend", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status === "fresh" && !(cached.sampleData && provider === qlooCall)) {
    return { envelope: cached.result, responseId: cached.responseId,
      inputHash: identity.inputHash, sampleData: cached.sampleData, cacheStatus: cached.status };
  }
  const envelope = await provider("qloo_recommend", context);
  if (envelope?.status !== "ok" || !Array.isArray(envelope.results)) return {
    envelope, responseId: null, inputHash: identity.inputHash,
    sampleData: provider !== qlooCall, cacheStatus: "uncached" };
  const saved = await storeQlooResponse(identity, { result: envelope, providerStatus: envelope.status,
    resolvedEntityIds: envelope.results.map((item) => item?.entity_id).filter(Boolean),
    rights: { storage: "permitted", scope: "private" }, collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall });
  return { envelope, responseId: saved.id, inputHash: identity.inputHash,
    sampleData: provider !== qlooCall, cacheStatus: "new" };
}
