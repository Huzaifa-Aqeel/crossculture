import assert from "node:assert/strict";
import { discoverVerifiedStorefront, fetchFailureCode } from "../src/shopify-catalog.mjs";
import { fetchBusinessHomepage, verifyFirstPartyCommerceBusiness,
  verifySelectedCommerceBrand, researchNativeCommerce, verifyCommerceBusiness,
  decodeHtmlText, searchHint } from "../src/commerce-native.mjs";
import { researchCommercePair } from "../src/commerce-research.mjs";
import { runFailurePlan } from "../src/personal-research.mjs";
import { sharedLaunchAreas } from "../src/commerce-launch.mjs";
import { qlooCacheIdentity } from "../src/qloo-cache.mjs";
import { nearestMetro } from "../src/geo-places.mjs";
import { objectiveJudgmentOutcome, quotesShareActivity,
  verifyCommerceMechanismRubric } from "../src/commerce-mechanism.mjs";
import { readFile } from "node:fs/promises";

// Offline fixtures for entry and run reliability. No provider is called.
const qlooId = "11111111-1111-4111-8111-111111111111";
const html = (siteName) => ({ ok: true, status: 200, contentType: "text/html",
  text: async () => `<html><meta property="og:site_name" content="${siteName}"></html>` });
const redirect = (status, location) => ({ ok: false, status, location, contentType: "text/html",
  text: async () => "" });
const networkError = (code) => Object.assign(new Error(code), { code });

// Redirects: same-site and cross-domain targets are followed; http is upgraded.
const visited = [];
const followed = await fetchBusinessHomepage("https://faherty.com", { fetchPage: async (url) => {
  visited.push(url);
  return url === "https://faherty.com/"
    ? redirect(302, "http://fahertybrand.com/?redirect_source=faherty.com") : html("Faherty");
} });
assert.equal(followed.finalUrl, "https://fahertybrand.com/?redirect_source=faherty.com");
assert.deepEqual(visited, ["https://faherty.com/", "https://fahertybrand.com/?redirect_source=faherty.com"]);
const loopTrace = [];
assert.equal(await fetchBusinessHomepage("https://loop.example.com", { trace: loopTrace,
  fetchPage: async (url) => redirect(301, url) }), null);
assert.equal(loopTrace.at(-1).reason, "redirect_loop");
const limitTrace = [];
let hop = 0;
assert.equal(await fetchBusinessHomepage("https://hops.example.com", { trace: limitTrace,
  fetchPage: async () => redirect(301, `https://hops.example.com/${hop += 1}`) }), null);
assert.equal(limitTrace.at(-1).reason, "redirect_limit");
const portTrace = [];
assert.equal(await fetchBusinessHomepage("https://port.example.com", { trace: portTrace,
  fetchPage: async () => redirect(302, "https://port.example.com:8443/") }), null);
assert.equal(portTrace.at(-1).reason, "redirect_invalid");

// One retry after a dropped connection; none after a timeout or missing host.
let resets = 0;
assert.ok(await fetchBusinessHomepage("https://reset.example.com", { retryDelayMs: 0,
  fetchPage: async () => { resets += 1; if (resets === 1) throw networkError("ECONNRESET"); return html("Reset"); } }));
assert.equal(resets, 2);
let timeouts = 0;
const timeoutTrace = [];
assert.equal(await fetchBusinessHomepage("https://slow.example.com", { retryDelayMs: 0, trace: timeoutTrace,
  fetchPage: async () => { timeouts += 1; throw Object.assign(new Error("slow"), { name: "TimeoutError" }); } }), null);
assert.equal(timeouts, 1);
assert.equal(timeoutTrace.at(-1).reason, "timeout");
assert.equal(fetchFailureCode(networkError("ENOTFOUND")), "network_enotfound");
// A rate-limited homepage is retried once after a short pause.
let limitedCalls = 0;
assert.ok(await fetchBusinessHomepage("https://busy.example.com", { rateLimitDelayMs: 0,
  fetchPage: async () => (++limitedCalls === 1 ? { ok: false, status: 429 } : html("Busy")) }));
assert.equal(limitedCalls, 2);
const blockedTrace = [];
assert.equal(await fetchBusinessHomepage("https://blocked.example.com", { trace: blockedTrace,
  fetchPage: async () => ({ ok: false, status: 403 }) }), null);
