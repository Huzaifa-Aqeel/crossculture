import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { verifiedUser } from "./auth.mjs";
import { normalizeQlooBrands } from "./brand-resolution.mjs";
import { persistSelectedBrand, persistVerifiedCommerceSite } from "./catalog.mjs";
import { personalQlooDescribe } from "./personal-qloo.mjs";
import { startYoutubeRun, getYoutubeRun, listYoutubeRuns, workOneYoutubeRun,
  purgeYoutubeResearch } from "./youtube-research.mjs";
import { verifySelectedCommerceBrand, verifyCommerceBusinessSite } from "./commerce-native.mjs";
import { previewCommerceSeedProducts } from "./commerce-preview.mjs";
import { purgeDueQlooResponses } from "./qloo-cache.mjs";
import { listProjects, getProject, createProject, updateProject } from "./projects.mjs";
import { startPersonalRun, listPersonalRuns, getPersonalRun, recordPersonalFeedback,
  undoPersonalFeedback, updatePersonalBrief, createPersonalProposal, refreshPersonalMatch,
  researchPersonalMatchAudience, workOnePersonalRun } from "./personal-research.mjs";

const port = Number(process.env.API_PORT ?? 8787);
const host = process.env.API_HOST ?? "127.0.0.1";
const brandResolutions = new Map();
const confirmedBrands = new Map();
const lookupCounts = new Map();

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("Request is too large.");
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("Please check the information you entered."); }
}

function recentLookups(key) {
  const recent = (lookupCounts.get(key) ?? []).filter((time) => Date.now() - time < 60 * 60_000);
  lookupCounts.set(key, recent);
  return recent;
}

