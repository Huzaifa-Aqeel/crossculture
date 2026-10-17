// New-analysis availability only. The scorer and historical records retain all six objectives.
export const brandObjectives = new Set(["co_created_product", "content_collaboration", "repositioning"]);
export const creatorObjectives = new Set(["content_collaboration", "sponsorship"]);
export const projectObjectives = new Set([...brandObjectives, ...creatorObjectives]);

export function validateNewRunObjective(objective, partnerType, direction) {
  const supported = partnerType === "brand" ? brandObjectives : creatorObjectives;
  if (!supported.has(objective)) {
    throw Object.assign(new Error("This goal is not available for new research with the selected partner type. Choose a supported project goal."), { statusCode: 400 });
  }
  if (objective === "repositioning") {
    if (typeof direction !== "string" || !direction.trim() || direction.trim().length > 240) {
      throw Object.assign(new Error("Describe the desired cultural positioning direction (up to 240 characters)."), { statusCode: 400 });
    }
    return direction.trim();
  }
  return null;
}
