import { evaluateContactPolicy } from "../contact-policy";
import type { AttentionLevel } from "../contact-policy";
import type { NormalizedSignal } from "../signal-radar";
import { chatCompletion, isLLMEnabled, resolveLLMApiKey } from "./llm-client";
import type {
  LLMRuntimeOptions,
  SignalGroup,
  SignalTriageInput,
  TriageResult,
  TriagedSignal,
} from "./types";

type JsonRecord = Record<string, unknown>;

interface RawGroupDescriptor {
  groupKey: string;
  signalIds: string[];
  mergedTitle?: string;
  attentionLevel?: AttentionLevel;
}

const ATTENTION_PRIORITY: Record<AttentionLevel, number> = {
  silent: 0,
  digest: 1,
  text_nudge: 2,
  voice_brief: 3,
  strong_interrupt: 4,
  call_escalation: 5,
};

const ATTENTION_LEVELS = new Set<AttentionLevel>([
  "silent",
  "digest",
  "text_nudge",
  "voice_brief",
  "strong_interrupt",
  "call_escalation",
]);

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseJsonObject(raw: string): JsonRecord | undefined {
  const direct = raw.trim();
  if (!direct) {
    return undefined;
  }

  try {
    return JSON.parse(direct) as JsonRecord;
  } catch {
    // Continue to fallback parsing.
  }

  const fencedMatch = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim()) as JsonRecord;
    } catch {
      // Continue to fallback parsing.
    }
  }

  const firstBrace = direct.indexOf("{");
  const lastBrace = direct.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = direct.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(sliced) as JsonRecord;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function normalizeVerdict(value: unknown): TriagedSignal["verdict"] | undefined {
  const text = optionalText(value)?.toLowerCase();
  if (text === "notify" || text === "digest" || text === "skip") {
    return text;
  }
  return undefined;
}

function normalizeAttentionLevel(value: unknown): AttentionLevel | undefined {
  const text = optionalText(value)?.toLowerCase() as AttentionLevel | undefined;
  if (!text) {
    return undefined;
  }
  return ATTENTION_LEVELS.has(text) ? text : undefined;
}

function normalizeGroupKey(value: unknown): string | undefined {
  const key = optionalText(value);
  return key && key.length > 0 ? key : undefined;
}

function defaultAttentionForVerdict(verdict: TriagedSignal["verdict"]): AttentionLevel {
  if (verdict === "notify") {
    return "voice_brief";
  }
  if (verdict === "digest") {
    return "digest";
  }
  return "silent";
}

function normalizeAttentionForVerdict(
  verdict: TriagedSignal["verdict"],
  attentionLevel: AttentionLevel | undefined,
): AttentionLevel {
  const fallback = defaultAttentionForVerdict(verdict);
  if (!attentionLevel) {
    return fallback;
  }

  if (verdict === "notify" && (attentionLevel === "silent" || attentionLevel === "digest")) {
    return fallback;
  }
  if (verdict === "digest") {
    return "digest";
  }
  if (verdict === "skip") {
    return "silent";
  }
  return attentionLevel;
}

function decisionToVerdict(attentionLevel: AttentionLevel): TriagedSignal["verdict"] {
  if (attentionLevel === "silent") {
    return "skip";
  }
  if (attentionLevel === "digest") {
    return "digest";
  }
  return "notify";
}

function toFallbackTriagedSignal(input: SignalTriageInput, signal: NormalizedSignal): TriagedSignal {
  const decision = evaluateContactPolicy(signal, input.userContext, input.policyConfig);
  return {
    signalId: signal.signalId,
    verdict: decisionToVerdict(decision.attentionLevel),
    attentionLevel: decision.attentionLevel,
    reason: decision.reason,
  };
}

function buildFallbackResult(input: SignalTriageInput): TriageResult {
  const triaged = input.signals.map((signal) => toFallbackTriagedSignal(input, signal));
  return buildResult(triaged, [], false);
}

function buildResult(triaged: TriagedSignal[], groups: SignalGroup[], llmUsed: boolean): TriageResult {
  let notifyCount = 0;
  let digestCount = 0;
  let skipCount = 0;

  for (const item of triaged) {
    if (item.verdict === "notify") {
      notifyCount += 1;
      continue;
    }
    if (item.verdict === "digest") {
      digestCount += 1;
      continue;
    }
    skipCount += 1;
  }

  return {
    triaged,
    groups,
    notifyCount,
    digestCount,
    skipCount,
    llmUsed,
  };
}

