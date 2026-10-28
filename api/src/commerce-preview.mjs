import pg from "pg";
import { getProject } from "./projects.mjs";
import { observedProductType, fitSized } from "./commerce-products.mjs";
import { catalogClient, discoverVerifiedStorefront } from "./shopify-catalog.mjs";
import { taxonomyCategory } from "./research-memory.mjs";

let pool;
const db = () => pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

export function productSearchInput(input, officialWebsite, store) {
  const value = String(input ?? "").trim();
  if (value.length < 3 || value.length > 300) {
    throw Object.assign(new Error("Enter a product name or product page URL."), { statusCode: 400 });
  }
  if (!/^https?:\/\//i.test(value)) {
    if (value.length > 100) throw Object.assign(new Error("Use a shorter product name."), { statusCode: 400 });
    return { query: value, exactHandle: null };
  }
  let url;
  try { url = new URL(value); }
  catch { throw Object.assign(new Error("Enter a valid product page URL."), { statusCode: 400 }); }
  // The store with or without "www." is the same store (wildone.com and
  // www.wildone.com, 27 Oct).
  const bare = (host) => String(host ?? "").toLowerCase().replace(/^www\./, "");
  const allowedHosts = new Set([new URL(officialWebsite).hostname, store.domain, store.endpointHost]
    .filter(Boolean).map(bare));
  // A product page may be reached through a collection
  // (/collections/bowls/products/travel-bowl-duo); the product handle is what counts.
  const handle = url.pathname.match(/(?:^|\/)products\/([a-z0-9][a-z0-9_-]{2,})\/?$/i)?.[1];
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !allowedHosts.has(bare(url.hostname)) || !handle) {
    throw Object.assign(new Error("Use a product page from the verified brand store."), { statusCode: 400 });
  }
  return { query: handle.replace(/[-_]+/g, " ").slice(0, 100), exactHandle: handle.toLowerCase() };
}

