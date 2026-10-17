import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "crossculture-tags-probe", version: "0.1.0" });
const transport = new StdioClientTransport({ command: "qloo", args: ["mcp"], env: process.env });
try {
  await client.connect(transport);
  const seed = await client.callTool({ name: "qloo_describe", arguments: { entity: "Patagonia", type: "brand" } });
  const partner = await client.callTool({ name: "qloo_describe", arguments: { entity: "Hipcamp", type: "brand" } });
  const ids = [seed.structuredContent?.results?.[0]?.entity_id, partner.structuredContent?.results?.[0]?.entity_id].filter(Boolean);
  if (ids.length !== 2) throw new Error("Could not resolve both brands");
  const result = await client.callTool({ name: "qloo_entity_tags", arguments: { entities: ids, entity_type: "brand", limit: 6 } });
  const payload = result.structuredContent ?? {};
  process.stdout.write(`${JSON.stringify({ status: payload.status, summary: payload.summary, result_count: payload.result_count, results: payload.results?.slice(0, 6), error: payload.error }, null, 2)}\n`);
} finally { await client.close(); }
