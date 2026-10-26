import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { inspectedSearchResult, webRequestHash, inspectedExtractResponse,
  officialDomainOf, isDomain, tavilySearch, tavilyExtract } from "../src/web-research.mjs";

// Commerce uses web research only for selective identity, shortlist and
// concept-angle pages. Creator-era evidence classifiers were removed.
const page = {
  title: "Hipcamp Journal: Camping stories",
  url: "https://www.hipcamp.com/journal/camping",
  raw_content: "Hipcamp Journal documents camping stories and campground guidance for travelers.",
  published_date: "2026-09-01",
};
const inspected = inspectedSearchResult(page, "camping");
assert.equal(inspected.inspected, true);
assert.equal(inspected.url, page.url);
assert.match(inspected.snippet, /camping/i);
assert.equal(inspected.raw_content, undefined);
assert.equal(inspected.sourceHash.length, 64);
assert.equal(inspectedSearchResult({ ...page, raw_content: "The only folks who visit." }, "folk"), null);
assert.ok(inspectedSearchResult({ ...page, title: "Arc'teryx marketing",
  raw_content: "Arc'teryx builds marketing campaigns for new product launches." }, "campaign"));
assert.ok(inspectedSearchResult({ ...page, title: "Osprey folk project",
  raw_content: "Osprey launched a folk project with local artists." }, "folk"));
assert.ok(inspectedSearchResult({ ...page, title: "Outdoor Clothing", raw_content: "Find technical clothing for hiking." }, "Outdoor Clothing"));
assert.equal(inspectedSearchResult({ ...page, raw_content: null }, "camping"), null);
assert.equal(inspectedSearchResult({ ...page, raw_content: "Unrelated page" }, "camping"), null);
assert.equal(inspectedSearchResult({ ...page, url: "http://www.hipcamp.com/journal/camping" }, "camping"), null);
assert.equal(inspectedSearchResult({ ...page, url: "https://127.0.0.1/private" }, "camping"), null);
assert.notEqual(webRequestHash("hipcamp camping", ["hipcamp.com"], "camping"),
  webRequestHash("hipcamp camping", ["hipcamp.com"], "journal"));
const extractPayload = { results: [
  { url: "https://smartwool.com/journal", raw_content: "Smartwool created a journal about trail life." },
  { url: "https://other-company.com/journal", raw_content: "Smartwool created a journal about trail life." },
] };
const extracted = inspectedExtractResponse(extractPayload, "https://smartwool.com/journal", "journal",
  "Smartwool journal");
assert.equal(extracted.length, 1, "Extract results retain only the requested publisher URL");
assert.equal(extracted[0].url, "https://smartwool.com/journal");
assert.equal(extracted[0].raw_content, undefined, "Only inspected excerpts may be cached");
const priorKey = process.env.TAVILY_API_KEY;
const priorBackupKey = process.env.TAVILY_API_KEY_2;
const priorFetch = globalThis.fetch;
delete process.env.TAVILY_API_KEY;
delete process.env.TAVILY_API_KEY_2;
await assert.rejects(tavilySearch("Smartwool campaign"), /not configured/);
await assert.rejects(tavilyExtract("https://smartwool.com/journal", { focus: "journal" }), /not configured/);
process.env.TAVILY_API_KEY = "fixture-key";
process.env.TAVILY_API_KEY_2 = "fixture-backup-key";
const authHeaders = [];
globalThis.fetch = async (_url, options) => {
  authHeaders.push(options.headers.authorization);
  return { ok: false, status: 503 };
};
await assert.rejects(tavilySearch("Smartwool campaign"), /status 503/);
await assert.rejects(tavilyExtract("https://smartwool.com/journal", { focus: "journal" }), /status 503/);
assert.deepEqual(authHeaders, ["Bearer fixture-backup-key", "Bearer fixture-backup-key"]);
delete process.env.TAVILY_API_KEY;
globalThis.fetch = async (_url, options) => {
  authHeaders.push(options.headers.authorization);
  return { ok: true, json: async () => ({ results: [], usage: { credits: 1 } }) };
};
assert.equal((await tavilySearch("Smartwool campaign")).usage.credits, 1);
assert.equal(authHeaders.at(-1), "Bearer fixture-backup-key", "Backup works without the primary key");
globalThis.fetch = priorFetch;
if (priorKey === undefined) delete process.env.TAVILY_API_KEY;
else process.env.TAVILY_API_KEY = priorKey;
if (priorBackupKey === undefined) delete process.env.TAVILY_API_KEY_2;
else process.env.TAVILY_API_KEY_2 = priorBackupKey;
assert.equal(officialDomainOf("https://www.example.com/about"), "example.com");
assert.equal(isDomain("https://shop.example.com/page", "example.com"), true);
assert.equal(isDomain("https://example.com.evil.test/page", "example.com"), false);
// The hosted database is reached through a transaction-mode pooler, where a
// session advisory lock can outlive its "unlock" and block later searches.
// Only transaction-scoped locks are allowed.
for (const file of await readdir(new URL("../src/", import.meta.url))) {
  if (!file.endsWith(".mjs")) continue;
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /pg_advisory_(?:lock|unlock)\(/, `${file} must not take a session advisory lock`);
}
console.log("Inspected public web pages produce bounded source evidence; unrelated pages and unsafe URLs are rejected.");
