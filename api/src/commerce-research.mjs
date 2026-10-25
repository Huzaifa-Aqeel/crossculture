import { assessCommerceOpportunity, rankCommerceOpportunities } from "./brand-commerce.mjs";
import { validateCommerceEvidence } from "./commerce-evidence.mjs";
import { chooseProductCombinations, productMechanism, verifiedMechanismFacts,
  mechanismFactSourceKinds,
  observedProductType, observedProductQueries, transientProductFacts,
  validatePartnerSearchPlan, mergeRefinedSearchPlans, usefulCollectionSearch,
  commerceRoleKey, prioritizeUnexploredRole,
  searchResultMatchesQuery, isCommerceMerchandise,
  prioritizeObservedPartnerProducts,
  prioritizePartnerResearchProducts, productWearer, brandWearer, wearerConflict } from "./commerce-products.mjs";
import { planAnchorProductSearch, planPartnerProductSearch, proposeCommerceMechanism,
  verifyCommerceMechanismRubric, selectPartnerProductHypotheses,
  evaluateCommerceMechanism, screenPartnerAssortment } from "./commerce-mechanism.mjs";
import { catalogClient, discoverVerifiedStorefront } from "./shopify-catalog.mjs";
import { selectedProductPage } from "./commerce-product-page.mjs";
import { taxonomyCategory, screenKeyFor, recallScreenDecision,
  opportunityKeyFor } from "./research-memory.mjs";

