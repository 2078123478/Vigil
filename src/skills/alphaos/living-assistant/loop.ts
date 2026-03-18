import { randomUUID } from "node:crypto";
import { evaluateContactPolicy } from "./contact-policy";
import type {
  AttentionLevel,
  ContactChannel,
  ContactPolicyConfig,
  UserContext,
} from "./contact-policy";
import type { DigestBatch, DigestBatchScheduler, DigestQueueItem, DigestQueueSnapshot } from "./digest-batching";
import { executeDelivery } from "./delivery/delivery-executor";
import type { DeliveryExecutorConfig, DeliveryResult } from "./delivery/delivery-executor";
import { generateNaturalBrief, runSignalTriage } from "./llm";
import type { TriageResult } from "./llm";
import type { NormalizedSignal } from "./signal-radar";
import type { TTSOptions, TTSProvider, TTSResult } from "./tts";
import { generateVoiceBrief } from "./voice-brief";
import { defaultVoiceBriefProtocol, validateVoiceBrief } from "./voice-brief";
import type { VoiceBrief, VoiceBriefProtocol } from "./voice-brief";

export interface LivingAssistantLoopInput {
  signal: NormalizedSignal;
  userContext: UserContext;
  policyConfig: ContactPolicyConfig;
  briefProtocol?: VoiceBriefProtocol;
  ttsProvider?: TTSProvider;
  ttsOptions?: TTSOptions;
  deliveryExecutor?: DeliveryExecutorConfig;
  digestScheduler?: DigestBatchScheduler;
  demoMode?: boolean;
  llmApiKey?: string;
  llmModel?: string;
  llmEnabled?: boolean;
}

export interface LivingAssistantLoopOutput {
  signal: NormalizedSignal;
  decision: ReturnType<typeof evaluateContactPolicy>;
  brief?: VoiceBrief;
  audio?: TTSResult;
  delivery?: DeliveryResult;
  delivered: boolean;
  deliveryChannel?: ContactChannel;
  demoMode: boolean;
  digestQueue?: DigestQueueSnapshot;
  digestEnqueued?: DigestQueueItem;
  digestFlushed?: DigestBatch;
  timings: {
    policyMs: number;
    briefMs: number;
    ttsMs: number;
    deliveryMs: number;
    totalMs: number;
  };
  loopCompletedAt: string;
}

const ATTENTION_RANK: Record<AttentionLevel, number> = {
  silent: 0,
  digest: 1,
  text_nudge: 2,
  voice_brief: 3,
  strong_interrupt: 4,
  call_escalation: 5,
};

