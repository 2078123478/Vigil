import { describe, expect, it, vi } from "vitest";
import type { AttentionLevel, ContactDecision } from "../src/skills/alphaos/living-assistant/contact-policy";
import { executeDelivery } from "../src/skills/alphaos/living-assistant/delivery/delivery-executor";
import type { TelegramVoiceSender } from "../src/skills/alphaos/living-assistant/delivery/telegram-voice-sender";
import type { VoiceDeliveryOrchestrator } from "../src/skills/alphaos/living-assistant/delivery/voice-orchestrator";
import type { TTSResult } from "../src/skills/alphaos/living-assistant/tts";
import type { VoiceBrief } from "../src/skills/alphaos/living-assistant/voice-brief";

function buildDecision(attentionLevel: AttentionLevel): ContactDecision {
  return {
    shouldContact: attentionLevel !== "silent" && attentionLevel !== "digest",
    attentionLevel,
    channels: attentionLevel === "silent" || attentionLevel === "digest" ? [] : ["telegram"],
    reason: `Decision for ${attentionLevel}`,
    suggestedActions: ["simulate_now", "defer_5m", "ignore_once"],
    cooldownUntil: "2026-03-17T10:00:00.000Z",
  };
}

function buildBrief(): VoiceBrief {
  return {
    briefId: "brief-1",
    signalId: "signal-1",
    attentionLevel: "voice_brief",
    text: "Market spread widened. This may impact your active strategy. Run a quick simulation now.",
    parts: {
      whatHappened: "Market spread widened.",
      whyItMatters: "This may impact your active strategy.",
      suggestedNext: "Run a quick simulation now.",
    },
    estimatedDurationSeconds: 8,
    sentenceCount: 3,
    protocolCompliant: true,
    language: "en",
    generatedAt: "2026-03-17T09:00:00.000Z",
  };
}

function buildAudio(): TTSResult {
  return {
    audio: Buffer.from("voice-audio"),
    format: "ogg",
    durationSeconds: 2.1,
    provider: "mock-tts",
    generatedAt: "2026-03-17T09:01:00.000Z",
  };
}

function buildAudioUrlOnly(): TTSResult {
  return {
    audioUrl: "https://cdn.example.com/brief.wav",
    format: "wav",
    durationSeconds: 0,
    provider: "mock-tts",
    generatedAt: "2026-03-17T09:01:30.000Z",
  };
}

function buildSender() {
  const sendVoice = vi.fn().mockResolvedValue({
    ok: true,
    messageId: 11,
    sentAt: "2026-03-17T09:02:00.000Z",
  });
  const sendText = vi.fn().mockResolvedValue({
    ok: true,
    messageId: 12,
    sentAt: "2026-03-17T09:02:01.000Z",
  });
  const sendVoiceWithFollowUp = vi.fn().mockResolvedValue({
    voice: {
      ok: true,
      messageId: 21,
      sentAt: "2026-03-17T09:03:00.000Z",
    },
    followUp: {
      ok: true,
      messageId: 22,
      sentAt: "2026-03-17T09:03:01.000Z",
    },
  });

  return {
    sender: {
      sendVoice,
      sendText,
      sendVoiceWithFollowUp,
    } as unknown as TelegramVoiceSender,
    mocks: {
      sendVoice,
      sendText,
      sendVoiceWithFollowUp,
    },
  };
}

