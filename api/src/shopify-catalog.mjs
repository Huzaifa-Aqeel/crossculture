// Transient UCP Catalog client. Never log, cache, or persist a catalog response.
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
const PROFILE_EXAMPLE = "https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json";
const GLOBAL_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";
const CATALOG_TOOLS = new Set(["search_catalog", "lookup_catalog", "get_product"]);

export function publicIpAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19].includes(b)) || (a === 203 && b === 0));
  }
  if (family !== 6) return false;
  const lower = address.toLowerCase();
  if (lower.includes(".")) return false; // IPv4-mapped forms are not accepted.
  if (lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") ||
      lower.startsWith("feb") || lower.startsWith("2001:db8:")) return false;
  return /^[23][0-9a-f]/.test(lower);
}

// DNS is checked and pinned for this HTTPS request. Redirects are never followed.
export async function secureCatalogFetch(url, options = {}) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.port || target.username || target.password) {
    throw new Error("Public HTTPS endpoint required.");
  }
  const answers = await lookup(target.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some((item) => !publicIpAddress(item.address))) {
    throw new Error("Storefront endpoint did not resolve to public addresses.");
  }
  const pinned = answers[0];
  return new Promise((resolve, reject) => {
    const request = httpsRequest(target, { method: options.method ?? "GET",
      headers: { "user-agent": "CrossCulture/1.0", ...options.headers }, signal: options.signal,
      lookup: (_hostname, lookupOptions, done) => lookupOptions?.all
        ? done(null, [pinned]) : done(null, pinned.address, pinned.family) }, (response) => {
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 2_000_000) request.destroy(new Error("Catalog response too large."));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode, contentType: response.headers["content-type"] ?? "",
          text: async () => body, json: async () => JSON.parse(body) });
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

export function catalogEndpoint(domain) {
  if (domain === "global") return GLOBAL_ENDPOINT;
  if (typeof domain !== "string" || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(domain) ||
      domain.includes("..") || !domain.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(domain) ||
      /(?:^|\.)(?:localhost|local|internal|test)$/.test(domain)) {
    throw new Error("A verified storefront domain is required.");
  }
  return `https://${domain.toLowerCase()}/api/ucp/mcp`;
}

export async function discoverVerifiedStorefront(officialUrl, { fetcher = secureCatalogFetch,
  timeoutMs = 8000, onlyDomain = null } = {}) {
  let officialHost;
  try {
    const url = new URL(officialUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password) throw new Error();
    officialHost = url.hostname.toLowerCase();
  }
  catch { throw new Error("A verified official brand website is required."); }
  catalogEndpoint(officialHost);
  const baseHost = officialHost.startsWith("www.") ? officialHost.slice(4) : officialHost;
  // Probe the verified host, its apex when the official site uses www, and
  // bounded store subdomains of that same parent domain.
  // A successful UCP document and a Shopify shop ID are still required.
  const allowedCandidates = [...new Set([officialHost, baseHost, ...["checkout", "shop", "store"]
    .map((prefix) => `${prefix}.${baseHost}`)])];
  if (onlyDomain && !allowedCandidates.includes(onlyDomain)) {
    throw new Error("Saved storefront domain is not associated with the official website.");
  }
  const candidates = onlyDomain ? [onlyDomain] : allowedCandidates;
  let probeUnavailable = false;
  for (const domain of candidates) {
    try {
      const response = await fetcher(`https://${domain}/.well-known/ucp`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      if (!response.ok) continue;
      const document = await response.json();
      const capabilities = document?.ucp?.capabilities ?? {};
      // The discovery document identifies the shop. Actual search/detail tools
      // are negotiated separately; a storefront may expose only part of Catalog.
      if (!capabilities["dev.ucp.shopping.catalog.search"]) continue;
      const service = document?.ucp?.services?.["dev.ucp.shopping"]?.find((item) =>
        item.transport === "mcp" && item.version === document.ucp.version);
      let endpointHost;
      try {
        const endpoint = new URL(service?.endpoint);
        if (endpoint.protocol !== "https:" || endpoint.port || endpoint.pathname !== "/api/ucp/mcp") continue;
        endpointHost = endpoint.hostname.toLowerCase();
        catalogEndpoint(endpointHost);
      } catch { continue; }
      if (endpointHost !== domain && !endpointHost.endsWith(`.${baseHost}`) &&
          !endpointHost.endsWith(".myshopify.com")) continue;
      const shopId = document?.ucp?.payment_handlers?.["dev.shopify.shop_pay"]?.[0]?.config?.shop_id;
      return { domain, officialHost, endpointHost,
        shopId: /^\d+$/.test(String(shopId ?? "")) ? `gid://shopify/Shop/${shopId}` : null,
        proofUrl: `https://${domain}/.well-known/ucp` };
    } catch { probeUnavailable = true; }
  }
  return probeUnavailable ? { shopId: null, coverage: "storefront_probe_unavailable" } : null;
}

export function verifyCatalogOffer(detail, { expectedSellerId, verifiedStoreDomains = [],
  expectedVariantId, currency, expectedMarket = "US", requireMarket = true } = {}) {
  const variant = detail?.variant;
  if (!variant || (expectedVariantId && variant.id !== expectedVariantId)) {
    return { state: "contradicted", reasonCode: "variant_mismatch" };
  }
  const seller = variant.seller;
  const sellerHost = (() => { try { return new URL(seller?.url).hostname.toLowerCase(); } catch { return null; } })();
  if (expectedSellerId && seller?.id && seller.id !== expectedSellerId) {
    return { state: "contradicted", reasonCode: "seller_mismatch" };
  }
  if (sellerHost && verifiedStoreDomains.length && !verifiedStoreDomains.includes(sellerHost) &&
      !verifiedStoreDomains.includes(String(seller?.domain ?? "").toLowerCase())) {
    return { state: "unknown", reasonCode: "seller_domain_unverified" };
  }
  if (!seller?.id || !sellerHost) return { state: "unknown", reasonCode: "seller_identity_missing" };
  const amount = variant.price?.amount;
  const offerCurrency = variant.price?.currency;
  if (!Number.isInteger(amount) || amount < 0 || !offerCurrency) {
    return { state: "unknown", reasonCode: "price_missing" };
  }
  if (currency && currency !== offerCurrency) return { state: "unknown", reasonCode: "currency_conversion_unverified" };
  // Out of stock is a separate availability fact, not proof that the merchant
  // cannot ship this selection to the requested country.
  if (variant.availability?.available === false) return { state: "unknown", reasonCode: "selected_offer_unavailable" };
  if (variant.availability?.available !== true) return { state: "unknown", reasonCode: "availability_unknown" };
  if (requireMarket && detail.marketSignal !== `global_${expectedMarket.toLowerCase()}_filter`) {
    return { state: "unknown", reasonCode: "market_unverified" };
  }
  return { state: "supported", reasonCode: "current_exact_seller_offer", sellerId: seller.id,
    sellerHost, productId: detail.product.id, variantId: variant.id, amount, currency: offerCurrency,
    checkedAt: detail.fetchedAt, marketSignal: detail.marketSignal };
}

export function catalogClient({ profileUrl = process.env.SHOPIFY_UCP_PROFILE_URL,
  fetcher = secureCatalogFetch, timeoutMs = 10000, maxCalls = 28 } = {}) {
  if (!profileUrl || !/^https:\/\//.test(profileUrl)) {
    throw new Error("A hosted Shopify agent profile is required.");
  }
  let calls = 0;
  const profile = { "ucp-agent": { profile: profileUrl } };
  async function request(domain, method, params) {
    if (calls >= maxCalls) throw Object.assign(new Error("Catalog call budget reached."),
      { code: "catalog_budget_exhausted" });
    calls += 1;
    const response = await fetcher(catalogEndpoint(domain), {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: calls, method,
        params: { ...params, meta: profile } }), signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
    });
    if (response.status === 429) throw Object.assign(new Error("Catalog rate limit reached."), { code: "catalog_rate_limited" });
    if (!response.ok) throw Object.assign(new Error("Catalog unavailable."), { code: "catalog_unavailable", httpStatus: response.status });
    const result = await response.json();
    if (result.error || result.result?.isError) throw Object.assign(new Error("Catalog request failed."), { code: "catalog_error" });
    return result.result;
  }
  async function tools(domain) {
    const result = await request(domain, "tools/list", {});
    return new Set((result?.tools ?? []).map((tool) => tool.name).filter((name) => CATALOG_TOOLS.has(name)));
  }
  async function call(domain, name, catalog, negotiated) {
    if (!CATALOG_TOOLS.has(name) || !negotiated.has(name)) throw new Error(`Catalog capability unavailable: ${name}`);
    const result = await request(domain, "tools/call", { name, arguments: { meta: profile, catalog } });
    if (!result?.structuredContent || result.structuredContent.ucp?.status === "error") {
      throw new Error("Catalog returned no usable structured product data.");
    }
    return result.structuredContent;
  }
  async function searchPage(domain, query, negotiated, { market = "US", shops = [],
    cursor = null, limit = domain === "global" ? 16 : 24, categories = [] } = {}) {
    if (!query || query.length > 100) throw new Error("A bounded product query is required.");
    if (cursor && (typeof cursor !== "string" || cursor.length > 2000)) {
      throw new Error("Invalid Catalog cursor.");
    }
    const pageLimit = Math.max(1, Math.min(domain === "global" ? 50 : 250,
      Number.isInteger(limit) ? limit : 16));
    const catalog = domain === "global"
      ? { query, filters: { ships_to: { country: market }, available: true,
        ...(shops.length ? { shops } : {}),
        ...(categories.length ? { categories: categories.filter((id) =>
          /^gid:\/\/shopify\/TaxonomyCategory\//.test(id)).slice(0, 4) } : {}) },
        context: { address_country: market }, pagination: { limit: pageLimit,
          ...(cursor ? { cursor } : {}) } }
      : { query, context: { address_country: market }, pagination: { limit: pageLimit,
        ...(cursor ? { cursor } : {}) } };
    const result = await call(domain, "search_catalog", catalog, negotiated);
    return { products: (result.products ?? []).slice(0, pageLimit),
      pagination: { cursor: result.pagination?.cursor ?? null,
        hasNextPage: result.pagination?.has_next_page === true } };
  }
  async function search(domain, query, negotiated, options = {}) {
    return (await searchPage(domain, query, negotiated, options)).products;
  }
  async function detail(domain, productId, variantId, selected, negotiated,
    { market = "US", expectedSellerId = null } = {}) {
    if (typeof productId !== "string" || !productId.startsWith("gid://shopify/")) throw new Error("A selected product is required.");
    const catalog = { id: productId, ...(selected?.length ? { selected } : {}),
      context: { address_country: market } };
    // A stored exact variant reference has no option labels. On storefronts
    // where get_product defaults to the first variant, lookup by variant ID is
    // the only safe way to reselect a non-default variant without substitution.
    const preferVariantLookup = Boolean(variantId && !selected?.length &&
      negotiated.has("lookup_catalog"));
    const result = preferVariantLookup
      ? await call(domain, "lookup_catalog", { ids: [variantId],
        ...(domain === "global" ? { context: { address_country: market } } : {}) }, negotiated)
      : negotiated.has("get_product")
        ? await call(domain, "get_product", catalog, negotiated)
        : negotiated.has("lookup_catalog")
          ? await call(domain, "lookup_catalog", { ids: [variantId ?? productId],
            ...(domain === "global" ? { context: { address_country: market } } : {}) }, negotiated)
          : null;
    if (!result) throw new Error("Catalog product detail is unavailable.");
    const product = result.product?.id === productId ? result.product
      : result.products?.find((item) => item.id === productId);
    if (!product || product.id !== productId) {
      const error = new Error("The selected product changed or could not be resolved.");
      error.code = "selected_product_unresolved";
      throw error;
    }
    const candidates = variantId ? product.variants?.filter((item) => item.id === variantId) ?? []
      : product.variants ?? [];
    const variant = expectedSellerId ? candidates.find((item) => item.seller?.id === expectedSellerId)
      : candidates.length === 1 ? candidates[0] : null;
    if (!variant || (selected?.length && selected.some((option) =>
      !variant.options?.some((actual) => actual.name === option.name && actual.label === option.label)))) {
      const error = new Error("The selected variant changed or could not be resolved.");
      error.code = "selected_variant_unresolved";
      throw error;
    }
    return { product, variant, fetchedAt: new Date().toISOString(),
      marketSignal: domain === "global" ? "global_context_only" : "storefront_availability_only" };
  }
  async function globalOfferFor(storefrontProduct, storefrontVariant, sellerId, negotiated,
    { market = "US" } = {}) {
    if (!sellerId || !storefrontProduct?.title || !storefrontVariant?.id) {
      throw new Error("A selected variant and verified seller are required.");
    }
    const hits = await search("global", storefrontProduct.title.slice(0, 100), negotiated, { market });
    const exact = hits.flatMap((product) => (product.variants ?? []).map((variant) => ({ product, variant })))
      .filter(({ variant }) => variant.id === storefrontVariant.id && variant.seller?.id === sellerId);
    if (exact.length !== 1) return { state: "unknown", reasonCode: "exact_seller_offer_not_found" };
    const selected = exact[0];
    let sellerHost;
    try { sellerHost = new URL(selected.variant.seller.url).hostname.toLowerCase(); }
    catch { return { state: "unknown", reasonCode: "seller_domain_unverified" }; }
    const fresh = await detail("global", selected.product.id, storefrontVariant.id, null, negotiated,
      { market, expectedSellerId: sellerId });
    const marketSignal = `global_${market.toLowerCase()}_filter`;
    const verified = verifyCatalogOffer({ ...fresh, marketSignal },
      { expectedSellerId: sellerId, expectedVariantId: storefrontVariant.id, currency: storefrontVariant.price?.currency,
        verifiedStoreDomains: [sellerHost], expectedMarket: market });
    return verified.state === "supported" ? { ...verified, productId: selected.product.id,
      marketSignal, checkedAt: fresh.fetchedAt } : verified;
  }
  return { tools, search, searchPage, detail, globalOfferFor, callsUsed: () => calls };
}

export { PROFILE_EXAMPLE };
