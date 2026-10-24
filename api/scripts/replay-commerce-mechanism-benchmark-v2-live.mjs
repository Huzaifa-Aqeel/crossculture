// Focused exact-pair replay through the real merchant/catalog/mechanism path.
// Writes only a decision, reason codes, call count and date into the fixture.
// Catalog search/detail payloads, media, prices and variant IDs stay transient.
import { readFile, writeFile } from "node:fs/promises";
import { researchCommercePair } from "../src/commerce-research.mjs";
import { catalogClient } from "../src/shopify-catalog.mjs";

const fixtureUrl = new URL("../fixtures/commerce-mechanism-benchmark-v2.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
if (fixture.version !== 2) throw new Error("Only benchmark v2 may be replayed.");
const requested = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
const retryExact = process.argv.includes("--retry-exact");
const inspectOnly = process.argv.includes("--inspect-only");
const traceFile = process.argv.find((arg) => arg.startsWith("--trace-file="))?.slice(13);
const pending = fixture.cases.filter((item) => (item.observation.kind === "planned_exact_replay" ||
  (retryExact && item.observation.kind === "exact_pair_unavailable") || inspectOnly) &&
  (!requested || item.id === requested));
if (requested && pending.length !== 1) throw new Error("Requested case is absent or already assessed.");
if (!requested && !process.argv.includes("--all"))
  throw new Error("Pass --case=CASE_ID or --all to run live Catalog research.");

function productPath(value) {
  try {
    const path = new URL(value).pathname;
    return path.match(/\/products\/[^/]+/)?.[0] ?? null;
  } catch { return null; }
}

for (const item of pending) {
  const evaluationTrace = [];
  const seedQuery = item.search?.seedQuery ?? item.seed.product;
  const partnerQuery = item.search?.partnerQuery ?? item.partner.product;
  const seed = { id: "11111111-1111-4111-8111-111111111111",
    name: item.seed.brand, officialWebsite: new URL(item.seed.url).origin,
    identityStatus: "verified" };
  const partner = { id: "22222222-2222-4222-8222-222222222222",
    name: item.partner.brand, officialWebsite: new URL(item.partner.url).origin,
    identityStatus: "verified" };
  let result;
  try {
    // This second pass measures the mechanism for a frozen product pair. It
    // does not measure the normal search/pair sampler, whose miss is recorded
    // separately. Search and detail are still live first-party Catalog calls.
    const createCatalog = () => {
      const catalog = catalogClient({ maxCalls: 18 });
      if (!retryExact) return catalog;
      const originalSearch = catalog.search;
      catalog.search = async (...args) => {
        const products = await originalSearch(...args);
        const side = args[1] === seedQuery ? "seed" : "partner";
        const expected = item[side].url;
        return products.filter((product) => productPath(product.url) === productPath(expected) &&
          (() => { try {
            const actualHost = new URL(product.url).hostname.replace(/^www\./, "");
            const expectedHost = new URL(expected).hostname.replace(/^www\./, "");
            return actualHost === expectedHost;
          } catch { return false; } })());
      };
      return catalog;
    };
    result = await researchCommercePair({ seed, partner, objective: item.objective,
      discoveryBasis: "user_specified", market: "US", maxCatalogCalls: 18 }, {
      createCatalog,
      onEvaluation: (trace) => evaluationTrace.push(trace),
      productQueries: [{ seedQuery, partnerQuery }],
    });
  } catch (error) {
    console.log(JSON.stringify({ id: item.id, state: "provider_interrupted",
      errorCode: error?.code ?? "unavailable", errorName: error?.name ?? "Error",
      httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
      causeCode: error?.cause?.code ?? null }));
    continue;
  }
  const all = Object.entries(result.opportunities ?? {}).flatMap(([, groups]) =>
    groups.flatMap((group) => [group.best, ...(group.otherOpportunities ?? [])].filter(Boolean)));
  const exact = all.filter((pair) => productPath(pair.live?.seed?.url) === productPath(item.seed.url) &&
    productPath(pair.live?.partner?.url) === productPath(item.partner.url));
  const exactTrace = evaluationTrace.filter((trace) => exact.some((pair) =>
    pair.seedProductId === trace.selected.seed.productId &&
    pair.seedVariantId === trace.selected.seed.variantId &&
    pair.partnerProductId === trace.selected.partner.productId &&
    pair.partnerVariantId === trace.selected.partner.variantId));
  const mechanismStates = [...new Set(exact.map((pair) =>
    pair.assessment?.productMechanism?.gate?.state ?? "unknown"))];
  const verdicts = [...new Set(exact.map((pair) => pair.assessment?.status ?? "needs_verification"))];
  if (exact.length && mechanismStates.length === 1 && verdicts.length === 1) {
    item.observation = { kind: "focused_pair_replay", verdict: verdicts[0],
      mechanismState: mechanismStates[0],
      mechanismPass: mechanismStates[0] === "unknown" ? null : mechanismStates[0] === "supported",
      notes: `Exact official product paths matched in ${exact.length} assessed variant combination(s). Mechanism gate: ${mechanismStates[0]}. Full opportunity includes no Qloo relationship evidence in this focused replay.`,
      ...(retryExact ? { retrievalNote: "The ordinary bounded sampler missed this pair although both exact paths were present in live search results; this pass restricted the live search results to the frozen pair before normal detail and assessment." } : {}),
      reasonCodes: [...new Set(exact.flatMap((pair) => pair.assessment?.reasonCodes ?? []))],
      catalogCallsUsed: result.callsUsed ?? null,
      observedAt: new Date().toISOString() };
  } else if (!exact.length) {
    item.observation = { kind: "exact_pair_unavailable", verdict: null,
      mechanismState: null, mechanismPass: null,
      notes: "The bounded live pair research did not assess both exact official product paths; no alternate product or variant was substituted.",
      coverageIssues: result.coverageIssues ?? [],
      hypothesesConsidered: result.hypothesesConsidered ?? 0,
      assessedCount: result.assessedCount ?? 0,
      coverage: result.coverage ?? null, catalogCallsUsed: result.callsUsed ?? null,
      observedAt: new Date().toISOString() };
  } else {
    // Different returned variants produced incompatible assessments. A
    // product-level prediction cannot silently choose the favorable one.
    item.observation = { kind: "exact_pair_unavailable", verdict: null,
      mechanismState: null, mechanismPass: null,
      notes: "The exact product paths were assessed with divergent variant outcomes; no single product-level prediction was assigned.",
      coverageIssues: result.coverageIssues ?? [],
      hypothesesConsidered: result.hypothesesConsidered ?? 0,
      assessedCount: result.assessedCount ?? 0,
      coverage: result.coverage ?? null, catalogCallsUsed: result.callsUsed ?? null,
      observedAt: new Date().toISOString() };
  }
  if (!inspectOnly) await writeFile(fixtureUrl, JSON.stringify(fixture, null, 2) + "\n");
  if (traceFile) {
    const traces = JSON.parse(await readFile(traceFile, "utf8").catch(() => "{}"));
    traces[item.id] = { mode: "focused_pair_replay", exactProductPathsMatched: exact.length,
      selectedVariantDecisions: exactTrace };
    await writeFile(traceFile, JSON.stringify(traces, null, 2) + "\n");
  }
  console.log(JSON.stringify({ id: item.id, state: item.observation.kind,
    exactCombinations: exact.length, mechanismStates,
    verdict: item.observation.verdict,
    catalogCallsUsed: result.callsUsed ?? null, coverage: result.coverage ?? null,
    coverageIssues: result.coverageIssues ?? [],
    hypothesesConsidered: result.hypothesesConsidered ?? 0,
    assessedCount: result.assessedCount ?? 0 }));
}
