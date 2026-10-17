import pg from "pg";

let pool;
function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }
  return pool;
}

export async function purgeDueYouTubeSources(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid YouTube purge limit.");
  const result = await db().query("select private.purge_due_youtube_sources($1) as purged", [limit]);
  return result.rows[0].purged;
}

export async function purgeDuePersonalYouTubeSources(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid YouTube purge limit.");
  const result = await db().query("select private.purge_due_personal_youtube_sources($1) as purged", [limit]);
  return result.rows[0].purged;
}

export async function purgeDueCreatorObservations(limit = 100) {
  const result = await db().query("select private.purge_due_creator_observations($1) as purged", [limit]);
  return result.rows[0]?.purged ?? 0;
}
