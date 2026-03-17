import type { AttentionLevel, ContactDecision } from "../contact-policy";
import type { TTSResult } from "../tts";
import type { VoiceBrief } from "../voice-brief";
import type {
  TelegramDeliveryPayload,
  TelegramFollowUpPlan,
  TelegramInlineButton,
  TelegramPriority,
} from "./types";

function toPriority(level: AttentionLevel): TelegramPriority {
  if (level === "call_escalation") {
    return "critical";
  }
  if (level === "voice_brief" || level === "strong_interrupt") {
    return "high";
  }
  return "normal";
}

function briefTextOrFallback(brief: VoiceBrief | undefined, decision: ContactDecision): string {
  return brief?.text ?? decision.reason;
}

function toInlineButtons(decision: ContactDecision): TelegramInlineButton[] {
  const actions = decision.suggestedActions?.slice(0, 3) ?? ["act_now", "defer_5m", "ignore_once"];
  return actions.map((action) => ({
    text: action.replace(/_/g, " "),
    action,
  }));
}

function escalationFollowUpPlan(): TelegramFollowUpPlan {
  return {
    intervalMinutes: 2,
    maxAttempts: 3,
    strategy: "repeat_until_acknowledged",
  };
}

function withAudioPayload(audio: TTSResult | undefined): Pick<
  TelegramDeliveryPayload,
  "audioBase64" | "audioFormat" | "audioDurationSeconds"
> {
  if (!audio) {
    return {};
  }

  return {
    audioBase64: audio.audio.toString("base64"),
    audioFormat: audio.format,
    audioDurationSeconds: audio.durationSeconds,
  };
}

export function formatTelegramDelivery(
  decision: ContactDecision,
  brief?: VoiceBrief,
  audio?: TTSResult,
): TelegramDeliveryPayload | null {
  if (!decision.shouldContact || decision.attentionLevel === "silent" || decision.attentionLevel === "digest") {
    return null;
  }

  if (decision.attentionLevel === "text_nudge") {
    return {
      platform: "telegram",
      attentionLevel: decision.attentionLevel,
      priority: toPriority(decision.attentionLevel),
      message: `Heads up: ${decision.reason}`,
      metadata: {
        shouldContact: decision.shouldContact,
        reason: decision.reason,
        suggestedActions: decision.suggestedActions,
        cooldownUntil: decision.cooldownUntil,
      },
    };
  }

  if (decision.attentionLevel === "voice_brief") {
    return {
      platform: "telegram",
      attentionLevel: decision.attentionLevel,
      priority: toPriority(decision.attentionLevel),
      message: `Actionable update: ${decision.reason}`,
      briefText: briefTextOrFallback(brief, decision),
      ...withAudioPayload(audio),
      metadata: {
        shouldContact: decision.shouldContact,
        reason: decision.reason,
        suggestedActions: decision.suggestedActions,
        cooldownUntil: decision.cooldownUntil,
      },
    };
  }

  if (decision.attentionLevel === "strong_interrupt") {
    return {
      platform: "telegram",
      attentionLevel: decision.attentionLevel,
      priority: toPriority(decision.attentionLevel),
      message: `Strong interrupt: ${decision.reason}`,
      briefText: briefTextOrFallback(brief, decision),
      ...withAudioPayload(audio),
      inlineButtons: toInlineButtons(decision),
      metadata: {
        shouldContact: decision.shouldContact,
        reason: decision.reason,
        suggestedActions: decision.suggestedActions,
        cooldownUntil: decision.cooldownUntil,
      },
    };
  }

  return {
    platform: "telegram",
    attentionLevel: decision.attentionLevel,
    priority: toPriority(decision.attentionLevel),
    message: `CRITICAL escalation required: ${decision.reason}`,
    briefText: briefTextOrFallback(brief, decision),
    inlineButtons: toInlineButtons(decision),
    followUpPlan: escalationFollowUpPlan(),
    metadata: {
      shouldContact: decision.shouldContact,
      reason: decision.reason,
      suggestedActions: decision.suggestedActions,
      cooldownUntil: decision.cooldownUntil,
    },
  };
}
