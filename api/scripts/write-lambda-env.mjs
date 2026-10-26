import { writeFileSync } from "node:fs";
import { join } from "node:path";

const outputDir = process.argv[2];
if (!outputDir) throw new Error("Pass a temporary output directory.");

const required = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "QLOO_API_KEY",
  "TAVILY_API_KEY", "SHOPIFY_UCP_PROFILE_URL"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for AWS deployment.`);
}
if (!process.env.DATABASE_URL.startsWith("postgres")) throw new Error("DATABASE_URL must be PostgreSQL.");
for (const name of ["SUPABASE_URL", "SHOPIFY_UCP_PROFILE_URL"]) {
  const url = new URL(process.env[name]);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`${name} must use a hosted HTTPS address.`);
  }
}
if (process.env.LLM_PROVIDER === "bedrock" && !process.env.BEDROCK_MODEL_ID) {
  throw new Error("BEDROCK_MODEL_ID is required when using Bedrock.");
}

const names = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "QLOO_API_KEY",
  "QLOO_BASE_URL", "TAVILY_API_KEY", "TAVILY_API_KEY_2", "SHOPIFY_UCP_PROFILE_URL",
  "LLM_PROVIDER", "LLM_FALLBACK_PROVIDER", "BEDROCK_MODEL_ID", "GROQ_API_BASE",
  "GROQ_API_KEY", "GROQ_MODEL", "COMMERCE_CONTEXT_DISCOVERY_ENABLED", "REVIEWER_EMAILS"];
const variables = Object.fromEntries(names.filter((name) => process.env[name])
  .map((name) => [name, process.env[name]]));
variables.COMMERCE_CONTEXT_DISCOVERY_ENABLED ??= "0";

const workerName = "crossculture-research-worker";
for (const [fileName, values] of [
  ["worker-env.json", variables],
  ["api-env.json", { ...variables, RESEARCH_WORKER_FUNCTION_NAME: workerName }],
]) {
  writeFileSync(join(outputDir, fileName), JSON.stringify({ Variables: values }), { mode: 0o600 });
}
process.stdout.write("Wrote temporary Lambda environment files.\n");
