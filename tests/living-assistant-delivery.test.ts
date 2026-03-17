import { describe, expect, it } from "vitest";
import type { AttentionLevel, ContactDecision } from "../src/skills/alphaos/living-assistant/contact-policy";
import type { TTSResult } from "../src/skills/alphaos/living-assistant/tts";
import type { VoiceBrief } from "../src/skills/alphaos/living-assistant/voice-brief";
import { formatTelegramDelivery } from "../src/skills/alphaos/living-assistant/delivery/telegram-adapter";
import { formatWebhookDelivery } from "../src/skills/alphaos/living-assistant/delivery/webhook-adapter";

function buildDecision(attentionLevel: AttentionLevel): ContactDecision {
  return {
    shouldContact: attentionLevel !== "silent" && attentionLevel !== "digest",
    attentionLevel,
    channels:
      attentionLevel === "text_nudge"
        ? ["telegram"]
        : attentionLevel === "voice_brief"
          ? ["telegram", "voice"]
          : attentionLevel === "strong_interrupt"
            ? ["telegram", "voice", "webhook"]
            : attentionLevel === "call_escalation"
              ? ["telegram", "voice", "webhook", "discord"]
              : [],
    reason: `Decision for ${attentionLevel}`,
    suggestedActions: ["simulate_now", "remind_later", "ignore"],
    cooldownUntil: "2026-03-17T10:00:00.000Z",
  };
}

function buildBrief(overrides?: Partial<VoiceBrief>): VoiceBrief {
  return {
    briefId: "brief-1",
    signalId: "signal-1",
    attentionLevel: "voice_brief",
    text: "Hey, a high-priority opportunity was detected. This matters for your ETH/USDC setup. Want a 10-second summary now?",
    parts: {
      whatHappened: "Hey, a high-priority opportunity was detected.",
      whyItMatters: "This matters for your ETH/USDC setup.",
      suggestedNext: "Want a 10-second summary now?",
    },
    estimatedDurationSeconds: 10,
    sentenceCount: 3,
    protocolCompliant: true,
    language: "en",
    generatedAt: "2026-03-17T09:00:00.000Z",
    ...overrides,
  };
}

function buildAudio(overrides?: Partial<TTSResult>): TTSResult {
  return {
    audio: Buffer.from("voice-audio-binary"),
    format: "mp3",
    durationSeconds: 1.5,
    provider: "mock-tts",
    generatedAt: "2026-03-17T09:01:00.000Z",
    ...overrides,
  };
}

describe("living assistant delivery adapters", () => {
  it("formats Telegram payload for text_nudge", () => {
    const payload = formatTelegramDelivery(buildDecision("text_nudge"), buildBrief());

    expect(payload).not.toBeNull();
    expect(payload?.attentionLevel).toBe("text_nudge");
    expect(payload?.message).toContain("Heads up:");
    expect(payload?.briefText).toBeUndefined();
    expect(payload?.inlineButtons).toBeUndefined();
    expect(payload?.followUpPlan).toBeUndefined();
  });

  it("formats Telegram payload for voice_brief", () => {
    const brief = buildBrief();
    const payload = formatTelegramDelivery(buildDecision("voice_brief"), brief, buildAudio());

    expect(payload).not.toBeNull();
    expect(payload?.attentionLevel).toBe("voice_brief");
    expect(payload?.message).toContain("Actionable update:");
    expect(payload?.briefText).toBe(brief.text);
    expect(payload?.priority).toBe("high");
    expect(payload?.audioFormat).toBe("mp3");
    expect(payload?.audioDurationSeconds).toBe(1.5);
    expect(payload?.audioBase64).toBe(Buffer.from("voice-audio-binary").toString("base64"));
  });

  it("formats Telegram payload for strong_interrupt", () => {
    const payload = formatTelegramDelivery(buildDecision("strong_interrupt"), buildBrief(), buildAudio());

    expect(payload).not.toBeNull();
    expect(payload?.attentionLevel).toBe("strong_interrupt");
    expect(payload?.message).toContain("Strong interrupt:");
    expect(payload?.briefText).toBeDefined();
    expect(payload?.inlineButtons?.length).toBeGreaterThan(0);
    expect(payload?.audioFormat).toBe("mp3");
    expect(payload?.audioDurationSeconds).toBe(1.5);
    expect(payload?.audioBase64).toBe(Buffer.from("voice-audio-binary").toString("base64"));
  });

  it("formats Telegram payload for call_escalation", () => {
    const payload = formatTelegramDelivery(buildDecision("call_escalation"), buildBrief(), buildAudio());

    expect(payload).not.toBeNull();
    expect(payload?.attentionLevel).toBe("call_escalation");
    expect(payload?.message).toContain("CRITICAL");
    expect(payload?.priority).toBe("critical");
    expect(payload?.briefText).toBeDefined();
    expect(payload?.audioBase64).toBeUndefined();
    expect(payload?.audioFormat).toBeUndefined();
    expect(payload?.audioDurationSeconds).toBeUndefined();
    expect(payload?.followUpPlan).toEqual({
      intervalMinutes: 2,
      maxAttempts: 3,
      strategy: "repeat_until_acknowledged",
    });
  });

  it("formats webhook payload for notifier compatibility", () => {
    const payload = formatWebhookDelivery(buildDecision("voice_brief"), buildBrief());

    expect(payload.mode).toBe("now");
    expect(payload.text).toContain("[living-assistant][voice_brief]");
    expect(payload.text).toContain("contact=yes");
    expect(payload.text).toContain("channels=telegram|voice");
  });
});
