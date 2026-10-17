// Unit tests for the v4 scoring engine (api/src/scoring.ts). No database, no providers.
import assert from "node:assert/strict";
import { scoreAssessment, classifySignals, classifyExclusions, requiredCapabilities, SCORING_VERSION } from "../src/scoring.ts";
import { assessmentConstraints } from "../src/assessment-constraints.mjs";

const HASH = "a".repeat(64);
const baseInput = {
  snapshotId: "snap-1", snapshotHash: HASH, scorerVersion: SCORING_VERSION,
  pairType: "brand_brand", objective: "content_collaboration",
  brandId: "brand-1", partnerId: "partner-1",
  sourceIds: ["qloo:r1", "qloo:r2", "catalog:s1", "catalog:s2"],
  qlooLineageVerified: true, identityVerified: true,
  hardExclusion: false, hardExclusionEvidenceIds: [], reviewFlags: [], confidence: "medium",
};
const sig = (rating, evidenceIds, reasonCode = "test_reason") => ({ rating, evidenceIds, reasonCode });

// Worked examples from the scoring specification section 11.
const worked = [
  [[1, 0.75, 1], 92.307692, 90],
  [[1, 1, 0.25], 40, 40],
  [[0.5, 0.75, 1], 75, 75],
  [[0.75, 0.5, 0.75], 66.666667, 65],
  [[0.75, 0.75, 0.75], 75, 75],
];
for (const [[c, r, g], raw, display] of worked) {
  const out = scoreAssessment({ ...baseInput,
    culturalConnection: sig(c, ["qloo:r1", "qloo:r2"]),
    contentRelevance: sig(r, ["catalog:s1"]), goalFit: sig(g, ["catalog:s1"]) });
  assert.equal(out.status, "eligible");
  assert.ok(Math.abs(out.opportunityScore - raw) < 1e-6, `raw ${raw}`);
  assert.equal(out.displayScore, display);
  assert.equal(out.scorerVersion, SCORING_VERSION);
  assert.equal(out.inputHash, HASH);
}

// Null handling: any null rating withholds the score with the missing reason codes.
for (const which of ["C", "R", "G"]) {
  const input = { ...baseInput,
    culturalConnection: sig(which === "C" ? null : 0.75, which === "C" ? [] : ["qloo:r1"], "c_reason"),
    contentRelevance: sig(which === "R" ? null : 0.75, which === "R" ? [] : ["catalog:s1"], "r_reason"),
    goalFit: sig(which === "G" ? null : 0.75, which === "G" ? [] : ["catalog:s1"], "g_reason") };
  const out = scoreAssessment(input);
  assert.equal(out.status, "insufficient_evidence");
  assert.equal(out.opportunityScore, null);
  assert.equal(out.displayScore, null);
  assert.ok(out.reasonCodes.includes(which === "C" ? "c_reason" : which === "R" ? "r_reason" : "g_reason"));
}

// Admissibility gate: a diagnostic-only C (0.25) must never produce a scored recommendation.
{
  const out = scoreAssessment({ ...baseInput,
    culturalConnection: sig(0.25, ["qloo:r1"]), contentRelevance: sig(1, ["catalog:s1"]), goalFit: sig(1, ["catalog:s1"]) });
  assert.equal(out.status, "insufficient_evidence");
  assert.equal(out.opportunityScore, null);
  assert.ok(out.reasonCodes.includes("cultural_connection_diagnostic_only"));
}

// Exclusion, identity, lineage, conditional.
assert.equal(scoreAssessment({ ...baseInput, hardExclusion: true, hardExclusionEvidenceIds: ["catalog:s2"],
  culturalConnection: sig(0.75, ["qloo:r1"]), contentRelevance: sig(0.75, ["catalog:s1"]), goalFit: sig(0.75, ["catalog:s1"]) }).status, "excluded");
assert.equal(scoreAssessment({ ...baseInput, identityVerified: false,
  culturalConnection: sig(0.75, ["qloo:r1"]), contentRelevance: sig(0.75, ["catalog:s1"]), goalFit: sig(0.75, ["catalog:s1"]) }).status, "insufficient_evidence");
