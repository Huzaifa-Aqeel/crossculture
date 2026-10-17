import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = new Set(["catalog_item", "personal_item", "qloo_response"]);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") ||
        /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.endsWith(".local")) {
      throw new Error("Invalid source URL.");
    }
    return url.toString();
  } catch { throw new Error("Source URL must be a public HTTPS page."); }
}

function activeRights(row, { userId, now, scope = null, ownerUserId = null, sampleData = false, retainUntil = null }) {
  if (row?.lifecycle_status && row.lifecycle_status !== "active") throw new Error("Source is restricted or removed.");
  if (sampleData || row?.sample_data) throw new Error("Sample data cannot support a real assessment.");
  if (row?.rights_json?.storage !== "permitted") throw new Error("Source storage is not permitted.");
  if (retainUntil && new Date(retainUntil) <= now) throw new Error("Source retention has expired.");
  if (scope === "private" && ownerUserId !== userId) throw new Error("Source belongs to another user.");
  if (scope === "global" && row?.rights_json?.cross_user_reuse !== "permitted") throw new Error("Cross-user source reuse is not permitted.");
}

function freshness(until, now) { return until && new Date(until) <= now ? "stale" : "current"; }

async function resolveSource(db, ref, { userId, allowedEntityIds, qlooInputHashes, now }) {
  if (ref.kind === "personal_item") {
    if (!UUID.test(ref.id ?? "")) throw new Error("Invalid source reference.");
    const result = await db.query(`select id,user_id,entity_id,source_type,source_url,title,published_at,
      collected_at,fresh_until,retain_until,rights_json,external_item_id,request_hash,
      metadata_observations_json from public.source_items where id=$1`, [ref.id]);
    const row = result.rows[0];
    if (!row || !allowedEntityIds.includes(row.entity_id)) throw new Error("Source does not belong to this pair.");
    activeRights(row, { userId, now, scope: "private", ownerUserId: row.user_id, retainUntil: row.retain_until });
    return { id: `personal:${row.id}`, kind: "personal_item", title: row.title,
      sourceUrl: validUrl(row.source_url), excerpt: row.title, observedAt: row.published_at,
      collectedAt: row.collected_at, freshness: freshness(row.fresh_until, now),
      sourceRole: row.metadata_observations_json?.sourceRole === "discovery_hit" ? "discovery_hit" : "representative_sample",
      videoId: row.external_item_id, requestHash: row.request_hash,
      ...(typeof row.metadata_observations_json?.direction === "string" ? {
        discoveryDirection: row.metadata_observations_json.direction } : {}),
      ...(typeof row.metadata_observations_json?.discoveryHit?.direction === "string" ? {
        discoveryDirection: row.metadata_observations_json.discoveryHit.direction,
        discoveryRequestHash: row.metadata_observations_json.discoveryHit.requestHash } : {}),
      entityId: row.entity_id, sourceRef: { kind: "personal_item", id: row.id } };
  }
  if (ref.kind === "catalog_item") {
    if (!UUID.test(ref.id ?? "")) throw new Error("Invalid source reference.");
    const result = await db.query(`select id,entity_id,platform,source_type,source_url,published_at,collected_at,
      expires_at,fresh_until,excerpt,rights_json,sample_data
      from catalog.source_items where id=$1`, [ref.id]);
    const row = result.rows[0];
    if (!row || !allowedEntityIds.includes(row.entity_id)) throw new Error("Source does not belong to this pair.");
    activeRights(row, { userId, now, scope: "global", sampleData: row.sample_data, retainUntil: row.expires_at });
      return { id: `catalog:${row.id}`, kind: "catalog_item", title: row.source_type,
      sourceUrl: validUrl(row.source_url), excerpt: String(row.excerpt ?? "").slice(0, 1000),
      observedAt: row.published_at, collectedAt: row.collected_at,
      freshness: freshness(row.fresh_until, now), contentHash: row.rights_json?.source_hash ?? null, entityId: row.entity_id,
      sourceRef: { kind: "catalog_item", id: row.id } };
  }
  if (ref.kind === "qloo_response") {
    if (!UUID.test(ref.id ?? "")) throw new Error("Invalid source reference.");
    const result = await db.query(`select id,operation,input_hash,responded_at,collected_at,fresh_until,retain_until,
      rights_json,reuse_scope,owner_user_id,lifecycle_status,sample_data from private.qloo_responses where id=$1`, [ref.id]);
    const row = result.rows[0];
    if (!row) throw new Error("Cultural relationship source is unavailable.");
    if (row.reuse_scope !== "private" || row.owner_user_id !== userId) {
      throw new Error("Cultural relationship source belongs to another user.");
    }
    if (!qlooInputHashes.includes(row.input_hash)) throw new Error("Cultural relationship source does not match this research context.");
    activeRights(row, { userId, now, scope: "private", ownerUserId: row.owner_user_id,
      sampleData: row.sample_data, retainUntil: row.retain_until });
    return { id: `qloo:${row.id}`, kind: "qloo_response", title: "Cultural relationship analysis",
      sourceUrl: null, excerpt: "", observedAt: row.responded_at, collectedAt: row.collected_at,
      freshness: freshness(row.fresh_until, now), entityId: null,
      sourceRef: { kind: "qloo_response", id: row.id }, qlooResponseId: row.id };
  }
  throw new Error("Unsupported source reference.");
}

