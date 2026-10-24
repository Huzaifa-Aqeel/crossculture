// Bounded read-only check. Prints only exact-offer availability; never saves
// Catalog search responses, descriptions, prices, or media.
import { catalogClient, discoverVerifiedStorefront, PROFILE_EXAMPLE } from "../src/shopify-catalog.mjs";

const [officialWebsite, query, expectedPath] = process.argv.slice(2);
if (!officialWebsite || !query || !expectedPath?.startsWith("/products/")) {
  throw new Error("Pass an official website, search phrase, and exact product path.");
}
const store = await discoverVerifiedStorefront(officialWebsite);
if (!store?.shopId) throw new Error("Official Shopify merchant could not be verified.");
const catalog = catalogClient({ profileUrl: PROFILE_EXAMPLE, maxCalls: 8 });
const tools = await catalog.tools(store.domain);
const products = await catalog.search(store.domain, query, tools, { market: "US" });
const selected = products.find((product) => {
  try { return new URL(product.url).pathname === expectedPath; } catch { return false; }
});
if (!selected) {
  console.log(JSON.stringify({ productFound: false, searchedMerchant: store.domain }));
} else {
  const variants = (selected.variants ?? []).filter((item) => item.id);
  const checked = [];
  for (const variant of variants.slice(0, 3)) {
    try {
      const detail = await catalog.detail(store.domain, selected.id, variant.id,
        variant.options, tools, { market: "US" });
      checked.push({ sameProduct: detail.product.id === selected.id,
        sameVariant: detail.variant.id === variant.id,
        available: detail.variant.availability?.available ?? null });
    } catch (error) { checked.push({ lookupError: error?.code ?? "unavailable" }); }
  }
  console.log(JSON.stringify({ productFound: true, merchant: store.domain,
    observedVariants: variants.length, checked }));
}
