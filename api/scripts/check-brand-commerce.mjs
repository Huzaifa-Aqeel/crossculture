import assert from "node:assert/strict";
import { catalogClient, catalogEndpoint, discoverVerifiedStorefront, PROFILE_EXAMPLE,
  verifyCatalogOffer } from "../src/shopify-catalog.mjs";
import { productPairKeyFor } from "../src/research-memory.mjs";
import { productKind, titleKind } from "../src/product-taxonomy.mjs";
import { assessCommerceOpportunity, durableCommerceDecision,
  rankCommerceOpportunities, customerText } from "../src/brand-commerce.mjs";
import { validateCommerceEvidence, hasExplicitThirdPartyCoBrand } from "../src/commerce-evidence.mjs";
import { chooseProductCombinations, isCommerceMerchandise, observedProductQueries, productMechanism,
  transientProductFacts, validatePartnerSearchPlan, prioritizeObservedPartnerProducts,
  prioritizePartnerResearchProducts, mergeRefinedSearchPlans,
  commerceRoleKey, prioritizeUnexploredRole,
  usefulCollectionSearch, collectionMatchesPlan, searchResultMatchesQuery, productWearer, brandWearer, unsupportedPartnerFormat } from "../src/commerce-products.mjs";
import { parseCommerceMechanismProposal, parseCommerceMechanismRubric,
  parsePartnerProductSearchPlan, parsePartnerProductSelection, withoutUnstatedOccasion } from "../src/commerce-mechanism.mjs";
import { researchCommercePair } from "../src/commerce-research.mjs";
import { researchNativeCommerce, selectNativeCommerceLeads,
  verifyCommerceBusiness, verifyFirstPartyCommerceBusiness,
  verifySelectedCommerceBrand, recentConfirmedSeed, siteNameMatchesBrand,
  reuseRecentCommerceConfirmation } from "../src/commerce-native.mjs";
import { investigateDirectCommerceCulture } from "../src/commerce-culture.mjs";
import { publicIpAddress } from "../src/shopify-catalog.mjs";
import { currentCommerceAssessment, refreshCommerceOffers } from "../src/commerce-offer-refresh.mjs";
import { vetCommerceShortlist } from "../src/commerce-vetting.mjs";
import { commerceProposal, culturalSummary } from "../src/proposal-template.mjs";
import { isDomain } from "../src/web-research.mjs";
import { normalizeQlooBrands, matchingQlooBrandCandidates } from "../src/brand-resolution.mjs";
import { productSearchInput, exactProductName } from "../src/commerce-preview.mjs";

function fixtureResponse(data) { return { ok: true, status: 200, json: async () => ({ result: data }) }; }
assert.equal(isDomain("https://hanselfrombasel.com/pages/about", "hanselfrombasel.com"), true);
assert.equal(isDomain("https://shop.hanselfrombasel.com/about", "hanselfrombasel.com"), true);
assert.equal(isDomain("https://hanselfrombasel.com.evil.test/about", "hanselfrombasel.com"), false);
const businessId = "a72c6e3a-1985-4da8-8279-3080e2283028";
const inspectedPage = (url) => ({ url, title: "Cuyana | Premium essentials",
  snippet: "Cuyana makes premium essentials.", inspected: true });
const fishwifePage = (url) => ({ url, title: "Fishwife Tinned Seafood Co.",
  snippet: "Fishwife sells tinned seafood.", inspected: true });
// Identity order: Qloo website, then brandname.com; no web search.
const fishwifeSites = [];
const fishwifeProof = async (candidate) => { fishwifeSites.push(candidate.website);
  return candidate.website === "https://fishwife.com" ? { qlooId: businessId, name: "Fishwife",
    officialWebsite: candidate.website, identityStatus: "verified" } : null; };
const guessedFirst = await verifyCommerceBusiness({ qlooId: businessId, name: "Fishwife",
  website: "https://old-fishwife.example.com" }, { firstParty: fishwifeProof });
assert.equal(guessedFirst?.officialWebsite, "https://fishwife.com");
assert.deepEqual(fishwifeSites, ["https://old-fishwife.example.com", "https://fishwife.com"]);
const needsWebsiteTrace = [];
assert.equal(await verifyCommerceBusiness({ qlooId: businessId, name: "Our Place" },
  { firstParty: async () => null, trace: needsWebsiteTrace }), null);
assert.equal(needsWebsiteTrace.at(-1).reason, "official_website_needed",
  "When neither site verifies, the user enters the official website");
assert.equal(siteNameMatchesBrand("Faherty Brand", "Faherty"), true);
assert.equal(siteNameMatchesBrand("Oak + Fort", "Oak + Fort"), true);
assert.equal(siteNameMatchesBrand("HydroFlask", "Hydro Flask"), true);
assert.equal(siteNameMatchesBrand("Salomon", "On"), false, "Whole words only");
assert.equal(siteNameMatchesBrand("Fahertyish Goods", "Faherty"), false);
const disambiguated = normalizeQlooBrands({ status: "needs_input", results: [],
  resolution: { issues: [{ candidates: [
    { id: businessId, name: "Cuyana", type: "urn:entity:brand", description: "Leather goods" },
    { id: "place-1", name: "Cuyana", type: "urn:entity:place" },
  ] }] } });
assert.equal(disambiguated.length, 1);
assert.equal(disambiguated[0].id, businessId);
assert.equal(disambiguated[0].description, "Leather goods");
// Live Qloo lookup for P.F. Candle Co. returned the unrelated Harlem Candle Co.
// as a semantic brand resolution. A valid brand type alone cannot make it a
// selectable identity for the searched business.
const semanticNeighbour = normalizeQlooBrands({ status: "ok",
  results: [{ entity_id: businessId, name: "Harlem Candle Co.",
    subtype: "urn:entity:brand" }] });
assert.equal(matchingQlooBrandCandidates(semanticNeighbour, "P.F. Candle Co.").length, 0);
assert.equal(matchingQlooBrandCandidates(semanticNeighbour, "Harlem Candle Co.").length, 1);
assert.equal(matchingQlooBrandCandidates([{ name: "PF Candle Company" }],
  "P.F. Candle Co.").length, 1, "Punctuation and Co./Company spelling are equivalent");
// Brand search results omit the type; Qloo's resolution states it. A person
// named like a brand is never offered as the brand (Graza, a Polish colorist,
// 27 Oct), and a result whose type is unknown is not offered either.
const personId = "9ad1e13d-42af-4798-bdf7-45e9c78ad952";
const searched = (type) => normalizeQlooBrands({ status: "ok",
  results: [{ entity_id: personId, name: "Graza", properties: { description: "Polish colorist" } }],
  resolution: { outcomes: [{ input: "Graza", status: "resolved",
    ...(type ? { selected: { id: personId, name: "Graza", type } } : {}) }] } });
assert.equal(searched("urn:entity:person").length, 0, "A person is not a brand");
assert.equal(searched(null).length, 0, "An entity of unknown type is not offered as a brand");
assert.equal(searched("urn:entity:brand").length, 1);
assert.equal(normalizeQlooBrands({ status: "ok", results: [{ entity_id: personId, name: "Graza",
  type: "urn:entity", subtype: "urn:entity:brand" }] }).length, 1, "Recommendation-style subtype counts");
const hypothesizedSites = [];
const inferredIdentity = await verifyCommerceBusiness({ qlooId: businessId, name: "Cuyana" }, {
  firstParty: async (candidate) => { hypothesizedSites.push(candidate.website);
    return candidate.website === "https://cuyana.com"
      ? { officialWebsite: candidate.website, identityStatus: "verified" } : null; },
});
assert.equal(inferredIdentity.officialWebsite, "https://cuyana.com");
assert.deepEqual(hypothesizedSites, ["https://cuyana.com"]);
const directIdentity = { qlooId: businessId, name: "Cuyana",
  website: "https://www.cuyana.com" };
let identitySearches = 0;
const firstParty = (candidate, siteName = "Cuyana", shopId = "gid://shopify/Shop/7",
  officialHost = "www.cuyana.com") => verifyFirstPartyCommerceBusiness(candidate, {
  fetchPage: async () => ({ ok: true, contentType: "text/html; charset=utf-8",
    text: async () => `<html><meta content="${siteName}" property="og:site_name"></html>` }),
  discoverStorefront: async () => ({ officialHost, shopId,
    domain: "checkout.cuyana.com", proofUrl: "https://checkout.cuyana.com/.well-known/ucp" }),
});
const directVerified = await verifyCommerceBusiness(directIdentity, {
  firstParty: (candidate) => firstParty(candidate),
});
assert.equal(directVerified?.officialWebsite, "https://www.cuyana.com");
assert.equal(directVerified?.storefrontProofUrl,
  "https://checkout.cuyana.com/.well-known/ucp");
assert.equal(identitySearches, 0);
const corrected = await verifySelectedCommerceBrand({ qlooId: businessId, name: "Cuyana" },
  "https://www.cuyana.com", { verifyBusiness: async (candidate) => ({ ...candidate,
    officialWebsite: candidate.website, identityStatus: "verified" }),
  discoverStorefront: async () => ({ shopId: "gid://shopify/Shop/7" }) });
assert.equal(corrected.qlooId, businessId);
assert.equal(corrected.shopId, "gid://shopify/Shop/7");
assert.equal(await verifySelectedCommerceBrand({ qlooId: businessId, name: "Cuyana" },
  "https://www.cuyana.com", { verifyBusiness: async (candidate) => ({ ...candidate,
    officialWebsite: candidate.website, identityStatus: "verified",
    shopId: "gid://shopify/Shop/7" }),
  discoverStorefront: async () => ({ shopId: "gid://shopify/Shop/8" }) }), null);
const confirmedSeed = { id: "seed-entity", qlooId: businessId,
  proofQlooId: businessId, name: "Cuyana", identityStatus: "verified",
  officialWebsite: "https://www.cuyana.com",
  proofOfficialWebsite: "https://www.cuyana.com",
  identitySourceUrl: "https://www.cuyana.com/",
  storefrontProofUrl: "https://checkout.cuyana.com/.well-known/ucp",
  verifiedShopId: "gid://shopify/Shop/7",
  identityVerifiedAt: "2026-10-24T12:00:00.000Z" };
const proofNow = Date.parse("2026-10-24T12:05:00.000Z");
assert.equal(recentConfirmedSeed(confirmedSeed, businessId, proofNow)?.verifiedShopId,
  "gid://shopify/Shop/7");
assert.equal(recentConfirmedSeed({ ...confirmedSeed,
  proofQlooId: "different" }, businessId, proofNow), null);
assert.equal(recentConfirmedSeed({ ...confirmedSeed,
  storefrontProofUrl: "https://other-shop.example.com/.well-known/ucp" },
businessId, proofNow), null);
assert.equal(recentConfirmedSeed({ ...confirmedSeed,
  identityVerifiedAt: "2026-10-24T11:00:00.000Z" }, businessId, proofNow), null);
assert.equal(reuseRecentCommerceConfirmation({ id: businessId, name: "Cuyana" },
  confirmedSeed, null, proofNow)?.id, confirmedSeed.id);
assert.equal(reuseRecentCommerceConfirmation({ id: businessId, name: "Cuyana" },
  confirmedSeed, "https://www.cuyana.com/", proofNow)?.id, confirmedSeed.id);
assert.equal(reuseRecentCommerceConfirmation({ id: businessId, name: "Cuyana" },
  confirmedSeed, "https://other.example.com", proofNow), null);
assert.equal(reuseRecentCommerceConfirmation({ id: businessId, name: "Another" },
  confirmedSeed, null, proofNow), null);
assert.equal(await verifySelectedCommerceBrand({ qlooId: businessId, name: "Cuyana" },
  "http://cuyana.com", { verifyBusiness: async () => { throw new Error("must not run"); } }), null);
assert.equal(await verifySelectedCommerceBrand({ qlooId: businessId, name: "Cuyana" },
  "https://cuyana.com", { verifyBusiness: async () => ({ qlooId: "other",
    officialWebsite: "https://cuyana.com" }) }), null);
assert.equal(await verifySelectedCommerceBrand({ qlooId: businessId, name: "Cuyana" },
  "https://cuyana.com", { verifyBusiness: async (candidate) => ({ ...candidate,
    officialWebsite: candidate.website }), discoverStorefront: async () => null }), null);
const titleVerified = await firstParty(directIdentity, "Cuyana, LLC");
assert.equal(titleVerified?.identityStatus, "verified");
const titleOnly = await verifyFirstPartyCommerceBusiness(directIdentity, {
  fetchPage: async () => ({ ok: true, contentType: "text/html",
    text: async () => "<html><title>Cuyana | Premium essentials</title></html>" }),
  discoverStorefront: async () => ({ officialHost: "www.cuyana.com",
    shopId: "gid://shopify/Shop/7", domain: "checkout.cuyana.com",
    proofUrl: "https://checkout.cuyana.com/.well-known/ucp" }),
});
assert.equal(titleOnly?.identityStatus, "verified");
const colonTitle = await verifyFirstPartyCommerceBusiness({ ...directIdentity,
  name: "AllTrails", website: "https://www.alltrails.com" }, {
  fetchPage: async () => ({ ok: true, contentType: "text/html",
    text: async () => "<html><title>AllTrails: Trail Guides & Maps | AllTrails</title></html>" }),
  discoverStorefront: async () => ({ officialHost: "www.alltrails.com",
    shopId: "gid://shopify/Shop/7", domain: "shop.alltrails.com",
    proofUrl: "https://shop.alltrails.com/.well-known/ucp" }),
});
assert.equal(colonTitle?.identityStatus, "verified");
const wrongTitle = await verifyFirstPartyCommerceBusiness(directIdentity, {
  fetchPage: async () => ({ ok: true, contentType: "text/html",
    text: async () => "<html><title>Unrelated retailer | Premium essentials</title></html>" }),
  discoverStorefront: async () => ({ officialHost: "www.cuyana.com",
    shopId: "gid://shopify/Shop/7", domain: "checkout.cuyana.com",
    proofUrl: "https://checkout.cuyana.com/.well-known/ucp" }),
});
assert.equal(wrongTitle, null);
for (const [siteName, shopId, officialHost] of [
  ["Different Company", "gid://shopify/Shop/7", "www.cuyana.com"],
  ["Cuyana", null, "www.cuyana.com"],
  ["Cuyana", "gid://shopify/Shop/7", "retailer.example.com"],
]) {
  const fallback = await verifyCommerceBusiness(directIdentity, {
    firstParty: (candidate) => firstParty(candidate, siteName, shopId, officialHost),
  });
  assert.equal(fallback, null);
}
const calls = [];
const productStore = { domain: "shop.example.com", endpointHost: "shop.example.com" };
// A typed product's own name (with or without a variant suffix) is that one
// product; a longer name is a different product (Petite Cooker, 27 Oct).
assert.ok(exactProductName("Petite Cooker - Navy", "petite cooker"));
assert.ok(exactProductName("Sauté Pan", "saute pan"));
assert.ok(!exactProductName("Petite Cooker Set", "Petite Cooker"));
assert.ok(!exactProductName("Mini Petite Cooker", "Petite Cooker"));
assert.deepEqual(productSearchInput("  Bath towel  ", "https://seed.example.com", productStore),
  { query: "Bath towel", exactHandle: null });
assert.deepEqual(productSearchInput("https://seed.example.com/products/bath-towel?variant=11",
  "https://seed.example.com", productStore),
  { query: "bath towel", exactHandle: "bath-towel" });
// The store with or without "www.", and a product reached through a
// collection, are the same product page (Wild One, 27 Oct).
assert.deepEqual(productSearchInput("https://www.seed.example.com/collections/bath/products/Bath-Towel",
  "https://seed.example.com", productStore), { query: "Bath Towel", exactHandle: "bath-towel" });
assert.deepEqual(productSearchInput("https://seed.example.com/products/bath-towel",
  "https://www.seed.example.com", productStore), { query: "bath towel", exactHandle: "bath-towel" });
assert.throws(() => productSearchInput("https://other.example.com/products/bath-towel",
  "https://seed.example.com", productStore), /verified brand store/);
assert.throws(() => productSearchInput("https://seed.example.com/collections/all",
  "https://seed.example.com", productStore), /verified brand store/);
assert.equal(isCommerceMerchandise({ title: "Gift Card" }), false);
assert.equal(isCommerceMerchandise({ title: "Digital Gift Card - Strawberry" }), false);
assert.equal(isCommerceMerchandise({ title: "E-Gift Certificate" }), false);
assert.equal(isCommerceMerchandise({ title: "Holiday treat", gift_card: true }), false);
assert.equal(isCommerceMerchandise({ title: "Pickup in Store" }), false);
assert.equal(isCommerceMerchandise({ title: "Gift Card Holder" }), true);
assert.equal(isCommerceMerchandise({ title: "Nylon Loaf Bag" }), true);
assert.equal(hasExplicitThirdPartyCoBrand({ title: "AllTrails × Cotopaxi Bataan 3L Pack" },
  "AllTrails"), true);
assert.equal(hasExplicitThirdPartyCoBrand({ title: "AllTrails Trail Pack" },
  "AllTrails"), false);
