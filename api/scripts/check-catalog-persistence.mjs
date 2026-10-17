import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { persistSelectedBrand } from "../src/catalog.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the local catalog check.");

const suffix = randomUUID();
const qlooId = `fixture-qloo-${suffix}`;
const wikidataId = `Q${String(Date.now()).slice(-10)}`;
const website = `https://fixture-${suffix}.example`;
const selection = {
  qloo: { id: qlooId, name: "Fixture US Brand", website, description: "Sample data for local verification." },
  wikidata: { id: wikidataId, name: "Fixture US Brand", website, wikidataUrl: `https://www.wikidata.org/wiki/${wikidataId}` },
  identityStatus: "verified",
};
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let entityId;
try {
  const created = await persistSelectedBrand(selection);
  entityId = created.id;
  assert.equal(created.qlooId, qlooId);
  assert.equal(created.wikidataQid, wikidataId);
  assert.equal(created.identityStatus, "verified");
  const repeated = await persistSelectedBrand(selection);
  assert.equal(repeated.id, entityId, "Repeated selection must reuse the catalog entity.");
  const ids = await client.query("select provider, external_id from catalog.entity_identifiers where entity_id = $1 order by provider", [entityId]);
  assert.deepEqual(ids.rows, [
    { provider: "qloo", external_id: qlooId },
    { provider: "wikidata", external_id: wikidataId },
  ]);
  const facts = await client.query("select official_website, facts_json from catalog.entities where id = $1", [entityId]);
  assert.equal(facts.rows[0].official_website, website);
  assert.equal(facts.rows[0].facts_json.sourceUrl, selection.wikidata.wikidataUrl);
  console.log("Local catalog persistence passed: separate provider IDs, facts, and idempotent confirmation.");
} finally {
  if (entityId) await client.query("delete from catalog.entities where id = $1", [entityId]);
  await client.end();
}
