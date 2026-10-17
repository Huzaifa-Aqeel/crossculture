// Bounded real-Qloo + cached-web replay through the signed-in Brand × Brand worker.
// No Wikidata or web provider requests are made; existing verified catalog IDs
// and fresh inspected web cache rows supply those inputs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { closeQloo } from "../src/qloo.mjs";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun } from "../src/personal-research.mjs";
import { processPersonalBrandRun } from "../src/personal-brand.mjs";
import { researchPartnerEvidence } from "../src/web-research.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const equal = line.indexOf("=");
  return [line.slice(0, equal), line.slice(equal + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) {
  throw new Error("Local Supabase only.");
}
process.env.DATABASE_URL = vars.DB_URL;
const authOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, authOptions);
const anon = createClient(vars.API_URL, vars.ANON_KEY, authOptions);
const db = new pg.Pool({ connectionString: vars.DB_URL });
let userId;
try {
  const identities = await db.query(`select id,canonical_name,identity_status from catalog.entities
    where canonical_name in ('Patagonia','Arc''teryx')`);
  const seed = identities.rows.find((item) => item.canonical_name === "Patagonia");
  const partner = identities.rows.find((item) => item.canonical_name === "Arc'teryx");
  assert.ok(seed?.identity_status === "verified" && partner?.identity_status === "verified");
  const rows = await db.query(`select resource_key,payload_json from private.provider_cache
    where provider='web' and resource_type='search' and scope='shared' and last_status='succeeded'
      and fresh_until>now() and retain_until>now() and resource_key like 'arc''teryx %'
    order by fetched_at desc`);
  const questions = [];
  const cachedSearch = async (query, options) => {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const record = rows.rows.find((row) => row.resource_key === key &&
      Boolean(row.payload_json.includeDomains?.length) === Boolean(options.includeDomains?.length));
    questions.push({ key, scoped: Boolean(options.includeDomains?.length), cacheHit: Boolean(record) });
    return { results: record?.payload_json.results ?? [], cacheStatus: record ? "retained_cache" : "not_retrieved" };
  };
  const suffix = randomUUID().slice(0, 8);
  const signup = await anon.auth.signUp({ email: `crossculture-arc-replay-${suffix}@example.test`,
    password: `LocalCheck-${randomUUID()}!` });
  assert.ifError(signup.error);
  userId = signup.data.user.id;
  assert.ifError((await admin.auth.admin.updateUserById(userId, { email_confirm: true })).error);
  const project = await createProject(userId, { seedEntityId: seed.id,
    name: "Arc'teryx cached evidence replay", objective: "content_collaboration" });
  const started = await startPersonalRun(userId, { projectId: project.id, mode: "direct_pair",
    partnerType: "brand", researchMode: "live_brand", partnerEntityId: partner.id,
    idempotencyKey: randomUUID() });
  const run = await claimPersonalRun("arc-cached-replay");
  assert.equal(run.id, started.runId);
  const researchPartner = (owner, input) => researchPartnerEvidence(owner, input, { search: cachedSearch });
  assert.equal(await processPersonalBrandRun(run, "arc-cached-replay", { researchPartner }), true);
  const finished = await getPersonalRun(userId, started.runId);
  assert.equal(finished.matches.length, 1);
  const match = finished.matches[0];
  const sourceMap = new Map(match.evidence.sources.map((source) => [source.id, source.sourceUrl]));
  const qlooRows = await db.query(`select id,operation,context_json,normalized_result_json,
    relationships_json,explainability_json from private.qloo_responses
    where owner_user_id=$1 and lifecycle_status='active' order by operation`, [userId]);
  const qloo = qlooRows.rows.map((row) => ({ id: row.id, operation: row.operation,
    context: row.context_json, result: row.operation === "qloo_entity_tags"
      ? (row.normalized_result_json?.results ?? []).map((item) => ({ id: item.id, name: item.name, type: item.type }))
      : row.normalized_result_json?.results,
    relationships: row.relationships_json, explanation: row.explainability_json }));
  const snapshot = await db.query(`select version,scoring_version,validity_status,input_hash
    from public.assessment_snapshots where match_id=$1 order by version desc`, [match.id]);
  console.log(JSON.stringify({ objective: run.objective, researchQuestions: questions, qloo,
    frozen: { contractVersion: match.evidence.contractVersion,
      sources: match.evidence.sources.map((source) => ({ id: source.id, kind: source.kind,
        url: source.sourceUrl, freshness: source.freshness })),
      bridges: match.evidence.bridges.map((bridge) => ({ ...bridge,
        qlooSources: bridge.qlooSourceIds.map((id) => sourceMap.get(id) ?? id) })),
      activity: match.evidence.partnerActivity.map((item) => ({ ...item,
        urls: item.sourceIds.map((id) => sourceMap.get(id)) })),
      capabilities: match.evidence.capabilities.map((item) => ({ ...item,
        urls: item.sourceIds.map((id) => sourceMap.get(id)) })),
      unknowns: match.evidence.unknowns }, score: match.score, snapshots: snapshot.rows }));
} finally {
  await closeQloo().catch(() => {});
  if (userId) {
    await db.query("delete from private.qloo_responses where owner_user_id=$1", [userId]).catch(() => {});
    await admin.auth.admin.deleteUser(userId);
  }
  await db.end();
}
