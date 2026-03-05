import { describe, expect, it } from "vitest";
import { DexArbitragePlugin } from "../src/skills/alphaos/plugins/dex-arbitrage";
import type { Opportunity } from "../src/skills/alphaos/types";

function makeOpportunity(grossEdgeBps: number): Opportunity {
  return {
    id: "opp-1",
    strategyId: "dex-arbitrage",
    pair: "ETH/USDC",
    buyDex: "dex-a",
    sellDex: "dex-b",
    buyPrice: 100,
    sellPrice: 101,
    grossEdgeBps,
    detectedAt: new Date().toISOString(),
    metadata: {
      liquidityUsd: 1_000_000,
      volatility: 0,
      avgLatencyMs: 200,
    },
  };
}

describe("DexArbitragePlugin evaluate", () => {
  it("rejects when net edge is below paper threshold", async () => {
    const plugin = new DexArbitragePlugin({
      takerFeeBps: 20,
      mevPenaltyBps: 5,
      riskPolicy: {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
      liquidityUsdDefault: 1_000_000,
      volatilityDefault: 0,
      avgLatencyMsDefault: 200,
      gasUsdDefault: 1.25,
      evalNotionalUsdDefault: 1000,
    });

    const result = await plugin.evaluate(makeOpportunity(80), { mode: "paper" });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("below threshold");
  });

  it("uses different thresholds for paper and live", async () => {
    const plugin = new DexArbitragePlugin({
      takerFeeBps: 20,
      mevPenaltyBps: 5,
      riskPolicy: {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
      liquidityUsdDefault: 1_000_000,
      volatilityDefault: 0,
      avgLatencyMsDefault: 200,
      gasUsdDefault: 1.25,
      evalNotionalUsdDefault: 1000,
    });

    const opp = makeOpportunity(115);
    const quotes = [
      { pair: "ETH/USDC", dex: "dex-a", bid: 99.5, ask: 100, gasUsd: 0.5, ts: new Date().toISOString() },
      { pair: "ETH/USDC", dex: "dex-b", bid: 101, ask: 101.2, gasUsd: 0.5, ts: new Date().toISOString() },
    ];
    const evalCtx = {
      mode: "paper" as const,
      quotes,
      balanceUsd: 100_000,
      riskPolicy: {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
    };
    const paper = await plugin.evaluate(opp, evalCtx);
    const live = await plugin.evaluate(opp, { ...evalCtx, mode: "live" as const });

    expect(paper.accepted).toBe(true);
    expect(live.accepted).toBe(false);
  });

  it("propagates quote gas into opportunity metadata for simulator consistency", async () => {
    const plugin = new DexArbitragePlugin({
      takerFeeBps: 20,
      mevPenaltyBps: 5,
      riskPolicy: {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
      liquidityUsdDefault: 1_000_000,
      volatilityDefault: 0,
      avgLatencyMsDefault: 200,
      gasUsdDefault: 1.25,
      evalNotionalUsdDefault: 1000,
    });

    const opp = makeOpportunity(120);
    const quotes = [
      { pair: "ETH/USDC", dex: "dex-a", bid: 99.5, ask: 100, gasUsd: 7, ts: new Date().toISOString() },
      { pair: "ETH/USDC", dex: "dex-b", bid: 101, ask: 101.2, gasUsd: 9, ts: new Date().toISOString() },
    ];
    const result = await plugin.evaluate(opp, {
      mode: "paper",
      quotes,
      balanceUsd: 100_000,
      riskPolicy: {
        minNetEdgeBpsPaper: 45,
        minNetEdgeBpsLive: 60,
        maxTradePctBalance: 0.03,
        maxDailyLossPct: 0.015,
        maxConsecutiveFailures: 3,
      },
    });

    expect(result.opportunity.metadata?.gasBuyUsd).toBe(7);
    expect(result.opportunity.metadata?.gasSellUsd).toBe(9);
  });

  it("applies SLIPPAGE_BPS during evaluate even when liquidity metadata exists", async () => {
    const riskPolicy = {
      minNetEdgeBpsPaper: 45,
      minNetEdgeBpsLive: 60,
      maxTradePctBalance: 0.03,
      maxDailyLossPct: 0.015,
      maxConsecutiveFailures: 3,
    };
    const commonOptions = {
      takerFeeBps: 20,
      mevPenaltyBps: 5,
      riskPolicy,
      liquidityUsdDefault: 1_000_000,
      volatilityDefault: 0,
      avgLatencyMsDefault: 200,
      gasUsdDefault: 1.25,
      evalNotionalUsdDefault: 1000,
    };
    const lowSlipPlugin = new DexArbitragePlugin({ ...commonOptions, slippageBps: 6 });
    const highSlipPlugin = new DexArbitragePlugin({ ...commonOptions, slippageBps: 24 });

    const opp = makeOpportunity(110);
    const ctx = {
      mode: "paper" as const,
      balanceUsd: 100_000,
      riskPolicy,
    };

    const lowSlip = await lowSlipPlugin.evaluate(opp, ctx);
    const highSlip = await highSlipPlugin.evaluate(opp, ctx);

    expect(lowSlip.accepted).toBe(true);
    expect(highSlip.accepted).toBe(false);
  });
});
