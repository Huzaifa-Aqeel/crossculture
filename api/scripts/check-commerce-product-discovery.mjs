import assert from "node:assert/strict";
import { researchCommercePair } from "../src/commerce-research.mjs";

// Synthetic catalog fixture: this checks selection/retrieval behavior, not
// real-world pairing quality or live provider availability.
const seedQlooId = "11111111-1111-4111-8111-111111111111";
const partnerQlooId = "22222222-2222-4222-8222-222222222222";
const seed = { id: seedQlooId, qlooId: seedQlooId, name: "Seed",
  identityStatus: "verified", officialWebsite: "https://seed.example.com" };
const partner = { id: partnerQlooId, qlooId: partnerQlooId, name: "Partner",
  identityStatus: "verified", officialWebsite: "https://partner.example.com" };
const merchandise = (suffix, title, description, type) => ({
  id: `gid://shopify/Product/${suffix}`, title,
  description: { plain: description }, product_type: type,
  variants: [{ id: `gid://shopify/ProductVariant/${suffix}`, availability: { available: true },
    price: { amount: 3500, currency: "USD" } }],
});
const towel = merchandise("seed", "Bath towel", "Absorbent towel for drying after bathing", "Towels");
const bathMat = merchandise("mat", "Bath mat", "Absorbent mat for the floor after bathing", "Bath mats");
const soap = merchandise("soap", "Bath soap", "Soap for washing skin during bathing", "Soap");
const weak = Array.from({ length: 14 }, (_, index) => merchandise(`weak${index}`,
  `Wall art ${index}`, "Framed decorative print", "Wall art"));
const broad = [...weak.slice(0, 7), bathMat, ...weak.slice(7), soap];
const proposalFor = (item, objective) => {
  if (![bathMat.id, soap.id].includes(item.id)) return { kind: "unproven",
    seedFacts: [], partnerFacts: [], seedRole: "", partnerRole: "", occasion: "",
    benefit: "", partnerSpecificFact: "" };
  const isMat = item.id === bathMat.id;
  return { kind: objective === "cross_sell" ? "assortment_complement" : "occasion_complement",
    seedFacts: ["Bath towel"], partnerFacts: [isMat ? "Bath mat" : "Bath soap"],
    seedRole: "towel", partnerRole: isMat ? "bath mat" : "bath soap",
    occasion: "bathing essentials",
    benefit: isMat
      ? "The towel dries the person while the bath mat absorbs water on the floor after bathing."
      : "The bath soap washes skin while the towel dries the person during a bathing routine.",
    partnerSpecificFact: "" };
};
const rubric = { seedRoleGroundedInSelectedItem: true,
  partnerRoleGroundedInSelectedItem: true, jointUseCoherent: true,
  incrementalBenefit: true, genericCoUseOnly: false,
  distinctConcreteJointValue: false, partnerSpecificReason: false,
  reason: "specific_joint_use" };
async function run(objective, selectPartnerProducts) {
  const assessed = [];
  const result = await researchCommercePair({ seed, partner, objective,
    discoveryBasis: "qloo_native_brand", market: "US", maxCatalogCalls: 22,
    cultureEvidence: { seedQlooId, partnerQlooId, unconstrained: true,
      envelope: { status: "ok", results: [{ entity_id: partnerQlooId }] } },
    userConstraints: { heroProduct: { productId: towel.id,
      variantId: towel.variants[0].id } } }, {
    discoverStorefront: async (url) => ({ domain: new URL(url).hostname,
      shopId: url.includes("seed") ? "gid://shopify/Shop/1" : "gid://shopify/Shop/2" }),
    createCatalog: () => {
      let calls = 0;
      return { tools: async () => { calls += 1; return new Set(["search_catalog", "lookup_catalog"]); },
        search: async (domain, query) => { calls += 1;
          if (domain.startsWith("seed")) return [towel];
          return query === "bath mat" ? [bathMat]
            : query === "bath soap" ? [soap] : broad;
        },
        detail: async (domain, productId, variantId) => { calls += 1;
          const item = [towel, ...broad].find((product) => product.id === productId);
          assert.ok(item);
          assert.equal(variantId, item.variants[0].id);
          assert.equal(domain.startsWith("seed"), item.id === towel.id);
          return { product: item, variant: item.variants[0] };
        },
        globalOfferFor: async () => ({ state: "supported" }),
        callsUsed: () => calls };
    },
    planPartnerSearch: async () => ({ queries: ["bath mat", "bath soap"],
      observedProductIds: [] }),
    planAnchorSearch: async () => ({ queries: ["bath mat"], observedProductIds: [] }),
    selectPartnerProducts,
    proposeMechanism: async ({ partnerProduct }) => proposalFor(partnerProduct, objective),
    verifyMechanism: async () => rubric,
    onEvaluation: (event) => assessed.push(event.selected.partner.productId),
  });
  return { result, assessed };
}

const bundle = await run("product_bundle", async ({ objective, partnerProducts }) => {
  assert.equal(objective, "product_bundle");
  assert.ok(partnerProducts.some((item) => item.id === bathMat.id));
  return { productIds: [bathMat.id, "gid://shopify/Product/not-observed"] };
});
assert.equal(bundle.result.opportunities.supported[0].best.partnerProductId, bathMat.id);
assert.equal(bundle.result.opportunities.supported[0].best.seedProductId, towel.id);
assert.ok(["objective_guided", "detail_enriched"].includes(bundle.result.productSelectionPlanning));
assert.ok(bundle.assessed.includes(bathMat.id));
assert.ok(!bundle.assessed.includes("gid://shopify/Product/not-observed"));

const crossSell = await run("cross_sell", async ({ objective }) => {
  assert.equal(objective, "cross_sell");
  return { productIds: [soap.id] };
});
assert.equal(crossSell.assessed[0], soap.id);
assert.ok([crossSell.result.opportunities.supported[0].best,
  ...crossSell.result.opportunities.supported[0].otherOpportunities]
  .some((item) => item.partnerProductId === soap.id));
assert.equal(crossSell.result.opportunities.supported[0].best.seedProductId, towel.id);

const fallback = await run("product_bundle", async () => { throw new Error("selector unavailable"); });
assert.equal(fallback.result.productSelectionPlanning, "fallback");
assert.ok(fallback.result.coverageIssues.includes("partner_product_selection_unavailable"));
assert.equal(fallback.assessed[0], weak[0].id);
assert.ok(fallback.assessed.some((id) => [bathMat.id, soap.id].includes(id)));
assert.ok(fallback.result.opportunities.supported.length > 0);
assert.equal(fallback.result.coverage, "partial_assortment");

console.log("Synthetic multi-product discovery regressions passed; no live quality claim.");
