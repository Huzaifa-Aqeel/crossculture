import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const EXPECTED_HACKATHON_URL = "https://hackathon.api.qloo.com";
let client;
let connection;

function qlooEnvironment() {
  const env = { ...process.env };
  if (!env.QLOO_HOME) env.QLOO_HOME = "/tmp/crossculture-qloo";
  if (env.QLOO_BASE_URL) {
    const origin = new URL(env.QLOO_BASE_URL).origin;
    if (origin === EXPECTED_HACKATHON_URL && !env.QLOO_TRUSTED_BASE_URL) {
      env.QLOO_TRUSTED_BASE_URL = EXPECTED_HACKATHON_URL;
    }
  }
  return env;
}

async function connect() {
  if (client) return client;
  if (connection) return connection;
  connection = (async () => {
    const next = new Client({ name: "crossculture-api", version: "0.1.0" });
    const command = fileURLToPath(new URL("../node_modules/@qloo/qloo-harness/dist/bin.js", import.meta.url));
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [command, "mcp"], env: qlooEnvironment() });
    await next.connect(transport);
    client = next;
    return next;
  })();
  try {
    return await connection;
  } finally {
    connection = undefined;
  }
}

export async function qlooCall(name, args) {
  const connected = await connect();
  let response;
  try {
    response = await connected.callTool({ name, arguments: args });
  } catch (error) {
    client = undefined;
    throw error;
  }
  const envelope = response.structuredContent;
  if (!envelope || typeof envelope.status !== "string") throw new Error("Unexpected cultural research response");
  return envelope;
}

export async function closeQloo() {
  const current = client;
  client = undefined;
  if (current) await current.close();
}

// Tag insights narrowed to tag types. The harness's entity_tags workflow
// returns only a brand's 20 most affine tags, which are dominated by
// near-universal place, music and media tags; its CLI sends this same
// /v2/insights request but prints entity results only. Same gateway and
// credential as the harness.
export async function qlooTypedTags(entityId, tagTypes, take = 30) {
  const base = process.env.QLOO_BASE_URL;
  const key = process.env.QLOO_API_KEY;
  if (!base || !key) throw new Error("Cultural research is not configured.");
  const url = new URL("/v2/insights", base);
  url.search = new URLSearchParams({ "filter.type": "urn:tag", "signal.interests.entities": entityId,
    "filter.tag.types": tagTypes.join(","), take: String(take) }).toString();
  const response = await fetch(url, { headers: { "X-Api-Key": key, accept: "application/json" },
    signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return { status: response.status === 429 ? "rate_limited" : "provider_error", results: [] };
  const body = await response.json();
  return { status: "ok", results: (body?.results?.tags ?? []).map((tag) => ({ id: tag.tag_id ?? tag.id,
    name: tag.name, type: tag.type ?? null, affinity: tag.query?.affinity ?? tag.affinity ?? null,
    popularity: tag.popularity ?? null })) };
}
