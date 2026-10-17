import { randomUUID } from "node:crypto";
import { qlooCall } from "./qloo.mjs";

const WIKIDATA_API = process.env.WIKIDATA_API_URL || "https://www.wikidata.org/w/api.php";
const QIDS = /^(?:Q[1-9]\d*)$/;

function cleanText(value, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

export function comparableName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|company|co)\b/g, " ").replace(/\s+/g, " ").trim();
}

function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch { return null; }
}

function websiteHost(value) {
  try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, "") : null; }
  catch { return null; }
}

function claimValue(entity, property) {
  return entity?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value ?? null;
}

function uniqueCandidates(items, idKey) {
  const seen = new Set();
  return items.filter((item) => {
    const id = item?.[idKey];
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 8);
}

export function normalizeQlooBrands(envelope) {
  return uniqueCandidates((Array.isArray(envelope?.results) ? envelope.results : [])
    .filter((item) => typeof item?.entity_id === "string" && typeof item?.name === "string"), "entity_id").map((item) => ({
      id: item.entity_id, name: cleanText(item.name, 120),
      description: cleanText(item.properties?.description ?? item.properties?.short_description),
      website: safeWebUrl(item.properties?.website ?? item.properties?.url),
      category: cleanText(item.properties?.category ?? item.properties?.type, 120),
      source: "qloo", observedAt: new Date().toISOString(),
    }));
}

export function normalizeWikidataBrands(searchResults, entities = {}) {
  return uniqueCandidates((Array.isArray(searchResults) ? searchResults : [])
    .filter((item) => QIDS.test(item?.id ?? "")), "id").map((item) => {
      const entity = entities[item.id];
      const website = claimValue(entity, "P856");
      const parent = claimValue(entity, "P749");
      const country = claimValue(entity, "P17");
      const industry = claimValue(entity, "P452");
      return {
        id: item.id, name: cleanText(entity?.labels?.en?.value ?? item.label, 120),
        description: cleanText(entity?.descriptions?.en?.value ?? item.description),
        website: typeof website === "string" ? safeWebUrl(website) : null,
        countryQid: QIDS.test(country?.id ?? "") ? country.id : null,
        industryQid: QIDS.test(industry?.id ?? "") ? industry.id : null,
        parentQid: QIDS.test(parent?.id ?? "") ? parent.id : null,
        wikidataUrl: `https://www.wikidata.org/wiki/${item.id}`,
        source: "wikidata", observedAt: new Date().toISOString(),
      };
    });
}

async function wikidataRequest(params, fetcher) {
  const agent = process.env.WIKIDATA_USER_AGENT;
  if (!agent || !/\b(?:https?:\/\/\S+|[^\s@]+@[^\s@]+)\b/.test(agent)) {
    throw new Error("Wikidata contact User-Agent is not configured.");
  }
  const url = new URL(WIKIDATA_API);
  if (url.protocol !== "https:" || !["www.wikidata.org", "www.wikimedia.org"].includes(url.hostname)) {
    throw new Error("Wikidata API URL is not trusted.");
  }
  for (const [key, value] of Object.entries({ ...params, format: "json" })) url.searchParams.set(key, String(value));
  const response = await fetcher(url, { headers: { "User-Agent": agent, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Wikidata request failed (${response.status}).`);
  return response.json();
}

export async function searchWikidataBrands(name, fetcher = fetch) {
  const found = await wikidataRequest({ action: "wbsearchentities", search: name, language: "en", type: "item", limit: 8 }, fetcher);
  return normalizeWikidataBrands(found.search ?? []);
}

export async function selectedWikidataBrand(candidate, fetcher = fetch) {
  if (!candidate || !QIDS.test(candidate.id ?? "")) throw new Error("Select a valid business record.");
  const details = await wikidataRequest({ action: "wbgetentities", ids: candidate.id, props: "labels|descriptions|claims", languages: "en" }, fetcher);
  return normalizeWikidataBrands([candidate], details.entities ?? {})[0];
}

export async function resolveBrand(name, { qloo = qlooCall, wikidata = searchWikidataBrands } = {}) {
  const query = String(name ?? "").trim();
  if (query.length < 2 || query.length > 90) throw new Error("Enter a brand name between 2 and 90 characters.");
  const [qlooResult, wikidataResult] = await Promise.allSettled([
    qloo("qloo_describe", { entity: query, type: "brand" }),
    wikidata(query),
  ]);
  const qlooEnvelope = qlooResult.status === "fulfilled" ? qlooResult.value : null;
  const qlooCandidates = normalizeQlooBrands(qlooEnvelope);
  const wikidataCandidates = wikidataResult.status === "fulfilled" ? wikidataResult.value : [];
  return {
    id: randomUUID(), query, qloo: { status: qlooEnvelope?.status ?? "unavailable", candidates: qlooCandidates },
    wikidata: { status: wikidataResult.status === "fulfilled" ? (wikidataCandidates.length ? "ok" : "empty") : "unavailable", candidates: wikidataCandidates },
    confirmationRequired: true,
    message: (qlooCandidates.length || wikidataCandidates.length ? "Choose the intended brand before continuing." : "No verified brand candidates are available yet. Try the official brand name or URL.") +
      (qlooEnvelope?.cacheStatus === "stale" ? " Cultural research is from an older saved result." : ""),
    createdAt: new Date().toISOString(),
  };
}

export function selectResolvedBrand(resolution, qlooId, wikidataId) {
  const qloo = resolution.qloo.candidates.find((item) => item.id === qlooId);
  const wikidata = wikidataId ? resolution.wikidata.candidates.find((item) => item.id === wikidataId) : null;
  if (!qloo) throw new Error("Select a cultural brand match from these results.");
  if (wikidataId && !wikidata) throw new Error("Select a business record from these results.");
  const qlooHost = websiteHost(qloo.website);
  const wikidataHost = websiteHost(wikidata?.website);
  const matchingDomain = Boolean(qlooHost && wikidataHost && qlooHost === wikidataHost);
  const matchingName = Boolean(wikidata && comparableName(qloo.name) === comparableName(wikidata.name));
  if (wikidata && qlooHost && wikidataHost && !matchingDomain) {
    throw new Error("These records have different official websites. Select only the cultural brand or refine the search.");
  }
  if (wikidata && !matchingName && !matchingDomain) {
    throw new Error("These records may describe different organizations. Select only the cultural brand or refine the search.");
  }
  // The Qloo result may omit a website. A user-selected Wikidata business
  // record with an official site and the same normalized name still provides
  // independent identity corroboration; a name alone does not.
  return { qloo, wikidata,
    identityStatus: matchingDomain || (matchingName && Boolean(wikidataHost)) ? "verified" : "unverified" };
}
