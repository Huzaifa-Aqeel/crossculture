// Bounded, cached public web research for Brand × Brand evidence (FR §4.3).
// Server-only Tavily calls; results persist in the shared private.provider_cache
// (provider 'web') so identical questions never re-spend quota within freshness.
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const RETAIN_MS = 29 * 24 * 60 * 60 * 1000;
const DAILY_WEB_LIMIT = 50; // Shared Search + Extract request guard.
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

export function officialDomainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
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
async function reserveWebRequest(client, operation) {
  await client.query("select pg_advisory_lock(hashtextextended('web:global-budget', 0))");
  try {
    const used = await client.query(`select count(*)::integer as used from private.provider_cache
      where provider='web' and fetched_at > now() - interval '1 day'
        and (resource_type='usage' or (resource_type='search' and last_status='succeeded'
          and not (payload_json ? 'budgetTracked')))`);
    if (used.rows[0].used >= DAILY_WEB_LIMIT) throw new Error("Web research has reached its daily provider limit.");
    const id = randomUUID();
    const hash = createHash("sha256").update(id).digest("hex");
    const payload = { operation, credits: null, status: "reserved" };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await client.query(`insert into private.provider_cache(provider,resource_type,resource_key,request_hash,scope,
      payload_json,payload_hash,fetched_at,fresh_until,retain_until,last_status)
      values ('web','usage',$1,$2,'shared',$3::jsonb,$4,now(),now(),now()+interval '2 days','not_found')`,
    [operation, hash, JSON.stringify(payload), payloadHash]);
    return hash;
  } finally { await client.query("select pg_advisory_unlock(hashtextextended('web:global-budget', 0))"); }
}

async function finishWebRequest(client, hash, operation, usage, status) {
  const credits = Number.isFinite(Number(usage?.credits)) ? Number(usage.credits) : null;
  await client.query(`update private.provider_cache set payload_json=$2::jsonb,
    payload_hash=$3,last_status=$4,updated_at=now()
    where provider='web' and resource_type='usage' and request_hash=$1`,
  [hash, JSON.stringify({ operation, credits, status }),
    createHash("sha256").update(JSON.stringify({ operation, credits, status })).digest("hex"),
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

// One cached web question. The per-key advisory lock spans the provider call so two
// processes never spend quota on the same cold query.
export async function withWebSearch(query, { includeDomains, focus } = {}, load = tavilySearch) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
  if (!normalized) return { results: [], cacheStatus: "empty" };
  const normalizedFocus = String(focus ?? normalized.split(/\s+/).at(-1)).toLowerCase().trim();
  const hash = webRequestHash(normalized, includeDomains, normalizedFocus);
  const client = await db().connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [`web:${hash}`]);
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
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`web:${hash}`]); }
    finally { client.release(); }
  }
}

// Extract only a specific, previously identified public page for an unanswered
// question. Keep a compact inspected excerpt, never a raw page body.
export async function withWebExtract(url, { focus, title = "", publishedAt = null } = {}, load = tavilyExtract) {
  const safeUrl = publicPage(url);
  const term = String(focus ?? "").toLowerCase().trim();
  if (!safeUrl || !exactTermPattern(term)) return { results: [], cacheStatus: "invalid" };
  const hash = createHash("sha256").update(JSON.stringify(["extract-v1", safeUrl, term])).digest("hex");
  const client = await db().connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [`web:${hash}`]);
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
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`web:${hash}`]); }
    finally { client.release(); }
  }
}

function htmlText(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/gi, "'").replace(/\s+/g, " ").trim();
}

export function inspectedPageLinks(html, url, focus) {
  const raw = String(html ?? "").slice(0, 1_000_000);
  const title = htmlText(raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const readable = htmlText(raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " "));
  if (!publicPage(url) || !exactTermPattern(focus)?.test(readable)) return null;
  const links = [...raw.matchAll(/<a\b([^>]{0,2000})>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
      let target;
      try { target = publicPage(new URL(href, url).toString()); } catch { target = null; }
      return { label: htmlText(match[2]).slice(0, 100), url: target };
    }).filter((link) => {
      if (!link.url || !link.label) return false;
      const target = new URL(link.url);
      const name = String(focus).toLowerCase().replace(/[^a-z0-9]/g, "");
      const host = target.hostname.replace(/^www\./, "").toLowerCase();
      return (host === "youtube.com" && /^\/channel\/UC[A-Za-z0-9_-]{22}$/.test(target.pathname)) ||
        (host === "linktr.ee" && target.pathname.slice(1).toLowerCase() === name) ||
        (host.split(".")[0].replace(/[^a-z0-9]/g, "") === name);
    }).slice(0, 40);
  const hit = exactTermPattern(focus).exec(readable);
  return { url: publicPage(url), title: title.slice(0, 300),
    snippet: readable.slice(Math.max(0, hit.index - 100), hit.index + 300).slice(0, 500),
    inspected: true, sourceHash: createHash("sha256").update(raw).digest("hex"),
    publishedAt: null, outboundLinks: links };
}

