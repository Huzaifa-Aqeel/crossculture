// Read-only local audit of the shared Tavily Search/Extract request guard.
import pg from "pg";

if (!process.env.DATABASE_URL?.includes("127.0.0.1:")) throw new Error("Local database only.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const rows = await db.query(`select now() as checked_at, count(*)::integer as used,
    min(fetched_at) as oldest, min(fetched_at + interval '1 day') as next_capacity,
    count(*) filter (where resource_type='usage')::integer as tracked_requests,
    count(*) filter (where resource_type='search')::integer as legacy_searches,
    coalesce(sum((payload_json->>'credits')::numeric) filter
      (where resource_type='usage' and payload_json->>'credits' is not null),0) as recorded_credits
    from private.provider_cache where provider='web' and fetched_at>now()-interval '1 day'
      and (resource_type='usage' or (resource_type='search' and last_status='succeeded'
        and not (payload_json ? 'budgetTracked')))`);
  const row = rows.rows[0];
  const expiries = await db.query(`select fetched_at + interval '1 day' as available_at
    from private.provider_cache where provider='web' and fetched_at>now()-interval '1 day'
      and (resource_type='usage' or (resource_type='search' and last_status='succeeded'
        and not (payload_json ? 'budgetTracked')))
    order by fetched_at`);
  const thresholds = Object.fromEntries([1, 5, 7, 10, 20, 30].map((count) =>
    [count, expiries.rows[count - 1]?.available_at ?? null]));
  console.log(JSON.stringify({ ...row, limit: 50, available: Math.max(0, 50 - row.used), thresholds }));
} finally { await db.end(); }
