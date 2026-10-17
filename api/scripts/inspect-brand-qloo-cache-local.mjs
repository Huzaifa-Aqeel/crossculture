// Read-only audit of retained private Qloo evidence for the Patagonia leads.
import { readFile } from "node:fs/promises";
import pg from "pg";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
const db = new pg.Pool({ connectionString: vars.DB_URL });
try {
  const rows = await db.query(`select id,owner_user_id,operation,context_json,normalized_result_json,
    relationships_json,explainability_json,sample_data,lifecycle_status,fresh_until,retain_until
    from private.qloo_responses where lifecycle_status='active' and (retain_until is null or retain_until>now())
      and (context_json::text ilike any($1::text[]) or normalized_result_json::text ilike any($1::text[]))
    order by collected_at desc limit 100`, [["%Patagonia%", "%Arc'teryx%", "%Smartwool%",
      "%B2A2238B-5FDC-46CD-B6F9-A32DB1474C70%", "%F5EA6E51-2F04-4714-AAB1-779387D6F2EE%"]]);
  const summarized = rows.rows.map((row) => ({ id: row.id, ownerUserId: row.owner_user_id,
    operation: row.operation, context: row.context_json, sample: row.sample_data,
    freshUntil: row.fresh_until, retainedUntil: row.retain_until,
    resultCount: row.normalized_result_json?.results?.length ?? 0,
    resultNames: (row.normalized_result_json?.results ?? []).map((item) => item.name).filter(Boolean).slice(0, 12),
    tags: row.operation === "qloo_entity_tags" ? (row.normalized_result_json?.results ?? [])
      .map((item) => ({ id: item.id, name: item.name, type: item.type })) : undefined,
    relationships: row.relationships_json, explainability: row.explainability_json }));
  const usage = await db.query(`select count(*)::integer as used,min(fetched_at) as oldest,
      coalesce(sum((payload_json->>'credits')::numeric) filter (where resource_type='usage'
        and payload_json->>'credits' is not null),0) as recorded_credits
    from private.provider_cache where provider='web' and fetched_at>now()-interval '1 day'
      and (resource_type='usage' or (resource_type='search' and last_status='succeeded'
        and not (payload_json ? 'budgetTracked')))`);
  const entities = await db.query(`select e.id,e.canonical_name,e.official_website,e.identity_status,
    json_agg(json_build_object('provider',i.provider,'id',i.external_id)) filter (where i.provider is not null) as identifiers
    from catalog.entities e left join catalog.entity_identifiers i on i.entity_id=e.id and i.status='confirmed'
    where e.canonical_name in ('Patagonia','Arc''teryx','Smartwool') group by e.id order by e.canonical_name`);
  console.log(JSON.stringify({ qlooRows: summarized, entities: entities.rows, dailyWebCacheRows: usage.rows[0] }));
} finally { await db.end(); }