async function fetchIdentityPage(url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000),
    headers: { accept: "text/html" } });
  if (!response.ok || !String(response.headers.get("content-type") ?? "").includes("text/html"))
    throw new Error("Identity page was unavailable or redirected.");
  const length = Number(response.headers.get("content-length"));
  if (length > 1_000_000) throw new Error("Identity page is too large.");
  const html = await response.text();
  if (html.length > 1_000_000) throw new Error("Identity page is too large.");
  return html;
}

// Inspect only a preselected personal site or Linktree page for identity links.
// Uses the existing shared cache and request ledger; never follows redirects.
export async function withWebIdentityLinks(url, { focus } = {}, load = fetchIdentityPage) {
  const safeUrl = publicPage(url);
  const term = String(focus ?? "").trim().toLowerCase();
  if (!safeUrl || !exactTermPattern(term)) return { results: [], cacheStatus: "invalid" };
  const hash = createHash("sha256").update(JSON.stringify(["identity-links-v1", safeUrl, term])).digest("hex");
  const client = await db().connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [`web:${hash}`]);
    const cached = await client.query(`select payload_json from private.provider_cache
      where provider='web' and resource_type='extract' and resource_key=$1 and request_hash=$2
        and scope='shared' and last_status='succeeded' and fresh_until>now() and retain_until>now()
      limit 1`, [safeUrl, hash]);
    if (cached.rows[0]) return { ...cached.rows[0].payload_json, cacheStatus: "fresh" };
    const reservation = await reserveWebRequest(client, "identity_page");
    let html;
    try { html = await load(safeUrl);
      await finishWebRequest(client, reservation, "identity_page", { credits: 0 }, "succeeded");
    } catch (error) {
      await finishWebRequest(client, reservation, "identity_page", null, "failed");
      throw error;
    }
    const inspected = inspectedPageLinks(html, safeUrl, term);
    const compact = { url: safeUrl, focus: term, results: inspected ? [inspected] : [],
      budgetTracked: true, usage: { credits: 0 } };
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
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`web:${hash}`]); }
    finally { client.release(); }
  }
}

// Deterministic mention classification: title hit is central, snippet-only is
// substantive, anything else is incidental. Never upgrades without a real match.
export function classifyMention(term, item) {
  const pattern = exactTermPattern(term);
  if (!pattern) return "unknown";
  if (pattern.test(String(item?.title ?? ""))) return "central";
  if (pattern.test(String(item?.snippet ?? ""))) return "substantive";
  return "incidental";
}

// A word hit locates a page; it does not establish that the brand did the
// activity. Require an attributed, concrete statement in the inspected excerpt.
// Navigation, generic category labels and unrelated mentions stay as leads.
export function supportedBusinessEvidence(term, item, brandName) {
  if (item?.inspected !== true || nonEvidencePage(item.url) ||
      !/^[a-f0-9]{64}$/.test(item.sourceHash ?? "")) return false;
  const pattern = exactTermPattern(term);
  const title = String(item.title ?? "");
  const snippet = String(item.snippet ?? "");
  const combined = `${title}. ${snippet}`;
  const brand = String(brandName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!pattern || !brand || !combined.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand) ||
      !pattern.test(snippet)) return false;
  const action = /\b(?:launch(?:es|ed)?|creat(?:e|es|ed|ing)|produc(?:e|es|ed|ing)|publish(?:es|ed|ing)?|design(?:s|ed|ing)?|mak(?:e|es|ing)|made|build(?:s|ing)?|built|host(?:s|ed|ing)?|organis(?:e|es|ed|ing)|organiz(?:e|es|ed|ing)|offer(?:s|ed|ing)?|sell(?:s|ing)?|develop(?:s|ed|ing)?|introduc(?:e|es|ed|ing)|partner(?:s|ed|ing)?|collaborat(?:e|es|ed|ing))\b/i;
  const descriptiveProduct = /\b(?:men['’]?s|women['’]?s|outdoor|technical|performance)\s+(?:\w+\s+){0,2}(?:clothing|apparel|gear|socks|equipment)\s+for\s+\w+/i;
  const pressPath = /^\/(?:news|press)(?:\/|$)/i.test(publicPage(item.url) ? new URL(item.url).pathname : "");
  const namedPressAction = pressPath && title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand) &&
    /\b(?:launch(?:es|ed)?|introduc(?:e|es|ed)|creat(?:e|es|ed)|produc(?:e|es|ed)|publish(?:es|ed)?)\b/i.test(title);
  for (const match of snippet.matchAll(new RegExp(pattern.source, "gi"))) {
    const clauseStart = Math.max(snippet.lastIndexOf(".", match.index - 1), snippet.lastIndexOf("\n", match.index - 1)) + 1;
    const nextStop = snippet.indexOf(".", match.index);
    const clause = snippet.slice(clauseStart, nextStop < 0 ? snippet.length : nextStop);
    const local = clause.slice(Math.max(0, match.index - clauseStart - 90), match.index - clauseStart + match[0].length + 90);
    if (/\b(?:other|unrelated|third.party)\s+brand\b/i.test(local)) continue;
    if (/\b(?:does not|doesn't|do not|no longer|has stopped|ceased to)\s+(?:\w+\s+){0,3}(?:launch|create|produce|publish|design|make|build|host|offer|sell|develop|introduce|partner|collaborate)\b/i.test(local)) continue;
    if (/\b(?:might|may|could|would|plan(?:s|ned)? to|hope(?:s)? to|intend(?:s)? to)\s+(?:\w+\s+){0,2}(?:launch|create|produce|publish|design|make|build|host|offer|sell|develop|introduce|partner|collaborate)\b/i.test(local)) continue;
    const localAttribution = local.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand) ||
      (title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand) && /\b(?:we|our)\b/i.test(local));
    if ((action.test(local) && localAttribution) ||
        (descriptiveProduct.test(local) && title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand)) ||
        (namedPressAction && /^(?:campaign|video)$/i.test(String(term).trim()) &&
          /\b(?:cast|crew|film(?:ed|ing)?|production|director|episode|storytelling)\b/i.test(local))) return true;
  }
  return false;
}

