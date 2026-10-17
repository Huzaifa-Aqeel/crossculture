import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "crossculture-inspector", version: "0.1.0" });
const env = { ...process.env };
if (!env.QLOO_HOME) env.QLOO_HOME = "/tmp/crossculture-qloo";
if (env.QLOO_BASE_URL && new URL(env.QLOO_BASE_URL).origin === "https://hackathon.api.qloo.com") {
  env.QLOO_TRUSTED_BASE_URL ??= "https://hackathon.api.qloo.com";
}
const transport = new StdioClientTransport({
  command: "qloo",
  args: ["mcp"],
  env,
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const selected = tools.filter(({ name }) =>
    ["qloo_capabilities", "qloo_find_tags", "qloo_describe", "qloo_recommend", "qloo_rank",
      "qloo_entity_tags", "qloo_compare_audiences", "qloo_where_popular"].includes(name),
  );
  process.stdout.write(`${JSON.stringify(selected.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), null, 2)}\n`);
} finally {
  await client.close();
}
