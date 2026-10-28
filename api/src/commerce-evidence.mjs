import { observedProductType, productMechanism, verifiedMechanismFacts,
  mechanismFactSourceKinds, productDescriptionText } from "./commerce-products.mjs";
import { brandGenre } from "./brand-genres.mjs";

const QLOO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Qloo's brand-attribute tags: what a brand stands for and who it serves
// (e.g. "Minimalist Design", "Ethical Production", "Conscious Consumers").
const SPECIFIC_TAG = /^urn:tag:(?:aesthetic_property|keyword|lifestyle|customer_segment|customer_identity|style|influencer_appeal|cultural_relevance):qloo:[a-z0-9_]+$/;
const CONTEXT_TAG = /^urn:tag:[a-z_]+:qloo:[a-z0-9_]+$/;
const GENERIC_THEME = /^(?:design|lifestyle|fashion|indie|minimalist|artsy|creative|home goods|functionality)$/i;
const SHOP_ID = /^gid:\/\/shopify\/Shop\/[A-Za-z0-9_-]+$/;
// Qloo brand tags also carry cross-domain audience tastes. Only music and media
// genres read as a shared taste; dishes ("Avocado Toast"), payment, price,
// rating, place and story keywords are noise.
const AUDIENCE_TASTE_TAG = /^urn:tag:(?:genre:media|genre:music):[a-z0-9_:]+$/;
const AUDIENCE_TASTE_NOISE = /^(?:friend|friends|friendship|love|family|family relationships|relationships|21st century|20th century|female protagonist|male protagonist|teenage girl|teenage boy|single mother|single father|death|murder|husband|wife|marriage|based on novel|new york city|los angeles)$/i;
// Shared tastes as readable phrases: a music genre reads "indie music".
// Qloo's popularity marks near-universal tags: folk music, for example, sits
// at 0.9997 and was carried by 12 of 16 brands checked (26 Oct), so it says
// nothing about a pair. Tags without a popularity are treated the same way.
export const UNIVERSAL_TAG_POPULARITY = 0.9995;
const distinctive = (tag) => Number.isFinite(tag?.popularity) && tag.popularity < UNIVERSAL_TAG_POPULARITY;
export function sharedAudienceTastes(seedTags, partnerTags, limit = 3) {
  const clean = (tags) => (Array.isArray(tags) ? tags : []).filter(distinctive).map((tag) => ({ id: tag?.id,
    name: String(tag?.name ?? "").trim() })).filter((tag) => AUDIENCE_TASTE_TAG.test(tag.id ?? "") &&
    tag.name.length >= 3 && !AUDIENCE_TASTE_NOISE.test(tag.name));
  const partnerIds = new Set(clean(partnerTags).map((tag) => tag.id));
  const phrase = (tag) => tag.id.startsWith("urn:tag:genre:music:") && !/\bmusic$/i.test(tag.name)
    ? `${tag.name.toLowerCase()} music` : tag.name.toLowerCase();
  return [...new Set(clean(seedTags).filter((tag) => partnerIds.has(tag.id)).map(phrase))].slice(0, limit);
}
// Who both brands appeal to: a brand-level claim, since Qloo describes brands,
// not products. A tag counts when Qloo gives it to both brands in separate
// requests, it is not near-universal, and it is core to both: in the top half
// of each brand's list (Caraway and Arhaus share "toddlers", but 20th and
// 28th of 30, so it is not shown). Tags are ordered by the weaker of the two
// positions, so a tag must be strong for both brands; one the selected
// products' own text mentions goes first, but product text never hides a tag.
// People tags (customer identity, segment, influencer appeal) read "resonate
// with"; lifestyle tags read "associated with". Explanation only.
const PEOPLE_TAG = /^urn:tag:(?:customer_identity|customer_segment|influencer_appeal):qloo:/;
const LIFESTYLE_TAG = /^urn:tag:lifestyle:qloo:/;
const ROLE_WORDS = new Set(["advocates", "advocate", "enthusiasts", "enthusiast", "consumers", "consumer",
  "individuals", "people", "influencers", "influencer", "lovers", "seekers", "shoppers", "bloggers",
  "lifestyle", "living", "style", "conscious", "focused", "minded", "fans", "community"]);