assert.equal(blockedTrace.at(-1).reason, "http_403");

// The redirect target becomes the website that must pass name and shop proof.
const storeOrigins = [];
const redirected = await verifyFirstPartyCommerceBusiness({ qlooId, name: "Everlane",
  website: "https://everlane.com" }, {
  fetchPage: async (url) => url === "https://everlane.com/"
    ? redirect(301, "https://www.everlane.com/") : html("Everlane"),
  discoverStorefront: async (origin) => { storeOrigins.push(origin);
    return { officialHost: "www.everlane.com", shopId: "gid://shopify/Shop/9",
      domain: "www.everlane.com", proofUrl: "https://www.everlane.com/.well-known/ucp" }; },
});
assert.equal(redirected?.officialWebsite, "https://www.everlane.com");
assert.deepEqual(storeOrigins, ["https://www.everlane.com"]);
const trailingTitle = await verifyFirstPartyCommerceBusiness({ qlooId, name: "Prose",
  website: "https://prose.com" }, {
  fetchPage: async () => ({ ok: true, status: 200, contentType: "text/html",
    text: async () => "<html><title>Truly Custom Haircare and Skincare | Prose</title></html>" }),
  discoverStorefront: async () => ({ officialHost: "prose.com", shopId: "gid://shopify/Shop/5",
    domain: "prose.com", proofUrl: "https://prose.com/.well-known/ucp" }) });
assert.equal(trailingTitle?.officialWebsite, "https://prose.com", "The brand may end the page title");
// HTML-encoded site names match the plain brand name.
assert.equal(decodeHtmlText("Lo &amp; Sons"), "Lo & Sons");
assert.equal(decodeHtmlText("Rothy&#39;s"), "Rothy's");
const encodedName = await verifyFirstPartyCommerceBusiness({ qlooId, name: "Lo & Sons",
  website: "https://www.loandsons.com" }, {
  fetchPage: async () => ({ ok: true, status: 200, contentType: "text/html",
    text: async () => '<html><meta\n property="og:site_name"\n content="Lo &amp; Sons"\n></html>' }),
  discoverStorefront: async () => ({ officialHost: "www.loandsons.com", shopId: "gid://shopify/Shop/4",
    domain: "www.loandsons.com", proofUrl: "https://www.loandsons.com/.well-known/ucp" }) });
assert.equal(encodedName?.officialWebsite, "https://www.loandsons.com");
const mismatchTrace = [];
assert.equal(await verifyFirstPartyCommerceBusiness({ qlooId, name: "Everlane",
  website: "https://everlane.com" }, { trace: mismatchTrace,
  fetchPage: async () => html("Another Store"),
  discoverStorefront: async () => { throw new Error("must not run"); } }), null);
assert.equal(mismatchTrace.at(-1).reason, "site_name_mismatch");

// Storefront probes record why each candidate host failed and retry a reset once.
const storeTrace = [];
const probes = [];
const ucp = { ok: true, json: async () => ({ ucp: { version: "2026-08-25",
  capabilities: { "dev.ucp.shopping.catalog.search": [{}] },
  services: { "dev.ucp.shopping": [{ transport: "mcp", version: "2026-08-25",
    endpoint: "https://checkout.example.com/api/ucp/mcp" }] },
  payment_handlers: { "dev.shopify.shop_pay": [{ config: { shop_id: "7" } }] } } }) };
const store = await discoverVerifiedStorefront("https://example.com", { retryDelayMs: 0, trace: storeTrace,
  fetcher: async (url) => {
    probes.push(url);
    if (url.startsWith("https://example.com/")) return { ok: false, status: 404 };
    if (url.startsWith("https://checkout.example.com/") &&
        probes.filter((item) => item === url).length === 1) throw networkError("ECONNRESET");
    return url.startsWith("https://checkout.example.com/") ? ucp : { ok: false, status: 404 };
  } });
assert.equal(store.shopId, "gid://shopify/Shop/7");
assert.deepEqual(storeTrace.map((item) => item.reason), ["http_404", "retry_after_network_econnreset"]);
let missingHostProbes = 0;
await discoverVerifiedStorefront("https://missing.example.com", { onlyDomain: "missing.example.com",
  retryDelayMs: 0, fetcher: async () => { missingHostProbes += 1; throw networkError("ENOTFOUND"); } });