function parseLLMTriage(
  raw: string,
  signalIds: Set<string>,
): {
  triagedById: Map<string, TriagedSignal>;
  rawGroups: RawGroupDescriptor[];
} {
  const payload = parseJsonObject(raw);
  if (!payload) {
    return {
      triagedById: new Map<string, TriagedSignal>(),
      rawGroups: [],
    };
  }

  const triagedById = new Map<string, TriagedSignal>();
  const triagedItems = Array.isArray(payload.triaged) ? payload.triaged : [];
  for (const item of triagedItems) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const signalId = optionalText(record.signalId);
    if (!signalId || !signalIds.has(signalId)) {
      continue;
    }

    const verdict = normalizeVerdict(record.verdict);
    if (!verdict) {
      continue;
    }

    const attentionLevel = normalizeAttentionForVerdict(verdict, normalizeAttentionLevel(record.attentionLevel));
    const reason = optionalText(record.reason) ?? "LLM triage recommendation.";
    const groupKey = normalizeGroupKey(record.groupKey);

    triagedById.set(signalId, {
      signalId,
      verdict,
      attentionLevel,
      reason,
      ...(groupKey ? { groupKey } : {}),
    });
  }

  const rawGroups: RawGroupDescriptor[] = [];
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  for (const item of groups) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const groupKey = normalizeGroupKey(record.groupKey);
    if (!groupKey) {
      continue;
    }

    const signalIdsRaw = Array.isArray(record.signalIds) ? record.signalIds : [];
    const signalIdsForGroup = signalIdsRaw
      .map((value) => optionalText(value))
      .filter((value): value is string => typeof value === "string" && signalIds.has(value));

    const uniqueSignalIds = [...new Set(signalIdsForGroup)];
    rawGroups.push({
      groupKey,
      signalIds: uniqueSignalIds,
      mergedTitle: optionalText(record.mergedTitle),
      attentionLevel: normalizeAttentionLevel(record.attentionLevel),
    });
  }

  return {
    triagedById,
    rawGroups,
  };
}

function inferGroupAttention(signalIds: string[], triagedById: Map<string, TriagedSignal>): AttentionLevel {
  let bestLevel: AttentionLevel = "digest";
  for (const signalId of signalIds) {
    const item = triagedById.get(signalId);
    if (!item) {
      continue;
    }
    if (ATTENTION_PRIORITY[item.attentionLevel] > ATTENTION_PRIORITY[bestLevel]) {
      bestLevel = item.attentionLevel;
    }
  }
  return bestLevel;
}

function defaultMergedTitle(signals: NormalizedSignal[]): string {
  if (signals.length === 0) {
    return "Grouped signals";
  }
  if (signals.length === 1) {
    return signals[0].title;
  }

  const uniqueTypes = [...new Set(signals.map((signal) => signal.type))];
  if (uniqueTypes.length === 1) {
    return `${uniqueTypes[0]} updates (${signals.length})`;
  }
  return `${signals.length} related signals`;
}

