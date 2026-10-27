import { personalQlooRecommendBrands, personalQlooEntityTags, personalQlooAudienceTags } from "./personal-qloo.mjs";
import { withWebSearch, officialDomainOf } from "./web-research.mjs";
import { researchCommercePair } from "./commerce-research.mjs";
import { chooseComplementGenres, triageCommerceLeads } from "./commerce-mechanism.mjs";
import { BRAND_GENRES } from "./brand-genres.mjs";
import { verifiedWebsitesForQlooIds } from "./catalog.mjs";
import { recallPartnerMemory, partnerMemoryTiers, orderLeadsWithMemory } from "./research-memory.mjs";
import { brandWearer } from "./commerce-products.mjs";
import { rankCommerceOpportunities } from "./brand-commerce.mjs";
import { investigateDirectCommerceCulture } from "./commerce-culture.mjs";
import { discoverVerifiedStorefront, secureCatalogFetch, fetchFailureCode,
  TRANSIENT_FETCH_FAILURES } from "./shopify-catalog.mjs";

const QLOO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Qloo native brand leads read per run. Affinity is nearly flat across them
// (about 0.94–0.96), so the useful partners come from the catalog screen, not rank.
const NATIVE_LEADS = 12;
// Partners added from Qloo brand categories that fit the chosen product.
const CATEGORY_LEADS = 8;
// Supported results after which partners rated unlikely for the product are skipped.
const ENOUGH_SUPPORTED = 3;
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const businessName = (value) => String(value ?? "").trim()
  .replace(/(?:,?\s+)(?:incorporated|inc\.?|llc|ltd\.?|limited|corp\.?|corporation)$/i, "")
  .trim();
// Site names arrive HTML-encoded ("Lo &amp; Sons", "Rothy&#39;s").
const HTML_ENTITIES = { amp: "&", apos: "'", quot: '"', nbsp: " ", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", lt: "<", gt: ">" };
export function decodeHtmlText(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : " ";
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const nameWords = (value) => businessName(value).toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f'’]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
// Qloo sometimes adds a product word to a brand's name ("Toad&Co Clothing",
// "Ibex Outdoor Clothing"); the brand's own site and address use the name alone.
const NAME_DESCRIPTOR = /\s+(?:outdoor\s+)?(?:clothing|apparel|footwear|shoes|boots)$/i;
export const coreBrandName = (name) => {
  const core = String(name ?? "").trim().replace(NAME_DESCRIPTOR, "").trim();
  return core.length >= 2 ? core : String(name ?? "").trim();
};
// The site's own name must contain the brand name as whole words, e.g.
// "Faherty Brand" for Faherty. The linked Shopify store is the second check.
export function siteNameMatchesBrand(siteName, brand) {
  const core = coreBrandName(brand);
  if (core !== String(brand ?? "").trim() && siteNameMatchesBrand(siteName, core)) return true;
  const target = normalized(businessName(brand));
  if (!target) return false;
  if (normalized(businessName(siteName)) === target) return true;
  const site = nameWords(siteName);
  const words = nameWords(brand);
  if (!words.length) return false;
  for (let start = 0; start + words.length <= site.length; start += 1) {
    if (words.every((word, offset) => site[start + offset] === word)) return true;
  }
  return false;
}
const seedIdentityCache = new Map();
const SEED_IDENTITY_TTL_MS = 10 * 60 * 1000;
const IDENTITY_CHECK_MS = 45_000;

// Resolve null when the run deadline passes, even if a provider call inside
// the identity check does not support cancellation itself.
function untilAborted(promise, signal) {
  if (!signal) return promise.catch(() => null);
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const stop = () => resolve(null);
    signal.addEventListener("abort", stop, { once: true });
    promise.then((value) => { signal.removeEventListener("abort", stop); resolve(value); },
      () => { signal.removeEventListener("abort", stop); resolve(null); });
  });
}

// Brand confirmation has already checked the Qloo identity, official page and
// linked UCP shop. Reuse that narrowly scoped proof during a prompt run;
// product research still checks the current shop and exact seller/variant.
export function recentConfirmedSeed(seed, seedQlooId, now = Date.now()) {
  if (!seed?.id || seed.identityStatus !== "verified" ||
      seed.qlooId !== seedQlooId || seed.proofQlooId !== seedQlooId ||
      seed.proofOfficialWebsite !== seed.officialWebsite ||
      !/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(seed.verifiedShopId ?? "")) return null;
  const verifiedAt = Date.parse(seed.identityVerifiedAt ?? "");
  if (!Number.isFinite(verifiedAt) || verifiedAt > now ||
      now - verifiedAt > 30 * 60_000) return null;
  try {
    const site = new URL(seed.officialWebsite);
    const source = new URL(seed.identitySourceUrl);
    const proof = new URL(seed.storefrontProofUrl);
    const base = site.hostname.replace(/^www\./, "");
    if (site.protocol !== "https:" || site.port || site.pathname !== "/" || site.search || site.hash ||
        source.protocol !== "https:" || source.port ||
        source.hostname.replace(/^www\./, "") !== base ||
        proof.protocol !== "https:" || proof.port || proof.pathname !== "/.well-known/ucp" ||
        ![site.hostname, base, `checkout.${base}`, `shop.${base}`, `store.${base}`]
          .includes(proof.hostname)) return null;
  } catch { return null; }
  return { id: seed.id, qlooId: seedQlooId, name: seed.name,
    officialWebsite: seed.officialWebsite, identityStatus: "verified",
    identitySourceUrl: seed.identitySourceUrl,
    storefrontProofUrl: seed.storefrontProofUrl,
    verifiedShopId: seed.verifiedShopId,
    description: seed.description };
}

export function reuseRecentCommerceConfirmation(candidate, prior, officialWebsite = null,
  now = Date.now()) {
  const proof = recentConfirmedSeed(prior, candidate?.id, now);
  const sameName = (value) => String(value ?? "").toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!proof || sameName(proof.name) !== sameName(candidate?.name)) return null;
  if (officialWebsite !== null) {
    try {
      const url = new URL(officialWebsite);
      if (url.protocol !== "https:" || url.port || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash ||
          url.origin !== proof.officialWebsite) return null;
    } catch { return null; }
  }
  return { id: prior.id, kind: "brand", name: prior.name,
    canonicalUrl: prior.officialWebsite, identityStatus: "verified",
    qlooId: candidate.id };
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const deadlineSignal = (signal, timeoutMs) => signal
  ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

