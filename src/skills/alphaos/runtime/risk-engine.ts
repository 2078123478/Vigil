import type { GateCheck, RiskPolicy } from "../types";

interface CircuitBreakInput {
  consecutiveFailures: number;
  dailyNetUsd: number;
  balanceUsd: number;
  permissionFailures24h: number;
  rejectRate24h: number;
  avgLatencyMs24h: number;
  avgSlippageDeviationBps24h: number;
}

interface MarketStateInput {
  volatility24h: number | null;
  gasP90Usd24h: number | null;
  liquidityMedianUsd24h: number | null;
}

interface DynamicThresholds {
  rejectRateGateMax: number;
  avgLatencyGateMaxMs: number;
  avgSlippageGateMaxBps: number;
  rejectRateBreakMax: number;
  avgLatencyBreakMaxMs: number;
  avgSlippageBreakMaxBps: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class RiskEngine {
  constructor(private readonly policy: RiskPolicy) {}

  canPromoteToLive(input: GateCheck, marketState?: MarketStateInput): { passed: boolean; reasons: string[] } {
    const thresholds = this.resolveThresholds(marketState);
    const reasons: string[] = [];
    if (!input.liveEnabled) {
      reasons.push("LIVE_ENABLED is false");
    }
    if (input.simulationNetUsd24h <= 0) {
      reasons.push("simulation net in last 24h must be > 0");
    }
    if (input.simulationWinRate24h < 0.55) {
      reasons.push("simulation win rate in last 24h must be >= 55%");
    }
    if (input.consecutiveFailures >= this.policy.maxConsecutiveFailures) {
      reasons.push("consecutive failures exceeded threshold");
    }
    if (input.permissionFailures24h > 0) {
      reasons.push("permission failures in last 24h must be 0");
    }
    if (input.rejectRate24h > thresholds.rejectRateGateMax) {
      reasons.push(`reject rate in last 24h must be <= ${(thresholds.rejectRateGateMax * 100).toFixed(1)}%`);
    }
    if (input.avgLatencyMs24h > thresholds.avgLatencyGateMaxMs) {
      reasons.push(`average latency in last 24h must be <= ${Math.round(thresholds.avgLatencyGateMaxMs)}ms`);
    }
    if (input.avgSlippageDeviationBps24h > thresholds.avgSlippageGateMaxBps) {
      reasons.push(
        `average slippage deviation in last 24h must be <= ${thresholds.avgSlippageGateMaxBps.toFixed(1)}bps`,
      );
    }
    return { passed: reasons.length === 0, reasons };
  }

  shouldCircuitBreak(
    input: CircuitBreakInput,
    marketState?: MarketStateInput,
  ): { breakNow: boolean; reasons: string[] } {
    const thresholds = this.resolveThresholds(marketState);
    const reasons: string[] = [];
    if (input.consecutiveFailures >= this.policy.maxConsecutiveFailures) {
      reasons.push("max consecutive failures hit");
    }
    if (input.dailyNetUsd < 0 && Math.abs(input.dailyNetUsd) > input.balanceUsd * this.policy.maxDailyLossPct) {
      reasons.push("max daily loss threshold exceeded");
    }
    if (input.permissionFailures24h >= 2) {
      reasons.push("permission failures exceeded threshold");
    }
    if (input.rejectRate24h > thresholds.rejectRateBreakMax) {
      reasons.push(`reject rate exceeded threshold (${(thresholds.rejectRateBreakMax * 100).toFixed(1)}%)`);
    }
    if (input.avgLatencyMs24h > thresholds.avgLatencyBreakMaxMs) {
      reasons.push(`average latency exceeded threshold (${Math.round(thresholds.avgLatencyBreakMaxMs)}ms)`);
    }
    if (input.avgSlippageDeviationBps24h > thresholds.avgSlippageBreakMaxBps) {
      reasons.push(
        `average slippage deviation exceeded threshold (${thresholds.avgSlippageBreakMaxBps.toFixed(1)}bps)`,
      );
    }
    return { breakNow: reasons.length > 0, reasons };
  }

  maxNotional(balanceUsd: number): number {
    return Math.max(0, balanceUsd * this.policy.maxTradePctBalance);
  }

  private resolveThresholds(marketState?: MarketStateInput): DynamicThresholds {
    const stress = this.estimateMarketStress(marketState);
    return {
      rejectRateGateMax: clamp(0.4 - stress * 0.08, 0.2, 0.5),
      avgLatencyGateMaxMs: clamp(3500 - stress * 800, 2000, 4500),
      avgSlippageGateMaxBps: clamp(45 - stress * 12, 22, 55),
      rejectRateBreakMax: clamp(0.6 - stress * 0.12, 0.35, 0.75),
      avgLatencyBreakMaxMs: clamp(5000 - stress * 1200, 2500, 6000),
      avgSlippageBreakMaxBps: clamp(80 - stress * 18, 40, 95),
    };
  }

  private estimateMarketStress(marketState?: MarketStateInput): number {
    if (!marketState) {
      return 0;
    }

    const hasVolatility = typeof marketState.volatility24h === "number" && Number.isFinite(marketState.volatility24h);
    const hasGas = typeof marketState.gasP90Usd24h === "number" && Number.isFinite(marketState.gasP90Usd24h);
    const hasLiquidity =
      typeof marketState.liquidityMedianUsd24h === "number" && Number.isFinite(marketState.liquidityMedianUsd24h);
    if (!hasVolatility && !hasGas && !hasLiquidity) {
      return 0;
    }

    const volatility = clamp(Math.max(0, marketState.volatility24h ?? 0), 0, 1);
    const gasP90Usd = Math.max(0, marketState.gasP90Usd24h ?? 0);
    const liquidityMedianUsd = Math.max(1, marketState.liquidityMedianUsd24h ?? 1);

    const volatilityStress = clamp((volatility - 0.03) / 0.09, -0.5, 2);
    const gasStress = clamp((gasP90Usd - 2) / 8, -0.3, 2);
    const liquidityStress = clamp((150_000 - liquidityMedianUsd) / 150_000, -0.4, 1.5);
    return clamp(volatilityStress * 0.5 + gasStress * 0.3 + liquidityStress * 0.2, -0.5, 2);
  }
}