function canonicalClaims(claims, sourceIds) {
  if (!Array.isArray(claims) || claims.length > 30) throw new Error("Evidence claims must be a bounded list.");
  const seen = new Set();
  return claims.map((claim) => {
    if (!claim || typeof claim.id !== "string" || !/^[a-z0-9:_-]{3,100}$/i.test(claim.id) || seen.has(claim.id) ||
        !["observation", "inference"].includes(claim.kind) || typeof claim.text !== "string" ||
        claim.text.trim().length < 8 || claim.text.length > 500 || !Array.isArray(claim.sourceIds) ||
        claim.sourceIds.length < 1 || claim.sourceIds.length > 5 ||
        !claim.sourceIds.every((id) => sourceIds.has(id)) || new Set(claim.sourceIds).size !== claim.sourceIds.length) {
      throw new Error("Each positive claim needs a distinct valid source reference.");
    }
    seen.add(claim.id);
    return { id: claim.id, kind: claim.kind, text: claim.text.trim(), sourceIds: [...claim.sourceIds] };
  });
}

const SLUG = /^[a-z0-9:_-]{3,100}$/i;

function canonicalBridges(bridges, sourceIds) {
  if (!Array.isArray(bridges) || bridges.length > 8) throw new Error("Cultural bridges must be a bounded list.");
  const seen = new Set();
  return bridges.map((bridge) => {
    if (!bridge || !SLUG.test(bridge.id ?? "") || seen.has(bridge.id) ||
        typeof bridge.name !== "string" || bridge.name.trim().length < 2 || bridge.name.length > 160 ||
        typeof bridge.qlooTagId !== "string" || !bridge.qlooTagId.trim() ||
        (bridge.family !== null && typeof bridge.family !== "string") ||
        !["broad", "named"].includes(bridge.specificity) ||
        (bridge.classification != null && !["direct", "cross_category"].includes(bridge.classification)) ||
        !Array.isArray(bridge.qlooSourceIds) || bridge.qlooSourceIds.length < 1 || bridge.qlooSourceIds.length > 4 ||
        !bridge.qlooSourceIds.every((id) => typeof id === "string" && id.startsWith("qloo:") && sourceIds.has(id)) ||
        new Set(bridge.qlooSourceIds).size !== bridge.qlooSourceIds.length ||
        !Array.isArray(bridge.partnerSourceIds) || bridge.partnerSourceIds.length > 5 ||
        !bridge.partnerSourceIds.every((id) => sourceIds.has(id)) ||
        typeof bridge.explainabilityBacked !== "boolean") {
      throw new Error("Each cultural bridge needs a validated tag and Qloo source references.");
    }
    seen.add(bridge.id);
    return { id: bridge.id, name: bridge.name.trim(), qlooTagId: bridge.qlooTagId.trim(),
      family: bridge.family ?? null, specificity: bridge.specificity,
      classification: bridge.classification ?? null,
      qlooSourceIds: [...bridge.qlooSourceIds], partnerSourceIds: [...bridge.partnerSourceIds],
      explainabilityBacked: bridge.explainabilityBacked };
  });
}

