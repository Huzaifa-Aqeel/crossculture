import assert from "node:assert/strict";
import { brandObjectives, creatorObjectives, projectObjectives, validateNewRunObjective } from "../src/new-run-objectives.mjs";

assert.deepEqual([...brandObjectives], ["co_created_product", "content_collaboration", "repositioning"]);
assert.deepEqual([...creatorObjectives], ["content_collaboration", "sponsorship"]);
assert.deepEqual([...projectObjectives], ["co_created_product", "content_collaboration", "repositioning", "sponsorship"]);
for (const objective of brandObjectives) {
  if (objective === "repositioning") {
    assert.equal(validateNewRunObjective(objective, "brand", "  Contemporary craft  "), "Contemporary craft");
    for (const direction of [undefined, " ", "x".repeat(241)]) {
      assert.throws(() => validateNewRunObjective(objective, "brand", direction), /positioning direction/);
    }
  } else assert.equal(validateNewRunObjective(objective, "brand"), null);
}
for (const objective of creatorObjectives) assert.equal(validateNewRunObjective(objective, "creator"), null);
for (const objective of ["awareness", "new_audience"]) {
  for (const partnerType of ["brand", "creator"]) assert.throws(() => validateNewRunObjective(objective, partnerType), /not available/);
}
for (const objective of ["co_created_product", "repositioning"]) assert.throws(() => validateNewRunObjective(objective, "creator", "Test"), /not available/);
assert.throws(() => validateNewRunObjective("sponsorship", "brand"), /not available/);
console.log("New-run objective and positioning-direction boundary checks passed.");
