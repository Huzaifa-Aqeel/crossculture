// Focused live product-search audit. The operator supplies already verified
// official merchant sites; this does not claim a fresh Qloo relationship.
// Catalog search responses stay in memory. Output contains only query terms,
// aggregate decisions and selected exact-product listing links.
import { discoverVerifiedStorefront, catalogClient } from "../src/shopify-catalog.mjs";
import { researchCommercePair } from "../src/commerce-research.mjs";

const [seedWebsite, partnerWebsite, anchorQuery, requestedObjective] = process.argv.slice(2);
if (![seedWebsite, partnerWebsite, anchorQuery].every(Boolean)) {
  throw new Error("Pass verified Brand A site, verified Brand B site, and an anchor product query.");
}
const [seedStore, partnerStore] = await Promise.all([
  discoverVerifiedStorefront(seedWebsite), discoverVerifiedStorefront(partnerWebsite),
]);
if (!seedStore?.shopId || !partnerStore?.shopId || seedStore.shopId === partnerStore.shopId) {
  throw new Error("Two distinct verified Shopify merchants are required.");
}
const preview = catalogClient({ maxCalls: 10 });
const globalTools = await preview.tools("global").catch(() => new Set());
async function scope(store) {
  for (const domain of [...new Set([store.domain, store.endpointHost].filter(Boolean))]) {
    const tools = await preview.tools(domain).catch(() => new Set());
    if (tools.has("search_catalog") &&
        (tools.has("get_product") || tools.has("lookup_catalog"))) return { domain, tools };
  }
  if (globalTools.has("search_catalog") &&
      (globalTools.has("get_product") || globalTools.has("lookup_catalog"))) {
    return { domain: "global", tools: globalTools };
  }
  throw new Error("Starting merchant Catalog tools are unavailable.");
}
const seedScope = await scope(seedStore);
const page = await preview.searchPage(seedScope.domain, anchorQuery, seedScope.tools, {
  market: "US", shops: seedScope.domain === "global" ? [seedStore.shopId] : [],
});
const selected = page.products.flatMap((product) => (product.variants ?? [])
  .filter((variant) => variant.id && variant.availability?.available === true &&
    (seedScope.domain !== "global" || variant.seller?.id === seedStore.shopId))
  .map((variant) => ({ product, variant })))[0];
if (!selected) throw new Error("No available exact starting product in this observed search page.");
const exact = await preview.detail(seedScope.domain, selected.product.id, selected.variant.id,
  selected.variant.options, seedScope.tools, { market: "US",
    expectedSellerId: seedScope.domain === "global" ? seedStore.shopId : null });
console.log(JSON.stringify({ stage: "anchor", title: exact.product.title,
  listing: exact.product.url, selectedExactVariant: exact.variant.id === selected.variant.id }));

const seed = { id: "11111111-1111-4111-8111-111111111111", name: new URL(seedWebsite).hostname,
  officialWebsite: seedWebsite, identityStatus: "verified" };
const partner = { id: "22222222-2222-4222-8222-222222222222",
  name: new URL(partnerWebsite).hostname, officialWebsite: partnerWebsite,
  identityStatus: "verified" };
const objectives = requestedObjective ? [requestedObjective] : ["product_bundle", "cross_sell"];
if (objectives.some((item) => !["product_bundle", "cross_sell"].includes(item))) {
  throw new Error("Objective must be product_bundle or cross_sell.");
}
for (const objective of objectives) {
  const evaluations = [];
  const result = await researchCommercePair({ seed, partner, objective,
    discoveryBasis: "user_specified", market: "US", maxCatalogCalls: 32,
    userConstraints: { heroProduct: { productId: exact.product.id,
      variantId: exact.variant.id } } }, {
    onEvaluation: (event) => evaluations.push(event),
  });
  if (evaluations.some((event) => event.selected.seed.productId !== exact.product.id ||
      event.selected.seed.variantId !== exact.variant.id)) {
    throw new Error("The starting product or variant changed during research.");
  }
  const mechanismStates = Object.fromEntries(["supported", "unknown", "unsupported"]
    .map((state) => [state, evaluations.filter((event) => event.mechanism.state === state).length]));
  const objectiveStates = Object.fromEntries(["supported", "unknown", "unsupported"]
    .map((state) => [state, evaluations.filter((event) => event.objectiveFit === state).length]));
  const exactListings = Object.values(result.opportunities).flatMap((groups) => groups.flatMap(
    (group) => [group.best, ...group.otherOpportunities]))
    .filter((item) => evaluations.some((event) =>
      event.selected.partner.productId === item.partnerProductId &&
      event.mechanism.state === "supported"))
    .slice(0, 4).map((item) => ({ title: item.live.partner.title,
      listing: item.live.partner.url, verdict: item.assessment.status }));
  console.log(JSON.stringify({ stage: "objective", objective,
    inspectedQueries: result.inspectedQueries?.map((item) =>
      ({ query: item.partner, source: item.source,
        returned: item.returnedCount, novel: item.novelCount })) ?? [],
    searchPagesFetched: result.searchPagesFetched ?? 0,
    observedCandidateCount: result.observedCandidateCount ?? 0,
    eligibleCandidateCount: result.eligibleCandidateCount ?? 0,
    screenedCandidateCount: result.screenedCandidateCount ?? 0,
    screeningBatchCount: result.screeningBatchCount ?? 0,
    exploredRoleCount: result.exploredRoleCount ?? 0,
    hypothesesConsidered: result.hypothesesConsidered ?? 0,
    assessedCount: result.assessedCount ?? 0, exactDetailFailures: result.exactDetailFailures ?? 0,
    mechanismStates, objectiveStates, exactListings,
    supportedMechanisms: evaluations.filter((event) =>
      event.mechanism.state === "supported").slice(0, 4).map((event) => ({
      partnerProductId: event.selected.partner.productId,
      rationale: event.proposalRationale,
      mechanism: event.mechanism,
      objectiveFit: event.objectiveFit })),
    coverageIssues: result.coverageIssues ?? [], stopReason: result.stopReason,
    catalogCallsUsed: result.callsUsed }));
}
