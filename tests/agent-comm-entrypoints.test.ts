import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlphaOsConfig } from "../src/skills/alphaos/runtime/config";
import { loadConfig } from "../src/skills/alphaos/runtime/config";
import { decodeEnvelope } from "../src/skills/alphaos/runtime/agent-comm/calldata-codec";
import { decrypt, deriveSharedKey } from "../src/skills/alphaos/runtime/agent-comm/ecdh-crypto";
import {
  exportIdentityArtifactBundle,
  getCommIdentity,
  importIdentityArtifactBundle,
  importIdentityArtifactBundleFromJson,
  initCommWallet,
  initTemporaryDemoWallet,
  listLocalIdentityProfiles,
  registerTrustedPeerEntry,
  sendCommPing,
  sendCommStartDiscovery,
} from "../src/skills/alphaos/runtime/agent-comm/entrypoints";
import { restoreShadowWallet } from "../src/skills/alphaos/runtime/agent-comm/shadow-wallet";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { VaultService } from "../src/skills/alphaos/runtime/vault";

const createPublicClientMock = vi.hoisted(() => vi.fn());
const createWalletClientMock = vi.hoisted(() => vi.fn());

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    createWalletClient: createWalletClientMock,
  };
});

const originalEnv = { ...process.env };
const stores: Array<{ dir: string; store: StateStore }> = [];

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

function createDeps(prefix: string, overrides: Partial<AlphaOsConfig> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new StateStore(dir);
  const vault = new VaultService(store);
  stores.push({ dir, store });

  return {
    config: createConfig({
      dataDir: dir,
      commChainId: 196,
      commRpcUrl: "http://localhost:8545",
      commWalletAlias: "agent-comm",
      ...overrides,
    }),
    store,
    vault,
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
  for (const entry of stores.splice(0)) {
    entry.store.close();
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }
});

