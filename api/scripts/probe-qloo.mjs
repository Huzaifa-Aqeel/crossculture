import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "crossculture-probe", version: "0.1.0" });
const transport = new StdioClientTransport({ command: "qloo", args: ["mcp"], env: process.env });
const summarize = (name, result) => {
  const payload = result.structuredContent ?? {};
  const items = Array.isArray(payload.results) ? payload.results : [];
  return {
    operation: name,
    status: payload.status,
    summary: payload.summary,
    result_count: payload.result_count,
    first_results: items.slice(0, 3),
    error: payload.error,
  };
};

try {
  await client.connect(transport);
  const described = await client.callTool({ name: "qloo_describe", arguments: { entity: "Patagonia", type: "brand" } });
  process.stdout.write(`${JSON.stringify(summarize("qloo_describe", described), null, 2)}\n`);
  const entityId = described.structuredContent?.results?.[0]?.entity_id;
  if (entityId) {
    const recommended = await client.callTool({
      name: "qloo_recommend",
      arguments: { target_type: "brand", signals: [entityId], limit: 20, explain: true },
    });
    const payload = recommended.structuredContent ?? {};
    process.stdout.write(`${JSON.stringify({ operation: "qloo_recommend", status: payload.status, result_count: payload.result_count, names: payload.results?.map((result) => result.name) ?? [], error: payload.error }, null, 2)}\n`);
  }
} finally {
  await client.close();
}
