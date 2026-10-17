// One bounded live official-source probe. Refuses to start without seven free
// shared slots; all provider calls still pass the normal cache/budget guard.
import pg from "pg";
import { researchPartnerEvidence } from "../src/web-research.mjs";

if (!process.env.DATABASE_URL?.includes("127.0.0.1:")) throw new Error("Local database only.");
if (!process.env.TAVILY_API_KEY_2) throw new Error("Tavily backup credential is required for this probe.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const usageSql = `select count(*)::integer as used,
  coalesce(sum((payload_json->>'credits')::numeric) filter (where resource_type='usage'
    and payload_json->>'credits' is not null),0) as credits
  from private.provider_cache where provider='web' and fetched_at>now()-interval '1 day'
    and (resource_type='usage' or (resource_type='search' and last_status='succeeded'
      and not (payload_json ? 'budgetTracked')))`;
try {
  const before = (await db.query(usageSql)).rows[0];
  if (50 - before.used < 7) {
    console.log(JSON.stringify({ status: "budget_unavailable", used: before.used, available: 50 - before.used,
      providerCalls: 0 }));
    process.exitCode = 2;
  } else {
    const brand = await db.query(`select id from catalog.entities where canonical_name='Smartwool'
      and kind='brand' and identity_status='verified' limit 1`);
    if (!brand.rows[0]) throw new Error("Verified Smartwool identity is missing.");
    const result = await researchPartnerEvidence(null, { brandName: "Smartwool", domain: "smartwool.com",
      entityId: brand.rows[0].id, territories: ["Sustainability"],
      capabilityTerms: [{ key: "content_creation_capability", terms: ["campaign", "journal"] }] });
    const after = (await db.query(usageSql)).rows[0];
    const brief = (item) => ({ title: item.title, url: item.url, publishedAt: item.publishedAt,
      snippet: item.snippet, sourceHash: item.sourceHash });
    console.log(JSON.stringify({ status: result.coverage, providerCalls: after.used - before.used,
      reportedCredits: Number(after.credits) - Number(before.credits),
      territory: result.territoryResults.map((entry) => ({ name: entry.territory,
        coverage: entry.coverage, official: entry.official.map(brief),
        independent: entry.independent.map(brief) })),
      capabilities: result.capabilityResults.map((entry) => ({ key: entry.key, status: entry.status,
        coverage: entry.coverage, term: entry.term ?? null, matches: entry.matches.map(brief),
        contradictions: (entry.contradictions ?? []).map(brief) })) }));
  }
} finally { await db.end(); }