// Fetch a homepage and follow up to three redirects. Every hop goes back
// through the DNS-checked fetcher; an http redirect is upgraded to https.
// The final origin is still only a website hypothesis for the caller.
export async function fetchBusinessHomepage(origin, { fetchPage = secureCatalogFetch,
  signal = null, trace = null, maxRedirects = 3, retryDelayMs = 400, rateLimitDelayMs = 1500 } = {}) {
  let retriedRateLimit = false;
  const note = (reason, url) => trace?.push({ step: "homepage",
    host: (() => { try { return new URL(url).hostname; } catch { return null; } })(), reason });
  let url = `${origin}/`;
  const seen = new Set();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    seen.add(url);
    let response;
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) { note("deadline_reached", url); return null; }
      try {
        response = await fetchPage(url, { headers: { accept: "text/html" },
          signal: deadlineSignal(signal, 8000) });
        break;
      } catch (error) {
        const code = fetchFailureCode(error);
        if (attempt >= 1 || signal?.aborted || !TRANSIENT_FETCH_FAILURES.has(code)) {
          note(code, url); return null;
        }
        note(`retry_after_${code}`, url);
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    if (response.status === 429 && !retriedRateLimit && !signal?.aborted) {
      // One short pause and retry after a rate limit; a second 429 is final.
      retriedRateLimit = true;
      note("retry_after_http_429", url);
      await new Promise((resolve) => setTimeout(resolve, rateLimitDelayMs));
      hop -= 1; seen.delete(url);
      continue;
    }
    if (!REDIRECTS.has(response.status)) {
      if (!response.ok) { note(`http_${response.status ?? "error"}`, url); return null; }
      return { response, finalUrl: url };
    }
    let next;
    try {
      next = new URL(response.location ?? "", url);
      if (next.protocol === "http:") next.protocol = "https:";
    } catch { note("redirect_invalid", url); return null; }
    if (next.protocol !== "https:" || next.port || next.username || next.password) {
      note("redirect_invalid", url); return null;
    }
    next.hash = "";
    if (seen.has(next.href)) { note("redirect_loop", url); return null; }
    note(`redirect_${response.status}`, url);
    url = next.href;
  }
  note("redirect_limit", url);
  return null;
}

// The Qloo website is a lead, not proof. A direct identity path requires the
// site's own exact name metadata and a UCP shop document on that host (or its
// verified alternate). A redirect only changes which host must pass both
// checks. Any missing link falls back to inspected web research.
// The homepage's site names, title, and who the store says it sells for
// ("Cuyana | Women's Premium Essentials"); products often carry no wearer label.
export function homepageFacts(html) {
  const metas = [...html.matchAll(/<meta\b[^>]{0,1000}>/gi)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/\b(property|name|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
      .map(([, key, double, single]) => [key.toLowerCase(), double ?? single])));
  const metaValues = (names) => metas.filter((attributes) =>
    names.includes(String(attributes.property ?? attributes.name ?? "").toLowerCase()))
    .map((attributes) => decodeHtmlText(attributes.content));
  // The brand may lead or end the page title ("Custom Haircare | Prose").
  const title = decodeHtmlText(html.match(/<title\b[^>]*>([^<]{1,250})<\/title>/i)?.[1] ?? "");
  return { title, siteNames: metaValues(["og:site_name", "application-name"]),
    storeWearer: brandWearer([title, ...metaValues(["description", "og:description"])].join(" ")) };
}

// Who a verified brand's homepage says it sells for, or null.
export async function readStoreWearer(website, { fetchPage = secureCatalogFetch, signal = null } = {}) {
  let origin;
  try { origin = new URL(website).origin; } catch { return null; }
  const page = await fetchBusinessHomepage(origin, { fetchPage, signal });
  if (!page || !String(page.response.contentType ?? "").toLowerCase().includes("text/html")) return null;
  return homepageFacts(await page.response.text()).storeWearer;
}

export async function verifyFirstPartyCommerceBusiness(candidate, {
  fetchPage = secureCatalogFetch, discoverStorefront = discoverVerifiedStorefront,
  signal = null, trace = null,
} = {}) {
  const name = String(candidate?.name ?? "").trim();
  if (!QLOO_UUID.test(candidate?.qlooId ?? "") || name.length < 2) return null;
  let origin; let host;
  try {
    const url = new URL(candidate.website);
    if (url.protocol !== "https:" || url.port || url.username || url.password) {
      trace?.push({ step: "homepage", host: url.hostname, reason: "website_not_https" });
      return null;
    }
    origin = url.origin;
  } catch {
    trace?.push({ step: "homepage", host: null, reason: candidate?.website ? "website_invalid" : "website_missing" });
    return null;
  }
  try {
    const page = await fetchBusinessHomepage(origin, { fetchPage, signal, trace });
    if (!page) return null;
    const { response } = page;
    origin = new URL(page.finalUrl).origin;
    host = new URL(page.finalUrl).hostname.toLowerCase();
    if (!String(response.contentType ?? "").toLowerCase().includes("text/html")) {
      trace?.push({ step: "homepage", host, reason: "not_html" }); return null;
    }
    const { siteNames, title, storeWearer } = homepageFacts(await response.text());
    const titleSegments = title.split(/\s*[|–—:]\s*|\s+-\s+/).map((item) => item.trim()).filter(Boolean);
    if (![...siteNames, ...titleSegments].some((siteName) => siteNameMatchesBrand(siteName, name))) {
      trace?.push({ step: "site_name", host, reason: "site_name_mismatch" }); return null;
    }
    const store = await discoverStorefront(origin, { signal, trace });
    if (!/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(store?.shopId ?? "") ||
        store.officialHost !== host ||
        store.proofUrl !== `https://${store.domain}/.well-known/ucp`) {
      trace?.push({ step: "storefront", host, reason: store?.coverage ??
        (store ? "storefront_proof_mismatch" : "storefront_not_found") });
      return null;
    }
    return { id: candidate.qlooId, qlooId: candidate.qlooId, name,
      officialWebsite: origin, identityStatus: "verified",
      productHints: String(candidate.description ?? "").slice(0, 600),
      identitySourceUrl: `${origin}/`, storefrontProofUrl: store.proofUrl,
      shopId: store.shopId, storeWearer };
  } catch (error) {
    trace?.push({ step: "identity", host: host ?? null, reason: fetchFailureCode(error) });
    return null;
  }
}

