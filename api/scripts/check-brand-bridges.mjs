import assert from "node:assert/strict";
import { buildBridges } from "../src/personal-brand.mjs";

const tags = [
  { id: "cost", name: "Inexpensive", type: "urn:tag:cost_description:place" },
  { id: "card", name: "Discover", type: "urn:tag:credit_card:place" },
  { id: "generic", name: "Tourist attraction", type: "urn:tag:genre:place" },
  { id: "folk", name: "folk", type: "urn:tag:genre:music" },
];
const bridges = buildBridges({ responseId: "source-1", tags }, { responseId: "source-2", tags });
assert.deepEqual(bridges.map((item) => item.name), ["folk"]);
assert.deepEqual(bridges[0].qlooSourceIds, ["qloo:source-1", "qloo:source-2"]);
assert.deepEqual(buildBridges({ responseId: null, tags }, { responseId: "source-2", tags }), []);
console.log("Brand bridges omit generic/commercial metadata tags and retain two-sided Qloo lineage.");
