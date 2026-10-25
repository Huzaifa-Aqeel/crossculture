import { readFileSync } from "node:fs";

// Shopify's public Standard Product Taxonomy. Storefront Catalog products carry
// only a category ID (`categories[].value`), never a product type, so names are
// read from the published list (v2026-08, MIT) shipped with the API.
const TAXONOMY_ID = /^gid:\/\/shopify\/TaxonomyCategory\/([a-z]{2}(?:-\d+){0,8})$/;
let names;
const taxonomyNames = () => names ??= new Map(readFileSync(
  new URL("./data/shopify-taxonomy-v2026-08.tsv", import.meta.url), "utf8")
  .split("\n").filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t")));

// The Shopify taxonomy category a merchant assigned, e.g. "aa-1-13-7" (shirts).
export function taxonomyCategory(product) {
  for (const category of product?.categories ?? []) {
    const id = String(category?.value ?? "").match(TAXONOMY_ID)?.[1];
    if (id) return id;
  }
  return null;
}

// "Shoulder Bags" for aa-5-4-19; null for an unknown or missing ID.
export function categoryName(id) {
  return id ? taxonomyNames().get(id) ?? null : null;
}

// The last levels of a category's path, e.g. "Handbags > Shoulder Bags".
export function categoryPath(id, levels = 2) {
  if (!id) return null;
  const parts = id.split("-");
  const path = parts.map((_, index) => categoryName(parts.slice(0, index + 1).join("-")))
    .filter(Boolean);
  return path.length ? path.slice(-levels).join(" > ") : null;
}

// Two categories are similar when they share their first three levels
// ("aa-1-13", clothing tops), or all levels of a shorter one.
export function similarCategory(left, right) {
  if (!left || !right) return false;
  const a = left.split("-"); const b = right.split("-");
  const depth = Math.min(3, a.length, b.length);
  return a.slice(0, depth).join("-") === b.slice(0, depth).join("-");
}

// Everyday bags sit in two taxonomy branches: Handbags (aa-5-4) and parts of
// Luggage & Bags (backpacks, fanny packs, messenger, shopping, tote and laptop
// bags). For "does this store already sell it", they are one kind of product.
const EVERYDAY_BAGS = ["aa-5-4", "lb-1", "lb-7", "lb-10", "lb-11", "lb-13", "lb-15"];
const everydayBag = (id) => EVERYDAY_BAGS.some((root) => id === root || id.startsWith(`${root}-`));
export function sameRange(left, right) {
  return similarCategory(left, right) || Boolean(left && right && everydayBag(left) && everydayBag(right));
}
