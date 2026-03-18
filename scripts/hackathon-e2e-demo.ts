/// <reference path="./ws-shim.d.ts" />

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { defaultContactPolicyConfig, evaluateContactPolicy, type ContactPolicyConfig, type UserContext } from "../src/skills/alphaos/living-assistant/contact-policy";
import { TelegramCallbackHandler } from "../src/skills/alphaos/living-assistant/delivery/callback-handler";
import { TelegramVoiceSender } from "../src/skills/alphaos/living-assistant/delivery/telegram-voice-sender";
import { runLivingAssistantLoop } from "../src/skills/alphaos/living-assistant/loop";
import { normalizeSignal } from "../src/skills/alphaos/living-assistant/signal-radar";
import { createTTSProvider } from "../src/skills/alphaos/living-assistant/tts/provider-factory";
import { generateVoiceBrief } from "../src/skills/alphaos/living-assistant/voice-brief";

const FIXTURE_PATH = path.resolve(process.cwd(), "fixtures", "demo-scenarios", "critical-risk-escalation.json");
const DEFAULT_TTS_VOICE = "cosyvoice-v2-wilsen-078bd152fc744a33871a0c71b32a6025";
const CALLBACK_TIMEOUT_MS = 60_000;

interface DemoFixture {
  name: string;
  description: string;
  signal: unknown;
  userContext: UserContext;
  policyConfig?: Partial<ContactPolicyConfig>;
  expectedAttentionLevel?: string;
}

interface TimedResult<T> {
  value: T;
  ms: number;
}

interface CallbackHandledResult {
  status: "handled";
  callbackData: string;
  messageId?: number;
  elapsedMs: number;
  result: Awaited<ReturnType<TelegramCallbackHandler["handleCallback"]>>;
}

interface CallbackTimeoutResult {
  status: "timeout";
  elapsedMs: number;
}

type CallbackWaitResult = CallbackHandledResult | CallbackTimeoutResult;

function printHeader(title: string): void {
  console.log(`\n${title}`);
}

function printLine(text: string): void {
  console.log(`   ${text}`);
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function measure<T>(work: () => T): TimedResult<T> {
  const startedAt = performance.now();
  return {
    value: work(),
    ms: performance.now() - startedAt,
  };
}

async function measureAsync<T>(work: () => Promise<T>): Promise<TimedResult<T>> {
  const startedAt = performance.now();
  return {
    value: await work(),
    ms: performance.now() - startedAt,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadFixture(): DemoFixture {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as DemoFixture;
}

function buildDemoPolicyConfig(baseConfig: ContactPolicyConfig): ContactPolicyConfig {
  return {
    ...baseConfig,
    allowCallEscalation: false,
  };
}

async function waitForSingleCallback(
  handler: TelegramCallbackHandler,
  targetMessageId: number | undefined,
): Promise<CallbackWaitResult> {
  return new Promise<CallbackWaitResult>((resolve) => {
    const startedAt = performance.now();
    let settled = false;

    const finish = (result: CallbackWaitResult) => {
      if (settled) {
        return;
      }
      settled = true;
      handler.stopPolling();
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({
        status: "timeout",
        elapsedMs: performance.now() - startedAt,
      });
    }, CALLBACK_TIMEOUT_MS);

    handler.startPolling((event) => {
      if (settled) {
        return;
      }

      if (typeof targetMessageId === "number" && event.messageId !== targetMessageId) {
        printLine(
          `Ignoring callback for message ${event.messageId ?? "unknown"}; waiting for follow-up message ${targetMessageId}.`,
        );
        return;
      }

      settled = true;
      clearTimeout(timeout);
      handler.stopPolling();

      void (async () => {
        printLine(`Callback received: ${event.callbackData}`);
        const result = await handler.handleCallback(event.callbackQueryId, event.callbackData, event.messageId);
        resolve({
          status: "handled",
          callbackData: event.callbackData,
          messageId: event.messageId,
          elapsedMs: performance.now() - startedAt,
          result,
        });
      })().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        resolve({
          status: "handled",
          callbackData: event.callbackData,
          messageId: event.messageId,
          elapsedMs: performance.now() - startedAt,
          result: {
            ok: false,
            action: "unknown",
            answeredAt: new Date().toISOString(),
            error: message,
          },
        });
      });
    });
  });
}

