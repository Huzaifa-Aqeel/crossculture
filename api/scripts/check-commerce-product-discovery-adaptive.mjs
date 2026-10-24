import assert from "node:assert/strict";
import { researchCommercePair } from "../src/commerce-research.mjs";
import { catalogClient } from "../src/shopify-catalog.mjs";

const merchant = (name, host, id) => ({ id, name, identityStatus: "verified",
  officialWebsite: `https://${host}` });
const seed = merchant("Starting business", "seed.example.com", "11111111-1111-4111-8111-111111111111");
const partner = merchant("Partner business", "partner.example.com", "22222222-2222-4222-8222-222222222222");
const item = (id, title, description, type, collection = "") => ({
  id: `gid://shopify/Product/${id}`, title, description: { plain: description },
  product_type: type, collections: collection ? [{ id: `gid://shopify/Collection/${collection}`,
    title: collection }] : [],
  variants: [{ id: `gid://shopify/ProductVariant/${id}`,
    availability: { available: true }, price: { amount: 2500, currency: "USD" } }],
});
const cases = [
  { label: "kitchen", seed: item("seed-kitchen", "Cooking pan",
    "Pan heats ingredients during cooking", "Cookware"),
  target: item("partner-kitchen", "Silicone spatula", "", "Utensils", "Cooking tools"),
  detail: "Spatula stirs ingredients during cooking", query: "silicone spatula" },
  { label: "outdoor withheld", seed: item("seed-outdoor", "Camp lantern",
    "Lantern illuminates a campsite after dark", "Camping lights"),
  target: item("partner-outdoor", "Lantern hanging hook", "", "Camping hardware", "Camp setup"),
  detail: "Hook suspends a lantern above a campsite", query: "lantern hanging hook" },
];

function fixture(source, { legacy = false } = {}) {
  const unrelated = Array.from({ length: 31 }, (_, index) => item(`other-${source.label}-${index}`,
    `Decorative print ${index}`, "Framed print for a wall", "Wall art"));
  const first = unrelated.slice(0, 16);
  const second = [...unrelated.slice(16), source.target];
  const stats = { calls: 0, searches: [], selectedInputs: [], selectedDescriptions: [],
    assessed: [], details: [], enriched: false };
  const dependencies = {
    discoverStorefront: async (url) => ({ domain: new URL(url).hostname,
      shopId: url.includes("seed") ? "gid://shopify/Shop/1" : "gid://shopify/Shop/2" }),
    createCatalog: () => ({
      tools: async () => { stats.calls += 1; return new Set(["search_catalog", "lookup_catalog"]); },
      ...(!legacy ? { searchPage: async (domain, query, _tools, options = {}) => {
        stats.calls += 1; stats.searches.push({ query, cursor: options.cursor ?? null });
        if (domain.startsWith("seed")) return { products: [source.seed],
          pagination: { cursor: null, hasNextPage: false } };
        if (query === source.query) return { products: [source.target],
          pagination: { cursor: null, hasNextPage: false } };
        if (query === "products" && options.cursor === "second") return { products: second,
          pagination: { cursor: null, hasNextPage: false } };
        return { products: first, pagination: { cursor: "second", hasNextPage: true } };
      } } : {}),
      search: async (domain, query) => {
        stats.calls += 1; stats.searches.push({ query, cursor: null });
        return domain.startsWith("seed") ? [source.seed] : first;
      },
      detail: async (domain, productId, variantId) => {
        stats.calls += 1;
        stats.details.push(productId);
        const found = [source.seed, source.target, ...unrelated].find((product) => product.id === productId);
        assert.ok(found);
        assert.equal(variantId, found.variants[0].id);
        assert.equal(domain.startsWith("seed"), found.id === source.seed.id);
        return { product: found.id === source.target.id
          ? { ...found, description: { plain: source.detail } } : found,
        variant: found.variants[0] };
      },
      globalOfferFor: async () => ({ state: "supported" }),
      callsUsed: () => stats.calls,
    }),
    planAnchorSearch: async ({ seedProduct, objective }) => {
      assert.equal(seedProduct.id, source.seed.id);
      assert.equal(objective, "product_bundle");
      return { queries: [source.query], observedProductIds: [] };
    },
    planPartnerSearch: async ({ partnerProducts }) => {
      assert.ok(partnerProducts.some((product) => product.id === source.target.id));
      return { queries: [source.query], observedProductIds: [source.target.id] };
    },
    selectPartnerProducts: async ({ partnerProducts }) => {
      const seen = partnerProducts.find((product) => product.id === source.target.id);
      stats.selectedInputs.push(Boolean(seen));
      stats.selectedDescriptions.push(seen?.description?.plain ?? null);
      if (seen?.description?.plain === source.detail) stats.enriched = true;
      return { productIds: seen ? [seen.id] : [] };
    },
    proposeMechanism: async ({ partnerProduct }) => partnerProduct.id === source.target.id
      ? { kind: "functional_complement", seedFacts: [source.seed.description.plain],
        partnerFacts: [source.detail], seedRole: source.seed.description.plain,
        partnerRole: source.detail, occasion: source.label === "kitchen"
          ? "cooking a meal" : "setting up a campsite",
        benefit: `${source.seed.description.plain} while ${source.detail}, completing the same task.`,
        partnerSpecificFact: "" }
      : { kind: "unproven", seedFacts: [], partnerFacts: [], seedRole: "",
        partnerRole: "", occasion: "", benefit: "", partnerSpecificFact: "" },
    verifyMechanism: async () => ({ seedRoleGroundedInSelectedItem: true,
      partnerRoleGroundedInSelectedItem: true, jointUseCoherent: true,
      incrementalBenefit: true, genericCoUseOnly: false,
      distinctConcreteJointValue: false, partnerSpecificReason: false,
      reason: "specific_joint_use" }),
    onEvaluation: (event) => stats.assessed.push(event.selected.partner.productId),
    ...(legacy ? { productQueries: [{ seedQuery: null, partnerQuery: "products" }] } : {}),
  };
  return { dependencies, stats };
}

