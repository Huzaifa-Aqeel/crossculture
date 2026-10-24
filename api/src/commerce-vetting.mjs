import { withWebSearch, officialDomainOf } from "./web-research.mjs";

const OFFICIAL_COLLABORATION = /\b(?:collaborat(?:ion|ions|ed)|partnered with|partnership with|teamed up with|co-?brand(?:ed|ing))\b/i;
const REPORTED_COLLABORATION = /\b(?:collaborated with|partnered with|partnership (?:with|between)|teamed up with|co-?branded with|joint (?:campaign|collection|launch))\b/i;
const ADVERSE_EVENT = /\b(?:recalled|recall of|lawsuit against|sued by|sued for|settled (?:a |the )?lawsuit|regulator(?:y)? action against)\b/i;

function relevantVettingPage(page, kind) {
  const text = `${page?.title ?? ""} ${page?.snippet ?? ""}`;
  if (kind === "official_context") return OFFICIAL_COLLABORATION.test(text);
  const hostname = (() => { try { return new URL(page.url).hostname.toLowerCase(); }
    catch { return ""; } })();
  if (hostname.endsWith("linkedin.com") && /^\/in\//.test(new URL(page.url).pathname)) return false;
  return kind === "independent_context_to_review"
    ? REPORTED_COLLABORATION.test(text) : ADVERSE_EVENT.test(text);
}

// A bounded public-source review of a partner the user saved. These links give
// a human reviewer context; they never change a status, and missing results
// never certify safety.
export async function vetCommerceShortlist(partner, { search = withWebSearch } = {}) {
  const domain = officialDomainOf(partner?.officialWebsite);
  if (!domain || !partner?.name) return { status: "not_verified", sourceUrls: [], findings: [] };
  const [official, independentlyReported, concerns] = await Promise.all([
    search(`${partner.name} partnerships collaborations`, {
      includeDomains: [domain], focus: partner.name }).catch(() => null),
    search(`${partner.name} brand collaboration reporting`, { focus: partner.name }).catch(() => null),
    search(`${partner.name} brand recall lawsuit dispute reporting`, { focus: partner.name }).catch(() => null),
  ]);
  const findings = [];
  for (const [response, kind, isExternal] of [
    [official, "official_context", false],
    [independentlyReported, "independent_context_to_review", true],
    [concerns, "independent_concern_to_review", true],
  ]) {
    for (const page of response?.results ?? []) {
      const host = officialDomainOf(page.url);
      if (page.inspected !== true || !page.url?.startsWith("https://") || !host ||
          (isExternal ? host === domain : host !== domain) ||
          !relevantVettingPage(page, kind) ||
          findings.some((item) => item.url === page.url)) continue;
      const publishedAt = typeof page.publishedAt === "string" &&
        Number.isFinite(Date.parse(page.publishedAt)) && Date.parse(page.publishedAt) <= Date.now()
        ? page.publishedAt : null;
      findings.push({ kind, url: page.url, publishedAt });
      if (findings.filter((item) => item.kind === kind).length >= 2) break;
    }
  }
  return { status: findings.length ? "public_context_to_review" : "no_inspected_context",
    sourceUrls: findings.map((item) => item.url), findings };
}
