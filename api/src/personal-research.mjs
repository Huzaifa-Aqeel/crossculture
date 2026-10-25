import { randomUUID } from "node:crypto";
import pg from "pg";
import { processCommerceRun } from "./commerce-worker.mjs";
import { refreshCommerceOffers, currentCommerceAssessment } from "./commerce-offer-refresh.mjs";
import { discoverVerifiedStorefront } from "./shopify-catalog.mjs";
import { investigateCommerceAudience } from "./commerce-audience.mjs";
import { commerceProposalAction } from "./commerce-proposals.mjs";
import { validateNewRunObjective } from "./new-run-objectives.mjs";
import { vetCommerceShortlist } from "./commerce-vetting.mjs";
import { sharedLaunchAreas } from "./commerce-launch.mjs";

let pool;
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const modes = new Set(["discovery", "direct_pair"]);
const workerId = `research-worker-${randomUUID()}`;

function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("Research database is not configured.");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  }
  return pool;
}

function bad(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export async function startPersonalRun(userId, input) {
  if (!uuid(input?.projectId) || !uuid(input?.idempotencyKey) || !modes.has(input.mode) || input.partnerType !== "brand") {
    bad("Choose a project and brand research mode.");
  }
  const researchMode = input.researchMode;
  if (researchMode !== "live_commerce") bad("Choose a supported research mode.");
  const excludedPartnerEntityIds = input.excludedPartnerEntityIds ?? [];
  if (!Array.isArray(excludedPartnerEntityIds) || excludedPartnerEntityIds.length > 20 ||
      excludedPartnerEntityIds.some((id) => !uuid(id)) ||
      new Set(excludedPartnerEntityIds).size !== excludedPartnerEntityIds.length) {
    bad("Choose valid partner exclusions.");
  }
  if (input.mode === "direct_pair" ? !uuid(input.partnerEntityId) : input.partnerEntityId != null) {
    bad("Choose brand discovery or select a confirmed partner brand for comparison.");
  }
  const market = String(input.market ?? "US").trim().toUpperCase();
  if (researchMode === "live_commerce" && !/^[A-Z]{2}$/.test(market)) bad("Choose a two-letter market country.");
  const requestedPrice = input.commerceRequirements?.priceLimit;
  const requestedHero = input.commerceRequirements?.heroProduct;
  const occasion = String(input.commerceRequirements?.occasion ?? "").trim().slice(0, 100);
  const requestedSoftPreferences = input.commerceRequirements?.softPreferences;
  if (researchMode === "live_commerce" && requestedSoftPreferences !== undefined &&
      (!Array.isArray(requestedSoftPreferences) || requestedSoftPreferences.length > 6 ||
       requestedSoftPreferences.some((value) => typeof value !== "string" ||
         value.trim().length < 3 || value.trim().length > 60))) {
    bad("Choose up to six short product preferences.");
  }
  if (researchMode === "live_commerce" && requestedPrice &&
      (!Number.isInteger(requestedPrice.amountMinor) || requestedPrice.amountMinor <= 0 ||
       requestedPrice.amountMinor > 100_000_000 || !/^[A-Z]{3}$/.test(requestedPrice.currencyCode ?? ""))) {
    bad("Choose a valid partner-product price limit and currency.");
  }
  // Every research run starts from one chosen starting product.
  if (researchMode === "live_commerce" && !requestedHero) bad("Choose a starting product before research.");
  if (researchMode === "live_commerce" && requestedHero &&
      (typeof requestedHero.productId !== "string" ||
       !/^gid:\/\/shopify\/(?:Product|p)\//.test(requestedHero.productId) ||
       typeof requestedHero.variantId !== "string" ||
       !/^gid:\/\/shopify\/ProductVariant\//.test(requestedHero.variantId))) {
    bad("Choose a current starting product and variant.");
  }
  const commerceRequirements = researchMode === "live_commerce" ? {
    mustShipToMarket: input.commerceRequirements?.mustShipToMarket === true,
    mustBeAvailableNow: input.commerceRequirements?.mustBeAvailableNow === true,
    ...(occasion ? { occasion } : {}),
    ...(requestedSoftPreferences?.length ? { softPreferences: [...new Set(
      requestedSoftPreferences.map((value) => value.trim().toLowerCase()))] } : {}),
    ...(requestedPrice ? { priceLimit: { amountMinor: requestedPrice.amountMinor,
      currencyCode: requestedPrice.currencyCode } } : {}),
    ...(requestedHero ? { heroProduct: { productId: requestedHero.productId,
      variantId: requestedHero.variantId,
      // The chosen product's display title is only a partner-filter hint; the
      // exact product and variant are re-read from the store during research.
      ...(typeof requestedHero.title === "string" && requestedHero.title.trim()
        ? { title: requestedHero.title.trim().slice(0, 160) } : {}),
      // The product's public taxonomy category only orders research by earlier
      // results for similar products; research reads the product itself.
      ...(typeof requestedHero.categoryId === "string" &&
        /^[a-z]{2}(?:-\d+){0,8}$/.test(requestedHero.categoryId)
        ? { categoryId: requestedHero.categoryId } : {}) } } : {}),
  } : null;
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [userId, input.projectId]);
    const existing = await client.query(`select id,project_id,kind,match_type,specified_partner_id,constraints_json from public.analysis_runs
      where user_id=$1 and idempotency_key=$2`, [userId, input.idempotencyKey]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.project_id !== input.projectId || row.kind !== input.mode || row.match_type !== "brand_brand" ||
          row.constraints_json?.researchMode !== researchMode ||
          JSON.stringify(row.constraints_json?.excludedPartnerEntityIds ?? []) !== JSON.stringify(excludedPartnerEntityIds) ||
          (researchMode === "live_commerce" && (row.constraints_json?.market !== market ||
            JSON.stringify(row.constraints_json?.commerceRequirements ?? {}) !== JSON.stringify(commerceRequirements))) ||
          (researchMode === "live_commerce" && input.mode === "direct_pair" && row.specified_partner_id !== input.partnerEntityId)) {
        bad("This request has already been used for another search.", 409);
      }
      await client.query("commit");
      return { runId: row.id, reused: true };
    }
    const project = await client.query(`select id,seed_entity_id,objective from public.projects
      where id=$1 and user_id=$2`, [input.projectId, userId]);
    if (!project.rows[0]) bad("Project not found.", 404);
    validateNewRunObjective(project.rows[0].objective, input.partnerType);
    if (researchMode === "live_commerce") {
      const identity = await client.query(`select e.identity_status as status,e.official_website as website,
        exists (select 1 from catalog.entity_identifiers i where i.entity_id=e.id
          and i.provider='qloo' and i.status='confirmed') as native
        from catalog.entities e where e.id=$1`, [project.rows[0].seed_entity_id]);
      const seed = identity.rows[0];
      if (!seed || seed.status !== "verified") bad("Confirm the starting brand before research.");
      if (!seed.native && (process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED !== "1" ||
          input.mode !== "discovery" || !requestedHero || !seed.website))
        bad("Choose a current starting product for this discovery path.");
    }
    if (researchMode === "live_commerce" && input.mode === "direct_pair") {
      if (input.partnerEntityId === project.rows[0].seed_entity_id) bad("Choose a different partner brand.");
      const partner = await client.query(`select e.id from catalog.entities e
        join catalog.entity_identifiers i on i.entity_id=e.id and i.provider='qloo' and i.status='confirmed'
        where e.id=$1 and e.kind='brand'`, [input.partnerEntityId]);
      if (!partner.rows[0]) bad("Select a confirmed partner brand for this comparison.");
    }
    const recent = await client.query(`select count(*)::integer as total,
      count(*) filter (where status in ('queued','running'))::integer as active
      from public.analysis_runs where user_id=$1 and project_id=$2 and created_at>now()-interval '1 day'`, [userId, input.projectId]);
    if (recent.rows[0].active) bad("A project preview is still running.", 409);
    if (recent.rows[0].total >= 30) bad("Today's project preview limit has been reached.", 429);
    const partnerId = input.mode === "direct_pair" ? input.partnerEntityId : null;
    const previous = await client.query(`select f.id,f.action,m.partner_entity_id from public.feedback f
      join public.analysis_runs r on r.id=f.analysis_run_id and r.user_id=f.user_id
      left join public.matches m on m.id=f.match_id and m.user_id=f.user_id
      where f.user_id=$1 and r.project_id=$2 and f.undone_at is null
      order by f.created_at desc limit 20`, [userId, input.projectId]);
    const constraints = { sample: false, researchMode, partnerType: "brand", mode: input.mode,
      excludedPartnerEntityIds, market, commerceRequirements };
    const plan = { version: 1, sampleOnly: false,
      maxCandidates: input.mode === "discovery" ? 6 : 1,
      maxCatalogCalls: input.mode === "discovery"
        ? commerceRequirements.heroProduct ? 160 : 88
        : commerceRequirements.heroProduct ? 56 : 22,
      sources: ["qloo", "shopify_catalog", "tavily"], score: "brand-commerce-v1.1" };
    const result = await client.query(`insert into public.analysis_runs(user_id,project_id,seed_entity_id,specified_partner_id,
      kind,match_type,objective,constraints_json,plan_json,feedback_snapshot_json,idempotency_key)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11) returning id`,
    [userId, input.projectId, project.rows[0].seed_entity_id, partnerId, input.mode,
      "brand_brand", project.rows[0].objective,
      JSON.stringify(constraints), JSON.stringify(plan), JSON.stringify({ events: previous.rows }), input.idempotencyKey]);
    await client.query("commit");
    return { runId: result.rows[0].id, reused: false };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function listPersonalRuns(userId, projectId) {
  if (!uuid(projectId)) bad("Project not found.", 404);
  const project = await db().query("select id from public.projects where id=$1 and user_id=$2", [projectId, userId]);
  if (!project.rows[0]) bad("Project not found.", 404);
  const result = await db().query(`select id,kind,"match_type" as "matchType",status,stage,
    constraints_json->>'partnerType' as "partnerType",result_json as result,
    created_at as "createdAt" from public.analysis_runs where user_id=$1 and project_id=$2
      and match_type='brand_brand' and objective in ('product_bundle','cross_sell')
    order by created_at desc limit 30`, [userId, projectId]);
  return result.rows.map((row) => ({ ...row, result: customerCommerceRunResult(row.result) }));
}

// Run diagnostics remain in the owner-scoped database record for developer
// audits. The customer response contains only progress and coverage language,
// never unsuccessful Qloo candidate names or provider research traces.
function customerCommerceRunResult(result) {
  if (!result || typeof result !== "object") return result;
  return { message: result.message, coverage: result.coverage,
    stopReason: result.stopReason };
}

export async function getPersonalRun(userId, runId) {
  if (!uuid(runId)) return null;
  const run = await db().query(`select r.id,r.project_id as "projectId",r.kind,r.match_type as "matchType",
    r.status,r.stage,r.attempt,r.result_json as result,r.error_code as "errorCode",
    r.constraints_json->>'positioningDirection' as "positioningDirection",
    r.constraints_json->'commerceRequirements' as "commerceRequirements",
    r.created_at as "createdAt",e.canonical_name as "seedName",
    coalesce(e.official_website,e.canonical_url) as "seedWebsite"
    from public.analysis_runs r join catalog.entities e on e.id=r.seed_entity_id
    where r.id=$1 and r.user_id=$2
      and r.match_type='brand_brand' and r.objective in ('product_bundle','cross_sell')`, [runId, userId]);
  if (!run.rows[0]) return null;
  const matches = await db().query(`select m.id,m.partner_entity_id as "partnerEntityId",m.eligibility,m.saved_at as "savedAt",m.note,
    e.canonical_name as "partnerName",e.description as "partnerDescription",
    coalesce(e.official_website,e.canonical_url) as "partnerWebsite",
    a.id as "assessmentId",a.evidence_json as evidence,
    a.score_json as score,a.scoring_version as "scoringVersion",a.version as "assessmentVersion",
    a.validity_status as "evidenceStatus",
    b.id as "briefId",b.content_markdown as "briefMarkdown",b.revision as "briefRevision",
    b.validity_status as "briefStatus"
    from public.matches m join catalog.entities e on e.id=m.partner_entity_id
    left join lateral (select * from public.assessment_snapshots where match_id=m.id and user_id=$2 order by version desc limit 1) a on true
    left join lateral (select * from public.briefs where match_id=m.id and user_id=$2 order by updated_at desc limit 1) b on true
    where m.analysis_run_id=$1 and m.user_id=$2 order by m.created_at`, [runId, userId]);
  const commerceRanks = new Map((run.rows[0].result?.decisions ?? [])
    .map((decision) => [decision.matchId, decision.rank]));
  const commerceMatches = [...matches.rows].sort((a, b) =>
    (commerceRanks.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
    (commerceRanks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const storefrontChecks = new Map();
  const verifyStore = (website, options = {}) => {
    const key = `${website}|${options.onlyDomain ?? ""}`;
    if (!storefrontChecks.has(key)) storefrontChecks.set(key,
      discoverVerifiedStorefront(website, options));
    return storefrontChecks.get(key);
  };
  const orderedMatches = await (async () => {
    const refreshed = [];
    // Refresh the leading assessment and saved opportunities on opening a run.
    // Other combinations are checked on demand, avoiding dozens of immediate
    // exact-offer calls that can exhaust a merchant's live endpoint.
    const firstSupported = commerceMatches.find((match) => match.score?.status === "supported");
    const firstResearchLead = commerceMatches.find((match) => match.score?.status === "needs_verification");
    const initial = new Set([firstSupported?.id, firstResearchLead?.id,
      ...commerceMatches.filter((match) => match.savedAt).map((match) => match.id)].filter(Boolean));
    for (const match of commerceMatches) {
      if (initial.has(match.id)) {
        const currentOffers = await refreshCommerceOffers(match.evidence?.commerce?.references,
          { market: match.evidence?.commerce?.market ?? "US",
            requirements: run.rows[0].commerceRequirements ?? {},
            officialSites: { seed: run.rows[0].seedWebsite, partner: match.partnerWebsite },
            verifyStore });
        refreshed.push({ ...match, savedScore: match.score, currentOffers,
          score: currentCommerceAssessment(match.score, currentOffers,
            run.rows[0].commerceRequirements ?? {}) });
      } else {
        refreshed.push({ ...match, savedScore: match.score,
          score: { ...match.score, currentOfferReview: "not_checked" },
          currentOffers: null });
      }
    }
    return refreshed;
  })();
  return { ...run.rows[0], result: customerCommerceRunResult(run.rows[0].result),
    matches: orderedMatches };
}

export async function refreshPersonalMatch(userId, matchId,
  { refresh = refreshCommerceOffers } = {}) {
  if (!uuid(matchId)) return null;
  const result = await db().query(`select m.id,m.saved_at as "savedAt",
    a.evidence_json as evidence,a.score_json as score,
    r.constraints_json->'commerceRequirements' as "commerceRequirements",
    coalesce(seed.official_website,seed.canonical_url) as "seedWebsite",
    coalesce(partner.official_website,partner.canonical_url) as "partnerWebsite"
    from public.matches m join public.analysis_runs r on r.id=m.analysis_run_id
    join catalog.entities seed on seed.id=m.brand_entity_id
    join catalog.entities partner on partner.id=m.partner_entity_id
    left join lateral (select * from public.assessment_snapshots where match_id=m.id
      and user_id=$1 order by version desc limit 1) a on true
    where m.id=$2 and m.user_id=$1 and r.user_id=$1
      and r.match_type='brand_brand' and r.objective in ('product_bundle','cross_sell')`,
  [userId, matchId]);
  const match = result.rows[0];
  if (!match?.evidence?.commerce?.references || !match.score) return null;
  const currentOffers = await refresh(match.evidence.commerce.references,
    { market: match.evidence.commerce.market ?? "US",
      requirements: match.commerceRequirements ?? {},
      officialSites: { seed: match.seedWebsite, partner: match.partnerWebsite } });
  return { id: match.id, currentOffers, savedScore: match.score,
    score: currentCommerceAssessment(match.score, currentOffers,
      match.commerceRequirements ?? {}) };
}

export async function researchPersonalMatchAudience(userId, matchId,
  { includeDemographics = false, investigate = investigateCommerceAudience } = {}) {
  if (!uuid(matchId)) return null;
  const response = await db().query(`select seed.identity_status as "seedIdentity",
    partner.identity_status as "partnerIdentity",
    seed_id.external_id as "seedQlooId",partner_id.external_id as "partnerQlooId",
    a.score_json as score
    from public.matches m join public.analysis_runs r on r.id=m.analysis_run_id
    join catalog.entities seed on seed.id=m.brand_entity_id
    join catalog.entities partner on partner.id=m.partner_entity_id
    left join catalog.entity_identifiers seed_id on seed_id.entity_id=seed.id
      and seed_id.provider='qloo' and seed_id.status='confirmed'
    left join catalog.entity_identifiers partner_id on partner_id.entity_id=partner.id
      and partner_id.provider='qloo' and partner_id.status='confirmed'
    left join lateral (select score_json from public.assessment_snapshots
      where match_id=m.id and user_id=$1 order by version desc limit 1) a on true
    where m.id=$2 and m.user_id=$1 and r.user_id=$1
      and r.match_type='brand_brand' and r.objective in ('product_bundle','cross_sell')`,
  [userId, matchId]);
  const row = response.rows[0];
  if (!row) return null;
  if (row.seedIdentity !== "verified" || row.partnerIdentity !== "verified" ||
      !row.seedQlooId || !row.partnerQlooId ||
      row.score?.policyVersion !== "brand-commerce-v1.1" ||
      row.score?.culturalRelationship === "contradicted") {
    return { status: "unavailable", connections: [], demographicStatus: "not_requested",
      sharedDemographicSignals: null };
  }
  return investigate(userId, row.seedQlooId, row.partnerQlooId,
    { includeDemographics });
}

// Saving an opportunity runs one bounded public-source review of its partner
// and attaches the links to the latest assessment for the reviewer. It never
// changes the opportunity's status or rank, and a slow or failed review does
// not block the save.
async function vetSavedPartner(userId, matchId, vet) {
  const found = await db().query(`select a.id as "assessmentId",a.evidence_json as evidence,
    e.canonical_name as name,coalesce(e.official_website,e.canonical_url) as "officialWebsite"
    from public.matches m join catalog.entities e on e.id=m.partner_entity_id
    join lateral (select id,evidence_json from public.assessment_snapshots
      where match_id=m.id and user_id=$1 order by version desc limit 1) a on true
    where m.id=$2 and m.user_id=$1`, [userId, matchId]);
  const row = found.rows[0];
  if (!row || row.evidence?.commerce?.publicReviewCheckedAt) return;
  const review = await Promise.race([vet({ name: row.name, officialWebsite: row.officialWebsite }),
    new Promise((resolve) => setTimeout(() => resolve(null), 8000).unref?.())]).catch(() => null);
  if (!review) return;
  const findings = (review.findings ?? []).filter((item) => /^https:\/\//.test(item?.url ?? "") &&
    ["official_context", "independent_context_to_review", "independent_concern_to_review"].includes(item.kind))
    .slice(0, 6).map((item) => ({ kind: item.kind, url: item.url, publishedAt: item.publishedAt ?? null }));
  await db().query(`update public.assessment_snapshots set evidence_json=jsonb_set(jsonb_set(jsonb_set(
      evidence_json,'{commerce,externalFindings}',$3::jsonb),'{commerce,externalSourceRefs}',$4::jsonb),
      '{commerce,publicReviewCheckedAt}',to_jsonb(now()::text))
    where id=$1 and user_id=$2`, [row.assessmentId, userId, JSON.stringify(findings),
    JSON.stringify(findings.map((item) => item.url))]);
}

// Where both brands' audiences are strongest in the run's market. Owner-scoped
// and explanation only; it never changes the opportunity's status or rank.
export async function researchPersonalMatchLaunchAreas(userId, matchId,
  { launchAreas = sharedLaunchAreas } = {}) {
  if (!uuid(matchId)) return null;
  const found = await db().query(`select seed_id.external_id as "seedQlooId",
    partner_id.external_id as "partnerQlooId", coalesce(r.constraints_json->>'market','US') as market
    from public.matches m join public.analysis_runs r on r.id=m.analysis_run_id
    left join catalog.entity_identifiers seed_id on seed_id.entity_id=m.brand_entity_id
      and seed_id.provider='qloo' and seed_id.status='confirmed'
    left join catalog.entity_identifiers partner_id on partner_id.entity_id=m.partner_entity_id
      and partner_id.provider='qloo' and partner_id.status='confirmed'
    where m.id=$2 and m.user_id=$1 and r.user_id=$1
      and r.match_type='brand_brand' and r.objective in ('product_bundle','cross_sell')`, [userId, matchId]);
  const row = found.rows[0];
  if (!row) return null;
  return launchAreas(userId, row.seedQlooId, row.partnerQlooId, row.market);
}

export async function recordPersonalFeedback(userId, input, { vet = vetCommerceShortlist } = {}) {
  if (!uuid(input?.runId) || !uuid(input?.matchId) || !["save", "reject"].includes(input.action)) bad("Choose Save or Pass for this partnership.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 160) : null;
  const client = await db().connect();
  let saved;
  try {
    await client.query("begin");
    const result = await client.query(`insert into public.feedback(user_id,analysis_run_id,match_id,action,reason)
      select $1,m.analysis_run_id,m.id,$4,$5 from public.matches m
      where m.id=$2 and m.analysis_run_id=$3 and m.user_id=$1 returning id`, [userId, input.matchId, input.runId, input.action, reason]);
    if (!result.rows[0]) bad("Partnership not found.", 404);
    await client.query(`update public.matches set saved_at=$3,updated_at=now() where id=$1 and user_id=$2`,
      [input.matchId, userId, input.action === "save" ? new Date() : null]);
    await client.query("commit");
    saved = { id: result.rows[0].id, action: input.action };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
  if (input.action === "save") await vetSavedPartner(userId, input.matchId, vet).catch(() => {});
  return saved;
}

export async function undoPersonalFeedback(userId, feedbackId) {
  if (!uuid(feedbackId)) return false;
  const client = await db().connect();
  try {
    await client.query("begin");
    const changed = await client.query(`update public.feedback set undone_at=now()
      where id=$1 and user_id=$2 and undone_at is null returning match_id`, [feedbackId, userId]);
    if (!changed.rows[0]) { await client.query("rollback"); return false; }
    const matchId = changed.rows[0].match_id;
    const effective = await client.query(`select action from public.feedback where match_id=$1 and user_id=$2
      and undone_at is null order by created_at desc,id desc limit 1`, [matchId, userId]);
    await client.query(`update public.matches set saved_at=$3,updated_at=now() where id=$1 and user_id=$2`,
      [matchId, userId, effective.rows[0]?.action === "save" ? new Date() : null]);
    await client.query("commit");
    return true;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function updatePersonalBrief(userId, briefId, input) {
  if (!uuid(briefId) || !Number.isInteger(input?.revision) || typeof input?.markdown !== "string") bad("Check the brief before saving.");
  const markdown = input.markdown.trim();
  if (markdown.length < 20 || markdown.length > 20000) bad("Keep the brief between 20 and 20,000 characters.");
  const changed = await db().query(`update public.briefs set content_markdown=$3,revision=revision+1,updated_at=now()
    where id=$1 and user_id=$2 and revision=$4 and validity_status='valid'
    returning revision,content_markdown as markdown`, [briefId, userId, markdown, input.revision]);
  if (changed.rows[0]) return changed.rows[0];
  const exists = await db().query("select revision from public.briefs where id=$1 and user_id=$2", [briefId, userId]);
  if (!exists.rows[0]) bad("Brief not found.", 404);
  bad("This brief changed since you opened it. Reload before saving.", 409);
}

// Proposal drafts are user-triggered only; scoring never creates them.
export async function createPersonalProposal(userId, matchId, input = {}) {
  if (!uuid(matchId)) bad("Partnership not found.", 404);
  const commerce = await db().query(`select r.objective from public.matches m
    join public.analysis_runs r on r.id=m.analysis_run_id
    where m.id=$1 and m.user_id=$2 and r.match_type='brand_brand'
      and r.objective in ('product_bundle','cross_sell')`, [matchId, userId]);
  if (!commerce.rows[0]) bad("Partnership not found.", 404);
  return commerceProposalAction(userId, matchId, input);
}

export async function claimPersonalRun(id = workerId) {
  const result = await db().query(`with ready as (
    select id from public.analysis_runs where
      ((status='queued' and available_at<=now()) or (status='running' and lease_until<now()))
      and attempt<3 and constraints_json->>'researchMode'='live_commerce'
    order by available_at,created_at for update skip locked limit 1
  ) update public.analysis_runs r set status='running',stage=case
    when r.constraints_json->>'researchMode'='live_commerce' and r.kind='discovery' then 'Finding product partners'
    when r.constraints_json->>'researchMode'='live_commerce' then 'Checking the selected products'
    else 'Checking the selected products' end,
    attempt=attempt+1,lease_until=now()+interval '2 minutes',worker_id=$1,updated_at=now()
    from ready where r.id=ready.id returning r.id,r.user_id,r.project_id,r.seed_entity_id,
    r.specified_partner_id,r.objective,r.kind,r.match_type,r.constraints_json,r.plan_json,r.feedback_snapshot_json,r.attempt`, [id]);
  return result.rows[0] ?? null;
}

export function runFailurePlan(run, error) {
  const invalid = error?.retryable === false;
  const terminal = invalid || run.attempt >= 3;
  const rateLimited = error?.code === "catalog_rate_limited";
  const seedCheck = error?.code === "seed_identity_unavailable";
  return { terminal, status: terminal ? "failed" : "queued",
    stage: terminal ? "Complete" : rateLimited ? "Waiting to retry product research"
      : seedCheck ? "Checking the starting brand again" : "Retrying research",
    errorCode: invalid ? "commerce_run_invalid" : rateLimited ? "commerce_catalog_rate_limited"
      : seedCheck ? "commerce_seed_identity_unavailable" : "commerce_research_unavailable",
    retryDelaySeconds: rateLimited ? Math.min(300, 60 * (2 ** (run.attempt - 1)))
      : seedCheck ? 30 * run.attempt : 10 };
}

export async function failPersonalRun(run, error, id = workerId) {
  const plan = runFailurePlan(run, error);
  await db().query(`update public.analysis_runs set status=$3,stage=$4,error_code=$6,
    available_at=case when $5 then available_at else now()+$7::integer * interval '1 second' end,
    lease_until=null,worker_id=null,finished_at=case when $5 then now() else null end,updated_at=now()
    where id=$1 and worker_id=$2 and status='running'`,
  [run.id, id, plan.status, plan.stage, plan.terminal, plan.errorCode, plan.retryDelaySeconds]);
  if (process.env.DEBUG_PERSONAL_RUNS === "1") process.stderr.write(`Personal run failed: ${error instanceof Error ? error.message : String(error)}\n`);
}

export async function workOnePersonalRun(id = workerId) {
  await db().query(`update public.analysis_runs set status='failed',stage='Complete',
    error_code='commerce_research_retry_exhausted',lease_until=null,worker_id=null,
    finished_at=now(),updated_at=now() where status='running' and lease_until<now()
    and attempt>=3 and constraints_json->>'researchMode'='live_commerce'`);
  const run = await claimPersonalRun(id);
  if (!run) return false;
  const heartbeat = run.constraints_json?.researchMode === "live_commerce" ? setInterval(() => {
    db().query(`update public.analysis_runs set lease_until=now()+interval '2 minutes'
      where id=$1 and worker_id=$2 and status='running'`, [run.id, id]).catch(() => {});
  }, 30000) : null;
  heartbeat?.unref();
  try { await processCommerceRun(run, id); }
  catch (error) { await failPersonalRun(run, error, id); }
  finally { if (heartbeat) clearInterval(heartbeat); }
  return true;
}