assert.equal(hasExplicitThirdPartyCoBrand({ title: "Cotopaxi Bataan 3L Pack" },
  "AllTrails"), false);
assert.deepEqual(observedProductQueries([
  { title: "Gift Card", product_type: "Gift card" },
  { title: "Tufted Bath Mat", product_type: "Bath Mat" },
  { title: "Cotton Towel", product_type: "Towel" },
]), ["Bath Mat", "Towel"]);
assert.deepEqual(observedProductQueries([
  ...Array.from({ length: 5 }, () => ({ title: "First", product_type: "Bag" })),
  ...Array.from({ length: 5 }, () => ({ title: "Middle", product_type: "Book" })),
  ...Array.from({ length: 5 }, () => ({ title: "Last", product_type: "Pouch" })),
]), ["Bag", "Book", "Pouch"]);
const sampleVariant = { id: "gid://shopify/ProductVariant/1" };
assert.deepEqual(chooseProductCombinations(
  [{ id: "gid://shopify/Product/1", title: "Nylon Bag", variants: [sampleVariant] }],
  [{ id: "gid://shopify/Product/2", title: "Gift Card", variants: [sampleVariant] }],
  "product_bundle"), []);
const product = { id: "gid://shopify/Product/10", title: "Bath towel", variants: [
  { id: "gid://shopify/ProductVariant/11", options: [{ name: "Color", label: "Blue" }],
    price: { amount: 4400, currency: "USD" }, availability: { available: true } },
  { id: "gid://shopify/ProductVariant/12", options: [{ name: "Color", label: "Red" }] }] };
const client = catalogClient({ profileUrl: PROFILE_EXAMPLE, fetcher: async (url, options) => {
  const request = JSON.parse(options.body); calls.push({ url, request });
  if (request.method === "tools/list") return fixtureResponse({ tools: [
    { name: "search_catalog" }, { name: "lookup_catalog" }] });
  return fixtureResponse({ structuredContent: { products: [product], ucp: { status: "success" } } });
} });
assert.equal(catalogEndpoint("checkout.example.com"), "https://checkout.example.com/api/ucp/mcp");
assert.throws(() => catalogEndpoint("127.0.0.1"), /verified storefront domain/);
const discovered = await discoverVerifiedStorefront("https://example.com", { fetcher: async (url) => {
  if (url.includes("https://example.com/")) return { ok: false };
  return { ok: true, json: async () => ({ ucp: { version: "2026-08-25",
    capabilities: { "dev.ucp.shopping.catalog.search": [{}] },
    services: { "dev.ucp.shopping": [{ transport: "mcp", version: "2026-08-25",
      endpoint: "https://example.myshopify.com/api/ucp/mcp" }] },
    payment_handlers: { "dev.shopify.shop_pay": [{ config: { shop_id: "7" } }] } } }) };
} });
assert.equal(discovered.domain, "checkout.example.com");
assert.equal(discovered.shopId, "gid://shopify/Shop/7");
const shopDomain = await discoverVerifiedStorefront("https://example.com", { fetcher: async (url) => {
  if (!url.startsWith("https://shop.example.com/")) return { ok: false };
  return { ok: true, json: async () => ({ ucp: { version: "2026-08-25",
    capabilities: { "dev.ucp.shopping.catalog.search": [{}] },
    services: { "dev.ucp.shopping": [{ transport: "mcp", version: "2026-08-25",
      endpoint: "https://shop.example.com/api/ucp/mcp" }] },
    payment_handlers: { "dev.shopify.shop_pay": [{ config: { shop_id: "7" } }] } } }) };
} });
assert.equal(shopDomain.domain, "shop.example.com");
const wwwStore = await discoverVerifiedStorefront("https://www.example.com", {
  fetcher: async (url) => url.startsWith("https://shop.example.com/")
    ? { ok: true, json: async () => ({ ucp: { version: "2026-08-25",
      capabilities: { "dev.ucp.shopping.catalog.search": [{}] },
      services: { "dev.ucp.shopping": [{ transport: "mcp", version: "2026-08-25",
        endpoint: "https://shop.example.com/api/ucp/mcp" }] },
      payment_handlers: { "dev.shopify.shop_pay": [{ config: { shop_id: "7" } }] } } }) }
    : { ok: false },
});
assert.equal(wwwStore.officialHost, "www.example.com");
assert.equal(wwwStore.domain, "shop.example.com");
await assert.rejects(discoverVerifiedStorefront("https://www.example.com",
  { onlyDomain: "unrelated.example.net", fetcher: async () => ({ ok: false }) }),
  /not associated/);
const tools = await client.tools("merchant.example.com");
assert.deepEqual([...tools], ["search_catalog", "lookup_catalog"]);
await client.search("global", "Bath towel", tools, { market: "GB",
  shops: ["gid://shopify/Shop/7"] });
assert.equal(calls.at(-1).request.params.arguments.catalog.filters.ships_to.country, "GB");
assert.deepEqual(calls.at(-1).request.params.arguments.catalog.filters.shops,
  ["gid://shopify/Shop/7"]);
const budgetedClient = catalogClient({ profileUrl: PROFILE_EXAMPLE, maxCalls: 1,
  fetcher: async () => fixtureResponse({ tools: [{ name: "search_catalog" }] }) });
await budgetedClient.tools("global");
await assert.rejects(budgetedClient.tools("global"), (error) => error.code === "catalog_budget_exhausted");
assert.equal(budgetedClient.callsUsed(), 1);
const selected = await client.detail("merchant.example.com", product.id, product.variants[0].id,
  [{ name: "Color", label: "Blue" }], tools);
assert.equal(selected.variant.id, product.variants[0].id);
assert.equal(calls.at(-1).request.params.name, "lookup_catalog");
const mixedCalls = [];
const mixedClient = catalogClient({ profileUrl: PROFILE_EXAMPLE, fetcher: async (_url, options) => {
  const request = JSON.parse(options.body);
  mixedCalls.push(request);
  return fixtureResponse({ structuredContent: { products: [{ ...product,
    variants: request.params.name === "get_product"
      ? [request.params.arguments.catalog.selected?.length ? product.variants[1] : product.variants[0]]
      : product.variants }],
  ucp: { status: "success" } } });
} });
const nonDefault = await mixedClient.detail("merchant.example.com", product.id,
  product.variants[1].id, null, new Set(["get_product", "lookup_catalog"]));
assert.equal(nonDefault.variant.id, product.variants[1].id);
assert.equal(mixedCalls.at(-1).params.name, "lookup_catalog");
await mixedClient.detail("merchant.example.com", product.id, product.variants[1].id,
  product.variants[1].options, new Set(["get_product", "lookup_catalog"]));
assert.equal(mixedCalls.at(-1).params.name, "get_product");
const offer = verifyCatalogOffer({ ...selected, marketSignal: "global_us_filter", variant: {
  ...selected.variant, seller: { id: "gid://shopify/Shop/7", url: "https://merchant.example.com",
    domain: "merchant.example.com" } } }, { expectedSellerId: "gid://shopify/Shop/7",
  verifiedStoreDomains: ["merchant.example.com"], expectedVariantId: product.variants[0].id, currency: "USD" });
assert.equal(offer.state, "supported");
assert.equal(verifyCatalogOffer({ ...selected, variant: { ...selected.variant, seller: {
  id: "gid://shopify/Shop/8", url: "https://reseller.example.com" } } },
{ expectedSellerId: "gid://shopify/Shop/7", verifiedStoreDomains: ["merchant.example.com"] }).reasonCode, "seller_mismatch");
assert.equal(verifyCatalogOffer({ ...selected, variant: { ...selected.variant, seller: {
  id: "gid://shopify/Shop/7", url: "https://merchant.example.com" } } },
{ expectedSellerId: "gid://shopify/Shop/7", verifiedStoreDomains: ["merchant.example.com"] }).reasonCode, "market_unverified");
assert.equal(verifyCatalogOffer({ ...selected, marketSignal: "global_gb_filter", variant: {
  ...selected.variant, seller: { id: "gid://shopify/Shop/7", url: "https://merchant.example.com" } } },
{ expectedSellerId: "gid://shopify/Shop/7", verifiedStoreDomains: ["merchant.example.com"],
  expectedMarket: "GB" }).state, "supported");
assert.equal(verifyCatalogOffer({ ...selected, marketSignal: "global_us_filter", variant: {
  ...selected.variant, availability: { available: false },
  seller: { id: "gid://shopify/Shop/7", url: "https://merchant.example.com" } } },
{ expectedSellerId: "gid://shopify/Shop/7", verifiedStoreDomains: ["merchant.example.com"] }).state,
"unknown");
const globalProduct = { ...product, id: "gid://shopify/p/global10", variants: [
  { ...product.variants[0], seller: { id: "gid://shopify/Shop/8", name: "Other seller",
    url: "https://other.example.com" } },
  { ...product.variants[0], seller: { id: "gid://shopify/Shop/7", name: "Merchant",
    url: "https://merchant.example.com" } }] };
const thirdParty = { ...globalProduct, id: "gid://shopify/p/thirdparty", variants: [{
  ...globalProduct.variants[0], seller: { id: "gid://shopify/Shop/8", name: "Other seller",
    url: "https://other.example.com" } }] };
const global = catalogClient({ profileUrl: PROFILE_EXAMPLE, fetcher: async (_url, options) => {
  const request = JSON.parse(options.body);
  if (request.method === "tools/list") return fixtureResponse({ tools: [
    { name: "search_catalog" }, { name: "lookup_catalog" }] });
  return fixtureResponse({ structuredContent: { products: [thirdParty, globalProduct],
    ucp: { status: "success" } } });
} });
const globalTools = await global.tools("global");
assert.equal((await global.globalOfferFor(product, product.variants[0], "gid://shopify/Shop/7", globalTools)).state,
  "supported");
assert.equal((await global.globalOfferFor(product, product.variants[0], "gid://shopify/Shop/9", globalTools)).reasonCode,
  "exact_seller_offer_not_found");
await assert.rejects(client.detail("merchant.example.com", product.id, product.variants[0].id,
  [{ name: "Color", label: "Red" }], tools), /selected variant changed/);
await assert.rejects(client.detail("merchant.example.com", product.id, "gid://shopify/ProductVariant/99", [], tools),
  /selected variant changed/);

const seedQlooId = "11111111-1111-4111-8111-111111111111";
const partnerQlooId = "22222222-2222-4222-8222-222222222222";
const bathProposal = { kind: "occasion_complement", seedFacts: ["Bath towel"],
  partnerFacts: ["Bath mat"], seedRole: "towel", partnerRole: "bath mat",
  occasion: "bathroom essentials",
  benefit: "The towel dries after bathing while the bath mat provides a floor surface.",
  partnerSpecificFact: "" };
const bathRubric = { seedRoleGroundedInSelectedItem: true,
  partnerRoleGroundedInSelectedItem: true, jointUseCoherent: true, incrementalBenefit: true,
  genericCoUseOnly: false,
  distinctConcreteJointValue: false, partnerSpecificReason: false, reason: "specific_joint_use" };
const specificRubric = { ...bathRubric, distinctConcreteJointValue: true,
  partnerSpecificReason: true };
const fittedPhone = { title: "Model X phone", description: { plain: "A handheld Model X phone." } };
const fittedCase = { title: "Model X protective case", description: {
  plain: "The Model X protective case fits Model X phone and protects it." } };
const fitProposal = { kind: "functional_complement", seedFacts: ["Model X phone"],
  partnerFacts: ["Model X protective case"], seedRole: "phone",
  partnerRole: "protective case", occasion: "phone protection",
  benefit: "The protective case fits the phone and protects it during daily carrying.",
  partnerSpecificFact: "" };
assert.equal(productMechanism(fittedPhone, fittedCase, "product_bundle", fitProposal,
  null, null, { seedDescription: true, partnerDescription: true }, bathRubric).evidence, "supported");
assert.equal(productMechanism(fittedPhone, { ...fittedCase,
  description: { plain: "The Model X protective case protects handheld devices." } },
"product_bundle", fitProposal, null, null,
{ seedDescription: true, partnerDescription: true }, bathRubric).evidence, "unknown");
assert.equal(productMechanism(fittedPhone, fittedCase, "product_bundle", fitProposal,
  null, null, { seedDescription: true, partnerDescription: false }, bathRubric).evidence, "unknown");
assert.equal(productMechanism({ title: "A visual archive book",
  description: "The brand makes bags. A visual archive of its history." },
{ title: "Capri Leggings", description: "Cotton leggings for yoga." },
"product_bundle", { kind: "occasion_complement", seedFacts: ["The brand makes bags"],
  partnerFacts: ["Cotton leggings for yoga"], seedRole: "bag for yoga",
  partnerRole: "leggings for yoga", occasion: "yoga class",
  benefit: "A bag for yoga and leggings for yoga support a specific class visit.",
  partnerSpecificFact: "" }, null, null, undefined,
{ ...bathRubric, seedRoleGroundedInSelectedItem: false }).evidence, "unknown");
const fixtureEvidence = { objective: "product_bundle", discoveryBasis: "qloo_native_brand",
  seed: { id: seedQlooId, qlooId: seedQlooId, identityStatus: "verified",
    officialWebsite: "https://seed.example.com" },
  partner: { id: partnerQlooId, qlooId: partnerQlooId, identityStatus: "verified",
    officialWebsite: "https://partner.example.com" },
  seedStore: { shopId: "gid://shopify/Shop/1", domain: "seed.example.com" },
  partnerStore: { shopId: "gid://shopify/Shop/2", domain: "partner.example.com" },
  seedDetail: { product: { id: product.id, title: "Bath towel" }, variant: product.variants[0] },
  partnerDetail: { product: { id: "gid://shopify/Product/20", title: "Bath mat" },
    variant: { id: "gid://shopify/ProductVariant/21", price: { amount: 4400, currency: "USD" },
      availability: { available: true } } },
  selectedSeed: { productId: product.id, variantId: product.variants[0].id },
  selectedPartner: { productId: "gid://shopify/Product/20", variantId: "gid://shopify/ProductVariant/21" },
  cultureEvidence: { seedQlooId, partnerQlooId, unconstrained: true,
    envelope: { status: "ok", results: [{ entity_id: partnerQlooId }] } },
  marketOffers: { seed: { state: "supported" }, partner: { state: "supported" } },
  assortmentScope: { observedFamilies: ["bath towel"], inspectedQueries: ["bath towel"],
    anchorClaimRefs: ["seed_product"], coverage: "partial", limitationNotes: [] },
  mechanismProposal: bathProposal, rubricVerification: bathRubric, userConstraints: {} };
const assessFixture = (overrides = {}) => assessCommerceOpportunity(validateCommerceEvidence({
  ...fixtureEvidence, ...overrides }));
assert.throws(() => assessCommerceOpportunity({ identity: "supported",
  culturalRelationship: "native_recommendation_verified", objectiveSuitability: "matches_explicit_focus" }),
/Server-validated commerce evidence required/);
assert.equal(assessFixture().status, "supported");
// A partner from a Qloo category request passes only when the starting brand
// was the only signal and the request was limited to that one category.
const coffeeTag = "urn:tag:genre:brand:food_and_beverage:drinks:coffee_and_tea";
const categoryEnvelope = (tags = [coffeeTag], signal = seedQlooId) => ({ status: "ok",
  results: [{ entity_id: partnerQlooId }],
  explainability: { "signal.interests.entities": { effect_on_all_recs: [{ entity_id: signal }] } },
  provenance: { requests: [{ query: { "filter.tags": tags } }] } });
const categoryFixture = (envelope = categoryEnvelope(), tagId = coffeeTag) => assessFixture({
  discoveryBasis: "qloo_category_brand", cultureEvidence: { seedQlooId, partnerQlooId,
    unconstrained: false, categoryTagId: tagId, envelope } });
const byCategory = categoryFixture();
assert.equal(byCategory.culturalRelationship, "category_recommendation_verified");
assert.equal(byCategory.culturalCategory, "coffee & tea");
assert.equal(byCategory.status, "supported");
assert.match(commerceProposal({ seedName: "Caraway", partnerName: "Four Sigmatic",
  objective: "product_bundle", assessment: byCategory }),
/Among coffee & tea brands, people who like Caraway tend to like Four Sigmatic\./);
assert.equal(categoryFixture(categoryEnvelope([coffeeTag, "urn:tag:genre:brand:household"])).culturalRelationship,
  "unknown", "A request limited to other categories too is not this category's evidence");
assert.equal(categoryFixture(categoryEnvelope([coffeeTag], partnerQlooId)).culturalRelationship, "unknown",
  "The starting brand must be the request's signal");
assert.equal(categoryFixture(categoryEnvelope(["urn:tag:genre:brand:automotive"]), "urn:tag:genre:brand:automotive")
  .culturalRelationship, "unknown", "Only product categories count");
assert.equal(assessFixture({ cultureEvidence: { seedQlooId, partnerQlooId, unconstrained: false,
  envelope: categoryEnvelope() } }).culturalRelationship, "unknown",
"A category request is never read as the brand-only recommendation");
// A stray character from another writing system cuts a displayed reason back
// to its last complete sentence (live 26 Oct: "… without needing另").
assert.equal(customerText("The blanket keeps you warm. The kit collects litter without needing另"),
  "The blanket keeps you warm.");
