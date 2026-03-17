import type { EvalResult, SimulationResult, TradeResult } from "../types";
import type {
  ArbitrageEffectiveMode,
  ArbitrageReasonCode,
  ArbitrageReasonStage,
  ArbitrageRequestedMode,
  NormalizedReasonBundle,
} from "./types";

interface ReasonRule {
  pattern: RegExp;
  codes: ArbitrageReasonCode[];
  blocking?: boolean;
}

const STAGE_RULES: Record<ArbitrageReasonStage, ReasonRule[]> = {
  discovery: [
    { pattern: /spread.*above threshold/i, codes: ["spread_above_threshold"] },
    { pattern: /spread.*below threshold/i, codes: ["spread_below_threshold"], blocking: true },
    { pattern: /spread/i, codes: ["spread_detected"] },
    { pattern: /ranked/i, codes: ["candidate_ranked_high"] },
    { pattern: /signal/i, codes: ["signal_supported_candidate"] },
    { pattern: /event/i, codes: ["event_driven_candidate"] },
  ],
  evaluate: [
    { pattern: /net edge.*below threshold/i, codes: ["net_edge_below_threshold"], blocking: true },
    { pattern: /net edge.*bps/i, codes: ["net_edge_above_threshold"] },
    { pattern: /spread.*below threshold/i, codes: ["spread_below_threshold"], blocking: true },
    { pattern: /spread.*above threshold/i, codes: ["spread_above_threshold"] },
    { pattern: /spread/i, codes: ["spread_detected"] },
    { pattern: /invalid (opportunity|quote|execution) price/i, codes: ["invalid_execution_price"], blocking: true },
    { pattern: /buy\/sell must be > 0|bid\/ask must be > 0/i, codes: ["invalid_execution_price"], blocking: true },
    { pattern: /missing fresh quotes|stale quote|quote stale/i, codes: ["quote_stale"], blocking: true },
    { pattern: /liquidity.*insufficient|liquidity.*too low/i, codes: ["liquidity_too_low"], blocking: true },
    { pattern: /balance.*insufficient|not enough balance/i, codes: ["balance_insufficient"], blocking: true },
    { pattern: /risk policy blocked execution/i, codes: ["risk_policy_failed"], blocking: true },
    { pattern: /mode not allowed|mode.*not permitted/i, codes: ["mode_not_allowed"], blocking: true },
  ],
  simulation: [
    { pattern: /risk-adjusted net edge .*passed|simulation.*profitable|remained profitable/i, codes: ["simulation_profitable"] },
    {
      pattern: /risk-adjusted net edge .*below|simulation.*unprofitable|not profitable enough/i,
      codes: ["simulation_unprofitable"],
      blocking: true,
    },
    { pattern: /invalid execution price|invalid .*price/i, codes: ["invalid_execution_price"], blocking: true },
    { pattern: /latency.*within|latency-adjusted/i, codes: ["latency_risk_within_bounds"] },
    { pattern: /latency.*too high|latency.*exceed/i, codes: ["latency_risk_too_high"], blocking: true },
    { pattern: /expected shortfall.*acceptable|expected shortfall.*within/i, codes: ["expected_shortfall_acceptable"] },
    { pattern: /expected shortfall.*too high|expected shortfall.*exceed/i, codes: ["expected_shortfall_too_high"], blocking: true },
    { pattern: /failure probability.*acceptable|failure probability.*within/i, codes: ["failure_probability_acceptable"] },
    { pattern: /failure probability.*too high|failure probability.*exceed/i, codes: ["failure_probability_too_high"], blocking: true },
    { pattern: /simulation failed|failed to run|failed to validate/i, codes: ["simulation_failed"], blocking: true },
  ],
  risk: [
    { pattern: /LIVE_ENABLED is false/i, codes: ["live_gate_failed", "mode_not_allowed"], blocking: true },
    { pattern: /simulation net in last 24h must be > 0/i, codes: ["live_gate_failed"], blocking: true },
    { pattern: /simulation win rate in last 24h must be >=/i, codes: ["live_gate_failed"], blocking: true },
    {
      pattern: /consecutive failures exceeded threshold|max consecutive failures hit/i,
      codes: ["too_many_recent_failures"],
      blocking: true,
    },
    {
      pattern: /permission failures in last 24h must be 0|permission failures exceeded threshold/i,
      codes: ["permission_denied", "live_gate_failed"],
      blocking: true,
    },
    { pattern: /max daily loss threshold exceeded/i, codes: ["daily_loss_cap_reached"], blocking: true },
    { pattern: /reject rate.*must be <=|reject rate exceeded threshold/i, codes: ["risk_policy_failed"], blocking: true },
    {
      pattern: /average latency.*must be <=|average latency exceeded threshold/i,
      codes: ["latency_risk_too_high", "live_gate_failed"],
      blocking: true,
    },
    {
      pattern: /average slippage deviation.*must be <=|average slippage deviation exceeded threshold/i,
      codes: ["failure_probability_too_high", "risk_policy_failed"],
      blocking: true,
    },
    { pattern: /risk policy blocked execution/i, codes: ["risk_policy_failed"], blocking: true },
  ],
  execution: [
    { pattern: /permission/i, codes: ["permission_denied"], blocking: true },
    { pattern: /whitelist/i, codes: ["whitelist_restricted"], blocking: true },
    { pattern: /network|timeout|econn|enotfound|socket/i, codes: ["network_error"], blocking: true },
    { pattern: /validation|invalid|route mismatch|simulate failed|sell_amount_invalid/i, codes: ["validation_error"], blocking: true },
  ],
  policy: [
    { pattern: /approval required/i, codes: ["approval_required"] },
    { pattern: /monitor only/i, codes: ["monitor_only"] },
    { pattern: /degrad/i, codes: ["degraded_to_paper"] },
    { pattern: /auto execute/i, codes: ["auto_execute_allowed"] },
  ],
  reporting: [
    { pattern: /summary/i, codes: ["summary_generated"] },
    { pattern: /share card/i, codes: ["share_card_generated"] },
    { pattern: /square post.*prepared/i, codes: ["square_post_prepared"] },
    { pattern: /square post.*published/i, codes: ["square_post_published"] },
    { pattern: /distribution.*failed/i, codes: ["distribution_failed"], blocking: true },
  ],
  generic: [],
};

