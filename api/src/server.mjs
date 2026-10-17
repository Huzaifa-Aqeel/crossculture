import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { discover } from "./discovery.mjs";
import { analyzePair } from "./pairs.mjs";
import { developConcepts } from "./concepts.mjs";
import { feedbackScope } from "./planning.mjs";
import { verifiedUser } from "./auth.mjs";
import { resolveBrand, selectResolvedBrand } from "./brand-resolution.mjs";
import { persistSelectedBrand } from "./catalog.mjs";
import { qlooCall } from "./qloo.mjs";
import { personalQlooDescribe } from "./personal-qloo.mjs";
import { selectedWikidataBrand } from "./brand-resolution.mjs";
import { selectedDemoBrand } from "./demo-identity.mjs";
import { purgeDueQlooResponses } from "./qloo-cache.mjs";
import { purgeDueYouTubeSources, purgeDuePersonalYouTubeSources,
  purgeDueCreatorObservations } from "./youtube-retention.mjs";
import { purgeDueYoutubeRequests } from "./youtube-request-store.mjs";
import { listProjects, getProject, createProject, updateProject } from "./projects.mjs";
import { startPersonalRun, listPersonalRuns, getPersonalRun, recordPersonalFeedback,
  undoPersonalFeedback, updatePersonalBrief, createPersonalProposal, workOnePersonalRun } from "./personal-research.mjs";

const port = Number(process.env.API_PORT ?? 8787);
const host = process.env.API_HOST ?? "127.0.0.1";
const sessions = new Map();
const runs = new Map();
const brandResolutions = new Map();
const confirmedBrands = new Map();
const lookupCounts = new Map();
const demoResolutions = new Map();
const demoSelections = new Map();
const demoLookupCounts = new Map();