assert.equal(scoreAssessment({ ...baseInput, qlooLineageVerified: false,
  culturalConnection: sig(0.75, ["qloo:r1"]), contentRelevance: sig(0.75, ["catalog:s1"]), goalFit: sig(0.75, ["catalog:s1"]) }).status, "insufficient_evidence");
{
  const out = scoreAssessment({ ...baseInput, reviewFlags: ["material_contradiction"],
    culturalConnection: sig(0.75, ["qloo:r1"]), contentRelevance: sig(0.75, ["catalog:s1"]), goalFit: sig(0.75, ["catalog:s1"]) });
  assert.equal(out.status, "conditional");
  assert.equal(out.opportunityScore, 75);
}

// Input validation.
assert.throws(() => scoreAssessment({ ...baseInput, snapshotHash: "bad" }), /Invalid v4 scoring input/);
assert.throws(() => scoreAssessment({ ...baseInput, objective: "growth" }), /Invalid v4 scoring input/);
assert.throws(() => scoreAssessment({ ...baseInput,
  culturalConnection: sig(0.9, ["qloo:r1"]) }), /Invalid v4 scoring input/);
assert.throws(() => scoreAssessment({ ...baseInput,
  culturalConnection: sig(0.75, ["qloo:unknown"]),
  contentRelevance: sig(0.75, ["catalog:s1"]), goalFit: sig(0.75, ["catalog:s1"]) }), /frozen snapshot sources/);

// Determinism and monotonicity.
const probe = (c, r, g) => scoreAssessment({ ...baseInput,
  culturalConnection: sig(c, ["qloo:r1"]), contentRelevance: sig(r, ["catalog:s1"]), goalFit: sig(g, ["catalog:s1"]) });
assert.deepEqual(probe(0.75, 0.5, 0.75), probe(0.75, 0.5, 0.75));
for (const [c, r, g] of [[0.5, 0.5, 0.5], [0.75, 0.5, 0.5], [0.5, 0.75, 0.5], [0.5, 0.5, 0.75]]) {
  assert.ok(probe(c, r, g).opportunityScore <= probe(1, 1, 1).opportunityScore);
  assert.ok(probe(c, r, g).opportunityScore <= probe(Math.min(1, c + 0.25), r, g).opportunityScore + 1e-9);
}

// ---- Worker-side classification rules -------------------------------------

const sources = [
  { id: "qloo:r1", kind: "qloo_response", freshness: "current" },
  { id: "qloo:r2", kind: "qloo_response", freshness: "current" },
  { id: "catalog:s1", kind: "catalog_item", freshness: "current" },
  { id: "catalog:s2", kind: "catalog_item", freshness: "current" },
  { id: "catalog:s3", kind: "catalog_item", freshness: "current" },
];
const evidence = (overrides = {}) => ({ contractVersion: 2, sample: false, sources,
  claims: [], unknowns: [], bridges: [], partnerActivity: [], capabilities: [], constraints: [], ...overrides });
const bridge = (id, specificity, family, extra = {}) => ({ id, name: `Bridge ${id}`, qlooTagId: `urn:tag:x:${id}`,
  family, specificity, qlooSourceIds: ["qloo:r1", "qloo:r2"], partnerSourceIds: [], explainabilityBacked: false, ...extra });
const activity = (id, centrality, firstParty, extra = {}) => ({ id, summary: `Documented activity ${id}`,
  centrality, firstParty, bridgeIds: ["bridge:1"], sourceIds: ["catalog:s1"], ...extra });
const capability = (key, status, sourceIds = ["catalog:s1"]) =>
  ({ id: `cap:${key}`, name: key, status, sourceIds });

