// One material official-site commercial question, cache first and shared-budget guarded.
import { readFile } from "node:fs/promises";
import { importChannel } from "../src/youtube.mjs";
import { extractCreatorMetadata } from "../src/creator-intelligence.mjs";
import { creatorCommercialQuestion, researchCreatorCommercial } from "../src/creator-commercial.mjs";
if (process.env.LIVE_CREATOR_CHECK !== "1") throw new Error("Set LIVE_CREATOR_CHECK=1.");
const raw = await readFile("/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
process.env.DATABASE_URL = vars.DB_URL;
const profile = await importChannel(process.env.CREATOR_COMMERCIAL_CHANNEL || "@MKBHD");
profile.videos = profile.videos.slice(0, 5);
const errors = [];
const metadata = await extractCreatorMetadata(profile, { onError: (error) => errors.push({
  kind: error?.constructor?.name, message: String(error?.message ?? "unknown").slice(0, 120) }) });
const question = creatorCommercialQuestion(profile, metadata);
const result = question ? await researchCreatorCommercial(profile, metadata) : null;
console.log(JSON.stringify({ creator: profile.name, country: profile.country,
  sampled: metadata.sourceCoverage.sampled, analyzed: metadata.sourceCoverage.extracted,
  observedCommercial: metadata.collaborationObservations.map((item) => ({
    kind: item.kind, partnerName: item.partnerName, videoId: item.videoId })),
  officialDomain: question?.domain ?? null, partner: question?.partnerName ?? null,
  observedKind: question?.kind ?? null, coverage: result?.coverage ?? "not_performed",
  reason: result?.reason ?? "no_specific_official_question", cacheStatus: result?.cacheStatus ?? null,
  sources: result?.observations?.map((item) => ({ url: item.item.url,
    sourceHash: item.item.sourceHash, partnerName: item.partnerName })) ?? [], errors }, null, 2));
process.exit(0);