describe("agent-comm entrypoints", () => {
  it("initializes a generated comm wallet and resolves identity", () => {
    const deps = createDeps("alphaos-comm-entry-");

    const initialized = initCommWallet(deps, {
      masterPassword: "pass123",
    });
    const identity = getCommIdentity(deps, {
      masterPassword: "pass123",
    });

    expect(initialized.source).toBe("generated");
    expect(initialized.replaced).toBe(false);
    expect(identity.address).toBe(initialized.address);
    expect(identity.pubkey).toBe(initialized.pubkey);
    expect(identity.chainId).toBe(196);
    expect(identity.walletAlias).toBe("agent-comm");
    expect(identity.defaultSenderPeerId).toBe("agent-comm");
  });

  it("exports and imports local identity artifacts with verification metadata", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });

    const exported = await exportIdentityArtifactBundle(deps, {
      masterPassword: "pass123",
      displayName: "Local Operator",
      keyId: "rk_test_01",
      nowUnixSeconds: 1741348800,
      expiresInDays: 30,
    });

    expect(exported.contactCardDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(exported.transportBindingDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(exported.profiles.map((profile) => profile.role)).toEqual(expect.arrayContaining(["liw", "acw"]));
    expect(exported.bundle.contactCard.displayName).toBe("Local Operator");

    const imported = await importIdentityArtifactBundle(
      {
        config: deps.config,
        store: deps.store,
      },
      {
        bundle: exported.bundle,
        source: "entrypoint-test-import",
        nowUnixSeconds: 1741348800,
      },
    );
    expect(imported.ok).toBe(true);

    const profiles = listLocalIdentityProfiles(deps, {
      masterPassword: "pass123",
    });
    expect(profiles.find((profile) => profile.role === "acw")?.activeBindingDigest).toBe(
      exported.transportBindingDigest,
    );
    expect(deps.store.listAgentSignedArtifacts(10)).toHaveLength(2);
  });

  it("classifies artifact import failures with explicit reason codes", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });

    const exported = await exportIdentityArtifactBundle(deps, {
      masterPassword: "pass123",
      nowUnixSeconds: 1741348800,
      expiresInDays: 1,
    });

    const tamperedBundle = {
      ...exported.bundle,
      contactCard: {
        ...exported.bundle.contactCard,
        displayName: "Tampered",
      },
      transportBinding: {
        ...exported.bundle.transportBinding,
        receiveAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    const imported = await importIdentityArtifactBundle(
      {
        config: deps.config,
        store: deps.store,
      },
      {
        bundle: tamperedBundle,
        expectedChainId: 8453,
        nowUnixSeconds: exported.bundle.contactCard.expiresAt + 1,
      },
    );

    expect(imported.ok).toBe(false);
    expect(imported.failureCodes).toEqual(
      expect.arrayContaining([
        "bad_signature",
        "expired_artifact",
        "domain_mismatch",
        "malformed_transport_binding",
      ]),
    );
  });

  it("returns invalid_artifact when importing malformed artifact JSON", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const imported = await importIdentityArtifactBundleFromJson(
      {
        config: deps.config,
        store: deps.store,
      },
      "{not-json",
    );

    expect(imported.ok).toBe(false);
    expect(imported.failureCodes).toEqual(["invalid_artifact"]);
    expect(imported.reasons[0]).toMatch(/invalid artifact bundle JSON/i);
  });

  it("initializes a temporary demo wallet profile without mutating LIW/ACW aliasing", () => {
    const deps = createDeps("alphaos-comm-entry-");
    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });

    const demo = initTemporaryDemoWallet(deps, {
      masterPassword: "pass123",
      privateKey: "0x4444444444444444444444444444444444444444444444444444444444444444",
    });

    expect(demo.role).toBe("temporary_demo");
    expect(demo.walletAlias).toBe("agent-comm-demo");
    expect(deps.store.getAgentLocalIdentity("temporary_demo")?.walletAlias).toBe("agent-comm-demo");
    expect(deps.store.getAgentLocalIdentity("liw")?.walletAlias).toBe("agent-comm");
    expect(deps.store.getAgentLocalIdentity("acw")?.walletAlias).toBe("agent-comm");
  });

  it("registers trusted peers with minimal defaults", () => {
    const deps = createDeps("alphaos-comm-entry-");
    const peerWallet = restoreShadowWallet(
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );

    const peer = registerTrustedPeerEntry(
      {
        store: deps.store,
      },
      {
        peerId: "peer-b",
        walletAddress: peerWallet.getAddress(),
        pubkey: peerWallet.getPublicKey(),
        name: "Peer B",
      },
    );

    expect(peer.status).toBe("trusted");
    expect(peer.capabilities).toEqual(["ping", "start_discovery"]);
    expect(peer.name).toBe("Peer B");
  });

  it("sends ping to a trusted peer using registered peer data", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    registerTrustedPeerEntry(
      {
        store: deps.store,
      },
      {
        peerId: "peer-b",
        walletAddress: peerWallet.getAddress(),
        pubkey: peerWallet.getPublicKey(),
      },
    );

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 7),
    });
    const sendTransaction = vi.fn(
      async (_request: { data: string; to: string }) => "0xtx-ping",
    );
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    const result = await sendCommPing(deps, {
      masterPassword: "pass123",
      peerId: "peer-b",
      senderPeerId: "peer-a",
      echo: "hello",
      note: "unit-test",
    });

    const requestCall = sendTransaction.mock.calls[0];
    expect(requestCall).toBeDefined();
    const request = requestCall?.[0] as unknown as { data: string; to: string };
    const envelope = decodeEnvelope(request.data);
    const sharedKey = deriveSharedKey(peerWallet.privateKey, getCommIdentity(deps, { masterPassword: "pass123" }).pubkey);
    const plaintext = JSON.parse(decrypt(envelope.ciphertext, sharedKey)) as {
      type: string;
      payload: Record<string, string>;
    };

    expect(result.txHash).toBe("0xtx-ping");
    expect(result.peerId).toBe("peer-b");
    expect(result.senderPeerId).toBe("peer-a");
    expect(request.to).toBe(peerWallet.getAddress());
    expect(envelope.senderPeerId).toBe("peer-a");
    expect(plaintext).toEqual({
      type: "ping",
      payload: {
        echo: "hello",
        note: "unit-test",
      },
    });
    expect(deps.store.findAgentMessage("peer-b", "outbound", result.nonce)?.status).toBe("sent");
  });

  it("sends start_discovery with the requested payload", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x3333333333333333333333333333333333333333333333333333333333333333",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    registerTrustedPeerEntry(
      {
        store: deps.store,
      },
      {
        peerId: "peer-c",
        walletAddress: peerWallet.getAddress(),
        pubkey: peerWallet.getPublicKey(),
      },
    );

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 8),
    });
    const sendTransaction = vi.fn(
      async (_request: { data: string }) => "0xtx-discovery",
    );
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    const result = await sendCommStartDiscovery(deps, {
      masterPassword: "pass123",
      peerId: "peer-c",
      strategyId: "spread-threshold",
      pairs: ["ETH/USDC", "BTC/USDC"],
      durationMinutes: 30,
      sampleIntervalSec: 5,
      topN: 10,
    });

    const requestCall = sendTransaction.mock.calls[0];
    expect(requestCall).toBeDefined();
    const request = requestCall?.[0] as unknown as { data: string };
    const envelope = decodeEnvelope(request.data);
    const sharedKey = deriveSharedKey(peerWallet.privateKey, getCommIdentity(deps, { masterPassword: "pass123" }).pubkey);
    const plaintext = JSON.parse(decrypt(envelope.ciphertext, sharedKey)) as {
      type: string;
      payload: Record<string, unknown>;
    };

    expect(result.txHash).toBe("0xtx-discovery");
    expect(result.commandType).toBe("start_discovery");
    expect(plaintext).toEqual({
      type: "start_discovery",
      payload: {
        strategyId: "spread-threshold",
        pairs: ["ETH/USDC", "BTC/USDC"],
        durationMinutes: 30,
        sampleIntervalSec: 5,
        topN: 10,
      },
    });
    expect(deps.store.findAgentMessage("peer-c", "outbound", result.nonce)?.status).toBe("sent");
  });
});
