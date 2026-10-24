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
  const canonicalUrl = selection.qloo.website;
  try {
    await connection.query("begin");
    const ids = [["qloo", selection.qloo.id]];
    const existing = await connection.query(
      "select entity_id from catalog.entity_identifiers where status = 'confirmed' and provider = 'qloo' and external_id = $1 for update",
      [selection.qloo.id],
    );
    const knownIds = [...new Set(existing.rows.map((row) => row.entity_id))];
    if (knownIds.length > 1) throw new Error("These identifiers are linked to different brands. Review them before continuing.");
    let entityId = knownIds[0];
    if (!entityId && canonicalUrl) {
      const matchingUrl = await connection.query("select id from catalog.entities where kind = 'brand' and canonical_url = $1 for update", [canonicalUrl]);
      entityId = matchingUrl.rows[0]?.id;
    }
    if (entityId) {
      const otherQloo = await connection.query(`select external_id from catalog.entity_identifiers
        where entity_id=$1 and provider='qloo' and status='confirmed' and external_id<>$2
        limit 1`, [entityId, selection.qloo.id]);
      if (otherQloo.rows.length) throw new Error("This official website is linked to another cultural brand.");
      const otherSite = await connection.query(`select id from catalog.entities
        where kind='brand' and id<>$1 and (canonical_url=$2 or official_website=$2) limit 1`,
      [entityId, canonicalUrl]);
      if (otherSite.rows.length) throw new Error("This official website is linked to another brand record.");
    }
    if (!entityId) {
      const created = await connection.query(
        "insert into catalog.entities(kind, canonical_name, canonical_url, official_website, description, identity_status) values ('brand', $1, $2, $2, $3, $4) returning id",
        [selection.qloo.name, canonicalUrl, selection.qloo.description, selection.identityStatus],
      );
      entityId = created.rows[0].id;
    } else if (selection.identityStatus === "verified") {
      await connection.query(`update catalog.entities set identity_status='verified',
        official_website=$2, canonical_url=$2, updated_at=now()
        where id=$1`, [entityId, canonicalUrl]);
    }
    for (const [provider, externalId] of ids) {
      const current = await connection.query("select entity_id from catalog.entity_identifiers where provider = $1 and external_id = $2 and status = 'confirmed'", [provider, externalId]);
      if (current.rows.length && current.rows[0].entity_id !== entityId) throw new Error("An external identifier already belongs to another brand.");
      if (!current.rows.length) {
        await connection.query("insert into catalog.entity_identifiers(entity_id, provider, external_id, status, confidence, verified_at) values ($1, $2, $3, 'confirmed', 1, now())", [entityId, provider, externalId]);
      }
    }
    await connection.query("commit");
    return { id: entityId, kind: "brand", name: selection.qloo.name, canonicalUrl, identityStatus: selection.identityStatus, qlooId: selection.qloo.id };
  } catch (error) {
    await connection.query("rollback");
    throw error;
  } finally {
    connection.release();
  }
}

// Commerce-only identity: an inspected first-party site and its live UCP shop
// can identify a business even when Qloo has no native brand entity. No fake
// Qloo identifier is created.
export async function persistVerifiedCommerceSite(verified) {
  if (verified?.identityStatus !== "verified" ||
      !/^https:\/\/[a-z0-9.-]+\/?$/i.test(verified.officialWebsite ?? "") ||
      !/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(verified.shopId ?? "") ||
      !verified.identitySourceUrl?.startsWith("https://") ||
      String(verified.name ?? "").trim().length < 2) {
    throw new Error("A verified official commerce brand is required.");
  }
  const website = verified.officialWebsite.replace(/\/$/, "");
  const connection = await database().connect();
  try {
    await connection.query("begin");
    const existing = await connection.query(`select id from catalog.entities
      where kind='brand' and (canonical_url=$1 or official_website=$1)
      order by created_at limit 1 for update`, [website]);
    let id = existing.rows[0]?.id;
    if (!id) {
      const created = await connection.query(`insert into catalog.entities
        (kind,canonical_name,canonical_url,official_website,identity_status,facts_json,facts_verified_at)
        values ('brand',$1,$2,$2,'verified',$3::jsonb,now()) returning id`, [verified.name, website,
        JSON.stringify({ commerceIdentitySourceUrl: verified.identitySourceUrl })]);
      id = created.rows[0].id;
    } else {
      await connection.query(`update catalog.entities set official_website=$2,
        identity_status='verified',facts_json=coalesce(facts_json,'{}'::jsonb) || $3::jsonb,
        facts_verified_at=now(),updated_at=now() where id=$1`, [id, website,
        JSON.stringify({ commerceIdentitySourceUrl: verified.identitySourceUrl })]);
    }
    await connection.query("commit");
    return { id, kind: "brand", name: verified.name, canonicalUrl: website,
      identityStatus: "verified", qlooId: null, identitySourceUrl: verified.identitySourceUrl };
  } catch (error) { await connection.query("rollback"); throw error; }
  finally { connection.release(); }
}