// A negative claim needs an explicit first-party sentence about this brand and
// this activity. Empty results and vague limitations are never contradictions.
export function explicitBusinessContradiction(term, item, brandName) {
  if (item?.inspected !== true || nonEvidencePage(item.url) ||
      !/^[a-f0-9]{64}$/.test(item.sourceHash ?? "")) return false;
  const snippet = String(item.snippet ?? "");
  const termPattern = exactTermPattern(term);
  const brand = String(brandName ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!termPattern || !brand || !termPattern.test(snippet)) return false;
  return new RegExp(`${brand}[^.!?]{0,55}\\b(?:does not|doesn't|do not|no longer|has stopped|ceased to)\\s+` +
    `(?:\\w+\\s+){0,3}(?:offer|sell|make|produce|create|publish|host|run|launch|partner|collaborate)` +
    `[^.!?]{0,55}${termPattern.source.replace(/^\(\^\|\[\^a-z0-9\]\)/, "")}`, "i").test(snippet);
}

function isDomain(url, domain) {
  const host = officialDomainOf(url);
  return Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));
}

function nonEvidencePage(url) {
  return /\/(?:careers?|jobs?|recruitment|privacy|terms|faq|help|support)(?:\/|$|[?#])/i.test(String(url ?? ""));
}

// Research one cultural territory for one partner brand: official-domain evidence
// first; an unscoped corroboration search only when official evidence exists.
async function researchTerritory({ brandName, domain, territory }, search, extract, known) {
  const query = `${brandName} ${territory}`;
  const reused = known.filter((item) => isDomain(item.url, domain) &&
    supportedBusinessEvidence(territory, item, brandName));
  const firstParty = domain && reused.length < 2
    ? await search(query, { includeDomains: [domain], focus: territory })
    : { results: [], cacheStatus: "skipped" };
  let official = [...reused, ...(firstParty.results ?? [])].filter((item) => isDomain(item.url, domain) &&
    supportedBusinessEvidence(territory, item, brandName));
  official = [...new Map(official.map((item) => [item.url, item])).values()];
  if (official.length < 2 && domain && firstParty.leads?.length) {
    const lead = firstParty.leads.find((item) => !official.some((knownItem) => knownItem.url === item.url));
    if (lead) {
      const page = await extract(lead.url, { focus: territory, title: lead.title,
        publishedAt: lead.publishedAt });
      official.push(...(page.results ?? []).filter((item) => isDomain(item.url, domain) &&
        supportedBusinessEvidence(territory, item, brandName)));
    }
  }
  const independentRaw = official.length === 1 ? await search(query, { focus: territory }) : { results: [] };
  const independent = (independentRaw.results ?? []).filter((item) =>
    (!domain || !isDomain(item.url, domain)) && supportedBusinessEvidence(territory, item, brandName));
  return { territory, official, independent,
    coverage: firstParty.cacheStatus === "unavailable" ? "not_completed" :
      official.length || independent.length ? "supported" : "inconclusive" };
}

async function researchCapability({ brandName, domain, key, terms }, search, extract, known) {
  if (!domain) return { key, status: "unsupported", matches: [], coverage: "not_performed" };
  let best = null;
  let searched = false;
  const contradictions = [];
  for (const term of terms) {
    const reused = known.filter((item) => item.title !== brandName && isDomain(item.url, domain) &&
      supportedBusinessEvidence(term, item, brandName));
    const result = reused.length ? { results: reused, leads: [] }
      : await search(`${brandName} ${term}`, { includeDomains: [domain], focus: term });
    if (!reused.length && result.cacheStatus !== "unavailable") searched = true;
    let matches = (result.results ?? []).filter((item) => isDomain(item.url, domain) &&
      supportedBusinessEvidence(term, item, brandName));
    contradictions.push(...(result.results ?? []).filter((item) => isDomain(item.url, domain) &&
      explicitBusinessContradiction(term, item, brandName)));
    if (!matches.length && result.leads?.length) {
      const lead = result.leads[0];
      const page = await extract(lead.url, { focus: term, title: lead.title,
        publishedAt: lead.publishedAt });
      matches = (page.results ?? []).filter((item) => isDomain(item.url, domain) &&
        supportedBusinessEvidence(term, item, brandName));
      contradictions.push(...(page.results ?? []).filter((item) => isDomain(item.url, domain) &&
        explicitBusinessContradiction(term, item, brandName)));
    }
    for (const match of matches) {
      const centrality = classifyMention(term, match);
      const status = centrality === "central" ? "direct" : centrality === "substantive" ? "transferable" : null;
      if (status && (!best || (best.status === "transferable" && status === "direct"))) {
        best = { status, match, term };
      }
    }
    if (best) break;
  }
  return best
    ? { key, status: best.status, matches: [best.match], term: best.term, contradictions,
      coverage: searched ? "performed" : "reused" }
    : { key, status: "unsupported", matches: [], contradictions,
      coverage: contradictions.length ? "contradicted" : searched ? "inconclusive" : "not_performed" };
}

async function reusableOfficialSources(entityId, domain, brandName) {
  if (!entityId || !domain) return [];
  const result = await db().query(`select source_url,excerpt,published_at,rights_json
    from catalog.source_items where entity_id=$1 and platform='web'
      and fresh_until>now() and expires_at>now()
    order by collected_at desc limit 30`, [entityId]);
  return result.rows.filter((row) => isDomain(row.source_url, domain) &&
    !nonEvidencePage(row.source_url) &&
    /^[a-f0-9]{64}$/.test(row.rights_json?.source_hash ?? "") && row.excerpt)
    .map((row) => ({ url: row.source_url, title: row.rights_json?.title ?? brandName,
      summary: row.excerpt, snippet: row.excerpt, publishedAt: row.published_at,
      sourceHash: row.rights_json.source_hash, inspected: true }));
}

// Partner evidence for the Brand × Brand worker. Bounded: at most 3 territories
// (x2 searches when corroboration runs) and 3 capability lookups per run.
export async function researchPartnerEvidence(_ownerUserId, { brandName, domain, entityId = null,
  territories, capabilityTerms = [] }, { search = withWebSearch, extract = withWebExtract } = {}) {
  if (typeof brandName !== "string" || !brandName.trim()) throw new Error("A partner brand name is required.");
  const questions = new Map();
  const ask = (query, options) => {
    const key = webRequestHash(query.trim().toLowerCase().replace(/\s+/g, " "), options.includeDomains,
      String(options.focus).toLowerCase().trim());
    if (!questions.has(key)) questions.set(key, Promise.resolve().then(() => search(query, options))
      .catch(() => ({ results: [], leads: [], cacheStatus: "unavailable" })));
    return questions.get(key);
  };
  const known = await reusableOfficialSources(entityId, domain, brandName);
  const extracted = new Map();
  const inspect = (url, options) => {
    const key = url;
    if (!extracted.has(key)) extracted.set(key, Promise.resolve().then(() => extract(url, options))
      .catch(() => ({ results: [], cacheStatus: "unavailable" })));
    return extracted.get(key);
  };
  const territoryResults = [];
  for (const territory of [...new Set((territories ?? []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 3)) {
    territoryResults.push(await researchTerritory({ brandName, domain, territory }, ask, inspect, known));
  }
  const capabilityResults = [];
  for (const capability of capabilityTerms.slice(0, 3)) {
    capabilityResults.push(await researchCapability({ brandName, domain, ...capability }, ask, inspect, known));
  }
  return { territoryResults, capabilityResults,
    coverage: [...territoryResults, ...capabilityResults].some((item) =>
      item.coverage === "supported" || item.coverage === "performed" || item.coverage === "reused" ||
      item.coverage === "inconclusive" || item.coverage === "contradicted") ? "performed" : "not_completed" };
}
