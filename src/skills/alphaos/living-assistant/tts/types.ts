export interface TTSOptions {
  voice?: string;
  speed?: number;
  language?: "zh" | "en";
  format?: "mp3" | "wav" | "ogg";
  instructions?: string;
  optimizeInstructions?: boolean;
}

export interface TTSResult {
  audio?: Buffer;
  audioUrl?: string;
  format: string;
  durationSeconds: number;
  provider: string;
  generatedAt: string;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
}

export interface OpenAICompatibleTTSProviderConfig {
  type: "openai-compatible";
  baseUrl: string; // e.g. 'https://api.siliconflow.cn/v1' or 'https://api.openai.com/v1'
  apiKey: string;
  model?: string; // e.g. 'FunAudioLLM/CosyVoice2-0.5B' or 'tts-1'
  defaultVoice?: string; // e.g. 'alloy'
  defaultFormat?: string; // e.g. 'mp3'
}

export interface DashScopeQwenTTSProviderConfig {
  type: "dashscope-qwen";
  apiKey: string;
  endpoint?: string; // e.g. 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
  model?: string; // e.g. 'qwen3-tts-flash' or 'qwen3-tts-instruct-flash'
  defaultVoice?: string; // e.g. 'Cherry'
  defaultFormat?: string; // metadata hint for downstream handlers, e.g. 'wav'
  languageType?: string; // e.g. 'Auto', 'Chinese', 'English'
  defaultInstructions?: string; // only effective on instruct-capable models
  optimizeInstructions?: boolean;
}

export type TTSProviderConfig = OpenAICompatibleTTSProviderConfig | DashScopeQwenTTSProviderConfig;
