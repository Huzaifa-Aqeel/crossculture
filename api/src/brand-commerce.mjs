import { isValidatedCommerceEvidence } from "./commerce-evidence.mjs";

// Brand × Brand decisions. The historical v4 scorer is not imported here.
export const COMMERCE_VERSION = "brand-commerce-v1.1";
const STATUS_ORDER = { supported: 0, needs_verification: 1, unsupported: 2 };
const PASSING_CULTURE = new Set(["native_recommendation_verified", "direct_pair_supported",
  "context_relationship_corroborated"]);
const CULTURE = new Set([...PASSING_CULTURE, "direction_only", "unknown", "contradicted"]);
const EXPLANATION = { specific_theme: 0, broad_theme: 1, no_named_theme: 2 };
const SUITABILITY = { matches_explicit_focus: 0, clearly_serves_objective: 1, adequately_serves_objective: 2 };
const QUALITY = { distinct_concrete_joint_value: 0, credible_joint_value: 1 };
const DIFFERENTIATION = { evidenced_partner_specific_reason: 0, generic_category_reason: 1 };
const COVERAGE = { good: 0, limited: 1, poor: 2 };
const MECHANISMS = new Set(["functional_complement", "occasion_complement", "assortment_complement",
  "duplicate_or_substitute", "incompatible", "unproven"]);
const state = (value) => value === "supported" || value === "contradicted" ? value : "unknown";
const unique = (values) => [...new Set(values.filter(Boolean))];
function check(value, name, refs = []) {
  const result = state(value);
  return { state: result, reasonCodes: result === "supported" ? [] : [name + "_" + result],
    sourceRefs: refs, missingFacts: result === "unknown" ? [name] : [] };
}

