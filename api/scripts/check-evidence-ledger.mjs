import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { freezeEvidenceInput, samplePreviewEvidence } from "../src/evidence-ledger.mjs";
import { preserveNamedTitleObservations } from "../src/creator-intelligence.mjs";

const userId = randomUUID();
const otherId = randomUUID();
const seedEntityId = randomUUID();
const partnerEntityId = randomUUID();
const sourceId = randomUUID();
const responseId = randomUUID();
const now = new Date("2026-10-12T12:00:00.000Z");
const later = "2026-10-13T12:00:00.000Z";
const earlier = "2026-10-11T12:00:00.000Z";
const hash = "a".repeat(64);
const base = { userId, seedEntityId, partnerEntityId, objective: "content_collaboration" };

const sample = await samplePreviewEvidence({ ...base, variant: "brand", now });
assert.equal(sample.evidence.sample, true);
assert.equal(sample.evidence.sources[0].kind, "sample_fixture");
assert.equal(sample.evidence.claims[0].sourceIds[0], sample.evidence.sources[0].id);
assert.deepEqual(sample.qlooResponseIds, []);
await assert.rejects(freezeEvidenceInput({ ...base, sample: true,
  sourceRefs: [{ kind: "qloo_response", id: responseId }] }), /cannot be mixed/);
await assert.rejects(freezeEvidenceInput({ ...base, sample: true, claims: [{ id: "claim-one", kind: "observation",
  text: "An unsupported positive statement.", sourceIds: ["missing"] }] }), /valid source reference/);

const sourceRow = { id: sourceId, entity_id: partnerEntityId, platform: "web", source_type: "official_page",
  source_url: "https://example.org/sample-research", published_at: earlier, collected_at: earlier,
  expires_at: later, fresh_until: earlier, excerpt: "Observed source excerpt.",
  rights_json: { storage: "permitted", cross_user_reuse: "permitted" }, sample_data: false };
const qlooRow = { id: responseId, operation: "qloo_rank", input_hash: hash, responded_at: earlier, collected_at: earlier,
  fresh_until: earlier, retain_until: later, rights_json: { storage: "permitted" }, reuse_scope: "private",
  owner_user_id: userId, lifecycle_status: "active", sample_data: false };
const rows = { source: sourceRow, qloo: qlooRow };
const db = { async query(sql) {
  if (sql.includes("from catalog.source_items")) return { rows: rows.source ? [rows.source] : [] };
  if (sql.includes("from private.qloo_responses")) return { rows: rows.qloo ? [rows.qloo] : [] };
  throw new Error("Unexpected evidence query.");
} };
const catalogRef = { kind: "catalog_item", id: sourceId };
const qlooRef = { kind: "qloo_response", id: responseId };
const claims = [{ id: "observed-one", kind: "observation", text: "A source describes this public activity.",
  sourceIds: [`catalog:${sourceId}`] }];
const catalog = await freezeEvidenceInput({ ...base, sourceRefs: [catalogRef], claims }, db, now);
assert.equal(catalog.evidence.sources[0].freshness, "stale", "Stale retained evidence remains available without refresh");
assert.deepEqual(catalog.sourceRefsJson, [catalogRef]);
assert.match(catalog.inputHash, /^[a-f0-9]{64}$/);
const secondIdentityId = randomUUID();
const identityDb = { async query(sql, values) {
  if (!sql.includes("from catalog.source_items")) throw new Error("Unexpected identity source lookup.");
  const row = values[0] === sourceId ? sourceRow : values[0] === secondIdentityId
    ? { ...sourceRow, id: secondIdentityId, source_url: "https://linktr.ee/dannijuhl",
      rights_json: { ...sourceRow.rights_json, outbound_links: [{ label: "My YouTube Channel",
        url: "https://www.youtube.com/channel/UCkGNihSIqW5eDM4Wukj-t_g" }] } } : null;
  return { rows: row ? [row] : [] };
} };
const identityFrozen = await freezeEvidenceInput({ ...base,
  sourceRefs: [catalogRef, { kind: "catalog_item", id: secondIdentityId }],
  claims: [{ id: "creator-operator", kind: "observation", text: "A two-page link chain attributes the channel.",
    sourceIds: [`catalog:${sourceId}`, `catalog:${secondIdentityId}`] }] }, identityDb, now);
assert.equal(identityFrozen.evidence.sources.length, 2);
assert.equal(identityFrozen.evidence.claims[0].sourceIds.length, 2);
const withConstraint = await freezeEvidenceInput({ ...base, sourceRefs: [catalogRef], claims,
  constraints: [{ id: "verified:hard", kind: "verified", text: "Official hard exclusion.",
    blocking: true, sourceIds: [`catalog:${sourceId}`] }] }, db, now);
