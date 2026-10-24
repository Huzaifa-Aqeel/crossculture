// Temporary-user live audit of the gated non-native path. No partner, cultural
// reference, or provider result is supplied by this harness.
import { readFile } from "node:fs/promises";
import { randomInt, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { catalogClient, discoverVerifiedStorefront } from "../src/shopify-catalog.mjs";
import { proposeProductContextReferences, resolvedContextSignal } from "../src/commerce-context.mjs";
import { personalQlooFindTags, personalQlooResolveNamedEntity } from "../src/personal-qloo.mjs";
import { transientProductFacts } from "../src/commerce-products.mjs";
import { selectedProductPage } from "../src/commerce-product-page.mjs";
import pg from "pg";

const [brand, website, objective = "product_bundle", indexArg, productQuery = ""] = process.argv.slice(2);
if (!brand || !/^https:\/\//.test(website ?? "") ||
    !["product_bundle", "cross_sell"].includes(objective)) {
  throw new Error("Usage: node check-commerce-context-live.mjs <brand> <https://official-site> [product_bundle|cross_sell] [product-index]");
}
const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ??
  "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const at = line.indexOf("=");
  return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:")) throw new Error("Local Supabase only.");
const options = { auth: { autoRefreshToken: false, persistSession: false,
  detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const owner = createClient(vars.API_URL, vars.ANON_KEY, options);
const email = `commerce-context-${randomUUID().slice(0, 8)}@example.test`;
const password = `LocalCheck-${randomUUID()}!`;
let userId;
let token;
const report = (stage, details) => console.log(JSON.stringify({ stage, ...details }));
async function api(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:8787${path}`, { method,
    headers: { authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${value.message ?? "error"}`);
  return value;
}
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const signIn = await owner.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  token = signIn.data.session.access_token;
  report("auth", { signedIn: (await api("/me")).id === userId });
  const resolution = await api("/entities/resolve", "POST", {
    name: brand, purpose: "commerce_seed" });
  const exact = resolution.qloo?.candidates?.find((candidate) =>
    normalized(candidate.name) === normalized(brand));
  report("qloo_seed_resolution", { status: resolution.qloo?.status,
    exactNativeBrand: Boolean(exact), candidateCount: resolution.qloo?.candidates?.length ?? 0 });
  if (exact) throw new Error("Seed has a native Qloo brand result; choose a non-native seed.");
  const confirmed = await api("/entities/confirm-commerce-site", "POST", { name: brand, website });
  report("official_seed", { verified: confirmed.entity.identityStatus === "verified" });
  const project = (await api("/projects", "POST", { seedEntityId: confirmed.entity.id,
    name: `${brand} context audit`, objective })).project;
  const preview = await api(`/projects/${project.id}/commerce-products?market=US&query=${encodeURIComponent(productQuery)}`);
  const products = preview.products ?? [];
  const eligible = products.filter((item) => item.available === true);
  const pool = eligible.length ? eligible : products;
  report("selected_product_preview", { coverage: preview.coverage,
    observedCount: products.length, eligibleCount: eligible.length });
  if (!pool.length) throw new Error("No current selected product available from verified storefront.");
  const selectedIndex = indexArg === undefined ? randomInt(pool.length) : Number(indexArg);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= pool.length)
    throw new Error("Selected product index is outside current preview.");
  const heroProduct = { productId: pool[selectedIndex].productId,
    variantId: pool[selectedIndex].variantId };
  report("product_focus", { selectedIndex, availableAtPreview: pool[selectedIndex].available });
  // Inspect only the selected detail and the source-backed Qloo query inputs.
  // Neither the Catalog search payload nor product images are logged or saved.
  const store = await discoverVerifiedStorefront(website);
  const catalog = catalogClient({ maxCalls: 8 });
  let selectedDetail;
  for (const domain of [...new Set([store.domain, store.endpointHost, "global"].filter(Boolean))]) {
    const tools = await catalog.tools(domain).catch(() => null);
    if (!tools?.has("get_product") && !tools?.has("lookup_catalog")) continue;
    try {
      selectedDetail = await catalog.detail(domain, heroProduct.productId,
        heroProduct.variantId, null, tools, { market: "US",
          expectedSellerId: domain === "global" ? store.shopId : null });
      break;
    } catch { /* The actual run will report exact-detail coverage. */ }
  }
  if (selectedDetail) {
    const facts = transientProductFacts(selectedDetail.product, selectedDetail.variant, true);
    report("source_field_coverage", { titleChars: facts.title.length,
      merchantDescriptionChars: facts.description.length });
    const sourcePage = facts.description ? null : await selectedProductPage(
      selectedDetail.product, website, store.domain);
    const referenceProduct = sourcePage ? { ...selectedDetail.product,
      description: { plain: sourcePage.description } } : selectedDetail.product;
    report("official_page_coverage", { productPageUsed: Boolean(sourcePage),
      productPageDescriptionChars: sourcePage?.description?.length ?? 0 });
    const references = await proposeProductContextReferences(referenceProduct,
      selectedDetail.variant).catch(() => []);
    report("source_context", { referenceCount: references.length,
      references: references.map((reference) => ({ query: reference.query,
        kind: reference.kind })) });
    for (const reference of references) {
      const resolution = reference.kind === "tag"
        ? await personalQlooFindTags(userId, reference.query).catch(() => null)
        : await personalQlooResolveNamedEntity(userId, reference.query).catch(() => null);
      report("qloo_context_resolution", { query: reference.query, kind: reference.kind,
        status: resolution?.status ?? resolution?.envelope?.status ?? "unavailable",
        exactSignal: Boolean(resolvedContextSignal(reference, resolution)) });
    }
  } else report("source_context", { selectedDetailUnavailable: true });
  const started = await api("/personal/runs", "POST", { projectId: project.id,
    partnerType: "brand", mode: "discovery", researchMode: "live_commerce", market: "US",
    commerceRequirements: { heroProduct }, idempotencyKey: randomUUID() });
  report("run_started", { objective });
  let state;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const history = await api(`/personal/runs?projectId=${project.id}`);
    state = history.runs.find((item) => item.id === started.runId);
    if (!["queued", "running"].includes(state?.status)) break;
    if (attempt % 10 === 0) report("run_progress", { status: state?.status, stageName: state?.stage });
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (["queued", "running"].includes(state?.status)) throw new Error("Context run timed out.");
  const run = (await api(`/personal/runs/${started.runId}`)).run;
  report("run_finished", { status: run.status, coverage: run.result?.coverage,
    stopReason: run.result?.stopReason, discoveryReturnedCount: run.result?.discoveryReturnedCount,
    contextStages: run.result?.contextStages,
    catalogCallsUsed: run.result?.catalogCallsUsed, opportunityCount: run.matches?.length ?? 0,
    candidates: run.result?.candidates?.map((item) => ({ name: item.name,
      status: item.status, coverage: item.coverage, coverageIssues: item.coverageIssues })) ?? [],
    outcomes: Object.fromEntries(["supported", "needs_verification", "unsupported"].map((status) =>
      [status, run.matches?.filter((item) => item.score?.status === status).length ?? 0])) });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const traced = await db.query(`select context_json, normalized_result_json,
      provider_status from private.qloo_responses where owner_user_id=$1
      and operation='qloo_find_tags' order by collected_at`, [userId]);
    report("qloo_query_trace", { queries: traced.rows.map((row) => ({
      query: row.context_json.query, status: row.provider_status,
      exactNames: (row.normalized_result_json.results ?? []).filter((item) =>
        String(item.name ?? "").toLowerCase() ===
          String(row.context_json.query ?? "").toLowerCase()).map((item) =>
        ({ name: item.name, id: item.id })) })) });
  } finally { await db.end().catch(() => {}); }
} catch (error) {
  report("error", { message: error.message });
  process.exitCode = 2;
} finally {
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    report("cleanup", { temporaryUserDeleted: !removed.error });
  }
  process.exit(process.exitCode ?? 0);
}
