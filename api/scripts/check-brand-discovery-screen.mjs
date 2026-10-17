import assert from "node:assert/strict";
import { discoverOfficialBrandEvidence, screenBrandLeads } from "../src/personal-brand-discovery.mjs";

const leads = [
  { qlooId: "11111111-1111-4111-8111-111111111111", name: "SAMPLE US A", description: "Sample", qlooWebsite: "https://a.example" },
  { name: "SAMPLE US B", description: "Sample", qlooWebsite: null },
  { name: "SAMPLE US C", description: "Sample", qlooWebsite: "https://c.example" },
  { name: "SAMPLE US D", description: "Sample", qlooWebsite: null },
];
let searches = 0;
const screened = await screenBrandLeads(leads, {
  search: async (name) => {
    searches += 1;
    if (name === "SAMPLE US C") return [{ id: "Q3", name }, { id: "Q4", name }];
    return [{ id: name === "SAMPLE US A" ? "Q1" : "Q2", name }];
  },
  detail: async (item) => ({ ...item, website: item.id === "Q1" ? "https://www.a.example" : "https://b.example",
    wikidataUrl: `https://www.wikidata.org/wiki/${item.id}` }),
  maxScreened: 3,
});
assert.equal(searches, 3, "Only the bounded first three leads may spend business lookup calls");
assert.deepEqual(screened.map((item) => item.businessStatus),
  ["corroborated", "record_found", "ambiguous", "not_checked"]);
assert.ok(screened.every((item) => !Object.hasOwn(item, "qlooWebsite") && !Object.hasOwn(item, "id")));
assert.equal(screened[0].businessRecordUrl, "https://www.wikidata.org/wiki/Q1");
assert.deepEqual(screened[0].verifiedIdentity, {
  qlooId: leads[0].qlooId, wikidataQid: "Q1", website: "https://www.a.example",
});
assert.equal(screened[1].verifiedIdentity, null);

const conflicting = await screenBrandLeads([leads[0]], {
  search: async () => [{ id: "Q5", name: leads[0].name }],
  detail: async (item) => ({ ...item, website: "https://different.example" }),
});
assert.equal(conflicting[0].businessStatus, "conflicting");
const disambiguated = await screenBrandLeads([leads[0]], {
  search: async () => [{ id: "Q10", name: leads[0].name }, { id: "Q11", name: leads[0].name }],
  detail: async (item) => ({ ...item, website: item.id === "Q11" ? "https://www.a.example" : "https://different.example" }),
});
assert.equal(disambiguated[0].businessStatus, "corroborated");
assert.equal(disambiguated[0].verifiedIdentity.wikidataQid, "Q11");
const unavailable = await screenBrandLeads([leads[0]], { search: async () => { throw new Error("offline"); } });
assert.equal(unavailable[0].businessStatus, "unavailable");
const source = { inspected: true, url: "https://samplegear.example/products",
  title: "SAMPLE GEAR | Outdoor Backpacks", snippet: "SAMPLE GEAR backpacks for hiking",
  sourceHash: "b".repeat(64) };
const discovered = await discoverOfficialBrandEvidence({ name: "SAMPLE GEAR",
  description: "A brand making backpacks" }, { search: async (_query, options) => ({
  results: options.includeDomains ? [source] : [source],
}) });
assert.equal(discovered.website, "https://samplegear.example");
assert.equal(discovered.evidence.url, source.url);
console.log("SAMPLE Brand × Brand discovery screening: bounded identity lookup, ambiguity and conflict handling passed.");
