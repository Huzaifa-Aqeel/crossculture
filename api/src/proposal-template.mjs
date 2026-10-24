// A partnership proposal drafted only from verified facts. Sections without
// supporting evidence are left out rather than shown empty; the user edits
// the draft freely afterwards.
const line = (value, max = 400) => String(value ?? "").replace(/[\r\n]+/g, " ")
  .replace(/^[#>\s-]+/, "").trim().slice(0, max);
const name = (value) => line(value, 160).replace(/[#*\[\]]/g, " ").replace(/\s+/g, " ").trim();
const httpsUrl = (value) => { try { return new URL(value).protocol === "https:" ? new URL(value).href : null; }
  catch { return null; } };
const sentence = (value) => { const text = line(value); return text ? `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}` : ""; };
const listText = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

function priceText(price) {
  if (!Number.isInteger(price?.amountMinor) || typeof price?.currencyCode !== "string") return null;
  try {
    const format = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currencyCode });
    return format.format(price.amountMinor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  } catch { return null; }
}

export function culturalSummary(assessment, seedName, partnerName) {
  const themes = (assessment?.culturalThemes?.length ? assessment.culturalThemes
    : assessment?.culturalTheme ? [assessment.culturalTheme] : []).map((item) => line(item, 80).toLowerCase());
  const tastes = (assessment?.sharedAudienceTastes ?? []).map((item) => line(item, 60));
  const affinity = assessment?.culturalRelationship === "native_recommendation_verified"
    ? `${seedName}'s customers also favor ${partnerName}.`
    : assessment?.culturalRelationship === "direct_pair_supported" ? `${partnerName}'s customers also favor ${seedName}.` : "";
  if (!affinity && !themes.length) return "";
  return [affinity, themes.length ? `Both brands are known for ${listText(themes)}.` : "",
    tastes.length ? `Their audiences share a taste for ${listText(tastes)}.` : ""].filter(Boolean).join(" ");
}

export function commerceProposal({ seedName, partnerName, objective, concept, assessment = {},
  offers = {}, launchAreas = [], sourceUrls = [] }) {
  const seed = name(seedName); const partner = name(partnerName);
  const goal = objective === "product_bundle" ? "Product bundle" : "Cross-sell";
  const product = (offer, brand) => {
    const title = name(offer?.title); if (!title) return null;
    const url = httpsUrl(offer?.url); const price = priceText(offer?.price);
    return `- **${title}** from ${brand}${price ? ` — ${price}` : ""}${url ? ` — ${url}` : ""}`;
  };
  const mechanism = assessment.productMechanism ?? {};
  const why = [sentence(mechanism.customerReason), sentence(mechanism.boundedRationale)].filter(Boolean).join(" ");
  const culture = culturalSummary(assessment, seed, partner);
  const areas = launchAreas.map((item) => name(item)).filter(Boolean).slice(0, 4);
  const toAgree = [...new Set([sentence(concept?.validation), ...(assessment.dealUnknowns ?? []).map(sentence),
    "Launch timing, promotion and how customers will buy both products."].filter(Boolean))];
  const links = [...new Set(sourceUrls.map(httpsUrl).filter(Boolean))].slice(0, 6);
  const products = [product(offers.seed, seed), product(offers.partner, partner)].filter(Boolean);
  const sections = [
    `# ${seed} × ${partner}\n\n${goal} proposal`,
    concept?.title ? `## The idea\n\n**${name(concept.title)}**${concept.format ? ` — ${name(concept.format)}` : ""}\n\n${sentence(concept.summary)}` : "",
    products.length ? `## The products\n\n${products.join("\n")}` : "",
    why ? `## Why it fits\n\n${why}` : "",
    culture ? `## Cultural fit\n\n${culture}` : "",
    areas.length ? `## Where audiences overlap\n\n${listText(areas)}: the cities where both brands' audiences are strongest, a good place to start targeted ads, local creators or a pop-up.` : "",
    concept?.roles?.seed || concept?.roles?.partner ? `## What each brand brings\n\n${[
      concept.roles.seed ? `- **${seed}:** ${sentence(concept.roles.seed)}` : "",
      concept.roles.partner ? `- **${partner}:** ${sentence(concept.roles.partner)}` : ""].filter(Boolean).join("\n")}` : "",
    `## To agree together\n\n${toAgree.map((item) => `- ${item}`).join("\n")}`,
    links.length ? `## Sources\n\n${links.map((url) => `- ${url}`).join("\n")}` : "",
  ];
  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

export function citedFinding(claim, sources) {
  const linked = (claim?.sourceIds ?? []).map((id) => sources.find((source) => source.id === id))
    .filter((source) => source?.sourceUrl && source?.freshness !== "sample");
  if (!linked.length || typeof claim?.text !== "string") throw new Error("Only supported findings can be inserted.");
  return `${claim.text.trim()} ${linked.map((source) => `[Source](${source.sourceUrl})`).join(" ")}`;
}