export function assessCommerceOpportunity(input) {
  if (!isValidatedCommerceEvidence(input)) {
    throw new Error("Server-validated commerce evidence required.");
  }
  if (!["product_bundle", "cross_sell"].includes(input?.objective)) throw new Error("Commerce objective required.");
  if (!MECHANISMS.has(input.mechanism)) throw new Error("Recognized product mechanism required.");
  const relationship = CULTURE.has(input.culturalRelationship) ? input.culturalRelationship : "unknown";
  const explanation = Object.hasOwn(EXPLANATION, input.culturalExplanation)
    ? input.culturalExplanation : "no_named_theme";
  const identity = check(input.identity, "identity", input.identityRefs ?? []);
  const culturalGate = check(relationship === "contradicted" ? "contradicted"
    : PASSING_CULTURE.has(relationship) ? "supported" : "unknown",
  "cultural_relationship", input.culturalRefs ?? []);
  const attributeEvidence = check(input.attributeEvidence, "product_attributes", input.productRefs ?? []);
  const jointUseCoherence = check(input.jointUseCoherence, "joint_use", input.productRefs ?? []);
  const incrementalValue = check(input.incrementalValue, "incremental_value", input.productRefs ?? []);
  const checks = [attributeEvidence, jointUseCoherence, incrementalValue];
  const mechanismState = input.mechanism === "incompatible" || checks.some((item) => item.state === "contradicted")
    ? "contradicted" : checks.every((item) => item.state === "supported") &&
      !["unproven", "duplicate_or_substitute"].includes(input.mechanism) ? "supported" : "unknown";
  const productMechanism = { kind: input.mechanism, attributeEvidence, jointUseCoherence, incrementalValue,
    gate: check(mechanismState, "product_mechanism", input.productRefs ?? []),
    roles: { seedRole: String(input.seedRole ?? ""), partnerRole: String(input.partnerRole ?? "") },
    boundedRationale: String(input.rationale ?? "").slice(0, 500) };
  const allowed = input.objective === "product_bundle"
    ? new Set(["functional_complement", "occasion_complement"])
    : new Set(["functional_complement", "occasion_complement", "assortment_complement"]);
  const offers = input.objective === "product_bundle" ? [state(input.seedOffer), state(input.partnerOffer)]
    : [state(input.seedAssortment), state(input.partnerOffer)];
  const objectiveState = offers.includes("contradicted") ? "contradicted"
    : !allowed.has(input.mechanism) || offers.includes("unknown") ? "unknown" : mechanismState;
  const objectiveFit = check(objectiveState, "objective_fit", input.productRefs ?? []);
  const commercialChecks = Object.fromEntries(Object.entries(input.hardConstraints ?? {})
    .map(([key, value]) => [key, check(value, "requirement_" + key)]));
  const required = [identity, culturalGate, productMechanism.gate, objectiveFit, ...Object.values(commercialChecks)];
  const status = required.some((item) => item.state === "contradicted") ? "unsupported"
    : required.some((item) => item.state === "unknown") ? "needs_verification" : "supported";
  const evidenceCoverage = Object.hasOwn(COVERAGE, input.evidenceCoverage) ? input.evidenceCoverage
    : status === "supported" ? "good" : "limited";
  const rankingFeatures = status === "supported" ? {
    objectiveSuitability: Object.hasOwn(SUITABILITY, input.objectiveSuitability)
      ? input.objectiveSuitability : "adequately_serves_objective",
    productQuality: Object.hasOwn(QUALITY, input.productQuality)
      ? input.productQuality : "credible_joint_value",
    culturalExplanation: explanation,
    partnerDifferentiation: Object.hasOwn(DIFFERENTIATION, input.partnerDifferentiation)
      ? input.partnerDifferentiation : "generic_category_reason",
    preferenceRationale: unique(input.preferenceRationale ?? []),
    verifiedMatchedPreferencesCount: Number.isInteger(input.verifiedMatchedPreferencesCount)
      ? Math.max(0, Math.min(6, input.verifiedMatchedPreferencesCount)) : 0,
    unresolvedPreferencesCount: Number.isInteger(input.unresolvedPreferencesCount)
      ? Math.max(0, Math.min(6, input.unresolvedPreferencesCount)) : 0,
    materialEvidenceCoverage: evidenceCoverage,
    stablePartnerKey: String(input.stablePartnerKey ?? ""),
    stableOfferKey: String(input.stableOfferKey ?? ""),
    reasonCodes: unique(input.rankingReasonCodes ?? []),
  } : null;
  return { policyVersion: COMMERCE_VERSION, status, discoveryBasis: input.discoveryBasis ?? "user_specified",
    researchLead: relationship === "direction_only", culturalRelationship: relationship,
    culturalExplanation: explanation, culturalTheme: explanation === "specific_theme"
      ? String(input.culturalTheme ?? "").slice(0, 120) : null,
    identity, culturalGate, productMechanism, objectiveFit,
    commercialChecks, commercialState: Object.values(commercialChecks).some((item) => item.state === "contradicted")
      ? "offer_blocked" : Object.values(commercialChecks).some((item) => item.state === "unknown")
        ? "offer_needs_check" : "offer_ready_to_evaluate",
    evidenceCoverage, rankingFeatures,
    assortmentScope: input.assortmentScope ? {
      observedFamilies: unique(input.assortmentScope.observedFamilies ?? []).slice(0, 12),
      inspectedQueries: unique(input.assortmentScope.inspectedQueries ?? []).slice(0, 12),
      anchorClaimRefs: unique(input.assortmentScope.anchorClaimRefs ?? []).slice(0, 4),
      coverage: ["adequate_for_claim", "partial"].includes(input.assortmentScope.coverage)
        ? input.assortmentScope.coverage : "unknown",
      limitationNotes: unique(input.assortmentScope.limitationNotes ?? []).slice(0, 4),
    } : null,
    reasonCodes: unique(required.flatMap((item) => item.reasonCodes)),
    materialUnknowns: unique(required.flatMap((item) => item.missingFacts)),
    dealUnknowns: ["Partner willingness and commercial rights need confirmation.",
      "Negotiated pricing and fulfillment need agreement.",
      ...(input.reviewFlags?.includes("selected_offer_explicit_third_party_cobrand")
        ? ["The selected offer names another brand; confirm its maker, positioning, and any rights needed for a proposed campaign."]
        : [])],
    reviewFlags: unique(input.reviewFlags ?? []), evidenceRefs: unique(input.evidenceRefs ?? []),
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString() };
}

