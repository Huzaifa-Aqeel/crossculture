import assert from "node:assert/strict";
import { discover } from "../src/discovery.mjs";
import { analyzePair } from "../src/pairs.mjs";
import { selectedDemoBrand } from "../src/demo-identity.mjs";

const chosenSeed = { entity_id: "fixture-chosen-seed", name: "Atlas Outdoor", properties: { short_description: "Outdoor apparel for hiking and camping" } };
const chosenPartner = { entity_id: "fixture-chosen-partner", name: "Apex Camping", properties: { short_description: "Camping experiences and hiking trips" } };
const chosenCreator = { id: "fixture-channel", name: "US Hiking Channel", summary: "Hiking and camping videos", url: "https://www.youtube.com/@fixture", videoCount: 3,
  videos: [{ title: "Hiking video", sourceUrl: "https://www.youtube.com/watch?v=fixture0001", publishedAt: "2026-10-01T00:00:00.000Z" }],
  signals: [{ label: "outdoor adventure", count: 3, sources: [{ title: "Hiking video", url: "https://www.youtube.com/watch?v=fixture0001" }] }] };
const calls = [];
const storedSelections = new Map([["sample-selection", { sessionId: "visitor-a", raw: chosenSeed, createdAt: 1_000_000 }]]);
assert.equal(selectedDemoBrand(storedSelections, "sample-selection", "visitor-a", 1_000_001)?.raw.entity_id, chosenSeed.entity_id);
assert.equal(selectedDemoBrand(storedSelections, "sample-selection", "visitor-b", 1_000_001), null);
assert.equal(selectedDemoBrand(storedSelections, "sample-selection", "visitor-a", 1_000_000 + 15 * 60_000), null);
assert.equal(selectedDemoBrand(storedSelections, "made-up", "visitor-a", 1_000_001), null);
const qloo = async (name, args) => {
  calls.push({ name, args });
  if (name === "qloo_describe") throw new Error("A confirmed brand must not be described again.");
  if (name === "qloo_recommend") return { status: "ok", results: [chosenPartner] };
  if (name === "qloo_rank") return { status: "ok", results: [{ entity_id: chosenPartner.entity_id, affinity: 0.5 }] };
  if (name === "qloo_find_tags") return { status: "ok", results: [{ tag_id: "urn:tag:outdoor-adventure", name: "outdoor adventure" }] };
  throw new Error(`Unexpected operation: ${name}`);
};

const discovered = await discover({ type: "brand", partnerType: "brand", seed: chosenSeed.name, selectedSeed: chosenSeed, goal: "Content collaboration" }, { feedback: [] }, [], { qloo });
assert.equal(discovered.seed.name, chosenSeed.name);
assert.equal(calls[0].name, "qloo_recommend");
assert.deepEqual(calls[0].args.signals, [chosenSeed.entity_id]);

calls.length = 0;
const compared = await analyzePair({ leftType: "brand", left: chosenSeed.name, selectedSeed: chosenSeed, rightType: "brand", right: chosenPartner.name, selectedRight: chosenPartner, goal: "Content collaboration" }, { feedback: [] }, [], { qloo });
assert.equal(compared.seed.name, chosenSeed.name);
assert.equal(compared.candidates[0].name, chosenPartner.name);
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "qloo_rank");
assert.deepEqual(calls[0].args.options, [chosenPartner.entity_id]);

calls.length = 0;
const metadataCreator = await discover({ type: "brand", partnerType: "creator", seed: chosenSeed.name,
  selectedSeed: chosenSeed, goal: "Content collaboration" }, { feedback: [] }, [],
{ qloo, channels: async () => [{ id: chosenCreator.id, searchSource: { title: "Hiking video", url: "https://www.youtube.com/watch?v=fixture0001" } }],
  importCreator: async () => ({ ...chosenCreator, signals: [] }) });
assert.equal(metadataCreator.status, "partial");
assert.equal(metadataCreator.candidates.length, 1);
assert.equal(metadataCreator.candidates[0].evidenceStrength, "Cultural fit unassessed");
assert.equal(metadataCreator.candidates[0].sourceLinks.length, 1);
assert.ok(!metadataCreator.candidates[0].connection.includes("repeatedly"));
const metadataPair = await analyzePair({ leftType: "brand", left: chosenSeed.name, selectedSeed: chosenSeed,
  rightType: "creator", right: chosenCreator.url, goal: "Content collaboration" }, { feedback: [] }, [],
{ qloo, importCreator: async () => ({ ...chosenCreator, signals: [] }) });
assert.equal(metadataPair.status, "partial");
assert.equal(metadataPair.candidates[0].evidenceStrength, "Cultural fit unassessed");
assert.equal(metadataPair.candidates[0].sourceLinks.length, 1);
calls.length = 0;
// Even an injected derived signal cannot turn a metadata lead into assessed creator fit.
const creatorDiscovery = await discover({ type: "brand", partnerType: "creator", seed: chosenSeed.name, selectedSeed: chosenSeed, goal: "Content collaboration" }, { feedback: [] }, [], { qloo,
  channels: async () => [{ id: chosenCreator.id, searchSource: { title: "Hiking video", url: "https://www.youtube.com/watch?v=fixture0001" } }],
  importCreator: async () => chosenCreator });
assert.equal(creatorDiscovery.seed.name, chosenSeed.name);
assert.equal(creatorDiscovery.candidates[0].name, chosenCreator.name);
assert.equal(creatorDiscovery.status, "partial");
assert.equal(creatorDiscovery.candidates[0].evidenceStrength, "Cultural fit unassessed");
assert.deepEqual(calls.map((call) => call.name), ["qloo_find_tags"]);
const noSearchSource = await discover({ type: "brand", partnerType: "creator", seed: chosenSeed.name, selectedSeed: chosenSeed, goal: "Content collaboration" },
  { feedback: [] }, [], { qloo, channels: async () => [chosenCreator.id], importCreator: async () => chosenCreator });
assert.equal(noSearchSource.status, "partial");
assert.equal(noSearchSource.candidates.length, 0, "Injected derived signals cannot replace an actual search source");

calls.length = 0;
const creatorPair = await analyzePair({ leftType: "brand", left: chosenSeed.name, selectedSeed: chosenSeed, rightType: "creator", right: chosenCreator.url, goal: "Content collaboration" }, { feedback: [] }, [], { qloo, importCreator: async () => chosenCreator });
assert.equal(creatorPair.candidates[0].name, chosenCreator.name);
assert.equal(creatorPair.status, "partial");
assert.equal(creatorPair.candidates[0].evidenceStrength, "Cultural fit unassessed");
assert.deepEqual(calls.map((call) => call.name), []);

console.log("Confirmed demo brands drive both discovery and direct-pair paths without another describe call.");
