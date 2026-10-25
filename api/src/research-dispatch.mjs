import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

let lambda;

export async function invokeResearchWorker(runId, client = lambda ??= new LambdaClient({})) {
  const functionName = process.env.RESEARCH_WORKER_FUNCTION_NAME;
  if (!functionName) throw new Error("Research worker Lambda is not configured.");
  const result = await client.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify({ runId })),
  }));
  if (result.StatusCode !== 202) throw new Error(`Research worker invoke returned ${result.StatusCode ?? "no status"}.`);
}
