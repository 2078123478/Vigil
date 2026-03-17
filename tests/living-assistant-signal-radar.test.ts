import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscoveryCandidate } from "../src/skills/alphaos/types";
import { loadSignalCapsule, normalizeSignal } from "../src/skills/alphaos/living-assistant/signal-radar";

function buildDiscoveryCandidate(overrides?: Partial<DiscoveryCandidate>): DiscoveryCandidate {
  return {
    id: "cand-1",
    sessionId: "session-1",
    strategyId: "spread-threshold",
    pair: "ETH/USDC",
    buyDex: "dex-a",
    sellDex: "dex-b",
    signalTs: "2026-03-17T08:01:00.000Z",
    score: 80,
    expectedNetBps: 78,
    expectedNetUsd: 12.4,
    confidence: 0.84,
    reason: "Spread above threshold and confidence high",
    input: {
      spreadBps: 95,
    },
    status: "pending",
    ...overrides,
  };
}

describe("living assistant signal radar", () => {
  it("normalizes a binance announcement event", () => {
    const normalized = normalizeSignal({
      kind: "binance_announcement",
      title: "ETH ecosystem listing update",
      body: "Listing opens this week",
      type: "new_listing",
      pair: "ETH/USDC",
      urgency: "high",
      detectedAt: "2026-03-17T08:00:00.000Z",
    });

    expect(normalized.signalId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(normalized.source).toBe("binance_announcement");
    expect(normalized.type).toBe("new_listing");
    expect(normalized.urgency).toBe("high");
    expect(normalized.relevanceHint).toBe("likely_relevant");
    expect(normalized.pair).toBe("ETH/USDC");
  });

  it("normalizes a discovery candidate arbitrage event", () => {
    const candidate = buildDiscoveryCandidate();
    const normalized = normalizeSignal({
      kind: "arbitrage_opportunity",
      candidate,
    });

    expect(normalized.signalId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(normalized.source).toBe("market_opportunity");
    expect(normalized.type).toBe("spread_detected");
    expect(normalized.pair).toBe(candidate.pair);
    expect(normalized.relevanceHint).toBe("likely_relevant");
    expect(normalized.metadata?.strategyId).toBe(candidate.strategyId);
  });

  it("normalizes a token risk alert event", () => {
    const normalized = normalizeSignal({
      kind: "token_risk_alert",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      severity: "critical",
      pair: "ETH/USDC",
    });

    expect(normalized.signalId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(normalized.source).toBe("token_risk_change");
    expect(normalized.type).toBe("risk_alert");
    expect(normalized.urgency).toBe("critical");
    expect(normalized.tokenAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(normalized.relevanceHint).toBe("likely_relevant");
  });

  it("normalizes a square narrative event", () => {
    const normalized = normalizeSignal({
      kind: "square_narrative",
      title: "Square meme narrative is accelerating",
      body: "Mentions of $BNB-linked meme pairs are rising.",
      urgency: "medium",
      relevanceHint: "likely_relevant",
      detectedAt: "2026-03-17T08:15:00.000Z",
    });

    expect(normalized.signalId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(normalized.source).toBe("binance_square");
    expect(normalized.type).toBe("meme_surge");
    expect(normalized.urgency).toBe("medium");
    expect(normalized.relevanceHint).toBe("likely_relevant");
  });

  it("loads a signal capsule fixture", () => {
    const fixturePath = path.resolve(process.cwd(), "fixtures/signal-capsules/binance-announcement-eth-listing.json");
    const signals = loadSignalCapsule(fixturePath);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.source).toBe("binance_announcement");
    expect(signals[0]?.pair).toBe("ETH/USDC");
  });
});
