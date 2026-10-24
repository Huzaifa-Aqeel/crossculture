// Bounded SAMPLE-only provider check; no Catalog content or customer data.
import assert from "node:assert/strict";
import { verifyCommerceMechanismRubric } from "../src/commerce-mechanism.mjs";

const specific = { proposal: { kind: "occasion_complement", seedRole: "towel",
  partnerRole: "bath mat", occasion: "bathroom essentials",
  benefit: "The towel dries after bathing while the bath mat provides a floor surface.",
  partnerSpecificFact: "" },
seedFacts: ["Cotton bath towel for drying after bathing"],
partnerFacts: ["Absorbent bath mat for the bathroom floor"],
seedSelectedItem: { title: "Cotton bath towel", description: "Cotton bath towel for drying after bathing" },
partnerSelectedItem: { title: "Absorbent bath mat", description: "Absorbent bath mat for the bathroom floor" } };
const generic = { proposal: { kind: "occasion_complement", seedRole: "socks",
  partnerRole: "coffee", occasion: "morning routine",
  benefit: "The socks warm feet while the coffee makes a morning drink.",
  partnerSpecificFact: "" },
seedFacts: ["Wool socks"], partnerFacts: ["Coffee beans"],
seedSelectedItem: { title: "Wool socks" }, partnerSelectedItem: { title: "Coffee beans" } };
const misattributed = { proposal: { kind: "occasion_complement", seedRole: "bag for yoga",
  partnerRole: "leggings for yoga", occasion: "yoga class",
  benefit: "A bag carries yoga supplies while leggings are worn for yoga class.",
  partnerSpecificFact: "" },
seedFacts: ["BAGGU makes bags and accessories for playful everyday living."],
partnerFacts: ["Organic cotton spandex blend supports you while you move."],
seedSelectedItem: { title: "Hold Everything: 15 Years of BAGGU",
  description: "A comprehensive visual archive of the textile patterns, materials and products produced in the first fifteen years of BAGGU. A 680-page book." },
partnerSelectedItem: { title: "Astral Capri Leggings",
  description: "Organic cotton spandex blend supports you while you move." } };
const coWear = { proposal: { kind: "occasion_complement", seedRole: "socks worn outdoors",
  partnerRole: "jeans worn outdoors", occasion: "walk through town",
  benefit: "The socks worn outdoors and jeans worn outdoors can be worn on a walk through town.",
  partnerSpecificFact: "" },
seedFacts: ["No-show socks for everyday wear"], partnerFacts: ["Denim jeans for everyday wear"],
seedSelectedItem: { title: "No-show socks", description: "No-show socks for everyday wear" },
partnerSelectedItem: { title: "Denim jeans", description: "Denim jeans for everyday wear" } };
const styledCoWear = { proposal: { kind: "occasion_complement",
  seedRole: "no-show sock", partnerRole: "high-rise jean", occasion: "polished outfit",
  benefit: "The high-rise jean holds the waist while the no-show sock stays invisible for a polished silhouette.",
  partnerSpecificFact: "" },
seedFacts: ["No-show sock stays invisible in shoes"],
partnerFacts: ["High-rise jean holds you in at the waist"],
seedSelectedItem: { title: "No-show sock", description: "No-show sock stays invisible in shoes" },
partnerSelectedItem: { title: "High-rise jean", description: "High-rise jean holds you in at the waist" } };
const bundle = (item) => verifyCommerceMechanismRubric({ ...item, objective: "product_bundle" });
const first = await bundle(specific);
const repeat = await bundle(specific);
const weak = await bundle(generic);
const wrongItem = await bundle(misattributed);
const ordinary = await bundle(coWear);
const styled = await bundle(styledCoWear);
assert.deepEqual(repeat, first, "Repeated sample rubric classifications changed.");
assert.equal(first.jointUseCoherent, true);
assert.equal(first.incrementalBenefit, true);
assert.equal(first.reason, "specific_joint_use");
assert.equal(weak.jointUseCoherent, false);
assert.equal(ordinary.genericCoUseOnly, true);
assert.equal(ordinary.incrementalBenefit, false);
assert.equal(styled.incrementalBenefit, false);
assert.equal(styled.genericCoUseOnly, true);
assert.equal(wrongItem.seedRoleGroundedInSelectedItem, false);
assert.equal(wrongItem.jointUseCoherent, false);
const crossSellAddedNeed = await verifyCommerceMechanismRubric({
  objective: "cross_sell",
  proposal: { kind: "assortment_complement", seedRole: "brewing cone",
    partnerRole: "insulated flask", occasion: "commuting after brewing",
    benefit: "The brewing cone prepares filter coffee, and the insulated flask keeps the prepared drink hot during a commute.",
    partnerSpecificFact: "" },
  seedFacts: ["Ceramic brewing cone prepares filter coffee"],
  partnerFacts: ["Insulated flask keeps prepared drinks hot during travel"],
  seedSelectedItem: { title: "Ceramic brewing cone",
    description: "Ceramic brewing cone prepares filter coffee" },
  partnerSelectedItem: { title: "Insulated flask",
    description: "Insulated flask keeps prepared drinks hot during travel" },
});
const crossSellDuplicate = await verifyCommerceMechanismRubric({
  objective: "cross_sell",
  proposal: { kind: "assortment_complement", seedRole: "water bottle",
    partnerRole: "second water bottle", occasion: "commuting",
    benefit: "The water bottle carries water, while the second water bottle also carries water on a commute.",
    partnerSpecificFact: "" },
  seedFacts: ["Reusable water bottle carries water"],
  partnerFacts: ["Reusable water bottle carries water"],
  seedSelectedItem: { title: "Reusable water bottle", description: "Reusable water bottle carries water" },
  partnerSelectedItem: { title: "Another reusable water bottle",
    description: "Reusable water bottle carries water" },
});
assert.equal(crossSellAddedNeed.incrementalBenefit, true);
assert.equal(crossSellAddedNeed.jointUseCoherent, true);
assert.equal(crossSellDuplicate.incrementalBenefit, false);
console.log("SAMPLE commerce rubric: selected-item grounding, specific positive, generic negative and repeatability passed.");
