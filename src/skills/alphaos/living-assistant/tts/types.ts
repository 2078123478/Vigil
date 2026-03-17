export interface TTSOptions {
  voice?: string;
  speed?: number;
  language?: "zh" | "en";
  format?: "mp3" | "wav" | "ogg";
}

export interface TTSResult {
  audio: Buffer;
  format: string;
  durationSeconds: number;
  provider: string;
  generatedAt: string;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
}

export interface TTSProviderConfig {
  type: "openai-compatible";
  baseUrl: string; // e.g. 'https://api.siliconflow.cn/v1' or 'https://api.openai.com/v1'
  apiKey: string;
  model?: string; // e.g. 'FunAudioLLM/CosyVoice2-0.5B' or 'tts-1'
  defaultVoice?: string; // e.g. 'alloy'
  defaultFormat?: string; // e.g. 'mp3'
}
