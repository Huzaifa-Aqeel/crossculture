import { officialDomainOf, withWebExtract, withWebIdentityLinks, withWebSearch } from "./web-research.mjs";

const clean = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function identityQuestion(channel) {
  const words = clean(channel?.name).split(" ");
  if (words.length !== 2 || words.some((word) => word.length < 3)) return null;
  const email = String(channel?.summary ?? "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase();
  if (!email || !email.split("@")[0].startsWith(words[0])) return null;
  return { name: String(channel.name).trim(), first: words[0], last: words[1], email };
}

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const exactName = (value, name) => clean(value).includes(clean(name));
const sameUrl = (left, right) => {
  try {
    const a = new URL(left); const b = new URL(right);
    return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "") &&
      a.pathname.replace(/\/$/, "").toLowerCase() === b.pathname.replace(/\/$/, "").toLowerCase();
  } catch { return false; }
};

export function corroboratedCreatorLinks(portfolio, linktree, channel) {
  const name = String(channel?.name ?? "").trim();
  const words = clean(name).split(" ");
  if (!CHANNEL_ID.test(channel?.id ?? "") || words.length !== 2 ||
      words.some((word) => word.length < 3) || !portfolio?.inspected || !linktree?.inspected ||
      !/^[a-f0-9]{64}$/.test(portfolio.sourceHash ?? "") ||
      !/^[a-f0-9]{64}$/.test(linktree.sourceHash ?? "") ||
      !personalDomain(portfolio.url, { first: words[0], last: words[1] }) ||
      !exactName(`${portfolio.title} ${portfolio.snippet}`, name) ||
      /\b(?:fan account|impersonat(?:e|ion)|unofficial)\b/i.test(portfolio.snippet ?? "")) return false;
  const linkedTree = (portfolio.outboundLinks ?? []).some((link) =>
    sameUrl(link.url, linktree.url) && officialDomainOf(link.url) === "linktr.ee");
  const backLink = (linktree.outboundLinks ?? []).some((link) => sameUrl(link.url, portfolio.url));
  const channelLink = (linktree.outboundLinks ?? []).some((link) => {
    try { const url = new URL(link.url);
      return ["youtube.com", "www.youtube.com"].includes(url.hostname) &&
        url.pathname === `/channel/${channel.id}` && !url.search &&
        /\b(?:my|official)\s+youtube\s+channel\b/i.test(link.label);
    } catch { return false; }
  });
  return linkedTree && backLink && channelLink;
}

function personalDomain(url, question) {
  const domain = officialDomainOf(url);
  const label = domain?.split(".")[0]?.replace(/[^a-z]/g, "") ?? "";
  return Boolean(new RegExp(`^${question.first}[a-z]?${question.last}$`).test(label));
}

export function corroboratedCreatorPage(item, channel) {
  const question = identityQuestion(channel);
  if (!question || item?.inspected !== true || !/^[a-f0-9]{64}$/.test(item.sourceHash ?? "") ||
      !personalDomain(item.url, question)) return false;
  const body = clean(item.snippet);
  return body.includes(clean(question.name)) &&
    String(item.snippet ?? "").toLowerCase().includes(question.email) &&
    !/\b(?:not|fake|impersonat(?:e|ion)|fan account)\b/i.test(item.snippet);
}

// Only an unresolved, person-named channel with an exact contact email can use
// this cache-first corroboration. Search hits locate pages; an inspected personal
// site must repeat both the channel's name and its exact contact address.
export async function verifyCreatorOperator(channel,
  { search = withWebSearch, extract = withWebExtract,
    inspectLinks = withWebIdentityLinks } = {}) {
  const question = identityQuestion(channel);
  try {
    if (question) {
      const result = await search(`${question.name} ${question.email}`, { focus: question.email });
      let item = (result.results ?? []).find((entry) => corroboratedCreatorPage(entry, channel));
      if (!item) {
        const lead = (result.leads ?? []).find((entry) => personalDomain(entry.url, question));
        if (lead) item = (await extract(lead.url, { focus: question.email,
          title: lead.title ?? question.name })).results?.find((entry) => corroboratedCreatorPage(entry, channel));
      }
      if (item) return { kind: "creator", reason: "An inspected personal creator page corroborates the channel's exact name and contact address.",
        basisField: "official_site", basisText: question.email, operatorName: question.name,
        identityEvidence: item };
    }
    if (!CHANNEL_ID.test(channel?.id ?? "") || clean(channel?.name).split(" ").length !== 2) return null;
    const name = String(channel.name).trim();
    const person = { first: clean(name).split(" ")[0], last: clean(name).split(" ")[1] };
    const found = await search(`${name} portfolio`, { focus: person.last });
    const lead = [...(found.results ?? []), ...(found.leads ?? [])]
      .find((entry) => personalDomain(entry.url, person));
    if (!lead) return null;
    const portfolio = (await inspectLinks(lead.url, { focus: name })).results?.find((item) => item.inspected);
    if (!portfolio) return null;
    const treeLink = (portfolio.outboundLinks ?? []).find((link) =>
      officialDomainOf(link.url) === "linktr.ee");
    if (!treeLink) return null;
    const tree = (await inspectLinks(treeLink.url, { focus: clean(name).replaceAll(" ", "") }))
      .results?.find((item) => item.inspected);
    if (!corroboratedCreatorLinks(portfolio, tree, channel)) return null;
    return { kind: "creator", reason: "An inspected personal portfolio and reciprocal creator links attribute the exact YouTube channel.",
      basisField: "official_site", basisText: `https://www.youtube.com/channel/${channel.id}`,
      operatorName: name, identityEvidence: tree, identityEvidenceChain: [portfolio, tree] };
  } catch { return null; }
}
