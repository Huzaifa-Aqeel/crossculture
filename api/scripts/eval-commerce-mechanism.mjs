// Labelled product-mechanism evaluation. Runs the app's own mechanism review
// (evaluateCommerceMechanism) on hand-written synthetic pairs, several times
// each, and reports how often good pairs pass, how often bad pairs pass, and
// how often repeats agree. It calls only the configured LLM provider.
//
//   node --env-file=../.env.local scripts/eval-commerce-mechanism.mjs --split dev --repeats 3 --label baseline
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { evaluateCommerceMechanism } from "../src/commerce-mechanism.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) =>
  value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]?.startsWith("--") ? "1" : all[index + 1] ?? "1"]] : pairs, []));
const split = args.split ?? "dev";
const repeats = Number(args.repeats ?? 3);
const concurrency = Number(args.concurrency ?? 6);
const label = String(args.label ?? "run").replace(/[^a-z0-9-]/gi, "");
const only = args.only ? new Set(args.only.split(",")) : null;
const fixture = JSON.parse(await readFile(new URL("../fixtures/commerce-mechanism-eval-v1.json", import.meta.url)));
const cases = fixture.cases.filter((item) => (split === "all" || item.split === split) &&
  (!only || only.has(item.id)));
if (!cases.length) throw new Error("No cases selected.");

const product = (item) => ({ title: item.title, description: { plain: item.description } });
// The stage that stopped a pair, for diagnosis only.
function failure(result, trace) {
  const { proposal, rubric, facts, mechanism, issues } = result;
  const error = trace.find((step) => step.stage.endsWith("_error"));
  if (error) return `${error.stage}_${error.error}`;
  if (issues.includes("mechanism_research_unavailable")) return "proposal_unavailable";
  if (!proposal) return "proposal_unavailable";
  if (["unproven", "duplicate_or_substitute"].includes(proposal.kind)) return `proposal_${proposal.kind}`;
  if (result.mechanism.mechanism === "unproven" && !result.mechanism.validationChecks) return `proposal_kind_not_allowed_${proposal.kind}`;
  if (!facts.seedFacts.length || !facts.partnerFacts.length) return "quotes_not_found";
  if (issues.includes("mechanism_rubric_unavailable") || !rubric) return "rubric_unavailable";
  const rejected = trace.find((step) =>
    (step.stage === "rubric" && (!step.jointUseCoherent || !step.incrementalBenefit || step.genericCoUseOnly ||
      !step.seedRoleGroundedInSelectedItem || !step.partnerRoleGroundedInSelectedItem)) ||
    (step.stage === "bundle_challenge" && (!step.complementaryTask || step.parallelBenefitsOnly || !step.benefitBeyondSeparateUses)) ||
    (step.stage === "bundle_counterfactual" && (!step.specificMultiPartUse || !step.distinctNeededContributions || step.parallelAmbienceOnly)) ||
    (step.stage === "cross_sell_challenge" && (!step.additionalCustomerNeed || step.substituteOnly || step.unsupportedMaterialClaim)) ||
    (step.stage === "judgment" && !step.passed));
  if (rejected) return rejected.stage === "rubric" ? `rubric_${rubric.reason}` : rejected.stage;
  const checks = mechanism.validationChecks ?? {};
  if (checks.compatibilityEvidenceRequired) return "rule_compatibility_words";
  if (checks.compatibilityClaimed && !checks.compatibilityConfirmed) return "rule_fit_claim_unconfirmed";
  if (!checks.distinctRoles) return "rule_roles_not_distinct";
  if (!checks.namedContext && !checks.assortmentContribution) return "rule_no_named_occasion";
  if (!checks.benefitHasSubstance) return "rule_benefit_too_short";
  return `rule_other_${mechanism.reasonCodes.filter((code) => /unverified|rubric_/.test(code)).join("+")}`;
}

const tasks = cases.flatMap((item) => Array.from({ length: repeats }, (_, repeat) => ({ item, repeat })));
const outcomes = [];
let next = 0;
const started = Date.now();
async function worker() {
  while (next < tasks.length) {
    const { item, repeat } = tasks[next++];
    const trace = [];
    let result;
    try {
      result = await evaluateCommerceMechanism({ seedProduct: product(item.seed),
        partnerProduct: product(item.partner), objective: item.objective, trace });
    } catch (error) {
      outcomes.push({ id: item.id, repeat, passed: false, stop: `error_${error?.name ?? "unknown"}` });
      continue;
    }
    const m = result.mechanism;
    const passed = m.attributeEvidence === "supported" && m.jointUseCoherence === "supported" &&
      m.incrementalValue === "supported";
    outcomes.push({ id: item.id, repeat, passed, stop: passed ? null : failure(result, trace),
      kind: result.proposal?.kind ?? null });
    if (outcomes.length % 20 === 0) process.stderr.write(`${outcomes.length}/${tasks.length}\n`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

const byCase = cases.map((item) => {
  const runs = outcomes.filter((outcome) => outcome.id === item.id);
  const passes = runs.filter((outcome) => outcome.passed).length;
  return { id: item.id, objective: item.objective, category: item.category, label: item.label,
    title: `${item.seed.title} + ${item.partner.title}`, passes, runs: runs.length,
    majorityPassed: passes * 2 > runs.length, stable: passes === 0 || passes === runs.length,
    stops: [...new Set(runs.map((outcome) => outcome.stop).filter(Boolean))] };
});
const rate = (rows, pick) => {
  const runs = rows.reduce((total, row) => total + row.runs, 0);
  return runs ? Number((rows.reduce((total, row) => total + pick(row), 0) / runs).toFixed(3)) : null;
};
const summarize = (rows) => {
  const good = rows.filter((row) => row.label === "good");
  const bad = rows.filter((row) => row.label === "bad");
  return { goodCases: good.length, badCases: bad.length,
    goodPassRate: rate(good, (row) => row.passes),
    badPassRate: rate(bad, (row) => row.passes),
    goodMajorityPassed: good.filter((row) => row.majorityPassed).length,
    badMajorityPassed: bad.filter((row) => row.majorityPassed).length,
    stableCases: rows.filter((row) => row.stable).length, cases: rows.length };
};
const summary = { label, split, repeats, provider: process.env.LLM_PROVIDER ?? null,
  model: process.env.BEDROCK_MODEL_ID ?? null, seconds: Math.round((Date.now() - started) / 1000),
  overall: summarize(byCase),
  product_bundle: summarize(byCase.filter((row) => row.objective === "product_bundle")),
  cross_sell: summarize(byCase.filter((row) => row.objective === "cross_sell")) };
await mkdir(new URL("../reports/mechanism-eval/", import.meta.url), { recursive: true });
await writeFile(new URL(`../reports/mechanism-eval/${label}-${split}.json`, import.meta.url),
  JSON.stringify({ summary, cases: byCase }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
for (const row of byCase) {
  const wrong = row.label === "good" ? !row.majorityPassed : row.majorityPassed;
  console.log(`${wrong ? "WRONG" : "ok   "} ${row.id.padEnd(9)} ${row.label.padEnd(4)} ${row.passes}/${row.runs} ${row.title.slice(0, 58).padEnd(58)} ${row.stops.join(", ")}`);
}
