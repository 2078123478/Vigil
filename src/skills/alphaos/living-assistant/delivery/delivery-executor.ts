import type { ContactDecision } from "../contact-policy";
import type { TTSResult } from "../tts";
import type { VoiceBrief } from "../voice-brief";
import type { TelegramVoiceSendResult } from "./telegram-voice-sender";
import { TelegramVoiceSender } from "./telegram-voice-sender";
import type { VoiceDeliveryResult } from "./voice-orchestrator";
import { VoiceDeliveryOrchestrator } from "./voice-orchestrator";

export interface DeliveryExecutorConfig {
  telegramSender?: TelegramVoiceSender;
  voiceOrchestrator?: VoiceDeliveryOrchestrator;
  voiceOrchestratorOptions?: {
    demoMode?: boolean;
  };
  dryRun?: boolean;
}

export interface DeliveryResult {
  channel: string;
  sent: boolean;
  dryRun: boolean;
  voiceResult?: TelegramVoiceSendResult;
  textResult?: TelegramVoiceSendResult;
  orchestratorResults?: VoiceDeliveryResult[];
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

function toOrchestratorError(results: VoiceDeliveryResult[]): string | undefined {
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => {
      const detail = result.detail as { error?: string };
      if (typeof detail.error === "string" && detail.error.trim().length > 0) {
        return `${result.channel}: ${detail.error}`;
      }
      return `${result.channel}: unknown error`;
    });

  if (failures.length === 0) {
    return undefined;
  }
  return failures.join(" | ");
}

function hasAudioBytes(audio?: TTSResult): audio is TTSResult & { audio: Buffer } {
  return Boolean(audio?.audio && audio.audio.length > 0);
}

function hasAudioUrl(audio?: TTSResult): audio is TTSResult & { audioUrl: string } {
  return Boolean(audio?.audioUrl && audio.audioUrl.trim().length > 0);
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

  if (config?.dryRun) {
    return {
      channel: decision.channels[0] ?? "none",
      sent: false,
      dryRun: true,
    };
  }

  const voiceOrchestrator = config?.voiceOrchestrator;
  const shouldUseVoiceOrchestrator =
    Boolean(voiceOrchestrator) &&
    (decision.attentionLevel === "strong_interrupt" || decision.attentionLevel === "call_escalation");
  if (shouldUseVoiceOrchestrator && voiceOrchestrator) {
    const briefText = brief?.text ?? decision.reason;
    const payload = {
      text: briefText,
      ...(hasAudioBytes(audio) ? { audio: audio.audio, audioFormat: audio.format } : {}),
      ...(hasAudioUrl(audio) ? { audioUrl: audio.audioUrl } : {}),
    };
    const orchestratorOptions = config?.voiceOrchestratorOptions;
    const orchestratorResults = orchestratorOptions
      ? await voiceOrchestrator.deliver(decision.attentionLevel, payload, orchestratorOptions)
      : await voiceOrchestrator.deliver(decision.attentionLevel, payload);
    const firstSuccess = orchestratorResults.find((result) => result.ok)?.channel;
    const firstAttempt = orchestratorResults[0]?.channel;
    const sent = orchestratorResults.some((result) => result.ok);
    const error =
      sent || orchestratorResults.length === 0
        ? undefined
        : toOrchestratorError(orchestratorResults) ?? "voice delivery failed";

    return {
      channel: firstSuccess ?? firstAttempt ?? "voice",
      sent,
      dryRun: false,
      orchestratorResults,
      ...(error ? { error } : {}),
    };
  }

  const sender = config?.telegramSender;
  if (!sender) {
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
    if (hasAudioBytes(audio)) {
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
    if (hasAudioBytes(audio)) {
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
  if (hasAudioBytes(audio)) {
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
