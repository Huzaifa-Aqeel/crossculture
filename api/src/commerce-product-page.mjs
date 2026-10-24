import { secureCatalogFetch } from "./shopify-catalog.mjs";
import { officialDomainOf } from "./web-research.mjs";

const normalize = (value) => String(value ?? "").toLowerCase()
  .replace(/&(?:amp|nbsp);/gi, " ").replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim().replace(/\s+/g, " ");
const plain = (value) => String(value ?? "")
  .replace(/<(?:script|style|svg)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|svg)>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g,
    (_match, digits) => String.fromCodePoint(Math.min(Number(digits), 0x10ffff)))
  .replace(/\s+/g, " ").trim();

export function extractSelectedProductPage(html, { url, title, officialWebsite,
  storefrontDomain } = {}) {
  let target;
  try { target = new URL(url); } catch { return null; }
  const official = officialDomainOf(officialWebsite);
  const shop = officialDomainOf(`https://${storefrontDomain}`);
  if (target.protocol !== "https:" || target.port || target.username || target.password ||
      !target.pathname.startsWith("/products/") ||
      ![official, shop].includes(officialDomainOf(target.href))) return null;
  const source = String(html ?? "");
  if (!source || source.length > 2_000_000) return null;
  const heading = [...source.matchAll(/<h1\b[^>]*>([\s\S]{0,4000}?)<\/h1>/gi)]
    .map((match) => ({ index: match.index + match[0].length, title: plain(match[1]) }))
    .find((item) => normalize(item.title) === normalize(title));
  if (!heading) return null;
  // The first substantial paragraph near this exact product heading is a
  // bounded product-page source. Navigation, reviews, and later suggestions
  // cannot supply the initiating product's cultural context.
  const nearby = source.slice(heading.index, heading.index + 16_000);
  const paragraph = [...nearby.matchAll(/<p\b[^>]*>([\s\S]{0,5000}?)<\/p>/gi)]
    .map((match) => plain(match[1]))
    .find((value) => value.length >= 60 && value.length <= 1200 &&
      /[\p{L}]/u.test(value));
  return paragraph ? { inspected: true, url: target.href, title: heading.title,
    description: paragraph.slice(0, 700) } : null;
}

export async function selectedProductPage(product, officialWebsite,
  storefrontDomain, { fetchPage = secureCatalogFetch } = {}) {
  const address = product?.url;
  if (!validAddress(address, officialWebsite, storefrontDomain)) return null;
  try {
    const response = await fetchPage(address, { headers: { accept: "text/html" },
      signal: AbortSignal.timeout(8000) });
    if (!response.ok || !String(response.contentType ?? "").toLowerCase()
      .includes("text/html")) return null;
    return extractSelectedProductPage(await response.text(), { url: address,
      title: product.title, officialWebsite, storefrontDomain });
  } catch { return null; }
}

function validAddress(value, officialWebsite, storefrontDomain) {
  try {
    const url = new URL(value);
    const domain = officialDomainOf(url.href);
    return url.protocol === "https:" && !url.port && !url.username && !url.password &&
      url.pathname.startsWith("/products/") &&
      [officialDomainOf(officialWebsite),
        officialDomainOf(`https://${storefrontDomain}`)].includes(domain);
  } catch { return false; }
}