assert.equal(missingHostProbes, 1, "A missing host is not retried");
// Inside Lambda a domain that does not exist fails with EBUSY: not retried either.
let busyHostProbes = 0;
await discoverVerifiedStorefront("https://missing.example.com", { onlyDomain: "missing.example.com",
  retryDelayMs: 0, fetcher: async () => { busyHostProbes += 1; throw networkError("EBUSY"); } });
assert.equal(busyHostProbes, 1, "A Lambda EBUSY (missing domain) is not retried");

// Confirmation reuses the first-party store proof instead of probing again.
const confirmed = await verifySelectedCommerceBrand({ qlooId, name: "Everlane" }, null, {
  verifyBusiness: async (candidate) => ({ ...candidate, officialWebsite: "https://www.everlane.com",
    identityStatus: "verified", shopId: "gid://shopify/Shop/9",
    storefrontProofUrl: "https://www.everlane.com/.well-known/ucp" }),
  discoverStorefront: async () => { throw new Error("second probe must not run"); } });
assert.equal(confirmed.shopId, "gid://shopify/Shop/9");

// Qloo-suggested partners: Qloo site → brandname.com (and "&" → "and") → one web
// search, skipping social and marketplace sites. Starting brands never search.
const sitesTried = [];
const searches = [];
const proveOnly = (allowed) => async (candidate) => { sitesTried.push(candidate.website);
  return candidate.website === allowed ? { qlooId, name: candidate.name, officialWebsite: allowed,
    identityStatus: "verified" } : null; };
const searchResults = async (query) => { searches.push(query); return { results: [
  { url: "https://www.instagram.com/losons/" }, { url: "https://www.amazon.com/losons" },
  { url: "https://www.loandsons-official.com/" }] }; };
const viaAnd = await verifyCommerceBusiness({ qlooId, name: "Lo & Sons" },
  { firstParty: proveOnly("https://loandsons.com"), allowSearch: true, search: searchResults });
assert.equal(viaAnd?.officialWebsite, "https://loandsons.com", "\"&\" is also tried as \"and\"");
assert.equal(searches.length, 0, "No search when a guessed site verifies");
sitesTried.length = 0;
const viaSearch = await verifyCommerceBusiness({ qlooId, name: "Lo & Sons", website: "https://old.example.com" },
  { firstParty: proveOnly("https://www.loandsons-official.com"), allowSearch: true, search: searchResults });
assert.equal(viaSearch?.officialWebsite, "https://www.loandsons-official.com");
assert.ok(!sitesTried.some((site) => /instagram|amazon/.test(site)), "Social and marketplace results are skipped");
assert.equal(viaSearch.identitySourceUrl, "https://www.loandsons-official.com/");
assert.equal(searchHint("Negative", "Negative is a brand of minimalist underwear and lingerie."),
  "minimalist underwear");
assert.equal(searchHint("Lively", ""), "");
searches.length = 0;
await verifyCommerceBusiness({ qlooId, name: "Negative",
  description: "Negative makes underwear and lingerie for women." },
  { firstParty: async () => null, allowSearch: true, search: searchResults });
assert.equal(searches[0], "Negative underwear lingerie official website");
const preferredTried = [];
await verifyCommerceBusiness({ qlooId, name: "Negative" }, { allowSearch: true,
  firstParty: async (candidate) => { preferredTried.push(candidate.website); return null; },
  search: async () => ({ results: [{ url: "https://git-scm.com/docs/negative" },
    { url: "https://www.prnewswire.com/news/negative" }, { url: "https://www.negativeunderwear.com/" }] }) });
assert.equal(preferredTried.at(-1), "https://www.negativeunderwear.com",
  "A result whose address contains the brand name is preferred");
searches.length = 0;
const startingBrand = await verifyCommerceBusiness({ qlooId, name: "Lo & Sons" },
  { firstParty: async () => null, search: searchResults });
