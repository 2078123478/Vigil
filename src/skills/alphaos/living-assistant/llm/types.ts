import type { AttentionLevel, ContactDecision, ContactPolicyConfig, UserContext } from "../contact-policy";
import type { NormalizedSignal } from "../signal-radar";

export type LLMRole = "system" | "user" | "assistant";

export interface Message {
  role: LLMRole;
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  response_format?: {
    type: "json_object";
  };
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
}

export interface LLMRuntimeOptions {
  llmApiKey?: string;
  llmModel?: string;
  llmEnabled?: boolean;
}

export interface TriagedSignal {
  signalId: string;
  verdict: "notify" | "digest" | "skip";
  attentionLevel: AttentionLevel;
  reason: string;
  groupKey?: string;
}

export interface SignalGroup {
  groupKey: string;
  signals: NormalizedSignal[];
  mergedTitle: string;
  attentionLevel: AttentionLevel;
}

export interface TriageResult {
  triaged: TriagedSignal[];
  groups: SignalGroup[];
  notifyCount: number;
  digestCount: number;
  skipCount: number;
  llmUsed: boolean;
}

export interface SignalTriageInput {
  signals: NormalizedSignal[];
  userContext: UserContext;
  policyConfig: ContactPolicyConfig;
}

export interface NaturalBriefOptions extends LLMRuntimeOptions {
  language: "zh" | "en";
}

export type NaturalBriefTarget = SignalGroup | NormalizedSignal;

export interface NaturalBriefInput {
  target: NaturalBriefTarget;
  decision: ContactDecision;
  options: NaturalBriefOptions;
}