// C rules.
assert.equal(classifySignals(evidence(), "content_collaboration", "brand_brand").culturalConnection.rating, null);
assert.equal(classifySignals(evidence({ contractVersion: 1 }), "content_collaboration", "brand_brand").culturalConnection.reasonCode, "evidence_contract_too_old");
{
  const oneSide = evidence({ bridges: [{ ...bridge("bridge:1", "broad", "genre:music"), qlooSourceIds: ["qloo:r1"] }] });
  assert.equal(classifySignals(oneSide, "content_collaboration", "brand_brand").culturalConnection.rating, null);
  const broad = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "genre:music")] }), "content_collaboration", "brand_brand");
  assert.equal(broad.culturalConnection.rating, 0.5);
  assert.equal(broad.culturalConnection.reasonCode, "broad_tag_bridge");
  const named = classifySignals(evidence({ bridges: [bridge("bridge:1", "named", "genre:music")] }), "content_collaboration", "brand_brand");
  assert.equal(named.culturalConnection.rating, 0.75);
  const twoFamilies = classifySignals(evidence({ bridges: [bridge("bridge:1", "named", "genre:music"), bridge("bridge:2", "named", "artist")] }), "content_collaboration", "brand_brand");
  assert.equal(twoFamilies.culturalConnection.rating, 1);
  const sameFamily = classifySignals(evidence({ bridges: [bridge("bridge:1", "named", "genre:music"), bridge("bridge:2", "named", "genre:music")] }), "content_collaboration", "brand_brand");
  assert.equal(sameFamily.culturalConnection.rating, 0.75);
  const explained = classifySignals(evidence({ bridges: [bridge("bridge:1", "named", "genre:music",
    { explainabilityBacked: true, partnerSourceIds: ["catalog:s1"] })] }), "content_collaboration", "brand_brand");
  assert.equal(explained.culturalConnection.rating, 1);
  // Adding a third valid bridge in an existing family cannot undo two distinct families.
  const extraMusic = classifySignals(evidence({ bridges: [bridge("bridge:1", "named", "genre:music"),
    bridge("bridge:2", "named", "artist"), bridge("bridge:3", "named", "genre:music")] }),
  "content_collaboration", "brand_brand");
  assert.equal(extraMusic.culturalConnection.rating, 1);
  const duplicateProvider = classifySignals(evidence({ bridges: [
    bridge("bridge:1", "named", "genre:music"),
    bridge("bridge:2", "named", "artist", { qlooTagId: "urn:tag:x:bridge:1" })] }),
  "content_collaboration", "brand_brand");
  assert.equal(duplicateProvider.culturalConnection.rating, 0.75);
}

// R rules (brand).
{
  assert.equal(classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")] }), "awareness", "brand_brand").contentRelevance.rating, null);
  const incidental = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "incidental", false)] }), "awareness", "brand_brand");
  assert.equal(incidental.contentRelevance.rating, 0.25);
  const single = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true)] }), "awareness", "brand_brand");
  assert.equal(single.contentRelevance.rating, 0.75);
  const limited = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "substantive", true)] }), "awareness", "brand_brand");
  assert.equal(limited.contentRelevance.rating, 0.5);
  const substantial = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true), activity("a:2", "substantive", true,
      { sourceIds: ["catalog:s2"] })] }), "awareness", "brand_brand");
  assert.equal(substantial.contentRelevance.rating, 0.75);
  const sustained = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true,
      { projectKey: "verified:project-one", projectVerified: true }), activity("a:2", "central", true,
      { sourceIds: ["catalog:s2"], projectKey: "verified:project-two", projectVerified: true }),
      activity("a:3", "substantive", false, { sourceIds: ["catalog:s3"] })] }), "awareness", "brand_brand");
  assert.equal(sustained.contentRelevance.rating, 1);
  const uncertainProjects = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true, { projectKey: "headline-one" }),
      activity("a:2", "central", true, { sourceIds: ["catalog:s2"], projectKey: "headline-two" })] }),
  "awareness", "brand_brand");
  assert.equal(uncertainProjects.contentRelevance.rating, 0.75,
    "distinct titles with uncertain project identity cannot establish sustained projects");
  const contradiction = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true), activity("a:2", "contradictory", false)] }), "awareness", "brand_brand");
  assert.ok(contradiction.reviewFlags.includes("material_contradiction"));
  const duplicateProject = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true), activity("a:2", "central", true),
      activity("a:3", "substantive", false, { sourceIds: ["catalog:s2"] })] }),
  "awareness", "brand_brand");
  assert.notEqual(duplicateProject.contentRelevance.rating, 1,
    "one duplicated official document plus press about the same project is not sustained activity");
  const syndicated = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    sources: sources.map((item) => item.id === "catalog:s1" || item.id === "catalog:s2"
      ? { ...item, contentHash: "same-document" } : item),
    partnerActivity: [activity("a:1", "central", true), activity("a:2", "central", true,
      { sourceIds: ["catalog:s2"] }), activity("a:3", "substantive", false,
      { sourceIds: ["catalog:s3"] })] }), "awareness", "brand_brand");
  assert.notEqual(syndicated.contentRelevance.rating, 1);
  const sameProject = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true, { projectKey: "walk gently" }),
      activity("a:2", "central", true, { sourceIds: ["catalog:s2"], projectKey: "walk gently" })] }),
  "awareness", "brand_brand");
  assert.equal(sameProject.contentRelevance.rating, 0.75);
}

