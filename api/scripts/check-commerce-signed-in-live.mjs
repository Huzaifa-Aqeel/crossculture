// Read-only provider calls with a temporary local Supabase user and project.
// Prints statuses only; no Catalog payload, image or provider key is logged.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { persistSelectedBrand } from "../src/catalog.mjs";
import { createProject } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, getPersonalRun } from "../src/personal-research.mjs";
import { processCommerceRun } from "../src/commerce-worker.mjs";
import { commerceProposalAction } from "../src/commerce-proposals.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) {
  throw new Error("Local Supabase only.");
}
assert.ok(process.env.SHOPIFY_UCP_PROFILE_URL?.startsWith("https://"));
process.env.DATABASE_URL = vars.DB_URL;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const owner = createClient(vars.API_URL, vars.ANON_KEY, options);
const db = new pg.Pool({ connectionString: vars.DB_URL });
const mode = (process.argv[2] ?? process.env.COMMERCE_ACCEPTANCE_MODE) === "discovery"
  ? "discovery" : "direct_pair";
const objective = (process.argv[3] ?? process.env.COMMERCE_ACCEPTANCE_OBJECTIVE) === "cross_sell"
  ? "cross_sell" : "product_bundle";
const seedChoice = { id: process.env.COMMERCE_SEED_QLOO_ID ?? "28823801-25D0-4A3E-AA90-3F028E2DBB3A",
  name: process.env.COMMERCE_SEED_NAME ?? "BAGGU",
  website: process.env.COMMERCE_SEED_WEBSITE ?? "https://baggu.com" };
const partnerChoice = { id: process.env.COMMERCE_PARTNER_QLOO_ID ?? "F5BDFE2E-B464-48FB-9025-52C3CFFF4F3C",
  name: process.env.COMMERCE_PARTNER_NAME ?? "Cold Picnic",
  website: process.env.COMMERCE_PARTNER_WEBSITE ?? "https://coldpicnic.com" };
let userId;
try {
  const email = `commerce-live-${randomUUID().slice(0, 8)}@example.test`;
  const password = `LocalCheck-${randomUUID()}!`;
  const signUp = await owner.auth.signUp({ email, password });
  assert.ifError(signUp.error); userId = signUp.data.user.id;
  assert.ifError((await admin.auth.admin.updateUserById(userId, { email_confirm: true })).error);
  assert.ifError((await owner.auth.signInWithPassword({ email, password })).error);
  const seed = await persistSelectedBrand({ qloo: seedChoice, identityStatus: "verified" });
  const partner = await persistSelectedBrand({ qloo: partnerChoice,
  identityStatus: "verified" });
  const project = await createProject(userId, { seedEntityId: seed.id,
    name: "Live commerce acceptance", objective });
  const started = await startPersonalRun(userId, { projectId: project.id,
    partnerType: "brand", mode, ...(mode === "direct_pair" ? { partnerEntityId: partner.id } : {}),
    researchMode: "live_commerce", idempotencyKey: randomUUID() });
  const claimed = await claimPersonalRun("commerce-live-acceptance");
  assert.equal(claimed.id, started.runId);
  await processCommerceRun(claimed, "commerce-live-acceptance");
  const run = await getPersonalRun(userId, started.runId);
  const statuses = run.matches.map((match) => match.score?.status);
  const anyCurrentPair = run.matches.some((match) =>
    match.currentOffers?.seed?.status === "current" &&
    match.currentOffers?.partner?.status === "current");
  const current = run.matches.find((match) => match.score?.status === "supported" &&
    match.currentOffers?.seed?.status === "current" &&
    match.currentOffers?.partner?.status === "current");
  let concepts = 0; let proposalSaved = false;
  if (current) {
    const prepared = await commerceProposalAction(userId, current.id);
    concepts = prepared.concepts?.length ?? 0;
    if (concepts === 3) {
      const brief = await commerceProposalAction(userId, current.id,
        { conceptId: prepared.concepts[0].id });
      proposalSaved = Boolean(brief.id && (await getPersonalRun(userId, started.runId))
        .matches.find((match) => match.id === current.id)?.briefId === brief.id);
    }
  }
  const stored = await db.query(`select evidence_json
    from public.assessment_snapshots a join public.matches m on m.id=a.match_id
    where m.analysis_run_id=$1`, [started.runId]);
  const hasForbiddenCatalogKey = (value) => value && typeof value === "object" &&
    (Object.keys(value).some((key) => ["products", "variants", "images", "media",
      "searchResults", "structuredContent"].includes(key)) ||
      Object.values(value).some(hasForbiddenCatalogKey));
  const catalogProductArraySaved = stored.rows.some((row) => hasForbiddenCatalogKey(row.evidence_json));
  console.log(JSON.stringify({ mode, objective, runStatus: run.status,
    stopReason: run.result?.stopReason, opportunityCount: run.matches.length,
    candidateStatuses: run.result?.candidates?.map((candidate) => ({
      status: candidate.status, coverage: candidate.coverage,
      coverageIssues: candidate.coverageIssues ?? [],
      hypothesesConsidered: candidate.hypothesesConsidered ?? 0 })) ?? [],
    outcomes: Object.fromEntries(["supported", "needs_verification", "unsupported"]
      .map((status) => [status, statuses.filter((item) => item === status).length])),
    reasonCodes: [...new Set(run.matches.flatMap((match) => [
      ...(match.savedScore?.reasonCodes ?? []), ...(match.savedScore?.reviewFlags ?? [])]))],
    currentOfferStatuses: [...new Set(run.matches.flatMap((match) => [
      match.currentOffers?.seed?.status, match.currentOffers?.partner?.status]).filter(Boolean))],
    currentOfferChecks: run.matches.map((match) => ({
      seed: { status: match.currentOffers?.seed?.status,
        message: match.currentOffers?.seed?.message ?? null },
      partner: { status: match.currentOffers?.partner?.status,
        message: match.currentOffers?.partner?.message ?? null } })),
    currentOfferPair: anyCurrentPair, supportedCurrentOfferPair: Boolean(current),
    concepts, proposalSaved,
    savedAssessments: stored.rows.length, catalogProductArraySaved }));
  const proposalExpected = Boolean(current);
  const requireSupported = process.env.COMMERCE_REQUIRE_SUPPORTED === "1";
  if (!run.matches.length || !anyCurrentPair || catalogProductArraySaved ||
      (requireSupported && !current) ||
      (proposalExpected && (!current || concepts !== 3 || !proposalSaved)) ||
      (!proposalExpected && !statuses.some((status) =>
        ["needs_verification", "unsupported"].includes(status)))) process.exitCode = 2;
} catch (error) {
  console.log(JSON.stringify({ acceptanceError: error?.message ?? error?.code ?? "unknown",
    at: error?.stack?.split("\n")?.[1]?.trim() ?? null }));
  process.exitCode = 2;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await db.end();
  // Provider/database modules keep idle pools open; the temporary-user check is complete.
  process.exit(process.exitCode ?? 0);
}
