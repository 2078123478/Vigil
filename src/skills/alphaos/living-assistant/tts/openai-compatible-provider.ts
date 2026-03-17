import type { TTSOptions, TTSProvider, TTSProviderConfig, TTSResult } from "./types";

const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";
const DEFAULT_FORMAT = "mp3";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeFormat(format: string): string {
  const lower = format.trim().toLowerCase();
  if (lower === "wav" || lower === "ogg") {
    return lower;
  }
  return "mp3";
}

function estimateDurationSeconds(audioBytes: number): number {
  return Number((audioBytes / 2_000).toFixed(2));
}

export class OpenAICompatibleTTSProvider implements TTSProvider {
  public readonly name = "openai-compatible";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultVoice: string;
  private readonly defaultFormat: string;

  constructor(config: TTSProviderConfig) {
    this.baseUrl = trimTrailingSlashes(config.baseUrl.trim());
    this.apiKey = config.apiKey.trim();
    this.model = config.model?.trim() || DEFAULT_MODEL;
    this.defaultVoice = config.defaultVoice?.trim() || DEFAULT_VOICE;
    this.defaultFormat = normalizeFormat(config.defaultFormat || DEFAULT_FORMAT);
  }

  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    const input = text.trim();
    if (!input) {
      throw new Error(`[${this.name}] text input cannot be empty`);
    }

    const voice = options.voice?.trim() || this.defaultVoice;
    const format = normalizeFormat(options.format || this.defaultFormat);
    const requestBody = {
      model: this.model,
      input,
      voice,
      response_format: format,
      ...(typeof options.speed === "number" ? { speed: options.speed } : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[${this.name}] request failed: ${message}`);
    }

    if (!response.ok) {
      const detail = await response
        .text()
        .then((value) => value.trim())
        .catch(() => "");
      const suffix = detail ? ` - ${detail}` : "";
      throw new Error(`[${this.name}] HTTP ${response.status} ${response.statusText}${suffix}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    return {
      audio,
      format,
      durationSeconds: estimateDurationSeconds(audio.byteLength),
      provider: this.name,
      generatedAt: new Date().toISOString(),
    };
  }
}
