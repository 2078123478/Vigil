import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlphaOsConfig } from "../src/skills/alphaos/runtime/config";
import { loadConfig } from "../src/skills/alphaos/runtime/config";
import { InboxProcessingError } from "../src/skills/alphaos/runtime/agent-comm/inbox-processor";
import {
  initCommWallet,
  rotateCommWallet,
} from "../src/skills/alphaos/runtime/agent-comm/entrypoints";
import { startAgentCommRuntime } from "../src/skills/alphaos/runtime/agent-comm/runtime";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { VaultService } from "../src/skills/alphaos/runtime/vault";

const createPublicClientMock = vi.hoisted(() => vi.fn());
const startListenerMock = vi.hoisted(() => vi.fn());
const processInboxMock = vi.hoisted(() => vi.fn());
const routeCommandMock = vi.hoisted(() => vi.fn());

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
  };
});

vi.mock("../src/skills/alphaos/runtime/agent-comm/tx-listener", async () => {
  const actual = await vi.importActual<
    typeof import("../src/skills/alphaos/runtime/agent-comm/tx-listener")
  >("../src/skills/alphaos/runtime/agent-comm/tx-listener");
  return {
    ...actual,
    startListener: startListenerMock,
  };
});

vi.mock("../src/skills/alphaos/runtime/agent-comm/inbox-processor", async () => {
  const actual = await vi.importActual<
    typeof import("../src/skills/alphaos/runtime/agent-comm/inbox-processor")
  >("../src/skills/alphaos/runtime/agent-comm/inbox-processor");
  return {
    ...actual,
    processInbox: processInboxMock,
  };
});

vi.mock("../src/skills/alphaos/runtime/agent-comm/task-router", async () => {
  const actual = await vi.importActual<
    typeof import("../src/skills/alphaos/runtime/agent-comm/task-router")
  >("../src/skills/alphaos/runtime/agent-comm/task-router");
  return {
    ...actual,
    routeCommand: routeCommandMock,
  };
});

const originalEnv = { ...process.env };
const stores: Array<{ dir: string; store: StateStore }> = [];

function createStore(prefix: string): { dir: string; store: StateStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new StateStore(dir);
  stores.push({ dir, store });
  return { dir, store };
}

function createConfig(overrides: Partial<AlphaOsConfig>): AlphaOsConfig {
  delete process.env.COMM_ENABLED;
  delete process.env.COMM_RPC_URL;
  delete process.env.COMM_LISTENER_MODE;
  const base = loadConfig();
  return {
    ...base,
    ...overrides,
  };
}

function createLoggerMock() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetAllMocks();
  for (const entry of stores.splice(0)) {
    entry.store.close();
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }
});