// Shared, transient pair research for native discovery and direct comparison.
// The caller supplies only independently verified brand identities and Qloo evidence.
export async function researchCommercePair({ seed, partner, objective, cultureEvidence = null,
  discoveryBasis, market = "US", userConstraints = {}, maxCatalogCalls = 28,
  maxResearchMs = Number(process.env.COMMERCE_PARTNER_RESEARCH_MS) || 120_000 }, {
  createCatalog = () => catalogClient({ maxCalls: maxCatalogCalls }), discoverStorefront = discoverVerifiedStorefront,
  productQueries = null, planAnchorSearch = planAnchorProductSearch,
  planPartnerSearch = planPartnerProductSearch,
  selectPartnerProducts = selectPartnerProductHypotheses,
  proposeMechanism = proposeCommerceMechanism,
  verifyMechanism = verifyCommerceMechanismRubric,
  readSelectedProductPage = selectedProductPage, onEvaluation = null,
  screenPartner = screenPartnerAssortment, recallScreen = recallScreenDecision,
  now = () => Date.now() } = {}) {
  if (!["product_bundle", "cross_sell"].includes(objective)) throw new Error("Commerce objective required.");
  if (!seed?.id || !partner?.id || seed.id === partner.id ||
      seed.identityStatus !== "verified" || partner.identityStatus !== "verified") {
    throw new Error("Two distinct verified brand identities are required.");
  }
  // Research always starts from the user's chosen starting product.
  if (!userConstraints.heroProduct?.productId || !userConstraints.heroProduct?.variantId) {
    return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
      coverage: "selected_seed_product_required", callsUsed: 0 };
  }
  const startedAt = now();
  const timeLimitReached = () => Number.isFinite(maxResearchMs) && maxResearchMs > 0 &&
    now() - startedAt >= maxResearchMs;
  const [seedStore, partnerStore] = await Promise.all([
    discoverStorefront(seed.officialWebsite), discoverStorefront(partner.officialWebsite),
  ]);
  if (!seedStore?.shopId || !partnerStore?.shopId || seedStore.shopId === partnerStore.shopId) {
    return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
      coverage: [seedStore, partnerStore].some((store) => store?.coverage === "storefront_probe_unavailable")
        ? "storefront_probe_unavailable" : "storefront_identity_unverified", callsUsed: 0 };
  }
  if ((seed.verifiedShopId ?? seed.shopId) &&
      seedStore.shopId !== (seed.verifiedShopId ?? seed.shopId)) {
    return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
      coverage: "seed_storefront_changed", callsUsed: 0 };
  }
  const catalog = createCatalog();
  const optionalTools = (domain) => catalog.tools(domain).catch((error) => {
    if (error?.code === "catalog_rate_limited" ||
        error?.code === "catalog_budget_exhausted") throw error;
    if (error?.code === "catalog_unavailable" || error?.cause?.code ||
        error?.name === "TimeoutError") {
      throw Object.assign(error, { code: "catalog_unavailable" });
    }
    return null;
  });
  const globalTools = await optionalTools("global") ?? new Set();
  const canResearch = (set) => set?.has("search_catalog") &&
    (set.has("get_product") || set.has("lookup_catalog"));
  async function scope(store) {
    for (const domain of [...new Set([store.domain, store.endpointHost].filter(Boolean))]) {
      const tools = await optionalTools(domain);
      if (canResearch(tools)) return { domain, tools, shopId: store.shopId };
    }
    return canResearch(globalTools) ? { domain: "global", tools: globalTools,
      shopId: store.shopId } : null;
  }
  const [seedScope, partnerScope] = await Promise.all([scope(seedStore), scope(partnerStore)]);
  if (!seedScope || !partnerScope) {
    return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
      coverage: "catalog_capability_unavailable", callsUsed: catalog.callsUsed() };
  }
  // Products made for a different wearer serve a different customer: a men's
  // shirt gains nothing from a women's top. A partner product with no wearer
  // label takes its brand's, when the brand is described only for one.
  let heroWearer = null;
  const partnerBrandWearer = brandWearer(partner.description);
  let wearerExcluded = 0;
  const searchScopePage = async (chosen, query, options = {}) => {
    const input = { market, shops: chosen.domain === "global" ? [chosen.shopId] : [], ...options };
    const page = catalog.searchPage ? await catalog.searchPage(chosen.domain, query, chosen.tools, input)
      : { products: await catalog.search(chosen.domain, query, chosen.tools, input),
        pagination: { cursor: null, hasNextPage: false } };
    searchPagesFetched += 1;
    const products = chosen.domain === "global" ? page.products.map((product) => ({
      ...product, variants: (product.variants ?? []).filter((variant) =>
        variant.seller?.id === chosen.shopId) })).filter((product) => product.variants.length)
      : page.products;
    const kept = chosen === partnerScope && heroWearer ? products.filter((product) =>
      !wearerConflict(heroWearer, productWearer(product) ?? partnerBrandWearer)) : products;
    wearerExcluded += products.length - kept.length;
    return { products: kept, pagination: page.pagination ?? { cursor: null, hasNextPage: false } };
  };
  const searchScope = async (chosen, query, options = {}) =>
    (await searchScopePage(chosen, query, options)).products;
  const primary = [];
  const alternatives = [];
  const partnerSamples = [];
  const seenFound = new Set();
  const inspected = [];
  const observedSeedFamilies = new Set();
  const coverageIssues = new Set();
  const detailCache = new Map();
  let searchPagesFetched = 0;
  let exactDetailFailures = 0;
  const assortmentFacets = (products) => new Set((products ?? []).flatMap((item) => {
    const type = item.product_type ?? item.type ?? item.category?.name;
    return [
      ...(typeof type === "string" && type.trim() ? [`type:${type.toLowerCase().trim()}`] : []),
      ...(item.category?.id ? [`category:${item.category.id}`] : []),
      ...(item.collections ?? []).map((collection) =>
        `collection:${String(collection.title ?? "").toLowerCase().trim()}`),
    ].filter((value) => !value.endsWith(":"));
  }));
  let heroDetail;
  {
    try {
      heroDetail = await catalog.detail(seedScope.domain, userConstraints.heroProduct.productId,
        userConstraints.heroProduct.variantId, null, seedScope.tools,
        { market, expectedSellerId: seedScope.domain === "global" ? seedStore.shopId : null });
      if (seedScope.domain === "global" && heroDetail.variant.seller?.id !== seedStore.shopId) {
        throw new Error("Selected seller changed.");
      }
    } catch (error) {
      const limited = error?.code === "catalog_rate_limited" ||
        error?.code === "catalog_budget_exhausted";
      const unavailable = error?.code === "catalog_unavailable" ||
        Boolean(error?.cause?.code) || error?.name === "TimeoutError";
      const coverage = error?.code === "catalog_rate_limited" ? "catalog_rate_limited"
        : error?.code === "catalog_budget_exhausted" ? "catalog_budget_reached"
          : unavailable ? "catalog_unavailable" : "selected_seed_product_unverified";
      return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
        coverage, coverageIssues: limited || unavailable ? [coverage] : [],
        stopReason: limited || unavailable ? coverage : null, callsUsed: catalog.callsUsed() };
    }
  }
  heroWearer = productWearer(heroDetail.product);
  const wearerMismatch = () => ({ opportunities: { supported: [], needs_verification: [], unsupported: [] },
    coverage: "partner_no_product_value", coverageIssues: ["partner_wearer_mismatch"], stopReason: null,
    callsUsed: catalog.callsUsed() });
  if (discoveryBasis !== "user_specified" && wearerConflict(heroWearer, partnerBrandWearer)) return wearerMismatch();
  const preferencePlans = (userConstraints.softPreferences ?? []).slice(0, 2)
    .filter((value) => typeof value === "string" && value.trim().length >= 3)
    .map((value) => ({ seedQuery: null,
      partnerQuery: value.trim().slice(0, 60) }));
  // A broad first pass supplies merchant product vocabulary. Qloo prose is
  // useful context, but often contains no words present in product listings.
  // Keep this transient and use exact detail lookup before assessing anything.
  let broadSeed = [];
  let broadPartner = [];
  let broadPartnerPagination = { cursor: null, hasNextPage: false };
  const useBroadPass = !productQueries;
  if (useBroadPass) {
    try {
      const [seedResults, partnerPage] = await Promise.all([
        Promise.resolve([{ ...heroDetail.product, variants: [heroDetail.variant] }]),
        searchScopePage(partnerScope, "products"),
      ]);
      broadSeed = seedResults;
      broadPartner = partnerPage.products;
      broadPartnerPagination = partnerPage.pagination;
      // A first search page is a sample, not the assortment. Follow cursors
      // only while pages reveal another assortment facet. More items from the
      // same facet are better reached by focused searches against the anchor.
      const seenBroad = new Set(broadPartner.map((item) => item.id));
      const broadFacets = assortmentFacets(broadPartner);
      const maxBroadPages = Math.max(1, Math.min(5,
        Number(process.env.COMMERCE_MAX_BROAD_PAGES) || 3));
      for (let pageNumber = 1; pageNumber < maxBroadPages &&
          broadPartnerPagination.hasNextPage && broadPartnerPagination.cursor &&
          catalog.callsUsed() < maxCatalogCalls - 16 && !timeLimitReached(); pageNumber += 1) {
        const next = await searchScopePage(partnerScope, "products",
          { cursor: broadPartnerPagination.cursor });
        const novel = next.products.filter((item) => !seenBroad.has(item.id));
        for (const item of novel) seenBroad.add(item.id);
        broadPartner.push(...novel);
        broadPartnerPagination = next.pagination;
        const newFacets = [...assortmentFacets(novel)].filter((facet) => !broadFacets.has(facet));
        for (const facet of newFacets) broadFacets.add(facet);
        if (novel.length < 2 || !newFacets.length) break;
      }
      if (broadPartnerPagination.hasNextPage) {
        coverageIssues.add("broad_catalog_pages_uninspected");
      }
    } catch (error) {
      if (error?.code === "catalog_rate_limited" || error?.code === "catalog_budget_exhausted") {
        return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
          coverage: error.code === "catalog_rate_limited" ? "catalog_rate_limited" : "catalog_budget_reached",
          coverageIssues: [error.code === "catalog_rate_limited"
            ? "catalog_rate_limited" : "catalog_budget_reached"],
          stopReason: error.code === "catalog_rate_limited" ? "catalog_rate_limited" : "catalog_budget_reached",
          callsUsed: catalog.callsUsed() };
      }
      // A failed broad query is a coverage limitation. Specific queries may
      // still work, so retain the normal bounded search plans.
    }
  }
  if (discoveryBasis !== "user_specified" && !broadPartner.length && wearerExcluded > 0) return wearerMismatch();
  // What this research teaches later runs: the app's own decisions, keyed by
  // public taxonomy categories and IDs, never Catalog content.
  let screenMemory = null;
  const pairOutcomes = [];
  const memory = () => ({ heroCategory: taxonomyCategory(heroDetail.product),
    partnerShopId: partnerStore.shopId, screen: screenMemory, pairs: pairOutcomes });
  // Discovered partners: stop now if the observed assortment shows nothing that
  // could add value to the chosen product. A failed screen never drops a partner;
  // a user-specified partner is never screened.
  if (discoveryBasis !== "user_specified" && broadPartner.length) {
    const runScreen = (products) => screenPartner({ seedProduct: heroDetail.product,
      seedVariant: heroDetail.variant, objective, partnerProducts: products,
      occasion: userConstraints.occasion ?? "", preferences: userConstraints.softPreferences ?? [],
      seedDescriptionTrusted: seedScope.domain !== "global",
      partnerDescriptionTrusted: partnerScope.domain !== "global" }).catch(() => null);
    // A screen decision for the same product, objective and partner store is
    // reused for six hours (from any run) so reruns give the same answer.
    const cacheable = screenPartner === screenPartnerAssortment;
    const screenKey = screenKeyFor({ objective, productId: heroDetail.product.id,
      variantId: heroDetail.variant.id, shopId: partnerStore.shopId,
      occasion: userConstraints.occasion ?? "", preferences: userConstraints.softPreferences ?? [] });
    const remembered = cacheable ? await recallScreen(screenKey).catch(() => null) : null;
    const reused = typeof remembered === "boolean";
    let screen = reused ? { addsValue: remembered } : await runScreen(broadPartner);
    // Before dropping a partner, look at one more catalog page: one sample can
    // miss the department that fits (furniture first, dinnerware later).
    if (screen?.addsValue === false && !reused && broadPartnerPagination.hasNextPage &&
        broadPartnerPagination.cursor && catalog.callsUsed() < maxCatalogCalls - 16) {
      try {
        const next = await searchScopePage(partnerScope, "products", { cursor: broadPartnerPagination.cursor });
        const seen = new Set(broadPartner.map((item) => item.id));
        const extra = next.products.filter((item) => !seen.has(item.id));
        if (extra.length) {
          broadPartner.push(...extra);
          broadPartnerPagination = next.pagination;
          screen = await runScreen(broadPartner);
        }
      } catch { /* keep the first decision */ }
    }
    if (cacheable && typeof screen?.addsValue === "boolean") {
      screenMemory = { key: screenKey, addsValue: screen.addsValue, reused };
    }
    if (screen?.addsValue === false) {
      return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
        coverage: "partner_no_product_value", coverageIssues: [], stopReason: null,
        observedCandidateCount: broadPartner.length, callsUsed: catalog.callsUsed(), memory: memory() };
    }
  }
  let retrievalPlan = { queries: [], observedProductIds: [] };
  let anchorPlan = { queries: [], observedProductIds: [] };
  let productSearchPlanning = "empty";
  if (!productQueries && !timeLimitReached()) {
    try {
      anchorPlan = validatePartnerSearchPlan(await planAnchorSearch({
        seedProduct: heroDetail.product, seedVariant: heroDetail.variant, objective,
        preferences: userConstraints.softPreferences ?? [], occasion: userConstraints.occasion ?? "",
        seedDescriptionTrusted: seedScope.domain !== "global",
      }), [], heroDetail.product);
    } catch { coverageIssues.add("anchor_search_planning_unavailable"); }
    try {
      retrievalPlan = validatePartnerSearchPlan(await planPartnerSearch({
        seedProduct: heroDetail.product, seedVariant: heroDetail.variant, objective,
        partnerProducts: broadPartner, preferences: userConstraints.softPreferences ?? [],
        occasion: userConstraints.occasion ?? "",
        seedDescriptionTrusted: seedScope.domain !== "global",
        partnerDescriptionTrusted: partnerScope.domain !== "global",
      }), broadPartner, heroDetail.product);
    } catch {
      coverageIssues.add("partner_search_planning_unavailable");
    }
    productSearchPlanning = anchorPlan.queries.length && retrievalPlan.queries.length
      ? "anchor_and_catalog_guided" : anchorPlan.queries.length ? "anchor_guided"
        : retrievalPlan.queries.length || retrievalPlan.observedProductIds.length
          ? "catalog_guided" : "fallback";
  }
  if (timeLimitReached()) coverageIssues.add("research_time_limit_reached");
  const focusedFallbackQueries = [...new Set([
    ...observedProductQueries(broadPartner, 4),
    ...broadPartner.filter((product) => isCommerceMerchandise(product) &&
      retrievalPlan.observedProductIds.includes(product.id)).flatMap((product) =>
      (product.collections ?? [])
      .map((collection) => collection.title)).filter((title) =>
      typeof title === "string" && usefulCollectionSearch(title)).slice(0, 5),
  ])];
  const guidedQueries = [];
  {
    const seenQueries = new Set();
    const buckets = [(anchorPlan.directions ?? anchorPlan.queries.map((query) => ({ query })))
      .map(({ query, role }) => ({ query, role, source: "anchor" })),
    (retrievalPlan.directions ?? retrievalPlan.queries.map((query) => ({ query })))
      .map(({ query, role }) => ({ query, role, source: "catalog" })),
      focusedFallbackQueries.map((query) => ({ query, source: "observed" }))];
    for (let offset = 0; offset < Math.max(...buckets.map((items) => items.length), 0); offset += 1) {
      for (const bucket of buckets) {
        const entry = bucket[offset];
        const key = entry?.query.toLowerCase().trim();
        if (key && !seenQueries.has(key) && key !== "products") {
          seenQueries.add(key); guidedQueries.push(entry);
        }
      }
    }
  }
  const taxonomyIds = partnerScope.domain === "global" ? [...new Set(broadPartner
    .map((product) => product.category?.id)
    .filter((id) => typeof id === "string" &&
      id.startsWith("gid://shopify/TaxonomyCategory/")))].slice(0, 3) : [];
  const plans = productQueries?.map((query) => typeof query === "string"
    ? { seedQuery: query, partnerQuery: query } : query) ??
    [...(useBroadPass && broadPartner.length
      ? [{ seedQuery: null, partnerQuery: "products",
        source: "broad", preloadedSeed: broadSeed, preloadedPartner: broadPartner }] : []),
    ...preferencePlans.map((plan) => ({ ...plan, source: "preference" })),
    ...guidedQueries.map(({ query, role, source }) => ({ seedQuery: null,
      partnerQuery: query, role, source })),
    ...taxonomyIds.map((id) => ({ seedQuery: null, partnerQuery: "products",
      categories: [id], source: "catalog_category" }))];
  if (!plans.length) return { opportunities: { supported: [], needs_verification: [], unsupported: [] },
    coverage: "selected_seed_product_mechanism_unverified", callsUsed: catalog.callsUsed() };
  // Configurable ceilings protect providers; the actual depth depends on
  // observed novelty and on reserving calls to inspect exact candidates.
  const configuredScopes = Number(process.env.COMMERCE_MAX_QUERY_SCOPES) || 10;
  const scopeLimit = productQueries ? 6
    : Math.max(4, Math.min(16, configuredScopes));
  const seenSearchProducts = new Set();
  const observedPartnerProducts = new Map(broadPartner.map((item) => [item.id, item]));
  const refinementEvidence = new Map();
  const broadFacetKeys = assortmentFacets(broadPartner);
  const plannedQueryKeys = new Set(plans.map((plan) =>
    `${String(plan.partnerQuery).toLowerCase().trim()}|${(plan.categories ?? []).join(",")}`));
  const attemptedSources = new Set();
  const exploredRoles = new Set();
  const roleOutcomes = new Map();
  let lowNoveltyScopes = 0;
  let focusedScopesAttempted = 0;
  let dynamicReplanned = false;
  let planIndex = 0;
  for (; planIndex < plans.length && planIndex < scopeLimit; planIndex += 1) {
    if (timeLimitReached()) {
      coverageIssues.add("research_time_limit_reached"); break;
    }
    const plan = prioritizeUnexploredRole(plans, planIndex, exploredRoles);
    if (catalog.callsUsed() >= maxCatalogCalls - 12) {
      coverageIssues.add("search_capacity_reserved_for_assessment"); break;
    }
    attemptedSources.add(plan.source ?? "legacy");
    const roleKey = commerceRoleKey(plan.role);
    if (roleKey) {
      exploredRoles.add(roleKey);
      if (!roleOutcomes.has(roleKey)) roleOutcomes.set(roleKey,
        { role: roleKey, searches: 0, returnedProducts: 0, novelProducts: 0 });
      roleOutcomes.get(roleKey).searches += 1;
    }
    if (plan.source !== "broad") focusedScopesAttempted += 1;
    let seedProducts; let partnerProducts;
    let novelProductCount = 0;
    try {
      const [seedResults, partnerPage] = await Promise.all([
        plan.preloadedSeed ?? Promise.resolve([{ ...heroDetail.product, variants: [heroDetail.variant] }]),
        plan.preloadedPartner ? Promise.resolve({ products: plan.preloadedPartner,
          pagination: { cursor: null, hasNextPage: broadPartnerPagination.hasNextPage } })
          : searchScopePage(partnerScope, plan.partnerQuery,
            { categories: plan.categories ?? [] }),
      ]);
      seedProducts = seedResults;
      partnerProducts = partnerPage.products;
      const firstNovel = partnerProducts.filter((item) => !seenSearchProducts.has(item.id));
      novelProductCount = firstNovel.length;
      for (const item of firstNovel) seenSearchProducts.add(item.id);
      let pagination = partnerPage.pagination;
      if (!plan.preloadedPartner && pagination.hasNextPage && pagination.cursor &&
          firstNovel.length >= 2 && catalog.callsUsed() < maxCatalogCalls - 13) {
        const next = await searchScopePage(partnerScope, plan.partnerQuery,
          { cursor: pagination.cursor, categories: plan.categories ?? [] });
        const additional = next.products.filter((item) => !seenSearchProducts.has(item.id));
        novelProductCount += additional.length;
        for (const item of additional) seenSearchProducts.add(item.id);
        partnerProducts = [...partnerProducts, ...additional];
        pagination = next.pagination;
      }
      if (pagination.hasNextPage) coverageIssues.add("search_pages_uninspected");
      lowNoveltyScopes = firstNovel.length < 2 ? lowNoveltyScopes + 1 : 0;
    } catch (error) {
      if (["catalog_rate_limited", "catalog_budget_exhausted"].includes(error.code)) {
        coverageIssues.add(error.code === "catalog_rate_limited"
          ? "catalog_rate_limited" : "catalog_budget_reached"); break;
      }
      coverageIssues.add("catalog_search_unavailable");
      continue;
    }
    inspected.push({ seed: plan.seedQuery ?? "selected_seed_product",
      partner: plan.partnerQuery, source: plan.source ?? "legacy",
      returnedCount: partnerProducts.length, novelCount: novelProductCount });
    if (roleKey) {
      roleOutcomes.get(roleKey).returnedProducts += partnerProducts.length;
      roleOutcomes.get(roleKey).novelProducts += novelProductCount;
    }
    partnerSamples.push(partnerProducts);
    for (const item of partnerProducts) observedPartnerProducts.set(item.id, item);
    if (plan.source !== "broad" && plan.partnerQuery !== "products") {
      for (const item of partnerProducts) {
        if (isCommerceMerchandise(item) && searchResultMatchesQuery(item, plan.partnerQuery)) {
          refinementEvidence.set(item.id, item);
        }
      }
    }
    for (const product of seedProducts) {
      const family = observedProductType(product);
      if (family) observedSeedFamilies.add(family);
    }
    let acceptedForPlan = 0;
    const orderedPartnerProducts = plan.partnerQuery === "products"
      ? prioritizeObservedPartnerProducts(partnerProducts, retrievalPlan.observedProductIds)
      : partnerProducts;
    for (const pair of chooseProductCombinations(seedProducts, orderedPartnerProducts, objective, 4,
      { spread: plan.partnerQuery === "products" && plan.seedQuery === "products" })) {
      const key = [pair.seedProduct.id, pair.seedVariant.id,
        pair.partnerProduct.id, pair.partnerVariant.id].join("|");
      if (seenFound.has(key)) continue;
      seenFound.add(key);
      (acceptedForPlan === 0 ? primary : alternatives).push(pair);
      acceptedForPlan += 1;
      if (acceptedForPlan >= 2) break;
    }
    // New observed merchandise can justify another catalog-led search
    // direction. Merge its queries into the same pool; no result is privileged
    // because it came from the anchor or catalog planner.
    if (!productQueries && !dynamicReplanned && focusedScopesAttempted >= 2 &&
        (refinementEvidence.size >= 2 ||
          [...assortmentFacets([...refinementEvidence.values()])]
            .some((facet) => !broadFacetKeys.has(facet)) || lowNoveltyScopes >= 2) &&
        catalog.callsUsed() < maxCatalogCalls - 16 && !timeLimitReached()) {
      dynamicReplanned = true;
      try {
        const refreshed = validatePartnerSearchPlan(await planPartnerSearch({
          seedProduct: heroDetail.product, seedVariant: heroDetail.variant, objective,
          partnerProducts: [...new Map([
            ...broadPartner.filter((item) => retrievalPlan.observedProductIds.includes(item.id)),
            ...refinementEvidence.values(),
          ].map((item) => [item.id, item])).values()].slice(0, 36),
          preferences: userConstraints.softPreferences ?? [],
          seedDescriptionTrusted: seedScope.domain !== "global",
          partnerDescriptionTrusted: partnerScope.domain !== "global",
          exploredRoles: [...roleOutcomes.values()],
          pendingRoles: plans.slice(planIndex + 1).map((entry) => entry.role)
            .filter((role) => typeof role === "string"),
        }), [...observedPartnerProducts.values()], heroDetail.product);
        retrievalPlan.observedProductIds = [...new Set([
          ...retrievalPlan.observedProductIds, ...refreshed.observedProductIds])];
        const modelRefinedPlans = [];
        const observedFacetPlans = [];
        for (const { query, role } of refreshed.directions ??
            refreshed.queries.map((query) => ({ query }))) {
          const key = `${query.toLowerCase().trim()}|`;
          if (!plannedQueryKeys.has(key)) {
            plannedQueryKeys.add(key);
            modelRefinedPlans.push({ seedQuery: null, partnerQuery: query, role,
              source: "catalog_refined" });
          }
        }
        // The extension exposes collections on returned products, not a
        // complete merchant collection index. Search only newly observed
        // collection titles; Global taxonomy can additionally filter by the
        // verified shop and a newly observed category ID.
        const newlyObserved = [...refinementEvidence.values()].filter((item) =>
          [...assortmentFacets([item])].some((facet) => !broadFacetKeys.has(facet)));
        const collectionTerms = [...new Set(newlyObserved.flatMap((item) =>
          (item.collections ?? []).map((collection) => collection.title)))]
          .filter((title) => typeof title === "string" && usefulCollectionSearch(title) &&
            !broadFacetKeys.has(`collection:${title.toLowerCase().trim()}`)).slice(0, 3);
        for (const title of collectionTerms) {
          const key = `${title.toLowerCase().trim()}|`;
          const pendingIndex = plans.findIndex((plan, index) => index > planIndex &&
            `${String(plan.partnerQuery).toLowerCase().trim()}|${(plan.categories ?? []).join(",")}` === key);
          if (pendingIndex >= 0) {
            observedFacetPlans.push(...plans.splice(pendingIndex, 1));
          } else if (!plannedQueryKeys.has(key)) {
            plannedQueryKeys.add(key);
            observedFacetPlans.push({ seedQuery: null, partnerQuery: title,
              source: "observed_collection" });
          }
        }
        if (partnerScope.domain === "global") {
          const observedCategories = [...new Set(newlyObserved.map((item) => item.category?.id))]
            .filter((id) => typeof id === "string" &&
              id.startsWith("gid://shopify/TaxonomyCategory/") &&
              !broadFacetKeys.has(`category:${id}`)).slice(0, 3);
          for (const id of observedCategories) {
            const key = `products|${id}`;
            const pendingIndex = plans.findIndex((plan, index) => index > planIndex &&
              `${String(plan.partnerQuery).toLowerCase().trim()}|${(plan.categories ?? []).join(",")}` === key);
            if (pendingIndex >= 0) {
              observedFacetPlans.push(...plans.splice(pendingIndex, 1));
            } else if (!plannedQueryKeys.has(key)) {
              plannedQueryKeys.add(key);
              observedFacetPlans.push({ seedQuery: null, partnerQuery: "products",
                categories: [id], source: "observed_category" });
            }
          }
        }
        if (observedFacetPlans.length || modelRefinedPlans.length) {
          mergeRefinedSearchPlans(plans, planIndex,
            [...observedFacetPlans, ...modelRefinedPlans]);
          lowNoveltyScopes = 0;
        }
      } catch { coverageIssues.add("refined_search_planning_unavailable"); }
    }
    if (lowNoveltyScopes >= 3 && attemptedSources.has("anchor") &&
        attemptedSources.has("catalog")) {
      coverageIssues.add("search_novelty_exhausted"); break;
    }
  }
  if (planIndex < plans.length) coverageIssues.add("search_scopes_uninspected");
  // First sample across query plans, then revisit one distinct product hypothesis
  // per plan. A large merchant catalog cannot take extra slots merely by size.
  let found = [...primary, ...alternatives].slice(0, 16);
  let productSelectionPlanning = "fallback";
  let eligibleCandidateCount = 0;
  let screenedCandidateCount = 0;
  let screeningBatchCount = 0;
  if (partnerSamples.length) {
    let proposedIds = retrievalPlan.observedProductIds;
    // Screen every observed product in manageable, scope-balanced batches.
    // A fixed first-64 cut otherwise hides later Catalog results from the
    // objective-aware selector even though they were already retrieved.
    const observedCandidates = prioritizePartnerResearchProducts(partnerSamples,
      proposedIds, Number.MAX_SAFE_INTEGER);
    eligibleCandidateCount = observedCandidates.length;
    const observedIds = new Set(observedCandidates.map((item) => item.id));
    const screenedGroups = [];
    const screeningBatchSize = 48;
    let screenedCount = 0;
    const selectIds = async (products) => {
      const allowed = new Set(products.map((item) => item.id));
      const selection = await selectPartnerProducts({ seedProduct: heroDetail.product,
        seedVariant: heroDetail.variant, objective, partnerProducts: products,
        seedDescriptionTrusted: seedScope.domain !== "global",
        partnerDescriptionTrusted: partnerScope.domain !== "global" });
      return [...new Set(selection?.productIds ?? [])].filter((id) => allowed.has(id)).slice(0, 12);
    };
    for (let start = 0; start < observedCandidates.length; start += screeningBatchSize) {
      if (timeLimitReached()) { coverageIssues.add("research_time_limit_reached"); break; }
      const batch = observedCandidates.slice(start, start + screeningBatchSize);
      let selectedIds = [];
      try {
        selectedIds = await selectIds(batch);
        if (selectedIds.length) productSelectionPlanning = "objective_guided";
      } catch { coverageIssues.add("partner_product_selection_unavailable"); }
      screenedCount += batch.length;
      screenedCandidateCount += batch.length;
      screeningBatchCount += 1;
      const group = [...selectedIds];
      // A thin search card is an evidence gap, not a negative selection.
      // Keep a small exploratory route to exact detail in every batch.
      const sparse = batch.find((item) => !selectedIds.includes(item.id) &&
        String(item.description?.plain ?? item.description?.html ??
          item.description ?? "").length < 100);
      if (sparse) group.push(sparse.id);
      if (!selectedIds.length && batch.length) group.push(batch[0].id);
      screenedGroups.push([...new Set(group)]);
    }
    if (screenedCount < observedCandidates.length) {
      coverageIssues.add("candidate_screening_incomplete");
    }
    // Preserve a route from later batches when a final model call fails.
    const screenedIds = [];
    for (let offset = 0; offset < Math.max(0, ...screenedGroups.map((group) => group.length));
        offset += 1) {
      for (const group of screenedGroups) if (group[offset]) screenedIds.push(group[offset]);
    }
    let finalists = [...new Set(screenedIds)];
    // Large assortments can yield more than one final selector window.
    // Reduce in rounds so no surviving batch is silently cut by position.
    while (finalists.length > screeningBatchSize && !timeLimitReached()) {
      const reduced = [];
      for (let start = 0; start < finalists.length; start += screeningBatchSize) {
        if (timeLimitReached()) break;
        const batch = finalists.slice(start, start + screeningBatchSize)
          .map((id) => observedCandidates.find((item) => item.id === id)).filter(Boolean);
        try { reduced.push(...await selectIds(batch)); }
        catch { coverageIssues.add("partner_product_selection_unavailable"); }
        if (batch.length && !reduced.some((id) => batch.some((item) => item.id === id))) {
          reduced.push(batch[0].id);
        }
      }
      const unique = [...new Set(reduced)];
      if (unique.length >= finalists.length || !unique.length) break;
      finalists = unique;
    }
    if (screeningBatchCount > 1 && finalists.length && !timeLimitReached()) {
      try {
        const finalSelected = await selectIds(finalists.slice(0, screeningBatchSize)
          .map((id) => observedCandidates.find((item) => item.id === id)).filter(Boolean));
        proposedIds = [...new Set([...finalSelected, ...finalists, ...proposedIds])];
      } catch {
        coverageIssues.add("partner_product_selection_unavailable");
        proposedIds = [...new Set([...finalists, ...proposedIds])];
      }
    } else {
      proposedIds = [...new Set([...finalists, ...proposedIds])];
    }
    // Ambiguous, sparse search cards get a small exact-detail pass before the
    // final order. These details remain transient and the chosen variant/seller
    // is re-used below, never silently replaced.
    const enriched = new Map();
    for (const id of proposedIds.slice(0, 5)) {
      if (timeLimitReached()) { coverageIssues.add("research_time_limit_reached"); break; }
      const item = observedCandidates.find((candidate) => candidate.id === id);
      if (!item || String(item.description?.plain ?? item.description?.html ??
          item.description ?? "").length >= 100 || catalog.callsUsed() >= maxCatalogCalls - 10) continue;
      const variant = item.variants?.find((option) => option.id && option.availability?.available === true)
        ?? item.variants?.find((option) => option.id);
      if (!variant) continue;
      try {
        const detail = await catalog.detail(partnerScope.domain, item.id, variant.id,
          variant.options, partnerScope.tools,
          { market, expectedSellerId: partnerScope.domain === "global" ? partnerStore.shopId : null });
        enriched.set(id, detail.product);
        detailCache.set(`${item.id}|${variant.id}`, detail);
      } catch (error) {
        exactDetailFailures += 1;
        if (error?.code === "catalog_rate_limited") { coverageIssues.add("catalog_rate_limited"); break; }
        coverageIssues.add("candidate_detail_unavailable");
      }
    }
    const enrichedCandidates = observedCandidates.map((item) => enriched.get(item.id) ?? item);
    if (enriched.size && !coverageIssues.has("catalog_rate_limited") && !timeLimitReached()) {
      try {
        const selection = await selectPartnerProducts({ seedProduct: heroDetail.product,
          seedVariant: heroDetail.variant, objective, partnerProducts: enrichedCandidates,
          seedDescriptionTrusted: seedScope.domain !== "global",
          partnerDescriptionTrusted: partnerScope.domain !== "global" });
        const selectedIds = [...new Set(selection?.productIds ?? [])]
          .filter((id) => observedIds.has(id));
        if (selectedIds.length) proposedIds = [...new Set([...selectedIds, ...proposedIds])];
        productSelectionPlanning = "detail_enriched";
      } catch { coverageIssues.add("enriched_selection_unavailable"); }
    }
    const enrichedSamples = partnerSamples.map((sample) => sample.map((item) =>
      enriched.get(item.id) ?? item));
    const candidateLimit = Math.min(32, Math.max(10,
      proposedIds.length + Math.min(16, enrichedCandidates.length)));
    const ordered = prioritizePartnerResearchProducts(enrichedSamples, proposedIds, candidateLimit);
    found = chooseProductCombinations([{ ...heroDetail.product, variants: [heroDetail.variant] }],
      ordered, objective, candidateLimit);
  }
  const assessed = [];
  // Use actual remaining calls rather than assuming every assessment will use
  // three Catalog calls. Inspect each selected distinct product while capacity
  // remains, including after another pair reaches Supported.
  const configuredAssessmentLimit = Number(process.env.COMMERCE_MAX_PAIR_ASSESSMENTS);
  const assessmentLimit = Math.min(32, found.length, Number.isFinite(configuredAssessmentLimit) &&
    configuredAssessmentLimit > 0 ? Math.max(12, Math.floor(configuredAssessmentLimit)) : 32);
  // A few exact pairs are checked at once; model review is the slow step.
  // Budget, time and rate-limit stops are checked between batches, and the
  // Catalog client's own call ceiling still applies inside a batch.
  const configuredPairConcurrency = Number(process.env.COMMERCE_PAIR_CONCURRENCY);
  const pairConcurrency = Number.isFinite(configuredPairConcurrency) && configuredPairConcurrency >= 1
    ? Math.min(4, Math.floor(configuredPairConcurrency)) : 2;
  const assessPair = async (pair) => {
    let seedDetail; let partnerDetail;
    try {
      [seedDetail, partnerDetail] = await Promise.all([
        Promise.resolve(heroDetail),
        detailCache.get(`${pair.partnerProduct.id}|${pair.partnerVariant.id}`) ??
          catalog.detail(partnerScope.domain, pair.partnerProduct.id, pair.partnerVariant.id,
            pair.partnerVariant.options, partnerScope.tools, { market,
              expectedSellerId: partnerScope.domain === "global" ? partnerStore.shopId : null }),
      ]);
      if ((seedScope.domain === "global" && seedDetail.variant.seller?.id !== seedStore.shopId) ||
          (partnerScope.domain === "global" && partnerDetail.variant.seller?.id !== partnerStore.shopId)) {
        coverageIssues.add("selected_seller_mismatch");
        return null;
      }
    } catch (error) {
      exactDetailFailures += 1;
      // Preserve the selected variant decision; a changed detail needs a new assessment.
      coverageIssues.add(error?.code === "catalog_rate_limited" ? "catalog_rate_limited"
        : error?.code === "catalog_budget_exhausted" ? "catalog_budget_reached"
          : "selected_variant_or_product_unverified");
      return null;
    }
    // The full product page can show a wearer the search result did not.
    if (wearerConflict(heroWearer, productWearer(partnerDetail.product) ?? partnerBrandWearer)) {
      coverageIssues.add("partner_product_wearer_mismatch");
      return null;
    }
    let evidenceSeedProduct = seedDetail.product;
    let evidencePartnerProduct = partnerDetail.product;
    const sourceAuthority = { seedDescription: seedScope.domain !== "global",
      partnerDescription: partnerScope.domain !== "global" };
    const evaluateSelectedEvidence = async () => {
      const result = await evaluateCommerceMechanism({ seedProduct: evidenceSeedProduct,
        seedVariant: seedDetail.variant, partnerProduct: evidencePartnerProduct,
        partnerVariant: partnerDetail.variant, objective, occasion: userConstraints.occasion ?? "",
        preferences: userConstraints.softPreferences ?? [],
        sourceAuthority: { ...sourceAuthority } }, { propose: proposeMechanism, verify: verifyMechanism });
      for (const issue of result.issues) coverageIssues.add(issue);
      return result;
    };
    let evaluation = await evaluateSelectedEvidence();
    let targetedEvidenceRetry = false;
    const needsMoreFacts = evaluation.proposal && evaluation.mechanism.evidence === "unknown" &&
      (evaluation.mechanism.reasonCodes.includes("product_facts_unverified") ||
        evaluation.rubric?.reason === "insufficient_facts" ||
        evaluation.rubric?.seedRoleGroundedInSelectedItem === false ||
        evaluation.rubric?.partnerRoleGroundedInSelectedItem === false);
    if (needsMoreFacts) {
      const retrySide = async (side, needed) => {
        if (!needed) return false;
        const detail = side === "seed" ? seedDetail : partnerDetail;
        const brand = side === "seed" ? seed : partner;
        const store = side === "seed" ? seedStore : partnerStore;
        const page = await readSelectedProductPage(detail.product, brand.officialWebsite, store.domain);
        if (!page?.description) return false;
        const descriptionTrusted = sourceAuthority[`${side}Description`];
        const current = typeof detail.product.description === "string" ? detail.product.description
          : detail.product.description?.plain ?? detail.product.description?.html ?? "";
        if (descriptionTrusted && current.toLowerCase().includes(page.description.toLowerCase())) return false;
        const product = { ...detail.product,
          description: { plain: `${page.description} ${descriptionTrusted ? current : ""}`.slice(0, 1200) } };
        if (side === "seed") evidenceSeedProduct = product;
        else evidencePartnerProduct = product;
        sourceAuthority[`${side}Description`] = true;
        return true;
      };
      const [seedAdded, partnerAdded] = await Promise.all([
        retrySide("seed", !evaluation.facts.seedFacts.length ||
          evaluation.rubric?.seedRoleGroundedInSelectedItem === false ||
          evaluation.rubric?.reason === "insufficient_facts"),
        retrySide("partner", !evaluation.facts.partnerFacts.length ||
          evaluation.rubric?.partnerRoleGroundedInSelectedItem === false ||
          evaluation.rubric?.reason === "insufficient_facts")]);
      if (seedAdded || partnerAdded) {
        targetedEvidenceRetry = true;
        evaluation = await evaluateSelectedEvidence();
      }
    }
    const { proposal: mechanismProposal, rubric: rubricVerification,
      mechanism: detailedMechanism } = evaluation;
    const marketToolsAvailable = globalTools.has("search_catalog") &&
      (globalTools.has("lookup_catalog") || globalTools.has("get_product"));
    const checkMarket = detailedMechanism.evidence === "supported" && marketToolsAvailable;
    const marketOffer = (product, variant, shopId) => catalog.globalOfferFor(product,
      variant, shopId, globalTools, { market }).catch((error) => {
      if (error?.code === "catalog_rate_limited") coverageIssues.add("catalog_rate_limited");
      if (error?.code === "catalog_budget_exhausted") coverageIssues.add("catalog_budget_reached");
      return { state: "unknown", reasonCode: "market_offer_unverified" };
    });
    const [seedOffer, partnerOffer] = checkMarket ? await Promise.all([
      marketOffer(seedDetail.product, seedDetail.variant, seedStore.shopId),
      marketOffer(partnerDetail.product, partnerDetail.variant, partnerStore.shopId),
    ]) : [{ state: "unknown", reasonCode: detailedMechanism.evidence === "supported"
      ? "global_market_capability_unavailable" : "mechanism_not_shortlisted" },
      { state: "unknown", reasonCode: detailedMechanism.evidence === "supported"
        ? "global_market_capability_unavailable" : "mechanism_not_shortlisted" }];
    const assortmentScope = { observedFamilies: [...observedSeedFamilies],
        inspectedQueries: inspected.flatMap((query) => [query.seed, query.partner]),
        anchorClaimRefs: ["seed_product"], coverage: "partial",
        limitationNotes: ["Only the listed product families and selected variants were reviewed."] };
    const assessment = assessCommerceOpportunity(validateCommerceEvidence({ objective, discoveryBasis,
      seed, partner, seedStore, partnerStore,
      seedDetail: { ...seedDetail, product: evidenceSeedProduct },
      partnerDetail: { ...partnerDetail, product: evidencePartnerProduct },
      selectedSeed: { productId: pair.seedProduct.id, variantId: pair.seedVariant.id },
      selectedPartner: { productId: pair.partnerProduct.id, variantId: pair.partnerVariant.id },
      cultureEvidence, mechanismProposal, rubricVerification, sourceAuthority,
      marketOffers: { seed: seedOffer, partner: partnerOffer },
      userConstraints, assortmentScope,
      reviewFlags: ["product_manufacturer_not_separately_verified",
        ...(detailedMechanism.requiresCompatibility ? ["selected_product_compatibility_unverified"] : []),
        ...([seedOffer, partnerOffer].some((offer) => offer.state !== "supported")
          ? ["market_shipping_unverified"] : [])] }));
    const assessedItem = { partnerId: partner.id, seedProductId: pair.seedProduct.id,
      seedVariantId: pair.seedVariant.id, partnerProductId: pair.partnerProduct.id,
      partnerVariantId: pair.partnerVariant.id, sellerId: partnerStore.shopId,
      assessment, // The offer view is transient and must not be persisted.
      live: { seed: { title: seedDetail.product.title, url: seedDetail.product.url,
        price: seedDetail.variant.price, availability: seedDetail.variant.availability },
      partner: { title: partnerDetail.product.title, url: partnerDetail.product.url,
        price: partnerDetail.variant.price, availability: partnerDetail.variant.availability },
      checkedAt: new Date().toISOString(), marketSignal: seedOffer.state === "supported" && partnerOffer.state === "supported"
        ? "Global Catalog market filter and exact seller offers" : "Shipping to selected market not confirmed" },
      references: { seed: { productId: pair.seedProduct.id, variantId: pair.seedVariant.id,
        sellerId: seedStore.shopId, storefrontDomain: seedScope.domain },
      partner: { productId: pair.partnerProduct.id, variantId: pair.partnerVariant.id,
        sellerId: partnerStore.shopId, storefrontDomain: partnerScope.domain } } };
    pairOutcomes.push({ opportunityKey: opportunityKeyFor(objective, assessedItem.references),
      partnerCategory: taxonomyCategory(partnerDetail.product), status: assessment.status,
      mechanismState: assessment.productMechanism.gate.state, reasonCodes: assessment.reasonCodes });
    let evaluationEvent = null;
    if (onEvaluation) {
      const verified = verifiedMechanismFacts(mechanismProposal, evidenceSeedProduct,
        evidencePartnerProduct, seedDetail.variant, partnerDetail.variant, sourceAuthority);
      // Opt-in benchmark provenance: exact selected refs plus decisions and
      // source field kinds. No Catalog response, passage, image, or offer fact.
      evaluationEvent = ({ checkedAt: new Date().toISOString(),
        selected: { seed: { productId: pair.seedProduct.id, variantId: pair.seedVariant.id,
          sellerId: seedStore.shopId, storefrontDomain: seedScope.domain },
        partner: { productId: pair.partnerProduct.id, variantId: pair.partnerVariant.id,
          sellerId: partnerStore.shopId, storefrontDomain: partnerScope.domain } },
        proposalKind: mechanismProposal?.kind ?? null,
        targetedEvidenceRetry,
        proposalRationale: { roles: assessment.productMechanism.roles,
          benefit: mechanismProposal?.benefit ?? null,
          occasion: mechanismProposal?.occasion ?? null },
        verifiedFactSources: {
          seed: mechanismFactSourceKinds(verified.seedFacts, evidenceSeedProduct,
            seedDetail.variant, sourceAuthority.seedDescription),
          partner: mechanismFactSourceKinds(verified.partnerFacts, evidencePartnerProduct,
            partnerDetail.variant, sourceAuthority.partnerDescription) },
        descriptionAuthority: sourceAuthority,
        rubric: rubricVerification ? { ...rubricVerification } : null,
        mechanism: { state: assessment.productMechanism.gate.state,
          attribute: assessment.productMechanism.attributeEvidence.state,
          coherence: assessment.productMechanism.jointUseCoherence.state,
          incremental: assessment.productMechanism.incrementalValue.state,
          validationChecks: detailedMechanism.validationChecks ?? null,
          reasonCodes: detailedMechanism.reasonCodes },
        objectiveFit: assessment.objectiveFit.state,
        verdict: assessment.status, reasonCodes: assessment.reasonCodes });
    }
    return { item: assessedItem, evaluationEvent };
  };
  for (let cursor = 0; cursor < found.length;) {
    if (timeLimitReached()) { coverageIssues.add("research_time_limit_reached"); break; }
    if (assessed.length >= assessmentLimit || catalog.callsUsed() >= maxCatalogCalls - 2) {
      if (catalog.callsUsed() >= maxCatalogCalls - 2) coverageIssues.add("catalog_budget_reached");
      break;
    }
    // A pair can use about four Catalog calls (two details, two market offers).
    const callCapacity = Math.max(1, Math.floor((maxCatalogCalls - 2 - catalog.callsUsed()) / 4));
    const batch = found.slice(cursor, cursor + Math.min(pairConcurrency,
      assessmentLimit - assessed.length, callCapacity));
    cursor += batch.length;
    // Keep results and developer evaluation events in the planned pair order.
    for (const outcome of await Promise.all(batch.map(assessPair))) {
      if (!outcome) continue;
      if (outcome.evaluationEvent) onEvaluation(outcome.evaluationEvent);
      assessed.push(outcome.item);
    }
    if (coverageIssues.has("catalog_rate_limited") || coverageIssues.has("catalog_budget_reached")) break;
  }
  // Discovery recommends only pairs with a source-grounded joint benefit.
  // Keep weaker/contradictory assessments in the developer evaluation trace;
  // direct comparison still returns its requested pair's honest verdict.
  const recommendable = discoveryBasis === "qloo_native_brand"
    ? assessed.filter((item) => item.assessment.status === "supported" ||
        (item.assessment.status === "needs_verification" &&
          item.assessment.productMechanism.attributeEvidence.state === "supported" &&
          item.assessment.productMechanism.jointUseCoherence.state === "supported" &&
          item.assessment.productMechanism.incrementalValue.state === "supported"))
    : assessed;
  return { opportunities: rankCommerceOpportunities(recommendable, { objective,
    statedOccasion: userConstraints.occasion }),
    coverage: inspected.length ? "partial_assortment" : coverageIssues.has("catalog_rate_limited")
      ? "catalog_rate_limited" : "no_catalog_results",
    discoveryBasis, inspectedQueries: inspected, coverageIssues: [...coverageIssues],
    hypothesesConsidered: found.length, assessedCount: assessed.length,
    recommendableCount: recommendable.length,
    observedCandidateCount: seenSearchProducts.size,
    eligibleCandidateCount, screenedCandidateCount, screeningBatchCount,
    exploredRoleCount: exploredRoles.size,
    searchPagesFetched, exactDetailFailures,
    stopReason: coverageIssues.has("catalog_rate_limited") ? "catalog_rate_limited"
      : coverageIssues.has("research_time_limit_reached") ? "research_time_limit_reached"
      : coverageIssues.has("catalog_budget_reached") ? "catalog_budget_reached"
        : assessed.length >= assessmentLimit && assessed.length < found.length
          ? "assessment_capacity_reached" : coverageIssues.has("search_novelty_exhausted")
            ? "search_novelty_exhausted" : "query_plan_exhausted",
    productSearchPlanning, productSelectionPlanning, callsUsed: catalog.callsUsed(), memory: memory() };
}