STAGE_RULES.generic = [
  ...STAGE_RULES.discovery,
  ...STAGE_RULES.evaluate,
  ...STAGE_RULES.simulation,
  ...STAGE_RULES.risk,
  ...STAGE_RULES.execution,
  ...STAGE_RULES.policy,
  ...STAGE_RULES.reporting,
];

function dedupe(codes: ArbitrageReasonCode[]): ArbitrageReasonCode[] {
  return Array.from(new Set(codes));
}

function mergeCodes(
  target: NormalizedReasonBundle,
  incoming: NormalizedReasonBundle,
): NormalizedReasonBundle {
  return {
    reasonCodes: dedupe([...target.reasonCodes, ...incoming.reasonCodes]),
    blockingReasonCodes: dedupe([...target.blockingReasonCodes, ...incoming.blockingReasonCodes]),
  };
}

function inferExecutionErrorCode(errorType: TradeResult["errorType"], message?: string): ArbitrageReasonCode {
  if (errorType === "permission_denied") {
    return "permission_denied";
  }
  if (errorType === "whitelist_restricted") {
    return "whitelist_restricted";
  }
  if (errorType === "network") {
    return "network_error";
  }
  if (errorType === "validation") {
    return "validation_error";
  }
  const text = (message ?? "").toLowerCase();
  if (text.includes("permission")) {
    return "permission_denied";
  }
  if (text.includes("whitelist")) {
    return "whitelist_restricted";
  }
  if (text.includes("network") || text.includes("timeout")) {
    return "network_error";
  }
  if (text.includes("validation") || text.includes("invalid")) {
    return "validation_error";
  }
  return "unknown_execution_error";
}

export function normalizeReasonMessage(
  message: string | undefined,
  stage: ArbitrageReasonStage = "generic",
): NormalizedReasonBundle {
  if (!message || !message.trim()) {
    return { reasonCodes: [], blockingReasonCodes: [] };
  }
  const rules = STAGE_RULES[stage];
  const reasonCodes: ArbitrageReasonCode[] = [];
  const blockingReasonCodes: ArbitrageReasonCode[] = [];
  for (const rule of rules) {
    if (!rule.pattern.test(message)) {
      continue;
    }
    reasonCodes.push(...rule.codes);
    if (rule.blocking) {
      blockingReasonCodes.push(...rule.codes);
    }
  }
  return {
    reasonCodes: dedupe(reasonCodes),
    blockingReasonCodes: dedupe(blockingReasonCodes),
  };
}

export function normalizeReasonMessages(
  messages: string[],
  stage: ArbitrageReasonStage,
): NormalizedReasonBundle {
  let bundle: NormalizedReasonBundle = { reasonCodes: [], blockingReasonCodes: [] };
  for (const message of messages) {
    bundle = mergeCodes(bundle, normalizeReasonMessage(message, stage));
  }
  return bundle;
}

export function normalizeEvalReasonBundle(evalResult: EvalResult): NormalizedReasonBundle {
  let bundle = normalizeReasonMessage(evalResult.reason, "evaluate");
  if (evalResult.accepted) {
    bundle = mergeCodes(bundle, {
      reasonCodes: ["net_edge_above_threshold", "risk_policy_passed"],
      blockingReasonCodes: [],
    });
  } else if (bundle.blockingReasonCodes.length === 0) {
    bundle = mergeCodes(bundle, {
      reasonCodes: ["net_edge_below_threshold"],
      blockingReasonCodes: ["net_edge_below_threshold"],
    });
  }
  return bundle;
}

