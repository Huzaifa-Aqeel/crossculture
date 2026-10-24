// Test-only candidate preflight. No brand list from this file enters production.
import { qlooCall, closeQloo } from "../src/qloo.mjs";
import { normalizeQlooBrands } from "../src/brand-resolution.mjs";
import { verifyCommerceBusiness } from "../src/commerce-native.mjs";

const candidates = {
  outdoor_technical: ["United by Blue", "Topo Designs", "Rumpl", "Parks Project"],
  home_kitchen: ["Cold Picnic", "Great Jones", "Material Kitchen", "East Fork"],
  apparel_lifestyle: ["Lacausa", "Hansel From Basel", "Jungmaven", "Summersalt"],
  cpg_personal_care: ["FISHWIFE", "Graza", "Omsom", "Brightland", "Starface",
    "Kopari", "Cocokind", "Nécessaire", "Kinfield"],
};
const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const selectedCategory = process.argv[2] ?? null;
try {
  for (const [category, names] of Object.entries(candidates)) {
    if (selectedCategory && category !== selectedCategory) continue;
    for (const name of names) {
      try {
        const envelope = await qlooCall("qloo_describe", { entity: name, type: "brand" });
        const exact = normalizeQlooBrands(envelope).find((item) =>
          normalize(item.name) === normalize(name));
        const business = exact ? await verifyCommerceBusiness({ qlooId: exact.id,
          name: exact.name, website: exact.website, description: exact.description }) : null;
        console.log(JSON.stringify({ category, query: name, qlooStatus: envelope.status,
          exactQlooBrand: exact ? { name: exact.name, id: exact.id,
            website: exact.website } : null,
          verifiedMerchant: business ? { officialWebsite: business.officialWebsite,
            storefrontProofUrl: business.storefrontProofUrl } : null }));
      } catch (error) {
        console.log(JSON.stringify({ category, query: name,
          error: error?.code ?? error?.message ?? "provider_error" }));
      }
    }
  }
} finally { await closeQloo().catch(() => {}); }
