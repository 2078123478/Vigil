import type { ContactDecision } from "../contact-policy";
import type { TTSResult } from "../tts";
import type { VoiceBrief } from "../voice-brief";
import type { TelegramVoiceSendResult } from "./telegram-voice-sender";
import { TelegramVoiceSender } from "./telegram-voice-sender";

export interface DeliveryExecutorConfig {
  telegramSender?: TelegramVoiceSender;
  dryRun?: boolean;
}

export interface DeliveryResult {
  channel: string;
  sent: boolean;
  dryRun: boolean;
  voiceResult?: TelegramVoiceSendResult;
  textResult?: TelegramVoiceSendResult;
  error?: string;
}

function summarizeActions(actions?: string[]): string {
  const normalized = actions?.map((action) => action.trim()).filter((action) => action.length > 0) ?? [];
  if (normalized.length === 0) {
    return "Suggested actions:\n1. Acknowledge this alert\n2. Review live positions\n3. Decide to execute or defer";
  }

  const rows = normalized.map((action, index) => `${index + 1}. ${action.replace(/_/g, " ")}`);
  return `Suggested actions:\n${rows.join("\n")}`;
}

function strongInterruptFollowUp(decision: ContactDecision): string {
  return [
    `Strong interrupt context: ${decision.reason}`,
    summarizeActions(decision.suggestedActions),
  ].join("\n\n");
}

function escalationFollowUp(decision: ContactDecision): string {
  const cooldownLine = decision.cooldownUntil
    ? `Cooldown until: ${decision.cooldownUntil}`
    : "Cooldown until: immediate reassessment";
  return [
    "Escalation plan:",
    "1. Acknowledge this message now.",
    "2. Open the strategy console and verify risk controls.",
    "3. Execute the safest mitigation path or pause the strategy.",
    cooldownLine,
  ].join("\n");
}

function toErrorMessage(results: TelegramVoiceSendResult[]): string | undefined {
  const failures = results.filter((result) => !result.ok).map((result) => result.error).filter(Boolean);
  if (failures.length === 0) {
    return undefined;
  }
  return failures.join(" | ");
}

export async function executeDelivery(
  decision: ContactDecision,
  brief?: VoiceBrief,
  audio?: TTSResult,
  config?: DeliveryExecutorConfig,
): Promise<DeliveryResult> {
  if (decision.attentionLevel === "silent" || decision.attentionLevel === "digest") {
    return {
      channel: "none",
      sent: false,
      dryRun: false,
    };
  }

  const sender = config?.telegramSender;
  if (config?.dryRun || !sender) {
    return {
      channel: "telegram",
      sent: false,
      dryRun: true,
    };
  }

  const briefText = brief?.text ?? decision.reason;

  if (decision.attentionLevel === "text_nudge") {
    const textResult = await sender.sendText(decision.reason);
    return {
      channel: "telegram",
      sent: textResult.ok,
      dryRun: false,
      textResult,
      ...(textResult.ok ? {} : { error: textResult.error }),
    };
  }

  if (decision.attentionLevel === "voice_brief") {
    if (audio) {
      const voiceResult = await sender.sendVoice(audio.audio, { caption: briefText });
      return {
        channel: "telegram",
        sent: voiceResult.ok,
        dryRun: false,
        voiceResult,
        ...(voiceResult.ok ? {} : { error: voiceResult.error }),
      };
    }

    const textResult = await sender.sendText(briefText);
    return {
      channel: "telegram",
      sent: textResult.ok,
      dryRun: false,
      textResult,
      ...(textResult.ok ? {} : { error: textResult.error }),
    };
  }

  if (decision.attentionLevel === "strong_interrupt") {
    const followUpText = strongInterruptFollowUp(decision);
    if (audio) {
      const combined = await sender.sendVoiceWithFollowUp(audio.audio, briefText, followUpText);
      return {
        channel: "telegram",
        sent: combined.voice.ok && combined.followUp.ok,
        dryRun: false,
        voiceResult: combined.voice,
        textResult: combined.followUp,
        ...(combined.voice.ok && combined.followUp.ok
          ? {}
          : { error: toErrorMessage([combined.voice, combined.followUp]) }),
      };
    }

    const voiceFallbackText = await sender.sendText(briefText);
    const followUp = await sender.sendText(followUpText);
    return {
      channel: "telegram",
      sent: voiceFallbackText.ok && followUp.ok,
      dryRun: false,
      voiceResult: voiceFallbackText,
      textResult: followUp,
      ...(voiceFallbackText.ok && followUp.ok
        ? {}
        : { error: toErrorMessage([voiceFallbackText, followUp]) }),
    };
  }

  const escalationText = escalationFollowUp(decision);
  const urgentCaption = `URGENT: ${briefText}`;
  if (audio) {
    const combined = await sender.sendVoiceWithFollowUp(audio.audio, urgentCaption, escalationText);
    return {
      channel: "telegram",
      sent: combined.voice.ok && combined.followUp.ok,
      dryRun: false,
      voiceResult: combined.voice,
      textResult: combined.followUp,
      ...(combined.voice.ok && combined.followUp.ok
        ? {}
        : { error: toErrorMessage([combined.voice, combined.followUp]) }),
    };
  }

  const urgentText = await sender.sendText(urgentCaption);
  const planText = await sender.sendText(escalationText);
  return {
    channel: "telegram",
    sent: urgentText.ok && planText.ok,
    dryRun: false,
    voiceResult: urgentText,
    textResult: planText,
    ...(urgentText.ok && planText.ok ? {} : { error: toErrorMessage([urgentText, planText]) }),
  };
}