function canonicalActivity(activity, sourceIds, bridgeIds) {
  if (!Array.isArray(activity) || activity.length > 20) throw new Error("Partner activity must be a bounded list.");
  const seen = new Set();
  return activity.map((item) => {
    if (!item || !SLUG.test(item.id ?? "") || seen.has(item.id) ||
        typeof item.summary !== "string" || item.summary.trim().length < 8 || item.summary.length > 500 ||
        !["central", "substantive", "incidental", "contradictory", "unknown"].includes(item.centrality) ||
        typeof item.firstParty !== "boolean" ||
        (item.projectKey != null && (typeof item.projectKey !== "string" || item.projectKey.length > 240)) ||
        (item.projectVerified != null && typeof item.projectVerified !== "boolean") ||
        !Array.isArray(item.bridgeIds) || !item.bridgeIds.every((id) => bridgeIds.has(id)) ||
        !Array.isArray(item.sourceIds) || item.sourceIds.length < 1 || item.sourceIds.length > 5 ||
        !item.sourceIds.every((id) => sourceIds.has(id))) {
      throw new Error("Each partner activity needs a summary, centrality and valid source references.");
    }
    seen.add(item.id);
    return { id: item.id, summary: item.summary.trim(), centrality: item.centrality,
      firstParty: item.firstParty, bridgeIds: [...item.bridgeIds], sourceIds: [...item.sourceIds],
      projectKey: item.projectKey ?? null, projectVerified: item.projectVerified === true };
  });
}

function canonicalCapabilities(capabilities, sourceIds) {
  if (!Array.isArray(capabilities) || capabilities.length > 12) throw new Error("Capabilities must be a bounded list.");
  const seen = new Set();
  return capabilities.map((capability) => {
    if (!capability || !SLUG.test(capability.id ?? "") || seen.has(capability.id) ||
        typeof capability.name !== "string" || capability.name.trim().length < 2 || capability.name.length > 120 ||
        !["direct", "transferable", "unsupported", "contradicted"].includes(capability.status) ||
        !Array.isArray(capability.sourceIds) || capability.sourceIds.length > 5 ||
        !capability.sourceIds.every((id) => sourceIds.has(id)) ||
        (capability.sourceIds.length === 0 && ["direct", "transferable"].includes(capability.status))) {
      throw new Error("Each capability needs a status and valid source references.");
    }
    seen.add(capability.id);
    return { id: capability.id, name: capability.name.trim(), status: capability.status,
      sourceIds: [...capability.sourceIds] };
  });
}

function canonicalConstraints(constraints, sourceIds) {
  if (!Array.isArray(constraints) || constraints.length > 10) throw new Error("Constraints must be a bounded list.");
  const seen = new Set();
  return constraints.map((constraint) => {
    if (!constraint || !SLUG.test(constraint.id ?? "") || seen.has(constraint.id) ||
        typeof constraint.text !== "string" || !constraint.text.trim() || constraint.text.length > 160 ||
        !["user", "verified"].includes(constraint.kind) || typeof constraint.blocking !== "boolean" ||
        !Array.isArray(constraint.sourceIds ?? []) ||
        !(constraint.sourceIds ?? []).every((id) => sourceIds.has(id)) ||
        (constraint.kind === "verified" && !(constraint.sourceIds ?? []).length)) {
      throw new Error("Each constraint needs text, a kind and a blocking flag.");
    }
    seen.add(constraint.id);
    return { id: constraint.id, text: constraint.text.trim(), kind: constraint.kind,
      blocking: constraint.blocking, sourceIds: [...(constraint.sourceIds ?? [])] };
  });
}