// A segment naming children ("Toddlers", "Infants") means their parents;
// children are never presented as the audience.
const CHILD_SEGMENT = /\b(?:toddlers?|infants?|bab(?:y|ies)|kids?|children|newborns?|teens?|teenagers?|tweens?)\b/i;
const stems = (text) => new Set(plainIdentity(text).split(" ").filter((word) => word.length >= 4)
  .map((word) => word.slice(0, 5)));
export function sharedAudienceAppeal(seedTags, partnerTags, productTexts = [], limit = 2) {
  // Each brand's core tags, keyed by name, with their position in Qloo's order.
  const core = (tags) => {
    const list = Array.isArray(tags) ? tags : [];
    const half = Math.ceil(list.length / 2);
    const byName = new Map();
    list.forEach((tag, index) => {
      const name = plainIdentity(tag?.name);
      if (index < half && distinctive(tag) && name.length >= 4 && !byName.has(name) &&
          !CHILD_SEGMENT.test(String(tag?.name ?? "")) &&
          (PEOPLE_TAG.test(tag?.id ?? "") || LIFESTYLE_TAG.test(tag?.id ?? ""))) {
        byName.set(name, { tag, position: index + 1 });
      }
    });
    return byName;
  };
  const seed = core(seedTags);
  const partner = core(partnerTags);
  const products = stems(productTexts.filter((value) => typeof value === "string").join(" "));
  const mentioned = (name) => name.split(" ").filter((word) => word.length >= 4 && !ROLE_WORDS.has(word))
    .some((word) => products.has(word.slice(0, 5)));
  const shared = [...seed].filter(([name]) => partner.has(name)).map(([name, own]) => {
    const other = partner.get(name);
    // Qloo's own wording, lower-cased ("women's fashion"), for display.
    return { name: String(own.tag.name).trim().toLowerCase(), people: PEOPLE_TAG.test(own.tag.id) || PEOPLE_TAG.test(other.tag.id),
      weaker: Math.max(own.position, other.position), mentioned: mentioned(name) };
  }).sort((a, b) => Number(b.mentioned) - Number(a.mentioned) || a.weaker - b.weaker);
  return { people: shared.filter((tag) => tag.people).slice(0, limit).map((tag) => tag.name),
    lifestyle: shared.filter((tag) => !tag.people).slice(0, limit).map((tag) => tag.name) };
}
const validated = new WeakSet();
const host = (url) => { try { const parsed = new URL(url); return parsed.protocol === "https:" ? parsed.hostname : null; }
  catch { return null; } };
