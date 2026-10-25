import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(apiDir, "dist");
const output = join(outputDir, "crossculture-lambda.zip");

if (!existsSync(join(apiDir, "node_modules", "@qloo", "qloo-harness", "dist", "bin.js"))) {
  throw new Error("Install API dependencies with npm ci before packaging Lambda.");
}
mkdirSync(outputDir, { recursive: true });
rmSync(output, { force: true });
const zipped = spawnSync("zip", ["-q", "-r", output, "src", "node_modules", "package.json"], {
  cwd: apiDir, stdio: "inherit",
});
if (zipped.error) throw zipped.error;
if (zipped.status !== 0) throw new Error(`zip exited with status ${zipped.status}.`);
const bytes = statSync(output).size;
if (bytes > 50 * 1024 * 1024) {
  throw new Error(`Lambda package is ${(bytes / 1024 / 1024).toFixed(1)} MiB; direct upload allows at most 50 MiB.`);
}
process.stdout.write(`Lambda package: ${output} (${(bytes / 1024 / 1024).toFixed(1)} MiB)\n`);
