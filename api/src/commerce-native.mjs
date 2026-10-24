import { personalQlooRecommendBrands, personalQlooRank } from "./personal-qloo.mjs";
import { withWebSearch, officialDomainOf } from "./web-research.mjs";
import { researchCommercePair } from "./commerce-research.mjs";
import { rankCommerceOpportunities } from "./brand-commerce.mjs";
import { investigateDirectCommerceCulture } from "./commerce-culture.mjs";
import { vetCommerceShortlist } from "./commerce-vetting.mjs";
import { discoverVerifiedStorefront, secureCatalogFetch } from "./shopify-catalog.mjs";

const QLOO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const businessName = (value) => String(value ?? "").trim()
  .replace(/(?:,?\s+)(?:incorporated|inc\.?|llc|ltd\.?|limited|corp\.?|corporation)$/i, "")
  .trim();
const matchesBusinessName = (value, name) => normalized(businessName(value)) ===
  normalized(businessName(name));
const seedIdentityCache = new Map();
const SEED_IDENTITY_TTL_MS = 10 * 60 * 1000;

// The Qloo website is a lead, not proof. A direct identity path requires the
// site's own exact name metadata and a UCP shop document on that host (or its
// verified alternate). Any missing link falls back to inspected web research.
export async function verifyFirstPartyCommerceBusiness(candidate, {
  fetchPage = secureCatalogFetch, discoverStorefront = discoverVerifiedStorefront,
} = {}) {
  const name = String(candidate?.name ?? "").trim();
  if (!QLOO_UUID.test(candidate?.qlooId ?? "") || name.length < 2) return null;
  let origin; let host;
  try {
    const url = new URL(candidate.website);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    origin = url.origin; host = url.hostname.toLowerCase();
  } catch { return null; }
  try {
    const response = await fetchPage(`${origin}/`, { headers: { accept: "text/html" },
      signal: AbortSignal.timeout(8000) });
    if (!response.ok || !String(response.contentType ?? "").toLowerCase().includes("text/html")) return null;
    const html = await response.text();
    const siteNames = [...html.matchAll(/<meta\b[^>]{0,1000}>/gi)].flatMap(([tag]) => {
      const attributes = Object.fromEntries([...tag.matchAll(/\b(property|name|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
        .map(([, key, double, single]) => [key.toLowerCase(), double ?? single]));
      return ["og:site_name", "application-name"].includes(
        String(attributes.property ?? attributes.name ?? "").toLowerCase())
        ? [attributes.content] : [];
    });
    const title = html.match(/<title\b[^>]*>([^<]{1,250})<\/title>/i)?.[1] ?? "";
    const titleBrand = title.split(/\s*[|–—:]\s*|\s+-\s+/)[0];
    if (![...siteNames, titleBrand].some((siteName) => matchesBusinessName(siteName, name))) return null;
    const store = await discoverStorefront(origin);
    if (!/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(store?.shopId ?? "") ||
        store.officialHost !== host ||
        store.proofUrl !== `https://${store.domain}/.well-known/ucp`) return null;
    return { id: candidate.qlooId, qlooId: candidate.qlooId, name,
      officialWebsite: origin, identityStatus: "verified",
      productHints: String(candidate.description ?? "").slice(0, 600),
      identitySourceUrl: `${origin}/`, storefrontProofUrl: store.proofUrl };
  } catch { return null; }
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

// Tavily is used only to locate and inspect official business evidence.
export async function verifyCommerceBusiness(candidate, {
  search = withWebSearch, firstParty = verifyFirstPartyCommerceBusiness,
} = {}) {
  const name = String(candidate?.name ?? "").trim();
  if (!QLOO_UUID.test(candidate?.qlooId ?? "") || name.length < 2) return null;
  const firstPartyIdentity = await firstParty(candidate);
  if (firstPartyIdentity) return firstPartyIdentity;
  // An exact-name .com is only a bounded lookup hypothesis. The first-party
  // verifier still requires matching site metadata and an official UCP shop.
  if (!candidate.website && /^[a-z0-9][a-z0-9 .&'-]{1,60}$/i.test(name)) {
    const host = normalized(name);
    if (host.length >= 4 && host.length <= 50) {
      const exactDomainIdentity = await firstParty({ ...candidate,
        website: `https://${host}.com` });
      if (exactDomainIdentity) return exactDomainIdentity;
    }
  }
  const qlooHost = officialDomainOf(candidate.website);
  const query = name + " official website";
  const response = await search(query, { ...(qlooHost ? { includeDomains: [qlooHost] } : {}),
    focus: name }).catch(() => null);
  const pages = (response?.results ?? []).filter((page) => page.inspected === true &&
    page.url?.startsWith("https://") && normalized(page.title).includes(normalized(name)) &&
    normalized(page.snippet).includes(normalized(name)));
  const byDomain = new Map();
  for (const page of pages) {
    const domain = officialDomainOf(page.url);
    if (domain && !byDomain.has(domain)) byDomain.set(domain, page);
  }
  const leads = [...byDomain.entries()].sort(([left], [right]) =>
    Number(right === qlooHost) - Number(left === qlooHost) ||
    Number(normalized(right.split(".")[0]) === normalized(name)) -
      Number(normalized(left.split(".")[0]) === normalized(name)));
  const verified = [];
  // Tavily locates candidate sites; only the site's own business name and
  // linked UCP shop can establish identity. Check all bounded leads to avoid
  // silently choosing one of two genuinely verified businesses.
  for (const [, page] of leads.slice(0, 4)) {
    const origin = new URL(page.url).origin;
    const proof = await firstParty({ ...candidate, website: origin }).catch(() => null);
    if (proof?.identityStatus === "verified" && proof.qlooId === candidate.qlooId) {
      verified.push({ ...proof, identitySourceUrl: page.url,
        identitySourceHash: page.sourceHash ?? null });
    }
  }
  return verified.length === 1 ? verified[0] : null;
}

// A user correction changes the website hypothesis, never the selected Qloo
// identity. The chosen business and its shop must both be verified before the
// corrected association is persisted.
export async function verifySelectedCommerceBrand(candidate, officialWebsite = null, {
  verifyBusiness = verifyCommerceBusiness,
  discoverStorefront = discoverVerifiedStorefront,
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
  const verified = await verifyBusiness({ ...candidate, website });
  if (verified?.identityStatus !== "verified" || !verified.officialWebsite ||
      verified.qlooId !== candidate.qlooId) return null;
  if (officialWebsite !== null &&
      officialDomainOf(verified.officialWebsite) !== officialDomainOf(website)) return null;
  const store = await discoverStorefront(verified.officialWebsite).catch(() => null);
  return store?.shopId ? { ...verified, shopId: store.shopId } : null;
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
  maxResearchMs = Number(process.env.COMMERCE_RUN_RESEARCH_MS) || 300_000 }, {
  recommend = personalQlooRecommendBrands, focused = personalQlooRank,
  verifyBusiness = verifyCommerceBusiness, researchPair = researchCommercePair,
  discoverStorefront = discoverVerifiedStorefront,
  investigateDirect = investigateDirectCommerceCulture,
  vetShortlist = vetCommerceShortlist,
  maxCandidates = 6, now = () => Date.now() } = {}) {
  if (!QLOO_UUID.test(seedQlooId ?? "") || !["product_bundle", "cross_sell"].includes(objective)) {
    throw new Error("Verified native brand and commerce objective required.");
  }
  const startedAt = now();
  const remainingResearchMs = () => Number.isFinite(maxResearchMs) && maxResearchMs > 0
    ? Math.max(0, maxResearchMs - (now() - startedAt)) : Infinity;
  const seedCacheKey = JSON.stringify([ownerUserId, seedQlooId, seed.name, seed.officialWebsite]);
  const cachedSeed = verifyBusiness === verifyCommerceBusiness
    ? seedIdentityCache.get(seedCacheKey) : null;
  const verifiedSeed = cachedSeed?.expiresAt > Date.now() ? cachedSeed.identity
    : await verifyBusiness({ qlooId: seedQlooId, name: seed.name,
      website: seed.officialWebsite, description: seed.description });
  if (verifiedSeed && verifyBusiness === verifyCommerceBusiness) {
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
      candidates: [], opportunities: { supported: [], needs_verification: [], unsupported: [] } };
  }
  let discovery = null;
  let leads;
  if (specifiedPartner) {
    leads = [{ qlooId: specifiedPartner.qlooId, name: specifiedPartner.name,
      website: specifiedPartner.officialWebsite, description: specifiedPartner.description }];
  } else {
    discovery = await recommend(ownerUserId, seedQlooId);
    if (!["ok", "partial"].includes(discovery?.envelope?.status)) {
      return { coverage: "qloo_unavailable", candidates: [],
        opportunities: { supported: [], needs_verification: [], unsupported: [] } };
    }
    leads = nativeLeads(discovery.envelope, seedQlooId, 12);
  }
  const candidates = [];
  const evaluated = [];
  let catalogCallsUsed = 0;
  let stopReason = "candidate_pool_exhausted";
  const selectedLeads = specifiedPartner ? leads : selectNativeCommerceLeads(leads, maxCandidates);
  for (const lead of selectedLeads) {
    if (remainingResearchMs() <= 0) { stopReason = "research_time_limit_reached"; break; }
    if (catalogCallsUsed >= maxCatalogCalls) { stopReason = "catalog_budget_reached"; break; }
    const candidate = { name: lead.name, qlooId: lead.qlooId,
      originalQlooOrder: lead.originalOrder ?? null, status: "identity_unverified" };
    candidates.push(candidate);
    const verifiedPartner = await verifyBusiness(lead);
    if (!verifiedPartner || verifiedPartner.id === verifiedSeed.id) continue;
    candidate.status = "identity_verified";
    candidate.officialWebsite = verifiedPartner.officialWebsite;
    if (remainingResearchMs() <= 0) {
      candidate.status = "research_time_limit_reached";
      stopReason = "research_time_limit_reached"; break;
    }
    try {
      const culture = specifiedPartner ? await investigateDirect(ownerUserId,
        verifiedSeed, verifiedPartner) : { relationship: "native_recommendation_verified",
        explanation: "no_named_theme", theme: null, qlooResponseIds: [], sourceUrls: [] };
      const cultureEvidence = specifiedPartner ? culture.supportProof ?? null : {
        seedQlooId, partnerQlooId: verifiedPartner.qlooId,
        unconstrained: discovery.sampleData !== true,
        envelope: discovery.envelope };
      const configuredPartnerBudget = Number(process.env.COMMERCE_CATALOG_CALLS_PER_PARTNER);
      const partnerCeiling = Number.isFinite(configuredPartnerBudget) && configuredPartnerBudget > 0
        ? Math.max(22, Math.min(96, Math.floor(configuredPartnerBudget)))
        : userConstraints.heroProduct ? 56 : 22;
      if (remainingResearchMs() <= 0) {
        candidate.status = "research_time_limit_reached";
        stopReason = "research_time_limit_reached"; break;
      }
      const candidateBudget = Math.min(partnerCeiling, maxCatalogCalls - catalogCallsUsed);
      const partnerTimeLimit = Number(process.env.COMMERCE_PARTNER_RESEARCH_MS) || 120_000;
      const result = await researchPair({ seed: verifiedSeed, partner: verifiedPartner,
        objective, discoveryBasis: specifiedPartner ? "user_specified" : "qloo_native_brand",
        cultureEvidence, market, userConstraints,
        maxCatalogCalls: candidateBudget,
        maxResearchMs: Math.min(partnerTimeLimit, remainingResearchMs()) });
      // A storefront or capability failure can return before making any
      // Catalog call. Charge only observed calls, never the whole allowance.
      catalogCallsUsed += Math.min(result.callsUsed ?? 0, candidateBudget);
      candidate.status = Object.values(result.opportunities).some((groups) => groups.length)
        ? "product_researched" : result.coverage;
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
      candidate.productSearchPlanning = result.productSearchPlanning ?? "not_run";
      candidate.productSelectionPlanning = result.productSelectionPlanning ?? "not_run";
      candidate.stopReason = result.stopReason ?? null;
      const hasOpportunity = Object.values(result.opportunities).some((groups) => groups.length);
      const rateLimited = result.coverageIssues?.includes("catalog_rate_limited") ||
        result.stopReason === "catalog_rate_limited";
      if (rateLimited && !hasOpportunity) candidate.status = "catalog_rate_limited";
      const vetting = hasOpportunity && !rateLimited && remainingResearchMs() > 0
        ? await vetShortlist(verifiedPartner).catch(() =>
        ({ status: "not_verified", sourceUrls: [] })) : { status: "not_needed", sourceUrls: [] };
      candidate.vettingStatus = vetting.status;
      // Focused native evidence is a claim check, not a new recommendation.
      const nativeFocus = !rateLimited && !specifiedPartner &&
        remainingResearchMs() > 0 && candidate.status === "product_researched"
        ? await focused(ownerUserId, seedQlooId, lead.qlooId).catch(() => null) : null;
      for (const groups of Object.values(result.opportunities)) {
        for (const group of groups) for (const opportunity of [group.best, ...group.otherOpportunities]) {
          evaluated.push({ ...opportunity, partnerId: verifiedPartner.id,
            partnerName: verifiedPartner.name, partnerWebsite: verifiedPartner.officialWebsite,
            identitySourceUrl: verifiedPartner.identitySourceUrl,
            qlooEvidenceIds: [...culture.qlooResponseIds,
              ...(nativeFocus?.responseId ? [nativeFocus.responseId] : [])],
            culturalSourceUrls: culture.sourceUrls,
            externalSourceUrls: vetting.sourceUrls,
            externalFindings: vetting.findings ?? [] });
        }
      }
      if (rateLimited) { stopReason = "catalog_rate_limited"; break; }
      if (remainingResearchMs() <= 0) { stopReason = "research_time_limit_reached"; break; }
      if (["catalog_unavailable", "catalog_budget_reached"].includes(result.stopReason)) {
        stopReason = result.stopReason; break;
      }
    } catch (error) {
      candidate.status = error?.code === "catalog_rate_limited" ? "catalog_rate_limited"
        : error?.code === "catalog_budget_exhausted" ? "catalog_budget_reached"
          : error?.code === "catalog_unavailable" ? "catalog_unavailable" : "commerce_unavailable";
      if (["catalog_rate_limited", "catalog_budget_reached", "catalog_unavailable"]
        .includes(candidate.status)) {
        stopReason = candidate.status; break;
      }
    }
  }
  if (stopReason === "candidate_pool_exhausted" && leads.length > maxCandidates) {
    stopReason = "candidate_cap_reached";
  }
  return { discoveryBasis: specifiedPartner ? "user_specified" : "qloo_native_brand",
    qlooResponseId: discovery?.responseId ?? null, qlooInputHash: discovery?.inputHash ?? null,
    coverage: evaluated.length ? "partial_assortment" : stopReason === "catalog_rate_limited"
      ? "catalog_rate_limited" : "no_verified_product_opportunity",
    candidates, catalogCallsUsed, stopReason, discoveryReturnedCount: leads.length,
    opportunities: rankCommerceOpportunities(evaluated) };
}
