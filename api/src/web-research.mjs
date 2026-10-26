// Bounded Tavily research for Brand × Brand identity and external verification.
// Server-only Tavily calls; results persist in the shared private.provider_cache
// (provider 'web') so identical questions never re-spend quota within freshness.
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const RETAIN_MS = 29 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 3;
const PROJECTION_VERSION = "inspected-page-v4";
const BUSINESS_PLURAL_TERMS = new Set(["campaign", "video", "event", "store", "shop", "collection",
  "partnership", "collaboration", "journal", "workshop", "sponsor", "tour"]);
let pool;

function db() {
  if (!process.env.DATABASE_URL) throw new Error("Web research storage is not configured.");
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

function tavilyKey() {
  // The operator-selected backup is preferred when present. Both keys share
  // the same request ledger; selecting one never creates extra capacity.
  const key = process.env.TAVILY_API_KEY_2 || process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Web research is not configured.");
  return key;
}

export function tavilyCreditCapacity(usage) {
  const account = usage?.account ?? {};
  const key = usage?.key ?? {};
  const planLimit = Number(account.plan_limit);
  const planUsed = Number(account.plan_usage);
  if (!Number.isFinite(planLimit) || !Number.isFinite(planUsed) || planLimit <= 0) {
    throw new Error("Tavily account credit capacity is unavailable.");
  }
  let remaining = Math.max(0, planLimit - planUsed);
  if (key.limit != null && Number.isFinite(Number(key.limit))) {
    remaining = Math.min(remaining, Math.max(0, Number(key.limit) - Number(key.usage ?? 0)));
  }
  return remaining;
}

function reservedCredits(operation) {
  // Basic Search is 1 credit. One-URL basic Extract can cost at most 1;
  // the provider's reported actual cost replaces this reservation afterward.
  return operation === "search" || operation === "extract" ? 1 : 0;
}

async function tavilyUsage(key) {
  const response = await fetch("https://api.tavily.com/usage", {
    headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Tavily usage check failed (${response.status}).`);
  const usage = await response.json();
  tavilyCreditCapacity(usage);
  return { key: { usage: usage.key?.usage ?? null, limit: usage.key?.limit ?? null },
    account: { plan_usage: usage.account.plan_usage, plan_limit: usage.account.plan_limit } };
}

export function officialDomainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

export function isDomain(url, domain) {
  const host = officialDomainOf(url);
  const expected = String(domain ?? "").replace(/^www\./i, "").toLowerCase();
  return Boolean(host && /^[a-z0-9.-]+$/.test(expected) &&
    (host === expected || host.endsWith(`.${expected}`)));
}

export function webRequestHash(query, domains, focus = query) {
  const canonical = JSON.stringify([PROJECTION_VERSION, query, focus, [...(domains ?? [])].sort()]);
  return createHash("sha256").update(canonical).digest("hex");
}

function priorWebRequestHash(version, query, domains, focus) {
  return createHash("sha256").update(JSON.stringify([version, query, focus, [...(domains ?? [])].sort()])).digest("hex");
}

function publicPage(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") ||
        /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
        url.hostname.endsWith(".local")) return null;
    return url.toString();
  } catch { return null; }
}

function exactTermPattern(term) {
  const value = String(term ?? "").trim();
  if (value.length < 4) return null;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lexical = BUSINESS_PLURAL_TERMS.has(value.toLowerCase()) ? `${escaped}s?` : escaped;
  return new RegExp(`(^|[^a-z0-9])${lexical}(?=$|[^a-z0-9])`, "i");
}

function revalidateInspectedItem(item, focus, domains) {
  if (item?.inspected !== true || !publicPage(item.url) || !/^[a-f0-9]{64}$/.test(item.sourceHash ?? "") ||
      (domains?.length && !domains.some((domain) => isDomain(item.url, domain)))) return false;
  const pattern = exactTermPattern(focus);
  const title = String(item.title ?? "");
  const snippet = String(item.snippet ?? "");
  const finalTerm = String(focus ?? "").trim().split(/\s+/).at(-1);
  return Boolean(pattern && (pattern.test(snippet) ||
    (pattern.test(title) && exactTermPattern(finalTerm)?.test(snippet))));
}

// Search snippets are leads. Only a returned page body can support a saved
// activity/capability observation; keep a short contextual excerpt, not HTML.
export function inspectedSearchResult(item, focus) {
  const url = publicPage(item?.url);
  const raw = typeof item?.raw_content === "string" ? item.raw_content.slice(0, 120_000) : "";
  const pattern = exactTermPattern(focus);
  let hit = pattern?.exec(raw);
  if (!hit && pattern?.test(String(item?.title ?? ""))) {
    const finalTerm = String(focus).trim().split(/\s+/).at(-1);
    hit = exactTermPattern(finalTerm)?.exec(raw) ?? null;
  }
  if (!url || !raw || !hit) return null;
  const excerpt = raw.slice(Math.max(0, hit.index - 100), Math.min(raw.length, hit.index + 250)).replace(/\s+/g, " ").trim();
  return { title: String(item?.title ?? "").slice(0, 300), url, snippet: excerpt.slice(0, 500),
    inspected: true, sourceHash: createHash("sha256").update(raw).digest("hex"),
    publishedAt: item?.published_date ?? null };
}

export async function tavilySearch(query, { includeDomains } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tavilyKey()}` },
      body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: "basic",
        include_raw_content: "text", include_domains: includeDomains ?? [], include_usage: true }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Web research failed with status ${response.status}.`);
    const payload = await response.json();
    return { results: Array.isArray(payload?.results) ? payload.results : [], usage: payload?.usage ?? null };
  } finally { clearTimeout(timer); }
}

export async function tavilyExtract(url, { focus } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tavilyKey()}` },
      body: JSON.stringify({ urls: [url], query: focus, extract_depth: "basic",
        chunks_per_source: 2, format: "text", include_usage: true }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Web extraction failed with status ${response.status}.`);
    return response.json();
  } finally { clearTimeout(timer); }
}

// Reserve before the provider call. The same ledger also counts failed requests,
// since a provider may charge for a request that fails locally. Legacy Search
// cache rows count until their rolling day expires.
// The database is reached through a transaction-mode pooler, where a
// session lock can be taken on one server connection and "released" on
// another, leaving it held. Every lock here is transaction-scoped.
async function reserveWebRequest(client, operation) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtextextended('web:global-budget', 0))");
    const creditReservation = reservedCredits(operation);
    const activeKey = creditReservation ? tavilyKey() : null;
    const keyHash = activeKey ? createHash("sha256").update(activeKey).digest("hex") : null;
    if (activeKey) {
      const prior = await client.query(`select payload_json,fetched_at,fresh_until from private.provider_cache
        where provider='web' and resource_type='quota_snapshot' and resource_key=$1
          and scope='shared' limit 1`, [keyHash]);
      let snapshot = prior.rows[0];
      if (!snapshot || new Date(snapshot.fresh_until).getTime() <= Date.now()) {
        try {
          const usage = await tavilyUsage(activeKey);
          const priorPayload = snapshot?.payload_json ?? null;
          const providerUsed = Number(usage.account.plan_usage);
          const priorProviderUsed = Number(priorPayload?.lastProviderUsage ?? priorPayload?.account?.plan_usage);
          const reset = priorPayload && Number.isFinite(priorProviderUsed) && providerUsed < priorProviderUsed;
          const tracked = { ...usage,
            baselineAt: !priorPayload || reset ? new Date().toISOString()
              : priorPayload.baselineAt ?? new Date(snapshot.fetched_at).toISOString(),
            baselineUsage: !priorPayload || reset ? providerUsed
              : Number(priorPayload.baselineUsage ?? priorPayload.account.plan_usage),
            baselineKeyUsage: !priorPayload || reset ? Number(usage.key.usage ?? 0)
              : Number(priorPayload.baselineKeyUsage ?? priorPayload.key?.usage ?? 0),
            lastProviderUsage: providerUsed };
          const saved = await client.query(`insert into private.provider_cache
            (provider,resource_type,resource_key,request_hash,scope,payload_json,payload_hash,
              fetched_at,fresh_until,retain_until,last_status)
            values ('web','quota_snapshot',$1,$1,'shared',$2::jsonb,$3,now(),
              now()+interval '10 minutes',now()+interval '2 days','succeeded')
            on conflict (provider,resource_type,resource_key,request_hash) where scope='shared'
            do update set payload_json=excluded.payload_json,payload_hash=excluded.payload_hash,
              fetched_at=excluded.fetched_at,fresh_until=excluded.fresh_until,
              retain_until=excluded.retain_until,last_status='succeeded',updated_at=now()
            returning payload_json,fetched_at,fresh_until`, [keyHash, JSON.stringify(tracked),
            createHash("sha256").update(JSON.stringify(tracked)).digest("hex")]);
          snapshot = saved.rows[0];
        } catch (error) {
          if (!snapshot || Date.now() - new Date(snapshot.fetched_at).getTime() > 60 * 60 * 1000) throw error;
        }
      }
      const baselineAt = snapshot.payload_json.baselineAt ?? snapshot.fetched_at;
      const pending = await client.query(`select coalesce(sum(case
          when payload_json->>'status'='succeeded' and payload_json->>'credits' ~ '^[0-9.]+$'
            then (payload_json->>'credits')::numeric
          else coalesce((payload_json->>'reservedCredits')::numeric,0) end),0) as credits
        from private.provider_cache where provider='web' and resource_type='usage'
          and payload_json->>'keyHash'=$1 and
          (fetched_at >= $2 or payload_json->>'status'='reserved')`, [keyHash, baselineAt]);
      const payload = snapshot.payload_json;
      const localUsed = Number(pending.rows[0].credits);
      const inferredUsage = Number(payload.baselineUsage ?? payload.account.plan_usage) + localUsed;
      const inferredKeyRemaining = payload.key?.limit == null ? Infinity
        : Math.max(0, Number(payload.key.limit) -
          (Number(payload.baselineKeyUsage ?? payload.key.usage ?? 0) + localUsed));
      const remaining = Math.min(tavilyCreditCapacity(payload),
        Math.max(0, Number(payload.account.plan_limit) - inferredUsage), inferredKeyRemaining);
      if (remaining < creditReservation) throw new Error("Tavily account credits are exhausted.");
    }
    const id = randomUUID();
    const hash = createHash("sha256").update(id).digest("hex");
    const payload = { operation, credits: null, reservedCredits: creditReservation,
      keyHash, status: "reserved" };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await client.query(`insert into private.provider_cache(provider,resource_type,resource_key,request_hash,scope,
      payload_json,payload_hash,fetched_at,fresh_until,retain_until,last_status)
      values ('web','usage',$1,$2,'shared',$3::jsonb,$4,now(),now(),now()+interval '2 days','not_found')`,
    [operation, hash, JSON.stringify(payload), payloadHash]);
    await client.query("commit");
    return { hash, keyHash, reservedCredits: creditReservation };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function finishWebRequest(client, reservation, operation, usage, status) {
  const reported = usage?.credits;
  const credits = reported != null && Number.isFinite(Number(reported))
    ? Math.max(0, Number(reported)) : null;
  const payload = { operation, credits, reservedCredits: reservation.reservedCredits,
    keyHash: reservation.keyHash, status };
  await client.query(`update private.provider_cache set payload_json=$2::jsonb,
    payload_hash=$3,last_status=$4,updated_at=now()
    where provider='web' and resource_type='usage' and request_hash=$1`,
  [reservation.hash, JSON.stringify(payload),
    createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    status === "succeeded" ? "succeeded" : "not_found"]);
}

function webLeads(results, domains) {
  return results.slice(0, MAX_RESULTS).filter((item) => publicPage(item?.url) &&
    (!domains?.length || domains.some((domain) => isDomain(item.url, domain))))
    .map((item) => ({ url: publicPage(item.url), title: String(item.title ?? "").slice(0, 300),
      publishedAt: item.published_date ?? null }));
}

export function inspectedExtractResponse(response, url, focus, title = "", publishedAt = null) {
  const safeUrl = publicPage(url);
  if (!safeUrl) return [];
  return (response?.results ?? []).filter((item) => publicPage(item?.url) === safeUrl)
    .map((item) => inspectedSearchResult({ ...item, title, published_date: publishedAt }, focus)).filter(Boolean);
}

// Concurrent identical questions in this process share one request. No lock
// is held across the provider call: the shared credit budget is still
// reserved atomically, but two processes asking the same cold question at
// the same moment may each spend one credit.
const inFlight = new Map();
function sharedRequest(key, work) {
  if (!inFlight.has(key)) inFlight.set(key, work().finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

// One cached web question.
export function withWebSearch(query, { includeDomains, focus } = {}, load = tavilySearch) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
  if (!normalized) return Promise.resolve({ results: [], cacheStatus: "empty" });
  const normalizedFocus = String(focus ?? normalized.split(/\s+/).at(-1)).toLowerCase().trim();
  const hash = webRequestHash(normalized, includeDomains, normalizedFocus);
  return sharedRequest(`search:${hash}`, () => webSearch(normalized, includeDomains, normalizedFocus, hash, load));
}

async function webSearch(normalized, includeDomains, normalizedFocus, hash, load) {
  const client = await db().connect();
  try {
    const cached = await client.query(
      `select payload_json from private.provider_cache
       where provider='web' and resource_type='search' and resource_key=$1 and request_hash=$2
         and scope='shared' and last_status='succeeded' and fresh_until > now() and retain_until > now()
       limit 1`, [normalized, hash]);
    if (cached.rows.length) return { ...cached.rows[0].payload_json, cacheStatus: "fresh" };
    const priorHashes = ["inspected-page-v3", "inspected-page-v2", "inspected-page-v1"]
      .map((version) => priorWebRequestHash(version, normalized, includeDomains, normalizedFocus));
    const prior = await client.query(`select payload_json from private.provider_cache
      where provider='web' and resource_type='search' and resource_key=$1
        and request_hash=any($2::text[]) and scope='shared' and last_status='succeeded'
        and fresh_until > now() and retain_until > now()
      order by fetched_at desc limit 1`, [normalized, priorHashes]);
    if (prior.rows[0]) {
      const payload = prior.rows[0].payload_json;
      return { ...payload, results: (payload.results ?? [])
        .filter((item) => revalidateInspectedItem(item, normalizedFocus, includeDomains ?? [])),
      cacheStatus: "revalidated" };
    }
    if (load === tavilySearch) tavilyKey();
    const reservation = await reserveWebRequest(client, "search");
    let response;
    try {
      response = await load(normalized, { includeDomains });
      await finishWebRequest(client, reservation, "search", response?.usage, "succeeded");
    } catch (error) {
      await finishWebRequest(client, reservation, "search", null, "failed");
      throw error;
    }
    const results = Array.isArray(response) ? response : response?.results ?? [];
    const compact = { query: normalized, includeDomains: includeDomains ?? [],
      budgetTracked: true, usage: response?.usage ?? null,
      leads: webLeads(results, includeDomains),
      results: (Array.isArray(results) ? results : []).slice(0, MAX_RESULTS)
        .map((item) => inspectedSearchResult(item, normalizedFocus)).filter(Boolean) };
    const payloadHash = createHash("sha256").update(JSON.stringify(compact)).digest("hex");
    await client.query(
      `insert into private.provider_cache(provider,resource_type,resource_key,request_hash,scope,
         payload_json,payload_hash,fetched_at,fresh_until,retain_until,last_status)
       values ('web','search',$1,$2,'shared',$3::jsonb,$4,now(),now() + $5::interval,now() + $6::interval,'succeeded')
       on conflict (provider,resource_type,resource_key,request_hash) where scope='shared'
       do update set payload_json=excluded.payload_json,payload_hash=excluded.payload_hash,
         fetched_at=excluded.fetched_at,fresh_until=excluded.fresh_until,
         retain_until=excluded.retain_until,last_status=excluded.last_status,updated_at=now()`,
      [normalized, hash, JSON.stringify(compact), payloadHash,
        `${FRESH_MS} milliseconds`, `${RETAIN_MS} milliseconds`]);
    return { ...compact, cacheStatus: "new" };
  } finally { client.release(); }
}

// Extract only a specific, previously identified public page for an unanswered
// question. Keep a compact inspected excerpt, never a raw page body.
export function withWebExtract(url, { focus, title = "", publishedAt = null } = {}, load = tavilyExtract) {
  const safeUrl = publicPage(url);
  const term = String(focus ?? "").toLowerCase().trim();
  if (!safeUrl || !exactTermPattern(term)) return Promise.resolve({ results: [], cacheStatus: "invalid" });
  const hash = createHash("sha256").update(JSON.stringify(["extract-v1", safeUrl, term])).digest("hex");
  return sharedRequest(`extract:${hash}`, () => webExtract(safeUrl, term, title, publishedAt, hash, load));
}

async function webExtract(safeUrl, term, title, publishedAt, hash, load) {
  const client = await db().connect();
  try {
    const cached = await client.query(`select payload_json from private.provider_cache
      where provider='web' and resource_type='extract' and resource_key=$1 and request_hash=$2
        and scope='shared' and last_status='succeeded' and fresh_until>now() and retain_until>now()
      limit 1`, [safeUrl, hash]);
    if (cached.rows[0]) return { ...cached.rows[0].payload_json, cacheStatus: "fresh" };
    if (load === tavilyExtract) tavilyKey();
    const reservation = await reserveWebRequest(client, "extract");
    let response;
    try {
      response = await load(safeUrl, { focus: term });
      await finishWebRequest(client, reservation, "extract", response?.usage, "succeeded");
    } catch (error) {
      await finishWebRequest(client, reservation, "extract", null, "failed");
      throw error;
    }
    const results = inspectedExtractResponse(response, safeUrl, term, title, publishedAt);
    const compact = { url: safeUrl, focus: term, results, budgetTracked: true,
      usage: response?.usage ?? null, failed: (response?.failed_results ?? []).some((item) => item.url === safeUrl) };
    const payloadHash = createHash("sha256").update(JSON.stringify(compact)).digest("hex");
    await client.query(`insert into private.provider_cache(provider,resource_type,resource_key,request_hash,scope,
        payload_json,payload_hash,fetched_at,fresh_until,retain_until,last_status)
      values ('web','extract',$1,$2,'shared',$3::jsonb,$4,now(),now()+interval '7 days',
        now()+interval '29 days','succeeded')
      on conflict (provider,resource_type,resource_key,request_hash) where scope='shared'
      do update set payload_json=excluded.payload_json,payload_hash=excluded.payload_hash,
        fetched_at=excluded.fetched_at,fresh_until=excluded.fresh_until,
        retain_until=excluded.retain_until,last_status=excluded.last_status,updated_at=now()`,
    [safeUrl, hash, JSON.stringify(compact), payloadHash]);
    return { ...compact, cacheStatus: "new" };
  } finally { client.release(); }
}