assert.equal(customerText("warm comfort and litter collection另外"), "", "No complete sentence left: dropped");
assert.equal(customerText("Café-ready pour-over™ — brews 2 cups."), "Café-ready pour-over™ — brews 2 cups.");
// "Why it fits" may not end with an occasion the products and user never named
// (live 25 Oct: Arhaus dinnerware "… at a dinner party").
const panText = ["Sauté Pan non-toxic ceramic coating", "Gallatin dinnerware set stoneware"];
assert.equal(withoutUnstatedOccasion("elegant presentation of the same stew at a dinner party", panText),
  "elegant presentation of the same stew");
assert.equal(withoutUnstatedOccasion("serving soup from the pan into the bowls at the table", panText),
  "serving soup from the pan into the bowls at the table", "A non-occasion clause stays");
assert.equal(withoutUnstatedOccasion("a cozy meal for a picnic", panText, "weekend picnic"),
  "a cozy meal for a picnic", "The user's stated occasion stays");
// Proposals are written straight from the verified opportunity (no concept step).
const directProposal = commerceProposal({ seedName: "First brand", partnerName: "Second brand",
  objective: "product_bundle", assessment: assessFixture(),
  offers: { seed: { title: "Bath towel" }, partner: { title: "Bath mat",
    price: { amountMinor: 4400, currencyCode: "USD" }, url: "https://second.example.com/products/mat" } } });
