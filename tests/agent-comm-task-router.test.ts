import { describe, expect, it, vi } from "vitest";
import {
  routeCommand,
  type TaskRouterOptions,
} from "../src/skills/alphaos/runtime/agent-comm/task-router";

function createRouterOptions(): TaskRouterOptions {
  return {
    discovery: {
      startSession: vi.fn(),
      getReport: vi.fn(),
      approveCandidate: vi.fn(),
    },
    onchain: {
      probeConnection: vi.fn(),
    },
    engine: {
      requestMode: vi.fn(),
    },
    store: {},
  } as unknown as TaskRouterOptions;
}

describe("agent-comm task router", () => {
  it("routes probe_execution to onchain.probeConnection", async () => {
    const options = createRouterOptions();
    vi.mocked(options.onchain.probeConnection).mockResolvedValue({
      ok: true,
      configured: true,
      mode: "v6",
      pair: "ETH/USDC",
      chainIndex: "196",
      notionalUsd: 25,
      simulateRequired: true,
      message: "v6 probe passed",
      checkedAt: "2026-03-08T00:00:00.000Z",
    });

    const result = await routeCommand(options, {
      type: "probe_execution",
      payload: {
        pair: "ETH/USDC",
        chainIndex: "196",
        notionalUsd: 25,
      },
    });

    expect(options.onchain.probeConnection).toHaveBeenCalledWith({
      pair: "ETH/USDC",
      chainIndex: "196",
      notionalUsd: 25,
    });
    expect(result).toEqual({
      success: true,
      result: {
        ok: true,
        configured: true,
        mode: "v6",
        pair: "ETH/USDC",
        chainIndex: "196",
        notionalUsd: 25,
        simulateRequired: true,
        message: "v6 probe passed",
        checkedAt: "2026-03-08T00:00:00.000Z",
      },
    });
  });

  it("routes probe_onchainos to onchain.probeConnection", async () => {
    const options = createRouterOptions();
    vi.mocked(options.onchain.probeConnection).mockResolvedValue({
      ok: true,
      configured: true,
      mode: "v6",
      pair: "ETH/USDC",
      chainIndex: "196",
      notionalUsd: 25,
      simulateRequired: true,
      message: "v6 probe passed",
      checkedAt: "2026-03-08T00:00:00.000Z",
    });

    const result = await routeCommand(options, {
      type: "probe_onchainos",
      payload: {
        pair: "ETH/USDC",
        chainIndex: "196",
        notionalUsd: 25,
      },
    });

    expect(result.success).toBe(true);
    expect(options.onchain.probeConnection).toHaveBeenCalledWith({
      pair: "ETH/USDC",
      chainIndex: "196",
      notionalUsd: 25,
    });
    expect(result.result).toMatchObject({
      ok: true,
      pair: "ETH/USDC",
      chainIndex: "196",
    });
  });

  it("maps successful request_mode_change responses to RouteResult.success", async () => {
    const options = createRouterOptions();
    vi.mocked(options.engine.requestMode).mockReturnValue({
      ok: true,
      requestedMode: "paper",
      currentMode: "paper",
      reasons: [],
    });

    const result = await routeCommand(options, {
      type: "request_mode_change",
      payload: {
        requestedMode: "paper",
      },
    });

    expect(result.success).toBe(true);
    expect(options.engine.requestMode).toHaveBeenCalledWith("paper");
    expect(result.result).toEqual({
      ok: true,
      requestedMode: "paper",
      currentMode: "paper",
      reasons: [],
    });
  });

  it("maps rejected request_mode_change responses to RouteResult.error", async () => {
    const options = createRouterOptions();
    vi.mocked(options.engine.requestMode).mockReturnValue({
      ok: false,
      requestedMode: "live",
      currentMode: "paper",
      reasons: ["live gate blocked"],
    });

    const result = await routeCommand(options, {
      type: "request_mode_change",
      payload: {
        requestedMode: "live",
        reason: "operator requested",
      },
    });

    expect(result.success).toBe(false);
    expect(options.engine.requestMode).toHaveBeenCalledWith("live");
    expect(result.result).toEqual({
      ok: false,
      requestedMode: "live",
      currentMode: "paper",
      reasons: ["live gate blocked"],
    });
    expect(result.error).toBe("live gate blocked");
  });
});
