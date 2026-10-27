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
  const appeal = assessment?.sharedAudienceAppeal ?? {};
  const people = (appeal.people ?? []).map((item) => line(item, 60));
  const lifestyle = (appeal.lifestyle ?? []).map((item) => line(item, 60));
  const affinity = assessment?.culturalRelationship === "native_recommendation_verified"
    ? `People who like ${seedName} also tend to like ${partnerName}.`
    : assessment?.culturalRelationship === "category_recommendation_verified" && assessment.culturalCategory
      ? `Among ${line(assessment.culturalCategory, 40).toLowerCase()} brands, people who like ${seedName} tend to like ${partnerName}.`
    : assessment?.culturalRelationship === "direct_pair_supported" ? `People who like ${partnerName} also tend to like ${seedName}.` : "";
  if (!affinity && !themes.length) return "";
  return [affinity, themes.length ? `Both brands are known for ${listText(themes)}.` : "",
    people.length ? `Both brands resonate with ${listText(people)}.`
      : lifestyle.length ? `Both brands are associated with ${listText(lifestyle)}.` : ""].filter(Boolean).join(" ");
}

export function commerceProposal({ seedName, partnerName, objective, assessment = {},
  offers = {}, launchAreas = [], sourceUrls = [], existingCollaboration = false }) {
  const seed = name(seedName); const partner = name(partnerName);
  const goal = objective === "product_bundle" ? "Product bundle" : "Cross-sell";
  const product = (offer, brand) => {
    const title = name(offer?.title); if (!title) return null;
    const url = httpsUrl(offer?.url); const price = priceText(offer?.price);
    return `- **${title}** from ${brand}${price ? ` — ${price}` : ""}${url ? ` — ${url}` : ""}`;
  };
  const mechanism = assessment.productMechanism ?? {};
  const why = [sentence(mechanism.customerReason), sentence(mechanism.boundedRationale)].filter(Boolean).join(" ");
  const culture = [existingCollaboration ? `${partner} already sells a co-branded ${seed} product, so the brands have worked together before.` : "",
    culturalSummary(assessment, seed, partner)].filter(Boolean).join(" ");
  const areas = launchAreas.map((item) => name(item)).filter(Boolean).slice(0, 4);
  const roles = mechanism.roles ?? {};
  const toAgree = [...new Set([...(assessment.dealUnknowns ?? []).map(sentence),
    "Launch timing, promotion and how customers will buy both products."].filter(Boolean))];
  const links = [...new Set(sourceUrls.map(httpsUrl).filter(Boolean))].slice(0, 6);
  const products = [product(offers.seed, seed), product(offers.partner, partner)].filter(Boolean);
  const sections = [
    `# ${seed} × ${partner}\n\n${goal} proposal`,
    products.length ? `## The products\n\n${products.join("\n")}` : "",
    why ? `## Why it fits\n\n${why}` : "",
    culture ? `## Cultural fit\n\n${culture}` : "",
    areas.length ? `## Where audiences overlap\n\n${listText(areas)}: the cities where both brands' audiences are strongest, a good place to start targeted ads, local creators or a pop-up.` : "",
    roles.seedRole || roles.partnerRole ? `## What each brand brings\n\n${[
      roles.seedRole ? `- **${seed}:** ${sentence(roles.seedRole)}` : "",
      roles.partnerRole ? `- **${partner}:** ${sentence(roles.partnerRole)}` : ""].filter(Boolean).join("\n")}` : "",
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
