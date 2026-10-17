// Read-only local inspection of public source rows for one brand.
import { readFile } from "node:fs/promises";
import pg from "pg";
const name = process.argv[2];
if (!name) throw new Error("Brand name required.");
const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
const db = new pg.Pool({ connectionString: vars.DB_URL });
try {
  const result = await db.query(`select e.canonical_name,s.source_type,s.source_url,s.excerpt
    from catalog.entities e join catalog.source_items s on s.entity_id=e.id
    where e.canonical_name=$1 and s.platform='web' order by s.collected_at desc limit 20`, [name]);
  console.log(JSON.stringify(result.rows, null, 2));
} finally { await db.end(); }
