import type { AttentionLevel } from "../contact-policy";
import type { AliyunVoiceConfig, AliyunVoiceResult } from "./aliyun-voice-sender";
import { AliyunVoiceSender } from "./aliyun-voice-sender";
import type { TelegramVoiceSendResult, TelegramVoiceSenderConfig } from "./telegram-voice-sender";
import { TelegramVoiceSender } from "./telegram-voice-sender";
import type { TwilioCallConfig, TwilioCallResult } from "./twilio-call-sender";
import { TwilioCallSender } from "./twilio-call-sender";

export interface VoiceDeliveryConfig {
  telegram?: TelegramVoiceSenderConfig;
  twilio?: TwilioCallConfig;
  aliyun?: AliyunVoiceConfig;
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

  constructor(private config: VoiceDeliveryConfig) {
    this.telegramSender = config.telegram ? new TelegramVoiceSender(config.telegram) : undefined;
    this.twilioSender = config.twilio ? new TwilioCallSender(config.twilio) : undefined;
    this.aliyunSender = config.aliyun ? new AliyunVoiceSender(config.aliyun) : undefined;
  }

  async deliver(
    attentionLevel: AttentionLevel,
    brief: { text: string; audio?: Buffer; audioFormat?: string },
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
        const result = await this.twilioSender.callWithTts(brief.text);
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

    if (attentionLevel === "text_nudge") {
      await sendTelegramText();
    } else if (attentionLevel === "voice_brief") {
      await sendTelegramVoice();
    } else if (attentionLevel === "strong_interrupt") {
      await sendTelegramVoice();
      await sendTwilioCall();
      await sendAliyunCall();
    } else if (attentionLevel === "call_escalation") {
      await sendTwilioCall();
      await sendAliyunCall();
      await sendTelegramVoice();
    }

    const attemptedLabel = attempted.length > 0 ? attempted.join(",") : "none";
    const succeededLabel = succeeded.length > 0 ? succeeded.join(",") : "none";
    console.info(
      `[voice-orchestrator] attention=${attentionLevel} demo=${String(demoMode)} attempted=${attemptedLabel} succeeded=${succeededLabel}`,
    );

    return results;
  }
}