createServer(async (request, response) => {
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
  const youtubeRunRoute = pathname.match(/^\/youtube\/runs\/([a-f0-9-]{36})$/);
  if (!(pathname === "/me" || pathname.startsWith("/entities/") || pathname === "/projects" ||
      projectRoute || projectProductsRoute || pathname.startsWith("/personal/") ||
      pathname === "/youtube/runs" || youtubeRunRoute)) {
    return send(response, 404, { message: "Not found." });
  }
  try {
    const user = await verifiedUser(request);
    if (!user) return send(response, 401, { message: "Sign in to access personal research." });
    if (request.method === "GET" && pathname === "/me") return send(response, 200, { id: user.id,
      email: user.email, contextDiscoveryAvailable: process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED === "1" });
    if (pathname === "/youtube/runs") {
      if (request.method === "GET") return send(response, 200, { runs: await listYoutubeRuns(user.id) });
      if (request.method === "POST") {
        const input = await readJson(request);
        const record = brandResolutions.get(input.resolutionId);
        if (!record || record.userId !== user.id || record.purpose !== "youtube_seed" ||
            Date.now() - record.createdAt > 15 * 60_000) return send(response, 400,
          { message: "This brand search has expired. Search again." });
        const candidate = record.result.qloo.candidates.find((item) => item.id === input.qlooId);
        if (!candidate) return send(response, 400, { message: "Choose a brand from these results." });
        const result = await startYoutubeRun(user.id, { brandName: candidate.name,
          brandQlooId: candidate.id, campaignMode: input.campaignMode ?? "ongoing" });
        brandResolutions.delete(input.resolutionId);
        return send(response, 202, result);
      }
    }
    if (youtubeRunRoute && request.method === "GET") {
      const run = await getYoutubeRun(user.id, youtubeRunRoute[1]);
      return send(response, run ? 200 : 404, run ? { run } : { message: "Research run not found." });
    }
    if (pathname === "/personal/runs") {
      if (request.method === "POST") {
        const created = await startPersonalRun(user.id, await readJson(request));
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
    if (personalFeedbackRoute && request.method === "DELETE") {
      const undone = await undoPersonalFeedback(user.id, personalFeedbackRoute[1]);
      return send(response, undone ? 200 : 404, undone ? { undone: true } : { message: "Feedback not found." });
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
    if (pathname === "/projects") {
      if (request.method === "GET") return send(response, 200, { projects: await listProjects(user.id) });
      if (request.method === "POST") {
        const input = await readJson(request);
        const confirmation = confirmedBrands.get(user.id);
        if (!confirmation || confirmation.entityId !== input.seedEntityId ||
            Date.now() - confirmation.at > 30 * 60_000) return send(response, 400,
          { message: "Confirm the starting brand before creating a project." });
        return send(response, 201, { project: await createProject(user.id, input) });
      }
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
      const { name, purpose } = await readJson(request);
      if (!["commerce_seed", "commerce_partner", "youtube_seed"].includes(purpose)) return send(response, 400,
        { message: "Choose a brand partnership lookup." });
      const query = String(name ?? "").trim();
      if (query.length < 2 || query.length > 90) return send(response, 400,
        { message: "Enter a brand name between 2 and 90 characters." });
      const cached = [...brandResolutions.values()].find((item) => item.userId === user.id &&
        item.purpose === purpose && item.result.query.toLowerCase() === query.toLowerCase() &&
        Date.now() - item.createdAt < 10 * 60_000);
      if (cached) return send(response, 200, cached.result);
      const recent = recentLookups(user.id);
      if (recent.length >= 10) return send(response, 429, { message: "Too many brand lookups. Try again later." });
      lookupCounts.set(user.id, [...recent, Date.now()]);
      const envelope = await personalQlooDescribe(user.id, { entity: query });
      const result = { id: randomUUID(), query,
        qloo: { status: envelope.status, candidates: normalizeQlooBrands(envelope) },
        message: "Choose the cultural brand that matches the business you mean." };
      brandResolutions.set(result.id, { userId: user.id, purpose, result, createdAt: Date.now() });
      return send(response, 200, result);
    }
    if (request.method === "POST" && pathname === "/entities/confirm-commerce-site") {
      if (process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED !== "1")
        return send(response, 404, { message: "This discovery path is not available yet." });
      const recent = recentLookups(user.id);
      if (recent.length >= 10) return send(response, 429, { message: "Too many brand lookups. Try again later." });
      lookupCounts.set(user.id, [...recent, Date.now()]);
      const { name, website } = await readJson(request);
      const verified = await verifyCommerceBusinessSite({ name, website });
      if (!verified) return send(response, 409,
        { message: "The official website and product store could not be verified." });
      const entity = await persistVerifiedCommerceSite(verified);
      confirmedBrands.set(user.id, { entityId: entity.id, at: Date.now() });
      return send(response, 200, { entity });
    }
    if (request.method === "POST" && pathname === "/entities/confirm") {
      const { resolutionId, qlooId, purpose, officialWebsite = null } = await readJson(request);
      const record = brandResolutions.get(resolutionId);
      if (!record || record.userId !== user.id || Date.now() - record.createdAt > 15 * 60_000)
        return send(response, 404, { message: "This brand search has expired. Search again." });
      if (purpose !== record.purpose) return send(response, 400,
        { message: "Choose a cultural brand for this commerce project." });
      const candidate = record.result.qloo.candidates.find((item) => item.id === qlooId);
      if (!candidate) return send(response, 400, { message: "Choose a brand from these results." });
      const verified = await verifySelectedCommerceBrand({ qlooId: candidate.id,
        name: candidate.name, website: candidate.website,
        description: candidate.description }, officialWebsite);
      if (!verified) return send(response, 409,
        { message: "The brand's official website and product store could not be verified yet. Check the website and try again." });
      const entity = await persistSelectedBrand({ qloo: { ...candidate,
        website: verified.officialWebsite }, identityStatus: "verified" });
      if (purpose === "commerce_seed") confirmedBrands.set(user.id, { entityId: entity.id, at: Date.now() });
      brandResolutions.delete(resolutionId);
      return send(response, 200, { entity });
    }
    return send(response, 405, { message: "Unsupported request method." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Brand lookup is unavailable.";
    const known = /^(Enter |Choose |Check |Confirm |Select |A verified |The official |The brand's |This |Too many |Partnership not found|Feedback not found|Brief not found|Project not found|Research run not found|Today's )/.test(message);
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : known ? 400 : 503;
    return send(response, status, { message: status === 503 ? "Personal research is temporarily unavailable." : message });
  }
}).listen(port, host, () => process.stdout.write(`CrossCulture API listening on ${host}:${port}\n`));

setInterval(() => {
  for (const [id, record] of brandResolutions)
    if (record.createdAt < Date.now() - 15 * 60_000) brandResolutions.delete(id);
  for (const [id, record] of confirmedBrands)
    if (record.at < Date.now() - 30 * 60_000) confirmedBrands.delete(id);
  for (const [id, times] of lookupCounts) {
    const recent = times.filter((time) => time > Date.now() - 60 * 60_000);
    if (recent.length) lookupCounts.set(id, recent);
    else lookupCounts.delete(id);
  }
}, 60 * 60 * 1000).unref();

if (process.env.DATABASE_URL) {
  let working = false;
  let youtubeWorking = false;
  const processPersonalQueue = async () => {
    if (working) return;
    working = true;
    try { for (let i = 0; i < 3 && await workOnePersonalRun(); i += 1) {} }
    catch (error) { if (process.env.DEBUG_PERSONAL_RUNS === "1")
      process.stderr.write(`Personal worker unavailable: ${error instanceof Error ? error.message : String(error)}\n`); }
    finally { working = false; }
  };
  void processPersonalQueue();
  setInterval(processPersonalQueue, 3000).unref();
  const processYoutubeQueue = async () => {
    if (youtubeWorking) return;
    youtubeWorking = true;
    try { await workOneYoutubeRun(); }
    catch (error) { if (process.env.DEBUG_PERSONAL_RUNS === "1")
      process.stderr.write(`Video research worker unavailable: ${error instanceof Error ? error.message : String(error)}\n`); }
    finally { youtubeWorking = false; }
  };
  void processYoutubeQueue();
  setInterval(processYoutubeQueue, 5000).unref();
  void purgeYoutubeResearch().catch(() => {});
  setInterval(() => void purgeYoutubeResearch().catch(() => {}), 60 * 60 * 1000).unref();
  void purgeDueQlooResponses(100).catch((error) =>
    process.stderr.write(`Qloo retention purge failed: ${error instanceof Error ? error.message : "unknown error"}\n`));
  setInterval(() => void purgeDueQlooResponses(100).catch(() => {}), 15 * 60 * 1000).unref();
}
