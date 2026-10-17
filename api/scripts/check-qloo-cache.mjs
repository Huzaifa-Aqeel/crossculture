import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { qlooCacheIdentity, readQlooCache, storeQlooResponse, purgeQlooResponse } from "../src/qloo-cache.mjs";
import { personalQlooRankNamedEntity } from "../src/personal-qloo.mjs";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the local Supabase database.");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const nonce = randomUUID();
const ownerUserId = randomUUID();
const otherUserId = randomUUID();
const context = { entity: `synthetic-${nonce}`, type: "brand" };
const identity = qlooCacheIdentity({ operation: "qloo_describe", context, ownerUserId });
const otherIdentity = qlooCacheIdentity({ operation: "qloo_describe", context, ownerUserId: otherUserId });
let responseId;
let entityId;
const pairResponseIds = [];
try {
  await db.query("insert into auth.users(id) values($1),($2)", [ownerUserId, otherUserId]);
  assert.throws(() => qlooCacheIdentity({ operation: "qloo_describe", context }), /owner user ID/);
  assert.equal(identity.cacheKey, qlooCacheIdentity({ context: { type: "brand", entity: `synthetic-${nonce}` }, operation: "qloo_describe", ownerUserId }).cacheKey);
  assert.notEqual(identity.cacheKey, otherIdentity.cacheKey);
  assert.equal((await readQlooCache(identity)).status, "missing");
  const input = { result: { kind: "synthetic-sample", results: [{ id: `sample-${nonce}` }] }, providerStatus: "ok",
    resolvedEntityIds: [`sample-${nonce}`],
    affinities: [{ targetId: `sample-${nonce}`, value: 0.42, context: "synthetic sample only" }],
    relationships: [{ sourceId: `sample-${nonce}`, targetId: `other-${nonce}`, kind: "synthetic" }],
    explainability: { status: "synthetic", reasons: ["sample only"] }, explainabilityStatus: "available",
    rights: { storage: "permitted", retention_basis: "time_limited_fixture" },
    collectedAt: new Date(Date.now() - 3600_000), freshUntil: new Date(Date.now() - 1800_000),
    retainUntil: new Date(Date.now() + 3600_000), sampleData: true };
  const saved = await storeQlooResponse(identity, input);
  responseId = saved.id;
  assert.equal((await storeQlooResponse(identity, input)).id, responseId);
  assert.equal((await readQlooCache(otherIdentity)).status, "missing");
  assert.equal((await readQlooCache({ ...identity, ownerUserId: otherUserId })).status, "missing");
  const cached = await readQlooCache(identity);
  assert.equal(cached.status, "stale");
  assert.equal(cached.sampleData, true);
  assert.deepEqual(cached.resolvedEntityIds, input.resolvedEntityIds);
  assert.deepEqual(cached.affinities, input.affinities);
  assert.deepEqual(cached.relationships, input.relationships);
  assert.deepEqual(cached.explainability, input.explainability);
  assert.ok(cached.respondedAt);
  const row = await db.query("select reuse_scope,owner_user_id from private.qloo_responses where id=$1", [responseId]);
  assert.equal(row.rows[0].reuse_scope, "private");
  assert.equal(row.rows[0].owner_user_id, ownerUserId);
  await assert.rejects(db.query("update private.qloo_responses set reuse_scope='global', owner_user_id=null where id=$1", [responseId]), /qloo_responses_private_owner_only/);
  entityId = (await db.query("insert into catalog.entities(kind,canonical_name) values ('brand',$1) returning id", [`Synthetic Qloo ${nonce}`])).rows[0].id;
  await assert.rejects(db.query(
    "insert into catalog.cultural_intelligence(entity_id,version,qloo_response_ids) values($1,1,$2::uuid[])",
    [entityId, [responseId]]), /Private Qloo responses cannot be used in shared intelligence/);
  await assert.rejects(db.query(
    "insert into catalog.cultural_intelligence(entity_id,version,claims_json) values($1,1,$2::jsonb)",
    [entityId, JSON.stringify([{ label: "Synthetic", source_refs: [{ kind: "qloo_response", id: responseId }] }])]),
    /Private Qloo responses cannot be used in shared intelligence/);
  const browser = await db.connect();
  try {
    await browser.query("begin");
    await browser.query("set local role anon");
    await assert.rejects(browser.query("select id from private.qloo_responses where id = $1", [responseId]), /permission denied/);
    await browser.query("rollback");
  } finally { browser.release(); }
  await assert.rejects(purgeQlooResponse(responseId, "retention_limit"), /retention is still permitted/);
  assert.equal(await purgeQlooResponse(responseId, "rights_change"), true);
  assert.equal((await readQlooCache(identity)).status, "missing");
  const renewed = await storeQlooResponse(identity, { ...input, collectedAt: new Date(),
    respondedAt: new Date(), freshUntil: new Date(Date.now() + 1800_000),
    retainUntil: new Date(Date.now() + 3600_000) });
  await db.query(`update private.qloo_responses set collected_at=now()-interval '2 hours',
    fresh_until=now()-interval '90 minutes',retain_until=now()-interval '1 hour' where id=$1`, [renewed.id]);
  const recollected = await storeQlooResponse(identity, { ...input, collectedAt: new Date(),
    respondedAt: new Date(), freshUntil: new Date(Date.now() + 1800_000),
    retainUntil: new Date(Date.now() + 3600_000) });
  assert.notEqual(recollected.id, renewed.id);
  responseId = recollected.id;
  assert.equal((await readQlooCache(identity)).status, "fresh");
  const seedId = randomUUID();
  const filmId = randomUUID();
  let pairCalls = 0;
  const pairProvider = async (operation, query) => {
    pairCalls += 1;
    assert.equal(operation, "qloo_rank");
    assert.deepEqual(query, { options: [filmId], option_type: "movie", signals: [seedId] });
    return { status: "ok", results: [{ entity_id: filmId,
      subtype: "urn:entity:movie", affinity: 0.4 }] };
  };
  const pair = await personalQlooRankNamedEntity(ownerUserId, seedId, filmId, "movie",
    { provider: pairProvider });
  pairResponseIds.push(pair.responseId);
  assert.ok(pair.responseId);
  const reusedPair = await personalQlooRankNamedEntity(ownerUserId, seedId, filmId, "movie",
    { provider: pairProvider });
  assert.equal(reusedPair.responseId, pair.responseId);
  assert.equal(reusedPair.cacheStatus, "fresh");
  assert.equal(pairCalls, 1, "The same owner's exact typed query reuses private Qloo evidence.");
  const otherPair = await personalQlooRankNamedEntity(otherUserId, seedId, filmId, "movie",
    { provider: pairProvider });
  pairResponseIds.push(otherPair.responseId);
  assert.notEqual(otherPair.responseId, pair.responseId);
  assert.equal(pairCalls, 2, "A different user cannot reuse the first user's Qloo response.");
  assert.equal((await personalQlooRankNamedEntity(ownerUserId, seedId, filmId, "person",
    { provider: async () => ({ status: "ok", results: [{ entity_id: filmId,
      subtype: "urn:entity:movie", affinity: 0.9 }] }) })).responseId, null,
  "A wrong typed result cannot be saved as pair evidence.");
  console.log("Qloo cache checks passed: deterministic per-user keys, owner isolation, private-only database constraint, stale retention, duplicate storage prevention, anon denial, app purge. No Qloo call ran.");
} finally {
  if (responseId) await db.query("delete from private.qloo_responses where id = $1", [responseId]);
  if (pairResponseIds.length) await db.query("delete from private.qloo_responses where id=any($1::uuid[])",
    [pairResponseIds]);
  if (entityId) await db.query("delete from catalog.entities where id = $1", [entityId]);
  await db.query("delete from auth.users where id=any($1::uuid[])", [[ownerUserId, otherUserId]]);
  await db.end();
}
