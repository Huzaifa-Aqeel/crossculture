import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { invokeResearchWorker } from "../src/research-dispatch.mjs";

const runId = randomUUID();
process.env.RESEARCH_WORKER_FUNCTION_NAME = "test-research-worker";
let sent;
const client = { send: async (command) => {
  sent = command.input;
  return { StatusCode: 202 };
} };
await invokeResearchWorker(runId, client);
assert.equal(sent.FunctionName, "test-research-worker");
assert.equal(sent.InvocationType, "Event");
assert.deepEqual(JSON.parse(Buffer.from(sent.Payload).toString("utf8")), { runId });
await assert.rejects(invokeResearchWorker(runId, { send: async () => ({ StatusCode: 500 }) }),
  /returned 500/);
