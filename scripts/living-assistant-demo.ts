import fs from "node:fs";
import path from "node:path";
import { defaultContactPolicyConfig, type ContactPolicyConfig, type UserContext } from "../src/skills/alphaos/living-assistant/contact-policy";
import { TelegramVoiceSender, type DeliveryExecutorConfig } from "../src/skills/alphaos/living-assistant/delivery";
import { runLivingAssistantLoop } from "../src/skills/alphaos/living-assistant/loop";
import { normalizeSignal, type NormalizedSignal } from "../src/skills/alphaos/living-assistant/signal-radar";
import { createTTSProvider, type TTSOptions, type TTSProvider } from "../src/skills/alphaos/living-assistant/tts";

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

function buildOptionalTTS(): { ttsProvider?: TTSProvider; ttsOptions?: TTSOptions } {
  const baseUrl = process.env.TTS_BASE_URL?.trim();
  const apiKey = process.env.TTS_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    return {};
  }

  const model = process.env.TTS_MODEL?.trim() || undefined;
  const voice = process.env.TTS_VOICE?.trim() || undefined;
  return {
    ttsProvider: createTTSProvider({
      type: "openai-compatible",
      baseUrl,
      apiKey,
      model,
      defaultVoice: voice,
      defaultFormat: "mp3",
    }),
    ttsOptions: {
      format: "mp3",
      ...(voice ? { voice } : {}),
    },
  };
}

function toBooleanEnv(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function buildOptionalDelivery(ttsProvider?: TTSProvider): DeliveryExecutorConfig | undefined {
  if (!ttsProvider) {
    return undefined;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) {
    return undefined;
  }

  return {
    telegramSender: new TelegramVoiceSender({
      botToken,
      chatId,
    }),
  };
}

async function main(): Promise<void> {
  console.log("Personal Butler — Living Assistant Demo");

  const liveDelivery = toBooleanEnv("LIVE_DELIVERY");
  const scenarios = loadDemoScenarios();
  const runScenarios = liveDelivery
    ? scenarios.filter((scenario) => scenario.name === "proactive-arbitrage-alert")
    : scenarios;
  if (liveDelivery && runScenarios.length !== 1) {
    throw new Error("LIVE_DELIVERY requires scenario fixture: proactive-arbitrage-alert");
  }

  const { ttsProvider, ttsOptions } = buildOptionalTTS();
  const deliveryExecutor = buildOptionalDelivery(ttsProvider);
  if (liveDelivery && !ttsProvider) {
    throw new Error("LIVE_DELIVERY=true requires TTS_BASE_URL and TTS_API_KEY");
  }
  if (liveDelivery && !deliveryExecutor?.telegramSender) {
    throw new Error("LIVE_DELIVERY=true requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");
  }

  const outputDir = path.resolve(process.cwd(), "demo-output");
  if (ttsProvider) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let briefsGenerated = 0;
  let audioFilesCreated = 0;

  for (const scenario of runScenarios) {
    console.log("");
    console.log(`Scenario: ${scenario.name}`);
    console.log(`Description: ${scenario.description}`);

    const output = await runLivingAssistantLoop({
      signal: scenario.signal,
      userContext: scenario.userContext,
      policyConfig: {
        ...defaultContactPolicyConfig,
        ...(scenario.policyConfig ?? {}),
      },
      demoMode: !liveDelivery,
      ...(ttsProvider ? { ttsProvider, ttsOptions } : {}),
      ...(deliveryExecutor ? { deliveryExecutor } : {}),
    });

    console.log(`Signal: type=${output.signal.type}, title=${output.signal.title}, urgency=${output.signal.urgency}`);
    console.log(
      `Decision: attentionLevel=${output.decision.attentionLevel}, shouldContact=${output.decision.shouldContact}, reason=${output.decision.reason}, channels=${output.decision.channels.join("|") || "none"}`,
    );

    if (output.brief) {
      briefsGenerated += 1;
      console.log(
        `Brief: text=${output.brief.text}, estimatedDuration=${output.brief.estimatedDurationSeconds}s, protocolCompliant=${output.brief.protocolCompliant}`,
      );
    } else {
      console.log("Brief: not generated");
    }

    if (output.audio) {
      console.log(
        `Audio: format=${output.audio.format}, duration=${output.audio.durationSeconds}s, provider=${output.audio.provider}`,
      );
      const filePath = path.resolve(outputDir, `${toSafeFileName(scenario.name)}.mp3`);
      fs.writeFileSync(filePath, output.audio.audio);
      audioFilesCreated += 1;
      console.log(`Audio file: ${filePath}`);
    } else {
      console.log("Audio: not generated");
    }

    if (liveDelivery) {
      console.log(`Delivery: ${JSON.stringify(output.delivery ?? null)}`);
    }

    console.log(`Loop status: demoMode=${output.demoMode}, loopCompletedAt=${output.loopCompletedAt}`);
  }

  console.log("");
  console.log(
    `Summary: ${runScenarios.length} scenarios run, ${briefsGenerated} briefs generated, ${audioFilesCreated} audio files created`,
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
