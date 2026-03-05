import type { ExecutionMode, ExecutionPlan, RiskPolicy, SimulationResult } from "../types";
import {
  calculateNetOutcome,
  calculateCostBreakdown,
  estimateExpectedShortfall,
  estimateFailureProbability,
} from "./cost-model";

export interface SimulatorOptions {
  slippageBps: number;
  takerFeeBps: number;
  gasUsdDefault: number;
  mevPenaltyBps?: number;
  liquidityUsdDefault?: number;
  volatilityDefault?: number;
  avgLatencyMsDefault?: number;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class Simulator {
  constructor(private readonly options: SimulatorOptions) {}

  estimate(plan: ExecutionPlan, mode: ExecutionMode, risk: RiskPolicy): SimulationResult {
    const hasValidPrices =
      Number.isFinite(plan.buyPrice) &&
      Number.isFinite(plan.sellPrice) &&
      plan.buyPrice > 0 &&
      plan.sellPrice > 0;
    if (!hasValidPrices) {
      const notional = Math.max(0, plan.notionalUsd);
      return {
        grossUsd: 0,
        feeUsd: 0,
        netUsd: -notional,
        netEdgeBps: -Infinity,
        pFail: 0.95,
        expectedShortfall: notional,
        latencyAdjustedNetUsd: -notional,
        pass: false,
        reason: "invalid execution price: buy/sell must be > 0",
      };
    }

    const metadata = plan.metadata ?? {};
    const grossEdgeBps =
      plan.buyPrice > 0 ? ((plan.sellPrice - plan.buyPrice) / plan.buyPrice) * 10_000 : 0;
    const gasBuy = asNumber(metadata.gasBuyUsd) ?? this.options.gasUsdDefault;
    const gasSell = asNumber(metadata.gasSellUsd) ?? this.options.gasUsdDefault;
    const liquidityUsd =
      asNumber(metadata.liquidityUsd) ??
      this.options.liquidityUsdDefault ??
      Math.max(1000, (plan.notionalUsd * 10_000) / Math.max(1, this.options.slippageBps));
    const volatility = asNumber(metadata.volatility) ?? this.options.volatilityDefault ?? 0.02;
    const avgLatencyMs = asNumber(metadata.avgLatencyMs) ?? this.options.avgLatencyMsDefault ?? 250;
    const breakdown = calculateCostBreakdown({
      grossEdgeBps,
      notionalUsd: plan.notionalUsd,
      takerFeeBps: this.options.takerFeeBps,
      mevPenaltyBps: this.options.mevPenaltyBps ?? 5,
      liquidityUsd,
      volatility,
      avgLatencyMs,
      gasBuyUsd: gasBuy,
      gasSellUsd: gasSell,
    });
    const feeUsd = breakdown.totalCostUsd;
    const outcome = calculateNetOutcome(grossEdgeBps, plan.notionalUsd, feeUsd);
    const grossUsd = outcome.grossUsd;
    const netUsd = outcome.netUsd;
    const netEdgeBps = outcome.netEdgeBps;
    const pFail = estimateFailureProbability(avgLatencyMs, netEdgeBps, volatility);
    const expectedShortfall = estimateExpectedShortfall(
      plan.notionalUsd,
      pFail,
      feeUsd,
      netEdgeBps,
    );
    const latencyAdjustedNetUsd = netUsd - expectedShortfall;
    const riskAdjustedNetEdgeBps = plan.notionalUsd > 0 ? (latencyAdjustedNetUsd / plan.notionalUsd) * 10_000 : -Infinity;
    const min = mode === "live" ? risk.minNetEdgeBpsLive : risk.minNetEdgeBpsPaper;
    const pass = riskAdjustedNetEdgeBps >= min;
    return {
      grossUsd,
      feeUsd,
      netUsd,
      netEdgeBps,
      pFail,
      expectedShortfall,
      latencyAdjustedNetUsd,
      pass,
      reason: pass
        ? `risk-adjusted net edge ${riskAdjustedNetEdgeBps.toFixed(2)}bps passed`
        : `risk-adjusted net edge ${riskAdjustedNetEdgeBps.toFixed(2)}bps below ${min}bps`,
    };
  }
}
