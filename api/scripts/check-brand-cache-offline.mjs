// Read-only check of retained inspected-page leads. Never invokes web search.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { researchPartnerEvidence } from "../src/web-research.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
const db = new pg.Pool({ connectionString: vars.DB_URL });
try {
  for (const [brandName, domain, territories] of [
    ["Arc'teryx", "arcteryx.com", ["Outdoor Clothing"]],
    ["Smartwool", "smartwool.com", ["folk", "Sustainability", "Performance Driven"]],
  ]) {
    const rows = await db.query(`select resource_key,payload_json from private.provider_cache
      where provider='web' and resource_type='search' and last_status='succeeded'
        and fresh_until>now() and retain_until>now() and resource_key ilike $1
      order by fetched_at desc`, [`${brandName}%`]);
    const research = await researchPartnerEvidence(null, { brandName, domain, territories,
      capabilityTerms: [{ key: "content_creation_capability", terms: ["campaign"] }] },
    { search: async (query, options) => {
      const key = query.toLowerCase();
      const record = rows.rows.find((row) => row.resource_key === key &&
        Boolean(row.payload_json.includeDomains?.length) === Boolean(options.includeDomains?.length));
      return { results: record?.payload_json.results ?? [] };
    } });
    console.log(JSON.stringify({ brandName, cachedQuestions: rows.rows.map((row) => row.resource_key),
      territories: research.territoryResults.map((entry) => ({ name: entry.territory,
        official: entry.official.map((item) => item.url), independent: entry.independent.map((item) => item.url) })),
      capabilities: research.capabilityResults.map((entry) => ({ key: entry.key, status: entry.status,
        sources: entry.matches.map((item) => item.url) })) }));
  }
} finally { await db.end(); }