export function normalizeSimulationReasonBundle(simulation: SimulationResult): NormalizedReasonBundle {
  let bundle = normalizeReasonMessage(simulation.reason, "simulation");
  if (simulation.pass) {
    bundle = mergeCodes(bundle, {
      reasonCodes: ["simulation_completed", "simulation_profitable"],
      blockingReasonCodes: [],
    });
    if (simulation.expectedShortfall <= Math.max(0, simulation.netUsd)) {
      bundle = mergeCodes(bundle, {
        reasonCodes: ["expected_shortfall_acceptable"],
        blockingReasonCodes: [],
      });
    }
    if (simulation.pFail <= 0.2) {
      bundle = mergeCodes(bundle, {
        reasonCodes: ["failure_probability_acceptable"],
        blockingReasonCodes: [],
      });
    }
    if (simulation.latencyAdjustedNetUsd >= 0) {
      bundle = mergeCodes(bundle, {
        reasonCodes: ["latency_risk_within_bounds"],
        blockingReasonCodes: [],
      });
    }
  } else {
    const blocking =
      bundle.blockingReasonCodes.length > 0
        ? bundle.blockingReasonCodes
        : ["simulation_failed"];
    const reasons =
      bundle.reasonCodes.length > 0
        ? bundle.reasonCodes
        : ["simulation_failed"];
    bundle = {
      reasonCodes: dedupe(reasons),
      blockingReasonCodes: dedupe(blocking),
    };
  }
  return bundle;
}

export function normalizeRiskReasonBundle(input?: {
  passed: boolean;
  reasons: string[];
}): NormalizedReasonBundle {
  if (!input) {
    return { reasonCodes: [], blockingReasonCodes: [] };
  }
  let bundle = normalizeReasonMessages(input.reasons, "risk");
  if (input.passed) {
    bundle = mergeCodes(bundle, {
      reasonCodes: ["live_gate_passed", "execution_backend_ready", "mode_allowed"],
      blockingReasonCodes: [],
    });
    return bundle;
  }
  bundle = mergeCodes(bundle, {
    reasonCodes: ["live_gate_failed", "execution_backend_unready"],
    blockingReasonCodes: ["live_gate_failed", "execution_backend_unready"],
  });
  return bundle;
}

export function normalizeExecutionReasonBundle(
  tradeResult: TradeResult,
  options?: {
    requestedMode?: ArbitrageRequestedMode;
    effectiveMode?: ArbitrageEffectiveMode;
    degradedToPaper?: boolean;
  },
): NormalizedReasonBundle {
  const reasonCodes: ArbitrageReasonCode[] = [];
  const blockingReasonCodes: ArbitrageReasonCode[] = [];
  if (tradeResult.success) {
    reasonCodes.push("execution_started", "trade_recorded");
    if (tradeResult.status === "submitted") {
      reasonCodes.push("execution_submitted");
    } else if (tradeResult.status === "confirmed") {
      reasonCodes.push("execution_confirmed");
    } else {
      reasonCodes.push("execution_submitted");
    }
  } else {
    const errorCode = inferExecutionErrorCode(tradeResult.errorType, tradeResult.error);
    reasonCodes.push("execution_failed", errorCode);
    blockingReasonCodes.push("execution_failed", errorCode);
    const executionMessageBundle = normalizeReasonMessage(tradeResult.error, "execution");
    reasonCodes.push(...executionMessageBundle.reasonCodes);
    blockingReasonCodes.push(...executionMessageBundle.blockingReasonCodes);
  }

  if (options?.effectiveMode === "paper") {
    reasonCodes.push("paper_mode_selected");
    if (tradeResult.success) {
      reasonCodes.push("paper_execution_recorded");
    }
  }
  if (options?.requestedMode === "live" && options.effectiveMode === "live" && tradeResult.success) {
    reasonCodes.push("auto_execute_allowed");
  }
  if (options?.degradedToPaper) {
    reasonCodes.push("degraded_to_paper", "live_gate_failed");
    blockingReasonCodes.push("execution_backend_unready");
  }
  return {
    reasonCodes: dedupe(reasonCodes),
    blockingReasonCodes: dedupe(blockingReasonCodes),
  };
}

export function mergeReasonBundles(bundles: NormalizedReasonBundle[]): NormalizedReasonBundle {
  let merged: NormalizedReasonBundle = { reasonCodes: [], blockingReasonCodes: [] };
  for (const bundle of bundles) {
    merged = mergeCodes(merged, bundle);
  }
  return merged;
}

