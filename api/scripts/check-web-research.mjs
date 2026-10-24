import assert from "node:assert/strict";
import { inspectedSearchResult, classifyMention, supportedBusinessEvidence,
  researchPartnerEvidence, webRequestHash, inspectedExtractResponse,
  tavilySearch, tavilyExtract, explicitBusinessContradiction } from "../src/web-research.mjs";

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
assert.equal(classifyMention("camping", inspected), "central");
assert.equal(inspectedSearchResult({ ...page, raw_content: "The only folks who visit." }, "folk"), null);
assert.equal(classifyMention("folk", { title: "Helpful folks", snippet: "Outdoor folks" }), "incidental");
assert.equal(classifyMention("campaign", { title: "Our marketing campaigns", snippet: "" }), "central");
assert.ok(inspectedSearchResult({ ...page, title: "Arc'teryx marketing",
  raw_content: "Arc'teryx builds marketing campaigns for new product launches." }, "campaign"));
assert.ok(inspectedSearchResult({ ...page, title: "Osprey folk project",
  raw_content: "Osprey launched a folk project with local artists." }, "folk"));
const evidence = (title, snippet) => ({ title, snippet, inspected: true,
  sourceHash: "a".repeat(64), url: "https://example.com/page" });
assert.equal(supportedBusinessEvidence("folk", evidence("Osprey gear", "Helpful folks use this manual."), "Osprey"), false);
assert.equal(supportedBusinessEvidence("folk", evidence("Osprey folk project", "Osprey launched a folk project with local artists."), "Osprey"), true);
assert.equal(supportedBusinessEvidence("campaign", evidence("Arc'teryx campaigns", "Arc'teryx builds marketing campaigns for product launches."), "Arc'teryx"), true);
assert.equal(supportedBusinessEvidence("campaign", { ...evidence("Arc'teryx Retail Careers",
  "We build entire marketing campaigns around how genuine, helpful and knowledgeable you are."),
  url: "https://arcteryx.com/ca/en/careers/retail-opportunities" }, "Arc'teryx"), false,
"A recruiting page's generic campaign statement must not establish partnership content capability.");
assert.equal(supportedBusinessEvidence("campaign", evidence("Arc'teryx campaigns", "Campaigns | Clothing | Careers | Contact"), "Arc'teryx"), false);
assert.equal(supportedBusinessEvidence("campaign", { ...evidence(
  "Arc’teryx Launches Walk Gently, a Design Platform for Indigenous Voices",
  "Working directly with the host nation communities as cast members and in various parts of the crew for the campaign."),
  url: "https://blog.arcteryx.com/news/arcteryx-launches-walk-gently-a-design-platform-for-indigenous-voices" }, "Arc'teryx"), true,
"An inspected official news article with a brand action and concrete campaign production details supports transferable content capability.");
assert.equal(supportedBusinessEvidence("campaign", evidence("Arc'teryx launches jackets", "Campaigns | Shop | Contact"), "Arc'teryx"), false);
assert.equal(supportedBusinessEvidence("campaign", evidence("Arc'teryx jackets", "Arc'teryx designs jackets. Other brand campaigns appear in our links."), "Arc'teryx"), false);
assert.equal(supportedBusinessEvidence("campaign", evidence("Arc'teryx campaigns", "We might build campaigns someday."), "Arc'teryx"), false);
assert.equal(supportedBusinessEvidence("journal", evidence("Socks Made in USA | Smartwool US",
  "the checkerboard landscape in the Crazies... Read Post A trip to the Kootenays with The Snowboarders Journal Tag: Snow Tag: Stories A trip to the Kootenays with The Snowboarders Journal Smartwool • Smartwool athletes head to Whitewater, BC, for deep snow, untouched lines"), "Smartwool"), false,
"A product-page title action cannot turn a related-post navigation excerpt into a content capability.");
assert.equal(supportedBusinessEvidence("journal", { ...evidence("Become An Affiliate – Cold Picnic",
  "Apply For A Trade Account Gallery Featured image Trade Program About Us Our Story Our Partners Journal About Our Products Product Guide Care Guide Sizing Information Custom COMMUNITY Become An Affiliate Stockists Initiatives Featured image About Us New Arrivals Best Sellers Shop All 10% Off Your First Order Rugs Bathmats Blanket"),
  url: "https://coldpicnic.com/pages/become-an-affiliate" }, "Cold Picnic"), false,
"The cached Cold Picnic navigation excerpt cannot establish journal production or a promotion channel.");
assert.equal(supportedBusinessEvidence("campaign", evidence("Cold Picnic campaign",
  "Cold Picnic partners with local artists on a documented campaign."), "Cold Picnic"), true,
"A concrete partnership action remains admissible.");
assert.ok(inspectedSearchResult({ ...page, title: "Outdoor Clothing", raw_content: "Find technical clothing for hiking." }, "Outdoor Clothing"));
assert.equal(inspectedSearchResult({ ...page, raw_content: null }, "camping"), null);
assert.equal(inspectedSearchResult({ ...page, raw_content: "Unrelated page" }, "camping"), null);
assert.equal(inspectedSearchResult({ ...page, url: "http://www.hipcamp.com/journal/camping" }, "camping"), null);
assert.equal(inspectedSearchResult({ ...page, url: "https://127.0.0.1/private" }, "camping"), null);
assert.notEqual(webRequestHash("hipcamp camping", ["hipcamp.com"], "camping"),
  webRequestHash("hipcamp camping", ["hipcamp.com"], "journal"));
const validCampaign = { ...evidence("Arc'teryx marketing", "Arc'teryx builds marketing campaigns for outdoor products."),
  url: "https://arcteryx.com/campaigns" };
