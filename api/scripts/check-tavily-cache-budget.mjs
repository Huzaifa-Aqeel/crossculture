// Local integration check. It never invokes Tavily or alters quota while full.
import assert from "node:assert/strict";
import pg from "pg";
import { withWebSearch, withWebExtract } from "../src/web-research.mjs";

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const quota = await db.query(`select count(*)::integer as used from private.provider_cache
    where provider='web' and fetched_at>now()-interval '1 day'
      and (resource_type='usage' or (resource_type='search' and last_status='succeeded'
        and not (payload_json ? 'budgetTracked')))`);
  const priorKey = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    const cached = await withWebSearch("arc'teryx campaign",
      { includeDomains: ["arcteryx.com"], focus: "campaign" },
      () => { throw new Error("Cache miss: provider must not be called by this check."); });
    assert.ok(["fresh", "revalidated"].includes(cached.cacheStatus));
    assert.ok(cached.results.length > 0);
    if (quota.rows[0].used >= 50) {
      await assert.rejects(withWebSearch("smartwool test-budget-unique-no-provider-call",
        { includeDomains: ["smartwool.com"], focus: "campaign" },
        () => { throw new Error("Provider called above global limit."); }), /daily provider limit/);
      await assert.rejects(withWebExtract("https://www.smartwool.com/test-budget-unique-no-provider-call",
        { focus: "campaign" },
        () => { throw new Error("Extract called above global limit."); }), /daily provider limit/);
    }
    console.log(JSON.stringify({ cachedSearch: cached.cacheStatus,
      cachedSources: cached.results.map((item) => item.url), sharedWebRequests24h: quota.rows[0].used,
      budgetExhaustionChecked: quota.rows[0].used >= 50, providerCalls: 0 }));
  } finally {
    if (priorKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = priorKey;
  }
} finally { await db.end(); }
