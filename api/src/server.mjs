import { createServer } from "node:http";
import { invokeResearchWorker } from "./research-dispatch.mjs";
import { verifiedUser } from "./auth.mjs";
import { normalizeQlooBrands, matchingQlooBrandCandidates } from "./brand-resolution.mjs";
import { persistSelectedBrand, persistVerifiedCommerceSite,
  recentConfirmedCommerceBrand, verifiedWebsitesForQlooIds } from "./catalog.mjs";
import { personalQlooDescribe } from "./personal-qloo.mjs";
import { verifySelectedCommerceBrand, verifyCommerceBusinessSite,
  reuseRecentCommerceConfirmation } from "./commerce-native.mjs";
import { previewCommerceSeedProducts, previewStartingBrandProducts } from "./commerce-preview.mjs";
import { purgeDueQlooResponses } from "./qloo-cache.mjs";
import { cachedBrandLookup, reserveBrandLookup, completeBrandLookup, openBrandLookup,
  consumeBrandLookup, recordSeedConfirmation, hasRecentSeedConfirmation,
  purgeRequestState } from "./request-state.mjs";
import { listProjects, getProject, createProject, updateProject, knownStartingBrand,
  ownsStartingBrand } from "./projects.mjs";
import { reviewQueue, recordReviewLabel, isAdmin } from "./review-queue.mjs";
import { startPersonalRun, listPersonalRuns, getPersonalRun, recordPersonalFeedback, updatePersonalFeedbackReason,
  updatePersonalBrief, createPersonalProposal, refreshPersonalMatch,
  researchPersonalMatchAudience, researchPersonalMatchLaunchAreas,
  workOnePersonalRun } from "./personal-research.mjs";

const port = Number(process.env.API_PORT ?? 8787);
const host = process.env.API_HOST ?? "127.0.0.1";
const userError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
if (process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.RESEARCH_WORKER_FUNCTION_NAME)
  throw new Error("RESEARCH_WORKER_FUNCTION_NAME is required for the API Lambda.");
let wakePersonalQueue = () => {};

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw userError("Request is too large.", 413);
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw userError("Please check the information you entered."); }
}

