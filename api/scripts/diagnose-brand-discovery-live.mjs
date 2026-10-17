// Read-only live identity diagnostic. Prints selected public provider fields only.
import { qlooCall, closeQloo } from "../src/qloo.mjs";
import { comparableName, searchWikidataBrands, selectedWikidataBrand } from "../src/brand-resolution.mjs";
import { selectBrandLeads } from "../src/personal-brand-discovery.mjs";

const seedName = process.argv[2] ?? "Patagonia";
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
try {
  const seedResult = await qlooCall("qloo_describe", { entity: seedName, type: "brand" });
  const seeds = seedResult.results?.filter((item) => comparableName(item.name) === comparableName(seedName)) ?? [];
  if (seeds.length !== 1) throw new Error(`Seed identity is not unique: ${seedName}`);
  const recommended = await qlooCall("qloo_recommend", {
    target_type: "brand", signals: [seeds[0].entity_id], limit: 12, explain: true,
  });
  const leads = selectBrandLeads(recommended.results, seeds[0].entity_id);
  for (const [index, lead] of leads.entries()) {
    const raw = recommended.results.find((item) => item.entity_id === lead.qlooId);
    const described = await qlooCall("qloo_describe", { entity: lead.name, type: "brand" }).catch(() => null);
    const exact = described?.results?.find((item) => item.entity_id === lead.qlooId);
    const matches = await searchWikidataBrands(lead.name).catch(() => []);
    const detailed = [];
    for (const match of matches.slice(0, 5)) {
      const detail = await selectedWikidataBrand(match).catch(() => null);
      if (detail) detailed.push({ qid: detail.id, name: detail.name, description: detail.description,
        website: detail.website, parentQid: detail.parentQid, countryQid: detail.countryQid,
        industryQid: detail.industryQid, nameMatch: comparableName(detail.name) === comparableName(lead.name) });
    }
    const properties = raw?.properties ?? {};
    const describedProperties = exact?.properties ?? {};
    const output = { rank: index + 1, qlooId: lead.qlooId, name: lead.name,
      qlooType: raw?.type ?? null, qlooCategory: properties.category ?? null,
      qlooDescription: lead.description, qlooWebsite: lead.qlooWebsite,
      qlooPropertyKeys: Object.keys(properties), qlooExternalIdFields: Object.fromEntries(Object.entries(properties)
        .filter(([key]) => /id|url|website|domain|external|wiki|official/i.test(key))),
      describedExact: Boolean(exact), describedType: exact?.type ?? null,
      describedWebsite: describedProperties.website ?? describedProperties.url ?? null,
      describedPropertyKeys: Object.keys(describedProperties),
      describedExternalIdFields: Object.fromEntries(Object.entries(describedProperties)
        .filter(([key]) => /id|url|website|domain|external|wiki|official/i.test(key))),
      wikidata: detailed,
      currentRejection: !detailed.length ? "no Wikidata result" :
        !detailed.some((item) => item.nameMatch) ? "no exact-name Wikidata result" :
          !host(lead.qlooWebsite ?? describedProperties.website ?? describedProperties.url)
            ? "Qloo official website absent" :
            !detailed.some((item) => item.nameMatch && item.website && host(item.website) === host(lead.qlooWebsite ?? describedProperties.website ?? describedProperties.url))
              ? "no exact-name Wikidata result with matching official domain" : "potentially corroborated" };
    console.log(JSON.stringify(output));
  }
} finally { await closeQloo().catch(() => {}); }
