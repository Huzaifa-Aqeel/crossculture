// Qloo brand categories (urn:tag:genre:brand:*) that name products a partner
// could sell, from Qloo's own tag list (27 Oct 2026). The starting product
// picks from this closed list, so a category is always a real Qloo tag.
// Qloo has no category for outdoor gear, cookware or pet supplies; those
// products rely on the brand-only recommendation. Home accessories (decor
// brands) are left out: decor only adds ambience, never a Bundle's task.
const PREFIX = "urn:tag:genre:brand:";
const PATHS = [
  "electronics", "electronics:appliances", "electronics:camera_and_video",
  "electronics:computer_accessories", "electronics:gaming", "electronics:headphones",
  "electronics:home_theater", "electronics:music_instruments", "electronics:phones_and_tablets",
  "fashion:accessories", "fashion:accessories:bags_and_leather", "fashion:accessories:eyewear",
  "fashion:accessories:jewelry", "fashion:accessories:watch", "fashion:athletic", "fashion:casual",
  "fashion:footwear", "fashion:footwear:sneakers", "fashion:formalwear",
  "fashion:jeans", "fashion:lingerie_and_sleepwear", "fashion:swimwear",
  "food_and_beverage:drinks", "food_and_beverage:drinks:coffee_and_tea",
  "food_and_beverage:drinks:energy_drink", "food_and_beverage:drinks:juice",
  "food_and_beverage:drinks:sport_drinks", "food_and_beverage:food",
  "food_and_beverage:food:baby_food", "food_and_beverage:food:bakery", "food_and_beverage:food:breakfast",
  "food_and_beverage:food:candy_and_confectionery", "food_and_beverage:food:condiments_and_spices",
  "food_and_beverage:food:dairy_and_substitutes", "food_and_beverage:food:health",
  "food_and_beverage:food:meat_seafood_and_substitutes", "food_and_beverage:food:packaged:grain",
  "food_and_beverage:food:packaged:snacks", "food_and_beverage:food:prepared",
  "food_and_beverage:pet_food", "games",
  "health_and_beauty:baby_care", "health_and_beauty:hair_care", "health_and_beauty:health_care_wellness",
  "health_and_beauty:oral_care", "health_and_beauty:skincare", "health_and_beauty:skincare:suncare",
  "household", "wine_and_spirits:beer", "wine_and_spirits:non_alcoholic", "wine_and_spirits:spirits",
  "wine_and_spirits:spirits:cocktails", "wine_and_spirits:wine",
];
const label = (path) => path.split(":").at(-1).replace(/_and_/g, " & ").replace(/_/g, " ");

export const BRAND_GENRES = Object.freeze(PATHS.map((path) =>
  Object.freeze({ id: PREFIX + path, name: label(path) })));
const BY_ID = new Map(BRAND_GENRES.map((genre) => [genre.id, genre]));
export const brandGenre = (id) => BY_ID.get(id) ?? null;
