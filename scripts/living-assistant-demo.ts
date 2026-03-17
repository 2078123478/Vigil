import fs from "node:fs";
import path from "node:path";
import { defaultContactPolicyConfig, type ContactPolicyConfig, type UserContext } from "../src/skills/alphaos/living-assistant/contact-policy";
import { DigestBatchScheduler, type DigestBatch } from "../src/skills/alphaos/living-assistant/digest-batching";
import {
  TelegramVoiceSender,
  VoiceDeliveryOrchestrator,
  buildVoiceRoutePolicy,
  type DeliveryExecutorConfig,
  type DeliveryResult,
  type VoiceRouteAction,
  type VoiceRouteAttentionLevel,
  type VoiceRoutePolicy,
} from "../src/skills/alphaos/living-assistant/delivery";
import { runLivingAssistantLoop } from "../src/skills/alphaos/living-assistant/loop";
import { normalizeSignal, pollBinanceAnnouncements, pollBinanceSquare, type NormalizedSignal } from "../src/skills/alphaos/living-assistant/signal-radar";
import {
  createTTSProvider,
  type TTSOptions,
  type TTSProvider,
  type TTSProviderConfig,
} from "../src/skills/alphaos/living-assistant/tts";

interface DemoScenarioFixture {
  name: string;
  description: string;
  signal: unknown;
  userContext: UserContext;
  policyConfig?: Partial<ContactPolicyConfig>;
}

interface LoadedDemoScenario {
  name: string;
  description: string;
  signal: NormalizedSignal;
  userContext: UserContext;
  policyConfig?: Partial<ContactPolicyConfig>;
}

interface DemoCliOptions {
  live: boolean;
  dryRun: boolean;
  send: boolean;
  call: boolean;
  demoDelivery: boolean;
}

interface DemoRuntime {
  ttsProvider?: TTSProvider;
  ttsOptions?: TTSOptions;
  deliveryExecutor?: DeliveryExecutorConfig;
  callProviders?: string[];
  callRouteProfile?: CallRouteProfile;
  callRoute?: Array<{
    channel: CallChannel;
    simulated: boolean;
  }>;
  callPreflight?: CallEnvPreflight;
  callDemoDelivery?: boolean;
}

type CallChannel = "twilio" | "aliyun" | "telegram";
type CallRouteProfile = "balanced" | "telegram-escalation" | "direct-call-only";
type EnvReadiness = "ready" | "incomplete" | "not_configured";

interface CallChannelEnv {
  channel: CallChannel;
  readiness: EnvReadiness;
  provided: boolean;
  missing: string[];
}

interface TwilioEnvConfig extends CallChannelEnv {
  channel: "twilio";
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  toNumber?: string;
}

interface AliyunEnvConfig extends CallChannelEnv {
  channel: "aliyun";
  accessKeyId?: string;
  accessKeySecret?: string;
  calledShowNumber?: string;
  calledNumber?: string;
  ttsCode?: string;
  endpoint?: string;
}

interface TelegramEnvConfig extends CallChannelEnv {
  channel: "telegram";
  botToken?: string;
  chatId?: string;
}

interface CallEnvPreflight {
  twilio: TwilioEnvConfig;
  aliyun: AliyunEnvConfig;
  telegram: TelegramEnvConfig;
}