function buildGroups(
  triaged: TriagedSignal[],
  rawGroups: RawGroupDescriptor[],
  signalById: Map<string, NormalizedSignal>,
): SignalGroup[] {
  const triagedById = new Map<string, TriagedSignal>(triaged.map((item) => [item.signalId, item]));
  const groupMap = new Map<
    string,
    {
      signalIds: string[];
      mergedTitle?: string;
      attentionLevel?: AttentionLevel;
    }
  >();

  for (const group of rawGroups) {
    const fallbackSignalIds = triaged
      .filter((item) => item.groupKey === group.groupKey && item.verdict !== "skip")
      .map((item) => item.signalId);

    const signalIds = [...new Set((group.signalIds.length > 0 ? group.signalIds : fallbackSignalIds))];
    if (signalIds.length === 0) {
      continue;
    }

    groupMap.set(group.groupKey, {
      signalIds,
      mergedTitle: group.mergedTitle,
      attentionLevel: group.attentionLevel,
    });
  }

  const triageGroupKeys = [...new Set(triaged.map((item) => item.groupKey).filter((item): item is string => Boolean(item)))];
  for (const groupKey of triageGroupKeys) {
    if (groupMap.has(groupKey)) {
      continue;
    }

    const signalIds = triaged
      .filter((item) => item.groupKey === groupKey && item.verdict !== "skip")
      .map((item) => item.signalId);

    if (signalIds.length < 2) {
      continue;
    }

    groupMap.set(groupKey, {
      signalIds,
    });
  }

  const groups: SignalGroup[] = [];
  for (const [groupKey, groupData] of groupMap.entries()) {
    const signals: NormalizedSignal[] = [];
    for (const signalId of groupData.signalIds) {
      const signal = signalById.get(signalId);
      if (signal) {
        signals.push(signal);
      }
    }

    if (signals.length === 0) {
      continue;
    }

    const attentionLevel =
      groupData.attentionLevel ?? inferGroupAttention(signals.map((signal) => signal.signalId), triagedById);
    const mergedTitle = groupData.mergedTitle ?? defaultMergedTitle(signals);

    groups.push({
      groupKey,
      signals,
      mergedTitle,
      attentionLevel,
    });
  }

  return groups;
}

function buildTriagePrompt(input: SignalTriageInput): string {
  const watchlist = input.userContext.watchlist;
  const compactSignals = input.signals.map((signal) => ({
    signalId: signal.signalId,
    source: signal.source,
    type: signal.type,
    title: signal.title,
    urgency: signal.urgency,
    relevanceHint: signal.relevanceHint,
    pair: signal.pair,
    tokenAddress: signal.tokenAddress,
    detectedAt: signal.detectedAt,
  }));

  return [
    "User context:",
    `- watchlist: ${watchlist.length > 0 ? watchlist.join(", ") : "[]"}`,
    `- riskTolerance: ${input.userContext.riskTolerance}`,
    `- activeStrategies: ${input.userContext.activeStrategies.join(", ")}`,
    "",
    "Batch signals to triage:",
    JSON.stringify(compactSignals),
    "",
    "Output JSON only with this shape:",
    JSON.stringify({
      triaged: [
        {
          signalId: "string",
          verdict: "notify | digest | skip",
          attentionLevel: "silent | digest | text_nudge | voice_brief | strong_interrupt | call_escalation",
          reason: "string",
          groupKey: "optional-string",
        },
      ],
      groups: [
        {
          groupKey: "string",
          signalIds: ["signalId"],
          mergedTitle: "string",
          attentionLevel: "silent | digest | text_nudge | voice_brief | strong_interrupt | call_escalation",
        },
      ],
    }),
  ].join("\n");
}

export async function runSignalTriage(
  input: SignalTriageInput,
  options: LLMRuntimeOptions = {},
): Promise<TriageResult> {
  if (input.signals.length === 0) {
    return {
      triaged: [],
      groups: [],
      notifyCount: 0,
      digestCount: 0,
      skipCount: 0,
      llmUsed: false,
    };
  }

  if (!isLLMEnabled(options.llmEnabled)) {
    return buildFallbackResult(input);
  }

  const apiKey = resolveLLMApiKey(options.llmApiKey);
  if (!apiKey) {
    return buildFallbackResult(input);
  }

  const completion = await chatCompletion(
    [
      {
        role: "system",
        content:
          "You are a BNB ecosystem assistant triage engine. Review signal batches, decide user interruption priority, and group similar signals.",
      },
      {
        role: "user",
        content: buildTriagePrompt(input),
      },
    ],
    {
      apiKey,
      model: options.llmModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
    },
  );

  if (!completion) {
    return buildFallbackResult(input);
  }

  const signalById = new Map<string, NormalizedSignal>(input.signals.map((signal) => [signal.signalId, signal]));
  const parsed = parseLLMTriage(completion, new Set(signalById.keys()));
  if (parsed.triagedById.size === 0) {
    return buildFallbackResult(input);
  }

  const triaged = input.signals.map((signal) => parsed.triagedById.get(signal.signalId) ?? toFallbackTriagedSignal(input, signal));
  const groups = buildGroups(triaged, parsed.rawGroups, signalById);

  return buildResult(triaged, groups, true);
}
