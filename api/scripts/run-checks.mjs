// Runs the focused Brand × Brand checks in sequence and prints one summary.
// `offline` checks use fixtures only. `local` checks also need the local
// Supabase stack and its status file; neither suite calls a live provider.
import { spawn } from "node:child_process";

const suites = {
  offline: ["check-brand-commerce", "check-commerce-reliability", "check-commerce-product-discovery",
    "check-commerce-product-discovery-adaptive", "check-commerce-context", "check-commerce-audience",
    "check-commerce-mechanism-benchmark", "check-new-run-objectives", "check-web-research",
    "check-research-dispatch", "check-research-memory"],
  local: ["check-qloo-cache", "check-tavily-cache-budget", "check-commerce-run-local",
    "check-local-api-auth"],
};
const requested = process.argv.slice(2);
const names = (requested.length ? requested : ["offline"]).flatMap((suite) => {
  if (!suites[suite]) throw new Error(`Unknown suite ${suite}. Use: ${Object.keys(suites).join(", ")}.`);
  return suites[suite].map((name) => ({ name, suite }));
});
const results = [];
for (const { name, suite } of names) {
  const started = Date.now();
  const output = [];
  const code = await new Promise((resolve) => {
    // Offline fixtures never load provider credentials.
    const args = suite === "local" ? ["--env-file-if-exists=../.env.local", `scripts/${name}.mjs`]
      : [`scripts/${name}.mjs`];
    const env = { ...process.env };
    if (suite !== "local") for (const key of Object.keys(env))
      if (/^(QLOO|TAVILY|SHOPIFY|AWS|BEDROCK|LLM|GROQ)_/.test(key) || key === "DATABASE_URL") delete env[key];
    const child = spawn(process.execPath, args, { cwd: new URL("../", import.meta.url).pathname,
      env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("close", resolve);
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  results.push({ name, code });
  process.stdout.write(`${code === 0 ? "pass" : "FAIL"}  ${name} (${seconds}s)\n`);
  if (code !== 0) process.stdout.write(Buffer.concat(output).toString("utf8").split("\n").slice(-25).join("\n") + "\n");
}
const failed = results.filter((item) => item.code !== 0);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
process.exitCode = failed.length ? 1 : 0;