export async function verifyCommerceBusinessSite({ name, website }, {
  search = withWebSearch, discoverStorefront = discoverVerifiedStorefront,
} = {}) {
  const label = String(name ?? "").trim();
  let domain;
  try {
    const url = new URL(website);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    domain = officialDomainOf(url.href);
  } catch { return null; }
  if (label.length < 2 || label.length > 90 || !domain) return null;
  const response = await search(`${label} official website`, {
    includeDomains: [domain], focus: label }).catch(() => null);
  const page = response?.results?.find((item) => item.inspected === true &&
    officialDomainOf(item.url) === domain &&
    normalized(item.title).includes(normalized(label)) &&
    normalized(item.snippet).includes(normalized(label)));
  if (!page) return null;
  const officialWebsite = `https://${domain}`;
  const store = await discoverStorefront(officialWebsite).catch(() => null);
  return store?.shopId ? { name: label, officialWebsite, identityStatus: "verified",
    identitySourceUrl: page.url, shopId: store.shopId } : null;
}

// Up to two words from Qloo's description narrow a search for a brand whose
// name is an ordinary word ("Negative" -> "Negative underwear lingerie").
const HINT_STOP = new Set(["brand", "brands", "company", "companies", "founded", "based", "known",
  "products", "product", "offers", "offering", "makes", "making", "sells", "selling", "online",
  "retailer", "store", "shop", "label", "line", "collection", "collections", "american", "with",
  "from", "that", "this", "their", "which", "where", "while", "into", "also", "over", "more",
  "most", "best", "high", "quality", "design", "designs", "designed", "style", "modern",
  "everyday", "range", "variety", "wide", "great", "first", "global", "independent", "created",
  "creates", "making", "inspired", "world", "people", "customers", "focused", "direct", "consumer",
  // Narrative words in Qloo descriptions ("Established in 2014, the brand
  // specializes in…") say nothing about what the brand sells.
  "established", "specializes", "specializing", "specialized", "recognized", "renowned", "leading",
  "prominent", "popular", "premium", "luxury", "luxurious", "since", "years", "decades", "history",
  "nearly", "over", "operates", "primarily", "serves", "serving", "dedicated", "committed"]);
