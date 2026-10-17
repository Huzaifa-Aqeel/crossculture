import assert from "node:assert/strict";
import { positioningActivityEvidence } from "../src/personal-brand.mjs";

const supported = [{ sourceId: "catalog:system0", bridgeName: "Technical",
  title: "Arc’teryx introduces System 0 for the future of product design and circularity",
  snippet: "Technical apparel products are designed, repaired, and regenerated." }];
assert.deepEqual(positioningActivityEvidence("circular technical design", supported), ["catalog:system0"]);
assert.deepEqual(positioningActivityEvidence("Caribbean jazz heritage", supported), []);
assert.deepEqual(positioningActivityEvidence("technical drone filmmaking", supported), []);
assert.deepEqual(positioningActivityEvidence("sustainability", supported), []);
assert.deepEqual(positioningActivityEvidence("Caribbean jazz heritage", [
  { ...supported[0], snippet: "Related stories: Caribbean jazz heritage." },
]), [], "unrelated excerpt keywords cannot establish the requested association");
assert.deepEqual(positioningActivityEvidence("circular technical design", [
  { ...supported[0], title: "Arc’teryx technical apparel", snippet: supported[0].title },
]), [], "a generic title and unrelated excerpt are insufficient");
assert.deepEqual(positioningActivityEvidence("circular technical design", [
  { ...supported[0], sourceId: null },
]), []);
console.log("Brand repositioning direction evidence checks passed.");