assert.deepEqual(withConstraint.evidence.constraints[0].sourceIds, [`catalog:${sourceId}`]);
await assert.rejects(freezeEvidenceInput({ ...base, sourceRefs: [catalogRef], claims,
  constraints: [{ id: "verified:hard", kind: "verified", text: "Unsupported hard exclusion.",
    blocking: true, sourceIds: ["catalog:missing"] }] }, db, now), /Each constraint needs/);
rows.source = { ...sourceRow, expires_at: earlier };
await assert.rejects(freezeEvidenceInput({ ...base, sourceRefs: [catalogRef], claims }, db, now), /retention has expired/);
rows.source = { ...sourceRow, sample_data: true };
await assert.rejects(freezeEvidenceInput({ ...base, sourceRefs: [catalogRef], claims }, db, now), /Sample data/);
rows.source = sourceRow;
await assert.rejects(freezeEvidenceInput({ ...base,
  sourceRefs: [{ kind: "unsupported_item", id: randomUUID() }] }, db, now),
  /Unsupported source reference/);
await assert.rejects(freezeEvidenceInput({ ...base, sourceRefs: [qlooRef], qlooInputHashes: [] }, db, now), /research context/);
const qloo = await freezeEvidenceInput({ ...base, sourceRefs: [qlooRef], qlooInputHashes: [hash], claims: [{
  id: "cultural-one", kind: "inference", text: "A cultural connection may be worth testing.", sourceIds: [`qloo:${responseId}`] }] }, db, now);
assert.deepEqual(qloo.qlooResponseIds, [responseId]);
rows.qloo = { ...qlooRow, owner_user_id: otherId };
await assert.rejects(freezeEvidenceInput({ ...base, sourceRefs: [qlooRef], qlooInputHashes: [hash] }, db, now), /another user/);
rows.qloo = { ...qlooRow, reuse_scope: "global", owner_user_id: null };
await assert.rejects(freezeEvidenceInput({ ...base, sourceRefs: [qlooRef], qlooInputHashes: [hash] }, db, now), /another user/);
rows.qloo = { ...qlooRow, sample_data: true };
await assert.rejects(freezeEvidenceInput({ ...base, sourceRefs: [qlooRef], qlooInputHashes: [hash] }, db, now), /Sample data/);
rows.qloo = qlooRow;
const retainedName = preserveNamedTitleObservations({ sourceId: "-JvPjTJkF60",
  title: "Neymar & Ronaldinho Were UNSTOPPABLE at Barcelona",
  description: "Ronaldinho & Neymar were featured together.", tags: [] })
  .find((item) => item.phrase === "Ronaldinho");
assert.ok(retainedName);
const personalId = randomUUID();
const personalRow = { id: personalId, user_id: userId, entity_id: partnerEntityId,
  source_type: "youtube_video", source_url: `https://www.youtube.com/watch?v=${retainedName.videoId}`,
  title: retainedName.basisText, published_at: earlier, collected_at: earlier,
  fresh_until: later, retain_until: later, rights_json: { storage: "permitted" },
  external_item_id: retainedName.videoId, request_hash: hash,
  metadata_observations_json: { sourceRole: "representative_sample",
    culturalSignals: [retainedName] } };
const personalDb = { async query(sql) {
  if (sql.includes("from public.source_items")) return { rows: [personalRow] };
  if (sql.includes("from private.qloo_responses")) return { rows: [qlooRow] };
  throw new Error("Unexpected source lookup.");
} };
const frozenNamed = await freezeEvidenceInput({ ...base,
  sourceRefs: [{ kind: "personal_item", id: personalId }, qlooRef], qlooInputHashes: [hash],
  bridges: [{ id: "bridge:ronaldinho", name: retainedName.phrase,
    qlooTagId: "qloo-person-ronaldinho", family: "person", specificity: "named",
    classification: "cross_category", qlooSourceIds: [`qloo:${responseId}`],
    partnerSourceIds: [`personal:${personalId}`], explainabilityBacked: false }],
  partnerActivity: [{ id: "video:ronaldinho", summary: "Creator discusses Ronaldinho in a sampled video.",
    centrality: retainedName.centrality, firstParty: true,
    bridgeIds: ["bridge:ronaldinho"], sourceIds: [`personal:${personalId}`] }],
}, personalDb, now);
assert.equal(frozenNamed.evidence.sources.find((item) => item.id === `personal:${personalId}`).videoId,
  retainedName.videoId, "The exact official video survives evidence freezing.");
assert.deepEqual(frozenNamed.evidence.bridges[0].partnerSourceIds, [`personal:${personalId}`]);
assert.deepEqual(frozenNamed.evidence.partnerActivity[0].bridgeIds, ["bridge:ronaldinho"]);
console.log("Evidence ledger checks passed: claim refs, sample isolation, owner/retention gates, stale reuse, Qloo context and source dependencies.");
