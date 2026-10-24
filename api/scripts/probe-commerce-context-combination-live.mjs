// Bounded read-only probe. These phrases are sourced from the merchants'
// named product pages. They are not production search defaults.
import { qlooCall, closeQloo } from "../src/qloo.mjs";

const phrases = process.argv[2] === "fishwife"
  ? ["Sichuan Cuisine", "Chili Crisp"]
  : ["Lunar New Year", "Year of the Snake"];
const validTag = /^urn:tag:[a-z_]+:qloo:[a-z0-9_]+$/;
const tags = [];
try {
  for (const phrase of phrases) {
    const result = await qlooCall("qloo_find_tags", { query: phrase, limit: 5 });
    const exact = result?.results?.find((item) => validTag.test(item.id ?? "") &&
      String(item.name ?? "").toLowerCase() === phrase.toLowerCase());
    console.log(JSON.stringify({ stage: "tag_resolution", phrase, status: result.status,
      exactTag: exact ? { id: exact.id, name: exact.name } : null }));
    if (!exact) process.exitCode = 2;
    else tags.push(exact.id);
  }
  if (tags.length === 2) {
    for (const [label, signalTags] of [
      ["first", [tags[0]]], ["second", [tags[1]]],
      ["combined", tags], ["intersection", tags],
    ]) {
      const result = await qlooCall("qloo_recommend", { target_type: "brand",
        signal_tags: signalTags, ...(label === "intersection" ?
          { signal_tags_operator: "intersection" } : {}), limit: 20, explain: true });
      console.log(JSON.stringify({ stage: "brand_recommendation", label,
        status: result.status, count: result.results?.length ?? 0,
        distinctAffinities: [...new Set((result.results ?? []).map((item) => item.affinity))],
        explainedCount: (result.results ?? []).filter((item) =>
          item.explanation || item.explainability).length,
        leads: (result.results ?? []).map((item) => ({
          id: item.entity_id, name: item.name,
        })) }));
    }
    // Inspect the provider's own returned tag fields before spending calls on
    // identity, merchant, and product research for any suggested business.
    const url = new URL("https://hackathon.api.qloo.com/v2/insights");
    url.searchParams.set("filter.type", "urn:entity:brand");
    url.searchParams.set("signal.interests.tags", tags.join(","));
    url.searchParams.set("feature.explainability", "true");
    url.searchParams.set("take", "20");
    const response = await fetch(url, { headers: { "X-Api-Key": process.env.QLOO_API_KEY } });
    const body = await response.json();
    const matched = (body.results?.entities ?? []).map((item) => ({
      id: item.entity_id, name: item.name,
      matchedTags: (item.tags ?? []).map((tag) => tag.id ?? tag.tag_id ?? tag)
        .filter((id) => tags.includes(id)),
    })).filter((item) => item.matchedTags.length);
    console.log(JSON.stringify({ stage: "candidate_tag_audit", http: response.status,
      warnings: body.warnings ?? [], matched }));
    if (!response.ok || !matched.length) process.exitCode = 2;
  }
} catch (error) {
  console.log(JSON.stringify({ stage: "probe_failed", reason: error?.code ?? error?.message }));
  process.exitCode = 2;
} finally { await closeQloo().catch(() => {}); }