// The typed name is this product's own name: the same words, or those words
// followed by a variant suffix ("Petite Cooker - Navy", "Petite Cooker (Cream)").
const plainName = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// A product's name without its variant suffix (" | Black", " - Dusk Fade").
const baseName = (title) => plainName(String(title ?? "").split(/\s[-–—|:]\s|\s?\(/)[0]);
export function exactProductName(title, typed) {
  const name = plainName(typed);
  if (name.length < 3) return false;
  return plainName(title) === name || baseName(title) === name;
}

const productHandle = (url) => {
  try { return new URL(url).pathname.match(/\/products\/([^/]+)\/?$/i)?.[1]?.toLowerCase() ?? null; }
  catch { return null; }
};

// Transient, authenticated selected-product chooser. The response is no-store;
// the worker verifies a chosen product and variant again when research starts.
export async function previewCommerceSeedProducts(userId, projectId, market = "US", options = {}) {
  const project = await getProject(userId, projectId);
  if (!project || !["product_bundle", "cross_sell"].includes(project.objective)) {
    throw Object.assign(new Error("Commerce project not found."), { statusCode: 404 });
  }
  return previewStartingBrandProducts(project.seedEntityId, market, options);
}

// Products of a starting brand the caller has already authorized (a fresh
// confirmation or one of the user's projects); used before a project exists.
export async function previewStartingBrandProducts(seedEntityId, market = "US", {
  createCatalog = () => catalogClient(), discoverStorefront = discoverVerifiedStorefront,
  query = "",
} = {}) {
  if (!/^[A-Z]{2}$/.test(market)) throw Object.assign(new Error("Choose a market country."), { statusCode: 400 });
  const entity = await db().query(`select canonical_name as name,
    coalesce(official_website,canonical_url) as website,
    description from catalog.entities where id=$1 and kind='brand'`, [seedEntityId]);
  if (!entity.rows[0]) throw Object.assign(new Error("Brand not found."), { statusCode: 404 });
  const store = await discoverStorefront(entity.rows[0]?.website);
  if (!store?.shopId) return { products: [], coverage: store?.coverage ?? "storefront_identity_unverified" };
  const searchInput = productSearchInput(query, entity.rows[0].website, store);
  const catalog = createCatalog();
  const toolsFor = (domain) => catalog.tools(domain).catch((error) => {
    if (error?.code === "catalog_rate_limited") throw error;
    return null;
  });
  let scope = null;
  try {
    for (const domain of [...new Set([store.domain, store.endpointHost].filter(Boolean))]) {
      const tools = await toolsFor(domain);
      if (tools?.has("search_catalog") && (tools.has("lookup_catalog") || tools.has("get_product"))) {
        scope = { domain, tools }; break;
      }
    }
    if (!scope) {
      const tools = await toolsFor("global");
      if (tools?.has("search_catalog") && (tools.has("lookup_catalog") || tools.has("get_product"))) {
        scope = { domain: "global", tools };
      }
    }
  } catch (error) {
    if (error?.code === "catalog_rate_limited") return { products: [], coverage: "catalog_rate_limited" };
    throw error;
  }
  if (!scope) return { products: [], coverage: "catalog_capability_unavailable" };
  const queries = [searchInput.query];
  let exactMatch = Boolean(searchInput.exactHandle);
  const products = [];
  const seenProducts = new Set();
  for (const query of queries) {
    let hits;
    try { hits = await catalog.search(scope.domain, query, scope.tools,
      { market, shops: scope.domain === "global" ? [store.shopId] : [] }); }
    catch (error) {
      if (error?.code === "catalog_rate_limited") return { products, coverage: "catalog_rate_limited",
        inspectedQueries: queries, market };
      continue;
    }
    // A typed name that is a product's own name means that product only: one
    // product, one variant, instead of every loosely matching item. An
    // in-stock match goes first; with no exact match all results are shown.
    const exact = searchInput.exactHandle ? [] : hits.filter((hit) => exactProductName(hit.title, query));
    if (exact.length) {
      exactMatch = true;
      hits = exact.sort((left, right) => Number((right.variants ?? []).some((variant) => variant.availability?.available !== false)) -
        Number((left.variants ?? []).some((variant) => variant.availability?.available !== false)));
    }
    for (const hit of hits) {
      if (seenProducts.has(hit.id)) continue;
      if (exactMatch && products.some((item) => !item.outOfStock)) break;
      // Stores that list each colour as its own product ("The ReNew Transit
      // Backpack | Black", "| Slate Grey") show that product once.
      if (products.some((item) => !item.outOfStock && baseName(item.title) === baseName(hit.title))) continue;
      if (searchInput.exactHandle && productHandle(hit.url) !== searchInput.exactHandle) continue;
      // Shopify returns sold-out products in search but not in exact detail, so
      // research cannot start from one. Show it as out of stock instead of
      // silently dropping it and showing a different product (27 Oct).
      const variants = (hit.variants ?? []).filter((variant) => variant.id);
      if (variants.length && variants.every((variant) => variant.availability?.available === false)) {
        products.push({ productId: hit.id, variantId: null, title: hit.title, url: hit.url ?? null,
          family: observedProductType(hit) ?? "uncategorized", categoryId: taxonomyCategory(hit),
          sized: fitSized(hit), outOfStock: true });
        seenProducts.add(hit.id);
        if (products.length >= 12) break;
        continue;
      }
      const options = (hit.variants ?? []).filter((variant) => variant.id &&
        (scope.domain !== "global" || variant.seller?.id === store.shopId))
        .sort((left, right) => Number(right.availability?.available === true) -
          Number(left.availability?.available === true)).slice(0, 6);
      for (const selected of options) {
        try {
          const detail = await catalog.detail(scope.domain, hit.id, selected.id,
            selected.options, scope.tools,
            { market, expectedSellerId: scope.domain === "global" ? store.shopId : null });
          if (scope.domain === "global" && detail.variant.seller?.id !== store.shopId) continue;
          const family = observedProductType(detail.product);
          if (!family) continue;
          products.push({ productId: detail.product.id, variantId: detail.variant.id,
            title: detail.product.title, url: detail.product.url ?? null, family,
            categoryId: taxonomyCategory(detail.product), sized: fitSized(detail.product) });
          seenProducts.add(hit.id);
          break;
        } catch (error) {
          if (error?.code === "catalog_rate_limited") return { products, coverage: "catalog_rate_limited",
            inspectedQueries: queries, market };
          // Try another returned option for this product; never accept one
          // without its own exact seller and item verification.
        }
      }
      if (products.length >= 12) break;
    }
    if (products.length >= 12) break;
  }
  // An exact match shows its one in-stock product (or the sold-out one alone).
  // A sold-out listing is dropped when the same product is in stock in another listing.
  const listed = products.filter((item) => !item.outOfStock || !products.some((other) =>
    !other.outOfStock && baseName(other.title) === baseName(item.title)));
  const shown = exactMatch && listed.some((item) => !item.outOfStock)
    ? [listed.find((item) => !item.outOfStock)] : exactMatch ? listed.slice(0, 1) : listed;
  return { products: shown, exact: exactMatch && shown.length === 1,
    coverage: shown.some((item) => !item.outOfStock) ? "observed_sample"
      : shown.length ? "only_out_of_stock" : "no_verified_product_offer", inspectedQueries: queries, market };
}
