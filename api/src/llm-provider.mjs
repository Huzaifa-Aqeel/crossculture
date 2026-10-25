import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const DEFAULT_BEDROCK_MODEL = "qwen.qwen3-next-80b-a3b";
let client;
let clientRegion;

export function useBedrock() {
  return process.env.LLM_PROVIDER === "bedrock";
}

export function openAiConfig({ allowFallback = false } = {}) {
  if (allowFallback && process.env.LLM_FALLBACK_PROVIDER !== "openai") return null;
  const base = process.env.LLM_API_URL || process.env.GROQ_API_BASE;
  const key = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  // GROQ_MODEL is the configured name; GROQ_COLOR_MODEL is kept for older setups.
  const model = process.env.LLM_MODEL || process.env.GROQ_MODEL || process.env.GROQ_COLOR_MODEL;
  return base && key && model ? { endpoint: `${base.replace(/\/$/, "")}/chat/completions`, key, model } : null;
}

// The primary model's name, recorded with research verdicts for later review.
export function configuredModelName() {
  return useBedrock() ? process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL : openAiConfig()?.model ?? null;
}

export function isBedrockThrottle(error) {
  return ["ThrottlingException", "ServiceQuotaExceededException", "TooManyRequestsException"]
    .includes(error?.name) || error?.$metadata?.httpStatusCode === 429;
}

export async function bedrockText({ system, user, maxTokens, temperature = 0, jsonSchema, sendFn }) {
  const region = process.env.AWS_REGION || "us-east-1";
  const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL;
  if (!sendFn && (!client || clientRegion !== region)) {
    // Adaptive retries absorb short throttling bursts before a call is treated
    // as unavailable (and the configured fallback provider is tried).
    client = new BedrockRuntimeClient({ region, maxAttempts: 4, retryMode: "adaptive" });
    clientRegion = region;
  }
  const command = new ConverseCommand({
    modelId,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { maxTokens, temperature },
    ...(jsonSchema && modelId === "qwen.qwen3-next-80b-a3b" ? { outputConfig: {
      textFormat: { type: "json_schema", structure: { jsonSchema: {
        name: "crossculture_result", schema: JSON.stringify(jsonSchema),
      } } },
    } } : {}),
  });
  const response = await (sendFn ?? ((input) => client.send(input)))(command);
  const content = response?.output?.message?.content?.filter((part) => typeof part.text === "string")
    .map((part) => part.text).join("");
  if (!content) throw new Error("LLM returned an invalid response.");
  return content;
}
