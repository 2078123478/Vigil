import type { ChatCompletionOptions, Message } from "./types";

const DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_MODEL = "qwen-plus";
const DEFAULT_TIMEOUT_MS = 30_000;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(timeoutMs);
}

function readFirstMessageContent(payload: JsonRecord | undefined): string | null {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  const firstChoiceRecord = asRecord(firstChoice);
  const message = asRecord(firstChoiceRecord?.message);

  const direct = optionalText(message?.content);
  if (direct) {
    return direct;
  }

  const contentParts = Array.isArray(message?.content) ? message?.content : [];
  for (const item of contentParts) {
    const record = asRecord(item);
    const text = optionalText(record?.text);
    if (text) {
      return text;
    }
  }

  return null;
}

export function isLLMEnabled(explicit?: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  const parsed = parseBoolean(env.LLM_ENABLED);
  return parsed ?? true;
}

export function resolveLLMApiKey(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = optionalText(explicit);
  if (direct) {
    return direct;
  }

  return optionalText(env.TTS_API_KEY) ?? optionalText(env.LLM_API_KEY);
}

export function resolveLLMModel(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  return optionalText(explicit) ?? optionalText(env.LLM_MODEL) ?? DEFAULT_MODEL;
}

export async function chatCompletion(messages: Message[], options: ChatCompletionOptions = {}): Promise<string | null> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const apiKey = resolveLLMApiKey(options.apiKey);
  if (!apiKey) {
    return null;
  }

  const model = resolveLLMModel(options.model);
  const endpoint = normalizeEndpoint(optionalText(options.endpoint) ?? DEFAULT_ENDPOINT);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const requestBody: JsonRecord = {
    model,
    messages,
    ...(typeof options.temperature === "number" ? { temperature: options.temperature } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    return null;
  }

  clearTimeout(timeout);

  const rawBody = await response
    .text()
    .then((value) => value.trim())
    .catch(() => "");

  if (!response.ok || !rawBody) {
    return null;
  }

  let payload: JsonRecord | undefined;
  try {
    payload = JSON.parse(rawBody) as JsonRecord;
  } catch {
    return null;
  }

  return readFirstMessageContent(payload);
}
