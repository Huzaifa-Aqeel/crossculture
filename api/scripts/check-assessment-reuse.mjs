import assert from "node:assert/strict";
import { assessmentNeedsAppend } from "../src/assessment-reuse.mjs";

const current = { version: 3, input_hash: "a", scoring_version: "4.0.1", validity_status: "valid" };
const historical = { version: 1, input_hash: "a", scoring_version: "4.0.0", validity_status: "valid" };
assert.equal(assessmentNeedsAppend([], "a", "4.0.1"), true);
assert.equal(assessmentNeedsAppend([current, historical], "a", "4.0.1"), false);
assert.equal(assessmentNeedsAppend([{ ...current, scoring_version: "4.0.0" }], "a", "4.0.1"), true);
assert.equal(assessmentNeedsAppend([{ ...current, validity_status: "stale" }], "a", "4.0.1"), true);
assert.equal(assessmentNeedsAppend([{ ...current, validity_status: "redacted" }], "a", "4.0.1"), true);
assert.equal(assessmentNeedsAppend([{ ...current, input_hash: "b" }, historical], "a", "4.0.1"), true,
  "an older matching snapshot cannot satisfy a replay after the latest evidence changed");
console.log("Assessment reuse checks passed: latest valid hash and scorer version are required; older snapshots remain historical.");