// G rules (content_collaboration requires content_creation_capability).
{
  assert.equal(classifySignals(evidence(), "content_collaboration", "brand_brand").goalFit.rating, null);
  const unsupported = classifySignals(evidence({ capabilities: [capability("content_creation_capability", "unsupported")] }), "content_collaboration", "brand_brand");
  assert.equal(unsupported.goalFit.rating, 0.25);
  const absent = classifySignals(evidence({ capabilities: [capability("content_creation_capability", "unsupported", [])] }), "content_collaboration", "brand_brand");
  assert.equal(absent.goalFit.rating, null);
  assert.equal(absent.goalFit.reasonCode, "capability_evidence_absent");
  const transferable = classifySignals(evidence({ capabilities: [capability("content_creation_capability", "transferable")] }), "content_collaboration", "brand_brand");
  assert.equal(transferable.goalFit.rating, 0.5);
  const direct = classifySignals(evidence({ capabilities: [capability("content_creation_capability", "direct")] }), "content_collaboration", "brand_brand");
  assert.equal(direct.goalFit.rating, 0.75);
  const repeated = classifySignals(evidence({ capabilities: [capability("content_creation_capability", "direct", ["catalog:s1", "catalog:s2"])] }), "content_collaboration", "brand_brand");
  assert.equal(repeated.goalFit.rating, 1);
  const contradicted = classifySignals(evidence({ capabilities: [capability("content_creation_capability", "contradicted")] }), "content_collaboration", "brand_brand");
  assert.equal(contradicted.goalFit.rating, 0);
  // Objective change alters G without touching C/R.
  const product = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    capabilities: [capability("content_creation_capability", "direct")] }), "co_created_product", "brand_brand");
  assert.equal(product.goalFit.rating, null);
  assert.equal(product.culturalConnection.rating, 0.5);
  const partialAudience = classifySignals(evidence({ capabilities: [
    capability("distinct_territory_presence", "direct"),
    capability("activation_channel", "unsupported", [])] }), "new_audience", "brand_brand");
  assert.equal(partialAudience.goalFit.rating, null,
    "both territory participation and activation route are mandatory");
}

assert.throws(() => scoreAssessment({ ...baseInput, hardExclusion: true,
  hardExclusionEvidenceIds: ["outside:snapshot"], culturalConnection: sig(null, [], "missing"),
  contentRelevance: sig(null, [], "missing"), goalFit: sig(null, [], "missing") }),
/frozen snapshot sources/);

