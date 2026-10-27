// Research memory: taxonomy matching, which identity failures are remembered,
// partner ordering from earlier outcomes, rows recorded from a run, and the
// effect on native discovery. Fixtures only; no database or provider call.
import assert from "node:assert/strict";
import { taxonomyCategory, similarCategory, lastingIdentityFailure, partnerMemoryTiers,
  orderLeadsWithMemory, memoryRowsFromRun, opportunityKeyFor, recallPartnerMemory, MEMORY_VERSION } from "../src/research-memory.mjs";
import { researchNativeCommerce } from "../src/commerce-native.mjs";

// Storefront products carry Shopify's public taxonomy; Global results do not.
assert.equal(taxonomyCategory({ categories: [{ value: "gid://shopify/TaxonomyCategory/aa-1-13-7",
  taxonomy: "shopify" }] }), "aa-1-13-7");
assert.equal(taxonomyCategory({ id: "gid://shopify/p/1" }), null);
assert.equal(similarCategory("aa-1-13-7", "aa-1-13-3"), true, "Both are clothing tops");
assert.equal(similarCategory("aa-1-13-7", "aa-1-12-2"), false);
assert.equal(similarCategory("aa-1", "aa-1-13-7"), true, "A shorter category matches its own levels");
assert.equal(similarCategory(null, "aa-1-13-7"), false);

// Only failures that repeat on every attempt are remembered.
assert.equal(lastingIdentityFailure([{ reason: "redirect_301" }, { reason: "site_name_mismatch" },
  { reason: "top_result_not_verified" }]), "top_result_not_verified");
assert.equal(lastingIdentityFailure([{ reason: "site_name_mismatch" }, { reason: "http_403" }]), null);
assert.equal(lastingIdentityFailure([{ reason: "network_etimedout" }]), null);
assert.equal(lastingIdentityFailure([{ reason: "deadline_reached" }]), null);
assert.equal(lastingIdentityFailure([{ reason: "network_ebusy" }, { reason: "official_website_needed" }]),
  "official_website_needed", "A domain that does not exist is a lasting answer");
assert.equal(lastingIdentityFailure([{ reason: "network_enotfound" }]), "network_enotfound");
assert.equal(lastingIdentityFailure([]), null);

const now = Date.parse("2026-10-25T12:00:00Z");
const daysAgo = (days) => new Date(now - days * 86_400_000).toISOString();
const row = (partnerQlooId, outcome, extra = {}) => ({ partnerQlooId, outcome, observedAt: daysAgo(1),
  heroCategory: "hg-11-6-3", recommendableCount: 0, supportedCount: 0, ...extra });
const tiers = partnerMemoryTiers([
  row("proven-a", "researched", { recommendableCount: 2, supportedCount: 2 }),
  row("proven-b", "researched", { recommendableCount: 1, supportedCount: 1 }),
  row("proven-c", "researched", { recommendableCount: 3, supportedCount: 3 }),
  row("empty", "researched"), row("empty", "no_product_value", { observedAt: daysAgo(3) }),
  row("other-category", "researched", { heroCategory: "aa-1-13-7" }),
  row("other-category", "no_product_value", { heroCategory: "aa-1-13-7" }),
  row("broken", "identity_unverified", { identityReason: "site_name_mismatch", heroCategory: null }),
  row("old-failure", "identity_unverified", { identityReason: "site_name_mismatch", observedAt: daysAgo(9) }),
  row("fixed", "identity_unverified", { identityReason: "no_brand_site_result", observedAt: daysAgo(4) }),
  row("fixed", "researched", { observedAt: daysAgo(2) }),
], "hg-11-6-1", now);
assert.equal(tiers.get("proven-a").tier, "proven");
assert.equal(tiers.get("empty").tier, "unpromising", "Twice researched for similar products, nothing kept");
assert.equal(tiers.get("other-category").tier, "unknown", "Results for unrelated products do not count");
assert.equal(tiers.get("broken").identityFailure, "site_name_mismatch");
assert.equal(tiers.get("old-failure").identityFailure, null, "A failure expires after seven days");
assert.equal(tiers.get("fixed").identityFailure, null, "A later verified run clears a failure");

const lead = (qlooId, extra = {}) => ({ qlooId, name: qlooId, ...extra });
const { ordered, skipped } = orderLeadsWithMemory([lead("new-1"), lead("empty"), lead("proven-b"),
  lead("broken"), lead("new-2"), lead("proven-a"), lead("proven-c")], tiers);
assert.deepEqual(ordered.map((item) => item.qlooId),
  ["proven-c", "proven-a", "new-1", "proven-b", "new-2", "empty"],
  "Proven first, an unexplored partner after every two proven, unpromising last");
assert.deepEqual(skipped.map((item) => item.qlooId), ["broken"]);
assert.equal(orderLeadsWithMemory([lead("broken", { websiteSource: "verified_record" })], tiers)
  .skipped.length, 0, "A verified website overrides a remembered failure");