export async function freezeEvidenceInput({ userId, seedEntityId, partnerEntityId, objective,
  sample = false, sourceRefs = [], claims = [], unknowns = [], qlooInputHashes = [],
  bridges = null, partnerActivity = null, capabilities = null, constraints = null,
  creatorSample = null }, db = null, now = new Date()) {
  if (!UUID.test(seedEntityId ?? "") || !UUID.test(partnerEntityId ?? "") || seedEntityId === partnerEntityId ||
      typeof objective !== "string" || objective.length > 80 || !Array.isArray(sourceRefs) || sourceRefs.length > 28 ||
      !Array.isArray(unknowns) || unknowns.length > 20 || !unknowns.every((item) => typeof item === "string" && item.length <= 160) ||
      !Array.isArray(qlooInputHashes) || !qlooInputHashes.every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Evidence input is incomplete or too large.");
  }
  if (!sample && (!UUID.test(userId ?? "") || !db)) throw new Error("Real evidence requires a user and database validation.");
  if (sample && sourceRefs.some((ref) => ref.kind !== "sample_fixture")) throw new Error("Sample and real sources cannot be mixed.");
  if (!sample && sourceRefs.some((ref) => !SOURCE_KINDS.has(ref.kind))) throw new Error("Unsupported source reference.");
  const sources = [];
  for (const ref of sourceRefs) {
    if (sample) {
      if (typeof ref.id !== "string" || !/^sample-[a-z0-9-]{3,100}$/.test(ref.id) ||
          typeof ref.title !== "string" || !ref.title.startsWith("SAMPLE:") ||
          typeof ref.excerpt !== "string" || ref.excerpt.length > 1000 || ref.sourceUrl) {
        throw new Error("Invalid sample source.");
      }
      sources.push({ id: `fixture:${ref.id}`, kind: "sample_fixture", title: ref.title,
        excerpt: ref.excerpt, sourceUrl: null, observedAt: null, collectedAt: now.toISOString(),
        freshness: "sample", entityId: partnerEntityId, sourceRef: { kind: "sample_fixture", id: ref.id } });
    } else sources.push(await resolveSource(db, ref, { userId, allowedEntityIds: [seedEntityId, partnerEntityId], qlooInputHashes, now }));
  }
  const ids = new Set(sources.map((source) => source.id));
  if (ids.size !== sources.length) throw new Error("Duplicate source references are not allowed.");
  const normalizedClaims = canonicalClaims(claims, ids);
  const qlooResponseIds = [...new Set(sources.map((source) => source.qlooResponseId).filter(Boolean))].sort();
  const hasV2 = bridges !== null || partnerActivity !== null || capabilities !== null || constraints !== null;
  const normalizedBridges = hasV2 ? canonicalBridges(bridges ?? [], ids) : null;
  const bridgeIds = new Set((normalizedBridges ?? []).map((bridge) => bridge.id));
  if (creatorSample && (!Array.isArray(creatorSample.sourceIds) || !Array.isArray(creatorSample.videoIds) ||
      creatorSample.sourceIds.length !== creatorSample.videoIds.length || creatorSample.sourceIds.length > 20 ||
      new Set(creatorSample.sourceIds).size !== creatorSample.sourceIds.length ||
      !creatorSample.sourceIds.every((id) => ids.has(id) && id.startsWith("personal:")) ||
      !creatorSample.videoIds.every((id) => /^[A-Za-z0-9_-]{11}$/.test(id)) ||
      typeof creatorSample.complete !== "boolean" || !Number.isFinite(Date.parse(creatorSample.collectedAt)))) {
    throw new Error("Creator sample must reference distinct frozen video sources.");
  }
  const evidence = hasV2
    ? { contractVersion: 2, sample, sources, claims: normalizedClaims, unknowns: [...unknowns],
      bridges: normalizedBridges,
      partnerActivity: canonicalActivity(partnerActivity ?? [], ids, bridgeIds),
      capabilities: canonicalCapabilities(capabilities ?? [], ids),
      constraints: canonicalConstraints(constraints ?? [], ids),
      ...(creatorSample ? { creatorSample: { sourceIds: [...creatorSample.sourceIds],
        videoIds: [...creatorSample.videoIds], collectedAt: creatorSample.collectedAt,
        complete: creatorSample.complete } } : {}) }
    : { contractVersion: 1, sample, sources, claims: normalizedClaims, unknowns: [...unknowns] };
  const sourceRefsJson = sources.map((source) => source.sourceRef);
  const inputHash = createHash("sha256").update(stable({ seedEntityId, partnerEntityId, objective, evidence,
    qlooResponseIds })).digest("hex");
  return { evidence, sourceRefsJson, qlooResponseIds, inputHash };
}

export async function samplePreviewEvidence({ userId, seedEntityId, partnerEntityId, objective, variant, now = new Date() }) {
  if (!["brand", "creator"].includes(variant)) throw new Error("Unknown sample partner type.");
  const fixture = JSON.parse(await readFile(new URL("../fixtures/personal-preview-evidence.json", import.meta.url), "utf8"));
  if (fixture.kind !== "synthetic-mock") throw new Error("Invalid sample evidence fixture.");
  return freezeEvidenceInput({ userId, seedEntityId, partnerEntityId, objective, sample: true,
    sourceRefs: fixture[variant].sources.map((item) => ({ ...item, kind: "sample_fixture" })),
    claims: fixture[variant].claims,
    unknowns: ["Cultural connection", "Audience overlap", "Partner interest", "Commercial feasibility"] }, null, now);
}
