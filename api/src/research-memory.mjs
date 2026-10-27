import { createHash } from "node:crypto";
import pg from "pg";
import { taxonomyCategory, similarCategory } from "./product-taxonomy.mjs";

// Shared research memory. Earlier runs record the app's own decisions about a
// partner store: a lasting identity failure, whether its catalog added value to
// a similar starting product, and each assessed pair's verdict. Rows carry no
// user, no starting brand and no Catalog content; categories are public Shopify
// taxonomy IDs. Memory only orders and skips research for partners already in
// the user's own Qloo results; every opportunity is still verified live.

export { taxonomyCategory, similarCategory };
export const MEMORY_VERSION = "research-memory-v1";
const MEMORY_DAYS = 90;
const IDENTITY_FAILURE_MS = 7 * 24 * 60 * 60 * 1000;
const SCREEN_HOURS = 6;
const RETENTION_DAYS = 180;
const REJECTION_DAYS = 7;
// Identity failures that repeat on every attempt, including a domain that
// does not exist (EBUSY is how Lambda reports one). Anything else in a trace
// (network errors, timeouts, HTTP 403/429/5xx, an unavailable search) can
// clear, so a failure containing one is never remembered.
const LASTING_IDENTITY_FAILURES = new Set(["site_name_mismatch", "not_html", "website_missing",
  "website_invalid", "website_not_https", "storefront_not_found", "storefront_proof_mismatch",
  "catalog_search_missing", "shop_id_missing", "endpoint_host_unrelated", "endpoint_invalid",
  "official_website_needed", "no_brand_site_result", "top_result_not_verified",
  "http_404", "http_410", "non_public_address", "redirect_loop", "redirect_limit", "redirect_invalid",
  "network_enotfound", "network_ebusy"]);
// Partner research stopped by a shared limit says nothing about the partner.
const INTERRUPTED = new Set(["research_time_limit_reached", "catalog_rate_limited",
  "catalog_budget_reached", "catalog_unavailable"]);

let pool;
const database = () => pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL,
  max: 2, idleTimeoutMillis: 10_000 });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Same key as the saved match, so a pair's verdicts can be compared across runs.
export function opportunityKeyFor(objective, references) {
  return digest([objective, references?.seed?.productId, references?.seed?.variantId,
    references?.seed?.sellerId, references?.partner?.productId, references?.partner?.variantId,
    references?.partner?.sellerId]);
}

// The same two products whatever colour or size was selected: a user's "Not
// a fit" is about the products, so it also covers their other variants.
export function productPairKeyFor(objective, references) {
  return digest(["product-pair", objective, references?.seed?.productId, references?.seed?.sellerId,
    references?.partner?.productId, references?.partner?.sellerId]);
}

export function screenKeyFor({ objective, productId, variantId, shopId, occasion = "", preferences = [] }) {
  return digest([objective, productId, variantId, shopId, occasion, preferences.join("|")]);
}

export function lastingIdentityFailure(trace) {
  const reasons = (trace ?? []).map((item) => item?.reason)
    .filter((reason) => typeof reason === "string" && !/^redirect_\d{3}$/.test(reason));
  return reasons.length && reasons.every((reason) => LASTING_IDENTITY_FAILURES.has(reason))
    ? reasons.at(-1) : null;
}

// Per partner: proven (Supported pairs for a similar starting category),
// unpromising (researched twice for one with nothing recommendable), or
// unknown; plus a recent lasting identity failure, unless a later run verified it.
export function partnerMemoryTiers(rows, heroCategory, now = Date.now()) {
  const tiers = new Map();
  const newestFirst = [...rows].sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt));
  for (const row of newestFirst) {
    const entry = tiers.get(row.partnerQlooId) ?? { supported: 0, recommendable: 0, researched: 0,
      identityFailure: null, verifiedSince: false };
    tiers.set(row.partnerQlooId, entry);
    if (row.outcome === "identity_unverified") {
      if (!entry.verifiedSince && now - new Date(row.observedAt) < IDENTITY_FAILURE_MS) {
        entry.identityFailure ??= row.identityReason;
      }
      continue;
    }
    entry.verifiedSince = true;
    if (!similarCategory(row.heroCategory, heroCategory)) continue;
    if (row.outcome === "researched" || row.outcome === "no_product_value") entry.researched += 1;
    entry.supported += row.supportedCount ?? 0;
    entry.recommendable += row.recommendableCount ?? 0;
  }
  for (const entry of tiers.values()) {
    entry.tier = entry.supported > 0 ? "proven"
      : entry.researched >= 2 && entry.recommendable === 0 ? "unpromising" : "unknown";
  }
  return tiers;
}

