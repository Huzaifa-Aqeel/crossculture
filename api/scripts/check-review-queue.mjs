// Feedback effects, review sampling, reviewer access and queue merging.
// Offline: no database or provider call.
import assert from "node:assert/strict";
import { feedbackEffects, reviewSamplesFromRun, isReviewer, mergeQueue } from "../src/review-queue.mjs";
import { memoryRowsFromRun } from "../src/research-memory.mjs";

const key = (letter) => letter.repeat(64);
// Latest feedback per opportunity: passed pairs are skipped everywhere; a
// partner reason excludes the partner only in its own project.
const effects = feedbackEffects([
  { action: "reject", reasonCode: "products_dont_fit", projectId: "p1", opportunityKey: key("a"), partnerQlooId: "q1" },
  { action: "reject", reasonCode: "already_working", projectId: "p1", opportunityKey: key("b"), partnerQlooId: "q2" },
  { action: "reject", reasonCode: "not_right_for_brand", projectId: "p2", opportunityKey: key("c"), partnerQlooId: "q3" },
  { action: "reject", reasonCode: null, projectId: "p1", opportunityKey: key("d"), partnerQlooId: "q4" },
  { action: "save", reasonCode: null, projectId: "p1", opportunityKey: key("e"), partnerQlooId: "q5" },
], "p1");
assert.deepEqual(effects.rejectedOpportunityKeys, [key("a"), key("b"), key("c"), key("d")]);
assert.deepEqual(effects.excludedPartnerQlooIds, ["q2"], "Partner reasons apply within the same project only");
assert.deepEqual(feedbackEffects(null, "p1"), { rejectedOpportunityKeys: [], excludedPartnerQlooIds: [] });

// Review samples: judged, not recommended, not already shown; at most two;
// identifiers only.
const refs = (n) => ({ seed: { productId: `sp${n}`, variantId: `sv${n}`, sellerId: "s", storefrontDomain: "seed.example.com", title: "never kept" },
  partner: { productId: `pp${n}`, variantId: `pv${n}`, sellerId: "t", storefrontDomain: "partner.example.com" } });
const pair = (letter, status, judge = "m#aaaaaaaaaaaa") => ({ opportunityKey: key(letter), status, judge,
  mechanismState: "unknown", reasonCodes: ["product_mechanism_unknown"], references: refs(letter) });
const candidates = [{ qlooId: "q", memory: { pairs: [pair("a", "unsupported"), pair("b", "supported"),
  pair("c", "needs_verification"), pair("d", "unsupported", null), pair("e", "needs_verification"),
  pair("f", "unsupported")] } }];
const samples = reviewSamplesFromRun({ runId: "r", objective: "product_bundle", market: "US", candidates,
  shownKeys: [key("e")] }, () => 0);
assert.deepEqual(samples.map((item) => item.opportunityKey), [key("a"), key("c")]);
assert.equal(samples[0].references.seed.title, undefined, "Only identifiers are kept");
assert.equal(samples[0].references.partner.productId, "ppa");
assert.deepEqual(reviewSamplesFromRun({ runId: "r", objective: "product_bundle", market: "US", candidates: [] }), []);

// Memory rows never carry product identifiers.
const rows = memoryRowsFromRun({ objective: "product_bundle", market: "US", candidates: [{ ...candidates[0],
  status: "product_researched", memory: { ...candidates[0].memory, heroCategory: "hg-12-2-5" } }] });
assert.ok(rows[0].pairs.every((item) => !("references" in item)));

assert.equal(isReviewer("Owner@Example.com", "owner@example.com, other@example.com"), true);
assert.equal(isReviewer("someone@example.com", "owner@example.com"), false);
assert.equal(isReviewer("owner@example.com", ""), false);
assert.equal(isReviewer(null, "owner@example.com"), false);

// One item per pair and objective, the most interesting source first.
const merged = mergeQueue([
  { source: "supported_sample", opportunityKey: key("a"), objective: "product_bundle" },
  { source: "user_flag", opportunityKey: key("a"), objective: "product_bundle" },
  { source: "rejected_sample", opportunityKey: key("b"), objective: "product_bundle" },
  { source: "supported_sample", opportunityKey: key("b"), objective: "cross_sell" },
]);
assert.deepEqual(merged.map((item) => `${item.source}:${item.opportunityKey[0]}:${item.objective}`),
  ["user_flag:a:product_bundle", "rejected_sample:b:product_bundle", "supported_sample:b:cross_sell"]);
console.log("Review queue checks passed: feedback effects, sampling, reviewer access and merging.");
