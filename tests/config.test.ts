import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/skills/alphaos/runtime/config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig security defaults", () => {
  it("defaults live toggles to false", () => {
    delete process.env.LIVE_ENABLED;
    delete process.env.AUTO_PROMOTE_TO_LIVE;

    const config = loadConfig();
    expect(config.liveEnabled).toBe(false);
    expect(config.autoPromoteToLive).toBe(false);
  });

  it("reads API secret and demo visibility from env", () => {
    process.env.API_SECRET = "example-secret";
    process.env.DEMO_PUBLIC = "true";

    const config = loadConfig();
    expect(config.apiSecret).toBe("example-secret");
    expect(config.demoPublic).toBe(true);
  });

  it("reads private submit configuration from env", () => {
    process.env.ONCHAINOS_PRIVATE_RPC_URL = "https://private-rpc.example";
    process.env.ONCHAINOS_RELAY_URL = "https://relay.example";
    process.env.ONCHAINOS_USE_PRIVATE_SUBMIT = "true";

    const config = loadConfig();
    expect(config.onchainPrivateRpcUrl).toBe("https://private-rpc.example");
    expect(config.onchainRelayUrl).toBe("https://relay.example");
    expect(config.onchainUsePrivateSubmit).toBe(true);
  });

  it("reads cost-model parameters from env", () => {
    process.env.MEV_PENALTY_BPS = "7";
    process.env.LIQUIDITY_USD_DEFAULT = "900000";
    process.env.VOLATILITY_DEFAULT = "0.05";
    process.env.AVG_LATENCY_MS_DEFAULT = "320";
    process.env.EVAL_NOTIONAL_USD_DEFAULT = "1800";

    const config = loadConfig();
    expect(config.mevPenaltyBps).toBe(7);
    expect(config.liquidityUsdDefault).toBe(900000);
    expect(config.volatilityDefault).toBe(0.05);
    expect(config.avgLatencyMsDefault).toBe(320);
    expect(config.evalNotionalUsdDefault).toBe(1800);
  });

  it("reads websocket and quote freshness configuration from env", () => {
    process.env.WS_ENABLED = "true";
    process.env.WS_URL = "wss://quotes.example/ws";
    process.env.WS_RECONNECT_MS = "750";
    process.env.QUOTE_STALE_MS = "850";

    const config = loadConfig();
    expect(config.wsEnabled).toBe(true);
    expect(config.wsUrl).toBe("wss://quotes.example/ws");
    expect(config.wsReconnectMs).toBe(750);
    expect(config.quoteStaleMs).toBe(850);
  });
});