assert.doesNotMatch(directProposal, /## The idea/);
assert.match(directProposal, /## The products\n\n- \*\*Bath towel\*\* from First brand/);
assert.match(directProposal, /## What each brand brings\n\n- \*\*First brand:\*\* Towel\./);
assert.match(directProposal, /## To agree together\n\n- /);
// The judgment's short customer reason is kept for display; it never changes the verdict.
const withReason = assessFixture({ rubricVerification: { ...bathRubric, customerReason: "drying off after a bath" } });
assert.equal(withReason.productMechanism.customerReason, "drying off after a bath");
assert.equal(withReason.status, "supported");
assert.equal(assessFixture().productMechanism.customerReason, undefined);
const coBrandFixture = { ...fixtureEvidence,
  partner: { ...fixtureEvidence.partner, name: "Partner" },
  partnerDetail: { ...fixtureEvidence.partnerDetail,
    product: { ...fixtureEvidence.partnerDetail.product,
      title: "Partner × AnotherCompany Bath mat" } } };
const coBrandSeller = assessCommerceOpportunity(validateCommerceEvidence(coBrandFixture));
assert.equal(coBrandSeller.status, "supported");
assert.ok(coBrandSeller.reviewFlags.includes("selected_offer_explicit_third_party_cobrand"));
assert.match(coBrandSeller.dealUnknowns.join(" "), /another brand/);
assert.equal(assessCommerceOpportunity(validateCommerceEvidence({ ...coBrandFixture,
  mechanismProposal: { ...bathProposal, partnerRole: "Partner made bath mat" } })).status,
"needs_verification");
assert.equal(assessCommerceOpportunity(validateCommerceEvidence({ ...coBrandFixture,
  mechanismProposal: { ...bathProposal,
    benefit: "The towel dries after bathing while Partner made the bath mat for the floor." } })).status,
"needs_verification");
assert.equal(assessFixture({ mechanismProposal: { ...bathProposal,
  occasion: "linen washing space" } }).rankingFeatures.objectiveSuitability,
  "adequately_serves_objective");
const rephrased = assessFixture({ mechanismProposal: { ...bathProposal,
  benefit: "The bath mat protects the bathroom floor while the towel dries after bathing." } });
assert.equal(rephrased.status, assessFixture().status);
assert.deepEqual(rephrased.rankingFeatures, assessFixture().rankingFeatures);
assert.equal(assessFixture({ rubricVerification: null }).status, "needs_verification");
assert.equal(assessFixture({ rubricVerification: { ...bathRubric,
  genericCoUseOnly: true } }).status, "needs_verification");
assert.equal(assessFixture({ rubricVerification: { ...bathRubric,
  jointUseCoherent: false, reason: "generic_occasion" } }).status, "needs_verification");
assert.equal(assessFixture({ rubricVerification: { ...bathRubric,
  reason: "generic_occasion" } }).status, "needs_verification");
assert.equal(assessFixture({ objective: "cross_sell", assortmentScope: {
  ...fixtureEvidence.assortmentScope, anchorClaimRefs: [] } }).status, "needs_verification");
assert.equal(assessFixture({ objective: "cross_sell", assortmentScope: {
  ...fixtureEvidence.assortmentScope, coverage: "unknown" } }).status, "needs_verification");
assert.equal(assessFixture({ objective: "cross_sell", mechanismProposal: {
  ...bathProposal, benefit: "Brand A never sells bath mats; the towel and bath mat complete a bathroom." } })
  .status, "needs_verification");
assert.equal(assessFixture({ objective: "cross_sell",
  mechanismProposal: { ...bathProposal, kind: "assortment_complement", occasion: "",
    benefit: "The towel serves drying, while the bath mat adds a floor-surface product to the reviewed bath assortment." },
  rubricVerification: { ...bathRubric, reason: "specific_assortment_contribution" } }).status,
"supported");
assert.equal(assessFixture({ seedDetail: { ...fixtureEvidence.seedDetail,
  product: { ...fixtureEvidence.seedDetail.product,
    description: { plain: "This towel is not compatible with Bath mat." } } } }).status,
"unsupported");
assert.equal(assessFixture({ seedDetail: { ...fixtureEvidence.seedDetail,
  product: { ...fixtureEvidence.seedDetail.product,
    description: { plain: "This towel is not compatible with some floor coverings." } } } }).status,
"supported");
assert.equal(assessFixture({ identity: "supported", culturalRelationship: "native_recommendation_verified",
  objectiveSuitability: "matches_explicit_focus", cultureEvidence: null }).status,
"needs_verification");
assert.equal(assessFixture({ objectiveSuitability: "matches_explicit_focus" })
  .rankingFeatures.objectiveSuitability, "clearly_serves_objective");
assert.equal(assessFixture({ culturalExplanation: "specific_theme", culturalTheme: "invented" })
  .culturalExplanation, "no_named_theme");
assert.equal(assessFixture({ partnerStore: { ...fixtureEvidence.partnerStore,
  domain: "unrelated.example.com" } }).status, "needs_verification");
assert.equal(assessFixture({ cultureEvidence: { ...fixtureEvidence.cultureEvidence,
  envelope: { status: "ok", results: [] } } }).status, "needs_verification");
assert.equal(assessFixture({ userConstraints: { mustShipToMarket: true },
  marketOffers: { seed: { state: "unknown" }, partner: { state: "supported" } } }).status,
"needs_verification");
assert.equal(assessFixture({ userConstraints: { mustBeAvailableNow: true },
  partnerDetail: { ...fixtureEvidence.partnerDetail,
    variant: { ...fixtureEvidence.partnerDetail.variant, availability: { available: false } } } }).status,
"unsupported");
assert.equal(assessFixture({ userConstraints: { priceLimit: { amountMinor: 4300,
  currencyCode: "USD" } } }).status, "unsupported");
assert.equal(assessFixture({ userConstraints: { priceLimit: { amountMinor: 4300,
  currencyCode: "EUR" } } }).status, "needs_verification");
assert.equal(assessFixture({ userConstraints: { occasion: "bathroom essentials" } })
  .rankingFeatures.objectiveSuitability, "matches_explicit_focus");
assert.equal(assessFixture({ userConstraints: { softPreferences: ["bath mat"] } })
  .rankingFeatures.verifiedMatchedPreferencesCount, 1);
assert.equal(assessFixture({ partnerDetail: { ...fixtureEvidence.partnerDetail,
  variant: { ...fixtureEvidence.partnerDetail.variant,
    seller: { id: "gid://shopify/Shop/9" } } } }).status, "unsupported");
assert.equal(assessFixture({ cultureEvidence: null }).status, "needs_verification");
assert.equal(assessFixture({ discoveryBasis: "user_specified" }).status, "needs_verification");
assert.equal(assessFixture({ selectedSeed: { productId: "wrong", variantId: product.variants[0].id } }).status,
  "needs_verification");
assert.equal(assessFixture({ objective: "cross_sell", partnerDetail: fixtureEvidence.seedDetail,
  selectedPartner: fixtureEvidence.selectedSeed }).status, "needs_verification");
assert.equal(assessFixture({ userConstraints: { mustShipToMarket: true },
  marketOffers: { seed: { state: "contradicted" }, partner: { state: "supported" } } }).status,
"unsupported");
const better = { partnerId: "partner-a", seedProductId: "a", partnerProductId: "b", sellerId: "s",
  assessment: assessFixture() };
const more = { ...better, seedProductId: "c", partnerProductId: "d" };
const other = { ...better, partnerId: "partner-b", seedProductId: "e", partnerProductId: "f" };
const ranked = rankCommerceOpportunities([better, more, other, better], { objective: "product_bundle" });
assert.equal(ranked.supported.length, 2);
assert.equal(ranked.supported[0].otherOpportunities.length, 1);
assert.equal(ranked.supported[1].otherOpportunities.length, 0);
// Among Supported pairs, an item acting on the starting item ranks before one
// handling the same thing, and that before a shared activity (headlamp).
const linked = (id, productLink) => ({ ...better, partnerProductId: id,
  assessment: assessFixture({ rubricVerification: { ...bathRubric, productLink } }) });
const byLink = rankCommerceOpportunities([linked("headlamp", "shared_activity"), linked("carryall", "direct"),
  linked("strainer", "same_thing")]);
assert.deepEqual([byLink.supported[0].best, ...byLink.supported[0].otherOpportunities].map((item) => item.partnerProductId),
  ["carryall", "strainer", "headlamp"]);
// One pair per product kind from each partner (five stretch lids for one pan,
// live 27 Oct); another partner's item of that kind is still shown.
const lid = (id, partnerId = "partner-a") => ({ ...better, partnerId, partnerProductId: id,
  partnerKind: titleKind(id), assessment: assessFixture() });
const oneLid = rankCommerceOpportunities([lid("Rectangle 9x13 Stretch Lid"), lid("Circle Stretch Lids 4-Pack"),
  lid("Kitchen Sponge 3-Pack"), lid("Square 8x8 Stretch Lid", "partner-b")]);
assert.deepEqual(oneLid.supported.map((group) => [group.best, ...group.otherOpportunities].length), [2, 1]);
// A pair the user rated Good fit is shown first and never hidden as a repeat kind.
const likedLids = rankCommerceOpportunities([lid("Rectangle 9x13 Stretch Lid"),
  { ...lid("Circle Stretch Lids 4-Pack"), userLiked: true }]);
assert.deepEqual([likedLids.supported[0].best, ...likedLids.supported[0].otherOpportunities].map((item) => item.partnerProductId),
  ["Circle Stretch Lids 4-Pack", "Rectangle 9x13 Stretch Lid"]);
assert.equal(titleKind("Focus Whole Bean Coffee - Dark (20oz)"), "title:bean coffee");
assert.notEqual(titleKind("Focus Whole Bean Coffee - Dark"), titleKind("Focus Ground Coffee - Dark"));
// A format the starting item does not use: pods or an instant drink for a drip
// coffee maker (live 27 Oct), unless its own text names that format.
const coffeeMaker = { title: "10-Cup Coffee Maker", description: "Brew a full pot of drip coffee. No pods needed." };
assert.equal(unsupportedPartnerFormat(coffeeMaker, { title: "Focus Medium Roast Espresso Pods (10ct)" }), "pod");
assert.equal(unsupportedPartnerFormat(coffeeMaker, { title: "Low Acid Coffee Instant Sticks" }), "instant");
assert.equal(unsupportedPartnerFormat(coffeeMaker, { title: "Focus Ground Coffee - Dark" }), null);
assert.equal(unsupportedPartnerFormat({ title: "Single Serve Brewer", description: "Works with K-Cup pods." },
  { title: "Breakfast Blend K-Cups" }), null);
assert.equal(unsupportedPartnerFormat({ title: "Puffy Blanket" }, { title: "Instant Camp Shelter" }), null);
const rankedByPurpose = rankCommerceOpportunities([
  { ...other, assessment: assessFixture() },
  { ...better, assessment: assessFixture({ userConstraints: {
    heroProduct: fixtureEvidence.selectedSeed } }) },
]);
assert.equal(rankedByPurpose.supported[0].partnerId, "partner-a");
const directTheme = { kind: "direct_pair", seedQlooId, partnerQlooId,
  sharedTagId: "urn:tag:keyword:qloo:bathroom_essentials", theme: "bathroom essentials",
  focusEnvelope: { results: [{ entity_id: partnerQlooId, affinity: 0.3 }] },
  seedTags: [{ id: "urn:tag:keyword:qloo:bathroom_essentials", name: "bathroom essentials" }],
  partnerTags: [{ id: "urn:tag:keyword:qloo:bathroom_essentials", name: "bathroom essentials" }],
  seedPage: { inspected: true, url: "https://seed.example.com/about",
    snippet: "Bathroom essentials for home." },
  partnerPage: { inspected: true, url: "https://partner.example.com/about",
    snippet: "Bathroom essentials collection." } };
const rankedByCulture = rankCommerceOpportunities([
  { ...other, assessment: assessFixture({ discoveryBasis: "user_specified",
    cultureEvidence: directTheme }) },
  { ...better, assessment: assessFixture() },
]);
assert.equal(rankedByCulture.supported[0].partnerId, "partner-b");
const rankedByPreference = rankCommerceOpportunities([
  { ...other, assessment: assessFixture({ userConstraints: { softPreferences: ["bath mat"] } }) },
  { ...better, assessment: assessFixture({ preferenceRationale: ["long", "unverified"],
    userConstraints: { softPreferences: ["garden" ] } }) },
]);
assert.equal(rankedByPreference.supported[0].partnerId, "partner-b");
assert.equal(rankedByPreference.supported[0].best.assessment.rankingFeatures.verifiedMatchedPreferencesCount, 1);
assert.equal(assessFixture({ discoveryBasis: "user_specified",
  cultureEvidence: directTheme }).status, "supported");
const directNativeProof = { kind: "direct_unconstrained_native", seedQlooId, partnerQlooId,
  unconstrained: true, envelope: { status: "ok", results: [
    { entity_id: partnerQlooId, type: "urn:entity" }] } };
assert.equal(assessFixture({ discoveryBasis: "user_specified",
  cultureEvidence: directNativeProof }).status, "supported");
assert.equal(assessFixture({ discoveryBasis: "user_specified",
  cultureEvidence: { ...directNativeProof, partnerQlooId: seedQlooId } }).status,
"needs_verification");
assert.deepEqual(rankCommerceOpportunities([other, better]).supported.map((group) => group.partnerId),
  rankCommerceOpportunities([better, other]).supported.map((group) => group.partnerId));
const towel = { id: "seed-product", title: "Bath Towel - Happy Blue",
  variants: [{ id: "seed-variant" }] };
const mat = { id: "partner-product", title: "Bath mat",
  variants: [{ id: "partner-variant" }] };
assert.equal(productMechanism(towel, mat, "product_bundle", bathProposal,
  null, null, undefined, bathRubric).mechanism,
  "occasion_complement");
assert.equal(productMechanism(towel, mat, "product_bundle").mechanism, "unproven");
assert.equal(productMechanism(towel, mat, "product_bundle", { ...bathProposal,
  partnerFacts: ["invented material"] }).evidence, "unknown");
const novelSeed = { title: "Pressed flower bookmark", description: { plain: "Hand-pressed garden violets" } };
const novelPartner = { title: "Poetry chapbook", description: { plain: "Original Willow Garden poems" } };
const novelProposal = { kind: "occasion_complement", seedFacts: ["Pressed flower bookmark",
  "Hand-pressed garden violets"], partnerFacts: ["Poetry chapbook", "Original Willow Garden poems"],
  seedRole: "bookmark", partnerRole: "chapbook", occasion: "garden poetry gift",
  benefit: "The bookmark keeps a reading place in the chapbook for a garden poetry gift.",
  partnerSpecificFact: "Original Willow Garden poems" };
assert.equal(productMechanism(novelSeed, novelPartner, "product_bundle", novelProposal,
  null, null, undefined, specificRubric).quality,
  "distinct_concrete_joint_value");
assert.equal(productMechanism(novelSeed, novelPartner, "product_bundle", novelProposal,
  null, null, undefined, specificRubric).partnerDifferentiation,
  "evidenced_partner_specific_reason");
assert.equal(productMechanism(novelSeed, novelPartner, "cross_sell", {
  ...novelProposal, kind: "assortment_complement" }).mechanism, "assortment_complement");
assert.equal(productMechanism(novelSeed, novelPartner, "cross_sell", {
  ...novelProposal, kind: "assortment_complement", occasion: "",
  benefit: "Add an independently authored set of poems to the reviewed reading accessories." },
  null, null, undefined, { ...specificRubric, reason: "specific_assortment_contribution" })
  .incrementalValue, "supported");
assert.equal(productMechanism(novelSeed, novelPartner, "cross_sell", {
  ...novelProposal, kind: "assortment_complement", occasion: "",
  benefit: "Add an independently authored set of poems to the reviewed reading accessories." },
  null, null, undefined, { ...specificRubric, reason: "specific_assortment_contribution" })
  .quality, "distinct_concrete_joint_value");
assert.equal(productMechanism(novelSeed, novelPartner, "product_bundle", novelProposal,
  null, null, { seedDescription: true, partnerDescription: false }).evidence, "unknown");
assert.equal(productMechanism({ title: "Bath towel", description: { plain: "Cotton bath towel" } },
  { title: "Bath mat", description: { plain: "Soft bath mat for bathroom floor" } },
  "product_bundle", { ...bathProposal, partnerSpecificFact: "Soft bath mat for bathroom floor" })
  .partnerDifferentiation, "generic_category_reason");
const vaguePair = productMechanism({ title: "Wool socks" }, { title: "Coffee beans" },
  "product_bundle", { ...bathProposal, seedFacts: ["Wool socks"],
    partnerFacts: ["Coffee beans"], seedRole: "socks", partnerRole: "coffee",
    occasion: "morning routine", benefit: "The socks warm feet while the coffee makes a morning drink." });
assert.equal(vaguePair.evidence, "unknown");
const distinctOccasion = productMechanism(
  { title: "Picnic tote", description: { plain: "Carries picnic tableware" } },
  { title: "Park game cards", description: { plain: "Games for park gatherings" } },
  "product_bundle", { kind: "occasion_complement", seedFacts: ["Picnic tote"],
    partnerFacts: ["Park game cards"], seedRole: "tote", partnerRole: "game cards",
    occasion: "picnic park gathering",
    benefit: "The tote carries the picnic items while the game cards provide a park activity.",
    partnerSpecificFact: "" }, null, null, undefined, bathRubric);
assert.equal(distinctOccasion.evidence, "supported");
const paraphrasedBenefit = productMechanism(
  { title: "Hand trowel", description: { plain: "Hand trowel digs planting holes" } },
  { title: "Garden compost", description: { plain: "Garden compost improves soil for planting" } },
  "product_bundle", { kind: "functional_complement", seedFacts: ["Hand trowel digs planting holes"],
    partnerFacts: ["Garden compost improves soil for planting"], seedRole: "hand trowel",
    partnerRole: "garden compost", occasion: "planting a garden bed",
    benefit: "Dig a planting hole, then improve the soil around the new plant.",
    partnerSpecificFact: "" }, null, null, undefined, bathRubric);
assert.equal(paraphrasedBenefit.validationChecks.benefitNamesBothRoles, false);
assert.equal(paraphrasedBenefit.evidence, "supported",
  "A cited semantic benefit must not fail solely because it paraphrases role labels.");
const inferredOccasion = productMechanism(
  { title: "Beeswax candle", description: { plain: "Hand-poured beeswax candle" } },
  { title: "Guided reflection journal", description: { plain: "Writing prompts for reflection" } },
  "product_bundle", { kind: "occasion_complement", seedFacts: ["Beeswax candle"],
    partnerFacts: ["Guided reflection journal"], seedRole: "candle", partnerRole: "journal",
    occasion: "quiet evening reflection",
    benefit: "The candle sets the reading space while the journal guides a reflection exercise.",
    partnerSpecificFact: "" }, null, null, undefined, bathRubric);
assert.equal(inferredOccasion.evidence, "supported");
assert.equal(inferredOccasion.quality, "credible_joint_value");
assert.equal(productMechanism({ title: "Wool socks" }, { title: "Coffee beans" },
  "product_bundle", { ...bathProposal, seedFacts: ["Wool socks"],
    partnerFacts: ["Coffee beans"], seedRole: "socks", partnerRole: "coffee",
    occasion: "morning routine", benefit: "The socks warm feet while the coffee makes a drink." },
  null, null, undefined, bathRubric).evidence, "unknown");
const novelAssessment = assessFixture({
  seedDetail: { ...fixtureEvidence.seedDetail,
    product: { ...novelSeed, id: fixtureEvidence.seedDetail.product.id } },
  partnerDetail: { ...fixtureEvidence.partnerDetail,
    product: { ...novelPartner, id: fixtureEvidence.partnerDetail.product.id } },
  mechanismProposal: novelProposal, rubricVerification: specificRubric });
assert.equal(novelAssessment.status, "supported");
assert.equal(novelAssessment.rankingFeatures.productQuality, "distinct_concrete_joint_value");
assert.equal(novelAssessment.rankingFeatures.partnerDifferentiation,
  "evidenced_partner_specific_reason");
const clearCrossSell = assessFixture({ objective: "cross_sell",
  seedDetail: { ...fixtureEvidence.seedDetail,
    product: { ...novelSeed, id: fixtureEvidence.seedDetail.product.id } },
  partnerDetail: { ...fixtureEvidence.partnerDetail,
    product: { ...novelPartner, id: fixtureEvidence.partnerDetail.product.id } },
  mechanismProposal: { ...novelProposal, kind: "assortment_complement", occasion: "",
    benefit: "Add an independently authored set of poems to the reviewed reading accessories." },
  rubricVerification: { ...specificRubric, reason: "specific_assortment_contribution" },
  sourceAuthority: { seedDescription: true, partnerDescription: true } });
assert.equal(clearCrossSell.status, "supported");
assert.equal(clearCrossSell.rankingFeatures.objectiveSuitability,
  "clearly_serves_objective");
assert.equal(clearCrossSell.rankingFeatures.productQuality,
  "distinct_concrete_joint_value");
assert.equal(rankCommerceOpportunities([
  { ...other, assessment: novelAssessment }, { ...better, assessment: assessFixture() },
]).supported[0].partnerId, "partner-b");
assert.equal(assessFixture({ mechanismProposal: { ...bathProposal,
  seedFacts: ["invented fabric"] } }).status, "needs_verification");
assert.equal(parseCommerceMechanismProposal(JSON.stringify(bathProposal)).kind,
  "occasion_complement");
assert.equal(parseCommerceMechanismRubric(JSON.stringify(bathRubric)).jointUseCoherent, true);
assert.throws(() => parseCommerceMechanismRubric(JSON.stringify({ ...bathRubric,
  status: "supported" })), /unrecognized_keys|Unrecognized key/);
assert.throws(() => parseCommerceMechanismProposal(JSON.stringify({ ...bathProposal,
  status: "supported" })), /unrecognized_keys|Unrecognized key/);
assert.deepEqual(parsePartnerProductSearchPlan(JSON.stringify({ directions: [
  { query: "bath mat", role: "absorb floor water" }],
  observedProductIds: [mat.id] })), { directions: [
    { query: "bath mat", role: "absorb floor water" }], observedProductIds: [mat.id] });
assert.throws(() => parsePartnerProductSearchPlan(JSON.stringify({ directions: [
  { query: "bath mat", role: "absorb floor water" }],
  observedProductIds: [mat.id], status: "supported" })), /unrecognized_keys|Unrecognized key/);
assert.deepEqual(validatePartnerSearchPlan({ directions: [
  { query: "burr grinder", role: "grind coffee" },
  { query: "coffee mill", role: "grind coffee" }], observedProductIds: [] }).directions,
[{ query: "burr grinder", role: "grind coffee" },
  { query: "coffee mill", role: "grind coffee" }]);
assert.deepEqual(validatePartnerSearchPlan({ queries: ["lifestyle", "non-slip bath mat",
  "non-slip bath mat"], observedProductIds: ["invented", mat.id] }, [mat]),
{ queries: ["non-slip bath mat"], observedProductIds: [mat.id] });
assert.deepEqual(validatePartnerSearchPlan({ queries: [
  "nylon drawstring bag with removable strap", "travel kit for nylon drawstring bag",
  "size down recommendation", "waterproof travel pouch", "finishing olive oil"],
  observedProductIds: [] }, [], { title: "Nylon Drawstring Bag - Black" }).queries,
["waterproof travel pouch", "finishing olive oil"]);
assert.deepEqual(validatePartnerSearchPlan({ queries: ["olive oil", "finishing olive oil",
  "olive oil for salad", "silicone spatula"], observedProductIds: [] }, [],
{ title: "Olive Oil" }).queries, ["finishing olive oil", "silicone spatula"]);
assert.deepEqual(validatePartnerSearchPlan({ queries: ["cotton mini dress bow collar",
  "maryjane sandal"], observedProductIds: [] }, [], { title: "Jenny Mini Dress - Dove",
  description: { plain: "Cotton mini dress with bow and point collar." } }).queries,
["maryjane sandal"]);
assert.deepEqual(validatePartnerSearchPlan({ queries: ["black flat with leather outsole",
  "everyday flat for dresses", "shoe care kit", "finishing flat"],
  observedProductIds: [] }, [], { title: "Gallery Square-Toe Flat | Black",
  product_type: "Flats" }).queries, ["shoe care kit", "finishing flat"]);
const mixedSearchPlans = [{ source: "broad" }, { source: "anchor" },
  { source: "catalog" }, { source: "anchor" }, { source: "catalog" }];
mergeRefinedSearchPlans(mixedSearchPlans, 2,
  [{ source: "catalog_refined", id: 1 }, { source: "catalog_refined", id: 2 }]);
assert.deepEqual(mixedSearchPlans.slice(3).map((item) => item.source),
  ["anchor", "catalog_refined", "catalog", "catalog_refined"]);
const rolePlans = [{ role: "grind coffee", partnerQuery: "burr grinder" },
  { role: "grind coffee", partnerQuery: "coffee mill" },
  { role: "brew coffee", partnerQuery: "pour-over brewer" }];
assert.equal(commerceRoleKey("Grind coffee"), "grind coffee");
prioritizeUnexploredRole(rolePlans, 1, new Set(["grind coffee"]));
assert.deepEqual(rolePlans.map((plan) => plan.partnerQuery),
  ["burr grinder", "pour-over brewer", "coffee mill"]);
assert.equal(usefulCollectionSearch("All Men's Shoes"), false);
assert.equal(usefulCollectionSearch("Men's Size 8"), false);
// A collection is searched only when it relates to a planned search or role;
// no list of collection names (a "filter" word list once blocked Coffee Filters).
const coffeePlans = ["paper coffee filter", "brew coffee", "ground coffee"];
assert.ok(collectionMatchesPlan("Coffee Filters", coffeePlans));
for (const title of ["Uncategorized", "Best Sellers", "Allow Discounts", "PLP Data - Laundry Care"]) {
  assert.ok(!collectionMatchesPlan(title, coffeePlans), title);
}
assert.equal(usefulCollectionSearch("Camp hardware"), true);
assert.equal(searchResultMatchesQuery({ title: "Camp cord", product_type: "Hardware" },
  "camp cord"), true);
assert.equal(searchResultMatchesQuery({ title: "Leather sandal", product_type: "Shoes" },
  "leather care kit"), false);
assert.equal(isCommerceMerchandise({ title: "Merchant Gift Card - $100" }), false);
assert.equal(isCommerceMerchandise({ title: "Leather Gift Card Holder" }), true);
assert.deepEqual(prioritizeObservedPartnerProducts([{ id: "other" }, mat], [mat.id])
  .map((item) => item.id), [mat.id, "other"]);
assert.equal(JSON.stringify(transientProductFacts({ ...novelSeed,
  media: [{ url: "forbidden-image" }], price_range: { min: 4400 } }, {}))
  .includes("forbidden-image"), false);
const carePair = productMechanism(
  { title: "Leather Ballet Flat", description: "Made with smooth nappa leather. Professional cleaning only." },
  { title: "Leather Care Kit", description: "Cream and waterproof spray for smooth leather." },
  "product_bundle", { kind: "functional_complement", seedFacts: ["smooth nappa leather"],
    partnerFacts: ["waterproof spray"], seedRole: "leather flat", partnerRole: "care kit",
    occasion: "travel leather care", benefit: "Use care kit to treat leather flat at home during travel",
    partnerSpecificFact: "" }, null, null,
  { seedDescription: true, partnerDescription: true }, {
    seedRoleGroundedInSelectedItem: true, partnerRoleGroundedInSelectedItem: true,
    jointUseCoherent: true, incrementalBenefit: true, genericCoUseOnly: false,
    distinctConcreteJointValue: true,
    partnerSpecificReason: false, reason: "specific_joint_use" });
assert.equal(carePair.evidence, "unknown");
assert.equal(carePair.requiresCompatibility, true);
assert.ok(carePair.reasonCodes.includes("selected_product_compatibility_unverified"));
assert.equal(chooseProductCombinations([towel], [mat], "product_bundle").length, 1);
assert.deepEqual(chooseProductCombinations([{ ...towel, variants: [
  { id: "seed-first" }, { id: "seed-second" }] }], [mat], "product_bundle", 2)
  .map((item) => item.seedVariant.id), ["seed-first", "seed-second"]);
assert.equal(chooseProductCombinations([{ ...towel, variants: [
  { id: "seed-unavailable", availability: { available: false } },
  { id: "seed-available", availability: { available: true } }] }], [mat],
"product_bundle")[0].seedVariant.id, "seed-available");
assert.equal(chooseProductCombinations([towel], [{ ...mat, title: "Abstract Wall Art" }],
  "product_bundle").length, 1);
const broadSeedProducts = Array.from({ length: 8 }, (_, index) => ({
  id: "gid://shopify/Product/seed-" + index, title: "Merchandise " + index,
  variants: [{ id: "gid://shopify/ProductVariant/seed-" + index }],
}));
const broadPartnerProducts = Array.from({ length: 8 }, (_, index) => ({
  id: "gid://shopify/Product/partner-" + index, title: "Partner merchandise " + index,
  variants: [{ id: "gid://shopify/ProductVariant/partner-" + index }],
}));
assert.deepEqual(chooseProductCombinations(broadSeedProducts, broadPartnerProducts,
  "product_bundle", 2, { spread: true }).map((item) => item.seedProduct.id),
["gid://shopify/Product/seed-0", "gid://shopify/Product/seed-4"]);
assert.deepEqual(chooseProductCombinations([{ ...towel, variants: [
  { id: "seed-primary", availability: { available: true } },
  { id: "seed-alternate", availability: { available: true } },
] }], [mat], "product_bundle").map((item) => item.seedVariant.id),
["seed-primary", "seed-alternate"]);
// Research always starts from a chosen starting product.
const chosenTowel = { heroProduct: { productId: towel.id, variantId: towel.variants[0].id } };
const pairInput = { seed: fixtureEvidence.seed,
  partner: fixtureEvidence.partner,
  objective: "product_bundle", discoveryBasis: "qloo_native_brand",
  cultureEvidence: fixtureEvidence.cultureEvidence, userConstraints: chosenTowel };
const withoutProduct = await researchCommercePair({ ...pairInput, userConstraints: {} },
  { createCatalog: () => ({ callsUsed: () => 0 }), discoverStorefront: async (url) => ({
    domain: new URL(url).hostname, shopId: url.includes("seed") ? "gid://shopify/Shop/1" : "gid://shopify/Shop/2" }) });
assert.equal(withoutProduct.coverage, "selected_seed_product_required");
assert.equal(withoutProduct.callsUsed, 0);
const productWithOffer = (item, shop) => ({ product: item, variant: { ...item.variants[0],
  price: { amount: 4400, currency: "USD" }, availability: { available: true } },
  shop, fetchedAt: new Date().toISOString() });
const researchDeps = { discoverStorefront: async (url) => ({
  domain: new URL(url).hostname, shopId: url.includes("seed") ? "gid://shopify/Shop/1" : "gid://shopify/Shop/2" }),
  proposeMechanism: async () => bathProposal,
  planAnchorSearch: async () => ({ queries: [], observedProductIds: [] }),
  planPartnerSearch: async () => ({ queries: [], observedProductIds: [] }),
  // Like a real selector, picks the observed products (in order).
  selectPartnerProducts: async ({ partnerProducts }) => ({ productIds: partnerProducts.map((item) => item.id) }),
  verifyMechanism: async () => bathRubric,
  productQueries: ["bath"], createCatalog: () => ({
    tools: async () => new Set(["search_catalog", "lookup_catalog"]),
    search: async (domain) => domain.startsWith("seed") ? [towel] : [mat],
    detail: async (domain) => productWithOffer(domain.startsWith("seed") ? towel : mat),
    globalOfferFor: async () => ({ state: "supported", reasonCode: "current_exact_seller_offer" }),
    callsUsed: () => 6,
  }) };
const qualified = await researchCommercePair(pairInput, researchDeps);
// Starting-product work is done once per run and shared by later partners.
const sharedCalls = [];
let anchorPlans = 0;
const sharedRun = new Map();
const countingDeps = { ...researchDeps, productQueries: null,
  discoverStorefront: async (url) => { sharedCalls.push(`store:${new URL(url).hostname}`);
    return researchDeps.discoverStorefront(url); },
  planAnchorSearch: async () => { anchorPlans += 1; return { queries: [], observedProductIds: [] }; },
  screenPartner: async () => ({ addsValue: true, exampleTitles: [] }),
  createCatalog: () => { const base = researchDeps.createCatalog(); return { ...base,
    tools: async (domain) => { sharedCalls.push(`tools:${domain}`); return base.tools(domain); },
    detail: async (domain, ...rest) => { sharedCalls.push(`detail:${domain.startsWith("seed") ? "seed" : "partner"}`);
      return base.detail(domain, ...rest); } }; } };
await researchCommercePair({ ...pairInput, runShared: sharedRun }, countingDeps);
const firstPartnerCalls = sharedCalls.length;
sharedCalls.length = 0;
await researchCommercePair({ ...pairInput, runShared: sharedRun }, countingDeps);
assert.ok(!sharedCalls.some((call) => /^(?:store:seed|tools:global|tools:seed|detail:seed)/.test(call)),
  `A later partner repeats no starting-product work: ${sharedCalls.join(", ")}`);
assert.ok(sharedCalls.length < firstPartnerCalls);
assert.equal(anchorPlans, 1, "The product-based search plan is made once per run");
// Pairs the same judge rejected recently are skipped without new model calls;
// each new verdict records which judge (model and prompts) produced it.
assert.match(qualified.memory.pairs[0].judge, /#[0-9a-f]{12}$/);
let recallInput = null;
const remembered = await researchCommercePair(pairInput, { ...researchDeps,
  recallRejections: async (keys, judge) => { recallInput = { keys, judge }; return new Set(keys); },
  proposeMechanism: async () => { throw new Error("A remembered rejection is not judged again"); } });
assert.equal(recallInput.judge, qualified.memory.pairs[0].judge);
assert.ok(remembered.pairsSkippedFromMemory > 0);
assert.equal(remembered.assessedCount, 0);
// Two products this user marked "Not a fit" are not assessed or shown again,
// whichever colour or size is selected next time (the key ignores variants).
const passedKeys = qualified.memory.pairs.map((pair) => productPairKeyFor(pairInput.objective, {
  seed: { ...pair.references.seed, variantId: "another-colour" },
  partner: { ...pair.references.partner, variantId: "another-size" } }));
const userPassed = await researchCommercePair({ ...pairInput, userRejectedPairs: passedKeys }, { ...researchDeps,
  proposeMechanism: async () => { throw new Error("A pair the user passed on is not judged again"); } });
assert.ok(userPassed.pairsSkippedByUser > 0);
assert.equal(userPassed.assessedCount, 0);
assert.ok(qualified.memory.pairs[0].references?.partner?.productId, "Pair outcomes carry identifiers for review sampling");
// Storefront products send only description.html; a stated preference found
// there counts (it was silently missed when only description.plain was read).
const htmlMat = { ...mat, description: { html: "<p>Made from <em>organic cotton</em> loops.</p>" } };
const htmlPreference = await researchCommercePair({ ...pairInput,
  userConstraints: { ...chosenTowel, softPreferences: ["organic cotton"] } }, { ...researchDeps,
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    search: async (domain) => domain.startsWith("seed") ? [towel] : [htmlMat],
    detail: async (domain) => productWithOffer(domain.startsWith("seed") ? towel : htmlMat) }) });
assert.equal(htmlPreference.opportunities.supported[0].best.assessment.rankingFeatures
  .verifiedMatchedPreferencesCount, 1);
// One partner stops early: after three Supported pairs, or after eight
// assessed pairs with nothing worth showing.
// Distinct product kinds (categories): titles of one kind ("Bath mat 1",
// "Bath mat 2") without a category count once.
const manyMats = Array.from({ length: 12 }, (_, index) => ({ ...mat, id: `gid://shopify/Product/mat${index}`,
  title: `Bath mat ${index}`, categories: [{ value: `gid://shopify/TaxonomyCategory/hg-13-${index + 1}` }],
  variants: [{ id: `gid://shopify/ProductVariant/mat${index}` }] }));
const manyCatalog = () => ({ ...researchDeps.createCatalog(),
  search: async (domain) => domain.startsWith("seed") ? [towel] : manyMats,
  detail: async (domain, id) => productWithOffer(domain.startsWith("seed") ? towel
    : manyMats.find((item) => item.id === id) ?? manyMats[0]), callsUsed: () => 6 });
const enough = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: manyCatalog, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }) });
assert.equal(enough.stopReason, "enough_opportunities_found");
assert.equal(enough.assessedCount, 4, "Pairs are assessed two at a time; stops after the batch reaching three");
const noFit = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: manyCatalog, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }),
  verifyMechanism: async () => ({ ...bathRubric, jointUseCoherent: false, incrementalBenefit: false,
    reason: "unrelated_products" }) });