for (const source of cases) {
  const before = fixture(source, { legacy: true });
  const after = fixture(source);
  const input = { seed, partner, objective: "product_bundle", market: "US",
    discoveryBasis: "qloo_native_brand", maxCatalogCalls: 22,
    cultureEvidence: { seedQlooId: seed.id, partnerQlooId: partner.id,
      unconstrained: true, envelope: { status: "ok",
        results: [{ entity_id: partner.id }] } },
    userConstraints: { heroProduct: { productId: source.seed.id,
      variantId: source.seed.variants[0].id } } };
  const oldResult = await researchCommercePair(input, before.dependencies);
  const newResult = await researchCommercePair(input, after.dependencies);
  const oldRecall = Number(before.stats.assessed.includes(source.target.id));
  const newRecall = Number(after.stats.assessed.includes(source.target.id));
  assert.equal(oldRecall, 0);
  assert.equal(newRecall, 1);
  assert.ok(after.stats.searches.some((entry) => entry.cursor === "second"));
  assert.ok(after.stats.searches.some((entry) => entry.query === source.query));
  assert.ok(after.stats.enriched);
  assert.ok(after.stats.calls <= input.maxCatalogCalls);
  assert.ok(newResult.assessedCount > 1, "a supported pair must not end partner research");
  assert.ok(newResult.searchPagesFetched >= 3);
  assert.ok(newResult.observedCandidateCount >= 17);
  assert.equal(newResult.exactDetailFailures, 0);
  console.log(JSON.stringify({ case: source.label, baselineExactCandidateRecall: oldRecall,
    adaptiveExactCandidateRecall: newRecall, baselineAssessed: oldResult.assessedCount,
    adaptiveAssessed: newResult.assessedCount, baselineCalls: before.stats.calls,
    adaptiveCalls: after.stats.calls, baselineHypotheses: oldResult.hypothesesConsidered,
    adaptiveHypotheses: newResult.hypothesesConsidered,
    adaptiveStop: newResult.stopReason }));
}

// A later catalog observation can open a new search direction. The refined
// direction joins the same candidate pool and must be assessed by exact ID.
const evolvingSource = cases[1];
const evolving = fixture(evolvingSource);
const createEvolvingCatalog = evolving.dependencies.createCatalog;
const scoutA = item("scout-a", "Camp cord", "Cord for camp setup", "Camp hardware",
  "Hardware essentials");