export function searchHint(name, description) {
  const nameWords = new Set(String(name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const words = decodeHtmlText(description).toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return [...new Set(words.filter((word) => !HINT_STOP.has(word) && !nameWords.has(word)))]
    .slice(0, 2).join(" ");
}

// Country domains tried after brandname.com for a brand's market.
const COUNTRY_DOMAINS = { GB: ["co.uk"], IE: ["ie"], CA: ["ca"], AU: ["com.au"], NZ: ["co.nz"],
  DE: ["de"], FR: ["fr"], NL: ["nl"] };

// Social, marketplace and reference sites are never a brand's own store.
const NOT_BRAND_SITES = /(?:^|\.)(?:instagram|facebook|tiktok|twitter|x|youtube|pinterest|linkedin|threads|reddit|wikipedia|amazon|etsy|ebay|walmart|target|nordstrom|yelp|crunchbase|bloomberg|trustpilot|glassdoor|bbb|sitejabber|reviews|prnewswire|businesswire|globenewswire|medium|substack)\.[a-z.]+$/i;

// Brand identity: the website Qloo gives (or a saved or user-entered one), then
// brandname.com (also "and" for "&"). The first site whose own name contains
// the brand name and which has its own Shopify store is the brand. Only a
// Qloo-suggested partner (allowSearch) falls back to one web search, taking the
// first result that is not a social, marketplace or reference site. A starting
// brand or a user-chosen partner never searches: the user enters the website.
export async function verifyCommerceBusiness(candidate, {
  firstParty = verifyFirstPartyCommerceBusiness, signal = null, trace = null,
  allowSearch = false, search = withWebSearch,
} = {}) {
  const name = String(candidate?.name ?? "").trim();
  if (!QLOO_UUID.test(candidate?.qlooId ?? "") || name.length < 2) return null;
  const tried = new Set();
  const attempt = async (website) => {
    let origin;
    try { origin = new URL(website).origin; } catch { return null; }
    if (tried.has(origin) || signal?.aborted) return null;
    tried.add(origin);
    return firstParty({ ...candidate, website: origin }, { signal, trace }).catch(() => null);
  };
  if (candidate.website) {
    const listed = await attempt(candidate.website);
    if (listed) return listed;
  }
  const suffixes = ["com", ...(COUNTRY_DOMAINS[String(candidate.market ?? "").toUpperCase()] ?? [])];
  const core = coreBrandName(name);
  for (const host of [...new Set([name, core].flatMap((value) =>
    [normalized(value), normalized(value.replace(/&/g, " and "))]))]) {
    if (host.length < 2 || host.length > 50) continue;
    for (const suffix of suffixes) {
      const guessed = await attempt(`https://${host}.${suffix}`);
      if (guessed) return guessed;
    }
  }
  if (!allowSearch || signal?.aborted) {
    trace?.push({ step: "identity", host: null, reason: signal?.aborted ? "deadline_reached" : "official_website_needed" });
    return null;
  }
  const hint = searchHint(core, candidate.description);
  const response = await search(`${core}${hint ? ` ${hint}` : ""} official website`, { focus: core })
    .catch(() => null);
  const usable = (response?.results ?? []).filter((item) => {
    try {
      const url = new URL(item.url);
      return url.protocol === "https:" && !NOT_BRAND_SITES.test(url.hostname);
    } catch { return false; }
  });
  // An official store's address almost always contains the brand name
  // (negativeunderwear.com, wearlively.com); prefer that result when present.
  const brandToken = normalized(core);
  const top = usable.find((item) => brandToken.length >= 3 &&
    normalized(new URL(item.url).hostname).includes(brandToken)) ?? usable[0];
  if (!top) {
    trace?.push({ step: "web_search", host: null, reason: response ? "no_brand_site_result" : "search_unavailable" });
    return null;
  }
  const proof = await attempt(top.url);
  if (!proof) trace?.push({ step: "web_search", host: officialDomainOf(top.url), reason: "top_result_not_verified" });
  return proof && proof.qlooId === candidate.qlooId
    ? { ...proof, identitySourceUrl: top.url } : null;
}

// A user correction changes the website hypothesis, never the selected Qloo
// identity. The chosen business and its shop must both be verified before the
// corrected association is persisted.
export async function verifySelectedCommerceBrand(candidate, officialWebsite = null, {
  verifyBusiness = verifyCommerceBusiness,
  discoverStorefront = discoverVerifiedStorefront, trace = null,
} = {}) {
  let website = candidate?.website ?? null;
  if (officialWebsite !== null) {
    try {
      const url = new URL(officialWebsite);
      if (url.protocol !== "https:" || url.port || url.username || url.password ||
          (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
      website = url.origin;
    } catch { return null; }
  }
  const verified = officialWebsite !== null && verifyBusiness === verifyCommerceBusiness
    ? await verifyFirstPartyCommerceBusiness({ ...candidate, website }, { trace })
    : await verifyBusiness({ ...candidate, website }, { trace });
  if (verified?.identityStatus !== "verified" || !verified.officialWebsite ||
      verified.qlooId !== candidate.qlooId) return null;
  if (officialWebsite !== null &&
      officialDomainOf(verified.officialWebsite) !== officialDomainOf(website)) return null;
  // The first-party verifier already read this site's UCP document. A second
  // probe here only adds another chance for a transient failure.
  if (/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(verified.shopId ?? "") &&
      String(verified.storefrontProofUrl ?? "").startsWith("https://")) return verified;
  const store = await discoverStorefront(verified.officialWebsite, { trace }).catch(() => null);
  if (verified.shopId && store?.shopId !== verified.shopId) return null;
  return store?.shopId ? { ...verified, shopId: store.shopId,
    storefrontProofUrl: store.proofUrl } : null;
}

export function nativeLeads(envelope, seedQlooId, limit = 8) {
  const seen = new Set([seedQlooId]);
  const leads = [];
  for (const item of envelope?.results ?? []) {
    if (!QLOO_UUID.test(item?.entity_id ?? "") || seen.has(item.entity_id)) continue;
    seen.add(item.entity_id);
    const name = String(item.name ?? "").trim().slice(0, 120);
    let website = null;
    try {
      const url = new URL(item.properties?.website ?? item.properties?.url);
      if (url.protocol === "https:") website = url.origin;
    } catch { /* Missing website remains an identity research question. */ }
    if (!name) continue;
    leads.push({ qlooId: item.entity_id, name, website,
      originalOrder: leads.length + 1,
      description: item.properties?.description ?? item.description ?? "",
      recommendation: { entityId: item.entity_id, affinity: Number.isFinite(item.affinity)
        ? item.affinity : null, explanation: item.explanation ?? item.explainability ?? null } });
    if (leads.length >= limit) break;
  }
  return leads;
}

// Qloo descriptions are planning hints only. Spread bounded investigations
// across the returned ranking so a novel adjective in an early description
// cannot consume every later slot. Keep original Qloo order as lineage.
export function selectNativeCommerceLeads(leads, limit = 6) {
  if (limit <= 0) return [];
  if (leads.length <= limit) return [...leads];
  const generic = new Set(["brand", "brands", "company", "product", "products",
    "store", "shop", "their", "with", "from", "that", "this", "and", "the"]);
  const terms = (lead) => new Set(String(lead.description ?? "").toLowerCase()
    .match(/[a-z]{4,}/g)?.filter((word) => !generic.has(word)) ?? []);
  const earlyCount = Math.max(1, Math.ceil(limit / 2));
  const selected = leads.slice(0, earlyCount);
  const seenTerms = new Set(selected.flatMap((lead) => [...terms(lead)]));
  const later = leads.slice(earlyCount);
  const remainingSlots = limit - earlyCount;
  for (let slot = 0; slot < remainingSlots; slot += 1) {
    const start = Math.floor(slot * later.length / remainingSlots);
    const end = Math.floor((slot + 1) * later.length / remainingSlots);
    const bucket = later.slice(start, end);
    const center = (bucket.length - 1) / 2;
    const chosen = bucket.map((lead, index) => ({ lead, index,
      novelty: [...terms(lead)].filter((term) => !seenTerms.has(term)).length }))
      .sort((a, b) => b.novelty - a.novelty ||
        Math.abs(a.index - center) - Math.abs(b.index - center))[0]?.lead;
    if (!chosen) continue;
    selected.push(chosen);
    for (const term of terms(chosen)) seenTerms.add(term);
  }
  return selected.sort((a, b) => (a.originalOrder ?? leads.indexOf(a)) -
    (b.originalOrder ?? leads.indexOf(b)));
}

// This is the sole candidate-acquisition branch for the production native path.
// A direct pair uses the same product research but never treats a filtered Qloo result as discovery.
export async function researchNativeCommerce({ ownerUserId, seed, seedQlooId, objective,
  specifiedPartner = null, market = "US", userConstraints = {}, maxCatalogCalls = 160,
  userFeedback = null,
  maxResearchMs = Number(process.env.COMMERCE_RUN_RESEARCH_MS) || 300_000 }, {
  recommend = personalQlooRecommendBrands, entityTags = personalQlooEntityTags,
  audienceTags = personalQlooAudienceTags,
  verifyBusiness = verifyCommerceBusiness, researchPair = researchCommercePair,
  discoverStorefront = discoverVerifiedStorefront,
  investigateDirect = investigateDirectCommerceCulture,
  triageLeads = triageCommerceLeads, chooseGenres = chooseComplementGenres,
  knownWebsites = verifiedWebsitesForQlooIds,
  recallPartners = recallPartnerMemory, readSeedWearer = null, now = () => Date.now() } = {}) {
  if (!QLOO_UUID.test(seedQlooId ?? "") || !["product_bundle", "cross_sell"].includes(objective)) {
    throw new Error("Verified native brand and commerce objective required.");
  }
  const startedAt = now();
  const remainingResearchMs = () => Number.isFinite(maxResearchMs) && maxResearchMs > 0
    ? Math.max(0, maxResearchMs - (now() - startedAt)) : Infinity;
  // Identity checks can make many slow public requests. Bound each one by the
  // run's remaining time instead of checking the clock only between steps,
  // and by its own limit, so one stuck website cannot hold a research slot
  // for the rest of the run (checks normally finish within seconds).
  const verifyWithinDeadline = (candidate, { allowSearch = false } = {}) => {
    const remaining = Math.min(remainingResearchMs(), IDENTITY_CHECK_MS);
    const controller = Number.isFinite(remaining) ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), Math.max(1, remaining)) : null;
    const signal = controller?.signal ?? null;
    const trace = [];
    const work = Promise.resolve().then(() => verifyBusiness(candidate, { signal, trace, allowSearch }));
    return untilAborted(work, signal).finally(() => clearTimeout(timer)).then((identity) => {
      if (!identity && signal?.aborted && !trace.some((item) => item.reason === "deadline_reached")) {
        trace.push({ step: "identity", host: null, reason: "deadline_reached" });
      }
      return { identity: identity ?? null, trace: trace.slice(0, 24) };
    });
  };
  const seedCacheKey = JSON.stringify([ownerUserId, seedQlooId, seed.name, seed.officialWebsite]);
  const cachedSeed = verifyBusiness === verifyCommerceBusiness
    ? seedIdentityCache.get(seedCacheKey) : null;
  const confirmedProof = recentConfirmedSeed(seed, seedQlooId);
  let seedIdentityDiagnostics = [];
  let verifiedSeed = confirmedProof ??
    (cachedSeed?.expiresAt > Date.now() ? cachedSeed.identity : null);
  if (!verifiedSeed) {
    const checked = await verifyWithinDeadline({ qlooId: seedQlooId, name: seed.name,
      website: seed.officialWebsite, description: seed.description, market });
    verifiedSeed = checked.identity;
    seedIdentityDiagnostics = checked.trace;
  }
  if (verifiedSeed && !confirmedProof && verifyBusiness === verifyCommerceBusiness) {
    if (seedIdentityCache.size >= 100) seedIdentityCache.delete(seedIdentityCache.keys().next().value);
    seedIdentityCache.set(seedCacheKey, { identity: verifiedSeed,
      expiresAt: Date.now() + SEED_IDENTITY_TTL_MS });
  }
  if (!verifiedSeed) {
    // The persisted starting business is already verified. Diagnose the
    // separate commerce link before reporting another identity failure.
    const store = seed?.officialWebsite
      ? await discoverStorefront(seed.officialWebsite).catch(() => null) : null;
    return { coverage: !store?.shopId ? "seed_storefront_unverified" : "seed_identity_unverified",
      seedIdentityDiagnostics,
      candidates: [], opportunities: { supported: [], needs_verification: [], unsupported: [] } };
  }
  // Who the starting brand sells for, from its homepage, when its identity proof
  // did not already read it. Offline fixtures (a substitute verifier) skip this.
  const seedWearerReader = readSeedWearer ?? (verifyBusiness === verifyCommerceBusiness ? readStoreWearer : null);
  if (verifiedSeed.storeWearer === undefined && seedWearerReader) {
    const storeWearer = await seedWearerReader(verifiedSeed.officialWebsite ?? seed.officialWebsite,
      { signal: AbortSignal.timeout(Math.max(1, Math.min(8000, remainingResearchMs()))) }).catch(() => null);
    verifiedSeed = { ...verifiedSeed, storeWearer };
  }
  let discovery = null;
  let leads;
  let partnerCategories = [];
  if (specifiedPartner) {
    leads = [{ qlooId: specifiedPartner.qlooId, name: specifiedPartner.name,
      website: specifiedPartner.officialWebsite, description: specifiedPartner.description }];
  } else {
    // The brand-only list and the product's partner categories are asked at
    // the same time; Qloo is then asked for the brand's partners in those
    // categories. Both lists stay anchored on the starting brand alone.
    const anchor = userConstraints.heroProduct?.title ?? "";
    let genres;
    [discovery, genres] = await Promise.all([recommend(ownerUserId, seedQlooId, { limit: NATIVE_LEADS }),
      anchor ? chooseGenres({ seed, objective, anchor, genres: BRAND_GENRES }).catch(() => []) : []]);
    if (!["ok", "partial"].includes(discovery?.envelope?.status)) {
      // A request Qloo refuses outright (not retryable) will not work on a
      // retry: the brand's taste identity is unusable, not briefly unavailable.
      return { coverage: discovery?.envelope?.error?.retryable === false ? "qloo_brand_unusable"
        : "qloo_unavailable", candidates: [],
        opportunities: { supported: [], needs_verification: [], unsupported: [] } };
    }
    leads = nativeLeads(discovery.envelope, seedQlooId, NATIVE_LEADS);
    const perGenre = genres.length ? Math.ceil(CATEGORY_LEADS / genres.length) : 0;
    const byGenre = await Promise.all(genres.map((genre) => recommend(ownerUserId, seedQlooId,
      { limit: perGenre + 4, includeTag: genre.id }).then((found) => ({ genre, found })).catch(() => null)));
    const seen = new Set(leads.map((lead) => lead.qlooId));
    for (const entry of byGenre) {
      if (!["ok", "partial"].includes(entry?.found?.envelope?.status) || entry.found.sampleData) continue;
      let added = 0;
      for (const lead of nativeLeads(entry.found.envelope, seedQlooId, perGenre + 4)) {
        if (added >= perGenre || seen.has(lead.qlooId)) continue;
        seen.add(lead.qlooId); added += 1;
        leads.push({ ...lead, originalOrder: leads.length + 1, category: { genre: entry.genre,
          envelope: entry.found.envelope, responseId: entry.found.responseId } });
      }
    }
    partnerCategories = genres.map((genre) => genre.name);
    // Prefer an official website a user (or an earlier run) already verified
    // for this Qloo brand over Qloo's own website field, which is often empty.
    const known = await knownWebsites(leads.map((lead) => lead.qlooId)).catch(() => new Map());
    leads = leads.map((lead) => known.get(lead.qlooId)
      ? { ...lead, website: known.get(lead.qlooId), websiteSource: "verified_record" } : lead);
  }
  // Partners the user passed on for this brand (already working with them,
  // not right for the brand, not credible) are not researched again.
  const userExcluded = new Set(specifiedPartner ? [] : userFeedback?.excludedPartnerQlooIds ?? []);
  const excludedByUser = leads.filter((lead) => userExcluded.has(lead.qlooId));
  leads = leads.filter((lead) => !userExcluded.has(lead.qlooId));
  let seedTagsPromise = null;
  const seedTagsOnce = () => (seedTagsPromise ??= entityTags(ownerUserId, seedQlooId).catch(() => null));
  let seedAudiencePromise = null;
  const seedAudienceOnce = () => (seedAudiencePromise ??= audienceTags(ownerUserId, seedQlooId).catch(() => null));
  const candidates = [];
  const evaluated = [];
  let catalogCallsUsed = 0;
  let stopReason = "candidate_pool_exhausted";
  // Discovered partners are filtered against the chosen product and objective
  // before any identity check or Catalog call: a partner judged to add no value
  // is not researched. Likely fits go first. If the filter is unavailable, the
  // Qloo order is kept. A user-specified partner is never filtered.
  let leadFit = null;
  if (!specifiedPartner && leads.length) {
    leadFit = await triageLeads({ seed, leads, objective,
      anchor: userConstraints.heroProduct?.title ?? "", occasion: userConstraints.occasion ?? "",
      preferences: userConstraints.softPreferences ?? [] }).catch(() => null);
  }
  const fitOf = (lead) => leadFit?.[leads.indexOf(lead)] ?? "possible";
  // Brand descriptions are too thin to drop a partner (a "furniture retailer"
  // may sell dinnerware), so they only set the order. Every lead is screened
  // against its real catalog sample inside pair research; partners with no
  // value stop there, before deep search. Time and budget still bound the run.
  const excludedTrace = [];
  // Categories the starting store sells, and starting-product work, shared by
  // all partners in this run.
  const seedRange = new Map();
  const runShared = new Map();
  const rank = { likely: 0, possible: 1, unlikely: 2 };
  const hintOrder = [...leads].sort((a, b) =>
    rank[fitOf(a)] - rank[fitOf(b)] || (a.originalOrder ?? 0) - (b.originalOrder ?? 0));
  // Earlier research on these same partners (from any run) then moves proven
  // partners forward, unpromising ones back, and skips lasting identity failures.
  const memoryTiers = specifiedPartner ? new Map() : partnerMemoryTiers(
    await recallPartners({ qlooIds: leads.map((lead) => lead.qlooId), objective, market })
      .catch(() => []), userConstraints.heroProduct?.categoryId ?? null);
  const remembered = specifiedPartner ? { ordered: leads, skipped: [] }
    : orderLeadsWithMemory(hintOrder, memoryTiers);
  // Partners this user liked for this brand are researched first (still
  // verified live) unless the hint says they do not suit this product (a
  // liked partner for a pan, live 27 Oct, went first for a coffee maker);
  // the rest keep the memory and Qloo order.
  const preferred = new Set((specifiedPartner ? [] : userFeedback?.preferredPartnerQlooIds ?? [])
    .filter((id) => { const lead = leads.find((item) => item.qlooId === id);
      return !lead || fitOf(lead) !== "unlikely"; }));
  const selectedLeads = [...remembered.ordered.filter((lead) => preferred.has(lead.qlooId)),
    ...remembered.ordered.filter((lead) => !preferred.has(lead.qlooId))];
  for (const lead of excludedByUser) {
    excludedTrace.push({ name: lead.name, qlooId: lead.qlooId, originalQlooOrder: lead.originalOrder ?? null,
      status: "excluded_by_user" });
  }
  for (const lead of remembered.skipped) {
    excludedTrace.push({ name: lead.name, qlooId: lead.qlooId, originalQlooOrder: lead.originalOrder ?? null,
      status: "identity_unverified_recently", identityReason: memoryTiers.get(lead.qlooId).identityFailure });
  }
  // Product research stays one partner at a time so the shared Catalog budget
  // and rate-limit stop remain exact. Identity checks for the next few leads
  // start early, so a slow website does not hold up the research queue.
  const configuredIdentityConcurrency = Number(process.env.COMMERCE_IDENTITY_CONCURRENCY);
  const identityConcurrency = Number.isFinite(configuredIdentityConcurrency) &&
    configuredIdentityConcurrency >= 1 ? Math.min(6, Math.floor(configuredIdentityConcurrency)) : 3;
  const verifications = new Map();
  // A partner the user confirmed in the last 30 minutes reuses that proof, as
  // the starting brand does; research still re-checks its store and products.
  const partnerProof = specifiedPartner ? recentConfirmedSeed({ ...specifiedPartner,
    id: specifiedPartner.entityId }, specifiedPartner.qlooId) : null;
  const startVerification = (index) => {
    if (index < selectedLeads.length && !verifications.has(index) && partnerProof) {
      verifications.set(index, Promise.resolve({ identity: { ...partnerProof,
        id: specifiedPartner.qlooId, shopId: partnerProof.verifiedShopId }, trace: [] }));
    }
    if (index < selectedLeads.length && !verifications.has(index)) {
      // Qloo-suggested partners may fall back to web search; a user-chosen
      // partner was already confirmed by the user and never searches.
      verifications.set(index, verifyWithinDeadline({ ...selectedLeads[index], market },
        { allowSearch: !specifiedPartner }));
    }
  };
  // Three partners are researched at a time; each still runs its own exact
  // pair checks. A rate limit, time limit or exhausted budget stops new
  // partners from starting, and results keep the selected partner order.
  const configuredPartnerConcurrency = Number(process.env.COMMERCE_PARTNER_CONCURRENCY);
  const partnerConcurrency = specifiedPartner ? 1 : Number.isFinite(configuredPartnerConcurrency) &&
    configuredPartnerConcurrency >= 1 ? Math.min(3, Math.floor(configuredPartnerConcurrency)) : 3;
  let stopped = false;
  let reservedCalls = 0;
  const skippedUnlikely = [];
  const supportedCount = () => evaluated.filter((item) => item.assessment?.status === "supported").length;
  const stop = (reason) => { if (!stopped) stopReason = reason; stopped = true; };
  const researchLead = async (index, lead) => {
    const candidate = { name: lead.name, qlooId: lead.qlooId,
      originalQlooOrder: lead.originalOrder ?? null, status: "identity_unverified",
      ...(leadFit ? { productFitHint: fitOf(lead) } : {}),
      ...(lead.category ? { partnerCategory: lead.category.genre.name } : {}),
      ...(memoryTiers.has(lead.qlooId) ? { memoryTier: memoryTiers.get(lead.qlooId).tier } : {}) };
    candidates[index] = candidate;
    for (let next = index; next < index + identityConcurrency; next += 1) startVerification(next);
    const { identity: verifiedPartner, trace: identityTrace } = await verifications.get(index);
    if (!verifiedPartner) candidate.identityDiagnostics = identityTrace;
    if (!verifiedPartner || verifiedPartner.id === verifiedSeed.id) return;
    candidate.status = "identity_verified";
    candidate.officialWebsite = verifiedPartner.officialWebsite;
    if (stopped || remainingResearchMs() <= 0) {
      candidate.status = "research_time_limit_reached";
      stop("research_time_limit_reached"); return;
    }
    try {
      const culture = specifiedPartner ? await investigateDirect(ownerUserId,
        verifiedSeed, verifiedPartner) : { relationship: "native_recommendation_verified",
        explanation: "no_named_theme", theme: null, qlooResponseIds: [], sourceUrls: [] };
      // Both brands' Qloo taste tags: a shared specific tag can name the
      // cultural theme behind the recommendation (never a new gate).
      const partnerTags = specifiedPartner ? null
        : await entityTags(ownerUserId, verifiedPartner.qlooId).catch(() => null);
      const seedTags = specifiedPartner ? null : await seedTagsOnce();
      // Lifestyle and audience tags for the "who both brands appeal to" line.
      const [seedAudience, partnerAudience] = specifiedPartner ? [null, null] : await Promise.all([
        seedAudienceOnce(), audienceTags(ownerUserId, verifiedPartner.qlooId).catch(() => null)]);
      // A partner from a category request keeps that request as its evidence.
      const category = specifiedPartner ? null : lead.category ?? null;
      const cultureEvidence = specifiedPartner ? culture.supportProof ?? null : {
        seedQlooId, partnerQlooId: verifiedPartner.qlooId,
        unconstrained: !category && discovery.sampleData !== true,
        envelope: category ? category.envelope : discovery.envelope,
        ...(category ? { categoryTagId: category.genre.id } : {}),
        seedTags: seedTags?.tags ?? [], partnerTags: partnerTags?.tags ?? [],
        seedAudienceTags: seedAudience?.tags ?? [], partnerAudienceTags: partnerAudience?.tags ?? [] };
      const tagResponseIds = [category?.responseId, seedTags?.responseId, partnerTags?.responseId,
        seedAudience?.responseId, partnerAudience?.responseId].filter((id) => typeof id === "string");
      const configuredPartnerBudget = Number(process.env.COMMERCE_CATALOG_CALLS_PER_PARTNER);
      const partnerCeiling = Number.isFinite(configuredPartnerBudget) && configuredPartnerBudget > 0
        ? Math.max(22, Math.min(96, Math.floor(configuredPartnerBudget)))
        : userConstraints.heroProduct ? 56 : 22;
      if (stopped || remainingResearchMs() <= 0) {
        candidate.status = "research_time_limit_reached";
        stop("research_time_limit_reached"); return;
      }
      // Reserve this partner's Catalog allowance so concurrent partners never
      // exceed the run budget; unused calls are released when it finishes.
      const candidateBudget = Math.min(partnerCeiling, maxCatalogCalls - catalogCallsUsed - reservedCalls,
        Math.floor((maxCatalogCalls - catalogCallsUsed) / partnerConcurrency));
      if (candidateBudget < 8) { candidate.status = "catalog_budget_reached"; return; }
      reservedCalls += candidateBudget;
      // Most partners stop within seconds at the catalog screen, so time is not
      // pre-split by partner count; two partners run at a time instead, each up
      // to the per-partner limit and the run's remaining time.
      const partnerTimeLimit = Number(process.env.COMMERCE_PARTNER_RESEARCH_MS) || 120_000;
      const partnerTime = Math.min(remainingResearchMs(), partnerTimeLimit);
      let result;
      try {
        result = await researchPair({ seed: verifiedSeed,
          partner: { ...verifiedPartner, description: verifiedPartner.description ?? lead.description },
          objective, discoveryBasis: specifiedPartner ? "user_specified"
            : category ? "qloo_category_brand" : "qloo_native_brand",
          cultureEvidence, market, userConstraints, seedRange, runShared,
          // A partner the user chose to compare is assessed in full.
          userRejectedPairs: specifiedPartner ? [] : userFeedback?.rejectedPairKeys ?? [],
          maxCatalogCalls: candidateBudget, maxResearchMs: partnerTime });
      } finally { reservedCalls -= candidateBudget; }
      // A storefront or capability failure can return before making any
      // Catalog call. Charge only observed calls, never the whole allowance.
      catalogCallsUsed += Math.min(result.callsUsed ?? 0, candidateBudget);
      candidate.status = Object.values(result.opportunities).some((groups) => groups.length)
        ? "product_researched" : result.coverage === "partner_no_product_value"
          ? "no_product_value" : result.coverage;
      candidate.coverage = result.coverage;
      candidate.inspectedQueries = result.inspectedQueries ?? [];
      candidate.coverageIssues = result.coverageIssues ?? [];
      candidate.catalogCallsUsed = result.callsUsed ?? null;
      candidate.hypothesesConsidered = result.hypothesesConsidered ?? 0;
      candidate.assessedCount = result.assessedCount ?? 0;
      candidate.recommendableCount = result.recommendableCount ?? 0;
      candidate.observedCandidateCount = result.observedCandidateCount ?? 0;
      candidate.eligibleCandidateCount = result.eligibleCandidateCount ?? 0;
      candidate.screenedCandidateCount = result.screenedCandidateCount ?? 0;
      candidate.screeningBatchCount = result.screeningBatchCount ?? 0;
      candidate.exploredRoleCount = result.exploredRoleCount ?? 0;
      candidate.searchPagesFetched = result.searchPagesFetched ?? 0;
      candidate.exactDetailFailures = result.exactDetailFailures ?? 0;
      candidate.pairsSkippedFromMemory = result.pairsSkippedFromMemory ?? 0;
      candidate.pairsSkippedOwnRange = result.pairsSkippedOwnRange ?? 0;
      candidate.pairsSkippedByUser = result.pairsSkippedByUser ?? 0;
      candidate.partnerSellsStartingBrand = result.partnerSellsStartingBrand === true;
      candidate.productSearchPlanning = result.productSearchPlanning ?? "not_run";
      candidate.productSelectionPlanning = result.productSelectionPlanning ?? "not_run";
      candidate.stopReason = result.stopReason ?? null;
      if (result.memory) candidate.memory = result.memory;
      const hasOpportunity = Object.values(result.opportunities).some((groups) => groups.length);
      const rateLimited = result.coverageIssues?.includes("catalog_rate_limited") ||
        result.stopReason === "catalog_rate_limited";
      if (rateLimited && !hasOpportunity) candidate.status = "catalog_rate_limited";
      // Public-source review runs when the user saves an opportunity, not here.
      const vetting = { sourceUrls: [], findings: [] };
      for (const groups of Object.values(result.opportunities)) {
        for (const group of groups) for (const opportunity of [group.best, ...group.otherOpportunities]) {
          evaluated.push({ ...opportunity, partnerId: verifiedPartner.id,
            partnerName: verifiedPartner.name, partnerWebsite: verifiedPartner.officialWebsite,
            partnerDescription: String(lead.description ?? "").trim().slice(0, 400) || null,
            identitySourceUrl: verifiedPartner.identitySourceUrl,
            qlooEvidenceIds: [...culture.qlooResponseIds, ...tagResponseIds],
            culturalSourceUrls: culture.sourceUrls,
            externalSourceUrls: vetting.sourceUrls,
            externalFindings: vetting.findings ?? [] });
        }
      }
      if (rateLimited) { stop("catalog_rate_limited"); return; }
      if (remainingResearchMs() <= 0) { stop("research_time_limit_reached"); return; }
      // A partner using up its own allowance is not the run's budget: the
      // queue below stops when the run's calls are actually spent.
      if (result.stopReason === "catalog_unavailable") { stop(result.stopReason); return; }
    } catch (error) {
      candidate.status = error?.code === "catalog_rate_limited" ? "catalog_rate_limited"
        : error?.code === "catalog_budget_exhausted" ? "catalog_budget_reached"
          : error?.code === "catalog_unavailable" ? "catalog_unavailable" : "commerce_unavailable";
      if (["catalog_rate_limited", "catalog_unavailable"].includes(candidate.status)) {
        stop(candidate.status); return;
      }
    }
  };
  let nextLead = 0;
  const partnerWorker = async () => {
    while (!stopped && nextLead < selectedLeads.length) {
      if (remainingResearchMs() <= 0) { stop("research_time_limit_reached"); return; }
      // Stop before another identity check once too few calls remain for a partner.
      if (maxCatalogCalls - catalogCallsUsed - reservedCalls < 8) {
        if (!reservedCalls) stop("catalog_budget_reached");
        return;
      }
      const index = nextLead++;
      // With enough Supported results, partners the hint finds unsuited to
      // this product are not researched; the run finishes sooner.
      if (!specifiedPartner && fitOf(selectedLeads[index]) === "unlikely" &&
          supportedCount() >= ENOUGH_SUPPORTED) {
        skippedUnlikely.push(selectedLeads[index]);
        continue;
      }
      await researchLead(index, selectedLeads[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(partnerConcurrency, selectedLeads.length) },
    () => partnerWorker()));
  if (!stopped && remainingResearchMs() <= 0) stopReason = "research_time_limit_reached";
  if (stopReason === "candidate_pool_exhausted" && skippedUnlikely.length) stopReason = "enough_results";
  for (const lead of skippedUnlikely) {
    excludedTrace.push({ name: lead.name, qlooId: lead.qlooId, originalQlooOrder: lead.originalOrder ?? null,
      status: "skipped_enough_results", productFitHint: "unlikely",
      ...(lead.category ? { partnerCategory: lead.category.genre.name } : {}) });
  }
  if (stopReason === "candidate_pool_exhausted" && specifiedPartner === null &&
      leads.length > selectedLeads.length) {
    stopReason = "candidate_cap_reached";
  }
  const researched = candidates.filter(Boolean);
  const allScreenedOut = !evaluated.length && researched.some((item) => item.status === "no_product_value") &&
    researched.every((item) => ["no_product_value", "identity_unverified"].includes(item.status));
  return { discoveryBasis: specifiedPartner ? "user_specified" : "qloo_native_brand",
    qlooResponseId: discovery?.responseId ?? null, qlooInputHash: discovery?.inputHash ?? null,
    partnerCategories,
    coverage: evaluated.length ? "partial_assortment" : stopReason === "catalog_rate_limited"
      ? "catalog_rate_limited" : allScreenedOut ? "no_partner_product_fit"
        : "no_verified_product_opportunity",
    candidates: [...candidates.filter(Boolean), ...excludedTrace], catalogCallsUsed, stopReason, discoveryReturnedCount: leads.length,
    opportunities: rankCommerceOpportunities(evaluated) };
}