assert.equal(noFit.stopReason, "no_fit_in_sample");
assert.equal(noFit.assessedCount, 8);
// Supported items of the same kind count once toward "enough": five mats of
// one kind and one of another never reach three kinds.
const kindMats = manyMats.slice(0, 6).map((item, index) => ({ ...item,
  categories: [{ value: `gid://shopify/TaxonomyCategory/${index < 5 ? "hg-3-4-2" : "hg-3-4-9"}`, taxonomy: "shopify" }] }));
const kindCatalog = () => ({ ...manyCatalog(),
  search: async (domain) => domain.startsWith("seed") ? [towel] : kindMats,
  detail: async (domain, id) => productWithOffer(domain.startsWith("seed") ? towel
    : kindMats.find((item) => item.id === id) ?? kindMats[0]) });
const twoKinds = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: kindCatalog, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }) });
assert.notEqual(twoKinds.stopReason, "enough_opportunities_found");
assert.equal(twoKinds.assessedCount, 6);
// Only the selector's picks are judged (plus one exploratory product with a
// thin description); unpicked products are never padded in (26 Oct: a gift
// card, dog toy and book took judging slots).
const assessedIds = (result) => result.memory.pairs.map((pair) => pair.references.partner.productId);
const twoPicks = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  selectPartnerProducts: async () => ({ productIds: [manyMats[3].id, manyMats[7].id] }),
  createCatalog: manyCatalog, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }),
  verifyMechanism: async () => ({ ...bathRubric, jointUseCoherent: false, incrementalBenefit: false,
    reason: "unrelated_products" }) });
assert.deepEqual(assessedIds(twoPicks).slice(0, 2), [manyMats[3].id, manyMats[7].id], "Picks are judged in the selector's order");
assert.equal(twoPicks.assessedCount, 3, "Two picks and one exploratory product; no padding");
// A failed selector falls back to the observed order so research continues.
const selectorDown = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  selectPartnerProducts: async () => { throw new Error("model unavailable"); },
  createCatalog: manyCatalog, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }),
  verifyMechanism: async () => ({ ...bathRubric, jointUseCoherent: false, incrementalBenefit: false,
    reason: "unrelated_products" }) });
assert.ok(selectorDown.assessedCount >= 8, "Selector failure keeps the observed-order fallback");
// A partner product that formed a Supported pair for a similar starting
// product before is fetched live and judged first, even if this run's search
// did not surface it.
const rememberedMat = { ...mat, id: "gid://shopify/Product/remembered", title: "Remembered bath mat",
  variants: [{ id: "gid://shopify/ProductVariant/remembered" }] };
let recallAsked = null;
const rechecked = await researchCommercePair({ ...pairInput, partner: { ...pairInput.partner, qlooId: "partner-qloo" },
  userConstraints: { heroProduct: { ...chosenTowel.heroProduct, categoryId: "hg-3-4-1-2" } } }, { ...researchDeps,
  productQueries: null, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }),
  recallProducts: async (input) => { recallAsked = input; return [rememberedMat.id]; },
  createCatalog: () => ({ ...manyCatalog(), detail: async (domain, id) => productWithOffer(domain.startsWith("seed") ? towel
    : id === rememberedMat.id ? rememberedMat : manyMats.find((item) => item.id === id) ?? manyMats[0]) }) });
assert.deepEqual(recallAsked, { partnerQlooId: "partner-qloo", objective: "product_bundle", heroCategory: "hg-3-4-1-2" });
assert.equal(rechecked.provenProductsRechecked, 1);
assert.equal(assessedIds(rechecked)[0], rememberedMat.id, "A remembered winner is judged first");
// Gift cards, the starting brand's own co-branded products and (in a Bundle)
// products of the starting product's exact category never reach selection;
// a co-branded product is noted as an existing collaboration.
const category = (id) => [{ value: `gid://shopify/TaxonomyCategory/${id}`, taxonomy: "shopify" }];
const shelf = [
  { ...mat, id: "gid://shopify/Product/gift", title: "Store Pass", categories: category("gc"), variants: [{ id: "gid://shopify/ProductVariant/gift" }] },
  { ...mat, id: "gid://shopify/Product/cobrand", title: "Partner × Towelco Hand Towel", variants: [{ id: "gid://shopify/ProductVariant/cobrand" }] },
  { ...mat, id: "gid://shopify/Product/same", title: "Plush Bath Towel", categories: category("hg-3-4-1-2"), variants: [{ id: "gid://shopify/ProductVariant/same" }] },
  { ...mat, id: "gid://shopify/Product/keep", title: "Bath mat", categories: category("hg-3-4-2"), variants: [{ id: "gid://shopify/ProductVariant/keep" }] }];
let selectorSaw = null;
const shelved = await researchCommercePair({ ...pairInput, seed: { ...pairInput.seed, name: "Towelco" },
  userConstraints: { heroProduct: { ...chosenTowel.heroProduct, categoryId: "hg-3-4-1-2" } } }, { ...researchDeps,
  productQueries: null, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }),
  selectPartnerProducts: async ({ partnerProducts }) => { selectorSaw = partnerProducts.map((item) => item.id);
    return { productIds: selectorSaw }; },
  createCatalog: () => ({ ...manyCatalog(), search: async (domain) => domain.startsWith("seed") ? [towel] : shelf,
    detail: async (domain, id) => productWithOffer(domain.startsWith("seed") ? towel
      : shelf.find((item) => item.id === id) ?? shelf[3]) }) });
assert.deepEqual(selectorSaw, ["gid://shopify/Product/keep"]);
assert.equal(shelved.partnerSellsStartingBrand, true);
assert.match(commerceProposal({ seedName: "Rumpl", partnerName: "AllTrails", objective: "product_bundle",
  assessment: {}, existingCollaboration: true }), /AllTrails already sells a co-branded Rumpl product/);
assert.doesNotMatch(commerceProposal({ seedName: "Rumpl", partnerName: "AllTrails", objective: "product_bundle",
  assessment: {} }), /co-branded/);
assert.equal(productKind("lb-13-1"), productKind("aa-5-4-19"), "Everyday bags count as one kind");
assert.notEqual(productKind("lb-13-1"), productKind("hg-3-4-2"));
// One partner's store timing out skips that partner; the starting store
// timing out still stops research.
const timingOut = (side) => () => ({ ...researchDeps.createCatalog(),
  tools: async (domain) => { if (domain.startsWith(side)) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return new Set(["search_catalog", "lookup_catalog"]); } });
const partnerDown = await researchCommercePair(pairInput, { ...researchDeps, createCatalog: timingOut("partner") });
assert.equal(partnerDown.coverage, "partner_catalog_unavailable");
assert.equal(partnerDown.stopReason, null);
await assert.rejects(researchCommercePair(pairInput, { ...researchDeps, createCatalog: timingOut("seed") }),
  (error) => error.code === "catalog_unavailable");
// Discovery recommends strong pairs only; a shared activity alone (a headlamp
// for a blanket on the same trip) is not shown. A direct comparison keeps it.
const activityOnly = { ...researchDeps, verifyMechanism: async () => ({ ...bathRubric, productLink: "shared_activity" }) };
const discoveredActivity = await researchCommercePair({ ...pairInput, discoveryBasis: "qloo_native_brand" }, activityOnly);
assert.equal(Object.values(discoveredActivity.opportunities).flat().length, 0);
const comparedActivity = await researchCommercePair({ ...pairInput, discoveryBasis: "user_specified" }, activityOnly);
assert.ok(Object.values(comparedActivity.opportunities).flat().length > 0);
const discoveredDirect = await researchCommercePair({ ...pairInput, discoveryBasis: "qloo_native_brand" },
  { ...researchDeps, verifyMechanism: async () => ({ ...bathRubric, productLink: "direct" }) });
assert.equal(discoveredDirect.opportunities.supported[0].best.assessment.productMechanism.link, "direct");
// A discovered partner whose catalog sample adds no value stops before deep search.
let screenedSample = null;
const screenedOut = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  screenPartner: async ({ partnerProducts, seedProduct }) => { screenedSample = { partnerProducts, seedProduct };
    return { addsValue: false, exampleTitles: [] }; } });
assert.equal(screenedOut.coverage, "partner_no_product_value");
assert.equal(screenedSample.seedProduct.id, towel.id, "The screen sees the exact chosen product");
assert.ok(screenedSample.partnerProducts.length > 0);
// A partner screened out on its first page is re-screened with a second page
// before it is dropped (one sample can miss the department that fits).
const screenSamples = [];
const sofa = { ...mat, id: "gid://shopify/Product/sofa", title: "Sofa",
  variants: [{ id: "gid://shopify/ProductVariant/sofa" }] };
const pagedSearch = async (domain, _query, _tools, input = {}) => {
  if (domain.startsWith("seed")) return { products: [towel], pagination: { cursor: null, hasNextPage: false } };
  if (input.cursor === "page-3") return { products: [mat], pagination: { cursor: null, hasNextPage: false } };
  if (input.cursor === "page-2") return { products: [{ ...sofa, id: "gid://shopify/Product/lamp", title: "Lamp",
    variants: [{ id: "gid://shopify/ProductVariant/lamp" }] }], pagination: { cursor: "page-3", hasNextPage: true } };
  return { products: [sofa], pagination: { cursor: "page-2", hasNextPage: true } };
};
const secondPageKept = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: () => ({ ...researchDeps.createCatalog(), searchPage: pagedSearch }),
  screenPartner: async ({ partnerProducts }) => { screenSamples.push(partnerProducts.length);
    return { addsValue: partnerProducts.some((item) => item.id === mat.id), exampleTitles: [] }; } });
assert.deepEqual(screenSamples, [2, 3], "Dropped only after one more page also shows nothing");
assert.notEqual(secondPageKept.coverage, "partner_no_product_value");
// A discovered brand selling mostly the starting product's kind is a
// competitor (Great Jones cookware for a Caraway pan, live 27 Oct); a few
// such items in a wider range do not stop research.
const inCategory = (product, id) => ({ ...product, categories: [{ value: `gid://shopify/TaxonomyCategory/${id}` }] });
const pan = inCategory(towel, "hg-11-2-3");
const shelfOf = (cookware) => Array.from({ length: 8 }, (_, index) => inCategory({ ...mat,
  id: `gid://shopify/Product/shelf-${index}`, variants: [{ id: `gid://shopify/ProductVariant/shelf-${index}` }] },
index < cookware ? "hg-11-2-5" : "hg-11-10-1"));
const competitorCheck = (cookware, input = pairInput) => researchCommercePair(input, { ...researchDeps, productQueries: null,
  screenPartner: async () => ({ addsValue: true, exampleTitles: [] }),
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    detail: async (domain) => productWithOffer(domain.startsWith("seed") ? pan : mat),
    searchPage: async (domain) => ({ products: domain.startsWith("seed") ? [pan] : shelfOf(cookware),
      pagination: { cursor: null, hasNextPage: false } }) }) });
const competitor = await competitorCheck(2);
assert.equal(competitor.coverage, "partner_no_product_value");
assert.deepEqual(competitor.coverageIssues, ["partner_sells_starting_product_type"]);
assert.ok(!(await competitorCheck(1)).coverageIssues?.includes("partner_sells_starting_product_type"),
  "One item in eight is a wider range, not a competitor");
assert.ok(!(await competitorCheck(2, { ...pairInput, discoveryBasis: "user_specified" }))
  .coverageIssues?.includes("partner_sells_starting_product_type"), "A user-chosen partner is never dropped");
const specifiedNotScreened = await researchCommercePair({ ...pairInput, discoveryBasis: "user_specified" },
  { ...researchDeps, productQueries: null,
    screenPartner: async () => { throw new Error("A user-chosen partner is never screened"); } });
assert.notEqual(specifiedNotScreened.coverage, "partner_no_product_value");
// Research memory: a recent screen decision (from any run) is reused without
// a model call, and each assessed pair is reported only by hashed key and verdict.
const rememberedOut = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  recallScreen: async () => false });
assert.equal(rememberedOut.coverage, "partner_no_product_value");
assert.equal(rememberedOut.memory.screen.reused, true);
assert.equal(qualified.memory.pairs.length, qualified.assessedCount);
assert.ok(qualified.memory.pairs.every((pair) => /^[0-9a-f]{64}$/.test(pair.opportunityKey) &&
  Object.keys(pair).every((key) => ["opportunityKey", "partnerCategory", "status",
    "mechanismState", "reasonCodes", "judge", "references"].includes(key)) &&
  // Identifiers travel with a pair only for review sampling; memory rows drop them.
  ["seed", "partner"].every((side) => Object.keys(pair.references[side]).every((key) =>
    ["productId", "variantId", "sellerId", "storefrontDomain"].includes(key)))), "No product text enters research memory");