// Proven partners first (most Supported first), unpromising last, the rest in
// the given order. At most two proven partners run before an unexplored one,
// so early results cannot crowd out new partners. Leads with a recent lasting
// identity failure are skipped unless a verified website is already known.
export function orderLeadsWithMemory(leads, tiers) {
  const skipped = leads.filter((lead) => tiers.get(lead.qlooId)?.identityFailure &&
    lead.websiteSource !== "verified_record");
  const usable = leads.filter((lead) => !skipped.includes(lead));
  const tierOf = (lead) => tiers.get(lead.qlooId)?.tier ?? "unknown";
  const proven = usable.filter((lead) => tierOf(lead) === "proven")
    .sort((a, b) => tiers.get(b.qlooId).supported - tiers.get(a.qlooId).supported);
  const unknown = usable.filter((lead) => tierOf(lead) === "unknown");
  const ordered = [];
  while (proven.length || unknown.length) {
    ordered.push(...proven.splice(0, 2));
    if (unknown.length) ordered.push(unknown.shift());
    if (!proven.length) ordered.push(...unknown.splice(0));
  }
  ordered.push(...usable.filter((lead) => tierOf(lead) === "unpromising"));
  return { ordered, skipped };
}

// Rows to record from a finished run's partner candidates.
export function memoryRowsFromRun({ objective, market, candidates }) {
  const rows = [];
  for (const candidate of candidates ?? []) {
    if (!candidate?.qlooId) continue;
    // A reused screen decision is recorded once, when it was made, so its
    // six-hour window does not renew and one decision is not counted twice.
    const screen = candidate.memory?.screen?.reused ? null : candidate.memory?.screen;
    if (candidate.status === "no_product_value" && candidate.memory?.screen?.reused) continue;
    const base = { objective, market, partnerQlooId: candidate.qlooId,
      partnerShopId: candidate.memory?.partnerShopId ?? null,
      heroCategory: candidate.memory?.heroCategory ?? null,
      screenKey: screen?.key ?? null, screenAddsValue: screen?.addsValue ?? null,
      assessedCount: candidate.assessedCount ?? 0, recommendableCount: candidate.recommendableCount ?? 0,
      supportedCount: candidate.memory?.pairs?.filter((pair) => pair.status === "supported").length ?? 0,
      catalogCalls: candidate.catalogCallsUsed ?? 0,
      // Product identifiers travel with each pair for review sampling only;
      // memory keeps the hashed key and verdict fields.
      pairs: (candidate.memory?.pairs ?? []).map(({ opportunityKey, partnerCategory, status,
        mechanismState, reasonCodes, judge, references }) => ({ opportunityKey, partnerCategory, status,
        mechanismState, reasonCodes, judge,
        // A Supported pair's partner product is re-checked first next time.
        partnerProductId: status === "supported" && /^gid:\/\/shopify\/Product\/\d+$/
          .test(references?.partner?.productId ?? "") ? references.partner.productId : null })) };
    if (candidate.status === "identity_unverified") {
      const reason = lastingIdentityFailure(candidate.identityDiagnostics);
      if (reason) rows.push({ ...base, outcome: "identity_unverified", identityReason: reason, pairs: [] });
      continue;
    }
    // A partner sold for another wearer says nothing about other starting products.
    if (candidate.coverageIssues?.includes("partner_wearer_mismatch")) continue;
    if (candidate.status === "no_product_value") rows.push({ ...base, outcome: "no_product_value" });
    else if (!candidate.memory) continue;
    else if (INTERRUPTED.has(candidate.stopReason) && !base.recommendableCount) {
      rows.push({ ...base, outcome: "incomplete" });
    } else rows.push({ ...base, outcome: "researched" });
  }
  return rows;
}

export async function recallPartnerMemory({ qlooIds, objective, market }) {
  if (!process.env.DATABASE_URL || !qlooIds?.length) return [];
  const result = await database().query(`select partner_qloo_id as "partnerQlooId",
      observed_at as "observedAt",hero_category as "heroCategory",outcome,
      identity_reason as "identityReason",recommendable_count as "recommendableCount",
      supported_count as "supportedCount"
    from private.partner_research_outcomes
    where partner_qloo_id=any($1::text[]) and objective=$2 and market=$3
      and observed_at>now()-make_interval(days=>$4)
    order by observed_at desc limit 500`, [qlooIds, objective, market, MEMORY_DAYS]);
  return result.rows;
}

