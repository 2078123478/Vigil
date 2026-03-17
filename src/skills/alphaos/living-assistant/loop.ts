import { evaluateContactPolicy } from "./contact-policy";
import type {
  AttentionLevel,
  ContactChannel,
  ContactPolicyConfig,
  UserContext,
} from "./contact-policy";
import type { NormalizedSignal } from "./signal-radar";
import type { TTSOptions, TTSProvider, TTSResult } from "./tts";
import { generateVoiceBrief } from "./voice-brief";
import type { VoiceBrief, VoiceBriefProtocol } from "./voice-brief";

export interface LivingAssistantLoopInput {
  signal: NormalizedSignal;
  userContext: UserContext;
  policyConfig: ContactPolicyConfig;
  briefProtocol?: VoiceBriefProtocol;
  ttsProvider?: TTSProvider;
  ttsOptions?: TTSOptions;
  demoMode?: boolean;
}

export interface LivingAssistantLoopOutput {
  signal: NormalizedSignal;
  decision: ReturnType<typeof evaluateContactPolicy>;
  brief?: VoiceBrief;
  audio?: TTSResult;
  delivered: boolean;
  deliveryChannel?: ContactChannel;
  demoMode: boolean;
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

export async function runLivingAssistantLoop(
  input: LivingAssistantLoopInput,
): Promise<LivingAssistantLoopOutput> {
  const decision = evaluateContactPolicy(input.signal, input.userContext, input.policyConfig);

  const brief = shouldGenerateBrief(decision.attentionLevel)
    ? generateVoiceBrief(
        input.signal,
        decision,
        input.briefProtocol ? { protocol: input.briefProtocol } : undefined,
      )
    : undefined;

  const deliveryChannel = decision.channels[0];
  const demoMode = Boolean(input.demoMode);
  let audio: TTSResult | undefined;

  if (brief && input.ttsProvider) {
    try {
      audio = await input.ttsProvider.synthesize(brief.text, input.ttsOptions);
    } catch {
      audio = undefined;
    }
  }

  return {
    signal: input.signal,
    decision,
    brief,
    audio,
    delivered: demoMode ? false : Boolean(decision.shouldContact && deliveryChannel),
    deliveryChannel,
    demoMode,
    loopCompletedAt: new Date().toISOString(),
  };
}
