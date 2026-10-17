// Bounded model diagnosis; prints validation issues, never prompt or video descriptions.
import { readFile } from "node:fs/promises";
import { importChannel } from "../src/youtube.mjs";
import { extractCreatorMetadata } from "../src/creator-intelligence.mjs";
if (process.env.LIVE_CREATOR_CHECK !== "1") throw new Error("Set LIVE_CREATOR_CHECK=1.");
const raw = await readFile("/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
process.env.DATABASE_URL = vars.DB_URL;
const profile = await importChannel("@Darwinonthetrail");
if (process.env.CREATOR_METADATA_SLICE) {
  const [start, end] = process.env.CREATOR_METADATA_SLICE.split(":").map(Number);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 20 || end <= start)
    throw new Error("Invalid bounded metadata slice.");
  profile.videos = profile.videos.slice(start, end);
}
const errors = [];
const result = await extractCreatorMetadata(profile, { recoveryMaxCalls: 0,
  onError: (error) => errors.push({ name: error?.constructor?.name,
    issues: error?.issues?.map((issue) => ({ path: issue.path, code: issue.code,
      message: issue.message })).slice(0, 8),
    message: String(error?.message ?? "unknown").slice(0, 180) }) });
console.log(JSON.stringify({ coverage: result.sourceCoverage, errors }, null, 2));
process.exit(0);
