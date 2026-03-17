import { DashScopeQwenTTSProvider } from "./dashscope-qwen-provider";
import { OpenAICompatibleTTSProvider } from "./openai-compatible-provider";
import type { TTSProvider, TTSProviderConfig } from "./types";

export function createTTSProvider(config: TTSProviderConfig): TTSProvider {
  if (config.type === "openai-compatible") {
    return new OpenAICompatibleTTSProvider(config);
  }
  if (config.type === "dashscope-qwen") {
    return new DashScopeQwenTTSProvider(config);
  }
  throw new Error(`Unsupported TTS provider type: ${(config as { type?: string }).type ?? "unknown"}`);
}