const officialBlog = { ...evidence("Arc'teryx launches Walk Gently", "The Arc'teryx crew produced the campaign."),
  url: "https://blog.arcteryx.com/walk-gently" };
const navigation = { ...evidence("Arc'teryx campaign", "Campaigns | Stories | Shop"),
  url: "https://arcteryx.com/navigation" };
const questions = [];
const research = await researchPartnerEvidence(null, { brandName: "Arc'teryx", domain: "arcteryx.com",
  territories: ["folk", "folk"], capabilityTerms: [{ key: "content_creation_capability", terms: ["campaign", "campaigns"] }] },
{ search: async (query, options) => {
  questions.push([query, options.focus]);
  if (options.focus === "folk") return { results: [{ ...evidence("Arc'teryx folk", "Helpful folks explore trails."),
    url: "https://arcteryx.com/folk" }] };
  return { results: [navigation, validCampaign, officialBlog,
    { ...validCampaign, url: "https://notarcteryx.com/campaigns" }] };
} });
assert.equal(research.territoryResults.length, 1, "Equivalent territory questions are deduplicated");
assert.equal(research.territoryResults[0].official.length, 0, "A lexical lead is not cultural activity");
assert.equal(research.capabilityResults[0].status, "transferable");
assert.equal(research.capabilityResults[0].matches[0].url, validCampaign.url);
assert.deepEqual(questions, [["Arc'teryx folk", "folk"], ["Arc'teryx campaign", "campaign"]],
  "A supported capability stops further equivalent searches");
const blogResearch = await researchPartnerEvidence(null, { brandName: "Arc'teryx", domain: "arcteryx.com",
  territories: ["campaign"] }, { search: async (_query, options) => ({
  results: options.includeDomains ? [officialBlog, { ...officialBlog,
    url: "https://arcteryx.com.evil.test/walk-gently" }] : [],
}) });
assert.deepEqual(blogResearch.territoryResults[0].official.map((item) => item.url), [officialBlog.url]);
const extractPayload = { results: [
  { url: "https://smartwool.com/journal", raw_content: "Smartwool created a journal about trail life." },
  { url: "https://other-company.com/journal", raw_content: "Smartwool created a journal about trail life." },
] };
const extracted = inspectedExtractResponse(extractPayload, "https://smartwool.com/journal", "journal",
  "Smartwool journal");
assert.equal(extracted.length, 1, "Extract results retain only the requested publisher URL");
assert.equal(extracted[0].url, "https://smartwool.com/journal");
assert.equal(extracted[0].raw_content, undefined, "Only inspected excerpts may be cached");
assert.equal(supportedBusinessEvidence("journal", extracted[0], "Smartwool"), true);
assert.equal(supportedBusinessEvidence("journal", extracted[0], "Other Company"), false);
assert.equal(explicitBusinessContradiction("campaign", evidence("Smartwool news",
  "Smartwool does not run campaigns in this market."), "Smartwool"), true);
assert.equal(supportedBusinessEvidence("campaign", evidence("Smartwool news",
  "Smartwool does not create campaigns in this market."), "Smartwool"), false);
assert.equal(explicitBusinessContradiction("campaign", evidence("Smartwool news",
  "No campaigns were found in the retrieved pages."), "Smartwool"), false);
assert.equal(explicitBusinessContradiction("campaign", evidence("Smartwool news",
  "Another brand does not run campaigns."), "Smartwool"), false);
assert.equal(inspectedExtractResponse({ results: [{ url: "https://smartwool.com/journal",
  raw_content: "Smartwool | Journal | Shop | Careers" }] }, "https://smartwool.com/journal", "journal",
"Smartwool journal").some((item) => supportedBusinessEvidence("journal", item, "Smartwool")), false);
let extracts = 0;
const gapResearch = await researchPartnerEvidence(null, { brandName: "Smartwool", domain: "smartwool.com",
  territories: [], capabilityTerms: [{ key: "content_creation_capability", terms: ["campaign", "journal"] }] },
{ search: async (_query, options) => options.focus === "journal" ? { results: extracted } :
  { results: [], leads: [{ url: "https://smartwool.com/journal", title: "Smartwool journal" }] },
  extract: async () => { extracts += 1; return { results: extracted }; } });
assert.equal(gapResearch.capabilityResults[0].status, "direct");
assert.equal(gapResearch.capabilityResults[0].term, "journal");
assert.equal(extracts, 1, "An extracted URL is not requested again for the next term");
const failedResearch = await researchPartnerEvidence(null, { brandName: "Smartwool", domain: "smartwool.com",
  territories: ["Sustainability"], capabilityTerms: [{ key: "content_creation_capability", terms: ["campaign"] }] },
{ search: async () => { throw new Error("Provider unavailable"); } });
assert.equal(failedResearch.coverage, "not_completed");
assert.equal(failedResearch.capabilityResults[0].coverage, "not_performed");
let selectedLacausaLead = null;
await researchPartnerEvidence(null, { brandName: "Lacausa", domain: "lacausa.com", territories: [],
  capabilityTerms: [{ key: "content_creation_capability", terms: ["video"] }] }, {
  search: async () => ({ results: [], leads: [
    { url: "https://lacausa.com/policies/legal-notice", title: "Legal notice" },
    { url: "https://lacausa.com/blogs/journal/film-project", title: "Lacausa film project" },
  ] }),
  extract: async (url) => { selectedLacausaLead = url; return { results: [] }; },
});
assert.equal(selectedLacausaLead, "https://lacausa.com/blogs/journal/film-project",
  "A legal-notice lead from the cached Lacausa result must not consume an extraction slot.");
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
console.log("Inspected public web pages produce bounded source evidence; snippets, unrelated pages and unsafe URLs are rejected.");