assert.equal(startingBrand, null);
assert.equal(searches.length, 0, "A starting brand never searches; the user enters the website");
const partnerModes = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "product_bundle" }, {
  recommend: async () => ({ envelope: { status: "ok", results: [
    { entity_id: "88888888-8888-4888-8888-888888888888", name: "Partner A" },
    { entity_id: "99999999-9999-4999-8999-999999999999", name: "Partner B" }] } }),
  triageLeads: async ({ leads }) => leads.map(() => "likely"),
  researchPair: async () => ({ coverage: "no_catalog_results", callsUsed: 0,
    opportunities: { supported: [], needs_verification: [], unsupported: [] } }),
  verifyBusiness: async (candidate, options = {}) => {
    partnerModes.push([candidate.qlooId === qlooId ? "seed" : "partner", options.allowSearch === true]);
    return { id: candidate.qlooId, name: candidate.name, officialWebsite: candidate.website ?? "https://seed.example.com",
      identityStatus: "verified" }; },
});
assert.ok(partnerModes.some(([role, allowed]) => role === "seed" && !allowed));
assert.ok(partnerModes.filter(([role]) => role === "partner").every(([, allowed]) => allowed));

// A hanging identity check stops at the run deadline and leaves diagnostics.
const leads = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const started = Date.now();
const startedChecks = [];
const hung = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "product_bundle", maxResearchMs: 150 }, {
  recommend: async () => ({ envelope: { status: "ok", results: leads.map((id, index) => ({
    entity_id: id, name: `Lead ${index}`, properties: { website: `https://lead${index}.example.com` } })) } }),
  verifyBusiness: async (candidate, { trace } = {}) => {
    if (candidate.qlooId === qlooId) return { id: qlooId, name: "Seed",
      officialWebsite: "https://seed.example.com", identityStatus: "verified" };
    startedChecks.push(candidate.qlooId);
    trace?.push({ step: "homepage", host: "lead.example.com", reason: "retry_after_network_econnreset" });
    return new Promise(() => {});
  },
  researchPair: async () => { throw new Error("research must not start"); },
  triageLeads: async ({ leads }) => leads.map(() => "possible"),
});
assert.ok(Date.now() - started < 2000, "The run deadline bounds identity checks");
assert.equal(hung.stopReason, "research_time_limit_reached");
assert.deepEqual(startedChecks, leads, "Upcoming identity checks start together");
assert.ok(hung.candidates[0].identityDiagnostics.some((item) => item.reason === "deadline_reached"));

// Partner product-fit hints only reorder research; failure keeps Qloo order.
const triageLeads = ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666"];
const triageDeps = (triage) => ({
  recommend: async () => ({ envelope: { status: "ok", results: triageLeads.map((id, index) => ({
    entity_id: id, name: `Brand ${index}`, properties: { website: `https://brand${index}.example.com`,
      description: `Brand ${index} products` } })) } }),
  verifyBusiness: async (candidate) => ({ id: candidate.qlooId, name: candidate.name,
    officialWebsite: candidate.website ?? "https://seed.example.com", identityStatus: "verified" }),
  researchPair: async (input) => { researched.push(input.partner.name);
    return { coverage: "no_catalog_results", callsUsed: 0,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; },
  triageLeads: triage, vetShortlist: async () => ({ status: "not_needed", sourceUrls: [] }),
});
let researched = [];
const triaged = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com", description: "Cookware" },
  seedQlooId: qlooId, objective: "product_bundle" },
triageDeps(async ({ leads }) => leads.map((_, index) => ["unlikely", "possible", "likely"][index])));
assert.deepEqual(researched, ["Brand 2", "Brand 1", "Brand 0"],
  "Brand descriptions only order partners; the catalog screen decides value");
assert.deepEqual(triaged.candidates.map((item) => item.productFitHint), ["likely", "possible", "unlikely"]);
let triageInput;
researched = [];
const noFit = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "cross_sell",
  userConstraints: { heroProduct: { productId: "p", variantId: "v", title: "Sauté Pan" } } },
{ ...triageDeps(async (input) => { triageInput = input; return input.leads.map(() => "unlikely"); }),
  researchPair: async (input) => { researched.push(input.partner.name);
    return { coverage: "partner_no_product_value", callsUsed: 2,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; } });
assert.equal(triageInput.anchor, "Sauté Pan", "The order hint sees the chosen product");
assert.equal(researched.length, 3, "Every partner is screened against its catalog");
assert.equal(noFit.coverage, "no_partner_product_fit");
assert.ok(noFit.candidates.every((item) => item.status === "no_product_value"));
researched = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "product_bundle" },
triageDeps(async () => { throw new Error("model unavailable"); }));
assert.deepEqual(researched, ["Brand 0", "Brand 1", "Brand 2"], "A failed hint keeps Qloo order");

