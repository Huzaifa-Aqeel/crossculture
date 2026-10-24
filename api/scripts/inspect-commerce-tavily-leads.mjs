// Read-only developer audit of inspected Tavily links for one identity query.
// Does not print cached page text, credentials, or Catalog data.
import { readFile } from "node:fs/promises";
import pg from "pg";

const snippets = process.argv.includes("--snippets");
const query = process.argv.slice(2).filter((item) => item !== "--snippets")
  .join(" ").trim().toLowerCase();
if (!query || query.length > 200) throw new Error("Pass one bounded Tavily query.");
const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ??
  "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local database only.");
const pool = new pg.Pool({ connectionString: vars.DB_URL, max: 1 });
try {
  const found = await pool.query(`select fetched_at, payload_json->'leads' as leads,
    payload_json->'results' as results from private.provider_cache
    where provider='web' and resource_type='search' and resource_key=$1
    order by fetched_at desc limit 1`, [query]);
  const row = found.rows[0];
  console.log(JSON.stringify({ query, fetchedAt: row?.fetched_at ?? null,
    leads: (row?.leads ?? []).map(({ url, title }) => ({ url, title })),
    inspected: (row?.results ?? []).map(({ url, title, snippet }) => ({ url, title,
      ...(snippets ? { snippet: String(snippet ?? "").slice(0, 350) } : {}) })) }));
} finally { await pool.end(); }
