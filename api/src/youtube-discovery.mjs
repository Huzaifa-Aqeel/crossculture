// Conservative grouping: a shared broad word is not proof of the same culture.
const GENERIC = new Set(["culture", "cultural", "lifestyle", "interest", "interests",
  "people", "person", "fans", "fan", "enthusiasts", "enthusiast", "consumers",
  "consumer", "community", "communities"]);

const words = (value) => String(value ?? "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
const stem = (word) => word.endsWith("ies") ? `${word.slice(0, -3)}y` :
  word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
const core = (value) => [...new Set(words(value).map(stem).filter((word) => !GENERIC.has(word)))].sort();
const closeWord = (a, b) => a === b || Math.min(a.length, b.length) >= 8 &&
  a.slice(0, 7) === b.slice(0, 7) && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.75;

export function stronglyOverlappingCulture(a, b) {
  if (a.type !== b.type) return false;
  const left = core(a.name); const right = core(b.name);
  if (!left.length || !right.length) return a.name.toLowerCase() === b.name.toLowerCase();
  if (left.length === 1 || right.length === 1)
    return left.length === right.length && closeWord(left[0], right[0]);
  const matched = left.filter((word) => right.some((other) => closeWord(word, other))).length;
  return matched >= 2 && matched / Math.max(left.length, right.length) >= 0.8;
}

export function clusterCulturalSignals(signals, limit = 12) {
  const sorted = [...signals].filter((item) => item?.id && item?.name).sort((a, b) =>
    Number.isFinite(b.affinity) - Number.isFinite(a.affinity) ||
    (Number.isFinite(a.affinity) && Number.isFinite(b.affinity) ? b.affinity - a.affinity : 0));
  const clusters = [];
  for (const signal of sorted) {
    const cluster = clusters.find((item) => stronglyOverlappingCulture(item.primary, signal));
    if (cluster) cluster.members.push(signal);
    else clusters.push({ id: signal.id, name: signal.name, primary: signal, members: [signal] });
  }
  return { selected: clusters.slice(0, limit), all: clusters };
}

const QUERY_FILLER = new Set(["video", "videos", "youtube", "channel", "creator", "creators"]);
const queryWords = (value) => [...new Set(words(value).map(stem).filter((word) =>
  !QUERY_FILLER.has(word)))];
export function redundantCreatorQuery(a, b) {
  const left = queryWords(a); const right = queryWords(b);
  if (!left.length || !right.length) return a.toLowerCase().trim() === b.toLowerCase().trim();
  const shared = left.filter((word) => right.includes(word)).length;
  return shared / (left.length + right.length - shared) >= 0.75;
}

export function shouldExpandCreatorSearch({ usefulNew, repeated, nextPageToken, pages,
  maxPages = 2 }) {
  return Boolean(nextPageToken) && pages < maxPages && usefulNew > 0 && usefulNew >= repeated;
}

export function summarizeCreatorDiscovery(queries) {
  const seen = new Set();
  return queries.map((query) => {
    const channels = new Set(query.channelIds ?? []);
    const newChannels = [...channels].filter((id) => !seen.has(id));
    for (const id of channels) seen.add(id);
    return { query: query.q, family: query.family ?? "direct", signalIds: query.signalIds,
      clusterIds: query.clusterIds ?? [], pages: query.pages ?? 1,
      channels: channels.size, newChannels: newChannels.length,
      overlappingChannels: channels.size - newChannels.length,
      stopReason: query.stopReason ?? "complete" };
  });
}

export function keywordBaselineQueries(brandCategory, campaignMode) {
  const category = String(brandCategory ?? "").trim().replace(/[^a-z\d\s-]/gi, " ")
    .replace(/\s+/g, " ").slice(0, 60);
  if (!category) return [];
  return [
    `${category} independent creator`,
    campaignMode === "one_off" ? `${category} documentary creator` : `${category} lifestyle creator`,
    `${category} product review creator`,
  ];
}
