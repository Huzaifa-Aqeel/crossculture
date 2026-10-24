import { catalogClient, discoverVerifiedStorefront } from "./shopify-catalog.mjs";

function liveView(detail, ref) {
  if (detail.variant.id !== ref.variantId || detail.product.id !== ref.productId || !detail.product.title) {
    return { status: "unverified", message: "Selected product or variant changed." };
  }
  if (detail.variant.seller?.id && detail.variant.seller.id !== ref.sellerId) {
    return { status: "contradicted", message: "The selected seller changed." };
  }
  if (ref.storefrontDomain === "global" && !detail.variant.seller?.id) {
    return { status: "unverified", message: "The selected seller could not be confirmed." };
  }
  const price = detail.variant.price;
  return { status: "current", title: detail.product.title, url: detail.product.url ?? null,
    variantId: detail.variant.id,
    selectedOptions: (detail.variant.options ?? []).filter((item) => item.name && item.label)
      .map((item) => `${item.name}: ${item.label}`).slice(0, 5),
    price: Number.isInteger(price?.amount) && typeof price?.currency === "string"
      ? { amountMinor: price.amount, currencyCode: price.currency } : null,
    available: detail.variant.availability?.available ?? null,
    checkedAt: detail.fetchedAt, marketSignal: detail.marketSignal };
}

// Only stored identifiers are loaded. Every displayed offer fact comes from a fresh lookup.
export async function refreshCommerceOffers(references, { createCatalog = () => catalogClient(),
  market = "US", requirements = {}, officialSites = {},
  verifyStore = discoverVerifiedStorefront } = {}) {
  try {
    const catalog = createCatalog();
    const output = {};
    for (const side of ["seed", "partner"]) {
      const ref = references?.[side];
      if (!ref?.productId || !ref?.variantId || !ref?.storefrontDomain) {
        output[side] = { status: "unverified", message: "Current offer not verified." };
        continue;
      }
      try {
        if (officialSites[side]) {
          const store = await verifyStore(officialSites[side]);
          if (!store?.shopId) {
            output[side] = { status: "unverified", message: "Current storefront identity not verified." };
            continue;
          }
          if (store.shopId !== ref.sellerId) {
            output[side] = { status: "contradicted", message: "The storefront seller changed." };
            continue;
          }
          if (ref.storefrontDomain !== "global" && ![store.domain, store.endpointHost]
            .includes(ref.storefrontDomain)) {
            // Discovery can choose www, apex or checkout in a different order
            // across requests. Recheck the saved exact host and shop instead of
            // substituting the newly discovered host for the selected offer.
            const savedHost = await verifyStore(officialSites[side],
              { onlyDomain: ref.storefrontDomain }).catch(() => null);
            if (savedHost?.domain !== ref.storefrontDomain ||
                savedHost.shopId !== ref.sellerId) {
              output[side] = { status: "unverified", message: "Current storefront association not verified." };
              continue;
            }
          }
        }
        const tools = await catalog.tools(ref.storefrontDomain);
        const detail = await catalog.detail(ref.storefrontDomain, ref.productId, ref.variantId,
          null, tools, { market,
            expectedSellerId: ref.storefrontDomain === "global" ? ref.sellerId : null });
        output[side] = liveView(detail, ref);
        if (output[side].status === "current" && requirements.mustShipToMarket) {
          try {
            const globalTools = await catalog.tools("global");
            const marketCheck = globalTools.has("search_catalog") &&
              (globalTools.has("lookup_catalog") || globalTools.has("get_product"))
              ? await catalog.globalOfferFor(detail.product, detail.variant, ref.sellerId,
                globalTools, { market })
              : { state: "unknown", reasonCode: "market_capability_unavailable" };
            output[side].marketCheck = { state: marketCheck.state,
              reasonCode: marketCheck.reasonCode,
              checkedAt: marketCheck.checkedAt ?? null };
          } catch {
            output[side].marketCheck = { state: "unknown", reasonCode: "market_refresh_unavailable" };
          }
        }
      } catch (error) {
        output[side] = ["selected_product_unresolved", "selected_variant_unresolved"].includes(error?.code)
          ? { status: "unverified", message: "The selected product or variant could not be confirmed." }
          : { status: "lookup_unreachable", message: "Live offer refresh is temporarily unavailable." };
      }
    }
    return output;
  } catch {
    return { seed: { status: "lookup_unreachable", message: "Live offer refresh is temporarily unavailable." },
      partner: { status: "lookup_unreachable", message: "Live offer refresh is temporarily unavailable." } };
  }
}

// A saved assessment is history. This transient projection is the current
// outcome shown to users and used before developing a new proposal.
export function currentCommerceAssessment(saved, offers, requirements = {}) {
  if (saved?.policyVersion !== "brand-commerce-v1.1" || !saved?.status) return saved;
  const reasons = new Set(saved.reasonCodes ?? []);
  const unknowns = new Set(saved.materialUnknowns ?? []);
  let status = saved.status;
  let currentOfferIssue = false;
  let refreshUnavailable = false;
  let currentIssueCount = 0;
  let outageCount = 0;
  const worsen = (next, code) => {
    currentOfferIssue = true;
    currentIssueCount += 1;
    if (status !== "unsupported" && (next === "unsupported" || status === "supported")) status = next;
    reasons.add(code);
    if (next === "needs_verification") unknowns.add(code);
  };
  for (const side of ["seed", "partner"]) {
    const offer = offers?.[side];
    if (offer?.status === "contradicted") worsen("unsupported", `${side}_seller_changed`);
    else if (offer?.status === "lookup_unreachable") {
      refreshUnavailable = true;
      outageCount += 1;
      worsen("needs_verification", `${side}_live_refresh_unavailable`);
    }
    else if (offer?.status !== "current") worsen("needs_verification", `${side}_current_offer_unverified`);
    else {
      if (offer.available === false) worsen(requirements.mustBeAvailableNow ? "unsupported"
        : "needs_verification", `${side}_currently_unavailable`);
      else if (requirements.mustBeAvailableNow && offer.available !== true) {
        worsen("needs_verification", `${side}_availability_unverified`);
      }
      if (requirements.mustShipToMarket) {
        if (offer.marketCheck?.state === "contradicted") worsen("unsupported", `${side}_market_ineligible`);
        else if (offer.marketCheck?.state !== "supported") {
          worsen("needs_verification", `${side}_market_unverified`);
        }
      }
      if (side === "partner" && requirements.priceLimit) {
        const limit = requirements.priceLimit;
        if (!offer.price || offer.price.currencyCode !== limit.currencyCode) {
          worsen("needs_verification", "partner_price_unverified");
        } else if (offer.price.amountMinor > limit.amountMinor) {
          worsen("unsupported", "partner_price_limit_exceeded");
        }
      }
    }
  }
  return { ...saved, status, reasonCodes: [...reasons], materialUnknowns: [...unknowns],
    currentOfferReview: refreshUnavailable && currentIssueCount === outageCount ? "refresh_unavailable" :
      currentOfferIssue ? "changed_since_assessment" : "current" };
}