// Every objective's mandatory evidence must be present; weak source-backed
// support stays .25, transferable support stays .50.
for (const objective of ["awareness", "new_audience", "repositioning", "co_created_product",
  "content_collaboration", "sponsorship"]) {
  const keys = requiredCapabilities(objective);
  assert.ok(keys.length > 0);
  const complete = keys.map((key) => capability(key, "direct"));
  assert.equal(classifySignals(evidence({ capabilities: complete }), objective, "brand_brand").goalFit.rating, 0.75);
  assert.equal(classifySignals(evidence({ capabilities: complete.slice(0, -1) }), objective, "brand_brand").goalFit.rating, null);
  assert.equal(classifySignals(evidence({ capabilities: keys.map((key) => capability(key, "transferable")) }),
    objective, "brand_brand").goalFit.rating, 0.5);
  assert.equal(classifySignals(evidence({ capabilities: keys.map((key) => capability(key, "unsupported")) }),
    objective, "brand_brand").goalFit.rating, 0.25);
}
for (const kind of ["direct_pair", "discovery"]) {
  for (const pairType of ["brand_brand", "brand_youtube"]) {
    const partner = "partner-1";
    const run = { kind, match_type: pairType,
      constraints_json: { excludedPartnerEntityIds: [partner] }, feedback_snapshot_json: { events: [] } };
    const frozen = evidence({ constraints: assessmentConstraints(run, partner) });
    const exclusion = classifyExclusions(frozen);
    assert.equal(exclusion.hardExclusion, true);
    assert.deepEqual(exclusion.hardExclusionEvidenceIds, []);
    assert.equal(scoreAssessment({ ...baseInput, pairType, hardExclusion: exclusion.hardExclusion,
      hardExclusionEvidenceIds: exclusion.hardExclusionEvidenceIds,
      culturalConnection: sig(null, [], "missing"), contentRelevance: sig(null, [], "missing"),
      goalFit: sig(null, [], "missing") }).status, "excluded");
  }
}
const potential = evidence({ constraints: [{ id: "potential", kind: "verified", blocking: false,
  text: "A campaign requires review.", sourceIds: ["catalog:s1"] }] });
assert.equal(classifyExclusions(potential).hardExclusion, false);
assert.deepEqual(classifyExclusions(potential).reviewFlags, ["potential_conflict"]);
const suspectedScore = scoreAssessment({ ...baseInput, reviewFlags: classifyExclusions(potential).reviewFlags,
  culturalConnection: sig(0.5, ["qloo:r1", "qloo:r2"]),
  contentRelevance: sig(0.75, ["catalog:s1"]), goalFit: sig(0.5, ["catalog:s1"]) });
assert.equal(suspectedScore.status, "conditional");
assert.ok(suspectedScore.opportunityScore !== null,
  "a suspected commercial conflict is review-needed, not an invented hard exclusion");
const verifiedHard = evidence({ constraints: [{ id: "hard", kind: "verified", blocking: true,
  text: "Documented hard conflict.", sourceIds: ["catalog:s1"] }] });
assert.deepEqual(classifyExclusions(verifiedHard).hardExclusionEvidenceIds, ["catalog:s1"]);

// Confidence labels.
{
  const full = evidence({ bridges: [bridge("bridge:1", "named", "genre:music")],
    partnerActivity: [activity("a:1", "central", true), activity("a:2", "central", true,
      { sourceIds: ["catalog:s2"] })],
    capabilities: [capability("content_creation_capability", "direct")] });
  assert.equal(classifySignals(full, "content_collaboration", "brand_brand").confidence, "high");
  const thin = classifySignals(evidence({ bridges: [bridge("bridge:1", "broad", "f")],
    partnerActivity: [activity("a:1", "central", true)],
    capabilities: [capability("content_creation_capability", "direct")] }), "content_collaboration", "brand_brand");
  assert.equal(thin.confidence, "medium");
  const missing = classifySignals(evidence(), "content_collaboration", "brand_brand");
  assert.equal(missing.confidence, "low");
  const flagged = classifySignals(evidence({ bridges: [bridge("bridge:1", "named", "genre:music")],
    partnerActivity: [activity("a:1", "central", true), activity("a:2", "central", true), activity("a:3", "contradictory", false)],
    capabilities: [capability("content_creation_capability", "direct")] }), "content_collaboration", "brand_brand");
  assert.equal(flagged.confidence, "low");
}

console.log("v4 scoring engine: worked examples, gates, null handling, validation, determinism, monotonicity, C/R/G rules and confidence labels all passed.");
