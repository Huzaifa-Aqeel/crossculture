import assert from "node:assert/strict";
import { normalizeQlooBrands, normalizeWikidataBrands, resolveBrand, searchWikidataBrands, selectedWikidataBrand, selectResolvedBrand } from "../src/brand-resolution.mjs";

const qlooCandidates = [
  { entity_id: "qloo-brand-one", name: "Atlas", properties: { description: "Outdoor apparel", website: "https://atlas.example" } },
  { entity_id: "qloo-brand-two", name: "Atlas", properties: { description: "Travel equipment", website: "https://travel.example" } },
];
assert.equal(normalizeQlooBrands({ results: [qlooCandidates[0], qlooCandidates[0]] }).length, 1);
assert.equal(normalizeWikidataBrands([{ id: "Q123", label: "Atlas" }, { id: "Q123", label: "Atlas" }]).length, 1);
const result = await resolveBrand("Atlas", {
  qloo: async () => ({ status: "ok", results: qlooCandidates }),
  wikidata: async () => { throw new Error("Wikidata unavailable"); },
});
assert.equal(result.qloo.candidates.length, 2);
assert.equal(result.wikidata.status, "unavailable");
assert.equal(result.confirmationRequired, true);
assert.equal(selectResolvedBrand(result, "qloo-brand-two", null).qloo.website, "https://travel.example");
assert.throws(() => selectResolvedBrand(result, "unknown", null), /Select a cultural brand/);

const wiki = normalizeWikidataBrands([{ id: "Q123", label: "Atlas", description: "Outdoor brand" }], {
  Q123: { claims: { P856: [{ mainsnak: { datavalue: { value: "https://atlas.example/about" } } }] } },
});
assert.equal(wiki[0].website, "https://atlas.example");
assert.equal(wiki[0].id, "Q123");
assert.throws(() => selectResolvedBrand({ ...result, wikidata: { status: "ok", candidates: [{ ...wiki[0], name: "Different Corporation", website: "https://other.example" }] } }, "qloo-brand-one", "Q123"), /different official websites/);
const matching = selectResolvedBrand({ ...result, wikidata: { status: "ok", candidates: wiki } }, "qloo-brand-one", "Q123");
assert.equal(matching.identityStatus, "verified");
const webVariant = selectResolvedBrand({ ...result, wikidata: { status: "ok", candidates: [{ ...wiki[0], website: "http://www.atlas.example" }] } }, "qloo-brand-one", "Q123");
assert.equal(webVariant.identityStatus, "verified");
const legalName = selectResolvedBrand({ ...result, wikidata: { status: "ok", candidates: [{ ...wiki[0], name: "Atlas, Inc.", website: null }] } }, "qloo-brand-one", "Q123");
assert.equal(legalName.identityStatus, "unverified");
const noQlooSite = selectResolvedBrand({ ...result,
  qloo: { status: "ok", candidates: [{ ...result.qloo.candidates[0], website: null }] },
  wikidata: { status: "ok", candidates: [{ ...wiki[0], name: "Atlas, Inc." }] },
}, "qloo-brand-one", "Q123");
assert.equal(noQlooSite.identityStatus, "verified");

const calls = [];
const fakeFetch = async (url) => {
  const action = url.searchParams.get("action");
  calls.push(action);
  return { ok: true, json: async () => action === "wbsearchentities"
    ? { search: [{ id: "Q123", label: "Atlas", description: "Outdoor brand" }] }
    : { entities: { Q123: { claims: { P856: [{ mainsnak: { datavalue: { value: "https://atlas.example" } } }] } } } } };
};
const searchOnly = await searchWikidataBrands("Atlas", fakeFetch);
assert.deepEqual(calls, ["wbsearchentities"]);
assert.equal(searchOnly[0].website, null);
const selectedDetails = await selectedWikidataBrand(searchOnly[0], fakeFetch);
assert.deepEqual(calls, ["wbsearchentities", "wbgetentities"]);
assert.equal(selectedDetails.website, "https://atlas.example");

const wikiOnly = await resolveBrand("Atlas", {
  qloo: async () => { throw new Error("Qloo unavailable"); },
  wikidata: async () => wiki,
});
assert.equal(wikiOnly.qloo.status, "unavailable");
assert.equal(wikiOnly.wikidata.candidates.length, 1);
console.log("Brand resolution keeps provider failures independent and requires explicit identity selection.");
