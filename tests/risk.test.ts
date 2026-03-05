import { describe, expect, it } from "vitest";
import { RiskEngine } from "../src/skills/alphaos/runtime/risk-engine";

describe("RiskEngine", () => {
  const risk = new RiskEngine({
    minNetEdgeBpsPaper: 45,
    minNetEdgeBpsLive: 60,
    maxTradePctBalance: 0.03,
    maxDailyLossPct: 0.015,
    maxConsecutiveFailures: 3,
  });

  it("blocks live gate when constraints fail", () => {
    const gate = risk.canPromoteToLive({
      simulationNetUsd24h: -1,
      simulationWinRate24h: 0.2,
      consecutiveFailures: 3,
      permissionFailures24h: 1,
      rejectRate24h: 0.5,
      avgLatencyMs24h: 4000,
      avgSlippageDeviationBps24h: 60,
      liveEnabled: true,
    });

    expect(gate.passed).toBe(false);
    expect(gate.reasons.length).toBeGreaterThan(0);
  });

  it("triggers circuit breaker on max losses", () => {
    const decision = risk.shouldCircuitBreak({
      consecutiveFailures: 4,
      dailyNetUsd: -100,
      balanceUsd: 1000,
      permissionFailures24h: 0,
      rejectRate24h: 0,
      avgLatencyMs24h: 0,
      avgSlippageDeviationBps24h: 0,
    });
    expect(decision.breakNow).toBe(true);
  });

  it("tightens live gate thresholds under stressed market state", () => {
    const gate = risk.canPromoteToLive(
      {
        simulationNetUsd24h: 10,
        simulationWinRate24h: 0.7,
        consecutiveFailures: 0,
        permissionFailures24h: 0,
        rejectRate24h: 0.36,
        avgLatencyMs24h: 3000,
        avgSlippageDeviationBps24h: 40,
        liveEnabled: true,
      },
      {
        volatility24h: 0.35,
        gasP90Usd24h: 12,
        liquidityMedianUsd24h: 30_000,
      },
    );

    expect(gate.passed).toBe(false);
    expect(gate.reasons.some((reason) => reason.includes("reject rate"))).toBe(true);
  });

  it("tightens circuit breaker thresholds under stressed market state", () => {
    const decision = risk.shouldCircuitBreak(
      {
        consecutiveFailures: 0,
        dailyNetUsd: 0,
        balanceUsd: 1000,
        permissionFailures24h: 0,
        rejectRate24h: 0.57,
        avgLatencyMs24h: 3500,
        avgSlippageDeviationBps24h: 70,
      },
      {
        volatility24h: 0.4,
        gasP90Usd24h: 10,
        liquidityMedianUsd24h: 20_000,
      },
    );

    expect(decision.breakNow).toBe(true);
    expect(decision.reasons.some((reason) => reason.includes("reject rate"))).toBe(true);
  });
});
