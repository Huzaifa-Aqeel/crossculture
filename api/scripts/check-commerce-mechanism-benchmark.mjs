// Pair-level benchmark only. Unknown mechanism evidence is an abstention,
// never a negative prediction. Native and focused observations stay separate.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const version = process.argv.includes("--v1") ? 1 : 2;
const path = new URL(`../fixtures/commerce-mechanism-benchmark-v${version}.json`, import.meta.url);
const fixture = JSON.parse(await readFile(path, "utf8"));
const categories = ["outdoor_technical", "home_kitchen", "apparel_lifestyle", "cpg_personal_care"];
const labels = ["good", "bad"];
const verdicts = ["supported", "needs_verification", "unsupported"];
const mechanismStates = ["supported", "unknown", "contradicted"];
function mechanismState(item) {
  if (version === 2) return item.observation.mechanismState;
  // V1 is a historical fixture whose false boolean meant only "did not pass".
  return item.observation.mechanismPass === true ? "supported"
    : item.observation.mechanismPass === false ? "unknown" : null;
}
assert.equal(fixture.version, version);
assert.equal(fixture.cases.length, categories.length * labels.length * version);
assert.equal(new Set(fixture.cases.map((item) => item.id)).size, fixture.cases.length);

for (const category of categories) {
  const cases = fixture.cases.filter((item) => item.category === category);
  assert.equal(cases.length, 2 * version, `${category} has the wrong case count`);
  const objectives = version === 2 ? ["product_bundle", "cross_sell"] : [null];
  for (const objective of objectives) {
    const cell = objective ? cases.filter((item) => item.objective === objective) : cases;
    assert.deepEqual(cell.map((item) => item.reviewerA?.label).sort(), ["bad", "good"],
      `${category}/${objective ?? "all"} must have one good and one bad case`);
  }
}
for (const item of fixture.cases) {
  assert.ok(["product_bundle", "cross_sell"].includes(item.objective));
  for (const product of [item.seed, item.partner]) {
    const url = new URL(product.url);
    assert.equal(url.protocol, "https:");
    assert.ok(product.brand && product.product);
  }
  assert.ok(item.reviewerA?.reason?.length >= 30);
  for (const review of [item.humanReviewA, item.humanReviewB]) if (review) {
    assert.ok(labels.includes(review.label) || review.uncertain === true && review.label === null);
    assert.ok(review.reason?.length >= 30);
    if (review.evidenceSufficiency !== undefined) assert.ok(
      ["sufficient", "insufficient", "unclear"].includes(review.evidenceSufficiency));
    if (review.exactVariantVerified !== undefined) assert.equal(typeof review.exactVariantVerified,
      "boolean");
  }
  if (item.adjudicatedLabel) assert.ok(labels.includes(item.adjudicatedLabel));
  assert.ok(["live_app", "focused_pair_replay", "planned_exact_replay",
    "exact_pair_unavailable"].includes(item.observation.kind));
  if (item.observation.verdict !== null) assert.ok(verdicts.includes(item.observation.verdict));
  if (["planned_exact_replay", "exact_pair_unavailable"].includes(item.observation.kind)) {
    assert.equal(item.observation.verdict, null);
    assert.equal(item.observation.mechanismPass, null);
    if (version === 2) assert.equal(mechanismState(item), null);
    assert.ok(item.search?.seedQuery?.length >= 3 && item.search?.partnerQuery?.length >= 3);
  } else if (version === 2) {
    assert.ok(mechanismStates.includes(mechanismState(item)), `${item.id} needs a mechanism state`);
    assert.equal(item.observation.mechanismPass,
      mechanismState(item) === "unknown" ? null : mechanismState(item) === "supported",
      `${item.id} legacy pass flag conflicts with its evidence state`);
  } else assert.equal(typeof item.observation.mechanismPass, "boolean");
  if (item.adjudicatedLabel) assert.ok(labels.includes(item.humanReviewA?.label) &&
    labels.includes(item.humanReviewB?.label),
    `${item.id} cannot be adjudicated before two independent human reviews`);
  if (labels.includes(item.humanReviewA?.label) && labels.includes(item.humanReviewB?.label) &&
      item.humanReviewA.label !== item.humanReviewB.label) {
    assert.ok(item.adjudicationNotes?.length >= 30,
      `${item.id} needs a written disagreement resolution`);
  }
}

