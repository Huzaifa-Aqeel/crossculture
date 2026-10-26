// Feedback effects, review sampling, reviewer access and queue merging.
// Offline: no database or provider call.
import assert from "node:assert/strict";
import { feedbackEffects, reviewSamplesFromRun, isAdmin, mergeQueue } from "../src/review-queue.mjs";
import { memoryRowsFromRun, productPairKeyFor } from "../src/research-memory.mjs";

const key = (letter) => letter.repeat(64);
// Latest feedback per opportunity. Passed product pairs are skipped for any
// brand and any variant; partner reasons and liked partners apply to the same
// starting brand, in any project (a later search starts a new project).
const ref = (seed, partner, variant = "v1") => ({ seed: { productId: seed, variantId: variant, sellerId: "s" },
  partner: { productId: partner, variantId: variant, sellerId: "t" } });
const event = (action, reasonCode, seedEntityId, references, partnerQlooId) =>
  ({ action, reasonCode, seedEntityId, objective: "product_bundle", references, partnerQlooId });
const effects = feedbackEffects([
  event("reject", "products_dont_fit", "brandA", ref("blanket", "duffle"), "q1"),
  event("reject", "already_working", "brandA", ref("blanket", "sling"), "q2"),
  event("reject", "not_right_for_brand", "brandB", ref("pan", "bowl"), "q3"),
  event("reject", null, "brandA", ref("blanket", "kit"), "q4"),
  event("save", null, "brandA", ref("blanket", "mug"), "q5"),
  event("save", null, "brandA", ref("blanket", "bottle"), "q2"),
  event("save", null, "brandB", ref("pan", "board"), "q6"),
  event("reject", "products_dont_fit", "brandA", null, "q7"),
], "brandA");
assert.deepEqual(effects.rejectedPairKeys, [ref("blanket", "duffle"), ref("blanket", "sling"), ref("pan", "bowl"),
  ref("blanket", "kit")].map((references) => productPairKeyFor("product_bundle", references)));
assert.ok(effects.rejectedPairKeys.includes(productPairKeyFor("product_bundle", ref("blanket", "duffle", "camel"))),
  "Another colour of the same two products is still the same pair");
assert.deepEqual(effects.excludedPartnerQlooIds, ["q2"], "Partner reasons apply to the same starting brand");
assert.deepEqual(effects.preferredPartnerQlooIds, ["q5"], "Liked partners for this brand; an excluded partner is never preferred");
assert.deepEqual(feedbackEffects(null, "brandA"),
  { rejectedPairKeys: [], excludedPartnerQlooIds: [], preferredPartnerQlooIds: [] });

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

assert.equal(isAdmin({ app_metadata: { role: "admin" } }), true);
assert.equal(isAdmin({ app_metadata: {}, user_metadata: { role: "admin" } }), false,
  "A role users can set on themselves (user_metadata) never grants access");
assert.equal(isAdmin(null), false);

// One item per pair and objective, the most interesting source first.
const merged = mergeQueue([
  { source: "supported_sample", opportunityKey: key("a"), objective: "product_bundle" },
  { source: "user_flag", opportunityKey: key("a"), objective: "product_bundle" },
  { source: "rejected_sample", opportunityKey: key("b"), objective: "product_bundle" },
  { source: "supported_sample", opportunityKey: key("b"), objective: "cross_sell" },
]);
assert.deepEqual(merged.map((item) => `${item.source}:${item.opportunityKey[0]}:${item.objective}`),
  ["user_flag:a:product_bundle", "rejected_sample:b:product_bundle", "supported_sample:b:cross_sell"]);
console.log("Review queue checks passed: feedback effects, sampling, admin access and merging.");