// A website a user already verified for a Qloo brand is tried before Qloo's field.
const websitesTried = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "product_bundle" }, {
  ...triageDeps(async ({ leads }) => leads.map(() => "likely")),
  knownWebsites: async () => new Map([[triageLeads[0], "https://verified-brand0.example.com"]]),
  verifyBusiness: async (candidate) => { if (candidate.qlooId !== qlooId) websitesTried.push(candidate.website);
    return { id: candidate.qlooId, name: candidate.name, officialWebsite: candidate.website, identityStatus: "verified" }; },
});
assert.ok(websitesTried.includes("https://verified-brand0.example.com"));
assert.ok(!websitesTried.includes("https://brand0.example.com"), "Qloo's website field is not used when a verified one exists");

// Two partners are researched at a time, each with a fair share of the time.
let inFlightPartners = 0; let peakPartners = 0; const partnerTimes = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "product_bundle", maxResearchMs: 300_000 }, {
  ...triageDeps(async ({ leads }) => leads.map(() => "likely")),
  researchPair: async (input) => { inFlightPartners += 1; peakPartners = Math.max(peakPartners, inFlightPartners);
    partnerTimes.push(input.maxResearchMs);
    await new Promise((resolve) => setTimeout(resolve, 20)); inFlightPartners -= 1;
    return { coverage: "no_catalog_results", callsUsed: 4,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; },
});
assert.equal(peakPartners, 2);
assert.ok(partnerTimes.every((ms) => ms > 100_000 && ms <= 120_000),
  "Each partner gets the full per-partner time while the run has time left");

// Taste tags are fetched once for the starting brand and once per partner and
// reach the culture evidence; no separate per-partner rank call is made.
const tagCalls = []; const cultureSeen = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "product_bundle" }, {
  ...triageDeps(async ({ leads }) => leads.map(() => "likely")),
  entityTags: async (_owner, id) => { tagCalls.push(id); return { tags: [{ id: "urn:tag:keyword:qloo:x", name: "x" }], responseId: null }; },
  focused: async () => { throw new Error("The per-partner rank call is removed"); },
  researchPair: async (input) => { cultureSeen.push(input.cultureEvidence);
    return { coverage: "no_catalog_results", callsUsed: 0,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; },
});
assert.equal(tagCalls.filter((id) => id === qlooId).length, 1, "Starting brand tags are fetched once");
assert.equal(tagCalls.length, 1 + cultureSeen.length);
assert.ok(cultureSeen.every((evidence) => evidence.seedTags.length && evidence.partnerTags.length));

// A partner the user confirmed minutes ago reuses that proof instead of
// re-checking a website that may now rate-limit the app.
const partnerChecks = [];
const proofPartner = { qlooId: "88888888-8888-4888-8888-888888888888", entityId: "partner-entity",
  name: "Cuyana", officialWebsite: "https://cuyana.com", identityStatus: "verified",
  proofQlooId: "88888888-8888-4888-8888-888888888888", proofOfficialWebsite: "https://cuyana.com",
  identitySourceUrl: "https://cuyana.com/", storefrontProofUrl: "https://cuyana.com/.well-known/ucp",
  verifiedShopId: "gid://shopify/Shop/12", identityVerifiedAt: new Date().toISOString() };
let researchedPartner = null;
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" },
  seedQlooId: qlooId, objective: "product_bundle", specifiedPartner: proofPartner }, {
  investigateDirect: async () => ({ relationship: "unknown", qlooResponseIds: [], sourceUrls: [] }),
  verifyBusiness: async (candidate) => { partnerChecks.push(candidate.qlooId);
    return candidate.qlooId === qlooId ? { id: qlooId, name: "Seed", officialWebsite: "https://seed.example.com",
      identityStatus: "verified" } : null; },
  researchPair: async (input) => { researchedPartner = input.partner;
    return { coverage: "no_catalog_results", callsUsed: 0,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; },
});
assert.deepEqual(partnerChecks, [qlooId], "Only the starting brand is re-checked");
assert.equal(researchedPartner?.id, proofPartner.qlooId);
assert.equal(researchedPartner?.verifiedShopId, "gid://shopify/Shop/12");

