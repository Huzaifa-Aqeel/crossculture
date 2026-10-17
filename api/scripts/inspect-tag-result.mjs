import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "crossculture-tag-inspection", version: "0.1.0" });
try {
  await client.connect(new StdioClientTransport({ command: "qloo", args: ["mcp"], env: process.env }));
  const response = await client.callTool({ name: "qloo_find_tags", arguments: { query: "smartphones", limit: 3 } });
  const data = response.structuredContent ?? {};
  process.stdout.write(JSON.stringify({ status: data.status, results: data.results?.slice(0, 3), summary: data.summary }, null, 2) + "\n");
} finally { await client.close(); }
