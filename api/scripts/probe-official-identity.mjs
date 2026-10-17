// Read-only first-party page probe through the existing selective web adapter.
import { readFile } from "node:fs/promises";
import { withWebSearch } from "../src/web-research.mjs";
import { discoverOfficialBrandEvidence } from "../src/personal-brand-discovery.mjs";

const [name, domain, focus] = process.argv.slice(2);
if (!name || !domain || !focus) throw new Error("Usage: name domain focus");
const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.DB_URL?.includes("127.0.0.1:")) throw new Error("Local Supabase only.");
process.env.DATABASE_URL = vars.DB_URL;
if (domain === "auto") {
  console.log(JSON.stringify(await discoverOfficialBrandEvidence({ name, description: `${name} offers ${focus}` }), null, 2));
  process.exit(0);
}
const result = await withWebSearch(`${name} ${focus}`, { includeDomains: [domain], focus });
console.log(JSON.stringify({ name, domain, cacheStatus: result.cacheStatus,
  results: result.results?.map((item) => ({ title: item.title, url: item.url,
    snippet: item.snippet, inspected: item.inspected })) ?? [] }, null, 2));
