import { personalQlooEntityTags, personalQlooRank,
  personalQlooRecommendBrands } from "./personal-qloo.mjs";
import { withWebSearch, officialDomainOf } from "./web-research.mjs";

const SPECIFIC_TAG = /^urn:tag:(?:aesthetic_property|keyword):qloo:[a-z0-9_]+$/;
const GENERIC = /^(?:design|lifestyle|fashion|indie|minimalist|artsy|creative|home goods|functionality)$/i;
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// A forced Qloo result is only a lead. Direct-pair cultural support requires
// the same specific Qloo tag for both brands and inspected first-party pages
// independently describing that exact theme for each business.
export async function investigateDirectCommerceCulture(ownerUserId, seed, partner, {
  recommend = personalQlooRecommendBrands, focused = personalQlooRank,
  tags = personalQlooEntityTags, search = withWebSearch,
} = {}) {
  const base = { relationship: "unknown", explanation: "no_named_theme", theme: null,
    qlooResponseIds: [], sourceUrls: [], reasonCode: "pair_culture_unverified" };
  // This is a relationship check for the specified partner, not candidate
  // acquisition. Reuse the user's private recommendation response when fresh.
  // The same unconstrained, Brand-A-anchored recommendation as discovery, read
  // deeper when needed: a partner in Qloo's top 20 (the provider maximum) is a native recommendation
  // even if it was outside the top 12 used for Find Partners.
  const inResults = (result) => result?.sampleData !== true &&
    ["ok", "partial"].includes(result?.envelope?.status) &&
    result.envelope.results?.some((item) => item.entity_id === partner.qlooId &&
      (!item.type || ["urn:entity", "urn:entity:brand"].includes(item.type)));
  let discovery = await recommend(ownerUserId, seed.qlooId).catch(() => null);
  if (!inResults(discovery)) {
    const deeper = await recommend(ownerUserId, seed.qlooId, { limit: 20 }).catch(() => null);
    if (inResults(deeper)) discovery = deeper;
  }
  const native = inResults(discovery);
  if (native) return { relationship: "native_recommendation_verified",
    explanation: "no_named_theme", theme: null,
    qlooResponseIds: discovery.responseId ? [discovery.responseId] : [], sourceUrls: [],
    reasonCode: "unconstrained_native_pair_returned",
    supportProof: { kind: "direct_unconstrained_native", seedQlooId: seed.qlooId,
      partnerQlooId: partner.qlooId, unconstrained: true,
      envelope: discovery.envelope } };
  // Reverse check: Brand A in the chosen partner's own unconstrained brand
  // recommendation (top 20). This is a real association Qloo returned for that
  // partner, not a forced result; it supports the pair, not shared customers.
  const reverse = await recommend(ownerUserId, partner.qlooId, { limit: 20 }).catch(() => null);
  const reverseHit = reverse?.sampleData !== true &&
    ["ok", "partial"].includes(reverse?.envelope?.status) &&
    reverse.envelope.results?.some((item) => item.entity_id?.toLowerCase() === seed.qlooId.toLowerCase() &&
      (!item.type || ["urn:entity", "urn:entity:brand"].includes(item.type)));
  if (reverseHit) return { relationship: "direct_pair_supported", explanation: "no_named_theme",
    theme: null, qlooResponseIds: reverse.responseId ? [reverse.responseId] : [], sourceUrls: [],
    reasonCode: "reverse_unconstrained_native_pair_returned",
    supportProof: { kind: "reverse_unconstrained_native", seedQlooId: seed.qlooId,
      partnerQlooId: partner.qlooId, unconstrained: true, envelope: reverse.envelope } };
  const focus = await focused(ownerUserId, seed.qlooId, partner.qlooId).catch(() => null);
  if (focus?.responseId) base.qlooResponseIds.push(focus.responseId);
  const returned = focus?.envelope?.status === "ok" && focus.envelope.results?.some((item) =>
    item.entity_id === partner.qlooId && Number.isFinite(item.affinity));
  if (!returned) return { ...base, reasonCode: "focused_qloo_result_unavailable" };
  const [seedTags, partnerTags] = await Promise.all([
    tags(ownerUserId, seed.qlooId).catch(() => null),
    tags(ownerUserId, partner.qlooId).catch(() => null),
  ]);
  for (const result of [seedTags, partnerTags]) {
    if (result?.responseId) base.qlooResponseIds.push(result.responseId);
  }
  const partnerIds = new Set((partnerTags?.tags ?? []).map((tag) => tag.id));
  const shared = (seedTags?.tags ?? []).filter((tag) => partnerIds.has(tag.id) &&
    SPECIFIC_TAG.test(tag.id) && norm(tag.name).length >= 8 && !GENERIC.test(norm(tag.name)));
  for (const tag of shared.slice(0, 2)) {
    const [seedDomain, partnerDomain] = [officialDomainOf(seed.officialWebsite),
      officialDomainOf(partner.officialWebsite)];
    if (!seedDomain || !partnerDomain) break;
    const [left, right] = await Promise.all([
      search(`${seed.name} ${tag.name}`, { includeDomains: [seedDomain], focus: tag.name }).catch(() => null),
      search(`${partner.name} ${tag.name}`, { includeDomains: [partnerDomain], focus: tag.name }).catch(() => null),
    ]);
    const accepted = (response, domain) => (response?.results ?? []).find((page) =>
      page.inspected === true && officialDomainOf(page.url) === domain &&
      norm(page.snippet).includes(norm(tag.name)));
    const seedPage = accepted(left, seedDomain);
    const partnerPage = accepted(right, partnerDomain);
    if (seedPage && partnerPage) return { relationship: "direct_pair_supported",
      explanation: "specific_theme", theme: tag.name, qlooResponseIds: base.qlooResponseIds,
      sourceUrls: [seedPage.url, partnerPage.url], reasonCode: "specific_pair_theme_corroborated",
      supportProof: { kind: "direct_pair", seedQlooId: seed.qlooId,
        partnerQlooId: partner.qlooId, sharedTagId: tag.id, theme: tag.name,
        focusEnvelope: focus.envelope, seedTags: seedTags?.tags ?? [],
        partnerTags: partnerTags?.tags ?? [],
        seedPage, partnerPage } };
  }
  return { ...base, reasonCode: shared.length ? "shared_theme_external_check_unverified"
    : "only_forced_or_generic_qloo_evidence" };
}