const domain = (url) => host(url)?.replace(/^www\./, "") ?? null;
// The entity IDs Qloo reports as the input signals of a recommendation.
function anchoredOn(envelope, qlooId) {
  const effects = envelope?.explainability?.["signal.interests.entities"]?.effect_on_all_recs;
  return Array.isArray(effects) && effects.length > 0 && effects.every((item) =>
    String(item?.entity_id ?? "").toLowerCase() === String(qlooId).toLowerCase());
}
const plainIdentity = (value) => String(value ?? "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
// A merchant may sell a product co-branded with someone else. Recognize only
// an explicit title prefix; do not infer ownership from catalog seller data.
export function hasExplicitThirdPartyCoBrand(product, merchantName) {
  const title = String(product?.title ?? "").trim();
  const match = title.match(/^(.{2,80}?)\s+(?:×|[xX])\s+([A-Z][\p{L}\p{N}.'-]+)(?:\s|$)/u);
  return Boolean(match && plainIdentity(match[1]) === plainIdentity(merchantName) &&
    plainIdentity(match[2]) !== plainIdentity(merchantName));
}
function verifiedSelectedProductPage(page, detail, seed, seedStore) {
  if (page?.inspected !== true || !page.url || !detail?.product?.url ||
      plainIdentity(page.title) !== plainIdentity(detail.product.title) ||
      ![domain(seed.officialWebsite), domain(`https://${seedStore?.domain}`)]
        .includes(domain(page.url))) return false;
  try {
    const actual = new URL(page.url);
    const selected = new URL(detail.product.url);
    return actual.origin === selected.origin && actual.pathname === selected.pathname &&
      actual.pathname.startsWith("/products/") &&
      typeof page.description === "string" && page.description.length <= 700;
  } catch { return false; }
}
const sameSelected = (detail, selected) => Boolean(detail?.product?.id && detail.product.id === selected?.productId &&
  detail?.variant?.id && detail.variant.id === selected?.variantId && detail.product.title);
const priceCheck = (variant, limit) => !limit ? "supported" :
  variant?.price?.currency !== limit.currencyCode || !Number.isInteger(variant.price?.amount)
    ? "unknown" : variant.price.amount <= limit.amountMinor ? "supported" : "contradicted";

// Only the server's verified identity, Qloo, and selected-detail adapters feed this
// normalizer. Client/LLM states and ranking labels are deliberately ignored.
export function validateCommerceEvidence(raw) {
  if (!["product_bundle", "cross_sell"].includes(raw?.objective)) throw new Error("Commerce objective required.");
  const { seed, partner, seedStore, partnerStore, seedDetail, partnerDetail,
    selectedSeed, selectedPartner, userConstraints = {} } = raw;
  const cultureEvidence = raw.cultureEvidence ?? {};
  const brandsVerified = seed?.identityStatus === "verified" && partner?.identityStatus === "verified" &&
    seed.id && partner.id && seed.id !== partner.id && host(seed.officialWebsite) &&
    host(partner.officialWebsite);
  const storesVerified = SHOP_ID.test(seedStore?.shopId ?? "") && SHOP_ID.test(partnerStore?.shopId ?? "") &&
    seedStore.shopId !== partnerStore.shopId && host(`https://${seedStore.domain}`) &&
    host(`https://${partnerStore.domain}`) &&
    (seedStore.officialHost ?? seedStore.domain) === host(seed.officialWebsite) &&
    (partnerStore.officialHost ?? partnerStore.domain) === host(partner.officialWebsite);
  const selectedSeedValid = sameSelected(seedDetail, selectedSeed) &&
    (!seedDetail.variant.seller?.id || seedDetail.variant.seller.id === seedStore?.shopId);
  const selectedPartnerValid = sameSelected(partnerDetail, selectedPartner) &&
    (!partnerDetail.variant.seller?.id || partnerDetail.variant.seller.id === partnerStore?.shopId);
  const seedCoBrand = hasExplicitThirdPartyCoBrand(seedDetail?.product, seed?.name);
  const partnerCoBrand = hasExplicitThirdPartyCoBrand(partnerDetail?.product, partner?.name);
  const explicitCoBrand = seedCoBrand || partnerCoBrand;
  const ownershipVerb = /\b(?:made|manufactured|designed|produced|owns)\b/i;
  const namesOwnership = (name) => {
    const normalizedName = plainIdentity(name);
    const benefit = plainIdentity(raw.mechanismProposal?.benefit);
    return normalizedName && new RegExp(`(?:^| )${normalizedName} (?:made|manufactured|designed|produced|owns)(?: |$)`)
      .test(benefit);
  };
  const proposedOwnershipClaim = (seedCoBrand && ownershipVerb.test(raw.mechanismProposal?.seedRole ?? "")) ||
    (partnerCoBrand && ownershipVerb.test(raw.mechanismProposal?.partnerRole ?? "")) ||
    (seedCoBrand && namesOwnership(seed?.name)) || (partnerCoBrand && namesOwnership(partner?.name));
  const identity = brandsVerified && storesVerified && selectedSeedValid && selectedPartnerValid &&
    !(explicitCoBrand && proposedOwnershipClaim)
    ? "supported" : seedDetail?.variant?.seller?.id &&
      seedDetail.variant.seller.id !== seedStore?.shopId || partnerDetail?.variant?.seller?.id &&
      partnerDetail.variant.seller.id !== partnerStore?.shopId ? "contradicted" : "unknown";

  let culturalRelationship = "unknown";
  let culturalExplanation = "no_named_theme";
  let culturalTheme = null;
  let culturalThemes = [];
  let audienceTastes = [];
  let audienceAppeal = { people: [], lifestyle: [] };
  let culturalCategory = null;
  const brandAnchored = QLOO_ID.test(seed?.qlooId ?? "") && QLOO_ID.test(partner?.qlooId ?? "") &&
    cultureEvidence.seedQlooId === seed.qlooId && cultureEvidence.partnerQlooId === partner.qlooId &&
    ["ok", "partial"].includes(cultureEvidence.envelope?.status) &&
    Array.isArray(cultureEvidence.envelope.results) &&
    cultureEvidence.envelope.results.some((item) => item.entity_id === partner.qlooId);
  // A category request: the starting brand was its only signal (Qloo's own
  // explainability) and the request was limited to exactly that category.
  const categoryAnchored = raw.discoveryBasis === "qloo_category_brand" && brandAnchored &&
    cultureEvidence.unconstrained === false && brandGenre(cultureEvidence.categoryTagId) &&
    anchoredOn(cultureEvidence.envelope, seed.qlooId) &&
    (cultureEvidence.envelope.provenance?.requests ?? []).some((request) => {
      const tags = request?.query?.["filter.tags"];
      return Array.isArray(tags) && tags.length === 1 && tags[0] === cultureEvidence.categoryTagId;
    });
  if (raw.discoveryBasis === "qloo_native_brand" && brandAnchored &&
      cultureEvidence.unconstrained === true || categoryAnchored) {
    culturalRelationship = categoryAnchored ? "category_recommendation_verified" : "native_recommendation_verified";
    if (categoryAnchored) culturalCategory = brandGenre(cultureEvidence.categoryTagId).name;
    // A specific Qloo taste tag carried by both brands names a broad theme;
    // the same tag in the selected products' own text corroborates a specific
    // one (Scoring Engine 3.3). It explains the relationship; it is not a gate.
    const specific = (tags) => (Array.isArray(tags) ? tags : []).filter((tag) =>
      SPECIFIC_TAG.test(tag?.id ?? "") && plainIdentity(tag.name).length >= 4 &&
      !GENERIC_THEME.test(String(tag.name ?? "").trim()));
    // The same tag, or the same descriptor under another tag kind
    // ("Socially Responsible" as a lifestyle and as a customer identity).
    const partnerNames = new Set(specific(cultureEvidence.partnerTags).map((tag) => plainIdentity(tag.name)));
    const shared = [...new Map(specific(cultureEvidence.seedTags)
      .filter((tag) => partnerNames.has(plainIdentity(tag.name)))
      .map((tag) => [plainIdentity(tag.name), tag])).values()];
    if (shared.length) {
      const productText = ` ${plainIdentity([seedDetail?.product?.title, partnerDetail?.product?.title,
        ...(raw.sourceAuthority?.seedDescription ? [productDescriptionText(seedDetail?.product)] : []),
        ...(raw.sourceAuthority?.partnerDescription ? [productDescriptionText(partnerDetail?.product)] : [])]
        .filter((value) => typeof value === "string").join(" "))} `;
      const corroborated = shared.find((tag) => productText.includes(` ${plainIdentity(tag.name)} `));
      culturalExplanation = corroborated ? "specific_theme" : "broad_theme";
      culturalTheme = String((corroborated ?? shared[0]).name).slice(0, 120);
      culturalThemes = [...new Set([corroborated ?? shared[0], ...shared]
        .map((tag) => String(tag.name).trim()))].slice(0, 3);
    }
    // Shared music, film and dining genres are not shown: across 11 brands
    // (26 Oct) the shared ones were carried by 9-11 of them (rhythm & blues,
    // popularity 0.98, by all 11), and Qloo popularity does not catch that.
    // The pair's shared audience (below) is specific and is shown instead.
    audienceAppeal = sharedAudienceAppeal(cultureEvidence.seedAudienceTags, cultureEvidence.partnerAudienceTags,
      [seedDetail?.product?.title, partnerDetail?.product?.title,
        ...(raw.sourceAuthority?.seedDescription ? [productDescriptionText(seedDetail?.product)] : []),
        ...(raw.sourceAuthority?.partnerDescription ? [productDescriptionText(partnerDetail?.product)] : [])]);
  } else if (raw.discoveryBasis === "user_specified" &&
      cultureEvidence.kind === "direct_unconstrained_native" &&
      QLOO_ID.test(seed?.qlooId ?? "") && QLOO_ID.test(partner?.qlooId ?? "") &&
      cultureEvidence.seedQlooId === seed.qlooId &&
      cultureEvidence.partnerQlooId === partner.qlooId &&
      cultureEvidence.unconstrained === true &&
      ["ok", "partial"].includes(cultureEvidence.envelope?.status) &&
      Array.isArray(cultureEvidence.envelope.results) &&
      cultureEvidence.envelope.results.some((item) =>
        item.entity_id === partner.qlooId &&
        (!item.type || ["urn:entity", "urn:entity:brand"].includes(item.type)))) {
    culturalRelationship = "native_recommendation_verified";
  } else if (raw.discoveryBasis === "user_specified" &&
      cultureEvidence.kind === "reverse_unconstrained_native" &&
      QLOO_ID.test(seed?.qlooId ?? "") && QLOO_ID.test(partner?.qlooId ?? "") &&
      cultureEvidence.seedQlooId === seed.qlooId && cultureEvidence.partnerQlooId === partner.qlooId &&
      cultureEvidence.unconstrained === true &&
      ["ok", "partial"].includes(cultureEvidence.envelope?.status) &&
      // Qloo's own explainability must show the partner as the request's input
      // signal, so the list really was built from the partner.
      anchoredOn(cultureEvidence.envelope, partner.qlooId) &&
      (cultureEvidence.envelope.results ?? []).some((item) =>
        String(item.entity_id ?? "").toLowerCase() === seed.qlooId.toLowerCase() &&
        (!item.type || ["urn:entity", "urn:entity:brand"].includes(item.type)))) {
    culturalRelationship = "direct_pair_supported";
  } else if (raw.discoveryBasis === "qloo_context_brand" && !seed?.qlooId &&
      QLOO_ID.test(partner?.qlooId ?? "") && cultureEvidence.kind === "product_context" &&
      cultureEvidence.sourceProductId === selectedSeed?.productId &&
      cultureEvidence.sourceVariantId === selectedSeed?.variantId &&
      typeof cultureEvidence.query === "string" && cultureEvidence.query.length >= 3 &&
      !GENERIC_THEME.test(cultureEvidence.query) &&
      typeof cultureEvidence.sourceQuote === "string" &&
      cultureEvidence.sourceQuote.toLowerCase().includes(cultureEvidence.query.toLowerCase()) &&
      [seedDetail?.product?.title,
        ...(raw.sourceAuthority?.seedDescription ? [typeof seedDetail?.product?.description === "string"
          ? seedDetail.product.description : seedDetail?.product?.description?.plain ??
          seedDetail?.product?.description?.html] : []),
        ...(verifiedSelectedProductPage(cultureEvidence.sourceProductPage,
          seedDetail, seed, seedStore) ? [cultureEvidence.sourceProductPage.description] : [])]
        .some((value) => typeof value === "string" && value.toLowerCase()
          .includes(cultureEvidence.sourceQuote.toLowerCase())) &&
      cultureEvidence.partnerQlooId === partner.qlooId &&
      ["ok", "partial"].includes(cultureEvidence.recommendation?.status) &&
      cultureEvidence.recommendation.results?.some((item) => item.entity_id === partner.qlooId) &&
      cultureEvidence.candidatePage?.inspected === true &&
      host(cultureEvidence.candidatePage.url) === host(partner.officialWebsite) &&
      String(cultureEvidence.candidatePage.snippet ?? "").toLowerCase()
        .includes(cultureEvidence.query.toLowerCase()) &&
      (cultureEvidence.signalKind === "tag" &&
        CONTEXT_TAG.test(cultureEvidence.signalId ?? "") &&
        cultureEvidence.resolution?.tags?.filter((tag) =>
          CONTEXT_TAG.test(tag.id ?? "") &&
          plainIdentity(tag.name) === plainIdentity(cultureEvidence.query)).length === 1 &&
        cultureEvidence.resolution.tags.some((tag) => tag.id === cultureEvidence.signalId &&
          plainIdentity(tag.name) === plainIdentity(cultureEvidence.query)) &&
        cultureEvidence.candidateTags?.some((tag) => tag.id === cultureEvidence.signalId) ||
      cultureEvidence.signalKind === "entity" && QLOO_ID.test(cultureEvidence.signalId ?? "") &&
        cultureEvidence.resolution?.envelope?.results?.some((item) =>
          item.entity_id === cultureEvidence.signalId &&
          item.name?.toLowerCase() === cultureEvidence.query.toLowerCase() &&
          (item.subtype ?? item.type) === `urn:entity:${cultureEvidence.signalType}`) &&
        cultureEvidence.focusedEnvelope?.results?.some((item) =>
          item.entity_id === cultureEvidence.signalId && Number.isFinite(item.affinity)))) {
    culturalRelationship = "context_relationship_corroborated";
    culturalExplanation = "specific_theme";
    culturalTheme = cultureEvidence.query.slice(0, 120);
  } else if (raw.discoveryBasis === "user_specified" && cultureEvidence.kind === "direct_pair" &&
      cultureEvidence.seedQlooId === seed?.qlooId &&
      cultureEvidence.partnerQlooId === partner?.qlooId &&
      Array.isArray(cultureEvidence.focusEnvelope?.results) &&
      cultureEvidence.focusEnvelope.results.some((item) =>
        item.entity_id === partner.qlooId && Number.isFinite(item.affinity)) &&
      SPECIFIC_TAG.test(cultureEvidence.sharedTagId ?? "") &&
      String(cultureEvidence.theme ?? "").trim().length >= 8 &&
      !GENERIC_THEME.test(cultureEvidence.theme) &&
      Array.isArray(cultureEvidence.seedTags) && Array.isArray(cultureEvidence.partnerTags) &&
      cultureEvidence.seedTags.some((tag) => tag.id === cultureEvidence.sharedTagId &&
        tag.name === cultureEvidence.theme) &&
      cultureEvidence.partnerTags.some((tag) => tag.id === cultureEvidence.sharedTagId &&
        tag.name === cultureEvidence.theme) &&
      cultureEvidence.seedPage?.inspected === true && cultureEvidence.partnerPage?.inspected === true &&
      host(cultureEvidence.seedPage.url) === host(seed.officialWebsite) &&
      host(cultureEvidence.partnerPage.url) === host(partner.officialWebsite) &&
      String(cultureEvidence.seedPage.snippet ?? "").toLowerCase().includes(String(cultureEvidence.theme).toLowerCase()) &&
      String(cultureEvidence.partnerPage.snippet ?? "").toLowerCase().includes(String(cultureEvidence.theme).toLowerCase())) {
    culturalRelationship = "direct_pair_supported";
    culturalExplanation = "specific_theme";
    culturalTheme = String(cultureEvidence.theme).slice(0, 120);
  }
  const mechanism = productMechanism(seedDetail?.product, partnerDetail?.product, raw.objective,
    raw.mechanismProposal, seedDetail?.variant, partnerDetail?.variant, raw.sourceAuthority,
    raw.rubricVerification);
  const occasion = String(userConstraints.occasion ?? "").trim().toLowerCase();
  const exactHero = Boolean(userConstraints.heroProduct &&
    userConstraints.heroProduct.productId === selectedSeed?.productId &&
    userConstraints.heroProduct.variantId === selectedSeed?.variantId);
  const checkedFacts = verifiedMechanismFacts(raw.mechanismProposal, seedDetail?.product,
    partnerDetail?.product, seedDetail?.variant, partnerDetail?.variant,
    raw.sourceAuthority ?? { seedDescription: false, partnerDescription: false });
  const seedFactKinds = mechanismFactSourceKinds(checkedFacts.seedFacts, seedDetail?.product,
    seedDetail?.variant, raw.sourceAuthority?.seedDescription === true);
  const selectedItemSpecific = seedFactKinds.some((kind) =>
    ["product_description", "variant_title", "variant_option"].includes(kind));
  const matchesFocus = mechanism.evidence === "supported" && (
    (exactHero && raw.rubricVerification?.seedRoleGroundedInSelectedItem === true &&
      selectedItemSpecific && raw.rubricVerification?.distinctConcreteJointValue === true) ||
    (occasion.length >= 4 && (mechanism.occasion?.toLowerCase() === occasion ||
      raw.rubricVerification?.servesStatedOccasion === true)));
  const descriptionText = productDescriptionText;
  const sourceText = [seedDetail?.product?.title, partnerDetail?.product?.title,
    ...(raw.sourceAuthority?.seedDescription !== false ? [descriptionText(seedDetail?.product)] : []),
    ...(raw.sourceAuthority?.partnerDescription !== false ? [descriptionText(partnerDetail?.product)] : [])]
    .filter((value) => typeof value === "string").join(" ").toLowerCase();
  const preferences = [...new Set((userConstraints.softPreferences ?? [])
    .filter((value) => typeof value === "string" && value.length >= 3).map((value) => value.toLowerCase()))];
  // A preference counts when the selected text contains it, or when the
  // judgment quoted supporting words that were verified in that text.
  const quotedPreferences = new Set(raw.rubricVerification?.verifiedPreferences ?? []);
  const matchedPreferences = preferences.filter((value) => sourceText.includes(value) ||
    quotedPreferences.has(value));
  const clearObjectiveContribution = mechanism.evidence === "supported" &&
    (raw.objective === "cross_sell"
      ? raw.rubricVerification?.reason === "specific_assortment_contribution" &&
        raw.sourceAuthority?.seedDescription === true &&
        raw.sourceAuthority?.partnerDescription === true &&
        observedProductType(seedDetail?.product) !== observedProductType(partnerDetail?.product)
      : mechanism.reasonCodes.includes("occasion_terms_source_grounded"));
  const bothMarket = raw.marketOffers?.seed?.state === "supported" &&
    raw.marketOffers?.partner?.state === "supported" ? "supported" :
    [raw.marketOffers?.seed, raw.marketOffers?.partner].some((offer) => offer?.state === "contradicted")
      ? "contradicted" : "unknown";
  const hardConstraints = {
    ...(userConstraints.mustShipToMarket ? { shipping: bothMarket } : {}),
    ...(userConstraints.mustBeAvailableNow ? {
      seedAvailability: seedDetail?.variant?.availability?.available === true ? "supported" :
        seedDetail?.variant?.availability?.available === false ? "contradicted" : "unknown",
      partnerAvailability: partnerDetail?.variant?.availability?.available === true ? "supported" :
        partnerDetail?.variant?.availability?.available === false ? "contradicted" : "unknown" } : {}),
    ...(userConstraints.priceLimit ? { partnerPrice: priceCheck(partnerDetail?.variant,
      userConstraints.priceLimit) } : {}),
  };
  const input = { objective: raw.objective, discoveryBasis: raw.discoveryBasis,
    identity, culturalRelationship, culturalExplanation, culturalTheme,
    culturalThemes, culturalCategory, sharedAudienceTastes: audienceTastes, sharedAudienceAppeal: audienceAppeal,
    seedOffer: selectedSeedValid ? "supported" : "unknown",
    partnerOffer: selectedPartnerValid ? "supported" : "unknown",
    seedAssortment: selectedSeedValid && raw.assortmentScope?.observedFamilies?.length &&
      ["partial", "adequate_for_claim"].includes(raw.assortmentScope?.coverage) &&
      raw.assortmentScope?.anchorClaimRefs?.includes("seed_product") &&
      !/\b(?:never sells?|does not sell|doesn't sell|no products? in|entire assortment|all categories)\b/i
        .test(raw.mechanismProposal?.benefit ?? "") ? "supported" : "unknown",
    mechanism: mechanism.mechanism,
    attributeEvidence: selectedSeedValid && selectedPartnerValid ? mechanism.attributeEvidence : "unknown",
    jointUseCoherence: mechanism.jointUseCoherence,
    incrementalValue: mechanism.incrementalValue,
    seedRole: mechanism.productRoles?.[0], partnerRole: mechanism.productRoles?.[1],
    rationale: mechanism.benefit, productRefs: ["seed_product", "partner_product"],
    customerReason: mechanism.benefit && typeof raw.rubricVerification?.customerReason === "string"
      ? raw.rubricVerification.customerReason : null,
    evidenceRefs: ["seed_product", "partner_product"],
    assortmentScope: raw.assortmentScope,
    objectiveSuitability: matchesFocus ? "matches_explicit_focus" : clearObjectiveContribution
      ? "clearly_serves_objective" : "adequately_serves_objective",
    productQuality: mechanism.quality, partnerDifferentiation: mechanism.partnerDifferentiation,
    productLink: raw.rubricVerification?.productLink,
    verifiedMatchedPreferencesCount: matchedPreferences.length,
    unresolvedPreferencesCount: preferences.length - matchedPreferences.length,
    preferenceRationale: matchedPreferences.map((value) => `Selected product text confirms ${value}`),
    evidenceCoverage: bothMarket === "supported" && raw.sourceAuthority?.seedDescription === true &&
      raw.sourceAuthority?.partnerDescription === true ? "good" : "limited",
    rankingReasonCodes: [matchesFocus ? "explicit_focus_match" : "objective_served",
      mechanism.quality === "distinct_concrete_joint_value" ? "distinct_product_attributes"
        : "credible_product_roles",
      ...(mechanism.partnerDifferentiation === "evidenced_partner_specific_reason"
        ? ["partner_specific_fact_verified"] : [])],
    hardConstraints, reviewFlags: [...(raw.reviewFlags ?? []), ...mechanism.reasonCodes,
      ...(explicitCoBrand ? ["selected_offer_explicit_third_party_cobrand"] : []),
      ...(explicitCoBrand && proposedOwnershipClaim ? ["selected_offer_ownership_claim_unverified"] : [])],
    evaluatedAt: new Date().toISOString() };
  validated.add(input);
  return input;
}

export function isValidatedCommerceEvidence(value) { return validated.has(value); }
