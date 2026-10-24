// Fresh, ordinary-brand worker probe. No creator, channel, or cultural hint is supplied.
import { randomInt } from "node:crypto";
import pg from "pg";
import { personalQlooDescribe } from "../src/personal-qloo.mjs";
import { normalizeQlooBrands } from "../src/brand-resolution.mjs";
import { startYoutubeRun, workOneYoutubeRun } from "../src/youtube-research.mjs";
import { closeQloo } from "../src/qloo.mjs";

const exclusions = new Set(process.argv.slice(2).map((name) => name.toLowerCase()));
const roster = ["Marine Layer", "Mack Weldon", "OSEA", "Parks Project", "Ridge", "Away",
  "Faherty", "Huckberry", "Bombas", "MUD/WTR"]
  .filter((name) => !exclusions.has(name.toLowerCase()));
for (let index = roster.length - 1; index > 0; index -= 1) {
  const other = randomInt(index + 1);
  [roster[index], roster[other]] = [roster[other], roster[index]];
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  process.stdout.write(`${JSON.stringify({ event: "preregistered_order", roster })}\n`);
  const owner = (await pool.query("select id from auth.users order by created_at limit 1")).rows[0]?.id;
  if (!owner) throw new Error("No local signed-in test owner is available.");
  let chosen;
  for (const name of roster) {
    const envelope = await personalQlooDescribe(owner, { entity: name });
    const candidates = normalizeQlooBrands(envelope);
    const exact = candidates.find((item) => item.name?.toLowerCase().replace(/[^a-z0-9]/g, "") ===
      name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    process.stdout.write(`${JSON.stringify({ event: "brand_resolution", name,
      status: envelope.status, exact: Boolean(exact) })}\n`);
    if (exact) { chosen = exact; break; }
  }
  if (!chosen) throw new Error("No exact Qloo brand was returned from the preregistered roster.");
  const { runId } = await startYoutubeRun(owner, {
    brandName: chosen.name, brandQlooId: chosen.id, campaignMode: "ongoing" });
  process.stdout.write(`${JSON.stringify({ event: "run_started", brand: chosen.name, runId })}\n`);
  let row;
  do {
    const worked = await workOneYoutubeRun();
    row = (await pool.query(`select status,error_code,result_json from public.youtube_research_runs
      where id=$1`, [runId])).rows[0];
    if (!worked && ["queued", "running"].includes(row?.status))
      throw new Error("The test run remains pending under another worker.");
  } while (["queued", "running"].includes(row?.status));
  const audit = (await pool.query(`select audit_json from private.youtube_research_audit
    where run_id=$1`, [runId])).rows[0]?.audit_json;
  process.stdout.write(`${JSON.stringify({ event: "run_finished", brand: chosen.name, runId,
    status: row?.status, errorCode: row?.error_code ?? null,
    coverage: row?.result_json?.coverage ?? null,
    shortlisted: row?.result_json?.channels?.map((item) => ({ name: item.name,
      connections: item.connections?.filter((entry) => entry.state === "supported")
        .map((entry) => entry.tagName) })) ?? [],
    reviewed: audit?.reviewed?.map((item) => ({ name: item.name,
      status: item.status, stop: item.coverage?.transcriptStopReason,
      captions: item.coverage?.transcriptAvailable,
      sources: item.sourceVideos?.length })) ?? [] })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ event: "run_error",
    error: error?.code ?? "unknown", message: error?.message ?? "unknown",
    operation: error?.syscall ?? null })}\n`);
  process.exitCode = 1;
} finally {
  await closeQloo().catch(() => {});
  await pool.end();
  // The worker's private pool has no public close method.
  process.exit(process.exitCode ?? 0);
}
