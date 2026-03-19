import type { StateStore } from "../state-store";
import type { DiscoveryEngine } from "../discovery/discovery-engine";
import type { OnchainOsClient } from "../onchainos-client";
import type { EngineModeResponse, ExecutionMode } from "../../types";
import type { AgentCommand } from "./types";

export interface TaskRouterEngine {
  requestMode(mode: ExecutionMode): EngineModeResponse;
}

export interface TaskRouterOptions {
  discovery: DiscoveryEngine;
  onchain: Pick<OnchainOsClient, "probeConnection">;
  engine: TaskRouterEngine;
  store: StateStore;
}

export interface RouteResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function routeCommand(
  options: TaskRouterOptions,
  command: AgentCommand,
): Promise<RouteResult> {
  try {
    switch (command.type) {
      case "ping":
        return { success: true, result: "pong" };

      case "start_discovery": {
        const payload = command.payload;
        if (!payload.strategyId) {
          return { success: false, error: "strategyId is required" };
        }
        const session = await options.discovery.startSession({
          strategyId: payload.strategyId,
          pairs: payload.pairs ?? [],
          durationMinutes: payload.durationMinutes,
          sampleIntervalSec: payload.sampleIntervalSec,
          topN: payload.topN,
        });
        return { success: true, result: session };
      }

      case "get_discovery_report": {
        const payload = command.payload;
        const report = options.discovery.getReport(payload.sessionId);
        if (!report) {
          return { success: false, error: "report not ready" };
        }
        return { success: true, result: report };
      }

      case "approve_candidate": {
        const payload = command.payload;
        const result = await options.discovery.approveCandidate(
          payload.sessionId,
          payload.candidateId,
          payload.mode ?? "paper",
        );
        return { success: true, result };
      }

      case "probe_execution":
      case "probe_onchainos": {
        const payload = command.payload;
        const result = await options.onchain.probeConnection({
          pair: payload.pair,
          chainIndex: payload.chainIndex,
          notionalUsd: payload.notionalUsd,
        });
        return { success: true, result };
      }

      case "request_mode_change": {
        const payload = command.payload;
        const result = options.engine.requestMode(payload.requestedMode);
        if (result.ok) {
          return { success: true, result };
        }
        return {
          success: false,
          result,
          error:
            result.reasons.join("; ")
            || `mode change rejected: requested=${payload.requestedMode} current=${result.currentMode}`,
        };
      }

      default:
        return {
          success: false,
          error: `unsupported command type: ${(command as { type: string }).type}`,
        };
    }
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}
