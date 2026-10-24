function cleanText(value, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch { return null; }
}

export function normalizeQlooBrands(envelope) {
  const seen = new Set();
  const qlooId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resolved = Array.isArray(envelope?.results) ? envelope.results : [];
  const choices = Array.isArray(envelope?.resolution?.issues)
    ? envelope.resolution.issues.flatMap((issue) => Array.isArray(issue.candidates)
      ? issue.candidates.filter((candidate) => candidate.type === "urn:entity:brand")
        .map((candidate) => ({ ...candidate, entity_id: candidate.id })) : []) : [];
  return [...resolved, ...choices]
    .filter((item) => qlooId.test(item?.entity_id ?? "") &&
      typeof item?.name === "string" && (!item.type || item.type === "urn:entity:brand"))
    .filter((item) => {
      if (seen.has(item.entity_id)) return false;
      seen.add(item.entity_id);
      return true;
    }).slice(0, 8).map((item) => ({
      id: item.entity_id, name: cleanText(item.name, 120),
      description: cleanText(item.properties?.description ?? item.properties?.short_description ?? item.description),
      website: safeWebUrl(item.properties?.website ?? item.properties?.url),
      category: cleanText(item.properties?.category ?? item.properties?.type, 120),
      source: "qloo", observedAt: new Date().toISOString(),
    }));
}