function compareSupported(a, b) {
  const left = a.assessment.rankingFeatures;
  const right = b.assessment.rankingFeatures;
  for (const [order, field] of [[SUITABILITY, "objectiveSuitability"], [QUALITY, "productQuality"],
    [EXPLANATION, "culturalExplanation"], [DIFFERENTIATION, "partnerDifferentiation"]]) {
    const difference = (order[left?.[field]] ?? 9) - (order[right?.[field]] ?? 9);
    if (difference) return difference;
  }
  const preferenceDifference = (right?.verifiedMatchedPreferencesCount ?? 0) -
    (left?.verifiedMatchedPreferencesCount ?? 0);
  return preferenceDifference || (COVERAGE[left?.materialEvidenceCoverage] ?? 9) -
    (COVERAGE[right?.materialEvidenceCoverage] ?? 9);
}

export function rankCommerceOpportunities(opportunities) {
  const byOffer = new Map();
  for (const item of opportunities) {
    const key = [item.partnerId, item.seedProductId, item.seedVariantId,
      item.references?.seed?.sellerId, item.partnerProductId, item.partnerVariantId, item.sellerId].join("|");
    if (!byOffer.has(key)) byOffer.set(key, item);
  }
  const sorted = [...byOffer.values()].sort((a, b) =>
    (STATUS_ORDER[a.assessment.status] ?? 9) - (STATUS_ORDER[b.assessment.status] ?? 9) ||
    (a.assessment.status === "supported" ? compareSupported(a, b) : 0) ||
    String(a.partnerId).localeCompare(String(b.partnerId)) ||
    String(a.seedProductId).localeCompare(String(b.seedProductId)) ||
    String(a.seedVariantId).localeCompare(String(b.seedVariantId)) ||
    String(a.references?.seed?.sellerId).localeCompare(String(b.references?.seed?.sellerId)) ||
    String(a.partnerProductId).localeCompare(String(b.partnerProductId)) ||
    String(a.partnerVariantId).localeCompare(String(b.partnerVariantId)) ||
    String(a.sellerId).localeCompare(String(b.sellerId)));
  return Object.fromEntries(Object.keys(STATUS_ORDER).map((status) => {
    const groups = new Map();
    for (const item of sorted.filter((entry) => entry.assessment.status === status)) {
      if (!groups.has(item.partnerId)) groups.set(item.partnerId, []);
      groups.get(item.partnerId).push(item);
    }
    return [status, [...groups].map(([partnerId, items]) => ({ partnerId,
      best: items[0], otherOpportunities: items.slice(1) }))];
  }));
}

// A stored reference can be used for a fresh lookup. Never store the catalog response.
export function durableCommerceDecision(item, { qlooResponseIds = [], culturalSourceRefs = [],
  identitySourceRefs = [], externalSourceRefs = [], externalFindings = [], market = "US" } = {}) {
  if (item?.assessment?.policyVersion !== COMMERCE_VERSION) throw new Error("Commerce assessment required.");
  const reference = (value) => {
    if (!/^gid:\/\/shopify\/(?:Product|p)\/[A-Za-z0-9_-]{1,128}$/.test(value?.productId ?? "") ||
        !/^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]{1,128}$/.test(value?.variantId ?? "") ||
        !/^gid:\/\/shopify\/Shop\/[A-Za-z0-9_-]{1,128}$/.test(value?.sellerId ?? "") ||
        !(value?.storefrontDomain === "global" ||
          /^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value?.storefrontDomain ?? ""))) {
      throw new Error("Exact selected offer reference is required.");
    }
    // An allowlist protects the stored-reference exception from accidental payload copies.
    return { productId: value.productId, variantId: value.variantId,
      sellerId: value.sellerId, storefrontDomain: value.storefrontDomain };
  };
  return { policyVersion: COMMERCE_VERSION, assessment: item.assessment,
    market: /^[A-Z]{2}$/.test(market) ? market : "US",
    references: { seed: reference(item.references?.seed), partner: reference(item.references?.partner) },
    qlooResponseIds: qlooResponseIds.filter((id) => typeof id === "string"),
    culturalSourceRefs: culturalSourceRefs.filter((id) => typeof id === "string"),
    identitySourceRefs: identitySourceRefs.filter((id) => typeof id === "string"),
    externalSourceRefs: externalSourceRefs.filter((id) => typeof id === "string"),
    externalFindings: externalFindings.filter((item) =>
      ["official_context", "independent_context_to_review", "independent_concern_to_review"]
        .includes(item?.kind) && externalSourceRefs.includes(item.url) &&
      /^https:\/\//.test(item.url)).slice(0, 6).map((item) => ({ kind: item.kind,
      url: item.url, publishedAt: item.publishedAt ?? null })) };
}
