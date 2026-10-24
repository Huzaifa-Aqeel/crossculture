import { readFile } from "node:fs/promises";
import { creatorReviewMetrics } from "../src/youtube-evaluation.mjs";

const path = process.argv[2];
if (!path) {
  process.stderr.write("Usage: node scripts/score-youtube-review.mjs <review-packet.json>\n");
  process.exitCode = 2;
} else {
  try { process.stdout.write(`${JSON.stringify(creatorReviewMetrics(
    JSON.parse(await readFile(path, "utf8"))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