// Who a product is for comes from the merchant's own labels (real Everlane data:
// "/products/mens-linen-ls-shirt-white-blue" in "Men's Clothing").
assert.equal(productWearer({ title: "The Classic Shirt in Linen | White / Blue",
  url: "https://www.everlane.com/products/mens-linen-ls-shirt-white-blue",
  collections: [{ title: "Men’s Clothing" }] }), "men");
assert.equal(productWearer({ title: "Ribbed Cap Sleeve Top", collections: [{ title: "Women's Tops" }, { title: "New" }] }), "women");
assert.equal(productWearer({ title: "Leather Belt", collections: [{ title: "Men's" }, { title: "Women's" }] }), null);
assert.equal(productWearer({ title: "Unisex Hoodie", collections: [{ title: "Men" }] }), null);
assert.equal(productWearer({ title: "Female Founder Candle" }), null, "Only wearer labels count");
assert.equal(brandWearer("Cuyana is a women's premium essentials brand offering handbags"), "women");
assert.equal(brandWearer("Madewell is known for women's and men's jeans"), null);
// A men's starting product: a women-only partner stops before any partner
// search, and women's items never reach the screen or a pair.
const mensTowel = { ...towel, url: "https://seed.example/products/mens-bath-towel" };
const womensMat = { ...mat, collections: [{ title: "Women's Bath" }] };
const bathRobe = { ...mat, id: "gid://shopify/Product/robe", title: "Bath Robe",
  variants: [{ id: "gid://shopify/ProductVariant/robe" }] };
const wearerCatalog = (partnerProducts) => () => ({ ...researchDeps.createCatalog(),
  search: async (domain) => domain.startsWith("seed") ? [mensTowel] : partnerProducts,
  detail: async (domain, id) => productWithOffer(domain.startsWith("seed") ? mensTowel
    : partnerProducts.find((item) => item.id === id) ?? partnerProducts[0]) });
const neverScreened = async () => { throw new Error("Not screened"); };
const womenOnlyBrand = await researchCommercePair({ ...pairInput,
  partner: { ...pairInput.partner, description: "A women's fashion label." } },
{ ...researchDeps, productQueries: null, createCatalog: wearerCatalog([bathRobe]), screenPartner: neverScreened });
assert.equal(womenOnlyBrand.coverage, "partner_no_product_value");
assert.deepEqual(womenOnlyBrand.coverageIssues, ["partner_wearer_mismatch"]);
let wearerSample = null;
await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: wearerCatalog([womensMat, bathRobe]),
  screenPartner: async ({ partnerProducts }) => { wearerSample = partnerProducts.map((item) => item.id);
    return { addsValue: false, exampleTitles: [] }; } });
assert.deepEqual(wearerSample, [bathRobe.id]);
const onlyWomensItems = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: wearerCatalog([womensMat]), screenPartner: neverScreened });
assert.equal(onlyWomensItems.coverage, "partner_no_product_value");
const chosenWomenBrand = await researchCommercePair({ ...pairInput, discoveryBasis: "user_specified",
  partner: { ...pairInput.partner, description: "A women's fashion label." } },
{ ...researchDeps, createCatalog: wearerCatalog([bathRobe]) });
assert.notDeepEqual(chosenWomenBrand.coverageIssues, ["partner_wearer_mismatch"],
  "A partner the user chose is not dropped by its brand description");
// Live case (25 Oct): Cuyana's Qloo description and products ("Mini Paloma Bag")
// never say who they are for; its homepage does.
const storeSaysWomen = await verifyFirstPartyCommerceBusiness(directIdentity, {
  fetchPage: async () => ({ ok: true, contentType: "text/html",
    text: async () => `<html><title>Cuyana | Women's Premium Essentials</title><meta name="description"
      content="Timeless apparel and accessories for the modern woman."></html>` }),
  discoverStorefront: async () => ({ officialHost: "www.cuyana.com", shopId: "gid://shopify/Shop/7",
    domain: "checkout.cuyana.com", proofUrl: "https://checkout.cuyana.com/.well-known/ucp" }) });
assert.equal(storeSaysWomen.storeWearer, "women");
assert.equal(titleOnly.storeWearer, null, "A homepage with no wearer wording sets none");
const paloma = { ...mat, id: "gid://shopify/Product/paloma", title: "Mini Paloma Bag",
  variants: [{ id: "gid://shopify/ProductVariant/paloma" }] };
const womenStore = await researchCommercePair({ ...pairInput, partner: { ...pairInput.partner,
  description: "Premium handbags, leather goods, and versatile clothing.", storeWearer: "women" } },
{ ...researchDeps, productQueries: null, createCatalog: wearerCatalog([paloma]), screenPartner: neverScreened });
assert.deepEqual(womenStore.coverageIssues, ["partner_wearer_mismatch"],
  "A men's product does not reach a store that says it sells for women");
const mixedSignals = await researchCommercePair({ ...pairInput, partner: { ...pairInput.partner,
  description: "A men's outfitter.", storeWearer: "women" } },
{ ...researchDeps, productQueries: null, createCatalog: wearerCatalog([paloma]),
  screenPartner: async () => ({ addsValue: false, exampleTitles: [] }) });
assert.notDeepEqual(mixedSignals.coverageIssues, ["partner_wearer_mismatch"],
  "Conflicting brand signals leave the wearer unknown");
// Wearer rule (25 Oct): for a men's product, a worn partner item with no
// confirmed wearer is dropped; unisex, same-wearer and non-worn items stay.
const worn = (id, title, category) => ({ ...mat, id: `gid://shopify/Product/${id}`, title, collections: [],
  categories: [{ value: `gid://shopify/TaxonomyCategory/${category}`, taxonomy: "shopify" }],
  variants: [{ id: `gid://shopify/ProductVariant/${id}` }] });
const unlabelledBag = worn("bag", "Mini Paloma Bag", "aa-5-4-19");
const unisexTote = worn("tote", "Unisex Canvas Tote", "aa-5-4-10");
const mensBelt = worn("belt", "Men's Owen Belt", "aa-2-6");
let wornSample = null;
await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: wearerCatalog([unlabelledBag, unisexTote, mensBelt, bathRobe]),
  screenPartner: async ({ partnerProducts }) => { wornSample = partnerProducts.map((item) => item.id);
    return { addsValue: false, exampleTitles: [] }; } });
assert.deepEqual(wornSample, [unisexTote.id, mensBelt.id, bathRobe.id]);
const onlyUnconfirmed = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: wearerCatalog([unlabelledBag]), screenPartner: neverScreened });
assert.deepEqual(onlyUnconfirmed.coverageIssues, ["partner_wearer_mismatch"]);
let noWearerSample = null;
await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    search: async (domain) => domain.startsWith("seed") ? [towel] : [unlabelledBag],
    detail: async (domain) => productWithOffer(domain.startsWith("seed") ? towel : unlabelledBag) }),
  screenPartner: async ({ partnerProducts }) => { noWearerSample = partnerProducts.map((item) => item.id);
    return { addsValue: false, exampleTitles: [] }; } });
assert.deepEqual(noWearerSample, [unlabelledBag.id], "A starting product with no stated wearer is unaffected");
// A two-brand Bundle never contains a fit-sized item (25 Oct, user decision).
const sizeOptions = [{ name: "Size", values: [{ label: "S" }, { label: "M" }, { label: "L" }] }];
const sizedSock = { ...worn("sock", "Wool Socks", "aa-1-18"), options: sizeOptions };
const sizedCatalog = (seedItem, partnerItems) => () => ({ ...researchDeps.createCatalog(),
  search: async (domain) => domain.startsWith("seed") ? [seedItem] : partnerItems,
  detail: async (domain, id) => productWithOffer(domain.startsWith("seed") ? seedItem
    : partnerItems.find((item) => item.id === id) ?? partnerItems[0]) });
let bundleSample = null;
await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: sizedCatalog(towel, [sizedSock, bathRobe]),
  screenPartner: async ({ partnerProducts }) => { bundleSample = partnerProducts.map((item) => item.id);
    return { addsValue: false, exampleTitles: [] }; } });
assert.deepEqual(bundleSample, [bathRobe.id], "Sized partner items never enter a Bundle");
// An unlabelled starting product takes its brand's wearer (Qloo description
// and homepage): from a women-only brand, a men's partner item is dropped.
let brandWearerSample = null;
await researchCommercePair({ ...pairInput, seed: { ...pairInput.seed, storeWearer: "women" } }, {
  ...researchDeps, productQueries: null, createCatalog: sizedCatalog(towel, [mensBelt, unisexTote, bathRobe]),
  screenPartner: async ({ partnerProducts }) => { brandWearerSample = partnerProducts.map((item) => item.id);
    return { addsValue: false, exampleTitles: [] }; } });
assert.deepEqual(brandWearerSample, [unisexTote.id, bathRobe.id]);
// Cross-Sell skips a partner item in a category the starting store sells: the
// starting store's own "Belts" search shows belts, so the partner's belt goes.
const seedBelt = worn("seed-belt", "Leather Belt", "aa-2-6");
const seedSearches = [];
const rangeCatalog = () => ({ ...sizedCatalog(towel, [unisexBelt, bathRobe])(),
  search: async (domain, query) => { if (domain.startsWith("seed")) { seedSearches.push(query); return [seedBelt]; }
    return [unisexBelt, bathRobe]; } });
const unisexBelt = worn("ubelt", "Unisex Belt", "aa-2-6");
const seedRange = new Map();
const ownRange = await researchCommercePair({ ...pairInput, objective: "cross_sell", seedRange }, {
  ...researchDeps, productQueries: null, createCatalog: rangeCatalog,
  screenPartner: async () => ({ addsValue: true, exampleTitles: [] }) });
assert.deepEqual(seedSearches, ["Belts"]);
assert.equal(ownRange.pairsSkippedOwnRange > 0, true);
assert.equal(seedRange.get("aa-2-6"), true, "The answer is shared with later partners");
assert.ok(ownRange.memory.pairs.every((pair) => pair.partnerCategory !== "aa-2-6"));
seedSearches.length = 0;
const bundleRange = await researchCommercePair(pairInput, { ...researchDeps, productQueries: null,
  createCatalog: rangeCatalog, screenPartner: async () => ({ addsValue: true, exampleTitles: [] }) });
assert.equal(seedSearches.length, 0, "Bundles do not check the starting store's range");
assert.equal(bundleRange.pairsSkippedOwnRange, 0);
assert.equal(qualified.opportunities.supported.length, 1);
const evidenceRetryEvents = [];
const targetedEvidence = await researchCommercePair(pairInput, { ...researchDeps,
  proposeMechanism: async () => ({ ...bathProposal,
    seedFacts: ["Absorbent cotton towel for drying after bathing"] }),
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    detail: async (domain) => productWithOffer(domain.startsWith("seed")
      ? { ...towel, description: "", url: "https://seed.example.com/products/towel" } : mat) }),
  readSelectedProductPage: async (product) => product.id === towel.id
    ? { description: "Absorbent cotton towel for drying after bathing" } : null,
  onEvaluation: (event) => evidenceRetryEvents.push(event),
});
assert.equal(targetedEvidence.opportunities.supported.length, 1);
assert.equal(evidenceRetryEvents[0].targetedEvidenceRetry, true);
assert.equal(evidenceRetryEvents[0].verifiedFactSources.seed[0], "product_description");
await assert.rejects(researchCommercePair(pairInput, { ...researchDeps,
  createCatalog: () => ({
    tools: async () => { throw Object.assign(new Error("temporary limit"),
      { code: "catalog_rate_limited" }); },
    callsUsed: () => 1,
  }),
}), (error) => error.code === "catalog_rate_limited");
const alternateMat = { ...mat, id: "gid://shopify/Product/alternate",
  title: "Bath mat with non-slip backing",
  variants: [{ id: "gid://shopify/ProductVariant/alternate" }] };
const firstPairFails = await researchCommercePair(pairInput, { ...researchDeps,
  productQueries: ["bath"],
  proposeMechanism: async ({ partnerProduct }) => partnerProduct.id === mat.id
    ? { ...bathProposal, kind: "unproven" } : bathProposal,
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    search: async (domain) => domain.startsWith("seed") ? [towel] : [mat, alternateMat],
    detail: async (domain, productId) => productWithOffer(domain.startsWith("seed")
      ? towel : productId === alternateMat.id ? alternateMat : mat),
    callsUsed: () => 6,
  }) });
assert.equal(firstPairFails.hypothesesConsidered, 2);
assert.equal(firstPairFails.assessedCount, 2);
assert.equal(firstPairFails.opportunities.supported.length, 1);
const focusedQueries = [];
const focusedAdaptive = await researchCommercePair({ ...pairInput,
  userConstraints: { heroProduct: { productId: towel.id, variantId: towel.variants[0].id } } }, {
  ...researchDeps, productQueries: null,
  planPartnerSearch: async ({ objective, seedProduct, partnerProducts }) => {
    assert.equal(objective, "product_bundle");
    assert.equal(seedProduct.id, towel.id);
    assert.deepEqual(partnerProducts.map((item) => item.id), [mat.id, alternateMat.id]);
    return { queries: ["non-slip bath mat"], observedProductIds: [alternateMat.id] };
  },
  proposeMechanism: async ({ partnerProduct }) => partnerProduct.id === alternateMat.id
    ? bathProposal : { ...bathProposal, kind: "unproven" },
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    search: async (domain, query) => {
      if (domain.startsWith("partner")) focusedQueries.push(query);
      return domain.startsWith("seed") ? [towel]
        : query === "non-slip bath mat" ? [alternateMat] : [mat, alternateMat];
    },
    detail: async (domain, productId) => productWithOffer(domain.startsWith("seed")
      ? towel : productId === alternateMat.id ? alternateMat : mat),
  }),
});
assert.deepEqual(focusedQueries.slice(0, 2), ["products", "non-slip bath mat"]);
assert.equal(focusedAdaptive.opportunities.supported[0].best.partnerProductId, alternateMat.id);
assert.equal(focusedAdaptive.opportunities.supported[0].best.seedProductId, towel.id);
assert.equal(focusedAdaptive.productSearchPlanning, "catalog_guided");
const unrelatedArt = { ...mat, id: "gid://shopify/Product/unrelated-art",
  title: "Abstract Wall Art", product_type: "Wall Art",
  variants: [{ id: "gid://shopify/ProductVariant/unrelated-art" }] };
const retrievalCatalog = () => ({ ...researchDeps.createCatalog(),
  search: async (domain, query) => domain.startsWith("seed") ? [towel]
    : query === "bath mat" ? [mat] : [unrelatedArt],
  detail: async (domain, productId) => productWithOffer(domain.startsWith("seed")
    ? towel : productId === mat.id ? mat : unrelatedArt),
});
const retrievalInput = { ...pairInput, partner: { ...pairInput.partner,
  productHints: "", name: "Partner" },
  userConstraints: { heroProduct: { productId: towel.id, variantId: towel.variants[0].id } } };
const retrievalDeps = { ...researchDeps, productQueries: null,
  createCatalog: retrievalCatalog,
  proposeMechanism: async ({ partnerProduct }) => partnerProduct.id === mat.id
    ? bathProposal : { ...bathProposal, kind: "unproven" } };
const retrievalBaseline = await researchCommercePair(retrievalInput, {
  ...retrievalDeps, planPartnerSearch: async () => null });
const retrievalGuided = await researchCommercePair(retrievalInput, {
  ...retrievalDeps, planPartnerSearch: async () => ({ queries: ["bath mat"],
    observedProductIds: [] }) });
assert.equal(retrievalBaseline.opportunities.supported.length, 0);
assert.equal(retrievalGuided.opportunities.supported[0].best.partnerProductId, mat.id);
const focusedWithoutPlanner = await researchCommercePair({ ...pairInput, objective: "cross_sell",
  userConstraints: { heroProduct: { productId: towel.id, variantId: towel.variants[0].id } } }, {
  ...researchDeps, productQueries: null,
  planPartnerSearch: async () => { throw new Error("Planning unavailable"); },
});
assert.ok(focusedWithoutPlanner.coverageIssues.includes("partner_search_planning_unavailable"));
assert.equal(focusedWithoutPlanner.productSearchPlanning, "fallback");
assert.ok(focusedWithoutPlanner.assessedCount > 0);
const heroTransportFailure = await researchCommercePair(retrievalInput, {
  ...researchDeps, productQueries: null,
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    detail: async () => { throw Object.assign(new Error("fetch failed"),
      { cause: { code: "EAI_AGAIN" } }); }, callsUsed: () => 2 }),
});
assert.equal(heroTransportFailure.coverage, "catalog_unavailable");
assert.equal(heroTransportFailure.callsUsed, 2);
assert.equal(heroTransportFailure.stopReason, "catalog_unavailable");
const heroRateLimited = await researchCommercePair(retrievalInput, {
  ...researchDeps, productQueries: null,
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    detail: async () => { throw Object.assign(new Error("rate limited"),
      { code: "catalog_rate_limited" }); }, callsUsed: () => 2 }),
});
assert.equal(heroRateLimited.coverage, "catalog_rate_limited");
assert.equal(heroRateLimited.callsUsed, 2);
const qualifiedCrossSell = await researchCommercePair({ ...pairInput,
  objective: "cross_sell" }, researchDeps);
