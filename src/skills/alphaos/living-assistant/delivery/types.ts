import type { AttentionLevel, ContactDecision } from "../contact-policy";
import type { TTSResult } from "../tts";
import type { VoiceBrief } from "../voice-brief";

export type TelegramPriority = "normal" | "high" | "critical";

export interface TelegramInlineButton {
  text: string;
  action: string;
}

export interface TelegramFollowUpPlan {
  intervalMinutes: number;
  maxAttempts: number;
  strategy: "repeat_until_acknowledged";
}

export interface TelegramDeliveryPayload {
  platform: "telegram";
  attentionLevel: AttentionLevel;
  priority: TelegramPriority;
  message: string;
  briefText?: string;
  audioBase64?: string; // base64-encoded audio for voice message
  audioFormat?: string; // 'mp3', 'wav', etc.
  audioDurationSeconds?: number;
  inlineButtons?: TelegramInlineButton[];
  followUpPlan?: TelegramFollowUpPlan;
  metadata: {
    shouldContact: boolean;
    reason: string;
    suggestedActions?: string[];
    cooldownUntil?: string;
  };
}

export interface WebhookNotifierPayload {
  text: string;
  mode: "now";
}

export interface DeliveryAdapterInput {
  decision: ContactDecision;
  brief?: VoiceBrief;
  audio?: TTSResult;
}