if (process.argv.includes("--review-sheet")) {
  console.log(JSON.stringify({ instructions: "Give a separate blank copy to each of two independent human reviewers. For each exact pair and objective, record whether the available product evidence is sufficient and whether an exact variant can be identified. Then label the product mechanism good or bad only if supported by that evidence; otherwise mark uncertain and explain the missing facts. Good does not mean the brands have an agreement, a shared checkout, or verified cultural fit. Bad includes generic co-use, styling, gifting, or duplicate function without a specific benefit. Do not view app results, provisional labels, or the other review before submitting.",
    cases: fixture.cases.map((item) => ({ id: item.id, category: item.category,
      objective: item.objective, seed: item.seed, partner: item.partner,
      evidenceSufficiency: null, exactVariantVerified: null,
      label: null, reason: "", uncertain: false })) }, null, 2));
  process.exit(0);
}

const humanReviewedA = fixture.cases.filter((item) => item.humanReviewA).length;
const humanReviewedB = fixture.cases.filter((item) => item.humanReviewB).length;
const adjudicated = fixture.cases.filter((item) => item.adjudicatedLabel).length;
const observed = fixture.cases.filter((item) => mechanismStates.includes(mechanismState(item)));
const reviewed = humanReviewedA === fixture.cases.length &&
  humanReviewedB === fixture.cases.length && adjudicated === fixture.cases.length;
function coverage(items) {
  return Object.fromEntries(["live_app", "focused_pair_replay", "planned_exact_replay",
    "exact_pair_unavailable"].map((kind) => {
    const group = items.filter((item) => item.observation.kind === kind);
    return [kind, { total: group.length,
      supported: group.filter((item) => mechanismState(item) === "supported").length,
      contradicted: group.filter((item) => mechanismState(item) === "contradicted").length,
      unknown: group.filter((item) => mechanismState(item) === "unknown").length,
      unavailable: group.filter((item) => mechanismState(item) === null).length }];
  }));
}
const output = { task: "product_mechanism_only", version, balancedByCategoryObjectiveAndLabel:
  version === 2, cases: fixture.cases.length,
  categoryCounts: Object.fromEntries(categories.map((category) => [category,
    Object.fromEntries(labels.map((label) => [label, fixture.cases.filter((item) =>
      item.category === category && item.reviewerA.label === label).length]))])),
  objectiveCounts: Object.fromEntries(["product_bundle", "cross_sell"].map((objective) =>
    [objective, fixture.cases.filter((item) => item.objective === objective).length])),
  humanReviewedA, humanReviewedB, adjudicated,
  assessedPairs: observed.length,
  directionalPredictions: observed.filter((item) => mechanismState(item) !== "unknown").length,
  observationCoverageByMode: coverage(fixture.cases),
  readyForAdjudicatedModeMetrics: reviewed,
  headlineAccuracyAppropriate: false };

if (reviewed || process.argv.includes("--exploratory")) {
  // Provisional comparisons are diagnostics, not ground truth. A missing or
  // unknown result never becomes a false negative or true negative.
  const labelOf = reviewed ? (item) => item.adjudicatedLabel : (item) => item.reviewerA.label;
  output[reviewed ? "adjudicatedByMode" : "provisionalOnlyByMode"] = Object.fromEntries(
    ["live_app", "focused_pair_replay"].map((kind) => {
      const cases = fixture.cases.filter((item) => item.observation.kind === kind);
      const counts = { supportedGood: 0, supportedBad: 0, contradictedGood: 0,
        contradictedBad: 0, unknownGood: 0, unknownBad: 0, unavailable: 0 };
      for (const item of cases) {
        const state = mechanismState(item);
        if (!state) counts.unavailable += 1;
        else counts[`${state}${labelOf(item) === "good" ? "Good" : "Bad"}`] += 1;
      }
      const decided = counts.supportedGood + counts.supportedBad +
        counts.contradictedGood + counts.contradictedBad;
      return [kind, { cases: cases.length, counts,
        directionalCoverage: cases.length ? decided / cases.length : null,
        ...(reviewed ? { supportedPrecision: counts.supportedGood + counts.supportedBad
          ? counts.supportedGood / (counts.supportedGood + counts.supportedBad) : null,
        directionalAccuracy: decided
          ? (counts.supportedGood + counts.contradictedBad) / decided : null } : {}) }];
    }));
}
console.log(JSON.stringify(output, null, 2));
