import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleTTSProvider } from "../src/skills/alphaos/living-assistant/tts/openai-compatible-provider";
import { createTTSProvider } from "../src/skills/alphaos/living-assistant/tts/provider-factory";
import type { TTSProviderConfig } from "../src/skills/alphaos/living-assistant/tts/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("living assistant tts", () => {
  it("accepts an openai-compatible provider config", () => {
    const config = {
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "tts-1",
      defaultVoice: "alloy",
      defaultFormat: "mp3",
    } satisfies TTSProviderConfig;

    expect(config.type).toBe("openai-compatible");
    expect(config.baseUrl).toContain("/v1");
  });

  it("createTTSProvider returns provider with expected name", () => {
    const provider = createTTSProvider({
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });

    expect(provider).toBeInstanceOf(OpenAICompatibleTTSProvider);
    expect(provider.name).toBe("openai-compatible");
  });

  it("openai-compatible provider constructs the correct request", async () => {
    const audioBytes = Buffer.alloc(4_000, 1);
    const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(audioBytes, { status: 200 }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const provider = createTTSProvider({
      type: "openai-compatible",
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-demo",
      model: "tts-model",
      defaultVoice: "alloy",
      defaultFormat: "mp3",
    });

    const result = await provider.synthesize("Status update for you", {
      voice: "nova",
      speed: 1.15,
      format: "mp3",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = mockFetch.mock.calls[0];
    expect(String(requestUrl)).toBe("https://api.example.com/v1/audio/speech");
    expect(requestInit).toBeDefined();
    expect(requestInit?.method).toBe("POST");

    const headers = requestInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-demo");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      model: "tts-model",
      input: "Status update for you",
      voice: "nova",
      response_format: "mp3",
      speed: 1.15,
    });

    expect(result.audio.byteLength).toBe(audioBytes.byteLength);
    expect(result.format).toBe("mp3");
    expect(result.durationSeconds).toBe(2);
    expect(result.provider).toBe("openai-compatible");
  });

  it("provider surfaces HTTP errors with provider name and status", async () => {
    const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const provider = createTTSProvider({
      type: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "bad-key",
    });

    await expect(provider.synthesize("hello world")).rejects.toThrow(/openai-compatible/i);
    await expect(provider.synthesize("hello world")).rejects.toThrow(/401/);
  });
});
