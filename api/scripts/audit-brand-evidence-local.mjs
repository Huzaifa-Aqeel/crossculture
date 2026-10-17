// Read-only local audit of cached Brand × Brand research and retained snapshots.
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
  const usage = await db.query(`select count(*)::integer as used,min(fetched_at) as oldest
    from private.provider_cache where provider='web' and resource_type='search'
      and last_status='succeeded' and fetched_at > now()-interval '1 day'`);
  console.log(JSON.stringify({ dailyWebCacheRows: usage.rows[0] }));
  for (const name of ["Arc'teryx", "Smartwool"]) {
    const identities = await db.query(`select e.id,e.canonical_name,e.official_website,e.identity_status,
      json_agg(json_build_object('provider',i.provider,'externalId',i.external_id)) filter (where i.provider is not null) as identifiers
      from catalog.entities e left join catalog.entity_identifiers i on i.entity_id=e.id and i.status='confirmed'
      where e.canonical_name=$1 group by e.id order by e.updated_at desc`, [name]);
    const sources = await db.query(`select s.source_type,s.source_url,s.excerpt,s.fresh_until,s.expires_at,
      s.rights_json->>'source_hash' as source_hash
      from catalog.entities e join catalog.source_items s on s.entity_id=e.id
      where e.canonical_name=$1 and s.platform='web' order by s.collected_at desc limit 25`, [name]);
    const cached = await db.query(`select resource_key,payload_json->'includeDomains' as domains,
      payload_json->'results' as results,fetched_at,fresh_until
      from private.provider_cache where provider='web' and resource_type='search'
        and resource_key ilike $1 and fresh_until>now()
      order by fetched_at desc limit 40`, [`%${name}%`]);
    const frozen = await db.query(`select a.version,a.scoring_version,a.validity_status,
      a.score_json,a.evidence_json from public.assessment_snapshots a
      join public.matches m on m.id=a.match_id join catalog.entities e on e.id=m.partner_entity_id
      where e.canonical_name=$1 order by a.created_at desc limit 3`, [name]);
    console.log(JSON.stringify({ name, identities: identities.rows, sources: sources.rows,
      cached: cached.rows, frozen: frozen.rows }, null, 2));
  }
} finally { await db.end(); }