// Exact pairs are reviewed a few at a time; results keep their planned order.
const seedStoreId = "gid://shopify/Shop/1";
const partnerStoreId = "gid://shopify/Shop/2";
const product = (suffix, title) => ({ id: `gid://shopify/Product/${suffix}`, title,
  description: { plain: `${title} for the bath` }, product_type: title,
  variants: [{ id: `gid://shopify/ProductVariant/${suffix}`, availability: { available: true },
    price: { amount: 2000, currency: "USD" } }] });
const towel = product("seed", "Bath towel");
const partnerItems = Array.from({ length: 6 }, (_, index) => product(`p${index}`, `Bath item ${index}`));
async function pairRun(concurrency) {
  process.env.COMMERCE_PAIR_CONCURRENCY = String(concurrency);
  let inFlight = 0; let peak = 0;
  const events = [];
  await researchCommercePair({ seed: { id: qlooId, qlooId, name: "Seed", identityStatus: "verified",
    officialWebsite: "https://seed.example.com" },
  partner: { id: leads[0], qlooId: leads[0], name: "Partner", identityStatus: "verified",
    officialWebsite: "https://partner.example.com" },
  objective: "product_bundle", discoveryBasis: "qloo_native_brand", maxCatalogCalls: 60,
  userConstraints: { heroProduct: { productId: towel.id, variantId: towel.variants[0].id } } }, {
    discoverStorefront: async (url) => ({ domain: new URL(url).hostname,
      shopId: url.includes("seed") ? seedStoreId : partnerStoreId }),
    createCatalog: () => { let calls = 0; return {
      tools: async () => { calls += 1; return new Set(["search_catalog", "lookup_catalog"]); },
      search: async (domain) => { calls += 1; return domain.startsWith("seed") ? [towel] : partnerItems; },
      detail: async (_domain, productId) => { calls += 1;
        const item = [towel, ...partnerItems].find((entry) => entry.id === productId);
        return { product: item, variant: item.variants[0] }; },
      globalOfferFor: async () => ({ state: "supported" }), callsUsed: () => calls }; },
    planPartnerSearch: async () => ({ queries: ["bath item"], observedProductIds: [] }),
    planAnchorSearch: async () => ({ queries: ["bath item"], observedProductIds: [] }),
    selectPartnerProducts: async () => ({ productIds: partnerItems.map((item) => item.id) }),
    proposeMechanism: async ({ partnerProduct }) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      // Earlier pairs answer more slowly, so completion order differs from plan order.
      await new Promise((resolve) => setTimeout(resolve, 30 - Number(partnerProduct.id.at(-1)) * 4));
      inFlight -= 1;
      return { kind: "unproven", seedFacts: [], partnerFacts: [], seedRole: "", partnerRole: "",
        occasion: "", benefit: "", partnerSpecificFact: "" };
    },
    verifyMechanism: async () => null,
    onEvaluation: (event) => events.push(event.selected.partner.productId),
  });
  return { peak, events };
}
const sequential = await pairRun(1);
const concurrent = await pairRun(2);
delete process.env.COMMERCE_PAIR_CONCURRENCY;
assert.equal(sequential.peak, 1);
assert.equal(concurrent.peak, 2);
assert.ok(concurrent.events.length >= 2);
assert.deepEqual(concurrent.events, sequential.events, "Evaluation order does not depend on timing");

// Failed runs: permanent problems stop at once; temporary ones back off.
assert.deepEqual(runFailurePlan({ attempt: 1 },
  Object.assign(new Error("Starting brand has no verified business identity."), { retryable: false })),
{ terminal: true, status: "failed", stage: "Complete", errorCode: "commerce_run_invalid",
  retryDelaySeconds: 10 });
const seedRetry = runFailurePlan({ attempt: 2 }, { code: "seed_identity_unavailable" });
assert.equal(seedRetry.status, "queued");
assert.equal(seedRetry.errorCode, "commerce_seed_identity_unavailable");
assert.equal(seedRetry.retryDelaySeconds, 60);
assert.equal(runFailurePlan({ attempt: 2 }, { code: "catalog_rate_limited" }).retryDelaySeconds, 120);
assert.equal(runFailurePlan({ attempt: 3 }, new Error("unexpected")).terminal, true);

