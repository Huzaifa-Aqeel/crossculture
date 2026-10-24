import assert from "node:assert/strict";
import { brandObjectives, projectObjectives, validateNewRunObjective } from "../src/new-run-objectives.mjs";

assert.deepEqual([...brandObjectives], ["product_bundle", "cross_sell"]);
assert.deepEqual([...projectObjectives], ["product_bundle", "cross_sell"]);
for (const objective of brandObjectives) assert.equal(validateNewRunObjective(objective, "brand"), null);
for (const objective of ["content_collaboration", "sponsorship", "co_created_product", "repositioning"])
  assert.throws(() => validateNewRunObjective(objective, "brand"), /not available/);
assert.throws(() => validateNewRunObjective("product_bundle", "creator"), /not available/);
console.log("Only brand commerce objectives are available for new runs.");
