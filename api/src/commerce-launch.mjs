import { personalQlooWherePopular } from "./personal-qloo.mjs";
import { MARKETS, nearestMetro } from "./geo-places.mjs";

const QLOO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Metro areas where both brands' audiences are strongest within one country.
// Qloo returns ranked map cells; each is named after the nearest metro, and a
// metro shared by both lists is a suggested launch area. This is explanation
// and concept material only: it never changes a verdict or the ranking.
export async function sharedLaunchAreas(ownerUserId, seedQlooId, partnerQlooId, market = "US",
  { wherePopular = personalQlooWherePopular, limit = 4 } = {}) {
  const country = MARKETS[market];
  if (!country || !QLOO_ID.test(seedQlooId ?? "") || !QLOO_ID.test(partnerQlooId ?? "") ||
      seedQlooId.toLowerCase() === partnerQlooId.toLowerCase()) {
    return { status: "unavailable", market, areas: [] };
  }
  const [seed, partner] = await Promise.all([
    wherePopular(ownerUserId, seedQlooId, country).catch(() => null),
    wherePopular(ownerUserId, partnerQlooId, country).catch(() => null),
  ]);
  if (seed?.status !== "ok" || partner?.status !== "ok" || seed.sampleData || partner.sampleData) {
    return { status: "unavailable", market, areas: [] };
  }
  // First (strongest) position of each named metro in a brand's ranked cells.
  const ranked = (results) => {
    const order = new Map();
    for (const [index, cell] of (results ?? []).entries()) {
      const name = nearestMetro(Number(cell?.location?.latitude), Number(cell?.location?.longitude), market);
      if (name && !order.has(name)) order.set(name, index);
    }
    return order;
  };
  const seedAreas = ranked(seed.results);
  const partnerAreas = ranked(partner.results);
  const areas = [...seedAreas.keys()].filter((name) => partnerAreas.has(name))
    .sort((a, b) => (seedAreas.get(a) + partnerAreas.get(a)) - (seedAreas.get(b) + partnerAreas.get(b)) ||
      a.localeCompare(b))
    .slice(0, limit);
  return { status: areas.length ? "shared_areas_observed" : "no_shared_area_observed", market, areas,
    qlooResponseIds: [seed.responseId, partner.responseId].filter(Boolean) };
}
