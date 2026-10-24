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

// A filtered Insights result checks a candidate brand against a named cultural
// entity from a selected product. The caller must verify source and participation.
export async function personalQlooRankNamedEntity(ownerUserId, seedQlooId, entityId, entityType,
  { provider = qlooCall, now = new Date() } = {}) {
  if (!QLOO_UUID.test(seedQlooId ?? "") || !QLOO_UUID.test(entityId ?? "") ||
      seedQlooId.toLowerCase() === entityId.toLowerCase() || !CONTEXT_NAMED_TYPES.has(entityType)) {
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

const CONTEXT_NAMED_TYPES = new Set(["artist", "movie", "tv_show", "book", "videogame",
  "place", "podcast", "person"]);
const QLOO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function personalQlooRecommendBrands(ownerUserId, seedQlooId,
  { provider = qlooCall, now = new Date(), limit = 12 } = {}) {
  if (!QLOO_UUID.test(seedQlooId ?? "")) throw new Error("A confirmed cultural brand identifier is required.");
  const take = Number.isInteger(limit) && limit >= 1 ? Math.min(20, limit) : 12;
  const context = { target_type: "brand", signals: [seedQlooId], limit: take, explain: true };
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

// Product-context discovery has a different input and provenance from a
// native brand recommendation. Keep its private cache key and returned query
// lineage separate so it can never be mistaken for Brand A affinity.
export async function personalQlooRecommendContextBrands(ownerUserId, signalId,
  { kind = "tag", provider = qlooCall, now = new Date() } = {}) {
  if (kind === "tag" ? !/^urn:tag:[a-z_]+:qloo:[a-z0-9_]+$/.test(signalId ?? "")
    : kind !== "entity" || !QLOO_UUID.test(signalId ?? "")) {
    throw new Error("A resolved Qloo cultural signal is required.");
  }
  const context = { target_type: "brand",
    ...(kind === "tag" ? { signal_tags: [signalId] } : { signals: [signalId] }),
    limit: 20, explain: true };
  const identity = qlooCacheIdentity({ operation: "qloo_recommend", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) {
    return { envelope: cached.result, responseId: cached.responseId, inputHash: identity.inputHash,
      cacheStatus: cached.status, sampleData: cached.sampleData };
  }
  const envelope = await provider("qloo_recommend", context);
  if (!["ok", "partial"].includes(envelope?.status) || !Array.isArray(envelope.results)) {
    return { envelope, responseId: null, inputHash: identity.inputHash,
      cacheStatus: "uncached", sampleData: provider !== qlooCall };
  }
  const ids = [...new Set(envelope.results.map((item) => item?.entity_id)
    .filter((id) => typeof id === "string" && QLOO_UUID.test(id)))];
  const saved = await storeQlooResponse(identity, { result: envelope,
    providerStatus: envelope.status, resolvedEntityIds: ids,
    rights: { storage: "permitted", scope: "private" },
    collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall });
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
    const sourceDescription = item?.description ?? item?.properties?.description;
    const description = typeof sourceDescription === "string"
      ? sourceDescription.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    tags.push({ id, name, type: typeof item?.type === "string" ? item.type : null,
      affinity: Number.isFinite(item?.affinity) ? item.affinity : null,
      ...(description ? { description } : {}) });
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

// Aggregate demographic affinity is optional research for an explicitly
// selected brand pair. It is never customer overlap or a scoring input.
export async function personalQlooAudienceDemographics(ownerUserId, entityId,
  { provider = qlooCall, now = new Date() } = {}) {
  if (!QLOO_UUID.test(entityId ?? "")) throw new Error("A confirmed cultural brand identifier is required.");
  const context = { entity: entityId, entity_type: "brand", limit: 1 };
  const identity = qlooCacheIdentity({ operation: "qloo_audience_demographics", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) {
    return { results: cached.result?.results ?? [], responseId: cached.responseId,
      cacheStatus: cached.status, sampleData: cached.sampleData,
      status: cached.result?.status ?? "unavailable" };
  }
  const envelope = await provider("qloo_audience_demographics", context);
  if (envelope?.status !== "ok" || !Array.isArray(envelope.results)) return {
    results: [], responseId: null, cacheStatus: "uncached",
    sampleData: provider !== qlooCall, status: envelope?.status ?? "unavailable" };
  const saved = await storeQlooResponse(identity, { result: envelope,
    providerStatus: envelope.status, resolvedEntityIds: [entityId],
    rights: { storage: "permitted", scope: "private" }, collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall });
  return { results: envelope.results, responseId: saved.id, cacheStatus: "new",
    sampleData: provider !== qlooCall, status: "ok" };
}

// Where a brand's audience is strongest inside one country (map cells with
// query-relative affinity). Owner-private; explanation only, never a score.
export async function personalQlooWherePopular(ownerUserId, entityId, within,
  { provider = qlooCall, now = new Date(), limit = 20 } = {}) {
  if (!QLOO_UUID.test(entityId ?? "")) throw new Error("A confirmed cultural brand identifier is required.");
  if (typeof within !== "string" || within.trim().length < 2) throw new Error("A country is required.");
  // The location tool rejects more than 20 results.
  const context = { entity: entityId, entity_type: "brand", within: within.trim(),
    limit: Math.max(1, Math.min(20, Math.floor(limit))) };
  const identity = qlooCacheIdentity({ operation: "qloo_where_popular", context, ownerUserId });
  const cached = await readQlooCache(identity, { now });
  if (cached.status !== "missing" && !(cached.sampleData && provider === qlooCall)) {
    return { results: cached.result?.results ?? [], responseId: cached.responseId,
      cacheStatus: cached.status, sampleData: cached.sampleData,
      status: cached.result?.status ?? "unavailable" };
  }
  const envelope = await provider("qloo_where_popular", context);
  if (envelope?.status !== "ok" || !Array.isArray(envelope.results)) return {
    results: [], responseId: null, cacheStatus: "uncached",
    sampleData: provider !== qlooCall, status: envelope?.status ?? "unavailable" };
  const saved = await storeQlooResponse(identity, { result: envelope,
    providerStatus: envelope.status, resolvedEntityIds: [entityId],
    rights: { storage: "permitted", scope: "private" }, collectedAt: now, respondedAt: now,
    freshUntil: new Date(now.getTime() + DAY), retainUntil: new Date(now.getTime() + 7 * DAY),
    sampleData: provider !== qlooCall });
  return { results: envelope.results, responseId: saved.id, cacheStatus: "new",
    sampleData: provider !== qlooCall, status: "ok" };
}

// Resolve a selected-product cultural phrase to a real Qloo tag. The caller
// must independently validate the product quote and candidate participation.
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

// Named product-context references use the private Qloo response cache.
// Resolution alone cannot establish a cultural partnership.
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