interface BuildCallRuntimeOptions {
  demoDelivery?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface LoopScenarioInput {
  name: string;
  description: string;
  signal: NormalizedSignal;
  userContext: UserContext;
  policyConfig?: Partial<ContactPolicyConfig>;
}

const SEND_FIXTURE_SCENARIO = "proactive-arbitrage-alert";
const CALL_FIXTURE_SCENARIO = "critical-risk-escalation";
const SUPPORTED_CALL_ROUTE_PROFILES: CallRouteProfile[] = [
  "balanced",
  "telegram-escalation",
  "direct-call-only",
];
const CALL_ROUTE_ACTIONS: VoiceRouteAction[] = [
  "telegram_text",
  "telegram_voice",
  "twilio_call",
  "aliyun_call",
];
const CALL_ROUTE_ENV_BY_LEVEL: Record<VoiceRouteAttentionLevel, string> = {
  text_nudge: "CALL_ROUTE_TEXT_NUDGE",
  voice_brief: "CALL_ROUTE_VOICE_BRIEF",
  strong_interrupt: "CALL_ROUTE_STRONG_INTERRUPT",
  call_escalation: "CALL_ROUTE_CALL_ESCALATION",
};
const CALL_ROUTE_PROFILE_OVERRIDES: Record<CallRouteProfile, Partial<VoiceRoutePolicy>> = {
  balanced: {},
  "telegram-escalation": {
    call_escalation: ["telegram_voice", "twilio_call", "aliyun_call"],
  },
  "direct-call-only": {
    call_escalation: ["twilio_call", "aliyun_call"],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSafeFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadDemoScenarios(
  fixtureDir = path.resolve(process.cwd(), "fixtures", "demo-scenarios"),
): LoadedDemoScenario[] {
  const files = fs
    .readdirSync(fixtureDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return files.map((fileName) => {
    const filePath = path.resolve(fixtureDir, fileName);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`Invalid scenario payload: ${fileName}`);
    }

    const fixture = parsed as unknown as DemoScenarioFixture;
    const scenarioName =
      typeof fixture.name === "string" && fixture.name.trim()
        ? fixture.name.trim()
        : fileName.replace(/\.json$/i, "");

    return {
      name: scenarioName,
      description: typeof fixture.description === "string" ? fixture.description : "",
      signal: normalizeSignal(fixture.signal as never),
      userContext: fixture.userContext,
      policyConfig: fixture.policyConfig,
    };
  });
}

function formatDurationMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function printUsageAndExit(): never {
  console.log("Usage: npm run demo:living-assistant -- [--live] [--dry-run|--send|--call [--demo-delivery]]");
  console.log("");
  console.log("Flags:");
  console.log("  --live     Poll real Binance announcements and run one loop per signal");
  console.log("  --dry-run  Print decision/brief only (default)");
  console.log("  --send     Run real delivery (requires TTS and Telegram env vars)");
  console.log("  --call     Run phone delivery via configurable Twilio/Aliyun/Telegram route policy");
  console.log("  --demo-delivery  Simulate delivery results in --call mode without outbound API calls");
  process.exit(0);
}

export function parseCliOptions(argv = process.argv.slice(2)): DemoCliOptions {
  const knownFlags = new Set(["--live", "--dry-run", "--send", "--call", "--demo-delivery", "--help", "-h"]);
  for (const arg of argv) {
    if (!knownFlags.has(arg)) {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    printUsageAndExit();
  }

  const send = argv.includes("--send");
  const call = argv.includes("--call");
  const demoDelivery = argv.includes("--demo-delivery");
  const dryRunFlag = argv.includes("--dry-run");
  if (send && call) {
    throw new Error("Cannot combine --send and --call");
  }
  if (send && dryRunFlag) {
    throw new Error("Cannot combine --send and --dry-run");
  }
  if (call && dryRunFlag) {
    throw new Error("Cannot combine --call and --dry-run");
  }
  if (demoDelivery && !call) {
    throw new Error("--demo-delivery requires --call");
  }

  return {
    live: argv.includes("--live"),
    dryRun: !send && !call,
    send,
    call,
    demoDelivery,
  };
}

function readTTSProviderType(env: NodeJS.ProcessEnv = process.env): TTSProviderConfig["type"] {
  const raw = readOptionalEnv("TTS_PROVIDER", env);
  if (!raw) {
    return "openai-compatible";
  }

  if (raw === "openai-compatible" || raw === "dashscope-qwen") {
    return raw;
  }

  throw new Error(
    `Unsupported TTS_PROVIDER: ${raw}. Supported values: openai-compatible, dashscope-qwen`,
  );
}

function readOptionalTTSLanguage(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): TTSOptions["language"] | undefined {
  const value = readOptionalEnv(name, env)?.toLowerCase();
  if (!value) {
    return undefined;
  }
  return value === "zh" || value === "en" ? value : undefined;
}

function normalizeTTSFormat(format: string | undefined, fallback: TTSOptions["format"]): TTSOptions["format"] {
  if (!format) {
    return fallback;
  }
  const normalized = format.trim().toLowerCase();
  if (normalized === "wav" || normalized === "ogg") {
    return normalized;
  }
  return "mp3";
}

function buildOptionalTTS(env: NodeJS.ProcessEnv = process.env): DemoRuntime {
  const providerType = readTTSProviderType(env);
  const apiKey = readOptionalEnv("TTS_API_KEY", env);
  const model = readOptionalEnv("TTS_MODEL", env);
  const voice = readOptionalEnv("TTS_VOICE", env);
  const language = readOptionalTTSLanguage("TTS_LANGUAGE", env);
  const instructions = readOptionalEnv("TTS_INSTRUCTIONS", env);
  const optimizeInstructions = readOptionalBoolean("TTS_OPTIMIZE_INSTRUCTIONS", env);

  if (providerType === "dashscope-qwen") {
    if (!apiKey) {
      return {};
    }

    const endpoint = readOptionalEnv("TTS_DASHSCOPE_ENDPOINT", env);
    const languageType = readOptionalEnv("TTS_DASHSCOPE_LANGUAGE_TYPE", env);
    const format = normalizeTTSFormat(readOptionalEnv("TTS_FORMAT", env), "wav");
    return {
      ttsProvider: createTTSProvider({
        type: "dashscope-qwen",
        apiKey,
        ...(endpoint ? { endpoint } : {}),
        ...(model ? { model } : {}),
        ...(voice ? { defaultVoice: voice } : {}),
        ...(languageType ? { languageType } : {}),
        ...(instructions ? { defaultInstructions: instructions } : {}),
        ...(typeof optimizeInstructions === "boolean" ? { optimizeInstructions } : {}),
        defaultFormat: format,
      }),
      ttsOptions: {
        format,
        ...(voice ? { voice } : {}),
        ...(language ? { language } : {}),
        ...(instructions ? { instructions } : {}),
        ...(typeof optimizeInstructions === "boolean" ? { optimizeInstructions } : {}),
      },
    };
  }

  const baseUrl = readOptionalEnv("TTS_BASE_URL", env);
  if (!baseUrl || !apiKey) {
    return {};
  }

  const format = normalizeTTSFormat(readOptionalEnv("TTS_FORMAT", env), "mp3");
  return {
    ttsProvider: createTTSProvider({
      type: "openai-compatible",
      baseUrl,
      apiKey,
      ...(model ? { model } : {}),
      ...(voice ? { defaultVoice: voice } : {}),
      defaultFormat: format,
    }),
    ttsOptions: {
      format,
      ...(voice ? { voice } : {}),
      ...(language ? { language } : {}),
    },
  };
}

function buildSendRuntime(): DemoRuntime {
  const runtime = buildOptionalTTS(process.env);
  if (!runtime.ttsProvider) {
    throw new Error(
      "--send requires TTS provider env: openai-compatible needs TTS_BASE_URL + TTS_API_KEY, dashscope-qwen needs TTS_API_KEY",
    );
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) {
    throw new Error("--send requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");
  }

  runtime.deliveryExecutor = {
    telegramSender: new TelegramVoiceSender({
      botToken,
      chatId,
    }),
  };
  return runtime;
}

function readOptionalEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalPositiveInt(name: string, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = readOptionalEnv(name, env);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : undefined;
}

function readOptionalBoolean(name: string, env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  const value = readOptionalEnv(name, env);
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function readCallRouteProfile(env: NodeJS.ProcessEnv = process.env): CallRouteProfile {
  const value = readOptionalEnv("CALL_ROUTE_PROFILE", env);
  if (!value) {
    return "balanced";
  }

  const normalized = value.toLowerCase();
  if (SUPPORTED_CALL_ROUTE_PROFILES.includes(normalized as CallRouteProfile)) {
    return normalized as CallRouteProfile;
  }

  throw new Error(
    `Unsupported CALL_ROUTE_PROFILE: ${value}. Supported values: ${SUPPORTED_CALL_ROUTE_PROFILES.join(", ")}`,
  );
}

function parseRouteActionsCsv(raw: string, envName: string): VoiceRouteAction[] {
  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (parsed.length === 0) {
    throw new Error(
      `${envName} is set but empty. Use a comma-separated list of: ${CALL_ROUTE_ACTIONS.join(", ")}`,
    );
  }

  for (const action of parsed) {
    if (!CALL_ROUTE_ACTIONS.includes(action as VoiceRouteAction)) {
      throw new Error(
        `Unsupported ${envName} action: ${action}. Supported actions: ${CALL_ROUTE_ACTIONS.join(", ")}`,
      );
    }
  }

  return parsed as VoiceRouteAction[];
}

function resolveCallRoutePolicy(
  env: NodeJS.ProcessEnv = process.env,
): {
  profile: CallRouteProfile;
  policy: VoiceRoutePolicy;
} {
  const profile = readCallRouteProfile(env);
  const profileOverride = CALL_ROUTE_PROFILE_OVERRIDES[profile];
  const policy = buildVoiceRoutePolicy(profileOverride);

  for (const level of Object.keys(CALL_ROUTE_ENV_BY_LEVEL) as VoiceRouteAttentionLevel[]) {
    const envName = CALL_ROUTE_ENV_BY_LEVEL[level];
    const raw = readOptionalEnv(envName, env);
    if (!raw) {
      continue;
    }
    policy[level] = parseRouteActionsCsv(raw, envName);
  }

  return {
    profile,
    policy,
  };
}

function toCallChannel(action: VoiceRouteAction): CallChannel {
  if (action === "twilio_call") {
    return "twilio";
  }
  if (action === "aliyun_call") {
    return "aliyun";
  }
  return "telegram";
}

function evaluateTwilioEnv(env: NodeJS.ProcessEnv): TwilioEnvConfig {
  const accountSid = readOptionalEnv("TWILIO_ACCOUNT_SID", env);
  const authToken = readOptionalEnv("TWILIO_AUTH_TOKEN", env);
  const fromNumber = readOptionalEnv("TWILIO_FROM_NUMBER", env);
  const toNumber = readOptionalEnv("TWILIO_TO_NUMBER", env) ?? readOptionalEnv("TWILIO_DEFAULT_TO_NUMBER", env);
  const provided = [accountSid, authToken, fromNumber, toNumber].some(Boolean);
  const missing: string[] = [];

  if (provided) {
    if (!accountSid) {
      missing.push("TWILIO_ACCOUNT_SID");
    }
    if (!authToken) {
      missing.push("TWILIO_AUTH_TOKEN");
    }
    if (!fromNumber) {
      missing.push("TWILIO_FROM_NUMBER");
    }
    if (!toNumber) {
      missing.push("TWILIO_TO_NUMBER(or TWILIO_DEFAULT_TO_NUMBER)");
    }
  }

  return {
    channel: "twilio",
    readiness: provided ? (missing.length === 0 ? "ready" : "incomplete") : "not_configured",
    provided,
    missing,
    accountSid,
    authToken,
    fromNumber,
    toNumber,
  };
}

function evaluateAliyunEnv(env: NodeJS.ProcessEnv): AliyunEnvConfig {
  const accessKeyId = readOptionalEnv("ALIYUN_ACCESS_KEY_ID", env);
  const accessKeySecret = readOptionalEnv("ALIYUN_ACCESS_KEY_SECRET", env);
  const calledShowNumber = readOptionalEnv("ALIYUN_CALLED_SHOW_NUMBER", env);
  const calledNumber = readOptionalEnv("ALIYUN_CALLED_NUMBER", env);
  const ttsCode = readOptionalEnv("ALIYUN_TTS_CODE", env);
  const endpoint = readOptionalEnv("ALIYUN_ENDPOINT", env);
  const provided = [accessKeyId, accessKeySecret, calledShowNumber, calledNumber, ttsCode].some(Boolean);
  const missing: string[] = [];

  if (provided) {
    if (!accessKeyId) {
      missing.push("ALIYUN_ACCESS_KEY_ID");
    }
    if (!accessKeySecret) {
      missing.push("ALIYUN_ACCESS_KEY_SECRET");
    }
    if (!calledShowNumber) {
      missing.push("ALIYUN_CALLED_SHOW_NUMBER");
    }
    if (!calledNumber) {
      missing.push("ALIYUN_CALLED_NUMBER");
    }
    if (!ttsCode) {
      missing.push("ALIYUN_TTS_CODE");
    }
  }

  return {
    channel: "aliyun",
    readiness: provided ? (missing.length === 0 ? "ready" : "incomplete") : "not_configured",
    provided,
    missing,
    accessKeyId,
    accessKeySecret,
    calledShowNumber,
    calledNumber,
    ttsCode,
    endpoint,
  };
}

function evaluateTelegramEnv(env: NodeJS.ProcessEnv): TelegramEnvConfig {
  const botToken = readOptionalEnv("TELEGRAM_BOT_TOKEN", env);
  const chatId = readOptionalEnv("TELEGRAM_CHAT_ID", env);
  const provided = Boolean(botToken || chatId);
  const missing: string[] = [];

  if (provided) {
    if (!botToken) {
      missing.push("TELEGRAM_BOT_TOKEN");
    }
    if (!chatId) {
      missing.push("TELEGRAM_CHAT_ID");
    }
  }

  return {
    channel: "telegram",
    readiness: provided ? (missing.length === 0 ? "ready" : "incomplete") : "not_configured",
    provided,
    missing,
    botToken,
    chatId,
  };
}

function collectCallEnvPreflight(env: NodeJS.ProcessEnv = process.env): CallEnvPreflight {
  return {
    twilio: evaluateTwilioEnv(env),
    aliyun: evaluateAliyunEnv(env),
    telegram: evaluateTelegramEnv(env),
  };
}

function envStateLabel(status: CallChannelEnv): string {
  if (status.readiness === "ready") {
    return "ready";
  }
  if (status.readiness === "not_configured") {
    return "not_configured";
  }
  return `incomplete (missing: ${status.missing.join(", ")})`;
}

function assertCompleteEnv(channelLabel: string, status: CallChannelEnv): void {
  if (status.readiness !== "incomplete") {
    return;
  }
  throw new Error(
    `--call ${channelLabel} config is incomplete: missing ${status.missing.join(", ")}. Fill all required vars or clear partial ${channelLabel} env values.`,
  );
}

function buildNoProviderError(preflight: CallEnvPreflight): Error {
  return new Error(
    [
      "--call requires at least one ready call provider (Twilio or Aliyun).",
      `Twilio: ${envStateLabel(preflight.twilio)}`,
      `Aliyun: ${envStateLabel(preflight.aliyun)}`,
      "Tip: use --call --demo-delivery to rehearse the call path before live credentials are ready.",
    ].join("\n"),
  );
}

const DEMO_TWILIO_CONFIG = {
  accountSid: "ACDEMO000000000000000000000000000000",
  authToken: "demo-auth-token",
  fromNumber: "+12025550100",
  defaultToNumber: "+12025550200",
};

const DEMO_TELEGRAM_CONFIG = {
  botToken: "demo-telegram-bot-token",
  chatId: "demo-chat-id",
};

export function buildCallRuntime(options: BuildCallRuntimeOptions = {}): DemoRuntime {
  const env = options.env ?? process.env;
  const demoDelivery = options.demoDelivery === true;
  const runtime = buildOptionalTTS(env);
  const preflight = collectCallEnvPreflight(env);
  const routePolicy = resolveCallRoutePolicy(env);

  assertCompleteEnv("Twilio", preflight.twilio);
  assertCompleteEnv("Aliyun", preflight.aliyun);
  assertCompleteEnv("Telegram", preflight.telegram);

  const liveCallProviders: Array<"twilio" | "aliyun"> = [];
  if (preflight.twilio.readiness === "ready") {
    liveCallProviders.push("twilio");
  }
  if (preflight.aliyun.readiness === "ready") {
    liveCallProviders.push("aliyun");
  }
  if (liveCallProviders.length === 0 && !demoDelivery) {
    throw buildNoProviderError(preflight);
  }

  const twilioEnabled = preflight.twilio.readiness === "ready" || (demoDelivery && liveCallProviders.length === 0);
  const aliyunEnabled = preflight.aliyun.readiness === "ready";
  const telegramEnabled = preflight.telegram.readiness === "ready" || demoDelivery;

  const channelState: Record<CallChannel, { enabled: boolean; simulated: boolean }> = {
    twilio: {
      enabled: twilioEnabled,
      simulated: preflight.twilio.readiness !== "ready",
    },
    aliyun: {
      enabled: aliyunEnabled,
      simulated: false,
    },
    telegram: {
      enabled: telegramEnabled,
      simulated: preflight.telegram.readiness !== "ready",
    },
  };

  const seenChannels = new Set<CallChannel>();
  const callRoute: Array<{ channel: CallChannel; simulated: boolean }> = [];
  for (const action of routePolicy.policy.call_escalation) {
    const channel = toCallChannel(action);
    if (seenChannels.has(channel)) {
      continue;
    }

    const state = channelState[channel];
    if (!state.enabled) {
      continue;
    }

    callRoute.push({
      channel,
      simulated: state.simulated,
    });
    seenChannels.add(channel);
  }

  if (callRoute.length === 0) {
    throw new Error(
      [
        "--call route policy produced no enabled channels for call_escalation.",
        `Profile: ${routePolicy.profile}`,
        "Set CALL_ROUTE_PROFILE and/or CALL_ROUTE_CALL_ESCALATION so at least one enabled channel is selected.",
      ].join("\n"),
    );
  }

  const voiceOrchestrator = new VoiceDeliveryOrchestrator({
    ...(telegramEnabled
      ? {
          telegram:
            preflight.telegram.readiness === "ready"
              ? {
                  botToken: preflight.telegram.botToken!,
                  chatId: preflight.telegram.chatId!,
                }
              : DEMO_TELEGRAM_CONFIG,
        }
      : {}),
    ...(twilioEnabled
      ? {
          twilio:
            preflight.twilio.readiness === "ready"
              ? {
                  accountSid: preflight.twilio.accountSid!,
                  authToken: preflight.twilio.authToken!,
                  fromNumber: preflight.twilio.fromNumber!,
                  defaultToNumber: preflight.twilio.toNumber!,
                }
              : DEMO_TWILIO_CONFIG,
        }
      : {}),
    ...(aliyunEnabled
      ? {
          aliyun: {
            accessKeyId: preflight.aliyun.accessKeyId!,
            accessKeySecret: preflight.aliyun.accessKeySecret!,
            calledShowNumber: preflight.aliyun.calledShowNumber!,
            defaultCalledNumber: preflight.aliyun.calledNumber!,
            ttsCode: preflight.aliyun.ttsCode!,
            ...(preflight.aliyun.endpoint ? { endpoint: preflight.aliyun.endpoint } : {}),
          },
        }
      : {}),
    routePolicy: routePolicy.policy,
  });

  runtime.deliveryExecutor = {
    voiceOrchestrator,
    ...(preflight.telegram.readiness === "ready"
      ? {
          telegramSender: new TelegramVoiceSender({
            botToken: preflight.telegram.botToken!,
            chatId: preflight.telegram.chatId!,
          }),
        }
      : {}),
    ...(demoDelivery
      ? {
          voiceOrchestratorOptions: {
            demoMode: true,
          },
        }
      : {}),
  };
  runtime.callProviders = callRoute
    .filter((step) => step.channel === "twilio" || step.channel === "aliyun")
    .map((step) => step.channel);
  runtime.callRouteProfile = routePolicy.profile;
  runtime.callRoute = callRoute;
  runtime.callPreflight = preflight;
  runtime.callDemoDelivery = demoDelivery;
  return runtime;
}

function resolveLiveContext(
  scenarios: LoadedDemoScenario[],
): Pick<LoadedDemoScenario, "userContext" | "policyConfig"> {
  const preferred = scenarios.find((scenario) => scenario.name === SEND_FIXTURE_SCENARIO);
  if (preferred) {
    return {
      userContext: preferred.userContext,
      policyConfig: preferred.policyConfig,
    };
  }

  const fallback = scenarios[0];
  if (!fallback) {
    throw new Error("At least one fixture scenario is required to provide userContext for --live mode");
  }

  return {
    userContext: fallback.userContext,
    policyConfig: fallback.policyConfig,
  };
}

function preflightStateLabel(status: CallChannelEnv): string {
  if (status.readiness === "ready") {
    return "ready";
  }
  if (status.readiness === "not_configured") {
    return "not configured";
  }
  return `incomplete (missing: ${status.missing.join(", ")})`;
}

function printCallPreflight(
  preflight: CallEnvPreflight,
  demoDelivery: boolean,
  routeProfile?: CallRouteProfile,
): void {
  console.log("Call preflight:");
  console.log(`- Twilio: ${preflightStateLabel(preflight.twilio)}`);
  console.log(`- Aliyun: ${preflightStateLabel(preflight.aliyun)}`);
  console.log(`- Telegram: ${preflightStateLabel(preflight.telegram)}`);
  if (routeProfile) {
    console.log(`- Route profile: ${routeProfile}`);
  }
  if (demoDelivery) {
    console.log("- Delivery demo mode: enabled (simulated channel results, outbound APIs are not called)");
  }
}

function callRouteLabel(step: { channel: CallChannel; simulated: boolean }): string {
  return step.simulated ? `${step.channel}(simulated)` : step.channel;
}

function readChannelReference(detail: unknown): string | undefined {
  if (!isRecord(detail)) {
    return undefined;
  }
  if (typeof detail.callSid === "string") {
    return `callSid=${detail.callSid}`;
  }
  if (typeof detail.callId === "string") {
    return `callId=${detail.callId}`;
  }
  if (typeof detail.messageId === "number") {
    return `messageId=${detail.messageId}`;
  }
  return undefined;
}

function readChannelError(detail: unknown): string | undefined {
  if (!isRecord(detail)) {
    return undefined;
  }
  return typeof detail.error === "string" ? detail.error : undefined;
}

function printDeliveryResult(delivery?: DeliveryResult): {
  attempted: boolean;
  sent: boolean;
  failed: boolean;
} {
  if (!delivery) {
    console.log("Delivery: skipped");
    return {
      attempted: false,
      sent: false,
      failed: false,
    };
  }

  console.log(`Delivery: sent=${delivery.sent}, channel=${delivery.channel}, dryRun=${delivery.dryRun}`);
  if (Array.isArray(delivery.orchestratorResults) && delivery.orchestratorResults.length > 0) {
    for (const item of delivery.orchestratorResults) {
      const statusParts = [item.ok ? "ok" : "failed"];
      const ref = readChannelReference(item.detail);
      if (ref) {
        statusParts.push(ref);
      }
      const detailError = readChannelError(item.detail);
      if (!item.ok && detailError) {
        statusParts.push(`error=${detailError}`);
      }
      console.log(`Delivery channel: ${item.channel}, ${statusParts.join(", ")}`);
    }
  }

  if (delivery.voiceResult) {
    const voiceRef = readChannelReference(delivery.voiceResult);
    const voiceError = readChannelError(delivery.voiceResult);
    console.log(
      `Delivery voice result: ${delivery.voiceResult.ok ? "ok" : "failed"}${voiceRef ? `, ${voiceRef}` : ""}${voiceError ? `, error=${voiceError}` : ""}`,
    );
  }
  if (delivery.textResult) {
    const textRef = readChannelReference(delivery.textResult);
    const textError = readChannelError(delivery.textResult);
    console.log(
      `Delivery text result: ${delivery.textResult.ok ? "ok" : "failed"}${textRef ? `, ${textRef}` : ""}${textError ? `, error=${textError}` : ""}`,
    );
  }
  if (delivery.error) {
    console.log(`Delivery error: ${delivery.error}`);
  }

  return {
    attempted: true,
    sent: delivery.sent,
    failed: !delivery.sent,
  };
}

function printDigestBatch(digest: DigestBatch, label: string): void {
  console.log(
    `${label}: digestId=${digest.digestId}, signals=${digest.signalCount}, window=${digest.windowStartedAt} -> ${digest.windowEndedAt}`,
  );
  if (digest.highlights.length > 0) {
    for (const highlight of digest.highlights) {
      console.log(`Digest highlight: ${highlight}`);
    }
  }
  console.log(`Digest summary:\n${digest.text}`);
}

async function runLoopScenario(
  scenario: LoopScenarioInput,
  runtime: DemoRuntime,
  digestScheduler: DigestBatchScheduler,
  demoMode: boolean,
  outputDir?: string,
): Promise<{
  briefGenerated: boolean;
  audioWritten: boolean;
  loopTotalMs: number;
  deliveryAttempted: boolean;
  deliverySent: boolean;
  deliveryFailed: boolean;
  digestQueued: boolean;
  digestQueueSize: number;
  digestFlushed?: DigestBatch;
}> {
  const loopOutput = await runLivingAssistantLoop({
    signal: scenario.signal,
    userContext: scenario.userContext,
    policyConfig: {
      ...defaultContactPolicyConfig,
      ...(scenario.policyConfig ?? {}),
    },
    digestScheduler,
    demoMode,
    ...(runtime.ttsProvider ? { ttsProvider: runtime.ttsProvider, ttsOptions: runtime.ttsOptions } : {}),
    ...(runtime.deliveryExecutor ? { deliveryExecutor: runtime.deliveryExecutor } : {}),
  });

  console.log(`Signal: source=${loopOutput.signal.source}, type=${loopOutput.signal.type}, title=${loopOutput.signal.title}, urgency=${loopOutput.signal.urgency}`);
  console.log(
    `Decision: attentionLevel=${loopOutput.decision.attentionLevel}, shouldContact=${loopOutput.decision.shouldContact}, reason=${loopOutput.decision.reason}, channels=${loopOutput.decision.channels.join("|") || "none"}`,
  );

  if (loopOutput.brief?.text) {
    console.log(`Brief: ${loopOutput.brief.text}`);
  } else {
    console.log("Brief: not generated");
  }

  let audioWritten = false;
  if (loopOutput.audio?.audio && outputDir) {
    const filePath = path.resolve(
      outputDir,
      `${toSafeFileName(`${scenario.name}-${loopOutput.signal.signalId}`)}.${loopOutput.audio.format}`,
    );
    fs.writeFileSync(filePath, loopOutput.audio.audio);
    audioWritten = true;
    console.log(`Audio file: ${filePath}`);
  }

  if (loopOutput.audio?.audioUrl) {
    console.log(`Audio URL: ${loopOutput.audio.audioUrl}`);
  }

  if (!loopOutput.audio || (!loopOutput.audio.audio && !loopOutput.audio.audioUrl)) {
    console.log("Audio: not generated");
  }

  const deliveryStats = !demoMode
    ? printDeliveryResult(loopOutput.delivery)
    : {
        attempted: false,
        sent: false,
        failed: false,
      };

  if (loopOutput.digestFlushed) {
    printDigestBatch(loopOutput.digestFlushed, "Digest flush (due)");
  }
  const digestQueueSize = loopOutput.digestQueue?.size ?? 0;
  if (loopOutput.digestEnqueued) {
    console.log(
      `Digest queue: enqueued signalId=${loopOutput.digestEnqueued.signalId}, size=${digestQueueSize}, nextFlushAt=${loopOutput.digestQueue?.nextFlushAt ?? "n/a"}`,
    );
  } else if (digestQueueSize > 0) {
    console.log(`Digest queue: size=${digestQueueSize}, nextFlushAt=${loopOutput.digestQueue?.nextFlushAt ?? "n/a"}`);
  }

  console.log(
    `Timing: policy=${formatDurationMs(loopOutput.timings.policyMs)}, brief=${formatDurationMs(loopOutput.timings.briefMs)}, tts=${formatDurationMs(loopOutput.timings.ttsMs)}, delivery=${formatDurationMs(loopOutput.timings.deliveryMs)}, total=${formatDurationMs(loopOutput.timings.totalMs)}`,
  );
  console.log(`Loop status: demoMode=${loopOutput.demoMode}, loopCompletedAt=${loopOutput.loopCompletedAt}`);

  return {
    briefGenerated: Boolean(loopOutput.brief),
    audioWritten,
    loopTotalMs: loopOutput.timings.totalMs,
    deliveryAttempted: deliveryStats.attempted,
    deliverySent: deliveryStats.sent,
    deliveryFailed: deliveryStats.failed,
    digestQueued: Boolean(loopOutput.digestEnqueued),
    digestQueueSize,
    digestFlushed: loopOutput.digestFlushed,
  };
}

async function main(): Promise<void> {
  console.log("Personal Butler — Living Assistant Demo");
  const cli = parseCliOptions();
  const executionMode = cli.send ? "send" : cli.call ? (cli.demoDelivery ? "call-demo" : "call") : "dry-run";
  console.log(`Mode: source=${cli.live ? "live" : "fixture"}, execution=${executionMode}`);

  const demoMode = cli.dryRun;
  const runtime = cli.send ? buildSendRuntime() : cli.call ? buildCallRuntime({ demoDelivery: cli.demoDelivery }) : {};
  const digestScheduler = new DigestBatchScheduler();
  if (cli.call && runtime.callPreflight) {
    printCallPreflight(runtime.callPreflight, Boolean(runtime.callDemoDelivery), runtime.callRouteProfile);
  }
  if (cli.call && runtime.callRoute && runtime.callRoute.length > 0) {
    console.log(`Call route (call_escalation): ${runtime.callRoute.map(callRouteLabel).join(" -> ")}`);
  }
  const outputDir = runtime.ttsProvider ? path.resolve(process.cwd(), "demo-output") : undefined;
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const scenarios = loadDemoScenarios();
  let runScenarios: LoopScenarioInput[] = [];
  let pollDurationMs: number | undefined;

  if (cli.live) {
    const liveContext = resolveLiveContext(scenarios);
    const pollStartedAt = performance.now();
    const announcementPollStartedAt = performance.now();
    const announcementResult = await pollBinanceAnnouncements();
    const announcementPollDurationMs = performance.now() - announcementPollStartedAt;
    if (announcementResult.error) {
      pollDurationMs = performance.now() - pollStartedAt;
      console.error(`Poll error: ${announcementResult.error}`);
      process.exit(1);
    }

    const squareEndpoint = readOptionalEnv("BINANCE_SQUARE_ENDPOINT");
    const squarePageSize = readOptionalPositiveInt("BINANCE_SQUARE_PAGE_SIZE");
    const squareKeywordCsv = readOptionalEnv("BINANCE_SQUARE_KEYWORDS");
    const squareKeywords = squareKeywordCsv
      ? squareKeywordCsv
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    let squareSignals: NormalizedSignal[] = [];
    let squarePostCount = 0;
    let squareFetchedAt = "";
    let squarePollDurationMs: number | undefined;
    if (squareEndpoint) {
      const squarePollStartedAt = performance.now();
      const squareResult = await pollBinanceSquare({
        endpoint: squareEndpoint,
        ...(squarePageSize ? { pageSize: squarePageSize } : {}),
        ...(squareKeywords.length > 0 ? { includeKeywords: squareKeywords } : {}),
      });
      squarePollDurationMs = performance.now() - squarePollStartedAt;

      if (squareResult.error) {
        console.warn(`Square poll warning: ${squareResult.error}`);
      } else {
        squareSignals = squareResult.signals;
        squarePostCount = squareResult.postCount;
        squareFetchedAt = squareResult.fetchedAt;
      }
    } else {
      console.log("Live poll: BINANCE_SQUARE_ENDPOINT not set, skipping Square polling.");
    }

    pollDurationMs = performance.now() - pollStartedAt;

    console.log(
      `Live poll (announcements): fetchedAt=${announcementResult.fetchedAt}, articleCount=${announcementResult.articleCount}, newSignals=${announcementResult.signals.length}, duration=${formatDurationMs(announcementPollDurationMs)}`,
    );
    if (squareEndpoint) {
      console.log(
        `Live poll (square): fetchedAt=${squareFetchedAt || "n/a"}, postCount=${squarePostCount}, newSignals=${squareSignals.length}, duration=${typeof squarePollDurationMs === "number" ? formatDurationMs(squarePollDurationMs) : "n/a"}`,
      );
    }

    const liveSignals = [...announcementResult.signals, ...squareSignals].sort((a, b) => {
      const aTs = Date.parse(a.detectedAt);
      const bTs = Date.parse(b.detectedAt);
      const aValue = Number.isFinite(aTs) ? aTs : 0;
      const bValue = Number.isFinite(bTs) ? bTs : 0;
      return bValue - aValue;
    });

    if (liveSignals.length === 0) {
      console.log("No new live Binance announcement/Square signals.");
      return;
    }

    runScenarios = liveSignals.map((signal, index) => ({
      name: `live-signal-${signal.source}-${index + 1}`,
      description:
        signal.source === "binance_square"
          ? `Binance Square signal ${signal.signalId}`
          : `Binance announcement signal ${signal.signalId}`,
      signal,
      userContext: liveContext.userContext,
      policyConfig: liveContext.policyConfig,
    }));
  } else {
    runScenarios = cli.send
      ? scenarios.filter((scenario) => scenario.name === SEND_FIXTURE_SCENARIO)
      : cli.call
        ? scenarios.filter((scenario) => scenario.name === CALL_FIXTURE_SCENARIO)
        : scenarios;

    if (cli.send && runScenarios.length !== 1) {
      throw new Error(`--send in fixture mode requires scenario fixture: ${SEND_FIXTURE_SCENARIO}`);
    }
    if (cli.call && runScenarios.length !== 1) {
      throw new Error(`--call in fixture mode requires scenario fixture: ${CALL_FIXTURE_SCENARIO}`);
    }
  }

  let briefsGenerated = 0;
  let audioFilesWritten = 0;
  let loopTotalMs = 0;
  let deliveryAttempts = 0;
  let deliverySucceeded = 0;
  let deliveryFailed = 0;
  let digestSignalsQueued = 0;
  let digestFlushCount = 0;
  let digestSignalsFlushed = 0;
  let digestQueueSize = 0;

  for (const scenario of runScenarios) {
    console.log("");
    console.log(`Scenario: ${scenario.name}`);
    console.log(`Description: ${scenario.description}`);

    const runResult = await runLoopScenario(scenario, runtime, digestScheduler, demoMode, outputDir);
    if (runResult.briefGenerated) {
      briefsGenerated += 1;
    }
    if (runResult.audioWritten) {
      audioFilesWritten += 1;
    }
    if (runResult.deliveryAttempted) {
      deliveryAttempts += 1;
    }
    if (runResult.deliverySent) {
      deliverySucceeded += 1;
    }
    if (runResult.deliveryFailed) {
      deliveryFailed += 1;
    }
    if (runResult.digestQueued) {
      digestSignalsQueued += 1;
    }
    if (runResult.digestFlushed) {
      digestFlushCount += 1;
      digestSignalsFlushed += runResult.digestFlushed.signalCount;
    }
    digestQueueSize = runResult.digestQueueSize;
    loopTotalMs += runResult.loopTotalMs;
  }

  const finalDigest = digestScheduler.flushNow();
  if (finalDigest) {
    console.log("");
    printDigestBatch(finalDigest, "Digest flush (end-of-run)");
    digestFlushCount += 1;
    digestSignalsFlushed += finalDigest.signalCount;
    digestQueueSize = 0;
  }

  console.log("");
  const summaryParts = [
    `${runScenarios.length} loops run`,
    `${briefsGenerated} briefs generated`,
    `${audioFilesWritten} audio files created`,
    `loopTotal=${formatDurationMs(loopTotalMs)}`,
  ];
  if (typeof pollDurationMs === "number") {
    summaryParts.push(`poll=${formatDurationMs(pollDurationMs)}`);
  }
  if (deliveryAttempts > 0) {
    summaryParts.push(`delivery=${deliverySucceeded}/${deliveryAttempts} sent`);
  }
  if (deliveryFailed > 0) {
    summaryParts.push(`deliveryFailed=${deliveryFailed}`);
  }
  if (runtime.callDemoDelivery) {
    summaryParts.push("callDelivery=simulated");
  }
  if (digestSignalsQueued > 0 || digestFlushCount > 0 || digestQueueSize > 0) {
    summaryParts.push(`digestQueued=${digestSignalsQueued}`);
    summaryParts.push(`digestFlushes=${digestFlushCount}`);
    summaryParts.push(`digestSignalsFlushed=${digestSignalsFlushed}`);
    summaryParts.push(`digestPending=${digestQueueSize}`);
  }
  console.log(`Summary: ${summaryParts.join(", ")}`);
}

if (require.main === module) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