async function main(): Promise<void> {
  const runStartedAt = performance.now();
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const ttsApiKey = requireEnv("TTS_API_KEY");
  const ttsVoice = process.env.TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;

  printHeader("🎬 Living Assistant Hackathon E2E Demo");
  printLine(`Fixture: ${path.relative(process.cwd(), FIXTURE_PATH)}`);
  printLine(`Chat ID: ${chatId}`);
  printLine(`CosyVoice voice: ${ttsVoice}`);

  printHeader("📦 Step 1: Load Fixture");
  const fixtureLoad = measure(loadFixture);
  const fixture = fixtureLoad.value;
  printLine(`Loaded ${fixture.name} in ${formatMs(fixtureLoad.ms)}`);
  printLine(fixture.description);

  printHeader("🧭 Step 2: Normalize Signal");
  const normalized = measure(() => normalizeSignal(fixture.signal as never));
  const signal = normalized.value;
  printLine(`Signal ID: ${signal.signalId}`);
  printLine(`Urgency: ${signal.urgency}`);
  printLine(`Normalized in ${formatMs(normalized.ms)}`);

  const basePolicyConfig: ContactPolicyConfig = {
    ...defaultContactPolicyConfig,
    ...(fixture.policyConfig ?? {}),
  };

  printHeader("📋 Step 3: Contact Policy Preview");
  const defaultPolicy = measure(() => evaluateContactPolicy(signal, fixture.userContext, basePolicyConfig));
  printLine(`Default decision: ${defaultPolicy.value.attentionLevel} (${formatMs(defaultPolicy.ms)})`);
  printLine(defaultPolicy.value.reason);
  if (fixture.expectedAttentionLevel) {
    printLine(`Fixture expectation: ${fixture.expectedAttentionLevel}`);
  }

  const demoPolicyConfig = buildDemoPolicyConfig(basePolicyConfig);
  const demoPolicy = measure(() => evaluateContactPolicy(signal, fixture.userContext, demoPolicyConfig));
  printLine(`Demo decision: ${demoPolicy.value.attentionLevel} (${formatMs(demoPolicy.ms)})`);
  if (demoPolicy.value.degradeReason) {
    printLine(`Demo override: ${demoPolicy.value.degradeReason}`);
  }
  printLine("Demo override keeps the flow on Telegram with supported inline actions: act_now, defer_5m, ignore_once.");

  printHeader("🗣️ Step 4: Voice Brief Preview");
  const naturalBriefText = await (async () => {
    try {
      const { generateNaturalBrief } = await import("../src/skills/alphaos/living-assistant/llm/natural-brief");
      const text = await generateNaturalBrief(signal, demoPolicy.value, "zh");
      if (text && text.trim()) {
        printLine("Brief engine: LLM (natural)");
        return text;
      }
    } catch {
      // LLM unavailable, fall through to template
    }
    return null;
  })();

  const briefPreview = measure(() => generateVoiceBrief(signal, demoPolicy.value));
  const finalBriefText = naturalBriefText ?? briefPreview.value.text;
  printLine(`Generated brief in ${formatMs(briefPreview.ms)}`);
  if (!naturalBriefText) {
    printLine("Brief engine: template (fallback)");
  }
  printLine(`Protocol compliant: ${briefPreview.value.protocolCompliant ? "yes" : "no"}`);
  printLine(`Preview: ${finalBriefText}`);

  printHeader("🔊 Step 5: Create CosyVoice Provider");
  const ttsProvider = createTTSProvider({
    type: "cosyvoice",
    apiKey: ttsApiKey,
    defaultVoice: ttsVoice,
    defaultFormat: "mp3",
  });
  const telegramSender = new TelegramVoiceSender({
    botToken,
    chatId,
  });
  printLine(`TTS provider: ${ttsProvider.name}`);
  printLine("Telegram sender ready.");

  printHeader("🚀 Step 6: Run Living Assistant Loop");
  const loopRun = await measureAsync(async () =>
    runLivingAssistantLoop({
      signal,
      userContext: fixture.userContext,
      policyConfig: demoPolicyConfig,
      ttsProvider,
      ttsOptions: {
        voice: ttsVoice,
        format: "mp3",
        language: "zh",
      },
      deliveryExecutor: {
        telegramSender,
      },
      llmEnabled: true,
    }),
  );
  const loopOutput = loopRun.value;
  printLine(`Loop completed in ${formatMs(loopRun.ms)}`);
  printLine(`Decision: ${loopOutput.decision.attentionLevel}`);
  printLine(`Policy: ${formatMs(loopOutput.timings.policyMs)}`);
  printLine(`Voice brief: ${formatMs(loopOutput.timings.briefMs)}`);
  printLine(`TTS: ${formatMs(loopOutput.timings.ttsMs)}`);
  printLine(`Delivery: ${formatMs(loopOutput.timings.deliveryMs)}`);
  printLine(`Voice message: ${loopOutput.delivery?.voiceResult?.ok ? "sent" : "not sent"}`);
  printLine(`Follow-up message: ${loopOutput.delivery?.textResult?.ok ? "sent" : "not sent"}`);

  if (!loopOutput.delivery?.sent) {
    throw new Error(loopOutput.delivery?.error || "Delivery failed before callback polling could start.");
  }

  const followUpMessageId = loopOutput.delivery.textResult?.messageId;
  printLine(`Voice message ID: ${loopOutput.delivery.voiceResult?.messageId ?? "n/a"}`);
  printLine(`Follow-up message ID: ${followUpMessageId ?? "n/a"}`);

  printHeader("📲 Step 7: Wait For Telegram Callback");
  printLine("Polling started. Click one of the inline buttons on the follow-up message.");
  const callbackHandler = new TelegramCallbackHandler({
    botToken,
    chatId,
  });
  const callbackWait = await waitForSingleCallback(callbackHandler, followUpMessageId);

  if (callbackWait.status === "handled") {
    printLine(`Handled in ${formatMs(callbackWait.elapsedMs)}`);
    printLine(`Action: ${callbackWait.result.action}`);
    printLine(`Result: ${callbackWait.result.ok ? "ok" : "failed"}`);
    if (callbackWait.result.error) {
      printLine(`Detail: ${callbackWait.result.error}`);
    }
  } else {
    printLine(`No button click received after ${formatMs(callbackWait.elapsedMs)}.`);
  }

  printHeader("✅ Summary");
  printLine(`Signal: ${signal.title}`);
  printLine(`Default policy decision: ${defaultPolicy.value.attentionLevel}`);
  printLine(`Demo delivery decision: ${loopOutput.decision.attentionLevel}`);
  printLine(`Audio provider: ${loopOutput.audio?.provider ?? "unavailable"}`);
  printLine(`Audio format: ${loopOutput.audio?.format ?? "n/a"}`);
  printLine(`Delivered: ${loopOutput.delivered ? "yes" : "no"}`);
  if (callbackWait.status === "handled") {
    printLine(`Callback action: ${callbackWait.result.action}`);
    printLine(`Callback success: ${callbackWait.result.ok ? "yes" : "no"}`);
  } else {
    printLine("Callback action: timed out");
  }
  printLine(`Total runtime: ${formatMs(performance.now() - runStartedAt)}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  printHeader("❌ Demo Failed");
  printLine(message);
  process.exitCode = 1;
});
