import { afterEach, describe, expect, it } from "vitest";
import { defaultContactPolicyConfig } from "../src/skills/alphaos/living-assistant/contact-policy";
import type { ContactDecision, UserContext } from "../src/skills/alphaos/living-assistant/contact-policy";
import type { NormalizedSignal } from "../src/skills/alphaos/living-assistant/signal-radar";
import {
  chatCompletion,
  generateNaturalBrief,
  isLLMEnabled,
  resolveLLMApiKey,
  resolveLLMModel,
  runSignalTriage,
} from "../src/skills/alphaos/living-assistant/llm";

const originalFetch = globalThis.fetch;

function buildSignal(overrides?: Partial<NormalizedSignal>): NormalizedSignal {
  return {
    signalId: "sig-001",
    source: "binance_announcement",
    type: "new_listing",
    title: "Binance Will List TOKEN (TOKEN)",
    urgency: "high",
    relevanceHint: "likely_relevant",
    pair: "TOKEN/USDT",
    detectedAt: "2026-03-18T08:00:00.000Z",
    rawPayload: {},
    ...overrides,
  };
}

function buildUserContext(overrides?: Partial<UserContext>): UserContext {
  return {
    localHour: 14,
    recentContactCount: 0,
    activeStrategies: ["spread-threshold"],
    watchlist: ["ETH/USDC", "TOKEN/USDT"],
    riskTolerance: "moderate",
    quietHoursStart: 23,
    quietHoursEnd: 8,
    maxDailyContacts: 12,
    ...overrides,
  };
}

