import pg from "pg";

let pool;

function database() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, idleTimeoutMillis: 10_000 });
  return pool;
}

export async function persistSelectedBrand(selection) {
  const connection = await database().connect();
  const canonicalUrl = selection.wikidata?.website ?? selection.qloo.website;
  try {
    await connection.query("begin");
    const ids = [
      ["qloo", selection.qloo.id],
      ...(selection.wikidata ? [["wikidata", selection.wikidata.id]] : []),
    ];
    const existing = await connection.query(
      "select entity_id from catalog.entity_identifiers where status = 'confirmed' and ((provider = 'qloo' and external_id = $1) or (provider = 'wikidata' and external_id = $2)) for update",
      [selection.qloo.id, selection.wikidata?.id ?? ""],
    );
    const knownIds = [...new Set(existing.rows.map((row) => row.entity_id))];
    if (knownIds.length > 1) throw new Error("These identifiers are linked to different brands. Review them before continuing.");
    let entityId = knownIds[0];
    if (!entityId && canonicalUrl) {
      const matchingUrl = await connection.query("select id from catalog.entities where kind = 'brand' and canonical_url = $1 for update", [canonicalUrl]);
      entityId = matchingUrl.rows[0]?.id;
    }
    if (!entityId) {
      const created = await connection.query(
        "insert into catalog.entities(kind, canonical_name, canonical_url, description, identity_status) values ('brand', $1, $2, $3, $4) returning id",
        [selection.qloo.name, canonicalUrl, selection.qloo.description ?? selection.wikidata?.description, selection.identityStatus],
      );
      entityId = created.rows[0].id;
    } else if (selection.identityStatus === "verified") {
      await connection.query("update catalog.entities set identity_status = 'verified', canonical_url = coalesce(canonical_url, $2), updated_at = now() where id = $1", [entityId, canonicalUrl]);
    }
    for (const [provider, externalId] of ids) {
      const current = await connection.query("select entity_id from catalog.entity_identifiers where provider = $1 and external_id = $2 and status = 'confirmed'", [provider, externalId]);
      if (current.rows.length && current.rows[0].entity_id !== entityId) throw new Error("An external identifier already belongs to another brand.");
      if (!current.rows.length) {
        await connection.query("insert into catalog.entity_identifiers(entity_id, provider, external_id, status, confidence, verified_at) values ($1, $2, $3, 'confirmed', 1, now())", [entityId, provider, externalId]);
      }
    }
    if (selection.wikidata) {
      await connection.query(
        `update catalog.entities set official_website = $2, parent_organization_qid = $3,
           facts_json = $4::jsonb, facts_verified_at = now(), updated_at = now() where id = $1`,
        [entityId, selection.wikidata.website, selection.wikidata.parentQid,
          JSON.stringify({ countryQid: selection.wikidata.countryQid, industryQid: selection.wikidata.industryQid, sourceUrl: selection.wikidata.wikidataUrl })],
      );
    }
    await connection.query("commit");
    return { id: entityId, kind: "brand", name: selection.qloo.name, canonicalUrl, identityStatus: selection.identityStatus, qlooId: selection.qloo.id, wikidataQid: selection.wikidata?.id ?? null };
  } catch (error) {
    await connection.query("rollback");
    throw error;
  } finally {
    connection.release();
  }
}
