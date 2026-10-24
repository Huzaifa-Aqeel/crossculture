import assert from "node:assert/strict";
import { validateProductContextReferences, resolvedContextSignal, resolveContextSignal,
  contextCandidateParticipation, researchContextCommerce } from "../src/commerce-context.mjs";
import { validateCommerceEvidence } from "../src/commerce-evidence.mjs";
import { verifyCommerceBusinessSite } from "../src/commerce-native.mjs";
import { extractSelectedProductPage } from "../src/commerce-product-page.mjs";

const productId = "gid://shopify/Product/101";
const variantId = "gid://shopify/ProductVariant/201";
const partnerId = "11111111-1111-4111-8111-111111111111";
const tagId = "urn:tag:cuisine:qloo:sichuan_cuisine";
const product = { id: productId, title: "Sichuan Chili Salmon",
  description: { plain: "Smoked salmon with Sichuan cuisine inspiration." } };
const variant = { id: variantId, title: "Three pack" };
const productPage = extractSelectedProductPage(
  `<nav><p>Unrelated South Asian collection</p></nav><h1>Sichuan Chili Salmon</h1>
   <div><p>Smoked salmon with Sichuan Cuisine inspiration and a documented pantry use.</p></div>
   <section><p>Other products are not evidence for this item.</p></section>`,
  { url: "https://seed.example/products/salmon", title: product.title,
    officialWebsite: "https://seed.example", storefrontDomain: "seed.example" });
assert.equal(productPage?.description,
  "Smoked salmon with Sichuan Cuisine inspiration and a documented pantry use.");
assert.equal(extractSelectedProductPage("<h1>Other Product</h1><p>Long unrelated product description here.</p>",
  { url: "https://seed.example/products/salmon", title: product.title,
    officialWebsite: "https://seed.example", storefrontDomain: "seed.example" }), null);
assert.equal(extractSelectedProductPage("<h1>Sichuan Chili Salmon</h1><p>Long unrelated product description here.</p>",
  { url: "https://retailer.example/products/salmon", title: product.title,
    officialWebsite: "https://seed.example", storefrontDomain: "seed.example" }), null);
const verifiedSite = await verifyCommerceBusinessSite({ name: "Seed", website: "https://seed.example" }, {
  search: async () => ({ results: [{ inspected: true, url: "https://seed.example/about",
    title: "Seed official site", snippet: "Seed brand products" }] }),
  discoverStorefront: async () => ({ shopId: "gid://shopify/Shop/1" }) });
assert.equal(verifiedSite?.identityStatus, "verified");
assert.equal(await verifyCommerceBusinessSite({ name: "Seed", website: "https://seed.example" }, {
  search: async () => ({ results: [{ inspected: true, url: "https://other.example/about",
    title: "Seed official site", snippet: "Seed brand products" }] }),
  discoverStorefront: async () => ({ shopId: "gid://shopify/Shop/1" }) }), null);
const reference = { kind: "tag", query: "Sichuan Cuisine", quote: "Sichuan cuisine",
  entityType: null };
assert.deepEqual(validateProductContextReferences({ references: [reference,
  { ...reference, query: "lifestyle", quote: "lifestyle" },
  { ...reference, quote: "invented cultural history" }] }, product, variant), [reference]);
const signal = resolvedContextSignal(reference, { tags: [{ id: tagId, name: "Sichuan Cuisine" }] });
assert.equal(signal?.id, tagId);
assert.equal(resolvedContextSignal(reference, { tags: [
  { id: tagId, name: "Sichuan Cuisine" },
  { id: "urn:tag:keyword:qloo:sichuan_cuisine", name: "Sichuan Cuisine" },
] }), null);
assert.equal(resolveContextSignal(reference, { tags: [
  { id: tagId, name: "Sichuan Cuisine" },
  { id: "urn:tag:keyword:qloo:sichuan_cuisine", name: "Sichuan Cuisine" },
] }).reason, "ambiguousExactMatch");
assert.equal(resolveContextSignal(reference, { tags: [
  { id: "urn:tag:cuisine:qloo:sichuan", name: "Sichuan" },
] }).reason, "noExactMatch");
assert.equal(resolveContextSignal(reference, null).reason, "providerUnavailable");
assert.equal(resolvedContextSignal({ ...reference, query: "Sichuan" },
  { tags: [{ id: tagId, name: "Sichuan Cuisine" }] }), null);
const recommendation = { status: "ok", results: [{ entity_id: partnerId, name: "Candidate" }] };
const proof = { reference, signal, recommendation, partnerQlooId: partnerId,
  candidateTags: [{ id: tagId, name: "Sichuan Cuisine" }],
  page: { inspected: true, url: "https://candidate.example/about", snippet: "Our Sichuan Cuisine pantry" },
  officialWebsite: "https://candidate.example" };
assert.equal(contextCandidateParticipation(proof), true);
assert.equal(contextCandidateParticipation({ ...proof, candidateTags: [{ id:
  "urn:tag:keyword:qloo:other", name: "Sichuan Cuisine" }] }), false);
assert.equal(contextCandidateParticipation({ ...proof, page: { ...proof.page,
  url: "https://retailer.example/about" } }), false);
assert.equal(contextCandidateParticipation({ ...proof, recommendation:
  { status: "ok", results: [] } }), false);
