import assert from "node:assert/strict";
import { investigateCommerceAudience } from "../src/commerce-audience.mjs";

const owner = "33333333-3333-4333-8333-333333333333";
const seed = "11111111-1111-4111-8111-111111111111";
const partner = "22222222-2222-4222-8222-222222222222";
const shared = { id: "urn:tag:keyword:qloo:independent_design", name: "Independent Design" };
let demographicCalls = 0;
const tags = async (_owner, id) => ({ status: "ok", sampleData: false,
  tags: id === seed ? [shared, { id: "urn:tag:keyword:qloo:design", name: "Design" }]
    : [{ ...shared }, { id: "urn:tag:keyword:qloo:design", name: "Design" }] });
const demographics = async (_owner, id) => {
  demographicCalls += 1;
  return { status: "ok", sampleData: false, results: [{ entity_id: id,
    query: { age: id === seed ? { "25_to_29": 0.2, "35_to_44": -0.1 }
      : { "25_to_29": 0.3, "35_to_44": 0.2 },
    gender: { female: id === seed ? 0.1 : 0.15, male: -0.1 } } }] };
};

const basic = await investigateCommerceAudience(owner, seed, partner, { tags, demographics });
assert.equal(basic.status, "specific_patterns_observed");
assert.deepEqual(basic.connections, [{ name: "Independent Design" }]);
assert.equal(basic.demographicStatus, "not_requested");
assert.equal(demographicCalls, 0, "The base tag check must not request demographics.");
assert.equal(Object.hasOwn(basic, "score"), false);

const detailed = await investigateCommerceAudience(owner, seed, partner,
  { tags, demographics, includeDemographics: "when_specific" });
assert.equal(demographicCalls, 2);
assert.deepEqual(detailed.sharedDemographicSignals,
  { age: ["25_to_29"], gender: ["female"] });

const unavailable = await investigateCommerceAudience(owner, seed, partner, {
  tags: async () => ({ status: "ok", sampleData: true, tags: [shared] }),
  demographics: async () => { throw new Error("Should not run"); },
});
assert.equal(unavailable.status, "unavailable");
assert.deepEqual(unavailable.connections, []);

const missing = await investigateCommerceAudience(owner, seed, partner, {
  tags: async (_owner, id) => ({ status: "ok", sampleData: false,
    tags: id === seed ? [shared] : [] }),
  demographics, includeDemographics: "when_specific",
});
assert.equal(missing.status, "no_specific_pattern_observed");
assert.deepEqual(missing.connections, []);
assert.equal(demographicCalls, 2, "No specific shared signal must not trigger demographics.");
await assert.rejects(investigateCommerceAudience(owner, seed, seed), /distinct/);
console.log("Selective cultural audience checks passed; no scoring or overlap claim is produced.");
