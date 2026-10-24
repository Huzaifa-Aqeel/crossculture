import pg from "pg";
import { buildCreatorReviewPacket } from "../src/youtube-evaluation.mjs";

const runId = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId ?? "")) {
  process.stderr.write("Usage: node scripts/export-youtube-review.mjs <run-uuid>\n");
  process.exitCode = 2;
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(`select audit_json from private.youtube_research_audit
      where run_id=$1 and retain_until>now()`, [runId]);
    if (!result.rows[0]) throw new Error("No current private review record for this run.");
    process.stdout.write(`${JSON.stringify(buildCreatorReviewPacket(runId,
      result.rows[0].audit_json), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  finally { await pool.end(); }
}