function buildDecision(overrides?: Partial<ContactDecision>): ContactDecision {
  return {
    shouldContact: true,
    attentionLevel: "voice_brief",
    channels: ["telegram"],
    reason: "High urgency signal on watchlist",
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return async () =>
    ({
      ok,
      status,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("llm-client", () => {
  describe("isLLMEnabled", () => {
    it("returns true by default", () => {
      expect(isLLMEnabled(undefined, {})).toBe(true);
    });

    it("respects explicit false", () => {
      expect(isLLMEnabled(false)).toBe(false);
    });

    it("reads LLM_ENABLED env", () => {
      expect(isLLMEnabled(undefined, { LLM_ENABLED: "false" })).toBe(false);
      expect(isLLMEnabled(undefined, { LLM_ENABLED: "true" })).toBe(true);
    });
  });

  describe("resolveLLMApiKey", () => {
    it("prefers explicit key", () => {
      expect(resolveLLMApiKey("sk-explicit", { TTS_API_KEY: "sk-tts" })).toBe("sk-explicit");
    });

    it("falls back to TTS_API_KEY", () => {
      expect(resolveLLMApiKey(undefined, { TTS_API_KEY: "sk-tts" })).toBe("sk-tts");
    });

    it("falls back to LLM_API_KEY", () => {
      expect(resolveLLMApiKey(undefined, { LLM_API_KEY: "sk-llm" })).toBe("sk-llm");
    });

    it("returns undefined when no key available", () => {
      expect(resolveLLMApiKey(undefined, {})).toBeUndefined();
    });
  });

  describe("resolveLLMModel", () => {
    it("defaults to qwen-plus", () => {
      expect(resolveLLMModel(undefined, {})).toBe("qwen-plus");
    });

    it("respects explicit model", () => {
      expect(resolveLLMModel("qwen-max")).toBe("qwen-max");
    });

    it("reads LLM_MODEL env", () => {
      expect(resolveLLMModel(undefined, { LLM_MODEL: "qwen-turbo" })).toBe("qwen-turbo");
    });
  });

  describe("chatCompletion", () => {
    it("returns null when no API key", async () => {
      const result = await chatCompletion(
        [{ role: "user", content: "hello" }],
        { apiKey: undefined },
      );
      expect(result).toBeNull();
    });

    it("returns null for empty messages", async () => {
      const result = await chatCompletion([], { apiKey: "sk-test" });
      expect(result).toBeNull();
    });

    it("parses successful response", async () => {
      globalThis.fetch = mockFetchResponse({
        choices: [{ message: { content: "Hello world" } }],
      }) as unknown as typeof fetch;

      const result = await chatCompletion(
        [{ role: "user", content: "hello" }],
        { apiKey: "sk-test" },
      );
      expect(result).toBe("Hello world");
    });

    it("returns null on HTTP error", async () => {
      globalThis.fetch = mockFetchResponse({ error: "bad" }, false, 400) as unknown as typeof fetch;

      const result = await chatCompletion(
        [{ role: "user", content: "hello" }],
        { apiKey: "sk-test" },
      );
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      globalThis.fetch = (async () => {
        throw new Error("network error");
      }) as unknown as typeof fetch;

      const result = await chatCompletion(
        [{ role: "user", content: "hello" }],
        { apiKey: "sk-test" },
      );
      expect(result).toBeNull();
    });
  });
});

describe("signal-triage", () => {
  it("returns empty result for empty signals", async () => {
    const result = await runSignalTriage(
      { signals: [], userContext: buildUserContext(), policyConfig: defaultContactPolicyConfig },
    );
    expect(result.triaged).toHaveLength(0);
    expect(result.llmUsed).toBe(false);
  });

  it("falls back to rule engine when LLM disabled", async () => {
    const signals = [buildSignal()];
    const result = await runSignalTriage(
      { signals, userContext: buildUserContext(), policyConfig: defaultContactPolicyConfig },
      { llmEnabled: false },
    );
    expect(result.llmUsed).toBe(false);
    expect(result.triaged).toHaveLength(1);
    expect(result.triaged[0].signalId).toBe("sig-001");
  });

  it("falls back to rule engine when no API key", async () => {
    const signals = [buildSignal()];
    const result = await runSignalTriage(
      { signals, userContext: buildUserContext(), policyConfig: defaultContactPolicyConfig },
      { llmApiKey: undefined, llmEnabled: true },
    );
    expect(result.llmUsed).toBe(false);
  });

  it("parses LLM triage response correctly", async () => {
    const signals = [
      buildSignal({ signalId: "sig-001" }),
      buildSignal({ signalId: "sig-002", urgency: "low", title: "Minor update" }),
      buildSignal({ signalId: "sig-003", urgency: "medium", title: "Another listing" }),
    ];

    globalThis.fetch = mockFetchResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            triaged: [
              { signalId: "sig-001", verdict: "notify", attentionLevel: "voice_brief", reason: "High urgency listing on watchlist" },
              { signalId: "sig-002", verdict: "skip", attentionLevel: "silent", reason: "Low urgency, not relevant" },
              { signalId: "sig-003", verdict: "digest", attentionLevel: "digest", reason: "Medium urgency, batch later" },
            ],
            groups: [],
          }),
        },
      }],
    }) as unknown as typeof fetch;

    const result = await runSignalTriage(
      { signals, userContext: buildUserContext(), policyConfig: defaultContactPolicyConfig },
      { llmApiKey: "sk-test" },
    );

    expect(result.llmUsed).toBe(true);
    expect(result.notifyCount).toBe(1);
    expect(result.digestCount).toBe(1);
    expect(result.skipCount).toBe(1);
    expect(result.triaged[0].verdict).toBe("notify");
    expect(result.triaged[1].verdict).toBe("skip");
    expect(result.triaged[2].verdict).toBe("digest");
  });

  it("handles LLM grouping", async () => {
    const signals = [
      buildSignal({ signalId: "sig-001", title: "List TOKEN1" }),
      buildSignal({ signalId: "sig-002", title: "List TOKEN2" }),
    ];

    globalThis.fetch = mockFetchResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            triaged: [
              { signalId: "sig-001", verdict: "notify", attentionLevel: "voice_brief", reason: "New listing", groupKey: "new_listings" },
              { signalId: "sig-002", verdict: "notify", attentionLevel: "voice_brief", reason: "New listing", groupKey: "new_listings" },
            ],
            groups: [
              { groupKey: "new_listings", signalIds: ["sig-001", "sig-002"], mergedTitle: "2 new token listings", attentionLevel: "voice_brief" },
            ],
          }),
        },
      }],
    }) as unknown as typeof fetch;

    const result = await runSignalTriage(
      { signals, userContext: buildUserContext(), policyConfig: defaultContactPolicyConfig },
      { llmApiKey: "sk-test" },
    );

    expect(result.llmUsed).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupKey).toBe("new_listings");
    expect(result.groups[0].signals).toHaveLength(2);
    expect(result.groups[0].mergedTitle).toBe("2 new token listings");
  });

  it("falls back when LLM returns invalid JSON", async () => {
    const signals = [buildSignal()];

    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "not json at all" } }],
    }) as unknown as typeof fetch;

    const result = await runSignalTriage(
      { signals, userContext: buildUserContext(), policyConfig: defaultContactPolicyConfig },
      { llmApiKey: "sk-test" },
    );

    expect(result.llmUsed).toBe(false);
    expect(result.triaged).toHaveLength(1);
  });
});

describe("natural-brief", () => {
  it("falls back to template when LLM disabled", async () => {
    const signal = buildSignal();
    const decision = buildDecision();

    const text = await generateNaturalBrief(signal, decision, "en", { llmEnabled: false });
    expect(text).toBeTruthy();
    expect(typeof text).toBe("string");
  });

  it("falls back to template when no API key", async () => {
    const signal = buildSignal();
    const decision = buildDecision();

    const text = await generateNaturalBrief(signal, decision, "zh", { llmApiKey: undefined, llmEnabled: true });
    expect(text).toBeTruthy();
  });

  it("uses LLM-generated text when available", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "老大，TOKEN刚上线币安了！价格可能会有大波动，建议先观望一下再决定。" } }],
    }) as unknown as typeof fetch;

    const signal = buildSignal();
    const decision = buildDecision();

    const text = await generateNaturalBrief(signal, decision, "zh", { llmApiKey: "sk-test" });
    expect(text).toContain("TOKEN");
  });

  it("falls back on empty LLM response", async () => {
    globalThis.fetch = mockFetchResponse({
      choices: [{ message: { content: "" } }],
    }) as unknown as typeof fetch;

    const signal = buildSignal();
    const decision = buildDecision();

    const text = await generateNaturalBrief(signal, decision, "en", { llmApiKey: "sk-test" });
    expect(text).toBeTruthy();
  });
});
