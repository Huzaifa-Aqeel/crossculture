import { LambdaClient, GetAccountSettingsCommand, GetFunctionCommand, GetFunctionConcurrencyCommand,
  PutFunctionConcurrencyCommand } from "@aws-sdk/client-lambda";

const functionName = process.env.RESEARCH_WORKER_FUNCTION_NAME;
if (!functionName) throw new Error("Set RESEARCH_WORKER_FUNCTION_NAME to the deployed research Lambda name.");

const lambda = new LambdaClient({});
await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
const current = await lambda.send(new GetFunctionConcurrencyCommand({ FunctionName: functionName }));
if (current.ReservedConcurrentExecutions === 2) {
  process.stdout.write(`Research worker ${functionName}: reserved concurrency 2 verified.\n`);
  process.exit(0);
}
const account = await lambda.send(new GetAccountSettingsCommand({}));
if ((account.AccountLimit?.UnreservedConcurrentExecutions ?? 0) < 12) {
  process.stdout.write(`Research worker ${functionName}: account concurrency quota leaves fewer than 12 unreserved executions; using shared concurrency until the quota is raised.\n`);
  process.exit(0);
}
await lambda.send(new PutFunctionConcurrencyCommand({
  FunctionName: functionName,
  ReservedConcurrentExecutions: 2,
}));
const configured = await lambda.send(new GetFunctionConcurrencyCommand({ FunctionName: functionName }));
if (configured.ReservedConcurrentExecutions !== 2)
  throw new Error(`Expected worker concurrency 2, got ${configured.ReservedConcurrentExecutions ?? "unset"}.`);
process.stdout.write(`Research worker ${functionName}: reserved concurrency 2 verified.\n`);
