import assert from "node:assert/strict";
import { classifyContentRelevance, scoreAssessment, SCORING_VERSION } from "../src/scoring.ts";
import { creatorBridgeCandidates } from "../src/creator-research.mjs";
import { extractCreatorMetadata, classifyCreatorChannel } from "../src/creator-intelligence.mjs";

const source = (number, date = `2026-10-${String(number).padStart(2, "0")}T12:00:00Z`) =>
  ({ id: `personal:video-${number}`, kind: "personal_item", observedAt: date });
const sample = [1, 2, 3, 4].map((number) => source(number));
const bridge = { id: "bridge:1", name: "Hiking", qlooTagId: "tag-hiking", family: "activity",
  specificity: "named", qlooSourceIds: ["qloo:seed", "qloo:resolved"],
  partnerSourceIds: [sample[0].id], explainabilityBacked: false };
const evidence = (centralities, outside = []) => ({ contractVersion: 2, sample: false,
  sources: [...sample, source(9)], creatorSample: { sourceIds: sample.map((item) => item.id),
    videoIds: ["abc12345671", "abc12345672", "abc12345673", "abc12345674"],
    collectedAt: "2026-10-14T12:00:00Z", complete: true }, bridges: [bridge],
  partnerActivity: [...centralities.map((centrality, index) => ({ id: `activity:${index}`,
    centrality, firstParty: true, bridgeIds: [bridge.id], sourceIds: [sample[index].id],
    summary: "A video discusses hiking." })), ...outside] });

assert.equal(classifyContentRelevance(evidence([]), "brand_youtube").signal.rating, null);
assert.equal(classifyContentRelevance(evidence(["incidental"]), "brand_youtube").signal.rating, 0.25);
assert.equal(classifyContentRelevance(evidence(["central"]), "brand_youtube").signal.rating, 0.5);
const nikeScore = (relevance, snapshotId) => scoreAssessment({ snapshotId,
  snapshotHash: "a".repeat(64), scorerVersion: SCORING_VERSION,
  pairType: "brand_youtube", objective: "content_collaboration",
  brandId: "nike", partnerId: "ajcompshd", sourceIds: ["qloo:ronaldinho", "personal:ronaldinho", "personal:format"],
  culturalConnection: { rating: 0.75, evidenceIds: ["qloo:ronaldinho", "personal:ronaldinho"], reasonCode: "named_bridge" },
  contentRelevance: { rating: relevance, evidenceIds: ["personal:ronaldinho"], reasonCode: "sample_activity" },
  goalFit: { rating: 0.75, evidenceIds: ["personal:format"], reasonCode: "content_capability" },
  qlooLineageVerified: true, identityVerified: true, hardExclusion: false,
  hardExclusionEvidenceIds: [], reviewFlags: [], confidence: "medium" });
assert.equal(nikeScore(0.25, "direct").displayScore, 50);
assert.equal(nikeScore(0.5, "discovery").displayScore, 65);
assert.equal(nikeScore(0.5, "direct-equivalent").displayScore,
  nikeScore(0.5, "discovery-equivalent").displayScore,
  "Equivalent admissible C/R/G evidence must score identically in either workflow.");
assert.equal(classifyContentRelevance(evidence(["substantive", "substantive"]), "brand_youtube").signal.rating, 0.5);
assert.equal(classifyContentRelevance(evidence(["central", "central"]), "brand_youtube").signal.rating, 0.75);
assert.equal(classifyContentRelevance(evidence(["central", "central", "central", "central"]), "brand_youtube").signal.rating, 1);
const incomplete = evidence(["central", "central"]);
incomplete.creatorSample.complete = false;
assert.ok(classifyContentRelevance(incomplete, "brand_youtube").reviewFlags.includes("creator_sample_incomplete"));
const outside = { id: "activity:outside", centrality: "central", firstParty: true,
  bridgeIds: [bridge.id], sourceIds: ["personal:video-9"], summary: "Targeted discovery video." };
assert.equal(classifyContentRelevance(evidence(["central"], [outside]), "brand_youtube").signal.rating, 0.5);
assert.equal(classifyContentRelevance(evidence(["central", "contradictory"]), "brand_youtube").reviewFlags[0], "material_contradiction");
const otherSupportedEntity = evidence([],
  [{ id: "activity:discovery", centrality: "central", firstParty: true,
    bridgeIds: [bridge.id], sourceIds: ["personal:video-9"], summary: "Older discovery hit." }]);
otherSupportedEntity.bridges.push({ ...bridge, id: "bridge:2", name: "Other supported entity",
  qlooTagId: "other-entity", partnerSourceIds: [sample[0].id] });