// Judgment fields combine deterministically on the server.
const practicalBundle = { verdict: "joint_task", sameProductType: false,
  practicalResult: true, bothPassagesNameActivity: false, sameObject: true };
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, sameObject: false,
  directFunction: false }).passed, false, "A shared meal or party alone does not link two items");
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, sameObject: false,
  directFunction: true }).passed, true);
assert.equal(objectiveJudgmentOutcome("product_bundle", practicalBundle).passed, true);
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, practicalResult: false }).passed,
  false, "A mood or ritual outcome needs both items' own text to name it");
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, practicalResult: false,
  bothPassagesNameActivity: true }).passed, true);
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, verdict: "parallel_benefits",
  practicalResult: false, sameObject: false, bothPassagesNameActivity: true }).passed, true,
  "Both pages naming the same ritual links a journal and a candle even if the model calls them parallel");
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, verdict: "parallel_benefits",
  practicalResult: false, sameObject: false, bothPassagesNameActivity: false }).passed, false,
  "Parallel ambience without a shared named activity stays unsupported");
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, verdict: "parallel_benefits",
  bothWornOrCarried: true, directFunction: false, bothPassagesNameActivity: true }).passed, false);
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, verdict: "unrelated",
  bothPassagesNameActivity: true }).passed, false);
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, sameProductType: true }).passed, false);
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, bothWornOrCarried: true,
  directFunction: false }).passed, false, "An outfit or bag-with-clothing pairing is ordinary co-wear");
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, bothWornOrCarried: true,
  directFunction: true }).passed, true, "A leash that clips to a harness acts on the other item");
assert.equal(objectiveJudgmentOutcome("product_bundle", { ...practicalBundle, bothWornOrCarried: true,
  directFunction: false, bothPassagesNameActivity: true }).passed, false, "Shared outing words do not make co-wear a bundle");
assert.equal(objectiveJudgmentOutcome("cross_sell", { verdict: "added_need", sameProductType: false,
  practicalNeed: true, bothWornOrCarried: true }).passed, true, "Worn items remain eligible as a Cross-Sell");
assert.equal(objectiveJudgmentOutcome("cross_sell", { verdict: "added_need", sameProductType: false,
  practicalNeed: true }).passed, true);
assert.equal(objectiveJudgmentOutcome("cross_sell", { verdict: "added_need", sameProductType: true,
  practicalNeed: true }).passed, false, "Two items of the same type are substitutes");
assert.equal(objectiveJudgmentOutcome("cross_sell", { verdict: "added_need", sameProductType: false,
  practicalNeed: false }).passed, false);

// A narrow judgment (verdict and its own fields disagree) is asked once more;
// only an internally consistent second answer is kept.
const rubricYes = { seedRoleGroundedInSelectedItem: true, partnerRoleGroundedInSelectedItem: true,
  jointUseCoherent: true, incrementalBenefit: true, genericCoUseOnly: false,
  distinctConcreteJointValue: false, partnerSpecificReason: false, reason: "specific_joint_use" };
const judgmentBase = { seedJob: "brews", partnerJob: "grinds", sameProductType: false, bothWornOrCarried: false,
  careProductForOther: false, combinedOutcome: "fresh coffee", practicalResult: true,
  seedActivityWords: "", partnerActivityWords: "", withoutPartner: "grinding", servesStatedOccasion: false,
  preferenceQuotes: [], verdict: "joint_task" };
const answers = [rubricYes, { ...judgmentBase, directFunction: false, sameObject: false },
  { ...judgmentBase, directFunction: true, sameObject: true }];
const recheckTrace = [];
const rechecked = await verifyCommerceMechanismRubric({ objective: "product_bundle", trace: recheckTrace,
  proposal: { kind: "functional_complement", seedRole: "coffee", partnerRole: "grinder", occasion: "",
    benefit: "The grinder grinds the coffee.", partnerSpecificFact: "" },
  seedFacts: ["coffee"], partnerFacts: ["grinder"],
  seedSelectedItem: { title: "Coffee", description: "" }, partnerSelectedItem: { title: "Grinder", description: "" },
  classify: async () => JSON.stringify(answers.shift()) });
assert.ok(recheckTrace.some((step) => step.stage === "judgment_recheck"));
assert.equal(rechecked.jointUseCoherent, true, "The consistent second answer decides");

