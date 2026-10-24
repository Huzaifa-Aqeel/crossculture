export const brandObjectives = new Set(["product_bundle", "cross_sell"]);
export const projectObjectives = brandObjectives;

export function validateNewRunObjective(objective, partnerType) {
  if (partnerType !== "brand" || !brandObjectives.has(objective)) {
    throw Object.assign(new Error("This goal is not available for new research with the selected partner type. Choose a supported project goal."), { statusCode: 400 });
  }
  return null;
}