describe("agent-comm runtime bootstrap", () => {
  it("fails fast when VAULT_MASTER_PASSWORD is missing", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    delete process.env.VAULT_MASTER_PASSWORD;

    const config = createConfig({
      commEnabled: true,
      commListenerMode: "disabled",
      commRpcUrl: "http://localhost:8545",
      commChainId: 196,
      commWalletAlias: "agent-comm",
    });

    await expect(
      startAgentCommRuntime({
        config,
        logger: createLoggerMock() as never,
        store,
        discovery: {} as never,
        onchain: {} as never,
        vault: {
          getSecret: vi.fn(),
        } as never,
      }),
    ).rejects.toThrow("COMM_ENABLED=true requires VAULT_MASTER_PASSWORD");
  });

  it("fails fast when comm wallet alias is missing in vault", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    const config = createConfig({
      commEnabled: true,
      commListenerMode: "disabled",
      commRpcUrl: "http://localhost:8545",
      commChainId: 196,
      commWalletAlias: "missing-wallet",
    });

    await expect(
      startAgentCommRuntime({
        config,
        logger: createLoggerMock() as never,
        store,
        discovery: {} as never,
        onchain: {} as never,
        vault: {
          getSecret: vi.fn(() => {
            throw new Error("Secret not found: missing-wallet");
          }),
        } as never,
      }),
    ).rejects.toThrow("Secret not found: missing-wallet");
  });

  it("fails fast when RPC chain id mismatches COMM_CHAIN_ID", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 8453),
    });

    const config = createConfig({
      commEnabled: true,
      commListenerMode: "disabled",
      commRpcUrl: "http://localhost:8545",
      commChainId: 196,
      commWalletAlias: "agent-comm",
    });

    await expect(
      startAgentCommRuntime({
        config,
        logger: createLoggerMock() as never,
        store,
        discovery: {} as never,
        onchain: {} as never,
        vault: {
          getSecret: vi.fn(() => "0x1111111111111111111111111111111111111111111111111111111111111111"),
        } as never,
      }),
    ).rejects.toThrow("RPC chainId mismatch: expected 196, received 8453");
  });

  it("records runtime error for pre-store inbox failures and does not write synthetic messages", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
    });

    processInboxMock.mockRejectedValue(
      new InboxProcessingError("DECRYPT_FAILED", "Failed to decrypt inbound envelope"),
    );
    routeCommandMock.mockResolvedValue({ success: true, result: "ignored" });

    const stop = vi.fn();
    startListenerMock.mockImplementation((_opts, onTransaction) => {
      void onTransaction({
        txHash: "0xpre-store",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        calldata: "0x1234",
        blockNumber: 10n,
        timestamp: new Date().toISOString(),
      });
      return stop;
    });

    const runtime = await startAgentCommRuntime({
      config: createConfig({
        commEnabled: true,
        commListenerMode: "poll",
        commRpcUrl: "http://localhost:8545",
        commChainId: 196,
        commWalletAlias: "agent-comm",
      }),
      logger: createLoggerMock() as never,
      store,
      discovery: {} as never,
      onchain: {} as never,
      vault: {
        getSecret: vi.fn(() => "0x1111111111111111111111111111111111111111111111111111111111111111"),
      } as never,
    });

    await vi.waitFor(() => {
      expect(runtime.getSnapshot().lastRuntimeError?.code).toBe("DECRYPT_FAILED");
    });
    expect(store.listAgentMessages(20)).toHaveLength(0);
    expect(routeCommandMock).not.toHaveBeenCalled();

    runtime.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("marks message rejected when route fails after inbound message has been persisted", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
    });

    const message = store.insertAgentMessage({
      id: "inbound-1",
      direction: "inbound",
      peerId: "peer-a",
      nonce: "nonce-1",
      commandType: "ping",
      ciphertext: "0xcipher",
      status: "decrypted",
      receivedAt: new Date().toISOString(),
    });

    processInboxMock.mockResolvedValue({
      message,
      command: {
        type: "ping",
        payload: {},
      },
    });
    routeCommandMock.mockResolvedValue({
      success: false,
      error: "unsupported command for runtime",
    });

    const stop = vi.fn();
    startListenerMock.mockImplementation((_opts, onTransaction) => {
      void onTransaction({
        txHash: "0xpost-store",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        calldata: "0x1234",
        blockNumber: 11n,
        timestamp: new Date().toISOString(),
      });
      return stop;
    });

    const runtime = await startAgentCommRuntime({
      config: createConfig({
        commEnabled: true,
        commListenerMode: "poll",
        commRpcUrl: "http://localhost:8545",
        commChainId: 196,
        commWalletAlias: "agent-comm",
      }),
      logger: createLoggerMock() as never,
      store,
      discovery: {} as never,
      onchain: {} as never,
      vault: {
        getSecret: vi.fn(() => "0x1111111111111111111111111111111111111111111111111111111111111111"),
      } as never,
    });

    await vi.waitFor(() => {
      expect(store.getAgentMessage("inbound-1")?.status).toBe("rejected");
    });
    expect(store.getAgentMessage("inbound-1")?.error).toContain("unsupported command");
    expect(runtime.getSnapshot().lastRuntimeError).toBeUndefined();

    runtime.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("marks message executed when route succeeds", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
    });

    const message = store.insertAgentMessage({
      id: "inbound-success",
      direction: "inbound",
      peerId: "peer-a",
      nonce: "nonce-success",
      commandType: "ping",
      ciphertext: "0xcipher",
      status: "decrypted",
      receivedAt: new Date().toISOString(),
    });

    processInboxMock.mockResolvedValue({
      message,
      command: {
        type: "ping",
        payload: {},
      },
    });
    routeCommandMock.mockResolvedValue({
      success: true,
      result: "pong",
    });

    const stop = vi.fn();
    startListenerMock.mockImplementation((_opts, onTransaction) => {
      void onTransaction({
        txHash: "0xsuccess",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        calldata: "0x1234",
        blockNumber: 13n,
        timestamp: new Date().toISOString(),
      });
      return stop;
    });

    const runtime = await startAgentCommRuntime({
      config: createConfig({
        commEnabled: true,
        commListenerMode: "poll",
        commRpcUrl: "http://localhost:8545",
        commChainId: 196,
        commWalletAlias: "agent-comm",
      }),
      logger: createLoggerMock() as never,
      store,
      discovery: {} as never,
      onchain: {} as never,
      vault: {
        getSecret: vi.fn(() => "0x1111111111111111111111111111111111111111111111111111111111111111"),
      } as never,
    });

    await vi.waitFor(() => {
      expect(store.getAgentMessage("inbound-success")?.status).toBe("executed");
    });
    expect(store.getAgentMessage("inbound-success")?.executedAt).toBeDefined();
    expect(runtime.getSnapshot().lastRuntimeError).toBeUndefined();

    runtime.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("backfills legacy peers into contacts during runtime startup", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    store.upsertAgentPeer({
      peerId: "legacy-peer",
      walletAddress: "0x7777777777777777777777777777777777777777",
      pubkey: "03cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      status: "trusted",
      capabilities: ["ping"],
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
    });

    const runtime = await startAgentCommRuntime({
      config: createConfig({
        commEnabled: true,
        commListenerMode: "disabled",
        commRpcUrl: "http://localhost:8545",
        commChainId: 196,
        commWalletAlias: "agent-comm",
      }),
      logger: createLoggerMock() as never,
      store,
      discovery: {} as never,
      onchain: {} as never,
      vault: {
        getSecret: vi.fn(() => "0x1111111111111111111111111111111111111111111111111111111111111111"),
      } as never,
    });

    expect(store.getAgentContactByLegacyPeerId("legacy-peer")?.supportedProtocols).toContain(
      "agent-comm/1",
    );

    runtime.stop();
  });

  it("starts listeners for active and grace receive addresses after ACW rotation", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    const config = createConfig({
      commEnabled: true,
      commListenerMode: "poll",
      commRpcUrl: "http://localhost:8545",
      commChainId: 196,
      commWalletAlias: "agent-comm",
    });
    const vault = new VaultService(store);
    initCommWallet(
      {
        config,
        store,
        vault,
      },
      {
        masterPassword: "pass123",
        privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    );
    const rotated = await rotateCommWallet(
      {
        config,
        store,
        vault,
      },
      {
        masterPassword: "pass123",
        privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
        nowUnixSeconds: Math.floor(Date.now() / 1000),
      },
    );

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
    });

    const stopActive = vi.fn();
    const stopGrace = vi.fn();
    startListenerMock
      .mockImplementationOnce(() => stopActive)
      .mockImplementationOnce(() => stopGrace);

    const runtime = await startAgentCommRuntime({
      config,
      logger: createLoggerMock() as never,
      store,
      discovery: {} as never,
      onchain: {} as never,
      vault,
    });

    expect(startListenerMock).toHaveBeenCalledTimes(2);
    const addresses = startListenerMock.mock.calls.map((call) => call[0].address);
    expect(addresses).toContain(rotated.transportAddress);
    expect(addresses).toContain(rotated.previousTransportAddress);
    expect(runtime.getSnapshot().receiveAddresses).toEqual(
      expect.arrayContaining([rotated.transportAddress, rotated.previousTransportAddress]),
    );
    expect(runtime.getSnapshot().graceReceiveAddresses).toEqual([rotated.previousTransportAddress]);

    runtime.stop();
    expect(stopActive).toHaveBeenCalledOnce();
    expect(stopGrace).toHaveBeenCalledOnce();
  });

  it("does not re-execute messages already in executed status", async () => {
    const { store } = createStore("alphaos-comm-runtime-");
    process.env.VAULT_MASTER_PASSWORD = "pass123";

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
    });

    const message = store.insertAgentMessage({
      id: "inbound-executed",
      direction: "inbound",
      peerId: "peer-a",
      nonce: "nonce-executed",
      commandType: "ping",
      ciphertext: "0xcipher",
      status: "executed",
      receivedAt: new Date().toISOString(),
      executedAt: new Date().toISOString(),
    });

    processInboxMock.mockResolvedValue({
      message,
      command: {
        type: "ping",
        payload: {},
      },
    });
    routeCommandMock.mockResolvedValue({
      success: true,
      result: "pong",
    });

    const stop = vi.fn();
    startListenerMock.mockImplementation((_opts, onTransaction) => {
      void onTransaction({
        txHash: "0xexecuted",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        calldata: "0x1234",
        blockNumber: 12n,
        timestamp: new Date().toISOString(),
      });
      return stop;
    });

    const runtime = await startAgentCommRuntime({
      config: createConfig({
        commEnabled: true,
        commListenerMode: "poll",
        commRpcUrl: "http://localhost:8545",
        commChainId: 196,
        commWalletAlias: "agent-comm",
      }),
      logger: createLoggerMock() as never,
      store,
      discovery: {} as never,
      onchain: {} as never,
      vault: {
        getSecret: vi.fn(() => "0x1111111111111111111111111111111111111111111111111111111111111111"),
      } as never,
    });

    await vi.waitFor(() => {
      expect(processInboxMock).toHaveBeenCalledOnce();
    });
    expect(routeCommandMock).not.toHaveBeenCalled();
    expect(store.getAgentMessage("inbound-executed")?.status).toBe("executed");

    runtime.stop();
    expect(stop).toHaveBeenCalledOnce();
  });
});