const scoutB = item("scout-b", "Tent clip", "Clip for camp setup", "Camp hardware");
evolving.dependencies.createCatalog = () => {
  const client = createEvolvingCatalog();
  const searchPage = client.searchPage;
  const detail = client.detail;
  client.searchPage = async (domain, query, tools, options) => {
    const page = await searchPage(domain, query, tools, options);
    if (query === "camp cord") return { products: [scoutA],
      pagination: { cursor: null, hasNextPage: false } };
    if (query === "tent clip") return { products: [scoutB],
      pagination: { cursor: null, hasNextPage: false } };
    return page;
  };
  client.detail = async (domain, productId, variantId, ...rest) => {
    const observed = [scoutA, scoutB].find((product) => product.id === productId);
    if (!observed) return detail(domain, productId, variantId, ...rest);
    evolving.stats.calls += 1;
    assert.equal(variantId, observed.variants[0].id);
    return { product: observed, variant: observed.variants[0] };
  };
  return client;
};
let catalogPlans = 0;
evolving.dependencies.planAnchorSearch = async () => ({ directions: [
  { query: "camp cord", role: "secure campsite gear" }],
  observedProductIds: [] });
evolving.dependencies.planPartnerSearch = async ({ exploredRoles }) => {
  catalogPlans += 1;
  if (catalogPlans === 2) {
    assert.ok(exploredRoles.some((entry) => entry.role === "secure campsite gear" &&
      entry.searches === 1 && entry.returnedProducts >= 1));
  }
  return { directions: [{ query: catalogPlans === 1 ? "tent clip" : evolvingSource.query,
    role: catalogPlans === 1 ? "secure tent" : "hang lantern" }],
    observedProductIds: [] };
};
const evolvingResult = await researchCommercePair({ seed, partner,
  objective: "product_bundle", market: "US", discoveryBasis: "qloo_native_brand",
  maxCatalogCalls: 34, userConstraints: { heroProduct: {
    productId: evolvingSource.seed.id,
    variantId: evolvingSource.seed.variants[0].id } },
  cultureEvidence: { seedQlooId: seed.id, partnerQlooId: partner.id,
    unconstrained: true, envelope: { status: "ok",
      results: [{ entity_id: partner.id }] } } }, evolving.dependencies);
assert.equal(catalogPlans, 2);
assert.ok(evolving.stats.searches.some((entry) => entry.query === evolvingSource.query));
assert.ok(evolving.stats.searches.some((entry) => entry.query === "Hardware essentials"));
assert.ok(evolving.stats.assessed.includes(evolvingSource.target.id));
assert.ok(evolvingResult.observedCandidateCount >= 18);

// Repeating one broad assortment facet must not consume a third broad page;
// the exact-anchor query still reaches its independently relevant product.
const repetitiveSource = cases[0];
const repetitive = fixture(repetitiveSource);
const createRepetitiveCatalog = repetitive.dependencies.createCatalog;
repetitive.dependencies.createCatalog = () => {
  const client = createRepetitiveCatalog();
  const searchPage = client.searchPage;
  client.searchPage = async (domain, query, tools, options) => {
    if (query === "products" && options?.cursor === "third") {
      throw new Error("A third repetitive broad page should not be requested.");
    }
    const page = await searchPage(domain, query, tools, options);
    if (query === "products" && options?.cursor === "second") {
      return { products: Array.from({ length: 15 }, (_, index) =>
        item(`other-${repetitiveSource.label}-${index + 16}`,
          `Decorative print ${index + 16}`,
          "Framed print for a wall", "Wall art")),
      pagination: { cursor: "third", hasNextPage: true } };
    }
    return page;
  };
  return client;
};
repetitive.dependencies.planPartnerSearch = async () => ({ queries: [repetitiveSource.query],
  observedProductIds: [] });
const repetitiveResult = await researchCommercePair({ seed, partner,
  objective: "product_bundle", market: "US", discoveryBasis: "qloo_native_brand",
  maxCatalogCalls: 22, userConstraints: { heroProduct: {
    productId: repetitiveSource.seed.id,
    variantId: repetitiveSource.seed.variants[0].id } },
  cultureEvidence: { seedQlooId: seed.id, partnerQlooId: partner.id,
    unconstrained: true, envelope: { status: "ok",
      results: [{ entity_id: partner.id }] } } }, repetitive.dependencies);
assert.ok(repetitive.stats.searches.some((entry) => entry.cursor === "second"));
assert.ok(!repetitive.stats.searches.some((entry) => entry.cursor === "third"));
assert.ok(repetitive.stats.assessed.includes(repetitiveSource.target.id));
assert.ok(repetitiveResult.coverageIssues.includes("broad_catalog_pages_uninspected"));