export async function recallScreenDecision(key) {
  if (!process.env.DATABASE_URL || !key) return null;
  const result = await database().query(`select screen_adds_value as "addsValue"
    from private.partner_research_outcomes
    where screen_key=$1 and screen_adds_value is not null
      and observed_at>now()-make_interval(hours=>$2)
    order by observed_at desc limit 1`, [key, SCREEN_HOURS]);
  return typeof result.rows[0]?.addsValue === "boolean" ? result.rows[0].addsValue : null;
}

// Exact pairs the same judge (model and prompts) rejected within the last
// week: the product mechanism was judged and not supported. Such a pair is not
// judged again until the verdict expires. Pairs whose mechanism was supported
// are always re-assessed, since live offers and stock change.
export async function recallJudgedRejections(opportunityKeys, judge) {
  if (!process.env.DATABASE_URL || !opportunityKeys?.length || !judge) return new Set();
  const result = await database().query(`select distinct on (p.opportunity_key)
      p.opportunity_key as key, p.mechanism_state as state
    from private.pair_research_outcomes p
    join private.partner_research_outcomes o on o.id=p.partner_outcome_id
    where p.opportunity_key=any($1::text[]) and p.model=$2
      and o.observed_at>now()-make_interval(days=>$3)
    order by p.opportunity_key, o.observed_at desc`, [opportunityKeys, judge, REJECTION_DAYS]);
  return new Set(result.rows.filter((row) => row.state !== "supported").map((row) => row.key));
}

// Partner products that formed Supported pairs for a similar starting product
// (first three taxonomy levels) in the last 90 days, most recent first.
export async function recallProvenProducts({ partnerQlooId, objective, heroCategory, limit = 4 }) {
  if (!process.env.DATABASE_URL || !partnerQlooId || !heroCategory) return [];
  const result = await database().query(`select p.partner_product_id as id, o.hero_category as "heroCategory"
    from private.pair_research_outcomes p
    join private.partner_research_outcomes o on o.id=p.partner_outcome_id
    where o.partner_qloo_id=$1 and o.objective=$2 and p.partner_product_id is not null
      and p.status='supported' and o.observed_at>now()-make_interval(days=>$3)
    order by o.observed_at desc limit 50`, [partnerQlooId, objective, MEMORY_DAYS]);
  return [...new Set(result.rows.filter((row) => similarCategory(row.heroCategory, heroCategory))
    .map((row) => row.id))].slice(0, limit);
}

export async function recordResearchMemory(rows) {
  if (!process.env.DATABASE_URL || !rows?.length) return 0;
  const connection = await database().connect();
  try {
    await connection.query("begin");
    for (const row of rows) {
      const partner = await connection.query(`insert into private.partner_research_outcomes
        (objective,market,partner_qloo_id,partner_shop_id,hero_category,outcome,identity_reason,
         screen_key,screen_adds_value,assessed_count,recommendable_count,supported_count,
         catalog_calls,memory_version)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [row.objective, row.market, row.partnerQlooId, row.partnerShopId, row.heroCategory,
        row.outcome, row.identityReason ?? null, row.screenKey, row.screenAddsValue,
        row.assessedCount, row.recommendableCount, row.supportedCount, row.catalogCalls, MEMORY_VERSION]);
      for (const pair of row.pairs) {
        await connection.query(`insert into private.pair_research_outcomes
          (partner_outcome_id,opportunity_key,partner_category,status,mechanism_state,reason_codes,model,partner_product_id)
          values ($1,$2,$3,$4,$5,$6::text[],$7,$8)`, [partner.rows[0].id, pair.opportunityKey,
          pair.partnerCategory, pair.status, pair.mechanismState,
          (pair.reasonCodes ?? []).slice(0, 12), pair.judge ?? null, pair.partnerProductId ?? null]);
      }
    }
    await connection.query(`delete from private.partner_research_outcomes
      where observed_at<now()-make_interval(days=>$1)`, [RETENTION_DAYS]);
    await connection.query("commit");
    return rows.length;
  } catch (error) { await connection.query("rollback"); throw error; }
  finally { connection.release(); }
}