const evidence = { objective: "product_bundle", discoveryBasis: "qloo_context_brand",
  seed: { id: "seed-id", qlooId: null, identityStatus: "verified",
    officialWebsite: "https://seed.example" },
  partner: { id: partnerId, qlooId: partnerId, identityStatus: "verified",
    officialWebsite: "https://candidate.example" },
  seedStore: { shopId: "gid://shopify/Shop/1", domain: "seed.example",
    officialHost: "seed.example" },
  partnerStore: { shopId: "gid://shopify/Shop/2", domain: "candidate.example",
    officialHost: "candidate.example" },
  seedDetail: { product, variant }, partnerDetail: { product: { id: "gid://shopify/Product/301",
    title: "Sichuan pantry collection" }, variant: { id: "gid://shopify/ProductVariant/401" } },
  selectedSeed: { productId, variantId }, selectedPartner: {
    productId: "gid://shopify/Product/301", variantId: "gid://shopify/ProductVariant/401" },
  sourceAuthority: { seedDescription: true, partnerDescription: true },
  cultureEvidence: { kind: "product_context", sourceProductId: productId,
    sourceVariantId: variantId, sourceQuote: reference.quote, query: reference.query,
    signalId: tagId, signalName: "Sichuan Cuisine", signalKind: "tag",
    resolution: { tags: [{ id: tagId, name: "Sichuan Cuisine" }] },
    recommendation, partnerQlooId: partnerId, candidateTags: proof.candidateTags,
    candidatePage: proof.page } };
assert.equal(validateCommerceEvidence(evidence).culturalRelationship,
  "context_relationship_corroborated");
assert.equal(validateCommerceEvidence({ ...evidence,
  seedDetail: { product: { ...product, description: null,
    url: "https://seed.example/products/salmon" }, variant },
  sourceAuthority: { seedDescription: false, partnerDescription: true },
  cultureEvidence: { ...evidence.cultureEvidence, sourceProductPage: productPage },
}).culturalRelationship, "context_relationship_corroborated");
assert.equal(validateCommerceEvidence({ ...evidence,
  seedDetail: { product: { ...product, description: null,
    url: "https://seed.example/products/salmon" }, variant },
  sourceAuthority: { seedDescription: false, partnerDescription: true },
  cultureEvidence: { ...evidence.cultureEvidence,
    sourceProductPage: { ...productPage, url: "https://seed.example/products/other" } },
}).culturalRelationship, "unknown");
assert.equal(validateCommerceEvidence({ ...evidence, cultureEvidence: { ...evidence.cultureEvidence,
  candidateTags: [] } }).culturalRelationship, "unknown");

let pairCalls = 0;
const dependencies = { discoverStorefront: async (site) => ({ domain: new URL(site).host,
    endpointHost: new URL(site).host, shopId: "gid://shopify/Shop/1" }),
  createCatalog: () => ({ tools: async () => new Set(["get_product"]),
    detail: async () => ({ product, variant }), callsUsed: () => 1 }),
  proposeReferences: async () => [reference],
  findTags: async () => ({ tags: [{ id: tagId, name: "Sichuan Cuisine" }],
    responseId: "22222222-2222-4222-8222-222222222222", sampleData: false }),
  recommend: async () => ({ envelope: recommendation,
    responseId: "33333333-3333-4333-8333-333333333333", sampleData: false }),
  verifyBusiness: async () => ({ id: partnerId, qlooId: partnerId, name: "Candidate",
    officialWebsite: "https://candidate.example", identityStatus: "verified" }),
  entityTags: async () => ({ tags: [], sampleData: false }),
  search: async () => ({ results: [proof.page] }),
  researchPair: async () => { pairCalls++; return { callsUsed: 1,
    coverage: "partial_assortment", opportunities: { supported: [],
      needs_verification: [], unsupported: [] } }; },
  vetShortlist: async () => ({ sourceUrls: [], findings: [] }) };
const request = { ownerUserId: "44444444-4444-4444-8444-444444444444",
  seed: { id: "55555555-5555-4555-8555-555555555555", name: "Seed",
    identityStatus: "verified", officialWebsite: "https://seed.example", qlooId: null },
  objective: "product_bundle", userConstraints: { heroProduct: { productId, variantId } } };
const blocked = await researchContextCommerce(request, dependencies);
assert.equal(blocked.coverage, "no_corroborated_context_candidate");
assert.equal(blocked.contextStages.sourceReferences, 1);
assert.equal(blocked.contextStages.resolvedSignals, 1);
assert.equal(pairCalls, 0);
const noReference = await researchContextCommerce(request, { ...dependencies,
  proposeReferences: async () => [] });
assert.equal(noReference.coverage, "no_source_backed_context_reference");
assert.equal(noReference.catalogCallsUsed, 1);
const noSignal = await researchContextCommerce(request, { ...dependencies,
  findTags: async () => ({ tags: [], sampleData: false }) });
assert.equal(noSignal.coverage, "no_resolved_context_signal");
assert.equal(noSignal.contextStages.recommendationResponses, 0);
const admitted = await researchContextCommerce(request, { ...dependencies,
  entityTags: async () => ({ tags: proof.candidateTags, sampleData: false }) });
assert.equal(pairCalls, 1);
assert.equal(admitted.candidates[0].status, "partial_assortment");
console.log("Commerce context reference, resolution, participation and gated pair research passed.");