const changedSeedShop = await researchCommercePair({ ...pairInput,
  seed: { ...pairInput.seed, verifiedShopId: "gid://shopify/Shop/different" } }, researchDeps);
assert.equal(changedSeedShop.coverage, "seed_storefront_changed");
assert.equal(changedSeedShop.callsUsed, 0);
assert.equal(qualifiedCrossSell.opportunities.supported.length, 1);
assert.equal(qualifiedCrossSell.opportunities.supported[0].best.assessment.productMechanism.kind,
  "assortment_complement");
const modelUnavailable = await researchCommercePair(pairInput, { ...researchDeps,
  proposeMechanism: async () => { throw new Error("Model unavailable"); } });
assert.equal(modelUnavailable.opportunities.supported.length, 0);
assert.equal(modelUnavailable.opportunities.needs_verification.length, 0);
assert.ok(modelUnavailable.assessedCount > 0);
assert.ok(modelUnavailable.coverageIssues.includes("mechanism_research_unavailable"));
assert.equal(qualified.coverage, "partial_assortment");
assert.deepEqual(qualified.opportunities.supported[0].best.assessment.assortmentScope.observedFamilies,
  ["bath towel"]);
assert.equal(qualified.opportunities.supported[0].best.assessment.assortmentScope.coverage, "partial");
const focusedProduct = await researchCommercePair({ ...pairInput,
  userConstraints: { heroProduct: { productId: towel.id, variantId: towel.variants[0].id } } }, researchDeps);
assert.equal(focusedProduct.opportunities.supported[0].best.assessment.rankingFeatures.objectiveSuitability,
  "clearly_serves_objective");
const productSpecificFocus = assessFixture({
  seedDetail: { ...fixtureEvidence.seedDetail,
    product: { ...fixtureEvidence.seedDetail.product,
      description: { plain: "Absorbent terry fabric dries after bathing" } } },
  sourceAuthority: { seedDescription: true, partnerDescription: true },
  mechanismProposal: { ...bathProposal,
    seedFacts: ["Bath towel", "Absorbent terry fabric dries after bathing"] },
  rubricVerification: specificRubric,
  userConstraints: { heroProduct: fixtureEvidence.selectedSeed },
});
assert.equal(productSpecificFocus.status, "supported");
// The reverse proof is accepted only when Qloo's explainability shows the
// partner as the request's input signal.
const reverseProof = (envelope) => ({ discoveryBasis: "user_specified", cultureEvidence: {
  kind: "reverse_unconstrained_native", seedQlooId: fixtureEvidence.seed.qlooId,
  partnerQlooId: fixtureEvidence.partner.qlooId, unconstrained: true, envelope } });
const anchoredEnvelope = (signalId) => ({ status: "ok", explainability: { "signal.interests.entities": {
  effect_on_all_recs: [{ avg_score: 1, entity_id: signalId }] } },
  results: [{ entity_id: fixtureEvidence.seed.qlooId, type: "urn:entity" }] });
const reverseAccepted = assessFixture(reverseProof(anchoredEnvelope(fixtureEvidence.partner.qlooId.toUpperCase())));
assert.equal(reverseAccepted.culturalRelationship, "direct_pair_supported");
assert.equal(reverseAccepted.status, "supported");
assert.equal(assessFixture(reverseProof(anchoredEnvelope(fixtureEvidence.seed.qlooId))).culturalRelationship,
  "unknown", "A list built from another brand is not the partner's recommendation");
const unanchored = anchoredEnvelope(fixtureEvidence.partner.qlooId); delete unanchored.explainability;
assert.equal(assessFixture(reverseProof(unanchored)).culturalRelationship, "unknown");
// A Qloo taste tag both brands carry names the cultural theme: broad on its
// own, specific when the selected products' own text corroborates it.
const sharedTag = { id: "urn:tag:keyword:qloo:spa_like_bathroom", name: "Spa Like Bathroom" };
const genericTag = { id: "urn:tag:keyword:qloo:lifestyle", name: "lifestyle" };
const taggedCulture = (seedTags, partnerTags) => ({ ...fixtureEvidence.cultureEvidence, seedTags, partnerTags });
const broadTheme = assessFixture({ cultureEvidence: taggedCulture([sharedTag, genericTag], [sharedTag, genericTag]) });
assert.equal(broadTheme.culturalExplanation, "broad_theme");
assert.equal(broadTheme.culturalTheme, "Spa Like Bathroom");
assert.equal(broadTheme.status, "supported", "A theme explains; it never changes the verdict");
const specificTheme = assessFixture({ cultureEvidence: taggedCulture([sharedTag], [sharedTag]),
  sourceAuthority: { seedDescription: true, partnerDescription: true },
  seedDetail: { ...fixtureEvidence.seedDetail, product: { ...fixtureEvidence.seedDetail.product,
    description: { plain: "Plush towel for a spa like bathroom at home." } } } });
assert.equal(specificTheme.culturalExplanation, "specific_theme");
assert.equal(assessFixture({ cultureEvidence: taggedCulture([genericTag], [genericTag]) }).culturalExplanation,
  "no_named_theme", "Generic tags never name a theme");
assert.equal(assessFixture({ cultureEvidence: taggedCulture([sharedTag], []) }).culturalExplanation,
  "no_named_theme", "A tag only one brand carries is not shared");
// Shared audience tastes (real tag kinds from a Caraway/Brooklinen lookup):
// meaningful tastes kept, payment/price/story-word noise dropped, no ranking effect.
// Popularities are Qloo's (26 Oct). Shared music, film and dining genres
// are no longer shown (rhythm & blues, popularity 0.98, was on 11 of 11 brands).
const tasteTags = [{ id: "urn:tag:genre:media:cookbooks", name: "Cookbooks", popularity: 0.99982 },
  { id: "urn:tag:genre:music:folk", name: " folk", popularity: 0.9997 },
  { id: "urn:tag:genre:music:bluegrass", name: " bluegrass", popularity: 0.995 },
  { id: "urn:tag:genre:media:food", name: "Food" },
  { id: "urn:tag:credit_card:place:discover", name: "Discover", popularity: 0.99999 },
  { id: "urn:tag:keyword:media:friendship", name: "friendship", popularity: 0.99 },
  { id: "urn:tag:specialty_dish:place:avocado_toast", name: "Avocado Toast", popularity: 0.99 }];
const withTastes = assessFixture({ cultureEvidence: taggedCulture(tasteTags, tasteTags) });
assert.deepEqual(withTastes.sharedAudienceTastes, [],
  "Shared genres are not shown: across 11 brands they were near-universal even below the popularity cutoff");
assert.doesNotMatch(culturalSummary(withTastes, "Seed", "Partner"), /share a taste/);
// Who both brands resonate with (real Rumpl / United by Blue / Caraway / Arhaus
// tags, 26 Oct): brand level. A tag both brands carry in the top half of their
// lists, not near-universal; ordered by the weaker position, with one the
// products mention first; children are never presented as the audience.
const appealTag = (type, name, popularity) => ({ id: `urn:tag:${type}:qloo:${name.toLowerCase().replace(/[^a-z]+/g, "_")}`, name, popularity });
const appealSeed = [appealTag("influencer_appeal", "Environmental Advocates", 0.9942),
  appealTag("lifestyle", "Environmental Stewardship", 0.9971), appealTag("customer_segment", "Toddlers", 0.9334),
  appealTag("customer_segment", "Hikers", 0.975), appealTag("lifestyle", "Adventure", 0.9996),
  appealTag("customer_identity", "Sustainability advocates", 0.9757)];
const appealPartner = [appealTag("customer_identity", "Sustainability advocates", 0.9757),
  appealTag("influencer_appeal", "Environmental Advocates", 0.9942), appealTag("customer_segment", "Toddlers", 0.9334),
  appealTag("lifestyle", "Environmental Stewardship", 0.9971), appealTag("lifestyle", "Adventure", 0.9996),
  appealTag("customer_segment", "Hikers", 0.975)];
const appealed = assessFixture({ cultureEvidence: { ...taggedCulture([], []),
  seedAudienceTags: appealSeed, partnerAudienceTags: appealPartner } });
assert.deepEqual(appealed.sharedAudienceAppeal, { people: ["environmental advocates"], lifestyle: [] },
"Brand level without product text; toddlers (children) and near-universal adventure are not shown; environmental stewardship, sustainability advocates and hikers are outside one brand's top half");
assert.equal(appealed.status, "supported", "Audience appeal explains; it never changes the verdict");
assert.match(culturalSummary(appealed, "Rumpl", "United by Blue"), /Both brands resonate with environmental advocates\./);
const appealOrder = assessFixture({ cultureEvidence: { ...taggedCulture([], []),
  seedAudienceTags: [appealTag("customer_segment", "Adventurers", 0.947), appealTag("customer_identity", "Outdoor Enthusiasts", 0.9665),
    appealTag("customer_segment", "Campers", 0.9791), appealTag("customer_segment", "Travelers", 0.9784)],
  partnerAudienceTags: [appealTag("customer_segment", "Adventurers", 0.947), appealTag("customer_identity", "Outdoor Enthusiasts", 0.9665),
    appealTag("customer_segment", "Campers", 0.9791), appealTag("customer_segment", "Travelers", 0.9784)] },
  sourceAuthority: { seedDescription: true, partnerDescription: true },
  seedDetail: { ...fixtureEvidence.seedDetail, product: { ...fixtureEvidence.seedDetail.product,
    description: { plain: "Made for outdoor recreation." } } } });
assert.deepEqual(appealOrder.sharedAudienceAppeal.people, ["outdoor enthusiasts", "adventurers"],
  "A tag the products mention goes first; product text orders, it never hides");
// Brand-attribute tags from a real Everlane/Cuyana/Nisolo lookup name themes,
// matched by descriptor across tag kinds; up to three are kept for display.
const everlaneTags = [{ id: "urn:tag:lifestyle:qloo:conscious_consumerism", name: "Conscious Consumerism" },
  { id: "urn:tag:keyword:qloo:minimalist_design", name: "Minimalist Design" },
  { id: "urn:tag:customer_identity:qloo:socially_responsible", name: "Socially Responsible" },
  { id: "urn:tag:product_service:qloo:womens_apparel", name: "Womens Apparel" }];
const partnerTags = [{ id: "urn:tag:keyword:qloo:minimalist_design", name: "Minimalist Design" },
  { id: "urn:tag:lifestyle:qloo:socially_responsible", name: "Socially Responsible" },
  { id: "urn:tag:lifestyle:qloo:conscious_consumerism", name: "Conscious Consumerism" },
  { id: "urn:tag:product_service:qloo:womens_apparel", name: "Womens Apparel" }];
const themed = assessFixture({ cultureEvidence: taggedCulture(everlaneTags, partnerTags) });
assert.equal(themed.culturalExplanation, "broad_theme");
assert.deepEqual(themed.culturalThemes, ["Conscious Consumerism", "Minimalist Design", "Socially Responsible"],
  "Product categories are not themes");
assert.deepEqual(assessFixture().culturalThemes, []);
assert.equal(withTastes.culturalExplanation, "no_named_theme", "Audience tastes never set the ranking theme");
assert.deepEqual(withTastes.rankingFeatures, assessFixture().rankingFeatures);
// A stated occasion and preferences rank higher only from the judgment's
// answers, which can never change the verdict.
const occasionFocus = assessFixture({ userConstraints: { occasion: "weekend guest bathroom refresh",
  softPreferences: ["quick drying"] },
  rubricVerification: { ...bathRubric, servesStatedOccasion: true, verifiedPreferences: ["quick drying"] } });
assert.equal(occasionFocus.status, "supported");
assert.equal(occasionFocus.rankingFeatures.objectiveSuitability, "matches_explicit_focus");
assert.equal(occasionFocus.rankingFeatures.verifiedMatchedPreferencesCount, 1);
const occasionMissed = assessFixture({ userConstraints: { occasion: "weekend guest bathroom refresh",
  softPreferences: ["quick drying"] }, rubricVerification: { ...bathRubric, servesStatedOccasion: false } });
assert.equal(occasionMissed.status, "supported", "A missed preference never changes the verdict");
assert.notEqual(occasionMissed.rankingFeatures.objectiveSuitability, "matches_explicit_focus");
assert.equal(occasionMissed.rankingFeatures.verifiedMatchedPreferencesCount, 0);
assert.equal(productSpecificFocus.rankingFeatures.objectiveSuitability, "matches_explicit_focus");
assert.deepEqual(parsePartnerProductSelection('{"productIds":["observed-1"]}'),
  { productIds: ["observed-1"] });
const widePartnerSample = Array.from({ length: 16 }, (_, index) => ({
  id: `observed-${index}`, title: `Observed product ${index}`,
  product_type: index % 2 ? "Accessory" : "Home",
  variants: [{ id: `variant-${index}` }],
}));
const rankedPartnerProducts = prioritizePartnerResearchProducts([
  widePartnerSample, [widePartnerSample[12], widePartnerSample[15]]],
["unreturned-id", widePartnerSample[15].id], 4);
assert.equal(rankedPartnerProducts[0].id, widePartnerSample[15].id);
assert.ok(rankedPartnerProducts.some((item) => item.id === widePartnerSample[12].id));
assert.ok(rankedPartnerProducts.every((item) => widePartnerSample.includes(item)));
const priceBlocked = await researchCommercePair({ ...pairInput, discoveryBasis: "user_specified",
  userConstraints: { ...chosenTowel, priceLimit: { amountMinor: 3000, currencyCode: "USD" } } }, researchDeps);
assert.equal(priceBlocked.opportunities.unsupported.length, 1);
const changedVariant = await researchCommercePair(pairInput, { ...researchDeps,
  createCatalog: () => ({
    tools: async () => new Set(["search_catalog", "lookup_catalog"]),
    search: async (domain) => domain.startsWith("seed") ? [towel] : [mat],
    detail: async (domain) => { if (domain.startsWith("seed")) return productWithOffer(towel);
      throw new Error("selected variant changed"); },
    callsUsed: () => 4,
  }) });
assert.equal(changedVariant.opportunities.supported.length, 0);
assert.ok(changedVariant.coverageIssues.includes("selected_variant_or_product_unverified"));
const changedChosenProduct = await researchCommercePair(pairInput, { ...researchDeps,
  createCatalog: () => ({ ...researchDeps.createCatalog(),
    detail: async () => { throw new Error("selected variant changed"); } }) });
assert.equal(changedChosenProduct.coverage, "selected_seed_product_unverified");
const uncertain = await researchCommercePair({ ...pairInput, cultureEvidence: null }, researchDeps);
assert.equal(uncertain.opportunities.supported.length, 0);
assert.equal(uncertain.opportunities.needs_verification.length, 1);
const selectedRefs = { seed: { productId: "gid://shopify/Product/10",
  variantId: "gid://shopify/ProductVariant/11", sellerId: "gid://shopify/Shop/1",
  storefrontDomain: "seed.example.com", forbiddenProduct: { title: "do-not-persist-title" } },
partner: { productId: "gid://shopify/Product/20", variantId: "gid://shopify/ProductVariant/21",
  sellerId: "gid://shopify/Shop/2", storefrontDomain: "partner.example.com" } };
const saved = durableCommerceDecision({ ...qualified.opportunities.supported[0].best,
  references: selectedRefs,
  live: { title: "Do not persist", price: { amount: 4400 }, image: "do-not-persist-image" } });
assert.equal(saved.assessment.status, "supported");
assert.equal(JSON.stringify(saved).includes("do-not-persist"), false);
assert.equal(JSON.stringify(saved).includes("4400"), false);
assert.deepEqual(Object.keys(saved.references.seed), ["productId", "variantId", "sellerId", "storefrontDomain"]);
assert.throws(() => durableCommerceDecision({ ...qualified.opportunities.supported[0].best,
  references: { ...selectedRefs, seed: { ...selectedRefs.seed, productId: { product: "full payload" } } } }),
/Exact selected offer reference/);
const current = { seed: { status: "current", available: true,
  price: { amountMinor: 4400, currencyCode: "USD" }, marketCheck: { state: "supported" } },
partner: { status: "current", available: true,
  price: { amountMinor: 4400, currencyCode: "USD" }, marketCheck: { state: "supported" } } };
const requirements = { mustShipToMarket: true, mustBeAvailableNow: true,
  priceLimit: { amountMinor: 5000, currencyCode: "USD" } };
assert.equal(currentCommerceAssessment(saved.assessment, current, requirements).status, "supported");
assert.equal(currentCommerceAssessment(saved.assessment,
  { ...current, partner: { ...current.partner, status: "unverified" } }, requirements).status,
"needs_verification");
const unreachable = currentCommerceAssessment(saved.assessment,
  { ...current, partner: { status: "lookup_unreachable" } }, requirements);
