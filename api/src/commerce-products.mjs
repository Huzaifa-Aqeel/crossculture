import { taxonomyCategory, categoryName } from "./product-taxonomy.mjs";
// Catalog content stays transient. These helpers generate bounded retrieval
// hypotheses and validate a proposed mechanism against selected product detail.
const GENERIC = /\b(?:lifestyle|design|perfect|amazing|customers|audience|synergy|together|complementary)\b/i;
const QUERY_STOP = new Set(["and", "the", "with", "from", "that", "this", "brand", "brands",
  "shop", "store", "company", "their", "products", "product", "offers", "offering", "for"]);
const VAGUE_CONTEXT = new Set(["gift", "gifts", "set", "sets", "kit", "kits", "morning",
  "routine", "routines", "daily", "everyday", "home", "lifestyle", "style", "design",
  "quality", "premium", "handmade", "organic", "sustainable", "modern", "beautiful",
  "perfect", "customer", "customers", "unique", "collection", "product", "products"]);
const normalize = (value) => String(value ?? "").toLowerCase().replace(/<[^>]*>/g, " ")
  .replace(/&(?:amp|nbsp);/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const bounded = (value, max = 160) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max).trim();

// What kind of product this is. Storefront Catalog products carry a Shopify
// taxonomy category ("Shoulder Bags"), never a product type; the older fields
// cover other Catalog shapes.
export function productTypeName(product) {
  return categoryName(taxonomyCategory(product)) ?? product?.product_type ?? product?.type ??
    product?.category?.name ?? null;
}

function description(product) {
  const field = product?.description;
  return bounded(typeof field === "string" ? field : field?.plain ?? field?.html ?? "", 1200)
    .replace(/<[^>]*>/g, " ").replace(/&(?:amp|nbsp);/g, " ");
}
// A product's description as plain text, whatever shape the Catalog sent
// (storefront products send only `description.html`).
export const productDescriptionText = description;

export function observedProductType(product) {
  const declared = bounded(productTypeName(product), 70);
  if (declared) return declared.toLowerCase();
  const title = bounded(product?.title, 100).split(/\s+[-–—|:]\s+/)[0];
  return title.split(/\s+/).slice(0, 3).join(" ").toLowerCase() || null;
}

