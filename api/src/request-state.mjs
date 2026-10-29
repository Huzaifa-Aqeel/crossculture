import pg from "pg";

// Brand lookup and starting-brand confirmation state lives in Postgres so a
// restart or a second API instance keeps the same confirmation and limits.
let pool;
function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  }
  return pool;
}

export const LOOKUPS_PER_HOUR = 10;
const RESULT_REUSE = "10 minutes";
const RESULT_CONFIRM_WINDOW = "15 minutes";
const SEED_CONFIRMATION_WINDOW = "30 minutes";

export async function cachedBrandLookup(userId, purpose, query, { client = db() } = {}) {
  const result = await client.query(`select id,result_json as result from private.brand_lookups
    where user_id=$1 and purpose=$2 and lower(query)=lower($3) and result_json is not null
      and consumed_at is null and created_at>now()-interval '${RESULT_REUSE}'
    order by created_at desc limit 1`, [userId, purpose, query]);
  return result.rows[0] ? { ...result.rows[0].result, id: result.rows[0].id } : null;
}

// Counts and reserves one provider lookup atomically per user. Returns null at the limit.
export async function reserveBrandLookup(userId, purpose, query, { client = db() } = {}) {
  const connection = await client.connect();
  try {
    await connection.query("begin");
    await connection.query("select pg_advisory_xact_lock(hashtext('brand_lookup'),hashtext($1))", [userId]);
    const recent = await connection.query(`select count(*)::integer as total from private.brand_lookups
      where user_id=$1 and created_at>now()-interval '1 hour'`, [userId]);
    if (recent.rows[0].total >= LOOKUPS_PER_HOUR) { await connection.query("rollback"); return null; }
    const created = await connection.query(`insert into private.brand_lookups(user_id,purpose,query)
      values ($1,$2,$3) returning id`, [userId, purpose, String(query ?? "").slice(0, 90)]);
    await connection.query("commit");
    return created.rows[0].id;
  } catch (error) { await connection.query("rollback"); throw error; }
  finally { connection.release(); }
}

export async function completeBrandLookup(id, userId, result, { client = db() } = {}) {
  await client.query(`update private.brand_lookups set result_json=$3::jsonb
    where id=$1 and user_id=$2`, [id, userId, JSON.stringify(result)]);
}

export async function openBrandLookup(id, userId, { client = db() } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id ?? ""))) return null;
  const result = await client.query(`select purpose,query,result_json as result from private.brand_lookups
    where id=$1 and user_id=$2 and result_json is not null and consumed_at is null
      and created_at>now()-interval '${RESULT_CONFIRM_WINDOW}'`, [id, userId]);
  return result.rows[0] ?? null;
}

// A confirmed search is closed but still counts toward the hourly limit.
export async function consumeBrandLookup(id, userId, { client = db() } = {}) {
  await client.query(`update private.brand_lookups set consumed_at=now()
    where id=$1 and user_id=$2 and consumed_at is null`, [id, userId]);
}

export async function recordSeedConfirmation(userId, entityId, { client = db() } = {}) {
  await client.query(`insert into private.seed_confirmations(user_id,entity_id,confirmed_at)
    values ($1,$2,now()) on conflict (user_id) do update
      set entity_id=excluded.entity_id,confirmed_at=excluded.confirmed_at`, [userId, entityId]);
}

export async function hasRecentSeedConfirmation(userId, entityId, { client = db() } = {}) {
  if (typeof entityId !== "string") return false;
  const result = await client.query(`select 1 from private.seed_confirmations
    where user_id=$1 and entity_id::text=$2
      and confirmed_at>now()-interval '${SEED_CONFIRMATION_WINDOW}'`, [userId, entityId]);
  return result.rows.length > 0;
}

export async function purgeRequestState({ client = db() } = {}) {
  await client.query("delete from private.brand_lookups where created_at<now()-interval '1 hour'");
  await client.query(`delete from private.seed_confirmations
    where confirmed_at<now()-interval '${SEED_CONFIRMATION_WINDOW}'`);
}