// A relevant product after the old 64-card selector window must still reach
// objective-aware screening and exact assessment. Search quality is injected;
// this fixture isolates the sampling boundary, not semantic judgment.
const wide = fixture(cases[0]);
const createWideCatalog = wide.dependencies.createCatalog;
const wideCards = Array.from({ length: 88 }, (_, index) => item(`wide-${index}`,
  `Decorative print ${index}`, "Framed print for a wall", "Wall art"));
wideCards.push(cases[0].target);
wide.dependencies.createCatalog = () => {
  const client = createWideCatalog();
  const searchPage = client.searchPage;
  client.searchPage = async (domain, query, tools, options) =>
    domain.startsWith("partner") && query === "products"
      ? { products: wideCards, pagination: { cursor: null, hasNextPage: false } }
      : searchPage(domain, query, tools, options);
  return client;
};
wide.dependencies.planAnchorSearch = async () => ({ directions: [
  { query: "wall art", role: "decorate kitchen" }], observedProductIds: [] });
wide.dependencies.planPartnerSearch = async () => ({ directions: [
  { query: "decorative print", role: "decorate kitchen" }], observedProductIds: [] });
wide.dependencies.selectPartnerProducts = async ({ partnerProducts }) => {
  wide.stats.selectedInputs.push(partnerProducts.some((product) =>
    product.id === cases[0].target.id));
  return { productIds: partnerProducts.filter((product) =>
    product.id === cases[0].target.id).map((product) => product.id) };
};
const wideResult = await researchCommercePair({ seed, partner,
  objective: "product_bundle", market: "US", discoveryBasis: "qloo_native_brand",
  maxCatalogCalls: 28, userConstraints: { heroProduct: {
    productId: cases[0].seed.id, variantId: cases[0].seed.variants[0].id } },
  cultureEvidence: { seedQlooId: seed.id, partnerQlooId: partner.id,
    unconstrained: true, envelope: { status: "ok",
      results: [{ entity_id: partner.id }] } } }, wide.dependencies);
assert.ok(wide.stats.selectedInputs.includes(true));
assert.ok(wide.stats.assessed.includes(cases[0].target.id));
assert.ok(wideResult.observedCandidateCount >= 89);
assert.equal(wideResult.screenedCandidateCount, wideResult.eligibleCandidateCount);
assert.ok(wideResult.screeningBatchCount >= 2);
assert.ok(wide.stats.calls <= 28);

// A slow provider/model sequence returns partial coverage before an unbounded
// chain of candidate assessments can hold the worker indefinitely.
const timed = fixture(cases[0]);
let clockReads = 0;
const timedResult = await researchCommercePair({ seed, partner,
  objective: "product_bundle", market: "US", discoveryBasis: "qloo_native_brand",
  maxCatalogCalls: 22, maxResearchMs: 1,
  userConstraints: { heroProduct: { productId: cases[0].seed.id,
    variantId: cases[0].seed.variants[0].id } } },
{ ...timed.dependencies, now: () => (clockReads++ === 0 ? 0 : 2) });
assert.equal(timedResult.stopReason, "research_time_limit_reached");
assert.ok(timedResult.coverageIssues.includes("research_time_limit_reached"));

// Check the real adapter contract separately: cursor, size and shop-scoped
// taxonomy are forwarded without persisting a Catalog response.
const requests = [];
const adapter = catalogClient({ profileUrl: "https://example.com/agent.json", maxCalls: 2,
  fetcher: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ result: { structuredContent: {
      products: [], pagination: { cursor: "next", has_next_page: true } } } }) };
  } });
const page = await adapter.searchPage("global", "camp gear", new Set(["search_catalog"]),
  { market: "US", shops: ["gid://shopify/Shop/2"],
    categories: ["gid://shopify/TaxonomyCategory/123"], cursor: "first", limit: 24 });
assert.equal(page.pagination.cursor, "next");
assert.equal(page.pagination.hasNextPage, true);
assert.equal(requests[0].params.arguments.catalog.pagination.cursor, "first");
assert.deepEqual(requests[0].params.arguments.catalog.filters.shops, ["gid://shopify/Shop/2"]);
assert.deepEqual(requests[0].params.arguments.catalog.filters.categories,
  ["gid://shopify/TaxonomyCategory/123"]);
console.log("Adaptive discovery fixture and cursor contract passed; synthetic recall only.");