function recentLookups(store, key) {
  const recent = (store.get(key) ?? []).filter((time) => Date.now() - time < 60 * 60_000);
  store.set(key, recent);
  return recent;
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
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

function sessionFor(request) {
  const id = request.headers["x-session-id"];
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return null;
  if (!sessions.has(id)) sessions.set(id, { feedback: [], updatedAt: Date.now() });
  const session = sessions.get(id);
  session.updatedAt = Date.now();
  return { id, session };
}

function cleanRun(run) {
  return { id: run.id, mode: run.input.mode, goal: run.input.goal, status: run.status, stage: run.stage, result: run.result, error: run.error, createdAt: run.createdAt };
}

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  if (request.method === "GET" && pathname === "/health") return send(response, 200, { status: "ok" });

  const projectRoute = pathname.match(/^\/projects\/([a-f0-9-]{36})$/);
  const personalRunRoute = pathname.match(/^\/personal\/runs\/([a-f0-9-]{36})$/);
  const personalFeedbackRoute = pathname.match(/^\/personal\/feedback\/([a-f0-9-]{36})$/);
  const personalBriefRoute = pathname.match(/^\/personal\/briefs\/([a-f0-9-]{36})$/);
  const personalProposalRoute = pathname.match(/^\/personal\/matches\/([a-f0-9-]{36})\/proposal$/);
  if (pathname === "/me" || pathname === "/entities/resolve" || pathname === "/entities/confirm" || pathname === "/projects" || projectRoute || pathname.startsWith("/personal/")) {
    try {
      const user = await verifiedUser(request);
      if (!user) return send(response, 401, { message: "Sign in to access personal research." });
      if (request.method === "GET" && pathname === "/me") return send(response, 200, { id: user.id, email: user.email });
      if (pathname === "/personal/runs") {
        if (request.method === "POST") {
          const created = await startPersonalRun(user.id, await readJson(request));
          return send(response, created.reused ? 200 : 202, created);
        }
        if (request.method === "GET") {
          const projectId = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).searchParams.get("projectId");
          return send(response, 200, { runs: await listPersonalRuns(user.id, projectId) });
        }
      }
      if (personalRunRoute && request.method === "GET") {
        const run = await getPersonalRun(user.id, personalRunRoute[1]);
        return send(response, run ? 200 : 404, run ? { run } : { message: "Research run not found." });
      }
      if (pathname === "/personal/feedback" && request.method === "POST") {
        return send(response, 201, { feedback: await recordPersonalFeedback(user.id, await readJson(request)) });
      }
      if (personalFeedbackRoute && request.method === "DELETE") {
        const undone = await undoPersonalFeedback(user.id, personalFeedbackRoute[1]);
        return send(response, undone ? 200 : 404, undone ? { undone: true } : { message: "Feedback not found." });
      }
      if (personalBriefRoute && request.method === "PATCH") {
        return send(response, 200, { brief: await updatePersonalBrief(user.id, personalBriefRoute[1], await readJson(request)) });
      }
      if (personalProposalRoute && request.method === "POST") {
        const proposal = await createPersonalProposal(user.id, personalProposalRoute[1]);
        return send(response, proposal.reused ? 200 : 201, { proposal });
      }
      if (pathname === "/projects") {
        if (request.method === "GET") return send(response, 200, { projects: await listProjects(user.id) });
        if (request.method === "POST") {
          const input = await readJson(request);
          const confirmation = confirmedBrands.get(user.id);
          if (!confirmation || confirmation.entityId !== input.seedEntityId || Date.now() - confirmation.at > 30 * 60_000) {
            return send(response, 400, { message: "Confirm the starting brand before creating a project." });
          }
          return send(response, 201, { project: await createProject(user.id, input) });
        }
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
        const { name } = await readJson(request);
        const normalized = String(name ?? "").trim().toLowerCase();
        const cached = [...brandResolutions.values()].find((item) => item.userId === user.id && item.result.query.toLowerCase() === normalized && Date.now() - item.createdAt < 10 * 60_000);
        if (cached) return send(response, 200, cached.result);
        const recent = recentLookups(lookupCounts, user.id);
        if (recent.length >= 10) return send(response, 429, { message: "Too many brand lookups. Try again later." });
        lookupCounts.set(user.id, [...recent, Date.now()]);
        const result = await resolveBrand(name, { qloo: (_operation, args) => personalQlooDescribe(user.id, args) });
        brandResolutions.set(result.id, { userId: user.id, result, createdAt: Date.now() });
        return send(response, 200, result);
      }
      if (request.method === "POST" && pathname === "/entities/confirm") {
        const { resolutionId, qlooId, wikidataId, purpose } = await readJson(request);
        if (purpose && purpose !== "partner") return send(response, 400, { message: "Choose a supported brand confirmation." });
        const record = brandResolutions.get(resolutionId);
        if (!record || record.userId !== user.id || Date.now() - record.createdAt > 15 * 60_000) return send(response, 404, { message: "This brand search has expired. Search again." });
        if (wikidataId) {
          const candidate = record.result.wikidata.candidates.find((item) => item.id === wikidataId);
          if (!candidate) return send(response, 400, { message: "Select a business record from these results." });
          const detailed = await selectedWikidataBrand(candidate);
          record.result.wikidata.candidates = record.result.wikidata.candidates.map((item) => item.id === wikidataId ? detailed : item);
        }
        const selection = selectResolvedBrand(record.result, qlooId, wikidataId);
        const entity = await persistSelectedBrand(selection);
        if (purpose !== "partner") confirmedBrands.set(user.id, { entityId: entity.id, at: Date.now() });
        brandResolutions.delete(resolutionId);
        return send(response, 200, { entity });
      }
      return send(response, 405, { message: "Unsupported request method." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Brand lookup is unavailable.";
      const known = /^(Enter a brand|Enter a project|Enter a YouTube|Enter a valid YouTube|Use a YouTube|Choose a supported research mode|Choose a different partner brand|Live YouTube research|Check the project|Confirm a starting brand|Select a |These records|An external identifier|This brand|Choose a project|This request|Project not found|A project preview|Today's project preview|Research run not found|Partnership not found|Choose Save|Feedback not found|Check the brief|Keep the brief|Brief not found|This brief)/.test(message);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : known ? 400 : 503;
      return send(response, status, { message: status === 503 ? "Personal research is temporarily unavailable." : message });
    }
  }

  const owner = sessionFor(request);
  if (!owner) return send(response, 401, { message: "Your session could not be opened. Refresh the page and try again." });

  try {
    if (request.method === "POST" && pathname === "/demo/entities/resolve") {
      const { name } = await readJson(request);
      const query = String(name ?? "").trim();
      if (query.length < 2 || query.length > 90) return send(response, 400, { message: "Enter a brand name between 2 and 90 characters." });
      const cached = [...demoResolutions.values()].find((item) => item.sessionId === owner.id && item.result.query.toLowerCase() === query.toLowerCase() && Date.now() - item.createdAt < 10 * 60_000);
      if (cached) return send(response, 200, cached.result);
      const recent = recentLookups(demoLookupCounts, owner.id);
      if (recent.length >= 8) return send(response, 429, { message: "Demo brand lookup limit reached. Please try again later." });
      demoLookupCounts.set(owner.id, [...recent, Date.now()]);
      let rawQloo;
      const result = await resolveBrand(query, { qloo: async (...args) => {
        rawQloo = await qlooCall(...args);
        return rawQloo;
      } });
      demoResolutions.set(result.id, { sessionId: owner.id, result, rawQloo, createdAt: Date.now() });
      return send(response, 200, result);
    }
    if (request.method === "POST" && pathname === "/demo/entities/confirm") {
      const { resolutionId, qlooId, wikidataId } = await readJson(request);
      const record = demoResolutions.get(resolutionId);
      if (!record || record.sessionId !== owner.id || Date.now() - record.createdAt > 15 * 60_000) return send(response, 404, { message: "This brand search has expired. Search again." });
      if (wikidataId) {
        const candidate = record.result.wikidata.candidates.find((item) => item.id === wikidataId);
        if (!candidate) return send(response, 400, { message: "Select a business record from these results." });
        const detailed = await selectedWikidataBrand(candidate);
        record.result.wikidata.candidates = record.result.wikidata.candidates.map((item) => item.id === wikidataId ? detailed : item);
      }
      const selected = selectResolvedBrand(record.result, qlooId, wikidataId);
      const raw = record.rawQloo?.results?.find((item) => item.entity_id === selected.qloo.id);
      if (!raw) return send(response, 400, { message: "This brand choice is no longer available. Search again." });
      const selectionId = randomUUID();
      demoSelections.set(selectionId, { sessionId: owner.id, raw, selected, query: record.result.query, createdAt: Date.now() });
      return send(response, 200, { selectionId, name: selected.qloo.name, businessDetails: Boolean(selected.wikidata) });
    }
    if (request.method === "POST" && (pathname === "/runs" || pathname === "/pairs")) {
      const active = [...runs.values()].find((run) => run.sessionId === owner.id && ["queued", "running"].includes(run.status));
      if (active) return send(response, 409, { message: "Your search is still in progress.", runId: active.id });
      const input = { ...await readJson(request), mode: pathname === "/pairs" ? "compare" : "discover" };
      if (input.mode === "compare" ? input.leftType !== "brand" || !["brand", "creator"].includes(input.rightType) : input.type !== "brand" || !["brand", "creator"].includes(input.partnerType)) {
        return send(response, 400, { message: "Start with a brand and choose a brand or YouTube creator partner." });
      }
      const seedSelection = selectedDemoBrand(demoSelections, input.seedSelectionId, owner.id);
      if (!seedSelection) return send(response, 400, { message: "Confirm the starting brand before searching." });
      if (input.mode === "compare") {
        input.left = seedSelection.raw.name;
        if (input.rightType === "brand") {
          const rightSelection = selectedDemoBrand(demoSelections, input.rightSelectionId, owner.id);
          if (!rightSelection) return send(response, 400, { message: "Confirm the second brand before comparing." });
          input.right = rightSelection.raw.name;
          input.selectedRight = rightSelection.raw;
        }
      } else input.seed = seedSelection.raw.name;
      input.selectedSeed = seedSelection.raw;
      const id = randomUUID();
      const run = { id, sessionId: owner.id, input, status: "queued", stage: "Preparing search", createdAt: new Date().toISOString(), trace: [], concepts: new Map() };
      runs.set(id, run);
      queueMicrotask(async () => {
        run.status = "running";
        run.stage = input.mode === "compare" ? "Comparing partners" : "Finding partners";
        try {
          run.result = input.mode === "compare" ? await analyzePair(input, owner.session, run.trace) : await discover(input, owner.session, run.trace);
          run.status = run.result.status;
          run.stage = "Complete";
        } catch (error) {
          run.status = "failed";
          run.stage = "Complete";
          run.error = error instanceof Error && !/MCP|QLOO|fetch|ECONN|ENOTFOUND/i.test(error.message)
            ? error.message : "Partnership research is temporarily unavailable. Please try again shortly.";
          run.trace.push({ step: "error", message: error instanceof Error ? error.message : "Unknown failure", at: new Date().toISOString() });
        }
      });
      return send(response, 202, { runId: id, status: run.status });
    }

    const runMatch = pathname.match(/^\/runs\/([a-f0-9-]{36})$/);
    if (request.method === "GET" && runMatch) {
      const run = runs.get(runMatch[1]);
      if (!run || run.sessionId !== owner.id) return send(response, 404, { message: "Search not found." });
      return send(response, 200, cleanRun(run));
    }

    if (request.method === "POST" && pathname === "/concepts") {
      const body = await readJson(request);
      const run = runs.get(body.runId);
      const candidate = run?.result?.candidates?.find((item) => item.id === body.candidateId);
      if (!run || run.sessionId !== owner.id || !candidate) return send(response, 404, { message: "This partnership is no longer available." });
      if (run.concepts.has(candidate.id) && run.concepts.get(candidate.id).status !== "failed") return send(response, 200, run.concepts.get(candidate.id));
      run.concepts.set(candidate.id, { status: "running" });
      queueMicrotask(async () => {
        try {
          const concepts = await developConcepts(run, candidate);
          run.concepts.set(candidate.id, { status: "completed", concepts });
          run.trace.push({ step: "generate_concepts", candidateId: candidate.id, count: concepts.length, at: new Date().toISOString() });
        } catch (error) {
          run.concepts.set(candidate.id, { status: "failed", message: error instanceof Error ? error.message : "We could not finish those ideas. Please try again." });
        }
      });
      return send(response, 202, { status: "running" });
    }

    const conceptMatch = pathname.match(/^\/concepts\/([a-f0-9-]{36})$/);
    if (request.method === "GET" && conceptMatch) {
      const run = runs.get(conceptMatch[1]);
      const candidateId = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).searchParams.get("candidateId");
      if (!run || run.sessionId !== owner.id || !run.result?.candidates?.some((item) => item.id === candidateId)) return send(response, 404, { message: "This partnership is no longer available." });
      return send(response, 200, run.concepts.get(candidateId) ?? { status: "missing" });
    }

    if (request.method === "POST" && pathname === "/feedback") {
      const body = await readJson(request);
      const run = runs.get(body.runId);
      if (!run || run.sessionId !== owner.id || !run.result?.candidates?.some((candidate) => candidate.id === body.candidateId)) {
        return send(response, 404, { message: "This partnership is no longer available." });
      }
      if (!["save", "reject"].includes(body.action)) return send(response, 400, { message: "Choose Save or Pass." });
      const item = {
        id: randomUUID(), runId: run.id, candidateId: body.candidateId, action: body.action,
        scope: feedbackScope(run.input),
        reason: typeof body.reason === "string" ? body.reason.slice(0, 80) : undefined,
        correction: ["Budget", "Timing", "Geography", "Format", "Scope"].includes(body.correction) ? body.correction : undefined,
        createdAt: new Date().toISOString(),
      };
      owner.session.feedback.push(item);
      return send(response, 201, { id: item.id, action: item.action });
    }

    const undoMatch = pathname.match(/^\/feedback\/([a-f0-9-]{36})$/);
    if (request.method === "DELETE" && undoMatch) {
      const before = owner.session.feedback.length;
      owner.session.feedback = owner.session.feedback.filter((item) => item.id !== undoMatch[1]);
      return send(response, before === owner.session.feedback.length ? 404 : 200, { restored: before !== owner.session.feedback.length });
    }

    return send(response, 404, { message: "Not found." });
  } catch (error) {
    if (pathname.startsWith("/demo/entities/")) {
      const message = error instanceof Error ? error.message : "Brand lookup is unavailable.";
      const known = /^(Enter a brand|Select a |These records|This brand)/.test(message);
      return send(response, known ? 400 : 503, { message: known ? message : "Brand lookup is temporarily unavailable. Please try again." });
    }
    return send(response, 400, { message: error instanceof Error ? error.message : "Please try again." });
  }
}).listen(port, host, () => process.stdout.write(`CrossCulture API listening on ${host}:${port}\n`));

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, session] of sessions) if (session.updatedAt < cutoff) sessions.delete(id);
  for (const [id, run] of runs) if (new Date(run.createdAt).getTime() < cutoff) runs.delete(id);
  for (const [id, record] of brandResolutions) if (record.createdAt < Date.now() - 15 * 60_000) brandResolutions.delete(id);
  for (const [id, record] of confirmedBrands) if (record.at < Date.now() - 30 * 60_000) confirmedBrands.delete(id);
  for (const [id, record] of demoResolutions) if (record.createdAt < Date.now() - 15 * 60_000) demoResolutions.delete(id);
  for (const [id, record] of demoSelections) if (record.createdAt < Date.now() - 15 * 60_000) demoSelections.delete(id);
  for (const [id, times] of demoLookupCounts) {
    const recent = times.filter((time) => time > Date.now() - 60 * 60_000);
    if (recent.length) demoLookupCounts.set(id, recent);
    else demoLookupCounts.delete(id);
  }
  for (const [id, times] of lookupCounts) {
    const recent = times.filter((time) => time > Date.now() - 60 * 60_000);
    if (recent.length) lookupCounts.set(id, recent);
    else lookupCounts.delete(id);
  }
}, 60 * 60 * 1000).unref();

// Retention and source restrictions are app-managed. Freshness never triggers this job.
if (process.env.DATABASE_URL) {
  let working = false;
  const processPersonalQueue = async () => {
    if (working) return;
    working = true;
    try { for (let i = 0; i < 3 && await workOnePersonalRun(); i += 1) {} }
    catch (error) { if (process.env.DEBUG_PERSONAL_RUNS === "1") process.stderr.write(`Personal worker unavailable: ${error instanceof Error ? error.message : String(error)}\n`); }
    finally { working = false; }
  };
  void processPersonalQueue();
  setInterval(processPersonalQueue, 3000).unref();
  const purge = async () => {
    for (const [provider, run] of [["Qloo", purgeDueQlooResponses], ["YouTube sources", purgeDueYouTubeSources],
      ["Creator observations", purgeDueCreatorObservations],
      ["Personal YouTube sources", purgeDuePersonalYouTubeSources], ["YouTube requests", purgeDueYoutubeRequests]]) {
      try { await run(100); }
      catch (error) { process.stderr.write(`${provider} retention purge failed: ${error instanceof Error ? error.message : "unknown error"}\n`); }
    }
  };
  void purge();
  setInterval(purge, 15 * 60 * 1000).unref();
}