assert.equal(unreachable.currentOfferReview, "refresh_unavailable");
assert.equal(unreachable.status, "needs_verification");
assert.equal(saved.assessment.status, "supported");
assert.equal(currentCommerceAssessment(saved.assessment,
  { seed: { status: "contradicted" }, partner: { status: "lookup_unreachable" } }, requirements)
  .currentOfferReview, "changed_since_assessment");
assert.equal(currentCommerceAssessment(saved.assessment,
  { ...current, partner: { ...current.partner, status: "contradicted" } }, requirements).status,
"unsupported");
assert.equal(currentCommerceAssessment(saved.assessment,
  { ...current, partner: { ...current.partner, available: false } }, requirements).status,
"unsupported");
assert.equal(currentCommerceAssessment(saved.assessment,
  { ...current, partner: { ...current.partner, price: { amountMinor: 6000, currencyCode: "USD" } } },
  requirements).status, "unsupported");
assert.equal(currentCommerceAssessment(saved.assessment,
  { ...current, partner: { ...current.partner, price: { amountMinor: 4400, currencyCode: "CAD" } } },
  requirements).status, "needs_verification");
assert.equal(currentCommerceAssessment(saved.assessment,
  { ...current, partner: { ...current.partner, marketCheck: { state: "unknown" } } },
  requirements).status, "needs_verification");
const changedSeller = await refreshCommerceOffers({ seed: selectedRefs.seed, partner: selectedRefs.partner }, {
  createCatalog: () => ({ tools: async () => new Set(["lookup_catalog"]),
    detail: async (domain, productId, variantId) => ({ product: { id: productId, title: "Selected" },
      variant: { id: variantId, seller: { id: domain === "seed.example.com"
        ? "gid://shopify/Shop/1" : "gid://shopify/Shop/999" } }, fetchedAt: new Date().toISOString() }) }),
});
assert.equal(changedSeller.partner.status, "contradicted");
const changedStore = await refreshCommerceOffers(selectedRefs, {
  officialSites: { seed: "https://seed.example.com", partner: "https://partner.example.com" },
  verifyStore: async (url) => ({ domain: new URL(url).hostname,
    shopId: url.includes("partner") ? "gid://shopify/Shop/999" : "gid://shopify/Shop/1" }),
  createCatalog: () => ({ tools: async () => new Set(["lookup_catalog"]),
    detail: async (_domain, productId, variantId) => ({ product: { id: productId, title: "Selected" },
      variant: { id: variantId }, fetchedAt: new Date().toISOString() }) }),
});
assert.equal(changedStore.partner.status, "contradicted");
const alternateVerifiedHost = await refreshCommerceOffers({ ...selectedRefs,
  seed: { ...selectedRefs.seed, storefrontDomain: "www.example.com" } }, {
  officialSites: { seed: "https://www.example.com" },
  verifyStore: async (_url, options = {}) => ({ domain: options.onlyDomain ?? "example.com",
    shopId: "gid://shopify/Shop/1" }),
  createCatalog: () => ({ tools: async () => new Set(["lookup_catalog"]),
    detail: async (_domain, productId, variantId) => ({ product: { id: productId, title: "Selected" },
      variant: { id: variantId }, fetchedAt: new Date().toISOString() }) }),
});
assert.equal(alternateVerifiedHost.seed.status, "current");
const refreshOutage = await refreshCommerceOffers(selectedRefs, {
  createCatalog: () => ({ tools: async () => { throw new Error("temporary timeout"); } }),
});
assert.equal(refreshOutage.partner.status, "lookup_unreachable");
const vetted = await vetCommerceShortlist({ name: "Test Partner",
  officialWebsite: "https://partner.example.com" }, { search: async (query) => ({
    results: query.includes("partnerships")
      ? [{ inspected: true, url: "https://partner.example.com/journal",
        title: "Test Partner collaboration with Maker", publishedAt: "2026-05-01" }]
      : query.includes("collaboration")
        ? [{ inspected: true, url: "https://independent.example.org/report",
          title: "Test Partner partnered with Maker", publishedAt: "2026-05-01" },
          { inspected: true, url: "https://www.linkedin.com/in/person",
            title: "Director of Partnerships at Test Partner", publishedAt: "2026-05-01" }]
        : [{ inspected: true, url: "https://unrelated.example.org/terms",
          title: "Terms of service", snippet: "Test Partner policies", publishedAt: "2026-05-01" }],
  }) });
assert.equal(vetted.findings.length, 2);
assert.equal(vetted.findings[1].kind, "independent_context_to_review");
const irrelevantVetting = await vetCommerceShortlist({ name: "Test Partner",
  officialWebsite: "https://partner.example.com" }, { search: async () => ({ results: [
    { inspected: true, url: "https://independent.example.org/opinion",
      title: "Test Partner industry commentary", snippet: "Test Partner is a large company." },
  ] }) });
assert.equal(irrelevantVetting.status, "no_inspected_context");
assert.equal(publicIpAddress("127.0.0.1"), false);
assert.equal(publicIpAddress("10.1.2.3"), false);
assert.equal(publicIpAddress("::1"), false);
assert.equal(publicIpAddress("8.8.8.8"), true);


const seedId = "11111111-1111-4111-8111-111111111111";
const variedLeads = Array.from({ length: 10 }, (_, index) => ({ originalOrder: index + 1,
  description: index < 6 ? "fashion apparel" : index === 8 ? "tea and food" : "" }));
const sampledLeads = selectNativeCommerceLeads(variedLeads, 6);
assert.equal(sampledLeads.length, 6);
assert.deepEqual(sampledLeads.slice(0, 4).map((item) => item.originalOrder), [1, 2, 3, 4]);
assert.ok(sampledLeads.some((item) => item.originalOrder === 9));
const distinctDescriptions = ["almond", "bamboo", "copper", "denim", "enamel",
  "flannel", "gingham", "hemp", "indigo", "jersey", "khaki", "linen"];
assert.deepEqual(selectNativeCommerceLeads(distinctDescriptions.map((description, index) =>
  ({ originalOrder: index + 1, description })), 6).map((item) => item.originalOrder),
  [1, 2, 3, 5, 8, 11]);
const unfamiliarSector = selectNativeCommerceLeads([
  ...Array.from({ length: 6 }, (_, index) => ({ originalOrder: index + 1,
    description: "ceramic tableware" })),
  { originalOrder: 7, description: "analog photographic film" },
  { originalOrder: 8, description: "ceramic tableware" },
], 6);
assert.ok(unfamiliarSector.some((item) => item.originalOrder === 7));
const firstId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const attempted = [];
const nativeDeps = {
  recommend: async () => ({ envelope: { status: "ok", results: [
    { entity_id: firstId, name: "First candidate", properties: { website: "https://first.example.com" } },
    { entity_id: secondId, name: "Second candidate", properties: { website: "https://second.example.com" } },
  ] }, responseId: "44444444-4444-4444-8444-444444444444", inputHash: "hash" }),
  focused: async () => ({ envelope: { status: "ok", results: [] } }),
  investigateDirect: async () => ({ relationship: "unknown", explanation: "no_named_theme",
    theme: null, qlooResponseIds: [], sourceUrls: [] }),
  vetShortlist: async () => ({ status: "no_inspected_context", sourceUrls: [] }),
  verifyBusiness: async (item) => ({ id: item.qlooId, name: item.name,
    officialWebsite: item.website, identityStatus: "verified" }),
  researchPair: async (input) => {
    attempted.push(input.partner.id);
    if (input.partner.id === firstId) return { coverage: "no_catalog_results",
      opportunities: { supported: [], needs_verification: [], unsupported: [] } };
    const item = { ...better, partnerId: secondId,
      assessment: assessFixture(input.discoveryBasis === "user_specified"
        ? { discoveryBasis: "user_specified", cultureEvidence: null } : {}) };
    return { coverage: "partial_assortment",
      opportunities: rankCommerceOpportunities([item]) };
  },
};
const native = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle" }, nativeDeps);
assert.deepEqual(attempted, [firstId, secondId]);
assert.equal(native.opportunities.supported.length, 1);
assert.equal(native.candidates[0].status, "no_catalog_results");
let proofFallbackCalls = 0;
const reusedSeedProof = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { ...confirmedSeed, qlooId: seedId, proofQlooId: seedId,
    identityVerifiedAt: new Date().toISOString() },
  seedQlooId: seedId, objective: "product_bundle" }, {
  ...nativeDeps, verifyBusiness: async (item) => {
    if (item.qlooId === seedId) proofFallbackCalls += 1;
    return nativeDeps.verifyBusiness(item);
  },
});
assert.equal(proofFallbackCalls, 0);
assert.equal(reusedSeedProof.opportunities.supported.length, 1);
let vetClock = 0;
let postResearchVetting = 0;
const vettedAfterResearchLimit = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle", maxResearchMs: 1 }, {
  ...nativeDeps, now: () => vetClock,
  recommend: async () => ({ envelope: { status: "ok", results: [
    { entity_id: secondId, name: "Second candidate",
      properties: { website: "https://second.example.com" } },
  ] } }),
  researchPair: async (input) => {
    vetClock = 2;
    return nativeDeps.researchPair(input);
  },
  vetShortlist: async () => { postResearchVetting += 1;
    return { status: "no_inspected_context", sourceUrls: [] }; },
});
assert.equal(postResearchVetting, 0, "Public-source review runs when the user saves, not during research");
assert.equal(vettedAfterResearchLimit.stopReason, "research_time_limit_reached");
let nativeClockReads = 0;
const nativeTimeLimit = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle", maxResearchMs: 1 }, {
  ...nativeDeps, now: () => (nativeClockReads++ === 0 ? 0 : 2) });
assert.equal(nativeTimeLimit.stopReason, "research_time_limit_reached");
assert.equal(nativeTimeLimit.candidates.length, 0);
const zeroCallPartners = [];
// Budget sharing below is written for two partners at a time.
process.env.COMMERCE_PARTNER_CONCURRENCY = "2";
const noPhantomCatalogSpend = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle", maxCatalogCalls: 22 }, {
  ...nativeDeps,
  recommend: async () => ({ envelope: { status: "ok", results: Array.from({ length: 4 },
    (_, index) => ({ entity_id: `${index + 2}2222222-2222-4222-8222-222222222222`,
      name: `Candidate ${index}`, properties: { website: `https://candidate${index}.example.com` } })) },
  }),
  researchPair: async (input) => {
    zeroCallPartners.push(input.partner.name);
    return { coverage: "storefront_probe_unavailable", callsUsed: 0,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } };
  },
});
assert.equal(zeroCallPartners.length, 4);
assert.equal(noPhantomCatalogSpend.catalogCallsUsed, 0);
assert.equal(noPhantomCatalogSpend.stopReason, "candidate_pool_exhausted");
delete process.env.COMMERCE_PARTNER_CONCURRENCY;
const afterRateLimit = [];
const stoppedAtRateLimit = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle" }, {
  ...nativeDeps,
  recommend: async () => ({ envelope: { status: "ok", results: [firstId, secondId,
    "66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"].map((id, index) => ({
    entity_id: id, name: `Rate candidate ${index}`, properties: { website: `https://rate${index}.example.com` } })) } }),
  researchPair: async (input) => {
    afterRateLimit.push(input.partner.id);
    return { coverage: "catalog_rate_limited", coverageIssues: ["catalog_rate_limited"],
      stopReason: "catalog_rate_limited", callsUsed: 3,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } };
  },
});
// Three partners run at a time; after a rate limit no further partner starts.
assert.ok(afterRateLimit.length <= 3 && afterRateLimit[0] === firstId);
assert.equal(stoppedAtRateLimit.stopReason, "catalog_rate_limited");
assert.equal(stoppedAtRateLimit.coverage, "catalog_rate_limited");
assert.equal(stoppedAtRateLimit.candidates[0].status, "catalog_rate_limited");
const missingSeedShop = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle" }, {
  ...nativeDeps, verifyBusiness: async () => null,
  discoverStorefront: async () => null,
});
assert.equal(missingSeedShop.coverage, "seed_storefront_unverified");
const missingSeedIdentity = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle" }, {
  ...nativeDeps, verifyBusiness: async () => null,
  discoverStorefront: async () => ({ shopId: "gid://shopify/Shop/1" }),
});
assert.equal(missingSeedIdentity.coverage, "seed_identity_unverified");
const direct = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle",
  specifiedPartner: { qlooId: secondId, name: "Second candidate",
    officialWebsite: "https://second.example.com" } }, nativeDeps);
assert.equal(direct.opportunities.supported.length, 0);
assert.equal(direct.opportunities.needs_verification.length, 1);
// A partner the user chose to compare is assessed in full, even if they
// passed on a pair with it during discovery; liked and excluded partners do
// not reorder or remove a chosen partner either.
let directPassed = null;
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: seedId, objective: "product_bundle",
  userFeedback: { rejectedPairKeys: ["a".repeat(64)], excludedPartnerQlooIds: [secondId], preferredPartnerQlooIds: [] },
  specifiedPartner: { qlooId: secondId, name: "Second candidate",
    officialWebsite: "https://second.example.com" } }, { ...nativeDeps,
  researchPair: async (input) => { directPassed = input.userRejectedPairs;
    return nativeDeps.researchPair(input); } });
assert.deepEqual(directPassed, [], "Compare Two Brands ignores discovery passes");
const exactTag = { id: "urn:tag:aesthetic_property:qloo:geometric_patterns",
  name: "Geometric Patterns" };
const corroborated = await investigateDirectCommerceCulture("owner", {
  qlooId: seedId, name: "Seed", officialWebsite: "https://seed.example.com",
}, { qlooId: secondId, name: "Second", officialWebsite: "https://second.example.com" }, {
  recommend: async () => null,
  focused: async () => ({ envelope: { status: "ok", results: [
    { entity_id: secondId, affinity: 0.3 }] }, responseId: seedId }),
  tags: async () => ({ tags: [exactTag], responseId: secondId }),
  search: async (query, options) => ({ results: [{ inspected: true,
    url: `https://${options.includeDomains[0]}/design`,
    snippet: `${query} uses Geometric Patterns.` }] }),
});
assert.equal(corroborated.relationship, "direct_pair_supported");
assert.equal(corroborated.sourceUrls.length, 2);
// A partner outside the top 12 but inside Qloo's top 20 for the same open
// recommendation is still a native recommendation.
const recommendLimits = [];
const deeperDirect = await investigateDirectCommerceCulture("owner", {
  qlooId: seedId, name: "Seed", officialWebsite: "https://seed.example.com",
}, { qlooId: secondId, name: "Second", officialWebsite: "https://second.example.com" }, {
  recommend: async (_owner, _seed, options = {}) => { recommendLimits.push(options.limit ?? 12);
    return { envelope: { status: "ok", results: options.limit === 20
      ? [{ entity_id: firstId, type: "urn:entity:brand" }, { entity_id: secondId, type: "urn:entity:brand" }]
      : [{ entity_id: firstId, type: "urn:entity:brand" }] }, responseId: firstId, sampleData: false }; },
  focused: async () => { throw new Error("A native result needs no forced query."); },
});
assert.deepEqual(recommendLimits, [12, 20]);
assert.equal(deeperDirect.relationship, "native_recommendation_verified");
assert.equal(deeperDirect.supportProof.kind, "direct_unconstrained_native");
// Reverse check: Brand A in the chosen partner's own top-20 recommendation.
const reverseEnvelope = { status: "ok", explainability: { "signal.interests.entities": {
  effect_on_all_recs: [{ avg_score: 1, entity_id: secondId.toUpperCase() }] } },
  results: [{ entity_id: seedId.toUpperCase(), type: "urn:entity", subtype: "urn:entity:brand" }] };
const reverseDirect = await investigateDirectCommerceCulture("owner", {
  qlooId: seedId, name: "Seed", officialWebsite: "https://seed.example.com",
}, { qlooId: secondId, name: "Second", officialWebsite: "https://second.example.com" }, {
  recommend: async (_owner, signal) => signal === secondId
    ? { envelope: reverseEnvelope, responseId: secondId, sampleData: false }
    : { envelope: { status: "ok", results: [{ entity_id: firstId }] }, responseId: firstId, sampleData: false },
  focused: async () => { throw new Error("A reverse recommendation needs no forced query."); },
});
assert.equal(reverseDirect.relationship, "direct_pair_supported");
assert.equal(reverseDirect.supportProof.kind, "reverse_unconstrained_native");
const nativeDirect = await investigateDirectCommerceCulture("owner", {
  qlooId: seedId, name: "Seed", officialWebsite: "https://seed.example.com",
}, { qlooId: secondId, name: "Second", officialWebsite: "https://second.example.com" }, {
  recommend: async () => ({ envelope: { status: "ok", results: [
    { entity_id: secondId, type: "urn:entity" }] }, responseId: firstId,
    sampleData: false }),
  focused: async () => { throw new Error("An unconstrained recommendation needs no forced result."); },
});
assert.equal(nativeDirect.relationship, "native_recommendation_verified");
assert.equal(nativeDirect.supportProof.kind, "direct_unconstrained_native");
console.log("Brand commerce adapter and policy checks passed.");