// Activity quotes are checked against each item's own text.
const journal = { title: "Evening Reflection Journal", description: "Guided prompts to help you wind down and reflect before bed." };
const candle = { title: "Lavender Candle", description: "Made for an evening wind-down ritual before sleep." };
assert.equal(quotesShareActivity("wind down and reflect before bed", journal, "evening wind-down ritual", candle), true);
assert.equal(quotesShareActivity("dinner service", { title: "Sauté Pan", description: "Cooks pasta." },
  "dinner service", { title: "Carafe", description: "Serves water or wine." }), false,
"An activity the pages never name cannot link two items");

// Prompt templates must not carry example answers: the model copied them verbatim.
for (const file of ["commerce-mechanism.mjs", "commerce-context.mjs"]) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /"[A-Za-z]+":\s*(?:true|false)\b/, `${file} has a prompt template with a fixed boolean answer`);
}

// Launch areas: Qloo map cells named after the nearest metro; only metros
// in both brands' lists are suggested, strongest first.
assert.equal(nearestMetro(40.69336, -74.00391, "US"), "New York");
assert.equal(nearestMetro(51.52588, -0.10986, "GB"), "London");
assert.equal(nearestMetro(10, 10, "US"), null, "A cell far from every metro stays unnamed");
const cell = (lat, lon) => ({ location: { latitude: lat, longitude: lon } });
// Every Qloo operation the app calls must be cacheable; a missing one failed
// "Where audiences overlap" silently.
for (const operation of ["qloo_describe", "qloo_recommend", "qloo_entity_tags", "qloo_where_popular"]) {
  assert.doesNotThrow(() => qlooCacheIdentity({ operation, context: { entity: "x" },
    ownerUserId: "11111111-1111-4111-8111-111111111111" }), operation);
}
const launch = await sharedLaunchAreas("owner", "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222", "US", { wherePopular: async (_owner, id, country) => {
    assert.equal(country, "United States");
    return { status: "ok", sampleData: false, responseId: null, results: id.startsWith("1")
      ? [cell(47.55, -122.17), cell(40.69, -74.0), cell(42.27, -71.19), cell(30.32, -97.91)]
      : [cell(42.27, -71.19), cell(40.69, -74.0), cell(25.77, -80.19)] }; } });
assert.deepEqual(launch.areas, ["Boston", "New York"], "Equal combined rank falls back to name order");
assert.equal((await sharedLaunchAreas("owner", "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222", "ZZ")).status, "unavailable", "Unsupported markets are not guessed");
// A UK brand also tries brandname.co.uk after brandname.com.
const ukTried = [];
await verifyCommerceBusiness({ qlooId, name: "Hiut Denim", market: "GB" },
  { firstParty: async (candidate) => { ukTried.push(candidate.website); return null; } });
assert.deepEqual(ukTried, ["https://hiutdenim.com", "https://hiutdenim.co.uk"]);

// DNS: one lookup serves concurrent requests for a host, answers are reused
// for five minutes, and failed or non-public answers are never kept.
{
  const { publicAnswers } = await import("../src/shopify-catalog.mjs");
  let lookups = 0; let clock = 0;
  const resolve = async () => { lookups += 1; return [{ address: "93.184.216.34", family: 4 }]; };
  await Promise.all([publicAnswers("dns-a.example.com", { resolve, now: () => clock }),
    publicAnswers("dns-a.example.com", { resolve, now: () => clock })]);
  await publicAnswers("dns-a.example.com", { resolve, now: () => clock });
  assert.equal(lookups, 1, "Concurrent and repeat lookups share one answer");
  clock = 5 * 60_000 + 1;
  await publicAnswers("dns-a.example.com", { resolve, now: () => clock });
  assert.equal(lookups, 2, "An answer expires after five minutes");
  let privateLookups = 0;
  const privateResolve = async () => { privateLookups += 1; return [{ address: "10.0.0.5", family: 4 }]; };
  await assert.rejects(publicAnswers("dns-b.example.com", { resolve: privateResolve }));
  await assert.rejects(publicAnswers("dns-b.example.com", { resolve: privateResolve }));
  assert.equal(privateLookups, 2, "A non-public answer is never kept");
}
console.log("Commerce entry and run reliability checks passed: redirects, retries, deadlines, pair batching and retry policy.");
