import { afterEach, describe, expect, it, vi } from "vitest";
import { AliyunVoiceSender } from "../src/skills/alphaos/living-assistant/delivery/aliyun-voice-sender";
import { TelegramVoiceSender } from "../src/skills/alphaos/living-assistant/delivery/telegram-voice-sender";
import { TwilioCallSender } from "../src/skills/alphaos/living-assistant/delivery/twilio-call-sender";
import { VoiceDeliveryOrchestrator } from "../src/skills/alphaos/living-assistant/delivery/voice-orchestrator";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("voice delivery channels", () => {
  describe("TelegramVoiceSender", () => {
    it("constructs correct sendVoice multipart request", async () => {
      const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 101 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const sender = new TelegramVoiceSender({
        botToken: "bot-token",
        defaultChatId: "owner-chat-id",
      });

      const result = await sender.sendVoice(Buffer.from("ogg-audio"), {
        caption: "Brief ready",
        format: "ogg",
        duration: 8,
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe(101);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe("https://api.telegram.org/botbot-token/sendVoice");
      expect(init?.method).toBe("POST");

      const headers = init?.headers as Record<string, string>;
      const contentType = headers["Content-Type"] ?? headers["content-type"];
      expect(contentType).toContain("multipart/form-data; boundary=");

      const boundary = contentType.split("boundary=")[1];
      const body = init?.body as Uint8Array;
      const bodyText = Buffer.from(body).toString("utf8");

      expect(bodyText).toContain(`--${boundary}`);
      expect(bodyText).toContain('name="chat_id"');
      expect(bodyText).toContain("owner-chat-id");
      expect(bodyText).toContain('name="caption"');
      expect(bodyText).toContain("Brief ready");
      expect(bodyText).toContain('name="duration"');
      expect(bodyText).toContain("8");
      expect(bodyText).toContain('name="voice"; filename="brief.ogg"');
      expect(bodyText).toContain("Content-Type: audio/ogg");
    });

    it("constructs correct sendMessage JSON request", async () => {
      const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 202 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const sender = new TelegramVoiceSender({
        botToken: "bot-token",
        defaultChatId: "owner-chat-id",
      });

      const result = await sender.sendMessage("Heads up", {
        parseMode: "Markdown",
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe(202);

      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe("https://api.telegram.org/botbot-token/sendMessage");
      expect(init?.method).toBe("POST");

      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Type"] ?? headers["content-type"]).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({
        chat_id: "owner-chat-id",
        text: "Heads up",
        parse_mode: "Markdown",
      });
    });

    it("handles API errors gracefully", async () => {
      const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              description: "Bad Request: chat not found",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const sender = new TelegramVoiceSender({
        botToken: "bot-token",
        defaultChatId: "owner-chat-id",
      });

      const result = await sender.sendMessage("hello");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Bad Request");
    });
  });

  describe("TwilioCallSender", () => {
    it("constructs correct Twilio API request", async () => {
      const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(
            JSON.stringify({
              sid: "CA123",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const sender = new TwilioCallSender({
        accountSid: "AC111",
        authToken: "secret-token",
        fromNumber: "+12025550100",
        defaultToNumber: "+12025550200",
      });

      const result = await sender.callWithTts("Market alert", {
        language: "en-US",
        voice: "alice",
      });

      expect(result).toEqual({
        ok: true,
        callSid: "CA123",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC111/Calls.json");
      expect(init?.method).toBe("POST");

      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Type"] ?? headers["content-type"]).toBe("application/x-www-form-urlencoded");
      expect(headers.Authorization ?? headers.authorization).toBe(
        `Basic ${Buffer.from("AC111:secret-token", "utf8").toString("base64")}`,
      );

      const params = new URLSearchParams(String(init?.body));
      expect(params.get("To")).toBe("+12025550200");
      expect(params.get("From")).toBe("+12025550100");
      expect(params.get("Twiml")).toContain('<Say language="en-US" voice="alice">Market alert</Say>');
    });

    it("handles API errors gracefully", async () => {
      const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(
            JSON.stringify({
              message: "The 'To' number is not a valid phone number.",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const sender = new TwilioCallSender({
        accountSid: "AC111",
        authToken: "secret-token",
        fromNumber: "+12025550100",
        defaultToNumber: "+12025550200",
      });

      const result = await sender.callWithAudio("https://example.com/audio.mp3");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not a valid phone number");
    });
  });

  describe("AliyunVoiceSender", () => {
    it("constructs a signed request with required parameters", async () => {
      const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(
            JSON.stringify({
              Code: "OK",
              CallId: "call-id-1",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const sender = new AliyunVoiceSender({
        accessKeyId: "ak-id",
        accessKeySecret: "ak-secret",
        calledShowNumber: "0210000000",
        defaultCalledNumber: "13800000000",
        ttsCode: "TTS_0001",
      });

      const result = await sender.callWithTts({ content: "brief text" });
      expect(result.ok).toBe(true);
      expect(result.callId).toBe("call-id-1");

      const [url, init] = mockFetch.mock.calls[0];
      expect(init?.method).toBe("GET");
      expect(String(url)).toContain("https://dyvmsapi.aliyuncs.com/?");

      const parsed = new URL(String(url));
      const params = parsed.searchParams;
      expect(params.get("Signature")).toBeTruthy();
      expect(params.get("Action")).toBe("SingleCallByTts");
      expect(params.get("AccessKeyId")).toBe("ak-id");
      expect(params.get("CalledShowNumber")).toBe("0210000000");
      expect(params.get("CalledNumber")).toBe("13800000000");
      expect(params.get("TtsCode")).toBe("TTS_0001");
      expect(params.get("TtsParam")).toBe(JSON.stringify({ content: "brief text" }));
      expect(params.get("Format")).toBe("JSON");
      expect(params.get("SignatureMethod")).toBe("HMAC-SHA1");
      expect(params.get("SignatureVersion")).toBe("1.0");
      expect(params.get("Timestamp")).toBeTruthy();
      expect(params.get("Version")).toBe("2017-05-25");
    });

    it("handles API errors gracefully", async () => {
      const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(
            JSON.stringify({
              Code: "isv.INVALID_CALLED_NUMBER",
              Message: "Invalid called number",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const sender = new AliyunVoiceSender({
        accessKeyId: "ak-id",
        accessKeySecret: "ak-secret",
        calledShowNumber: "0210000000",
        defaultCalledNumber: "13800000000",
        ttsCode: "TTS_0001",
      });

      const result = await sender.callWithTts({ content: "brief text" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Invalid called number");
    });
  });

  describe("VoiceDeliveryOrchestrator", () => {
    it("text_nudge sends Telegram text only", async () => {
      const telegramTextSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendMessage")
        .mockResolvedValue({ ok: true, messageId: 1 });
      const telegramVoiceSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendVoice")
        .mockResolvedValue({ ok: true, messageId: 2 });
      const twilioSpy = vi.spyOn(TwilioCallSender.prototype, "callWithTts").mockResolvedValue({
        ok: true,
        callSid: "CA111",
      });
      const aliyunSpy = vi.spyOn(AliyunVoiceSender.prototype, "callWithTts").mockResolvedValue({
        ok: true,
        callId: "aliyun-1",
      });

      const orchestrator = new VoiceDeliveryOrchestrator({
        telegram: {
          botToken: "token",
          defaultChatId: "chat-id",
        },
        twilio: {
          accountSid: "AC111",
          authToken: "token",
          fromNumber: "+12025550100",
          defaultToNumber: "+12025550200",
        },
        aliyun: {
          accessKeyId: "ak-id",
          accessKeySecret: "ak-secret",
          calledShowNumber: "0210000000",
          defaultCalledNumber: "13800000000",
          ttsCode: "TTS_0001",
        },
      });

      const results = await orchestrator.deliver("text_nudge", {
        text: "ping",
      });

      expect(telegramTextSpy).toHaveBeenCalledTimes(1);
      expect(telegramVoiceSpy).not.toHaveBeenCalled();
      expect(twilioSpy).not.toHaveBeenCalled();
      expect(aliyunSpy).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        channel: "telegram",
        ok: true,
        detail: { ok: true, messageId: 1 },
      });
    });

    it("voice_brief sends Telegram voice", async () => {
      const audio = Buffer.from("voice-data");
      const telegramVoiceSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendVoice")
        .mockResolvedValue({ ok: true, messageId: 3 });
      const telegramTextSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendMessage")
        .mockResolvedValue({ ok: true, messageId: 4 });

      const orchestrator = new VoiceDeliveryOrchestrator({
        telegram: {
          botToken: "token",
          defaultChatId: "chat-id",
        },
      });

      const results = await orchestrator.deliver("voice_brief", {
        text: "voice brief",
        audio,
        audioFormat: "ogg",
      });

      expect(telegramVoiceSpy).toHaveBeenCalledTimes(1);
      expect(telegramVoiceSpy).toHaveBeenCalledWith(audio, {
        caption: "voice brief",
        format: "ogg",
      });
      expect(telegramTextSpy).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].channel).toBe("telegram");
      expect(results[0].ok).toBe(true);
    });

    it("strong_interrupt sends Telegram voice and call when configured", async () => {
      const telegramVoiceSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendVoice")
        .mockResolvedValue({ ok: true, messageId: 5 });
      const twilioSpy = vi.spyOn(TwilioCallSender.prototype, "callWithTts").mockResolvedValue({
        ok: true,
        callSid: "CA222",
      });

      const orchestrator = new VoiceDeliveryOrchestrator({
        telegram: {
          botToken: "token",
          defaultChatId: "chat-id",
        },
        twilio: {
          accountSid: "AC111",
          authToken: "token",
          fromNumber: "+12025550100",
          defaultToNumber: "+12025550200",
        },
      });

      const results = await orchestrator.deliver("strong_interrupt", {
        text: "interrupt",
        audio: Buffer.from("voice-data"),
      });

      expect(telegramVoiceSpy).toHaveBeenCalledTimes(1);
      expect(twilioSpy).toHaveBeenCalledTimes(1);
      expect(results.map((item) => item.channel)).toEqual(["telegram", "twilio"]);
      expect(results.every((item) => item.ok)).toBe(true);
    });

    it("call_escalation sends call first and Telegram voice backup", async () => {
      const twilioSpy = vi.spyOn(TwilioCallSender.prototype, "callWithTts").mockResolvedValue({
        ok: true,
        callSid: "CA333",
      });
      const telegramVoiceSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendVoice")
        .mockResolvedValue({ ok: true, messageId: 6 });

      const orchestrator = new VoiceDeliveryOrchestrator({
        telegram: {
          botToken: "token",
          defaultChatId: "chat-id",
        },
        twilio: {
          accountSid: "AC111",
          authToken: "token",
          fromNumber: "+12025550100",
          defaultToNumber: "+12025550200",
        },
      });

      const results = await orchestrator.deliver("call_escalation", {
        text: "escalation",
        audio: Buffer.from("voice-data"),
        audioFormat: "ogg",
      });

      expect(twilioSpy).toHaveBeenCalledTimes(1);
      expect(telegramVoiceSpy).toHaveBeenCalledTimes(1);
      expect(twilioSpy.mock.invocationCallOrder[0]).toBeLessThan(telegramVoiceSpy.mock.invocationCallOrder[0]);
      expect(results.map((item) => item.channel)).toEqual(["twilio", "telegram"]);
    });

    it("prefers Twilio callWithAudio when synthesized audioUrl exists", async () => {
      const twilioAudioSpy = vi.spyOn(TwilioCallSender.prototype, "callWithAudio").mockResolvedValue({
        ok: true,
        callSid: "CA444",
      });
      const twilioTtsSpy = vi.spyOn(TwilioCallSender.prototype, "callWithTts").mockResolvedValue({
        ok: true,
        callSid: "CA445",
      });
      const telegramVoiceSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendVoice")
        .mockResolvedValue({ ok: true, messageId: 16 });
      const telegramTextSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendMessage")
        .mockResolvedValue({ ok: true, messageId: 17 });

      const orchestrator = new VoiceDeliveryOrchestrator({
        telegram: {
          botToken: "token",
          defaultChatId: "chat-id",
        },
        twilio: {
          accountSid: "AC111",
          authToken: "token",
          fromNumber: "+12025550100",
          defaultToNumber: "+12025550200",
        },
      });

      const results = await orchestrator.deliver("call_escalation", {
        text: "escalation",
        audioUrl: "https://cdn.example.com/brief.wav",
      });

      expect(twilioAudioSpy).toHaveBeenCalledTimes(1);
      expect(twilioAudioSpy).toHaveBeenCalledWith("https://cdn.example.com/brief.wav");
      expect(twilioTtsSpy).not.toHaveBeenCalled();
      expect(telegramVoiceSpy).not.toHaveBeenCalled();
      expect(telegramTextSpy).toHaveBeenCalledTimes(1);
      expect(twilioAudioSpy.mock.invocationCallOrder[0]).toBeLessThan(telegramTextSpy.mock.invocationCallOrder[0]);
      expect(results.map((item) => item.channel)).toEqual(["twilio", "telegram"]);
    });

    it("demoMode returns successful results without sending", async () => {
      const telegramVoiceSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendVoice")
        .mockResolvedValue({ ok: true, messageId: 7 });
      const telegramTextSpy = vi
        .spyOn(TelegramVoiceSender.prototype, "sendMessage")
        .mockResolvedValue({ ok: true, messageId: 8 });
      const twilioSpy = vi.spyOn(TwilioCallSender.prototype, "callWithTts").mockResolvedValue({
        ok: true,
        callSid: "CA444",
      });
      const aliyunSpy = vi.spyOn(AliyunVoiceSender.prototype, "callWithTts").mockResolvedValue({
        ok: true,
        callId: "aliyun-2",
      });

      const orchestrator = new VoiceDeliveryOrchestrator({
        telegram: {
          botToken: "token",
          defaultChatId: "chat-id",
        },
        twilio: {
          accountSid: "AC111",
          authToken: "token",
          fromNumber: "+12025550100",
          defaultToNumber: "+12025550200",
        },
        aliyun: {
          accessKeyId: "ak-id",
          accessKeySecret: "ak-secret",
          calledShowNumber: "0210000000",
          defaultCalledNumber: "13800000000",
          ttsCode: "TTS_0001",
        },
      });

      const results = await orchestrator.deliver(
        "call_escalation",
        {
          text: "demo escalation",
          audio: Buffer.from("voice-data"),
        },
        { demoMode: true },
      );

      expect(telegramVoiceSpy).not.toHaveBeenCalled();
      expect(telegramTextSpy).not.toHaveBeenCalled();
      expect(twilioSpy).not.toHaveBeenCalled();
      expect(aliyunSpy).not.toHaveBeenCalled();
      expect(results.map((item) => item.channel)).toEqual(["twilio", "aliyun", "telegram"]);
      expect(results.every((item) => item.ok)).toBe(true);
    });
  });
});