// Search and detail content is passed to research transiently. This summary
// exposes actual observed functions without archiving a Catalog response.
// Who the merchant made a product for: "men", "women", or null when unisex,
// both or unstated. Read from merchant-authored fields only: the product
// address, title, type, tags and collections (descriptions are too loose).
const plainWords = (value) => ` ${String(value ?? "").toLowerCase().replace(/[’`]/g, "'")
  .replace(/[^a-z']+/g, " ")} `;
const MEN_WORDS = / (?:men|mens|men's|menswear) /;
const WOMEN_WORDS = / (?:women|womens|women's|womenswear|woman|ladies) /;
const UNISEX_WORDS = / (?:unisex|gender neutral|genderless) /;
function wearerIn(text) {
  const value = plainWords(text);
  if (UNISEX_WORDS.test(value)) return "unisex";
  const men = MEN_WORDS.test(value);
  const women = WOMEN_WORDS.test(value);
  return men && women ? "unisex" : men ? "men" : women ? "women" : null;
}
// Who the merchant labels a product for: "men", "women", "unisex" (labelled
// unisex, or listed for both), or null when the merchant does not say.
export function productWearerLabel(product) {
  let handle = typeof product?.handle === "string" ? product.handle : "";
  if (!handle) {
    try { handle = new URL(product?.url).pathname.split("/").filter(Boolean).pop() ?? ""; }
    catch { handle = ""; }
  }
  const direct = wearerIn([product?.title, handle, product?.product_type ?? product?.type]
    .filter((value) => typeof value === "string").join(" | "));
  if (direct) return direct;
  const labels = new Set([...(product?.tags ?? []).filter((tag) => typeof tag === "string"),
    ...(product?.collections ?? []).map((item) => `${item?.title ?? ""} ${item?.handle ?? ""}`)]
    .map(wearerIn).filter(Boolean));
  return labels.size > 1 ? "unisex" : [...labels][0] ?? null;
}
export function productWearer(product) {
  const label = productWearerLabel(product);
  return label === "unisex" ? null : label;
}
// Shopify categories a person wears or carries, where who it is for matters:
// clothing, clothing accessories, handbags, wallets and cases (and their
// accessories), jewelry and shoes.
const WORN_CATEGORIES = ["aa-1", "aa-2", "aa-4", "aa-5", "aa-6", "aa-8"];
export function wornProduct(product) {
  const id = taxonomyCategory(product);
  return Boolean(id && WORN_CATEGORIES.some((root) => id === root || id.startsWith(`${root}-`)));
}
// A worn item sold in two or more fit sizes ("Size", "Product Size": S, M, L;
// 00, 2, 4). One-size items and size options outside worn categories (a pan's
// diameter, a candle's volume) do not count. A two-brand Bundle never contains one.
const SIZE_OPTION = /\b(?:size|waist|inseam)\b/i;
const ONE_SIZE = /^(?:os|o\/s|one[\s-]?size)$/i;
export function fitSized(product) {
  return wornProduct(product) && (product?.options ?? []).some((option) =>
    SIZE_OPTION.test(String(option?.name ?? "")) && (option.values ?? [])
      .map((value) => String(value?.label ?? value?.name ?? value ?? "").trim())
      .filter((value) => value && !ONE_SIZE.test(value)).length >= 2);
}
// A brand described only for women (or only for men), e.g. "a women's fashion label".
export function brandWearer(description) {
  const value = plainWords(description);
  const men = / (?:men's|menswear|for men) /.test(value);
  const women = / (?:women's|womenswear|for women) /.test(value);
  return men === women ? null : men ? "men" : "women";
}
export const wearerConflict = (first, second) => Boolean(first && second && first !== second);

export function transientCandidateFacts(product, descriptionTrusted = true) {
  const rawDescription = description(product);
  return { id: product.id, title: bounded(product.title, 140),
    type: observedProductType(product),
    description: rawDescription.slice(0, 320),
    descriptionAuthority: descriptionTrusted ? "merchant" : "unverified",
    tags: (product.tags ?? []).filter((tag) => typeof tag === "string").slice(0, 6)
      .map((tag) => bounded(tag, 45)),
    collections: (product.collections ?? []).slice(0, 4).map((item) =>
      bounded(item.title, 65)).filter(Boolean),
    ...(productWearer(product) ? { designedFor: productWearer(product) } : {}),
    available: product.variants?.some((variant) => variant.availability?.available === true) ?? false };
}

export function observedProductQueries(products, limit = 3) {
  if (limit <= 0) return [];
  const merchandise = (products ?? []).filter(isCommerceMerchandise);
  const queries = [];
  const seen = new Set();
  const queryFor = (product) => {
    const category = bounded(productTypeName(product), 60);
    const title = bounded(product?.title, 100).split(/\s+[-–—|:]\s+/)[0]
      .replace(/\b(?:the|a|an)\b/gi, " ").trim();
    return category && !/^(?:product|products|other|miscellaneous)$/i.test(category)
      ? category : title.split(/\s+/).slice(0, 3).join(" ");
  };
  // Inspect each part of the returned sample. Merchant search order is not
  // evidence that its first few products represent the whole assortment.
  for (let slot = 0; slot < Math.min(limit, merchandise.length); slot += 1) {
    const start = Math.floor(slot * merchandise.length / limit);
    const end = Math.floor((slot + 1) * merchandise.length / limit);
    for (const product of merchandise.slice(start, end)) {
      const query = queryFor(product);
      const key = normalize(query);
      if (!key || key === "products" || seen.has(key)) continue;
      seen.add(key);
      queries.push(query);
      break;
    }
  }
  // A sparse bucket can be all duplicates. Fill any unused slots from the
  // remaining observed families without inventing a new search phrase.
  if (queries.length < limit) for (const product of merchandise) {
    const query = queryFor(product);
    const key = normalize(query);
    if (!key || key === "products" || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length >= limit) break;
  }
  return queries;
}

// The planner can propose retrieval directions, but only observed IDs from the
// current partner Catalog sample may change which returned items are tried first.
export function validatePartnerSearchPlan(plan, observedProducts = [], seedProduct = null) {
  const observedIds = new Set(observedProducts.filter(isCommerceMerchandise).map((item) => item.id));
  const queries = [];
  const directions = [];
  const seen = new Set();
  const seedTitle = normalize(bounded(seedProduct?.title, 100).split(/\s+[-–—|:]\s+/)[0]);
  const seedWords = seedTitle.split(" ").filter(Boolean);
  const seedTail = seedWords.length >= 2 ? seedWords.slice(-2).join(" ") : seedTitle;
  const singular = (word) => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
  const seedHeads = new Set([seedWords.at(-1),
    normalize(observedProductType(seedProduct)).split(" ").at(-1)]
    .filter(Boolean).map(singular));
  const seedTerms = new Set(normalize(`${seedProduct?.title ?? ""} ${description(seedProduct).slice(0, 320)}`)
    .split(" ").filter(Boolean));
  const proposed = plan?.directions ?? (plan?.queries ?? []).map((query) => ({ query, role: "" }));
  for (const entry of proposed) {
    const raw = entry?.query;
    if (typeof raw !== "string") continue;
    const query = bounded(raw, 60).replace(/[\r\n\t]/g, " ");
    const key = normalize(query);
    const words = key.split(" ").filter(Boolean);
    // Search the partner's product vocabulary, not a sentence about the
    // selected starting item or fit guidance copied from its description.
    const restatesSeed = Boolean(seedTail && key.includes(seedTail));
    const isPairSentence = /\b(?:paired with|to pair with|for pairing|for use with)\b/i.test(query);
    const describesSeedType = /\b(?:with|for|featuring)\b/i.test(query) &&
      words.some((word) => seedHeads.has(singular(word)));
    const isSeedDescription = restatesSeed &&
      (key === seedTitle || key === seedTail ||
        /\b(?:with|for|featuring)\b/i.test(query) ||
        (words.length >= 4 && words.every((word) => seedTerms.has(word))));
    if (key.length < 3 || key === "products" || key.split(" ").every((word) => VAGUE_CONTEXT.has(word)) ||
        words.length > 6 || isPairSentence || isSeedDescription || describesSeedType ||
        /\b(?:recommendation|sizing advice|fit advice|size down|size up)\b/i.test(query) ||
        seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    directions.push({ query, role: typeof entry?.role === "string"
      ? bounded(entry.role, 60) : "" });
    if (queries.length >= 5) break;
  }
  const observedProductIds = [...new Set((plan?.observedProductIds ?? []).filter((id) =>
    typeof id === "string" && observedIds.has(id)))].slice(0, 5);
  return plan?.directions ? { queries, directions, observedProductIds }
    : { queries, observedProductIds };
}

// Search roles control exploration only; they never prove product fit. Keep
// different wording for the same task together without hiding later queries.
export function commerceRoleKey(role) {
  return normalize(bounded(role, 60)).split(" ").slice(0, 4).join(" ");
}

export function prioritizeUnexploredRole(plans, index, explored) {
  const current = commerceRoleKey(plans[index]?.role);
  if (!current || !explored.has(current)) return plans[index];
  const next = plans.findIndex((plan, offset) => offset > index &&
    commerceRoleKey(plan.role) && !explored.has(commerceRoleKey(plan.role)));
  if (next > index) [plans[index], plans[next]] = [plans[next], plans[index]];
  return plans[index];
}

// Give pending search directions a turn before each new refinement. A single
// model replan must not bury the original anchor and catalog hypotheses.
export function mergeRefinedSearchPlans(plans, currentIndex, refinedPlans) {
  let cursor = currentIndex + 1;
  const firstFacet = refinedPlans.find((plan) =>
    ["observed_collection", "observed_category"].includes(plan.source));
  const firstModel = refinedPlans.find((plan) => plan.source === "catalog_refined");
  const leading = [firstFacet, firstModel].filter(Boolean);
  const remaining = refinedPlans.filter((plan) => !leading.includes(plan));
  if (cursor < plans.length) cursor += 1;
  plans.splice(cursor, 0, ...leading);
  cursor += leading.length;
  for (const refined of remaining) {
    if (cursor < plans.length) cursor += 1;
    plans.splice(cursor, 0, refined);
    cursor += 1;
  }
  return plans;
}

// Store-wide collections ("Uncategorized", "Best Sellers", "Sale") name no
// kind of product, so searching them finds nothing specific.
const STORE_WIDE_COLLECTION = /^(?:uncategori[sz]ed|all|shop all|all products|products|frontpage|home page|homepage|best ?sellers?|new|new arrivals?|just in|sale|on sale|clearance|featured|gifts?|gift guide|bundles?|collections?|last chance|final sale|outlet|trending|popular|exclusives?)$/i;
export function usefulCollectionSearch(title) {
  const value = bounded(title, 80);
  return value.length >= 3 && !/^all\s+/i.test(value) && !STORE_WIDE_COLLECTION.test(value) &&
    !/\b(?:size|sizes)\s*(?:\d|xx?s|[smlx]{1,4}\b)/i.test(value);
}

// A returned item can be assessed regardless of search wording. Only use it
// to spawn further catalog searches when its own merchandising vocabulary
// explains why the focused query found it.
export function searchResultMatchesQuery(product, query) {
  const terms = normalize(query).split(" ").filter((word) =>
    word.length >= 3 && !QUERY_STOP.has(word) && word !== "products");
  if (!terms.length) return false;
  const source = normalize([product?.title, productTypeName(product)]
    .filter(Boolean).join(" "));
  const words = new Set(source.split(" ").filter(Boolean));
  const singular = (word) => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
  const normalizedWords = new Set([...words].map(singular));
  return [...new Set(terms.map(singular))].filter((word) => normalizedWords.has(word)).length >=
    Math.min(2, new Set(terms.map(singular)).size);
}

export function prioritizeObservedPartnerProducts(products, observedProductIds = []) {
  const priority = new Map(observedProductIds.map((id, index) => [id, index]));
  return [...products].sort((left, right) => (priority.get(left.id) ?? 999) -
    (priority.get(right.id) ?? 999));
}

// Balance the selector's objective-aware leads with genuinely different
// observed query scopes. No product ID outside a fresh Catalog result is used.
export function prioritizePartnerResearchProducts(planSamples, proposedIds = [], limit = 8) {
  const samples = (planSamples ?? []).map((items) => (items ?? []).filter((item) =>
    item?.id && item.variants?.some((variant) => variant.id) && isCommerceMerchandise(item)));
  const observed = new Map(samples.flat().map((item) => [item.id, item]));
  const ordered = [];
  const seen = new Set();
  const families = new Set();
  const add = (item) => {
    if (!item || seen.has(item.id) || ordered.length >= limit) return false;
    seen.add(item.id); ordered.push(item);
    const family = observedProductType(item);
    if (family) families.add(family);
    return true;
  };
  const proposed = [...new Set(proposedIds)].filter((id) => observed.has(id));
  // Objective-aware selected leads go first. Diversity fills gaps only; it
  // does not displace a stronger observed lead for category representation.
  for (const id of proposed) add(observed.get(id));
  for (const sample of samples) {
    const unseen = sample.filter((item) => !seen.has(item.id));
    add(unseen.find((item) => !families.has(observedProductType(item))) ?? unseen[0]);
  }
  // Search order is not a suitability signal. Spread remaining attempts over
  // every returned scope, preferring a new observed family when one exists.
  for (let offset = 0; ordered.length < limit && offset < Math.max(0, ...samples.map((s) => s.length)); offset += 1) {
    for (const sample of samples) {
      const unseen = sample.slice(offset).filter((item) => !seen.has(item.id));
      add(unseen.find((item) => !families.has(observedProductType(item))) ?? unseen[0]);
      if (ordered.length >= limit) break;
    }
  }
  return ordered;
}

export function isCommerceMerchandise(product) {
  const title = bounded(product?.title, 160).toLowerCase();
  const baseTitle = title.split(/\s+[-–—|:]\s+/)[0];
  const kind = bounded(product?.product_type ?? product?.type, 90).toLowerCase();
  if (product?.gift_card === true) return false;
  // Storefront Catalog products carry a category, not a product type.
  if (/^gc(?:-|$)/.test(taxonomyCategory(product) ?? "")) return false;
  if (/^(?:gift\s*card|gift\s*certificate|store\s*credit)$/i.test(kind)) return false;
  if (/\bgift\s*(?:cards?|certificates?)$/i.test(baseTitle)) return false;
  if (/^(?:(?:digital|virtual|electronic)\s+|e-)?gift\s*(?:cards?|certificates?)(?:\s*$|\s*[-–—|:]|\s+for\s+\$?\d)/i.test(title)) return false;
  if (/^(?:pickup\s+in\s+store|in\s+store\s+pickup|shipping\s+protection|shipping\s+insurance)$/i.test(title)) return false;
  return true;
}

// Select diverse exact product/variant references; this is not a fit verdict.
export function chooseProductCombinations(seedProducts, partnerProducts, _objective, limit = 4,
  { spread = false } = {}) {
  const left = (seedProducts ?? []).filter((item) => item?.id && item.variants?.some((v) => v.id) &&
    isCommerceMerchandise(item));
  const right = (partnerProducts ?? []).filter((item) => item?.id && item.variants?.some((v) => v.id) &&
    isCommerceMerchandise(item));
  if (!left.length || !right.length) return [];
  const sampleAcrossResults = (items) => {
    if (!spread || items.length <= 4) return items;
    const positions = [0, Math.floor(items.length / 2), Math.floor(items.length / 4),
      Math.floor(items.length * 3 / 4)];
    return positions.map((position) => items[position]).filter(Boolean);
  };
  const sampledLeft = sampleAcrossResults(left);
  const sampledRight = sampleAcrossResults(right);
  const combinations = [];
  const seen = new Set();
  const selectedVariant = (product) => product.variants.find((variant) =>
    variant.id && variant.availability?.available === true) ??
    product.variants.find((variant) => variant.id);
  for (let offset = 0; offset < Math.max(sampledLeft.length, sampledRight.length); offset += 1) {
    for (let index = 0; index < sampledLeft.length; index += 1) {
      const seedProduct = sampledLeft[index];
      const partnerProduct = sampledRight[(index + offset) % sampledRight.length];
      const seedVariant = selectedVariant(seedProduct);
      const partnerVariant = selectedVariant(partnerProduct);
      const key = [seedProduct.id, seedVariant.id, partnerProduct.id, partnerVariant.id].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      combinations.push({ seedProduct, seedVariant, partnerProduct, partnerVariant });
      if (combinations.length >= limit) return combinations;
    }
  }
  // If the returned assortment contains only one distinct product pair, an
  // explicitly returned alternate variant can still change a failed option
  // check. Keep its exact ID so detail lookup never substitutes it silently.
  for (const seedProduct of left) {
    for (const partnerProduct of right) {
      const seedPrimary = selectedVariant(seedProduct);
      const partnerPrimary = selectedVariant(partnerProduct);
      const seedAlternates = seedProduct.variants.filter((variant) => variant.id &&
        variant.id !== seedPrimary.id && variant.availability?.available !== false).slice(0, 1);
      const partnerAlternates = partnerProduct.variants.filter((variant) => variant.id &&
        variant.id !== partnerPrimary.id && variant.availability?.available !== false).slice(0, 1);
      for (const [seedVariant, partnerVariant] of [
        ...seedAlternates.map((variant) => [variant, partnerPrimary]),
        ...partnerAlternates.map((variant) => [seedPrimary, variant]),
      ]) {
        const key = [seedProduct.id, seedVariant.id, partnerProduct.id, partnerVariant.id].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        combinations.push({ seedProduct, seedVariant, partnerProduct, partnerVariant });
        if (combinations.length >= limit) return combinations;
      }
    }
  }
  return combinations;
}

function quoteIsFrom(value, product, variant, descriptionTrusted) {
  const quote = normalize(value);
  if (quote.length < 5) return false;
  return [product?.title, ...(descriptionTrusted ? [description(product)] : []), variant?.title,
    ...(variant?.options ?? []).map((item) => `${item.name} ${item.label}`)]
    .some((source) => normalize(source).includes(quote));
}

export function verifiedMechanismFacts(proposal, seedProduct, partnerProduct,
  seedVariant, partnerVariant, sourceAuthority) {
  return { seedFacts: (proposal?.seedFacts ?? []).filter((fact) =>
    quoteIsFrom(fact, seedProduct, seedVariant, sourceAuthority.seedDescription)),
  partnerFacts: (proposal?.partnerFacts ?? []).filter((fact) =>
    quoteIsFrom(fact, partnerProduct, partnerVariant, sourceAuthority.partnerDescription)) };
}

// Developer trace records only which selected-item fields supported a quote.
// Never return the quote or a transformed copy of a Catalog passage here.
export function mechanismFactSourceKinds(facts, product, variant, descriptionTrusted) {
  return facts.map((fact) => {
    const quote = normalize(fact);
    if (normalize(product?.title).includes(quote)) return "product_title";
    if (descriptionTrusted && normalize(description(product)).includes(quote)) return "product_description";
    if (normalize(variant?.title).includes(quote)) return "variant_title";
    if ((variant?.options ?? []).some((item) => normalize(`${item.name} ${item.label}`).includes(quote))) {
      return "variant_option";
    }
    return "unresolved";
  });
}

function concreteSharedContext(seedFacts, partnerFacts, occasion) {
  const substantiveWords = (value) => normalize(value).split(" ")
    .filter((word) => word.length >= 4 && !VAGUE_CONTEXT.has(word));
  const occasionWords = substantiveWords(occasion);
  const groundedBy = (facts) => {
    const words = facts.flatMap(substantiveWords);
    return occasionWords.some((term) => words.some((word) =>
      term === word || term.startsWith(word) || word.startsWith(term)));
  };
  // The products may contribute different concrete facts to one occasion.
  // A source-checked passage from each side must ground it; shared generic
  // vocabulary such as "morning routine" cannot satisfy this check.
  return occasionWords.length > 0 && groundedBy(seedFacts) && groundedBy(partnerFacts);
}

function explicitProductConflict(seedProduct, partnerProduct, sourceAuthority) {
  const explicitDenial = (source, target) => {
    const title = normalize(target?.title);
    const body = normalize(description(source));
    if (title.length < 8 || !body) return false;
    return [`not compatible with ${title}`, `incompatible with ${title}`,
      `cannot be used with ${title}`, `not for use with ${title}`]
      .some((phrase) => body.includes(phrase));
  };
  return Boolean((sourceAuthority.seedDescription && explicitDenial(seedProduct, partnerProduct)) ||
    (sourceAuthority.partnerDescription && explicitDenial(partnerProduct, seedProduct)));
}

function exactMerchantCompatibility(seedProduct, partnerProduct, sourceAuthority) {
  const confirms = (source, target) => {
    const targetTitle = normalize(target?.title);
    if (targetTitle.length < 8) return false;
    return description(source).split(/[.!?;\n]+/).some((sentence) => {
      const text = normalize(sentence);
      return text.includes(targetTitle) &&
        /\b(?:fits?|compatible with|works with|sized for|safe for)\b/.test(text);
    });
  };
  return Boolean((sourceAuthority.seedDescription && confirms(seedProduct, partnerProduct)) ||
    (sourceAuthority.partnerDescription && confirms(partnerProduct, seedProduct)));
}

// One item's trusted description names the other item's type or material (a
// word from that item's title): a scrubber "for cast iron cookware" with a cast
// iron skillet, goggles that "fit over helmets". Laundry bleach that never
// mentions pans does not establish safe use on a pan.
const TITLE_STOP = new Set(["with", "from", "your", "this", "that", "pack", "inch", "inches",
  "classic", "original", "essential", "essentials", "premium", "set", "sets", "mens", "womens",
  "small", "large", "medium", "mini", "the", "and", "for", "new", "model", "edition", "collection"]);
function careTextNamesOther(seedProduct, partnerProduct, sourceAuthority) {
  const words = (product) => normalize(product?.title).split(" ")
    .filter((word) => word.length >= 4 && !TITLE_STOP.has(word))
    .map((word) => word.replace(/(?:es|s)$/, ""));
  const names = (source, target, trusted) => {
    if (!trusted) return false;
    const text = ` ${normalize(description(source))} `;
    return words(target).some((stem) => stem.length >= 3 &&
      new RegExp(`\\b${stem}(?:e?s)?\\b`).test(text));
  };
  return names(partnerProduct, seedProduct, sourceAuthority.partnerDescription) ||
    names(seedProduct, partnerProduct, sourceAuthority.seedDescription);
}

// A consumable made for one format (pods, capsules, K-Cups, cartridges,
// refills) or already finished (instant) works with the starting item only
// when the starting item's own text names that format, not as "no pods".
// The judge's formatMismatch answer varied between runs (espresso pods for a
// drip coffee maker passed once, live 27 Oct), so this is checked here too.
const PARTNER_FORMAT = /\b(pod|capsule|k ?cup|cartridge|refill)s?\b/;
// "Instant" only for a drink (an instant tent or pot is not a format).
const INSTANT_DRINK = /\binstant\b.*\b(?:coffee|tea|espresso|latte|matcha|cocoa|drink|sticks?|packets?)\b|\b(?:coffee|tea|espresso|latte|matcha|cocoa)\b.*\binstant\b/;
export function unsupportedPartnerFormat(seedProduct, partnerProduct, seedDescriptionTrusted = true) {
  const title = normalize(partnerProduct?.title);
  const format = title.match(PARTNER_FORMAT)?.[1] ?? (INSTANT_DRINK.test(title) ? "instant" : null);
  if (!format) return null;
  const seedText = normalize([seedProduct?.title, seedDescriptionTrusted ? description(seedProduct) : ""].join(" "));
  const named = new RegExp(`\\b${format}s?\\b`).test(seedText) &&
    !new RegExp(`\\b(?:no|without|never|instead of|free)(?: \\w+){0,2} ${format}s?\\b`).test(seedText);
  return named ? null : format;
}

export function productMechanism(seedProduct, partnerProduct, objective, proposal = null,
  seedVariant = null, partnerVariant = null,
  sourceAuthority = { seedDescription: true, partnerDescription: true }, rubric = null) {
  const unknown = { mechanism: "unproven", evidence: "unknown", attributeEvidence: "unknown",
    jointUseCoherence: "unknown", incrementalValue: "unknown", productRoles: [],
    benefit: null, occasion: null, quality: "credible_joint_value",
    partnerDifferentiation: "generic_category_reason", reasonCodes: ["mechanism_unverified"] };
  if (seedProduct?.title && partnerProduct?.title &&
      explicitProductConflict(seedProduct, partnerProduct, sourceAuthority)) {
    return { ...unknown, mechanism: "incompatible", evidence: "contradicted",
      jointUseCoherence: "contradicted", incrementalValue: "contradicted",
      reasonCodes: ["merchant_authored_exact_product_incompatibility"] };
  }
  if (!proposal || !seedProduct?.title || !partnerProduct?.title) return unknown;
  const kind = proposal.kind;
  const allowed = objective === "cross_sell" ? ["assortment_complement", "occasion_complement",
    "functional_complement"] : ["occasion_complement", "functional_complement"];
  if (!allowed.includes(kind)) return unknown;
  const { seedFacts, partnerFacts } = verifiedMechanismFacts(proposal, seedProduct,
    partnerProduct, seedVariant, partnerVariant, sourceAuthority);
  const roles = [bounded(proposal.seedRole, 90), bounded(proposal.partnerRole, 90)];
  const benefit = bounded(proposal.benefit, 260);
  const occasion = bounded(proposal.occasion, 90);
  const attributesSupported = seedFacts.length > 0 && partnerFacts.length > 0;
  const distinctRoles = roles.every((role) => role.length >= 4) && normalize(roles[0]) !== normalize(roles[1]);
  const benefitNamesBothRoles = roles.every((role) => normalize(role).length >= 4 &&
    normalize(benefit).includes(normalize(role)));
  const namedContext = normalize(occasion).length >= 8 && !GENERIC.test(occasion) &&
    normalize(occasion).split(" ").some((word) => word.length >= 4 && !VAGUE_CONTEXT.has(word));
  const assortmentContribution = objective === "cross_sell" && kind === "assortment_complement";
  const claimedCompatibility = /\b(?:fits?|compatible|sized|safe for|works with)\b/i.test(benefit);
  // A fit claim is confirmed by a trusted page that names the other item's type
  // ("fits over helmets", "for leather boots") or its exact title.
  const compatibilityConfirmed = claimedCompatibility &&
    (exactMerchantCompatibility(seedProduct, partnerProduct, sourceAuthority) ||
      careTextNamesOther(seedProduct, partnerProduct, sourceAuthority));
  // When one selected item is itself a treatment or care product (cleaner,
  // conditioner, polish, protector, detergent...), applying it to the other
  // item needs merchant-authored compatibility proof: material similarity cannot
  // override care instructions. Only the item roles are checked; words such as
  // "coat", "clean up" or "washing" in a benefit do not trigger this.
  const treatmentRole = /\b(?:cleaner|cleaning (?:kit|spray|solution|cloth)|conditioner|polish|protector|protectant|waterproofing|water repellent|stain remover|care (?:kit|cream|spray|set)|treatment|coating|detergent|wax|dye)\b/i;
  const personalCare = /\b(?:hair|skin|face|facial|body|scalp|lip|beard|nail)\b/i;
  const careProduct = rubric?.careProductForOther === true ||
    roles.some((role) => treatmentRole.test(role) && !personalCare.test(role));
  // A restrictive care instruction on either page (dry clean only,
  // professional cleaning only, no water or liquid cleaners) needs the exact
  // merchant-authored compatibility statement, not a category mention.
  const restrictiveCare = [seedProduct, partnerProduct].some((product) =>
    /\b(?:dry clean(?:ing)? only|professional(?:ly)? clean(?:ing|ed)?(?: only| recommended)?|do not (?:use|wash|machine wash|apply|bleach)|spot clean only)\b/
      .test(normalize(description(product))));
  const requiresCompatibility = careProduct &&
    !exactMerchantCompatibility(seedProduct, partnerProduct, sourceAuthority) &&
    (restrictiveCare || !careTextNamesOther(seedProduct, partnerProduct, sourceAuthority));
  const formatUnsupported = Boolean(unsupportedPartnerFormat(seedProduct, partnerProduct,
    sourceAuthority.seedDescription));
  const groundedContext = concreteSharedContext(seedFacts, partnerFacts, occasion);
  // A single ordinary word such as "together" cannot negate a concrete
  // benefit. The isolated rubric and objective challenge judge generic co-use.
  const coherenceSupported = attributesSupported && distinctRoles &&
    rubric?.seedRoleGroundedInSelectedItem === true &&
    rubric?.partnerRoleGroundedInSelectedItem === true &&
    // A functional complement names its operation in the benefit; an occasion
    // is required only for occasion-based combinations.
    (namedContext || assortmentContribution || kind === "functional_complement") &&
    benefit.length >= 25 && (!claimedCompatibility || compatibilityConfirmed) &&
    !requiresCompatibility && !formatUnsupported &&
    normalize(seedProduct.title) !== normalize(partnerProduct.title) &&
    rubric?.jointUseCoherent === true &&
    (rubric?.reason === "specific_joint_use" ||
      (assortmentContribution && rubric?.reason === "specific_assortment_contribution"));
  // The isolated verifier checks whether the cited roles explain the stated
  // benefit. Exact phrase reuse is not a semantic requirement: a sound benefit
  // can paraphrase both product roles.
  const incrementalSupported = coherenceSupported && rubric?.incrementalBenefit === true &&
    rubric?.genericCoUseOnly === false;
  const partnerSpecificFact = bounded(proposal.partnerSpecificFact, 180);
  const factTokens = partnerSpecificFact.split(/\s+/);
  const identifiableDetail = /\d/.test(partnerSpecificFact) ||
    factTokens.slice(1).some((token) => /^[A-Z][a-z]{2,}/.test(token) || /^[A-Z]{2,}$/.test(token));
  const partnerSpecific = sourceAuthority.partnerDescription && partnerSpecificFact.length >= 16 &&
    normalize(description(partnerProduct)).includes(normalize(partnerSpecificFact)) &&
    !normalize(partnerProduct.title).includes(normalize(partnerSpecificFact)) &&
    !GENERIC.test(partnerSpecificFact) && identifiableDetail;
  const distinctiveAttributes = sourceAuthority.seedDescription &&
    sourceAuthority.partnerDescription && [
      [seedFacts, seedProduct], [partnerFacts, partnerProduct],
    ].every(([facts, product]) => facts.some((fact) =>
    normalize(description(product)).includes(normalize(fact)) &&
    !normalize(product.title).includes(normalize(fact))));
  const validationChecks = { attributesSupported, distinctRoles,
    benefitNamesBothRoles, namedContext, assortmentContribution,
    benefitHasSubstance: benefit.length >= 25,
    compatibilityClaimed: claimedCompatibility, compatibilityConfirmed,
    compatibilityEvidenceRequired: requiresCompatibility, formatUnsupported,
    selectedTitlesDiffer: normalize(seedProduct.title) !== normalize(partnerProduct.title),
    groundedContext };
  return { mechanism: objective === "cross_sell" ? "assortment_complement" : kind,
    evidence: coherenceSupported ? "supported" : "unknown",
    attributeEvidence: attributesSupported ? "supported" : "unknown",
    jointUseCoherence: coherenceSupported ? "supported" : "unknown",
    incrementalValue: incrementalSupported ? "supported" : "unknown",
    productRoles: roles, benefit: incrementalSupported ? benefit : null,
    occasion: namedContext ? occasion : null, requiresCompatibility,
    validationChecks,
    quality: incrementalSupported && distinctiveAttributes &&
      (groundedContext || assortmentContribution &&
        rubric?.reason === "specific_assortment_contribution") &&
      rubric?.distinctConcreteJointValue === true
      ? "distinct_concrete_joint_value" : "credible_joint_value",
    partnerDifferentiation: partnerSpecific && rubric?.partnerSpecificReason === true
      ? "evidenced_partner_specific_reason"
      : "generic_category_reason",
    reasonCodes: [attributesSupported ? "product_facts_cited" : "product_facts_unverified",
      coherenceSupported ? "distinct_joint_use" : "joint_use_unverified",
      ...(groundedContext ? ["occasion_terms_source_grounded"] : []),
      incrementalSupported ? "incremental_value_cited" : "incremental_value_unverified",
      ...(rubric?.genericCoUseOnly === true ? ["generic_co_use_only"] : []),
      ...(partnerSpecific && rubric?.partnerSpecificReason === true ? ["partner_specific_product_fact"] : []),
      ...(requiresCompatibility ? ["selected_product_compatibility_unverified"] : []),
      ...(formatUnsupported ? ["partner_format_unsupported"] : []),
      ...(rubric ? [`rubric_${rubric.reason}`] : ["semantic_rubric_unavailable"])] };
}

export function transientProductFacts(product, variant, descriptionTrusted = true) {
  return { title: bounded(product?.title, 160),
    ...(productWearer(product) ? { designedFor: productWearer(product) } : {}),
    description: descriptionTrusted ? description(product).slice(0, 700) : "",
    variantTitle: bounded(variant?.title, 90),
    options: (variant?.options ?? []).slice(0, 6).map((item) => ({
      name: bounded(item.name, 50), label: bounded(item.label, 60) })) };
}
