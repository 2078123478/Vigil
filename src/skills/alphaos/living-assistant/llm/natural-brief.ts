import type { ContactDecision } from "../contact-policy";
import type { NormalizedSignal } from "../signal-radar";
import { generateVoiceBrief } from "../voice-brief";
import { chatCompletion, isLLMEnabled, resolveLLMApiKey } from "./llm-client";
import type { LLMRuntimeOptions, NaturalBriefTarget, SignalGroup } from "./types";

const URGENCY_RANK: Record<NormalizedSignal["urgency"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function isSignalGroup(target: NaturalBriefTarget): target is SignalGroup {
  return (
    typeof (target as SignalGroup).groupKey === "string" &&
    Array.isArray((target as SignalGroup).signals)
  );
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimToSentenceLimit(text: string, language: "zh" | "en", maxSentences = 3): string {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) {
    return text;
  }
  if (language === "zh") {
    return sentences.slice(0, maxSentences).join("");
  }
  return sentences.slice(0, maxSentences).join(" ");
}

function isWrappedInMatchingQuotes(text: string): boolean {
  return (text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"));
}

function normalizeCompletionText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const fencedMatch = trimmed.match(/```(?:text)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  if (isWrappedInMatchingQuotes(trimmed)) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function pickRepresentativeSignal(target: NaturalBriefTarget): NormalizedSignal {
  if (!isSignalGroup(target)) {
    return target;
  }

  const sorted = [...target.signals].sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]);
  return sorted[0] ?? target.signals[0];
}

function fallbackBriefText(
  target: NaturalBriefTarget,
  decision: ContactDecision,
  language: "zh" | "en",
): string {
  const representativeSignal = pickRepresentativeSignal(target);
  return generateVoiceBrief(representativeSignal, decision, { language }).text;
}

function formatTargetContext(target: NaturalBriefTarget): string {
  if (!isSignalGroup(target)) {
    return JSON.stringify({
      signalId: target.signalId,
      source: target.source,
      type: target.type,
      title: target.title,
      urgency: target.urgency,
      pair: target.pair,
      tokenAddress: target.tokenAddress,
      detectedAt: target.detectedAt,
    });
  }

  return JSON.stringify({
    groupKey: target.groupKey,
    mergedTitle: target.mergedTitle,
    attentionLevel: target.attentionLevel,
    signalCount: target.signals.length,
    signals: target.signals.map((signal) => ({
      signalId: signal.signalId,
      source: signal.source,
      type: signal.type,
      title: signal.title,
      urgency: signal.urgency,
      pair: signal.pair,
      tokenAddress: signal.tokenAddress,
      detectedAt: signal.detectedAt,
    })),
  });
}

function buildPrompt(target: NaturalBriefTarget, decision: ContactDecision, language: "zh" | "en"): string {
  return [
    `Language: ${language}`,
    `Decision attentionLevel: ${decision.attentionLevel}`,
    `Decision reason: ${decision.reason}`,
    "Signal context:",
    formatTargetContext(target),
    "",
    "Write a short voice brief in Xiaoyin style:",
    "- energetic, natural, conversational",
    "- max 3 sentences",
    "- should fit in 15 seconds",
    "- if grouped signals, summarize key points instead of reading one by one",
    "- end with one actionable suggestion",
    "- output plain text only",
  ].join("\n");
}

export async function generateNaturalBrief(
  target: NaturalBriefTarget,
  decision: ContactDecision,
  language: "zh" | "en",
  options: LLMRuntimeOptions = {},
): Promise<string> {
  const fallback = fallbackBriefText(target, decision, language);
  if (!isLLMEnabled(options.llmEnabled)) {
    return fallback;
  }

  const apiKey = resolveLLMApiKey(options.llmApiKey);
  if (!apiKey) {
    return fallback;
  }

  const completion = await chatCompletion(
    [
      {
        role: "system",
        content:
          "You are Xiaoyin, an upbeat AI assistant. Produce concise, natural voice briefs about crypto signals.",
      },
      {
        role: "user",
        content: buildPrompt(target, decision, language),
      },
    ],
    {
      apiKey,
      model: options.llmModel,
      temperature: 0.6,
    },
  );

  if (!completion) {
    return fallback;
  }

  const normalized = normalizeCompletionText(completion);
  if (!normalized) {
    return fallback;
  }

  return trimToSentenceLimit(normalized, language, 3);
}