function shouldGenerateBrief(attentionLevel: AttentionLevel): boolean {
  return ATTENTION_RANK[attentionLevel] >= ATTENTION_RANK.voice_brief;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toVoiceBriefFromText(
  signalId: string,
  attentionLevel: AttentionLevel,
  text: string,
  language: "zh" | "en",
  protocol?: VoiceBriefProtocol,
): VoiceBrief {
  const normalizedText = text.trim();
  const sentences = splitSentences(normalizedText);
  const parts = {
    whatHappened: sentences[0] ?? normalizedText,
    whyItMatters: sentences[1] ?? normalizedText,
    suggestedNext: sentences[2] ?? sentences[sentences.length - 1] ?? normalizedText,
  };
  const activeProtocol = protocol ?? defaultVoiceBriefProtocol;
  const validation = validateVoiceBrief(
    {
      text: normalizedText,
      parts,
      language,
    },
    activeProtocol,
  );

  return {
    briefId: randomUUID(),
    signalId,
    attentionLevel,
    text: normalizedText,
    parts,
    estimatedDurationSeconds: validation.estimatedDurationSeconds,
    sentenceCount: validation.sentenceCount,
    protocolCompliant: validation.protocolCompliant,
    violations: validation.violations.length > 0 ? validation.violations : undefined,
    language,
    generatedAt: new Date().toISOString(),
  };
}

function resolveBriefLanguage(input: LivingAssistantLoopInput): "zh" | "en" {
  return input.ttsOptions?.language === "zh" ? "zh" : "en";
}

export async function runLivingAssistantLoop(
  input: LivingAssistantLoopInput,
): Promise<LivingAssistantLoopOutput> {
  const loopStart = performance.now();

  const policyStart = performance.now();
  const decision = evaluateContactPolicy(input.signal, input.userContext, input.policyConfig);
  const policyMs = performance.now() - policyStart;

  let digestQueue: DigestQueueSnapshot | undefined;
  let digestEnqueued: DigestQueueItem | undefined;
  let digestFlushed: DigestBatch | undefined;

  if (input.digestScheduler) {
    digestFlushed = input.digestScheduler.flushDue();
  }

  if (decision.attentionLevel === "digest" && input.digestScheduler) {
    const enqueueResult = input.digestScheduler.enqueue({
      signal: input.signal,
      decision,
      digestWindowMinutes: input.policyConfig.digestWindowMinutes,
    });
    digestEnqueued = enqueueResult.item;
  }

  if (input.digestScheduler) {
    digestQueue = input.digestScheduler.getSnapshot();
  }

  const briefStart = performance.now();
  let brief: VoiceBrief | undefined;
  if (shouldGenerateBrief(decision.attentionLevel)) {
    const language = resolveBriefLanguage(input);
    const naturalText = await generateNaturalBrief(
      input.signal,
      decision,
      language,
      {
        llmApiKey: input.llmApiKey,
        llmModel: input.llmModel,
        llmEnabled: input.llmEnabled,
      },
    );

    if (naturalText.trim()) {
      brief = toVoiceBriefFromText(
        input.signal.signalId,
        decision.attentionLevel,
        naturalText,
        language,
        input.briefProtocol,
      );
    } else {
      brief = generateVoiceBrief(
        input.signal,
        decision,
        {
          language,
          ...(input.briefProtocol ? { protocol: input.briefProtocol } : {}),
        },
      );
    }
  }
  const briefMs = performance.now() - briefStart;

  const deliveryChannel = decision.channels[0];
  const demoMode = Boolean(input.demoMode);
  let audio: TTSResult | undefined;
  let delivery: DeliveryResult | undefined;
  let ttsMs = 0;
  let deliveryMs = 0;

  if (brief && input.ttsProvider) {
    const ttsStart = performance.now();
    try {
      audio = await input.ttsProvider.synthesize(brief.text, input.ttsOptions);
    } catch {
      audio = undefined;
    } finally {
      ttsMs = performance.now() - ttsStart;
    }
  }

  if (!demoMode && input.deliveryExecutor) {
    const deliveryStart = performance.now();
    delivery = await executeDelivery(decision, brief, audio, input.deliveryExecutor);
    deliveryMs = performance.now() - deliveryStart;
  }

  const totalMs = performance.now() - loopStart;

  return {
    signal: input.signal,
    decision,
    brief,
    audio,
    delivery,
    delivered: demoMode ? false : Boolean(delivery?.sent),
    deliveryChannel,
    demoMode,
    digestQueue,
    digestEnqueued,
    digestFlushed,
    timings: {
      policyMs,
      briefMs,
      ttsMs,
      deliveryMs,
      totalMs,
    },
    loopCompletedAt: new Date().toISOString(),
  };
}

export async function runBatchTriage(
  signals: NormalizedSignal[],
  userContext: UserContext,
  policyConfig: ContactPolicyConfig,
  options: {
    llmApiKey?: string;
    llmModel?: string;
  } = {},
): Promise<TriageResult> {
  return runSignalTriage(
    {
      signals,
      userContext,
      policyConfig,
    },
    {
      llmApiKey: options.llmApiKey,
      llmModel: options.llmModel,
    },
  );
}
