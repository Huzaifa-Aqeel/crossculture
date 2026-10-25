import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { createProject, updateProject, listProjects } from "../src/projects.mjs";
import { startPersonalRun, claimPersonalRun, failPersonalRun, getPersonalRun, listPersonalRuns,
  refreshPersonalMatch, researchPersonalMatchAudience, recordPersonalFeedback } from "../src/personal-research.mjs";
import { processCommerceRun } from "../src/commerce-worker.mjs";
import { assessCommerceOpportunity } from "../src/brand-commerce.mjs";
import { validateCommerceEvidence } from "../src/commerce-evidence.mjs";
import { commerceProposalAction } from "../src/commerce-proposals.mjs";
import { previewCommerceSeedProducts } from "../src/commerce-preview.mjs";
import { persistVerifiedCommerceSite } from "../src/catalog.mjs";
import { personalQlooAudienceDemographics } from "../src/personal-qloo.mjs";

const raw = await readFile(process.env.LOCAL_SUPABASE_STATUS ?? "/tmp/crossculture-supabase-status.env", "utf8");
const vars = Object.fromEntries(raw.trim().split(/\r?\n/).map((line) => {
  const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
}));
if (!vars.API_URL?.startsWith("http://127.0.0.1:") || !vars.DB_URL?.includes("127.0.0.1:")) {
  throw new Error("Local Supabase only.");
}
process.env.DATABASE_URL = vars.DB_URL;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, options);
const owner = createClient(vars.API_URL, vars.ANON_KEY, options);
const other = createClient(vars.API_URL, vars.ANON_KEY, options);
const db = new pg.Pool({ connectionString: vars.DB_URL });
const users = [];
const entities = [];
const suffix = randomUUID().slice(0, 8);
try {
  for (const [client, label] of [[owner, "owner"], [other, "other"]]) {
    const email = `commerce-${label}-${suffix}@example.test`;
    const password = `LocalCheck-${randomUUID()}!`;
    const { data, error } = await client.auth.signUp({ email, password });
    assert.ifError(error); users.push(data.user.id);
    assert.ifError((await admin.auth.admin.updateUserById(data.user.id, { email_confirm: true })).error);
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  }
  const seedQloo = randomUUID();
  const partnerQloo = randomUUID();
  const created = await db.query(`insert into catalog.entities
    (kind,canonical_name,canonical_url,identity_status)
    values ('brand','Test seed', $1,'verified') returning id`, [`https://seed-${suffix}.example.com`]);
  const seedId = created.rows[0].id; entities.push(seedId);
  await db.query(`insert into catalog.entity_identifiers(entity_id,provider,external_id,status)
    values ($1,'qloo',$2,'confirmed')`, [seedId, seedQloo]);
  const project = await createProject(users[0], { seedEntityId: seedId,
    name: "Commerce fixture", objective: "product_bundle" });
  const previewDeps = {
    discoverStorefront: async () => ({ domain: "seed.example.com", shopId: "gid://shopify/Shop/1" }),
    createCatalog: () => ({
      tools: async () => new Set(["search_catalog", "lookup_catalog"]),
      search: async () => [{ id: "gid://shopify/Product/10", title: "Bath towel",
        url: "https://seed.example.com/products/bath-towel",
        variants: [{ id: "gid://shopify/ProductVariant/11", availability: { available: true } },
          { id: "gid://shopify/ProductVariant/12", availability: { available: false } }] }],
      detail: async (_domain, _productId, variantId) => ({ product: { id: "gid://shopify/Product/10", title: "Bath towel",
        url: "https://seed.example.com/products/bath-towel" },
      variant: { id: variantId, options: [{ name: "Color",
        label: variantId.endsWith("11") ? "Blue" : "Red" }],
        price: { amount: 4400, currency: "USD" },
        availability: { available: variantId.endsWith("11") } }, fetchedAt: new Date().toISOString() }),
    }),
  };
  const preview = await previewCommerceSeedProducts(users[0], project.id, "US", {
    ...previewDeps, query: "Bath towel" });
  assert.equal(preview.products.length, 1);
  assert.equal(preview.products[0].variantId, "gid://shopify/ProductVariant/11");
  assert.equal(preview.products[0].title, "Bath towel");
  const exactUrlPreview = await previewCommerceSeedProducts(users[0], project.id, "US", {
    ...previewDeps, query: "https://seed.example.com/products/bath-towel?variant=12" });
  assert.deepEqual(exactUrlPreview.products.map((item) => item.variantId),
    ["gid://shopify/ProductVariant/11"]);
  await assert.rejects(previewCommerceSeedProducts(users[0], project.id, "US", {
    ...previewDeps, query: "https://other.example.com/products/bath-towel" }),
  /verified brand store/);
  const limitedPreview = await previewCommerceSeedProducts(users[0], project.id, "US", {
    query: "Bath towel",
    discoverStorefront: async () => ({ domain: "seed.example.com",
      shopId: "gid://shopify/Shop/1" }),
    createCatalog: () => ({ tools: async () => { throw Object.assign(
      new Error("temporary limit"), { code: "catalog_rate_limited" }); } }),
  });
  assert.equal(limitedPreview.coverage, "catalog_rate_limited");
  const started = await startPersonalRun(users[0], { projectId: project.id, mode: "discovery",
    partnerType: "brand", researchMode: "live_commerce", market: "GB", idempotencyKey: randomUUID(),
    commerceRequirements: { heroProduct: { productId: preview.products[0].productId,
      variantId: preview.products[0].variantId },
      mustShipToMarket: true, mustBeAvailableNow: true,
      softPreferences: ["Cotton", "bath mat"],
      priceLimit: { amountMinor: 10000, currencyCode: "USD" }, occasion: "bathroom essentials" } });
  const claimed = await claimPersonalRun("commerce-fixture");
  assert.equal(claimed.id, started.runId);
  const assessment = assessCommerceOpportunity(validateCommerceEvidence({ objective: "product_bundle",
    discoveryBasis: "qloo_native_brand",
    seed: { id: seedQloo, qlooId: seedQloo, identityStatus: "verified",
      officialWebsite: `https://seed-${suffix}.example.com` },
    partner: { id: partnerQloo, qlooId: partnerQloo, identityStatus: "verified",
      officialWebsite: `https://partner-${suffix}.example.com` },
    seedStore: { shopId: "gid://shopify/Shop/1", domain: "seed.example.com",
      officialHost: `seed-${suffix}.example.com` },
    partnerStore: { shopId: "gid://shopify/Shop/2", domain: "partner.example.com",
      officialHost: `partner-${suffix}.example.com` },
    seedDetail: { product: { id: "gid://shopify/Product/10", title: "Bath towel" },
      variant: { id: "gid://shopify/ProductVariant/11" } },
    partnerDetail: { product: { id: "gid://shopify/Product/20", title: "Bath mat" },
      variant: { id: "gid://shopify/ProductVariant/21" } },
    selectedSeed: { productId: "gid://shopify/Product/10", variantId: "gid://shopify/ProductVariant/11" },
    selectedPartner: { productId: "gid://shopify/Product/20", variantId: "gid://shopify/ProductVariant/21" },
    cultureEvidence: { seedQlooId: seedQloo, partnerQlooId: partnerQloo, unconstrained: true,
      envelope: { status: "ok", results: [{ entity_id: partnerQloo }] } },
    mechanismProposal: { kind: "occasion_complement", seedFacts: ["Bath towel"],
      partnerFacts: ["Bath mat"], seedRole: "towel", partnerRole: "bath mat",
      occasion: "bathroom essentials",
      benefit: "The towel dries after bathing while the bath mat provides a floor surface.",
      partnerSpecificFact: "" },
    rubricVerification: { seedRoleGroundedInSelectedItem: true,
      partnerRoleGroundedInSelectedItem: true, jointUseCoherent: true, incrementalBenefit: true,
      genericCoUseOnly: false,
      distinctConcreteJointValue: false, partnerSpecificReason: false,
      reason: "specific_joint_use" },
    assortmentScope: { observedFamilies: ["bath_towel"] } }));
  const item = { partnerId: partnerQloo, partnerName: "Test partner",
    partnerWebsite: `https://partner-${suffix}.example.com`,
    identitySourceUrl: `https://partner-${suffix}.example.com/about`,
    seedProductId: "gid://shopify/Product/10", seedVariantId: "gid://shopify/ProductVariant/11",
    partnerProductId: "gid://shopify/Product/20",
    partnerVariantId: "gid://shopify/ProductVariant/21",
    sellerId: "gid://shopify/Shop/2", assessment,
    live: { forbiddenSearchPayload: "DO_NOT_SAVE_CATALOG_SEARCH" },
    references: { seed: { productId: "gid://shopify/Product/10",
      variantId: "gid://shopify/ProductVariant/11", sellerId: "gid://shopify/Shop/1",
      storefrontDomain: "seed.example.com" },
    partner: { productId: "gid://shopify/Product/20",
      variantId: "gid://shopify/ProductVariant/21", sellerId: "gid://shopify/Shop/2",
      storefrontDomain: "partner.example.com" } } };
  const secondItem = { ...item, partnerVariantId: "gid://shopify/ProductVariant/22",
    references: { ...item.references, partner: { ...item.references.partner,
      variantId: "gid://shopify/ProductVariant/22" } } };
  const research = async (request) => {
    assert.equal(request.market, "GB");
    assert.equal(request.objective, "product_bundle");
    assert.equal(request.userConstraints.mustShipToMarket, true);
    assert.equal(request.userConstraints.mustBeAvailableNow, true);
    assert.equal(request.userConstraints.occasion, "bathroom essentials");
    assert.deepEqual(request.userConstraints.softPreferences, ["cotton", "bath mat"]);
    assert.deepEqual(request.userConstraints.priceLimit, { amountMinor: 10000,
      currencyCode: "USD" });
    assert.deepEqual(request.userConstraints.heroProduct, { productId: preview.products[0].productId,
      variantId: preview.products[0].variantId });
    return { qlooResponseId: null, discoveryBasis: "qloo_native_brand",
    coverage: "partial_assortment", candidates: [{ name: "Test partner", status: "product_researched" }],
    opportunities: { supported: [{ partnerId: partnerQloo, best: item,
      otherOpportunities: [secondItem] }], needs_verification: [], unsupported: [] } };
  };
  assert.equal(await processCommerceRun(claimed, "commerce-fixture", { research }), true);
  const run = await getPersonalRun(users[0], started.runId);
  assert.equal(run.status, "completed");
  assert.equal(run.result.candidates, undefined);
  assert.equal(run.result.coverage, "partial_assortment");
  assert.equal((await listPersonalRuns(users[0], project.id))[0].result.candidates, undefined);
  const developerTrace = await db.query(`select result_json->'candidates' as candidates
    from public.analysis_runs where id=$1`, [started.runId]);
  assert.equal(developerTrace.rows[0].candidates[0].name, "Test partner");
  assert.equal(run.matches.length, 2);
  assert.notEqual(run.matches[0].id, run.matches[1].id);
  assert.notEqual(run.matches[0].evidence.commerce.references.partner.variantId,
    run.matches[1].evidence.commerce.references.partner.variantId);
  assert.equal(run.matches[0].score.policyVersion, "brand-commerce-v1.1");
  assert.ok(["unverified", "lookup_unreachable"].includes(
    run.matches[0].currentOffers.seed.status));
  assert.equal(run.matches[0].savedScore.status, "supported");
  assert.equal(run.matches[0].score.status, "needs_verification");
  assert.equal(run.matches[1].currentOffers, null);
  assert.equal(run.matches[1].score.currentOfferReview, "not_checked");
  assert.equal(run.matches[1].savedScore.status, "supported");
  assert.equal(JSON.stringify(run).includes("DO_NOT_SAVE_CATALOG_SEARCH"), false);
  const partnerRow = await db.query(`select id from catalog.entities
    where canonical_url=$1`, [item.partnerWebsite]);
  entities.push(partnerRow.rows[0].id);
  const matchId = run.matches[0].id;
  assert.equal(await getPersonalRun(users[1], started.runId), null);
  const audienceProbe = async (userId, leftId, rightId, options) => {
    assert.equal(userId, users[0]);
    assert.equal(leftId, seedQloo);
    assert.equal(rightId, partnerQloo);
    assert.equal(options.includeDemographics, true);
    return { status: "specific_patterns_observed", connections: [{ name: "Sample cultural pattern" }],
      demographicStatus: "not_requested", sharedDemographicSignals: null };
  };
  assert.equal(await researchPersonalMatchAudience(users[1], matchId, {
    includeDemographics: true, investigate: audienceProbe }), null);
  const audience = await researchPersonalMatchAudience(users[0], matchId, {
    includeDemographics: true, investigate: audienceProbe });
  assert.equal(audience.connections[0].name, "Sample cultural pattern");
  const demographicSample = await personalQlooAudienceDemographics(users[0], seedQloo, {
    provider: async () => ({ status: "ok", results: [{ entity_id: seedQloo,
      query: { age: { "25_to_29": 0.2 }, gender: { female: 0.1 } } }] }),
  });
  assert.ok(demographicSample.responseId);
  const privateDemographic = await db.query(`select operation,owner_user_id,sample_data
    from private.qloo_responses where id=$1`, [demographicSample.responseId]);
  assert.deepEqual(privateDemographic.rows[0], {
    operation: "qloo_audience_demographics", owner_user_id: users[0], sample_data: true });
  assert.equal((await getPersonalRun(users[0], started.runId)).matches[0].savedScore.status,
    "supported", "Optional audience research must not mutate the assessment.");
  assert.equal(await refreshPersonalMatch(users[1], run.matches[1].id,
    { refresh: async () => { throw new Error("Other user must not refresh an offer."); } }), null);
  const onDemand = await refreshPersonalMatch(users[0], run.matches[1].id,
    { refresh: async (references) => {
      assert.equal(references.partner.variantId, "gid://shopify/ProductVariant/22");
      return { seed: { status: "current", available: true, marketCheck: { state: "supported" } },
        partner: { status: "current", available: true,
          price: { amountMinor: 4400, currencyCode: "USD" },
          marketCheck: { state: "supported" } } };
    } });
  assert.equal(onDemand.score.status, "supported");
  assert.equal(onDemand.currentOffers.partner.status, "current");
  const ownerRows = await owner.from("assessment_snapshots").select("id").eq("match_id", matchId);
  const otherRows = await other.from("assessment_snapshots").select("id").eq("match_id", matchId);
  assert.ifError(ownerRows.error); assert.ifError(otherRows.error);
  assert.equal(ownerRows.data.length, 1);
  assert.equal(otherRows.data.length, 0);
  // Saving runs one public-source review of the partner (stubbed here: no web
  // call), attaches its links to the latest assessment and changes no status.
  let reviews = 0;
  const reviewFinding = { kind: "independent_context_to_review",
    url: "https://news.example.com/partner-collaboration", publishedAt: null };
  await recordPersonalFeedback(users[0], { runId: started.runId, matchId, action: "save" },
    { vet: async () => { reviews += 1; return { findings: [reviewFinding, { kind: "other", url: "https://x.example.com" }] }; } });
  await recordPersonalFeedback(users[0], { runId: started.runId, matchId, action: "save" },
    { vet: async () => { reviews += 1; return { findings: [] }; } });
  assert.equal(reviews, 1, "A saved partner is reviewed once");
  const reviewed = (await getPersonalRun(users[0], started.runId)).matches.find((item) => item.id === matchId);
  assert.deepEqual(reviewed.evidence.commerce.externalFindings, [reviewFinding]);
  assert.equal(reviewed.savedScore.status, "supported", "The review never changes the saved verdict");
  // A proposal is written straight from the verified opportunity.
  const offersNow = async () => ({ seed: { status: "current", title: "Bath towel", available: true,
    marketCheck: { state: "supported" } },
    partner: { status: "current", title: "Bathmat", available: true,
      price: { amountMinor: 4400, currencyCode: "USD" }, marketCheck: { state: "supported" } } });
  const brief = await commerceProposalAction(users[0], matchId, {},
    { launchAreas: async () => ({ areas: ["Seattle area"] }), refresh: offersNow });
  assert.equal(brief.reused, false);
  assert.ok(brief.partnerName && brief.seedName, "The proposal page can name both brands");
  const reopened = await commerceProposalAction(users[0], matchId, {},
    { refresh: async () => { throw new Error("An existing proposal is not rewritten"); } });
  assert.equal(reopened.id, brief.id);
  assert.equal(reopened.reused, true);
  assert.match(brief.markdown, /## The products\n\n- \*\*Bath towel\*\*/);
  assert.doesNotMatch(brief.markdown, /## Measurement plan/, "No empty template sections");
  assert.match(brief.markdown, /## Where audiences overlap\n\nSeattle area/);
  assert.match(brief.markdown, /## To agree together\n\n- /);
  assert.equal((await listPersonalRuns(users[0], project.id)).length, 1);
  // Once research has run: the goal is fixed, and new research starts a new project.
  await assert.rejects(updateProject(users[0], project.id, { name: project.name, objective: "cross_sell", notes: "" }),
    (error) => error.statusCode === 409);
  const repeatProject = await createProject(users[0], { seedEntityId: project.seedEntityId,
    name: "Repeat research", objective: project.objective, market: project.market ?? "US" });
  assert.notEqual(repeatProject.id, project.id);
  const listedProject = (await listProjects(users[0])).find((item) => item.id === project.id);
  assert.ok(listedProject.latestRunStatus, "A researched project is not a draft");
  const priorContextFlag = process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED;
  process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED = "1";
  try {
    const contextSeed = await persistVerifiedCommerceSite({ name: "Fixture context seed",
      officialWebsite: `https://context-${suffix}.example.com`, identityStatus: "verified",
      identitySourceUrl: `https://context-${suffix}.example.com/about`,
      shopId: "gid://shopify/Shop/3" });
    entities.push(contextSeed.id);
    const contextProject = await createProject(users[0], { seedEntityId: contextSeed.id,
      name: "Context fixture", objective: "cross_sell" });
    assert.equal(contextProject.seedNative, false);
    await assert.rejects(startPersonalRun(users[0], { projectId: contextProject.id,
      mode: "discovery", partnerType: "brand", researchMode: "live_commerce",
      idempotencyKey: randomUUID() }), /Choose a starting product/);
    const contextStarted = await startPersonalRun(users[0], { projectId: contextProject.id,
      mode: "discovery", partnerType: "brand", researchMode: "live_commerce",
      idempotencyKey: randomUUID(), commerceRequirements: { heroProduct: {
        productId: "gid://shopify/Product/10", variantId: "gid://shopify/ProductVariant/11" } } });
    const contextClaimed = await claimPersonalRun("context-fixture");
    assert.equal(contextClaimed.id, contextStarted.runId);
    assert.equal(await processCommerceRun(contextClaimed, "context-fixture", {
      research: async () => { throw new Error("Native route used for context seed."); },
      researchContext: async ({ seed, userConstraints }) => {
        assert.equal(seed.qlooId, null);
        assert.equal(seed.identitySourceUrl, contextSeed.identitySourceUrl);
        assert.equal(userConstraints.heroProduct.variantId, "gid://shopify/ProductVariant/11");
        return { discoveryBasis: "qloo_context_brand", coverage: "no_corroborated_context_candidate",
          candidates: [], opportunities: { supported: [], needs_verification: [], unsupported: [] } };
      } }), true);
    assert.equal((await getPersonalRun(users[0], contextStarted.runId)).status, "partial");
  } finally {
    if (priorContextFlag === undefined) delete process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED;
    else process.env.COMMERCE_CONTEXT_DISCOVERY_ENABLED = priorContextFlag;
  }
  const limitedStarted = await startPersonalRun(users[0], { projectId: project.id,
    mode: "discovery", partnerType: "brand", researchMode: "live_commerce",
    idempotencyKey: randomUUID(), commerceRequirements: { heroProduct: {
      productId: preview.products[0].productId, variantId: preview.products[0].variantId } } });
  const limitedClaimed = await claimPersonalRun("rate-limit-fixture");
  assert.equal(limitedClaimed.id, limitedStarted.runId);
  let catalogLimit;
  try {
    await processCommerceRun(limitedClaimed, "rate-limit-fixture", {
      research: async () => ({ stopReason: "catalog_rate_limited",
        opportunities: { supported: [], needs_verification: [], unsupported: [] } }),
    });
  } catch (error) { catalogLimit = error; }
  assert.equal(catalogLimit?.code, "catalog_rate_limited");
  await failPersonalRun(limitedClaimed, catalogLimit, "rate-limit-fixture");
  const queuedLimit = await db.query("select status,stage,error_code,available_at>now() as delayed from public.analysis_runs where id=$1",
    [limitedStarted.runId]);
  assert.equal(queuedLimit.rows[0].status, "queued");
  assert.equal(queuedLimit.rows[0].error_code, "commerce_catalog_rate_limited");
  assert.equal(queuedLimit.rows[0].delayed, true);
  assert.match(queuedLimit.rows[0].stage, /retry product research/);
  console.log("Local commerce run, RLS, no-catalog-payload persistence and concept selection passed.");
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  for (const id of entities.reverse()) {
    await db.query("delete from catalog.entity_identifiers where entity_id=$1", [id]);
    await db.query("delete from catalog.entities where id=$1", [id]);
  }
  await db.end();
}
