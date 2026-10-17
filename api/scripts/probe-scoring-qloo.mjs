// Manual, bounded scoring-contract probe. Never run from tests, workers, or demo traffic.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (process.env.RUN_SCORING_QLOO_PROBE !== "1") throw new Error("Manual probe flag required.");
const client = new Client({ name: "crossculture-scoring-contract-probe", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: "qloo", args: ["mcp"], env: process.env }));
try {
  const described = (await client.callTool({ name: "qloo_describe", arguments: { entity: "Patagonia", type: "brand" } })).structuredContent;
  const seed = described?.results?.find((item) => item?.name === "Patagonia") ?? described?.results?.[0];
  process.stdout.write(`${JSON.stringify({ operation: "describe", status: described?.status,
    resultCount: described?.result_count, seedName: seed?.name,
    seedIdPresent: Boolean(seed?.entity_id), seedKeys: seed ? Object.keys(seed) : [] })}\n`);
  if (described?.status !== "ok" || !seed?.entity_id) throw new Error("Seed brand could not be resolved.");
  const recommended = (await client.callTool({ name: "qloo_recommend", arguments: {
    target_type: "brand", signals: [seed.entity_id], limit: 3, explain: true,
  } })).structuredContent;
  const recommendedOptions = (recommended?.results ?? []).filter((item) => item?.entity_id && item.entity_id !== seed.entity_id).slice(0, 2);
  process.stdout.write(`${JSON.stringify({ operation: "recommend", status: recommended?.status,
    resultCount: recommended?.result_count, names: recommendedOptions.map((item) => item.name),
    resultKeys: recommendedOptions[0] ? Object.keys(recommendedOptions[0]) : [] })}\n`);
  if (recommendedOptions.length < 2) throw new Error("Too few resolved brand options for the rank probe.");
  const ranked = (await client.callTool({ name: "qloo_rank", arguments: {
    options: recommendedOptions.map((item) => item.entity_id), option_type: "brand", signals: [seed.entity_id],
  } })).structuredContent;
  process.stdout.write(`${JSON.stringify({ operation: "rank", status: ranked?.status,
    summary: ranked?.summary, resultCount: ranked?.result_count,
    topLevelKeys: ranked ? Object.keys(ranked) : [],
    resolutionKeys: ranked?.resolution ? Object.keys(ranked.resolution) : [],
    results: (ranked?.results ?? []).slice(0, 2).map((item) => ({
      name: item.name, keys: Object.keys(item), affinity: item.affinity,
      score: item.score, rank: item.rank, explanationKeys: item.explanation ? Object.keys(item.explanation) : [],
    })), error: ranked?.error ? { code: ranked.error.code, retryable: ranked.error.retryable } : null })}\n`);
} finally {
  await client.close();
}
