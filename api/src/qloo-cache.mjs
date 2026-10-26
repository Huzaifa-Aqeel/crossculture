import { createHash } from "node:crypto";
import pg from "pg";

const VERSION = "qloo-cache-v1";
const OPERATIONS = new Set(["qloo_describe", "qloo_find_tags", "qloo_recommend", "qloo_rank",
  "qloo_entity_tags", "qloo_audience_demographics", "qloo_where_popular", "qloo_audience_tags"]);
let pool;

function database() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  }
  return pool;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) { return createHash("sha256").update(stable(value)).digest("hex"); }

export function qlooCacheIdentity({ operation, context, ownerUserId }) {
  if (!OPERATIONS.has(operation) || !context || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("A supported Qloo operation and normalized context are required.");
  }
  if (typeof ownerUserId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerUserId)) {
    throw new Error("A valid owner user ID is required for Qloo caching.");
  }
  const inputHash = digest({ version: VERSION, operation, context });
  // Preserve the original private-key shape so existing owner rows stay readable.
  const cacheKey = digest({ inputHash, scope: "private", ownerUserId });
  return Object.freeze({ cacheKey, inputHash, operation, context, reuseScope: "private", ownerUserId });
}

export async function readQlooCache(identity, { now = new Date() } = {}, client = null) {
  const db = client ?? database();
  const result = await db.query(
    `select id,version,normalized_result_json,resolved_entity_ids,affinities_json,
      relationships_json,explainability_json,responded_at,collected_at,fresh_until,retain_until,
      provider_status,explainability_status,sample_data from private.qloo_responses
     where cache_key = $1 and reuse_scope = 'private' and owner_user_id = $2
       and lifecycle_status = 'active'
       and (retain_until is null or retain_until > $3)
     order by version desc limit 1`, [identity.cacheKey, identity.ownerUserId, now],
  );
  const row = result.rows[0];
  if (!row) return { status: "missing", cacheKey: identity.cacheKey };
  return { status: row.fresh_until && new Date(row.fresh_until) <= now ? "stale" : "fresh",
    cacheKey: identity.cacheKey, responseId: row.id, version: row.version,
    result: row.normalized_result_json, providerStatus: row.provider_status,
    resolvedEntityIds: row.resolved_entity_ids, affinities: row.affinities_json,
    relationships: row.relationships_json, explainability: row.explainability_json,
    explainabilityStatus: row.explainability_status, sampleData: row.sample_data, respondedAt: row.responded_at,
    collectedAt: row.collected_at,
    freshUntil: row.fresh_until, retainUntil: row.retain_until };
}

// Called only by the trusted backend after a real result and rights decision.
// It never calls Qloo and never assumes that public provider output is reusable.
export async function storeQlooResponse(identity, { result, rights, providerStatus,
  resolvedEntityIds = [], affinities = [], relationships = [], explainability = null,
  explainabilityStatus = null, collectedAt = new Date(), respondedAt = collectedAt,
  freshUntil = null, retainUntil = null, sampleData = true }, client = null) {
  if (!result || typeof result !== "object" || !rights || rights.storage !== "permitted") {
    throw new Error("A normalized Qloo result and explicit storage permission are required.");
  }
  if (identity.reuseScope !== "private" || typeof identity.ownerUserId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity.ownerUserId)) {
    throw new Error("Qloo cache entries require a user owner.");
  }
  if (!retainUntil && rights.retention_basis !== "indefinite_permitted") {
    throw new Error("A Qloo retention limit or indefinite permission is required.");
  }
  if (!Array.isArray(resolvedEntityIds) || !resolvedEntityIds.every((id) => typeof id === "string" && id.trim()) ||
      !Array.isArray(affinities) || !affinities.every((item) => item && typeof item === "object" && !Array.isArray(item)) ||
      !Array.isArray(relationships) || !relationships.every((item) => item && typeof item === "object" && !Array.isArray(item)) ||
      (explainability !== null && typeof explainability !== "object")) {
    throw new Error("Qloo projections must be validated IDs, relationship arrays, and optional explainability.");
  }
  const db = client ?? database();
  const connection = client ?? await db.connect();
  try {
    await connection.query("begin");
    await connection.query("select pg_advisory_xact_lock(hashtext($1))", [identity.cacheKey]);
    const resultHash = digest({ result, resolvedEntityIds, affinities, relationships,
      explainability, providerStatus, explainabilityStatus, sampleData });
    const existing = await connection.query(
      "select id,version,retain_until,lifecycle_status from private.qloo_responses where cache_key = $1 and result_hash = $2",
      [identity.cacheKey, resultHash],
    );
    if (existing.rows[0]) {
      const old = existing.rows[0];
      if (old.lifecycle_status === "active" && (!old.retain_until || new Date(old.retain_until) > new Date())) {
        await connection.query("commit");
        return { id: old.id, version: old.version };
      }
      const reason = old.lifecycle_status === "deletion_requested" ? "deletion_request"
        : old.lifecycle_status === "restricted" ? "source_restriction" : "retention_limit";
      await connection.query("select private.purge_qloo_response($1,$2)", [old.id, reason]);
    }
    const next = await connection.query(
      "select coalesce(max(version),0)+1 as version from private.qloo_responses where cache_key = $1",
      [identity.cacheKey],
    );
    const inserted = await connection.query(
      `insert into private.qloo_responses(cache_key,version,result_hash,input_hash,operation,
        context_json,normalized_result_json,resolved_entity_ids,affinities_json,relationships_json,
        explainability_json,rights_json,reuse_scope,owner_user_id,provider_status,
        explainability_status,responded_at,collected_at,fresh_until,retain_until,sample_data)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10::jsonb,
         $11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       returning id,version`,
      [identity.cacheKey, next.rows[0].version, resultHash, identity.inputHash, identity.operation,
        JSON.stringify(identity.context), JSON.stringify(result), resolvedEntityIds,
        JSON.stringify(affinities), JSON.stringify(relationships),
        explainability === null ? null : JSON.stringify(explainability),
        JSON.stringify(rights), "private", identity.ownerUserId,
        providerStatus, explainabilityStatus, respondedAt, collectedAt, freshUntil, retainUntil, sampleData],
    );
    await connection.query("commit");
    return inserted.rows[0];
  } catch (error) {
    await connection.query("rollback");
    throw error;
  } finally { if (!client) connection.release(); }
}

export async function purgeQlooResponse(responseId, reason, client = null) {
  const db = client ?? database();
  const result = await db.query("select private.purge_qloo_response($1,$2) as purged", [responseId, reason]);
  return result.rows[0].purged;
}

export async function purgeDueQlooResponses(limit = 100, client = null) {
  const db = client ?? database();
  const result = await db.query("select private.purge_due_qloo_responses($1) as purged", [limit]);
  return result.rows[0].purged;
}