assert.deepEqual(orderLeadsWithMemory([lead("x"), lead("y")], new Map()).ordered.map((item) => item.qlooId),
  ["x", "y"], "No memory keeps the given order");

// Rows recorded from a run's candidates.
const pair = (status) => ({ opportunityKey: "a".repeat(64), partnerCategory: "hg-11-1", status,
  mechanismState: "supported", reasonCodes: [] });
const memory = (extra = {}) => ({ heroCategory: "hg-11-6-1", partnerShopId: "gid://shopify/Shop/2",
  screen: { key: "b".repeat(64), addsValue: true, reused: false }, pairs: [], ...extra });
const rows = memoryRowsFromRun({ objective: "product_bundle", market: "US", model: "m", candidates: [
  { qlooId: "q1", status: "identity_unverified", identityDiagnostics: [{ reason: "site_name_mismatch" }] },
  { qlooId: "q2", status: "identity_unverified", identityDiagnostics: [{ reason: "network_econnreset" }] },
  { qlooId: "q3", status: "no_product_value", memory: memory({ screen: { key: "c".repeat(64), addsValue: false, reused: false } }) },
  { qlooId: "q4", status: "no_product_value", memory: memory({ screen: { key: "c".repeat(64), addsValue: false, reused: true } }) },
  { qlooId: "q5", status: "product_researched", recommendableCount: 1, assessedCount: 2,
    memory: memory({ screen: { key: "d".repeat(64), addsValue: true, reused: true },
      pairs: [pair("supported"), pair("unsupported")] }) },
  { qlooId: "q6", status: "no_verified_product_opportunity", stopReason: "research_time_limit_reached", memory: memory() },
  { qlooId: "q7", status: "no_product_value", coverageIssues: ["partner_wearer_mismatch"], memory: memory() },
  { qlooId: "q8", status: "storefront_identity_unverified" },
] });
const byPartner = Object.fromEntries(rows.map((item) => [item.partnerQlooId, item]));
assert.deepEqual(Object.keys(byPartner), ["q1", "q3", "q5", "q6"]);
assert.equal(byPartner.q1.outcome, "identity_unverified");
assert.equal(byPartner.q3.screenAddsValue, false);
assert.equal(byPartner.q5.outcome, "researched");
assert.equal(byPartner.q5.supportedCount, 1);
assert.equal(byPartner.q5.screenKey, null, "A reused screen decision is not recorded again");
assert.equal(byPartner.q6.outcome, "incomplete", "A run stopped by its time limit proves nothing");
assert.equal(opportunityKeyFor("product_bundle", { seed: { productId: "p" } }),
  opportunityKeyFor("product_bundle", { seed: { productId: "p" } }));
assert.deepEqual(await recallPartnerMemory({ qlooIds: ["q"], objective: "product_bundle", market: "US" }), [],
  "Without a database, memory is empty");

// Native discovery: memory reorders and skips partners already in Qloo's results.
const seedQlooId = "11111111-1111-4111-8111-111111111111";
const ids = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444"];
let researched = [];
let recalled = null;
let recommendOptions = null;
const deps = (recallPartners) => ({
  recommend: async (_owner, _seed, options) => { recommendOptions = options; return { envelope: { status: "ok", results: ids.map((id, index) => ({
    entity_id: id, name: `Brand ${index}`, properties: { website: `https://brand${index}.example.com` } })) } }; },
  verifyBusiness: async (candidate) => ({ id: candidate.qlooId, name: candidate.name,
    officialWebsite: candidate.website ?? "https://seed.example.com", identityStatus: "verified" }),
  researchPair: async (input) => { researched.push(input.partner.name);
    return { coverage: "no_catalog_results", callsUsed: 0,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; },
  triageLeads: async ({ leads }) => leads.map(() => "possible"),
  recallPartners,
});
const discovered = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "product_bundle", market: "US",
  userConstraints: { heroProduct: { productId: "p", variantId: "v", categoryId: "hg-11-6-1" } } },
deps(async (input) => { recalled = input; return [
  { ...row(ids[2], "researched", { supportedCount: 2, recommendableCount: 2 }), observedAt: new Date().toISOString() },
  { ...row(ids[0], "identity_unverified", { identityReason: "site_name_mismatch" }), observedAt: new Date().toISOString() }]; }));
assert.deepEqual(recalled, { qlooIds: ids, objective: "product_bundle", market: "US" });
assert.equal(recommendOptions.limit, 12, "Native discovery reads 12 Qloo leads");
assert.deepEqual(researched, ["Brand 2", "Brand 1"], "Proven partner first; remembered failure skipped");
assert.ok(discovered.candidates.some((item) => item.status === "identity_unverified_recently" &&
  item.identityReason === "site_name_mismatch"));