export const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  if (request.method === "GET" && pathname === "/health") return send(response, 200, { status: "ok" });
  const projectRoute = pathname.match(/^\/projects\/([a-f0-9-]{36})$/);
  const projectProductsRoute = pathname.match(/^\/projects\/([a-f0-9-]{36})\/commerce-products$/);
  const personalRunRoute = pathname.match(/^\/personal\/runs\/([a-f0-9-]{36})$/);
  const personalFeedbackRoute = pathname.match(/^\/personal\/feedback\/([a-f0-9-]{36})$/);
  const personalBriefRoute = pathname.match(/^\/personal\/briefs\/([a-f0-9-]{36})$/);
  const personalProposalRoute = pathname.match(/^\/personal\/matches\/([a-f0-9-]{36})\/proposal$/);
  const personalOfferRoute = pathname.match(/^\/personal\/matches\/([a-f0-9-]{36})\/current-offers$/);
  const personalAudienceRoute = pathname.match(/^\/personal\/matches\/([a-f0-9-]{36})\/audience-fit$/);
  const personalLaunchRoute = pathname.match(/^\/personal\/matches\/([a-f0-9-]{36})\/launch-areas$/);
  if (!(pathname === "/me" || pathname.startsWith("/entities/") || pathname === "/projects" ||
      projectRoute || projectProductsRoute || pathname.startsWith("/personal/"))) {
    return send(response, 404, { message: "Not found." });
  }
  try {
    const user = await verifiedUser(request);
    if (!user) return send(response, 401, { message: "Sign in to access personal research." });
    if (request.method === "GET" && pathname === "/me") return send(response, 200, { id: user.id,
      email: user.email, contextDiscoveryAvailable: process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED === "1" });
    if (pathname === "/personal/runs") {
      if (request.method === "POST") {
        const created = await startPersonalRun(user.id, await readJson(request));
        if (process.env.RESEARCH_WORKER_FUNCTION_NAME) {
          try { await invokeResearchWorker(created.runId); }
          catch (error) { process.stderr.write(`Research worker invoke failed: ${error instanceof Error ? error.message : String(error)}\n`); }
        } else wakePersonalQueue();
        return send(response, created.reused ? 200 : 202, created);
      }
      if (request.method === "GET") return send(response, 200,
        { runs: await listPersonalRuns(user.id, url.searchParams.get("projectId")) });
    }
    if (personalRunRoute && request.method === "GET") {
      const run = await getPersonalRun(user.id, personalRunRoute[1]);
      return send(response, run ? 200 : 404, run ? { run } : { message: "Research run not found." });
    }
    if (pathname === "/personal/feedback" && request.method === "POST") return send(response, 201,
      { feedback: await recordPersonalFeedback(user.id, await readJson(request)) });
    if (personalFeedbackRoute && request.method === "PATCH") {
      const feedback = await updatePersonalFeedbackReason(user.id, personalFeedbackRoute[1], await readJson(request));
      return send(response, feedback ? 200 : 404, feedback ? { feedback } : { message: "Feedback not found." });
    }
    // Developer review queue (exceptions only): admin accounts only; it does
    // not exist for anyone else. There is no review page in the app.
    if (pathname.startsWith("/personal/review/")) {
      if (!isAdmin(user)) return send(response, 404, { message: "Not found." });
      if (pathname === "/personal/review/queue" && request.method === "GET") {
        return send(response, 200, { items: await reviewQueue() });
      }
      if (pathname === "/personal/review/labels" && request.method === "POST") {
        return send(response, 201, { label: await recordReviewLabel(user.id, await readJson(request)) });
      }
      return send(response, 404, { message: "Not found." });
    }
    if (personalBriefRoute && request.method === "PATCH") return send(response, 200,
      { brief: await updatePersonalBrief(user.id, personalBriefRoute[1], await readJson(request)) });
    if (personalProposalRoute && request.method === "POST") {
      const proposal = await createPersonalProposal(user.id, personalProposalRoute[1], await readJson(request));
      return send(response, proposal.reused ? 200 : 201, { proposal });
    }
    if (personalOfferRoute && request.method === "GET") {
      const match = await refreshPersonalMatch(user.id, personalOfferRoute[1]);
      return send(response, match ? 200 : 404, match ? { match } : { message: "Opportunity not found." });
    }
    if (personalAudienceRoute && request.method === "GET") {
      const audience = await researchPersonalMatchAudience(user.id, personalAudienceRoute[1],
        { includeDemographics: url.searchParams.get("demographics") === "auto"
          ? "when_specific" : url.searchParams.get("demographics") === "1" });
      return send(response, audience ? 200 : 404, audience
        ? { audience } : { message: "Opportunity not found." });
    }
    if (personalLaunchRoute && request.method === "GET") {
      const launch = await researchPersonalMatchLaunchAreas(user.id, personalLaunchRoute[1]);
      return send(response, launch ? 200 : 404, launch ? { launch: { status: launch.status,
        market: launch.market, areas: launch.areas } } : { message: "Opportunity not found." });
    }
    if (pathname === "/projects") {
      if (request.method === "GET") return send(response, 200, { projects: await listProjects(user.id) });
      if (request.method === "POST") {
        const input = await readJson(request);
        // An owned brand (continuing from a project) needs no fresh confirmation.
        if (!await hasRecentSeedConfirmation(user.id, input.seedEntityId) &&
            !await ownsStartingBrand(user.id, input.seedEntityId)) return send(response, 400,
          { message: "Confirm the starting brand before creating a project." });
        const { reused, ...project } = await createProject(user.id, input);
        return send(response, reused ? 200 : 201, { project });
      }
    }
    const brandProductsRoute = pathname.match(/^\/entities\/([a-f0-9-]{36})\/commerce-products$/);
    if (brandProductsRoute && request.method === "GET") {
      // A project is created only when research starts, so the product step
      // searches the confirmed brand directly.
      if (!await hasRecentSeedConfirmation(user.id, brandProductsRoute[1]) &&
          !await ownsStartingBrand(user.id, brandProductsRoute[1])) return send(response, 400,
        { message: "Confirm the starting brand before choosing a product." });
      const market = url.searchParams.get("market")?.toUpperCase() ?? "US";
      return send(response, 200, await previewStartingBrandProducts(brandProductsRoute[1], market,
        { query: url.searchParams.get("query") ?? "" }));
    }
    if (projectProductsRoute && request.method === "GET") {
      const market = url.searchParams.get("market")?.toUpperCase() ?? "US";
      return send(response, 200, await previewCommerceSeedProducts(user.id,
        projectProductsRoute[1], market, { query: url.searchParams.get("query") ?? "" }));
    }
    if (projectRoute) {
      if (request.method === "GET") {
        const project = await getProject(user.id, projectRoute[1]);
        return send(response, project ? 200 : 404, project ? { project } : { message: "Project not found." });
      }
      if (request.method === "PATCH") {
        const project = await updateProject(user.id, projectRoute[1], await readJson(request));
        return send(response, project ? 200 : 404, project ? { project } : { message: "Project not found." });
      }
    }
    if (request.method === "POST" && pathname === "/entities/resolve") {
      const { name, purpose, market } = await readJson(request);
      if (!["commerce_seed", "commerce_partner"].includes(purpose)) return send(response, 400,
        { message: "Choose a brand partnership lookup." });
      const query = String(name ?? "").trim();
      if (query.length < 2 || query.length > 90) return send(response, 400,
        { message: "Enter a brand name between 2 and 90 characters." });
      // The user's own brand, already confirmed for this country: no new search or check.
      if (purpose === "commerce_seed" && typeof market === "string") {
        const known = await knownStartingBrand(user.id, query, market.toUpperCase());
        if (known) {
          await recordSeedConfirmation(user.id, known.id);
          return send(response, 200, { known });
        }
      }
      const cached = await cachedBrandLookup(user.id, purpose, query);
      if (cached) return send(response, 200, { ...cached, qloo: { ...cached.qloo,
        candidates: matchingQlooBrandCandidates(cached.qloo?.candidates, query) } });
      const lookupId = await reserveBrandLookup(user.id, purpose, query);
      if (!lookupId) return send(response, 429, { message: "Too many brand lookups. Try again later." });
      // Ask Qloo for brands only; without a type it matches any entity
      // ("Graza" resolved to a person, 27 Oct).
      const envelope = await personalQlooDescribe(user.id, { entity: query, type: "brand" });
      const result = { id: lookupId, query,
        qloo: { status: envelope.status,
          candidates: matchingQlooBrandCandidates(normalizeQlooBrands(envelope), query) },
        message: "Choose the cultural brand that matches the business you mean." };
      await completeBrandLookup(lookupId, user.id, result);
      return send(response, 200, result);
    }
    if (request.method === "POST" && pathname === "/entities/confirm-commerce-site") {
      if (process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED !== "1")
        return send(response, 404, { message: "This discovery path is not available yet." });
      const { name, website } = await readJson(request);
      if (!await reserveBrandLookup(user.id, "commerce_site", String(name ?? "").trim()))
        return send(response, 429, { message: "Too many brand lookups. Try again later." });
      const verified = await verifyCommerceBusinessSite({ name, website });
      if (!verified) return send(response, 409,
        { message: "The official website and product store could not be verified." });
      const entity = await persistVerifiedCommerceSite(verified);
      await recordSeedConfirmation(user.id, entity.id);
      return send(response, 200, { entity });
    }
    if (request.method === "POST" && pathname === "/entities/confirm") {
      const { resolutionId, qlooId, purpose, officialWebsite = null, market = "US" } = await readJson(request);
      const record = await openBrandLookup(resolutionId, user.id);
      if (!record) return send(response, 404, { message: "This brand search has expired. Search again." });
      if (purpose !== record.purpose) return send(response, 400,
        { message: "Choose a cultural brand for this commerce project." });
      const candidate = matchingQlooBrandCandidates(record.result.qloo?.candidates,
        record.query).find((item) => item.id === qlooId);
      if (!candidate) return send(response, 400, { message: "Choose a brand from these results." });
      const identityTrace = [];
      // A website another user already verified for this Qloo brand is the
      // first guess when Qloo lists none; it is verified again here.
      const knownWebsite = candidate.website ? null
        : (await verifiedWebsitesForQlooIds([candidate.id]).catch(() => new Map())).get(candidate.id) ?? null;
      const verified = await verifySelectedCommerceBrand({ qlooId: candidate.id,
        name: candidate.name, website: candidate.website ?? knownWebsite,
        market: /^[A-Z]{2}$/.test(String(market).toUpperCase()) ? String(market).toUpperCase() : "US",
        description: candidate.description }, officialWebsite, { trace: identityTrace });
      let entity;
      if (!verified) {
        if (process.env.DEBUG_PERSONAL_RUNS === "1") process.stderr.write(
          `Brand confirmation not verified: ${JSON.stringify(identityTrace.slice(0, 24))}\n`);
        const prior = await recentConfirmedCommerceBrand(candidate.id);
        entity = reuseRecentCommerceConfirmation(candidate, prior, officialWebsite);
        if (!entity) return send(response, 409,
          { message: "We couldn't confirm this brand's official store automatically. Enter its official website and confirm again." });
      } else entity = await persistSelectedBrand({ qloo: { ...candidate,
        website: verified.officialWebsite }, identityStatus: "verified",
        commerceProof: { qlooId: verified.qlooId,
          officialWebsite: verified.officialWebsite, shopId: verified.shopId,
          identitySourceUrl: verified.identitySourceUrl,
          storefrontProofUrl: verified.storefrontProofUrl } });
      if (purpose === "commerce_seed") await recordSeedConfirmation(user.id, entity.id);
      await consumeBrandLookup(resolutionId, user.id);
      return send(response, 200, { entity });
    }
    return send(response, 405, { message: "Unsupported request method." });
  } catch (error) {
    // Only errors marked with a status code are written for customers; any
    // other failure is internal and gets a generic message.
    const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 &&
      error.statusCode < 500 ? error.statusCode : 503;
    if (status === 503 && process.env.DEBUG_PERSONAL_RUNS === "1") process.stderr.write(
      `Request failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return send(response, status, { message: status === 503
      ? "Personal research is temporarily unavailable." : error.message });
  }
});

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  httpServer.listen(port, host, () => process.stdout.write(`CrossCulture API listening on ${host}:${port}\n`));
}

if (process.env.DATABASE_URL && !process.env.AWS_LAMBDA_FUNCTION_NAME &&
    !process.env.RESEARCH_WORKER_FUNCTION_NAME) {
  let working = false;
  let pendingWake = false;
  const processPersonalQueue = async () => {
    if (working) { pendingWake = true; return; }
    working = true;
    try {
      do {
        pendingWake = false;
        while (await workOnePersonalRun()) {}
      } while (pendingWake);
    }
    catch (error) { if (process.env.DEBUG_PERSONAL_RUNS === "1")
      process.stderr.write(`Personal worker unavailable: ${error instanceof Error ? error.message : String(error)}\n`); }
    finally { working = false; }
  };
  wakePersonalQueue = () => { void processPersonalQueue(); };
  void processPersonalQueue();
  setInterval(processPersonalQueue, 60_000).unref();
  void purgeDueQlooResponses(100).catch((error) =>
    process.stderr.write(`Qloo retention purge failed: ${error instanceof Error ? error.message : "unknown error"}\n`));
  setInterval(() => void purgeDueQlooResponses(100).catch(() => {}), 15 * 60 * 1000).unref();
  setInterval(() => void purgeRequestState().catch(() => {}), 15 * 60 * 1000).unref();
}