describe("living assistant delivery executor", () => {
  it("returns dry-run result without sending", async () => {
    const { sender, mocks } = buildSender();
    const result = await executeDelivery(buildDecision("text_nudge"), buildBrief(), undefined, {
      telegramSender: sender,
      dryRun: true,
    });

    expect(result).toEqual({
      channel: "telegram",
      sent: false,
      dryRun: true,
    });
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(mocks.sendVoice).not.toHaveBeenCalled();
  });

  it("sends text only for text_nudge", async () => {
    const { sender, mocks } = buildSender();
    const result = await executeDelivery(buildDecision("text_nudge"), buildBrief(), undefined, {
      telegramSender: sender,
    });

    expect(mocks.sendText).toHaveBeenCalledTimes(1);
    expect(mocks.sendText).toHaveBeenCalledWith("Decision for text_nudge");
    expect(mocks.sendVoice).not.toHaveBeenCalled();
    expect(result.sent).toBe(true);
    expect(result.textResult?.messageId).toBe(12);
  });

  it("sends voice for voice_brief when audio exists", async () => {
    const { sender, mocks } = buildSender();
    const brief = buildBrief();
    const audio = buildAudio();
    const result = await executeDelivery(buildDecision("voice_brief"), brief, audio, {
      telegramSender: sender,
    });

    expect(mocks.sendVoice).toHaveBeenCalledTimes(1);
    expect(mocks.sendVoice).toHaveBeenCalledWith(audio.audio, { caption: brief.text });
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(result.sent).toBe(true);
    expect(result.voiceResult?.messageId).toBe(11);
  });

  it("falls back to text for voice_brief when audio is missing", async () => {
    const { sender, mocks } = buildSender();
    const brief = buildBrief();
    const result = await executeDelivery(buildDecision("voice_brief"), brief, undefined, {
      telegramSender: sender,
    });

    expect(mocks.sendVoice).not.toHaveBeenCalled();
    expect(mocks.sendText).toHaveBeenCalledTimes(1);
    expect(mocks.sendText).toHaveBeenCalledWith(brief.text);
    expect(result.sent).toBe(true);
    expect(result.textResult?.messageId).toBe(12);
  });

  it("sends voice plus follow-up for strong_interrupt", async () => {
    const { sender, mocks } = buildSender();
    const brief = buildBrief();
    const audio = buildAudio();
    const result = await executeDelivery(buildDecision("strong_interrupt"), brief, audio, {
      telegramSender: sender,
    });

    expect(mocks.sendVoiceWithFollowUp).toHaveBeenCalledTimes(1);
    const [sentAudio, caption, followUpText] = mocks.sendVoiceWithFollowUp.mock.calls[0];
    expect(sentAudio).toBe(audio.audio);
    expect(caption).toBe(brief.text);
    expect(String(followUpText)).toContain("Suggested actions:");
    expect(String(followUpText)).toContain("1. simulate now");
    expect(result.sent).toBe(true);
    expect(result.voiceResult?.messageId).toBe(21);
    expect(result.textResult?.messageId).toBe(22);
  });

  it("uses voice orchestrator for call_escalation when configured", async () => {
    const { sender, mocks } = buildSender();
    const brief = buildBrief();
    const audio = buildAudio();
    const deliver = vi.fn().mockResolvedValue([
      {
        channel: "twilio",
        ok: true,
        detail: {
          ok: true,
          callSid: "CA001",
        },
      },
      {
        channel: "aliyun",
        ok: false,
        detail: {
          ok: false,
          error: "template not approved",
        },
      },
    ]);
    const voiceOrchestrator = {
      deliver,
    } as unknown as VoiceDeliveryOrchestrator;

    const result = await executeDelivery(buildDecision("call_escalation"), brief, audio, {
      telegramSender: sender,
      voiceOrchestrator,
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("call_escalation", {
      text: brief.text,
      audio: audio.audio,
      audioFormat: audio.format,
    });
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(mocks.sendVoice).not.toHaveBeenCalled();
    expect(mocks.sendVoiceWithFollowUp).not.toHaveBeenCalled();
    expect(result.channel).toBe("twilio");
    expect(result.sent).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.orchestratorResults).toHaveLength(2);
  });

  it("forwards audioUrl-only payloads to voice orchestrator", async () => {
    const brief = buildBrief();
    const deliver = vi.fn().mockResolvedValue([
      {
        channel: "twilio",
        ok: true,
        detail: {
          ok: true,
          callSid: "CAURL",
        },
      },
    ]);
    const voiceOrchestrator = {
      deliver,
    } as unknown as VoiceDeliveryOrchestrator;

    const result = await executeDelivery(buildDecision("call_escalation"), brief, buildAudioUrlOnly(), {
      voiceOrchestrator,
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("call_escalation", {
      text: brief.text,
      audioUrl: "https://cdn.example.com/brief.wav",
    });
    expect(result.sent).toBe(true);
    expect(result.channel).toBe("twilio");
  });

  it("forwards voice orchestrator demo options when configured", async () => {
    const deliver = vi.fn().mockResolvedValue([
      {
        channel: "twilio",
        ok: true,
        detail: {
          ok: true,
          callSid: "CA999",
        },
      },
    ]);
    const voiceOrchestrator = {
      deliver,
    } as unknown as VoiceDeliveryOrchestrator;

    const result = await executeDelivery(buildDecision("call_escalation"), buildBrief(), buildAudio(), {
      voiceOrchestrator,
      voiceOrchestratorOptions: {
        demoMode: true,
      },
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      "call_escalation",
      {
        text: buildBrief().text,
        audio: buildAudio().audio,
        audioFormat: buildAudio().format,
      },
      {
        demoMode: true,
      },
    );
    expect(result.sent).toBe(true);
    expect(result.channel).toBe("twilio");
  });

  it("returns combined errors when all orchestrator channels fail", async () => {
    const deliver = vi.fn().mockResolvedValue([
      {
        channel: "twilio",
        ok: false,
        detail: {
          ok: false,
          error: "twilio rejected number",
        },
      },
      {
        channel: "aliyun",
        ok: false,
        detail: {
          ok: false,
          error: "aliyun template missing",
        },
      },
    ]);
    const voiceOrchestrator = {
      deliver,
    } as unknown as VoiceDeliveryOrchestrator;

    const result = await executeDelivery(buildDecision("call_escalation"), buildBrief(), buildAudio(), {
      voiceOrchestrator,
    });

    expect(result.sent).toBe(false);
    expect(result.channel).toBe("twilio");
    expect(result.error).toContain("twilio: twilio rejected number");
    expect(result.error).toContain("aliyun: aliyun template missing");
  });

  it("does not send for silent/digest decisions", async () => {
    const { sender, mocks } = buildSender();

    const silentResult = await executeDelivery(buildDecision("silent"), buildBrief(), undefined, {
      telegramSender: sender,
    });
    const digestResult = await executeDelivery(buildDecision("digest"), buildBrief(), undefined, {
      telegramSender: sender,
    });

    expect(silentResult).toEqual({
      channel: "none",
      sent: false,
      dryRun: false,
    });
    expect(digestResult).toEqual({
      channel: "none",
      sent: false,
      dryRun: false,
    });
    expect(mocks.sendVoice).not.toHaveBeenCalled();
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(mocks.sendVoiceWithFollowUp).not.toHaveBeenCalled();
  });
});
