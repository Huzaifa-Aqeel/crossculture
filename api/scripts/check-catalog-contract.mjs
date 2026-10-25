// Product helpers against the storefront Catalog shape observed live on 25 Oct
// 2026 (Everlane, Caraway, Cuyana, Fishwife, BAGGU, Graza): no product_type,
// type or category; a Shopify taxonomy ID in `categories`; description as HTML.
// Values are synthetic; no Catalog response is stored.
import assert from "node:assert/strict";
import { taxonomyCategory, categoryName, categoryPath, sameRange } from "../src/product-taxonomy.mjs";
import { productTypeName, observedProductType, observedProductQueries, searchResultMatchesQuery,
  productWearer, productWearerLabel, wornProduct, fitSized } from "../src/commerce-products.mjs";

const storefrontProduct = (id, title, category, extra = {}) => ({
  id: `gid://shopify/Product/${id}`, title, description: { html: `${title} in leather.` },
  url: `https://store.example/products/${id}`, handle: String(id),
  price_range: {}, list_price_range: {}, options: [{ name: "Color", values: [] }], media: [],
  categories: [{ value: `gid://shopify/TaxonomyCategory/${category}`, taxonomy: "shopify" }],
  gift_card: false, collections: [{ id: "c1", handle: "bags", title: "Bags", url: "https://store.example/c" }],
  variants: [{ id: `gid://shopify/ProductVariant/${id}`, price: { amount: 19800, currency: "USD" },
    availability: { available: true }, options: [{ name: "Color", label: "Black" }] }], ...extra });

const bag = storefrontProduct(1, "Mini Paloma Bag", "aa-5-4-19");
assert.equal(taxonomyCategory(bag), "aa-5-4-19");
assert.equal(categoryName("aa-5-4-19"), "Shoulder Bags");
assert.equal(categoryPath("aa-5-4-19"), "Handbags > Shoulder Bags");
assert.equal(categoryName("zz-999"), null);
// Live: Everlane's bags are Tote Bags (lb-13); Cuyana's are Shoulder Bags (aa-5-4-19).
assert.equal(sameRange("aa-5-4-19", "lb-13"), true, "Everyday bags across taxonomy branches");
assert.equal(sameRange("aa-5-4-19", "lb-12"), false, "Suitcases are not everyday bags");
assert.equal(sameRange("aa-2-6", "aa-2-6"), true);
assert.equal(sameRange("aa-2-6", "aa-8-6"), false);
assert.equal(productTypeName(bag), "Shoulder Bags", "The type comes from the taxonomy, not product_type");
assert.equal(observedProductType(bag), "shoulder bags");
assert.ok(observedProductQueries([bag]).includes("Shoulder Bags"), "Category names become search directions");
assert.equal(searchResultMatchesQuery(bag, "shoulder bags"), true);
for (const [id, name] of [["aa-1-13-7", "Shirts"], ["aa-2-6", "Belts"], ["aa-5-5", "Wallets & Money Clips"]]) {
  assert.equal(categoryName(id), name, `Live category ${id}`);
}
// A product without a category still falls back to its title.
assert.equal(observedProductType({ title: "Classic Shirt in Linen" }), "classic shirt in");

// Wearer labels in the live shape: Everlane's men's shirt is labelled by its
// address and collections; Cuyana's bag carries no wearer word anywhere.
const shirt = storefrontProduct(2, "The Classic Shirt in Linen | Peyote", "aa-1-13-7", {
  handle: "mens-linen-stndrd-fit-shirt-agave-green",
  collections: [{ title: "Men's Clothing" }, { title: "Men's Shirts" }] });
assert.equal(productWearer(shirt), "men");
assert.equal(productWearer(bag), null);
assert.equal(productWearerLabel(bag), null, "Unstated, not unisex");
assert.equal(productWearerLabel(storefrontProduct(3, "Linen Shirt", "aa-1-13-7", {
  collections: [{ title: "Men's Shirts" }, { title: "Women's Shirts" }] })), "unisex", "Listed for both");
assert.equal(wornProduct(bag), true);
assert.equal(wornProduct(storefrontProduct(4, "Sauté Pan", "hg-11-1")), false);

// Fit sizes, with option shapes seen live: Everlane shirt "Size", Cuyana belt
// "Product Size" with "One Size" among real sizes, BAGGU tote "Size: OS".
const sizes = (name, values) => [{ name, values: values.map((label) => ({ label })) }];
assert.equal(fitSized(storefrontProduct(5, "Linen Shirt", "aa-1-13-7", { options: sizes("Size", ["XXS", "XS", "S", "M"]) })), true);
assert.equal(fitSized(storefrontProduct(6, "Leather Belt", "aa-2-6",
  { options: sizes("Product Size", ["One Size", "Small - Medium", "Large - Extra Large"]) })), true);
assert.equal(fitSized(storefrontProduct(7, "Nylon Tote", "lb-13", { options: sizes("Size", ["OS"]) })), false);
assert.equal(fitSized(storefrontProduct(8, "Beanie", "aa-2-17", { options: sizes("Size", ["One Size"]) })), false);
assert.equal(fitSized(storefrontProduct(9, "Candle", "hg-3-12", { options: sizes("Size", ["8 oz", "12 oz"]) })), false,
  "A size option outside worn categories is not a fit size");
assert.equal(fitSized(storefrontProduct(10, "Sauté Pan", "hg-11-2-3")), false);

console.log("Catalog contract checks passed.");
