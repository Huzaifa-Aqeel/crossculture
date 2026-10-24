// SAMPLE-only semantic concept check. No merchant payload or user data.
import assert from "node:assert/strict";
import { verifyCommerceConcepts } from "../src/commerce-concepts.mjs";

const evidence = { objective: "cross_sell",
  seed: { name: "First brand", product: "Rain jacket" },
  partner: { name: "Second brand", product: "Canvas sling bag" },
  culturalRelationship: "native_recommendation_verified",
  productReason: "The rain jacket provides weather protection while the sling carries small essentials.",
  productRoles: { seedRole: "weather-protective layer", partnerRole: "small essentials carrier" },
  openQuestions: [], dealUnknowns: ["Campaign rights need confirmation."],
  thirdPartyCoBrandOnSelectedOffer: false };
const invalid = ["Rainproof Jacket and Bag Set", "Adventure Care Kit", "Guaranteed Dry Commute"]
  .map((title, index) => ({ title, format: ["Bundle", "Display", "Guide"][index],
    summary: `The rain jacket and canvas sling bag keep both products dry in rain. ${title}`,
    roles: { seed: "First brand supplies Rain jacket.",
      partner: "Second brand supplies Canvas sling bag." },
    validation: "Confirm partner rights and fulfillment.",
    evidenceRefs: ["seed_product", "partner_product"] }));
assert.equal(await verifyCommerceConcepts(invalid, evidence), false);
console.log("SAMPLE concept verifier rejected unsupported title and bag rain-protection claims.");
