// Live acceptance run through the public API. The command-line seed is the only
// research input; no partner, product, variant, or provider result is injected.
import { readFile } from "node:fs/promises";
import { randomInt, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const argumentsList = process.argv.slice(2);
const objectiveFlag = argumentsList.find((value) => value.startsWith("--objectives="));
const officialWebsiteFlag = argumentsList.find((value) => value.startsWith("--official-website="));
const productQueryFlag = argumentsList.find((value) => value.startsWith("--product-query="));
const focusIndexFlag = argumentsList.find((value) => value.startsWith("--focus-index="));
const audit = argumentsList.includes("--audit");
const focusRandom = argumentsList.includes("--focus-random");
const confirmOnly = argumentsList.includes("--confirm-only");
const previewOnly = argumentsList.includes("--preview-only");
const brand = argumentsList.filter((value) => !value.startsWith("--objectives=") &&
  !value.startsWith("--official-website=") &&
  !value.startsWith("--product-query=") && value !== "--audit" && value !== "--focus-random" &&
  !value.startsWith("--focus-index=") &&
  value !== "--confirm-only" && value !== "--preview-only")
  .join(" ").trim();
if (!brand) throw new Error("Pass an ordinary starting brand name.");
const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:")) throw new Error("Local Supabase only.");
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const owner = createClient(vars.API_URL, vars.ANON_KEY, options);
const auditDb = audit ? new pg.Pool({ connectionString: vars.DB_URL, max: 1 }) : null;
const auditStartedAt = new Date();
const base = "http://127.0.0.1:8787";
const email = `commerce-blind-${randomUUID().slice(0, 8)}@example.test`;
const password = `LocalCheck-${randomUUID()}!`;
const events = [];
let userId;
let token;
const report = (stage, value) => { const entry = { stage, ...value }; events.push(entry); console.log(JSON.stringify(entry)); };
async function tavilyAudit(stage) {
  if (!auditDb) return;
  const [usage, searches] = await Promise.all([
    auditDb.query(`select payload_json->>'operation' as operation,
      payload_json->>'status' as status,count(*)::integer as calls
      from private.provider_cache where provider='web' and resource_type='usage'
        and fetched_at >= $1 group by 1,2 order by 1,2`, [auditStartedAt]),
    auditDb.query(`select resource_key from private.provider_cache
      where provider='web' and resource_type='search' and fetched_at >= $1
      order by fetched_at`, [auditStartedAt]),
  ]);
  report(stage, { freshProviderRequests: usage.rows,
    freshSearchQueries: searches.rows.map((row) => row.resource_key) });
}
async function developerRunTrace(runId) {
  if (!auditDb) return null;
  const result = await auditDb.query(`select result_json->'candidates' as candidates,
    result_json->>'catalogCallsUsed' as "catalogCallsUsed",
    result_json->>'discoveryReturnedCount' as "discoveryReturnedCount"
    from public.analysis_runs where id=$1`, [runId]);
  return result.rows[0] ?? null;
}
async function api(path, method = "GET", body) {
  const response = await fetch(base + path, { method, headers: {
    authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
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
  if (audit) await tavilyAudit("tavily_before");

  const resolution = await api("/entities/resolve", "POST", { name: brand, purpose: "commerce_seed" });
  const candidates = resolution.qloo?.candidates ?? [];
  report("brand_search", { query: brand, status: resolution.qloo?.status,
    candidates: candidates.map(({ name, website }) => ({ name, website })) });
  const exact = candidates.find((item) => normalized(item.name) === normalized(brand));
  if (!exact) throw new Error("No exact native cultural brand found; no candidate substituted.");
  const confirmed = await api("/entities/confirm", "POST", {
    resolutionId: resolution.id, qlooId: exact.id, purpose: "commerce_seed",
    ...(officialWebsiteFlag ? { officialWebsite: officialWebsiteFlag.slice("--official-website=".length) } : {}) });
  report("brand_confirm", { name: confirmed.entity.name, website: confirmed.entity.canonicalUrl,
    identityStatus: confirmed.entity.identityStatus });

  let discoveredPartnerName = process.env.COMMERCE_BLIND_DIRECT_PARTNER ?? null;
  const objectives = confirmOnly ? [] : (objectiveFlag?.slice("--objectives=".length) ??
    process.env.COMMERCE_BLIND_OBJECTIVES)?.split(",").filter(Boolean) ??
    ["product_bundle", "cross_sell"];
  if ((!objectives.length && !confirmOnly) || objectives.some((value) =>
    !["product_bundle", "cross_sell"].includes(value))) {
    throw new Error("Choose product_bundle or cross_sell objectives.");
  }
  for (const objective of objectives) {
    const project = (await api("/projects", "POST", { seedEntityId: confirmed.entity.id,
      name: `${brand} ${objective} blind test`, objective })).project;
    report("project", { objective, projectCreated: Boolean(project.id) });
    if (previewOnly) {
      const query = productQueryFlag?.slice("--product-query=".length) ?? "";
      const preview = await api(`/projects/${project.id}/commerce-products?market=US&query=${encodeURIComponent(query)}`);
      report("product_search", { objective, query, coverage: preview.coverage,
        products: (preview.products ?? []).map((item) => ({ title: item.title,
          variantTitle: item.variantTitle, selectedOptions: item.selectedOptions,
          url: item.url, available: item.available })) });
      continue;
    }
    let heroProduct;
    if (focusRandom) {
      const query = productQueryFlag?.slice("--product-query=".length) ?? "";
      if (!query) throw new Error("Focused live tests require --product-query after the product-only chooser.");
      const preview = await api(`/projects/${project.id}/commerce-products?market=US&query=${encodeURIComponent(query)}`);
      const products = preview.products ?? [];
      const eligible = products.filter((item) => item.available === true);
      const pool = eligible.length ? eligible : products;
      if (!pool.length) throw new Error(`No verified starting product to focus; ${preview.coverage}.`);
      const requestedIndex = focusIndexFlag ? Number(focusIndexFlag.slice("--focus-index=".length)) : null;
      if (focusIndexFlag && (!Number.isInteger(requestedIndex) || requestedIndex < 0 ||
          requestedIndex >= pool.length)) throw new Error("The requested product index is unavailable.");
      const selectedIndex = focusIndexFlag ? requestedIndex : randomInt(pool.length);
      heroProduct = { productId: pool[selectedIndex].productId,
        variantId: pool[selectedIndex].variantId };
      report("product_focus", { objective, coverage: preview.coverage,
        observedCount: products.length, selectedIndex, productTitle: pool[selectedIndex].title,
        availableAtPreview: pool[selectedIndex].available });
    }
    const started = await api("/personal/runs", "POST", { projectId: project.id,
      partnerType: "brand", mode: "discovery", researchMode: "live_commerce", market: "US",
      ...(heroProduct ? { commerceRequirements: { heroProduct } } : {}),
      idempotencyKey: randomUUID() });
    report("run_started", { objective, runId: started.runId });
    let state;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const history = await api(`/personal/runs?projectId=${project.id}`);
      state = history.runs.find((item) => item.id === started.runId);
      if (!["queued", "running"].includes(state?.status)) break;
      if (attempt % 10 === 0) report("run_progress", { objective, status: state?.status, stageName: state?.stage });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (["queued", "running"].includes(state?.status)) throw new Error(`${objective} timed out at ${state?.stage}`);
    const run = (await api(`/personal/runs/${started.runId}`)).run;
    const developerTrace = await developerRunTrace(started.runId);
    discoveredPartnerName ??= run.matches[0]?.partnerName ?? null;
    const counts = Object.fromEntries(["supported", "needs_verification", "unsupported"]
      .map((status) => [status, run.matches.filter((item) => item.score?.status === status).length]));
    report("run_finished", { objective, status: run.status, stopReason: run.result?.stopReason,
      coverage: run.result?.coverage, catalogCallsUsed: developerTrace?.catalogCallsUsed ?? null,
      opportunityCount: run.matches.length, outcomes: counts,
      top: run.matches.slice(0, 4).map((item) => ({ partner: item.partnerName,
        outcome: item.score?.status, savedOutcome: item.savedScore?.status,
        culturalRelationship: item.score?.culturalRelationship,
        reasonCodes: item.score?.reasonCodes,
        seedOffer: item.currentOffers?.seed?.status,
        partnerOffer: item.currentOffers?.partner?.status,
        seedProduct: item.currentOffers?.seed?.title,
        partnerProduct: item.currentOffers?.partner?.title })) });
    if (audit) report("opportunity_audit", { objective,
      candidates: developerTrace?.candidates?.map((item) => ({ name: item.name,
        qlooOrder: item.originalQlooOrder, status: item.status,
        productSearchPlanning: item.productSearchPlanning,
        inspectedQueries: item.inspectedQueries,
        observedCandidateCount: item.observedCandidateCount,
        searchPagesFetched: item.searchPagesFetched,
        recommendableCount: item.recommendableCount,
        assessedCount: item.assessedCount, hypothesesConsidered: item.hypothesesConsidered,
        catalogCallsUsed: item.catalogCallsUsed, stopReason: item.stopReason })) ?? [],
      pairs: run.matches.map((item) => ({ partner: item.partnerName,
        outcome: item.score?.status, reasonCodes: item.score?.reasonCodes,
        roles: item.savedScore?.productMechanism?.roles,
        rationale: item.savedScore?.productMechanism?.boundedRationale,
        reviewFlags: item.savedScore?.reviewFlags,
        externalSourceRefs: item.evidence?.commerce?.externalSourceRefs,
        seedProduct: item.currentOffers?.seed?.title,
        partnerProduct: item.currentOffers?.partner?.title,
        seedUrl: item.currentOffers?.seed?.url,
        partnerUrl: item.currentOffers?.partner?.url,
        seedOffer: item.currentOffers?.seed?.status,
        partnerOffer: item.currentOffers?.partner?.status })) });
    if (audit) for (const item of run.matches.filter((match) =>
      match.score?.status === "needs_verification").slice(0, 2)) {
      const checked = await api(`/personal/matches/${item.id}/current-offers`).catch((error) => ({
        error: error.message }));
      report("unresolved_pair_audit", { objective, partner: item.partnerName,
        reasonCodes: item.savedScore?.reasonCodes,
        roles: item.savedScore?.productMechanism?.roles,
        rationale: item.savedScore?.productMechanism?.boundedRationale,
        currentSeed: checked.match?.currentOffers?.seed?.title,
        currentPartner: checked.match?.currentOffers?.partner?.title,
        refreshError: checked.error ?? null });
    }
    const chosen = run.matches.find((item) => item.score?.status === "supported" &&
      item.currentOffers?.seed?.status === "current" && item.currentOffers?.partner?.status === "current");
    if (!chosen) continue;
    const feedback = (await api("/personal/feedback", "POST", {
      runId: run.id, matchId: chosen.id, action: "save" })).feedback;
    report("saved", { objective, partner: chosen.partnerName, feedbackSaved: Boolean(feedback.id) });
    const conceptResponse = (await api(`/personal/matches/${chosen.id}/proposal`, "POST", {})).proposal;
    report("concepts", { objective, count: conceptResponse.concepts?.length ?? 0,
      titles: conceptResponse.concepts?.map((item) => item.title) ?? [] });
    if (audit) report("concept_audit", { objective, concepts: conceptResponse.concepts?.map((item) => ({
      title: item.title, format: item.format, summary: item.draft?.summary,
      validation: item.draft?.validation, evidenceRefs: item.draft?.evidenceRefs })) ?? [] });
    if (conceptResponse.concepts?.length === 3) {
      const brief = (await api(`/personal/matches/${chosen.id}/proposal`, "POST", {
        conceptId: conceptResponse.concepts[0].id })).proposal;
      const edited = (await api(`/personal/briefs/${brief.id}`, "PATCH", {
        revision: brief.revision, markdown: `${brief.markdown}\n\nJudge edit: ask the partner to review this idea.`,
      })).brief;
      report("proposal", { objective, created: Boolean(brief.id), editedRevision: edited.revision });
    }
    await owner.auth.signOut();
    const again = await owner.auth.signInWithPassword({ email, password });
    if (again.error) throw again.error;
    token = again.data.session.access_token;
    const reloaded = (await api(`/personal/runs/${started.runId}`)).run;
    const match = reloaded.matches.find((item) => item.id === chosen.id);
    report("reload", { objective, found: Boolean(match), saved: Boolean(match?.savedAt),
      briefPersisted: Boolean(match?.briefId), currentSeed: match?.currentOffers?.seed?.status,
      currentPartner: match?.currentOffers?.partner?.status });
  }
  if (process.env.COMMERCE_BLIND_COMPARE === "1" && discoveredPartnerName) {
    const partnerResolution = await api("/entities/resolve", "POST", {
      name: discoveredPartnerName, purpose: "commerce_partner" });
    const choice = partnerResolution.qloo?.candidates?.find((item) =>
      normalized(item.name) === normalized(discoveredPartnerName));
    if (!choice) throw new Error("Discovered partner was not selectable in Compare Two Brands.");
    const partner = (await api("/entities/confirm", "POST", {
      resolutionId: partnerResolution.id, qlooId: choice.id, purpose: "commerce_partner",
    })).entity;
    const project = (await api("/projects", "POST", { seedEntityId: confirmed.entity.id,
      name: `${brand} direct comparison blind test`, objective: "product_bundle" })).project;
    const started = await api("/personal/runs", "POST", { projectId: project.id,
      partnerType: "brand", mode: "direct_pair", partnerEntityId: partner.id,
      researchMode: "live_commerce", market: "US", idempotencyKey: randomUUID() });
    report("direct_started", { partner: discoveredPartnerName, runId: started.runId });
    let state;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const history = await api(`/personal/runs?projectId=${project.id}`);
      state = history.runs.find((item) => item.id === started.runId);
      if (!["queued", "running"].includes(state?.status)) break;
      if (attempt % 10 === 0) report("direct_progress", { status: state?.status, stageName: state?.stage });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (["queued", "running"].includes(state?.status)) throw new Error("Direct comparison timed out.");
    const run = (await api(`/personal/runs/${started.runId}`)).run;
    report("direct_finished", { status: run.status, partner: discoveredPartnerName,
      coverage: run.result?.coverage, stopReason: run.result?.stopReason,
      opportunityCount: run.matches.length,
      outcomes: Object.fromEntries(["supported", "needs_verification", "unsupported"].map((status) =>
        [status, run.matches.filter((item) => item.score?.status === status).length])),
      reasonCodes: [...new Set(run.matches.flatMap((item) => item.score?.reasonCodes ?? []))],
      currentOfferPairs: run.matches.filter((item) => item.currentOffers?.seed?.status === "current" &&
        item.currentOffers?.partner?.status === "current").length });
  }
} catch (error) {
  report("error", { message: error.message });
  process.exitCode = 2;
} finally {
  if (audit) await tavilyAudit("tavily_after").catch((error) =>
    report("tavily_audit_error", { message: error.message }));
  if (auditDb) await auditDb.end();
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    report("cleanup", { temporaryUserDeleted: !removed.error });
  }
  process.exit(process.exitCode ?? 0);
}
