import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
    const transport = new StdioClientTransport({ command: "qloo", args: ["mcp"], env: qlooEnvironment() });
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