otherSupportedEntity.partnerActivity.push({ id: "activity:other-sampled", centrality: "central",
  firstParty: true, bridgeIds: ["bridge:2"], sourceIds: [sample[0].id],
  summary: "Independent sampled evidence for another Qloo-supported entity." });
assert.equal(classifyContentRelevance(otherSupportedEntity, "brand_youtube").signal.rating, 0.5,
  "R may use another independently observed, supported entity in the same pair's culture.");
otherSupportedEntity.bridges.pop();
assert.equal(classifyContentRelevance(otherSupportedEntity, "brand_youtube").signal.rating, null,
  "An unsupported sampled entity and an out-of-sample hit cannot establish R.");
assert.deepEqual(creatorBridgeCandidates({ tags: [{ id: "tag-hiking", name: "Hiking" }] },
  { culturalSignals: [{ videoId: "abc12345671", phrase: "Hiking", centrality: "central" },
    { videoId: "abc12345672", phrase: "Hiking boots", centrality: "central" },
    { videoId: "abc12345673", phrase: "Hiking", centrality: "incidental" }] })[0].observations.map((item) => item.videoId), ["abc12345671"]);

process.env.LLM_API_URL = "https://example.test/v1";
process.env.LLM_API_KEY = "fixture-key";
process.env.LLM_MODEL = "fixture-model";
const id = "abc12345671";
const profile = { id: "UC1234567890123456789012", name: "SAMPLE US creator", summary: "Sample fixture",
  videos: [{ sourceId: id, title: "Hiking the mountain trail", description: "Affiliate code for Trail Gear is in the links.",
    tags: ["Hiking"], publishedAt: "2026-10-01T12:00:00Z" }] };
const modelResponse = { culturalSignals: [
  { videoId: id, phrase: "Hiking", centrality: "central", basisField: "title", basisText: "Hiking the mountain trail" },
  { videoId: id, phrase: "Unspoken topic", centrality: "central", basisField: "title", basisText: "Hiking the mountain trail" },
  { videoId: id, phrase: "Hiking", centrality: "central", basisField: "tags", basisText: "Hiking" },
  { videoId: "abc12345672", phrase: "Hiking", centrality: "central", basisField: "title", basisText: "Hiking" } ],
  demonstratedFormats: [], collaborationObservations: [
    { videoId: id, kind: "explicit_sponsorship_disclosure", partnerName: null,
      basisField: "title", basisText: "Hiking the mountain trail" },
    { videoId: id, kind: "affiliate_reference", partnerName: "Trail Gear",
      basisField: "description", basisText: "Affiliate code for Trail Gear" }] };
const metadata = await extractCreatorMetadata(profile, { fetchFn: async () => ({ ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(modelResponse) } }] }) }) });
assert.equal(metadata.culturalSignals.length, 2);
assert.equal(metadata.culturalSignals[0].centrality, "central");
assert.equal(metadata.culturalSignals[1].centrality, "incidental");
assert.equal(metadata.collaborationObservations.length, 1);
assert.equal(metadata.collaborationObservations[0].kind, "affiliate_reference");
assert.equal((await classifyCreatorChannel({ name: "Patagonia", summary: "Official brand videos" }, "Patagonia")).kind, "organization");
const classified = await classifyCreatorChannel({ name: "SAMPLE channel", summary: "The official public TV station for a city." }, "Patagonia", {
  fetchFn: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    kind: "organization", basisField: "summary", basisText: "official public TV station",
    reason: "The channel identifies itself as a television station." }) } }] }) }) });
assert.equal(classified.kind, "organization");
const unsupported = await classifyCreatorChannel({ name: "SAMPLE channel", summary: "Travel stories and hiking" }, "Patagonia", {
  fetchFn: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    kind: "creator", basisField: "name", basisText: "SAMPLE channel",
    reason: "A channel title alone might be an individual creator." }) } }] }) }) });
assert.equal(unsupported.kind, "unknown");
const emptyDescription = await classifyCreatorChannel({ name: "Gabe Explains", summary: "" }, "Patagonia", {
  fetchFn: async () => { throw new Error("A video subject cannot establish channel ownership."); } });
assert.equal(emptyDescription.kind, "unknown",
  "A personal-sounding title and a video about a named person cannot identify the channel operator.");
const selfAttributed = await classifyCreatorChannel({ name: "Through My Lens",
  summary: "All of the videos are shot and edited by me based on actual trips I have taken." }, "Hipcamp", {
  fetchFn: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    kind: "creator", basisField: "summary", basisText: "All of the videos are shot and edited by me",
    reason: "The channel owner directly attributes video production to themselves." }) } }] }) }) });
assert.equal(selfAttributed.kind, "creator");
console.log("SAMPLE creator v4 rubric, predeclared sample, out-of-sample exclusion, contradiction and metadata grounding checks passed.");