// Both brands' audience tags reach the evidence step; the starting brand's
// are fetched once per run.
const audienceCalls = [];
const cultureSeen = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "product_bundle" }, { ...deps(async () => []),
  // The real identity check returns the partner's Qloo ID.
  verifyBusiness: async (candidate) => ({ id: candidate.qlooId, qlooId: candidate.qlooId, name: candidate.name,
    officialWebsite: candidate.website ?? "https://seed.example.com", identityStatus: "verified" }),
  audienceTags: async (_owner, id) => { audienceCalls.push(id);
    return { tags: [{ id: `urn:tag:lifestyle:qloo:${id.slice(0, 4)}`, name: "Outdoor", popularity: 0.98 }], responseId: null }; },
  researchPair: async (input) => { cultureSeen.push(input.cultureEvidence);
    return { coverage: "no_catalog_results", callsUsed: 0,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; } });
assert.equal(audienceCalls.filter((id) => id === seedQlooId).length, 1, "Starting brand audience tags once per run");
assert.equal(cultureSeen.length, 3);
assert.ok(cultureSeen.every((evidence) => evidence.seedAudienceTags.length === 1 && evidence.partnerAudienceTags.length === 1));
// Partners the user passed on for this brand are not researched again;
// partners they liked are researched first.
researched = [];
const withFeedback = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "product_bundle", userFeedback: { excludedPartnerQlooIds: [ids[1]], rejectedPairKeys: [],
    preferredPartnerQlooIds: [ids[2]] } },
deps(async () => []));
assert.deepEqual(researched, ["Brand 2", "Brand 0"], "Liked partner first; passed partner skipped");
assert.ok(withFeedback.candidates.some((item) => item.qlooId === ids[1] && item.status === "excluded_by_user"));
// A liked partner the hint finds unsuited to this product is not moved first.
researched = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "product_bundle", userFeedback: { excludedPartnerQlooIds: [], rejectedPairKeys: [],
    preferredPartnerQlooIds: [ids[2]] } },
{ ...deps(async () => []), triageLeads: async ({ leads }) => leads.map((_, index) => index === 2 ? "unlikely" : "possible") });
assert.deepEqual(researched, ["Brand 0", "Brand 1", "Brand 2"], "An unsuited liked partner keeps its place");
researched = [];
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "product_bundle" }, deps(async () => { throw new Error("database unavailable"); }));
assert.deepEqual(researched, ["Brand 0", "Brand 1", "Brand 2"], "Unavailable memory keeps the normal order");

// Budget sharing below is written for two partners at a time.
process.env.COMMERCE_PARTNER_CONCURRENCY = "2";
// Live case (25 Oct): one partner using its whole allowance stopped the run
// after 54 of 160 calls. The run continues until its own budget is spent.
researched = [];
const fullAllowance = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "cross_sell", maxCatalogCalls: 160 }, { ...deps(async () => []),
  researchPair: async (input) => { researched.push(input.partner.name);
    return { coverage: "partial_assortment", callsUsed: input.maxCatalogCalls, stopReason: "catalog_budget_reached",
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; } });
assert.equal(researched.length, 3, "Each partner gets its own allowance");
assert.notEqual(fullAllowance.stopReason, "catalog_budget_reached");
researched = [];
const spent = await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "cross_sell", maxCatalogCalls: 40 }, { ...deps(async () => []),
  researchPair: async (input) => { researched.push(input.partner.name);
    return { coverage: "partial_assortment", callsUsed: input.maxCatalogCalls,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; } });
assert.equal(spent.stopReason, "catalog_budget_reached", "The run still stops when its own budget is spent");
assert.equal(researched.length, 2, "Two allowances of 20 spend a 40-call run");
delete process.env.COMMERCE_PARTNER_CONCURRENCY;

// The starting brand's homepage wearer is read once and passed to pair research.
let seedSeen = null;
await researchNativeCommerce({ ownerUserId: "owner",
  seed: { name: "Seed", officialWebsite: "https://seed.example.com" }, seedQlooId,
  objective: "cross_sell" }, { ...deps(async () => []), readSeedWearer: async () => "women",
  researchPair: async (input) => { seedSeen = input.seed;
    return { coverage: "no_catalog_results", callsUsed: 0,
      opportunities: { supported: [], needs_verification: [], unsupported: [] } }; } });
assert.equal(seedSeen.storeWearer, "women");

// An identity failure recorded under older identity rules is not remembered.
{
  const old = partnerMemoryTiers([{ partnerQlooId: "p", observedAt: new Date().toISOString(),
    outcome: "identity_unverified", identityReason: "no_brand_site_result", memoryVersion: "research-memory-v1" }], null);
  assert.equal(old.get("p").identityFailure, null);
  const current = partnerMemoryTiers([{ partnerQlooId: "p", observedAt: new Date().toISOString(),
    outcome: "identity_unverified", identityReason: "no_brand_site_result", memoryVersion: MEMORY_VERSION }], null);
  assert.equal(current.get("p").identityFailure, "no_brand_site_result");
}
console.log("Research memory checks passed.");
