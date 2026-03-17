import type { AttentionLevel } from "../contact-policy";
import type { AliyunVoiceConfig, AliyunVoiceResult } from "./aliyun-voice-sender";
import { AliyunVoiceSender } from "./aliyun-voice-sender";
import type { TelegramVoiceSendResult, TelegramVoiceSenderConfig } from "./telegram-voice-sender";
import { TelegramVoiceSender } from "./telegram-voice-sender";
import type { TwilioCallConfig, TwilioCallResult } from "./twilio-call-sender";
import { TwilioCallSender } from "./twilio-call-sender";

export type VoiceRouteAttentionLevel = Exclude<AttentionLevel, "silent" | "digest">;
export type VoiceRouteAction = "telegram_text" | "telegram_voice" | "twilio_call" | "aliyun_call";

export type VoiceRoutePolicy = Record<VoiceRouteAttentionLevel, VoiceRouteAction[]>;

const ROUTE_LEVELS: VoiceRouteAttentionLevel[] = [
  "text_nudge",
  "voice_brief",
  "strong_interrupt",
  "call_escalation",
];

const BASE_ROUTE_POLICY: VoiceRoutePolicy = {
  text_nudge: ["telegram_text"],
  voice_brief: ["telegram_voice"],
  strong_interrupt: ["telegram_voice", "twilio_call", "aliyun_call"],
  call_escalation: ["twilio_call", "aliyun_call", "telegram_voice"],
};

function cloneRoutePolicy(policy: VoiceRoutePolicy): VoiceRoutePolicy {
  return {
    text_nudge: [...policy.text_nudge],
    voice_brief: [...policy.voice_brief],
    strong_interrupt: [...policy.strong_interrupt],
    call_escalation: [...policy.call_escalation],
  };
}

export function createDefaultVoiceRoutePolicy(): VoiceRoutePolicy {
  return cloneRoutePolicy(BASE_ROUTE_POLICY);
}

export function buildVoiceRoutePolicy(overrides?: Partial<VoiceRoutePolicy>): VoiceRoutePolicy {
  const policy = createDefaultVoiceRoutePolicy();
  if (!overrides) {
    return policy;
  }

  for (const level of ROUTE_LEVELS) {
    const route = overrides[level];
    if (Array.isArray(route)) {
      policy[level] = [...route];
    }
  }
  return policy;
}

export interface VoiceDeliveryConfig {
  telegram?: TelegramVoiceSenderConfig;
  twilio?: TwilioCallConfig;
  aliyun?: AliyunVoiceConfig;
  routePolicy?: Partial<VoiceRoutePolicy>;
}

export interface VoiceDeliveryResult {
  channel: string;
  ok: boolean;
  detail: TelegramVoiceSendResult | TwilioCallResult | AliyunVoiceResult;
}

function toError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class VoiceDeliveryOrchestrator {
  private readonly telegramSender?: TelegramVoiceSender;
  private readonly twilioSender?: TwilioCallSender;
  private readonly aliyunSender?: AliyunVoiceSender;
  private readonly routePolicy: VoiceRoutePolicy;

  constructor(private config: VoiceDeliveryConfig) {
    this.telegramSender = config.telegram ? new TelegramVoiceSender(config.telegram) : undefined;
    this.twilioSender = config.twilio ? new TwilioCallSender(config.twilio) : undefined;
    this.aliyunSender = config.aliyun ? new AliyunVoiceSender(config.aliyun) : undefined;
    this.routePolicy = buildVoiceRoutePolicy(config.routePolicy);
  }

  private resolveRoute(attentionLevel: AttentionLevel): VoiceRouteAction[] {
    if (attentionLevel === "text_nudge") {
      return this.routePolicy.text_nudge;
    }
    if (attentionLevel === "voice_brief") {
      return this.routePolicy.voice_brief;
    }
    if (attentionLevel === "strong_interrupt") {
      return this.routePolicy.strong_interrupt;
    }
    if (attentionLevel === "call_escalation") {
      return this.routePolicy.call_escalation;
    }
    return [];
  }

  async deliver(
    attentionLevel: AttentionLevel,
    brief: { text: string; audio?: Buffer; audioUrl?: string; audioFormat?: string },
    options?: { demoMode?: boolean },
  ): Promise<VoiceDeliveryResult[]> {
    const results: VoiceDeliveryResult[] = [];
    const attempted: string[] = [];
    const succeeded: string[] = [];
    const demoMode = options?.demoMode === true;

    const trackResult = (
      channel: string,
      detail: TelegramVoiceSendResult | TwilioCallResult | AliyunVoiceResult,
    ): void => {
      attempted.push(channel);
      if (detail.ok) {
        succeeded.push(channel);
      }
      results.push({ channel, ok: detail.ok, detail });
    };

    const sendTelegramText = async (): Promise<void> => {
      if (!this.telegramSender) {
        return;
      }
      if (demoMode) {
        trackResult("telegram", { ok: true, messageId: 0 });
        return;
      }
      try {
        const result = await this.telegramSender.sendMessage(brief.text);
        trackResult("telegram", result);
      } catch (error) {
        trackResult("telegram", { ok: false, error: toError(error) });
      }
    };

    const sendTelegramVoice = async (): Promise<void> => {
      if (!this.telegramSender) {
        return;
      }
      if (demoMode) {
        trackResult("telegram", { ok: true, messageId: 0 });
        return;
      }
      try {
        if (brief.audio && brief.audio.length > 0) {
          const result = await this.telegramSender.sendVoice(brief.audio, {
            caption: brief.text,
            format: brief.audioFormat,
          });
          trackResult("telegram", result);
          return;
        }

        // Fallback when no audio buffer is available.
        const result = await this.telegramSender.sendMessage(brief.text);
        trackResult("telegram", result);
      } catch (error) {
        trackResult("telegram", { ok: false, error: toError(error) });
      }
    };

    const sendTwilioCall = async (): Promise<void> => {
      if (!this.twilioSender) {
        return;
      }
      if (demoMode) {
        trackResult("twilio", { ok: true, callSid: "demo-call-sid" });
        return;
      }
      try {
        const audioUrl = typeof brief.audioUrl === "string" ? brief.audioUrl.trim() : "";
        const result = audioUrl
          ? await this.twilioSender.callWithAudio(audioUrl)
          : await this.twilioSender.callWithTts(brief.text);
        trackResult("twilio", result);
      } catch (error) {
        trackResult("twilio", { ok: false, error: toError(error) });
      }
    };

    const sendAliyunCall = async (): Promise<void> => {
      if (!this.aliyunSender) {
        return;
      }
      if (demoMode) {
        trackResult("aliyun", { ok: true, callId: "demo-call-id" });
        return;
      }
      try {
        const result = await this.aliyunSender.callWithTts({ content: brief.text });
        trackResult("aliyun", result);
      } catch (error) {
        trackResult("aliyun", { ok: false, error: toError(error) });
      }
    };

    for (const action of this.resolveRoute(attentionLevel)) {
      if (action === "telegram_text") {
        await sendTelegramText();
      } else if (action === "telegram_voice") {
        await sendTelegramVoice();
      } else if (action === "twilio_call") {
        await sendTwilioCall();
      } else {
        await sendAliyunCall();
      }
    }

    const attemptedLabel = attempted.length > 0 ? attempted.join(",") : "none";
    const succeededLabel = succeeded.length > 0 ? succeeded.join(",") : "none";
    console.info(
      `[voice-orchestrator] attention=${attentionLevel} demo=${String(demoMode)} attempted=${attemptedLabel} succeeded=${succeededLabel}`,
    );

    return results;
  }
}
