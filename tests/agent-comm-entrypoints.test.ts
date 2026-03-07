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
  rotateCommWallet,
  sendCommConnectionAccept,
  sendCommConnectionConfirm,
  sendCommConnectionInvite,
  sendCommConnectionReject,
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

function decryptOutboundCommand(
  requestData: string,
  recipientPrivateKey: string,
): {
  envelope: ReturnType<typeof decodeEnvelope>;
  command: { type: string; payload: Record<string, unknown> };
  body?: Record<string, unknown>;
} {
  const envelope = decodeEnvelope(requestData);
  if (envelope.version === 1) {
    const sharedKey = deriveSharedKey(recipientPrivateKey, envelope.senderPubkey);
    return {
      envelope,
      command: JSON.parse(decrypt(envelope.ciphertext, sharedKey)) as {
        type: string;
        payload: Record<string, unknown>;
      },
    };
  }

  const sharedKey = deriveSharedKey(recipientPrivateKey, envelope.kex.ephemeralPubkey);
  const body = JSON.parse(decrypt(envelope.ciphertext, sharedKey)) as {
    command: { type: string; payload: Record<string, unknown> };
  } & Record<string, unknown>;
  return {
    envelope,
    command: body.command,
    body,
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
    expect(identity.identityWallet).not.toBe(identity.address);
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
    expect(imported.contactId).toBeDefined();
    expect(imported.identityWallet).toBe(
      exported.profiles.find((profile) => profile.role === "liw")?.walletAddress,
    );
    expect(imported.status).toBe("imported");
    expect(imported.activeTransportAddress).toBe(exported.identity.transportAddress);

    const profiles = listLocalIdentityProfiles(deps, {
      masterPassword: "pass123",
    });
    expect(profiles.find((profile) => profile.role === "acw")?.activeBindingDigest).toBe(
      exported.transportBindingDigest,
    );
    expect(deps.store.listAgentSignedArtifacts(10)).toHaveLength(2);
    expect(deps.store.getAgentContact(imported.contactId ?? "")).toEqual(
      expect.objectContaining({
        contactId: imported.contactId,
        identityWallet: exported.profiles.find((profile) => profile.role === "liw")?.walletAddress,
        status: "imported",
      }),
    );
    expect(
      deps.store.listAgentTransportEndpoints(10, {
        contactId: imported.contactId,
        endpointStatus: "active",
      })[0],
    ).toEqual(
      expect.objectContaining({
        contactId: imported.contactId,
        receiveAddress: exported.identity.address,
        bindingDigest: exported.transportBindingDigest,
      }),
    );
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
    expect(deps.store.listAgentContacts(10)).toHaveLength(0);
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

  it("preserves legacy single-wallet installs as temporary dual-use until rotation", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const legacyPrivateKey =
      "0x1212121212121212121212121212121212121212121212121212121212121212";
    const rotatedPrivateKey =
      "0x3434343434343434343434343434343434343434343434343434343434343434";
    deps.vault.setSecret("agent-comm", legacyPrivateKey, "pass123");

    const identityBefore = getCommIdentity(deps, {
      masterPassword: "pass123",
    });
    expect(identityBefore.localIdentityMode).toBe("temporary_dual_use");
    expect(identityBefore.identityWallet).toBe(identityBefore.transportAddress);

    const rotated = await rotateCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: rotatedPrivateKey,
      nowUnixSeconds: Math.floor(Date.now() / 1000),
    });

    expect(rotated.previousTransportAddress).toBe(identityBefore.transportAddress);
    expect(rotated.transportAddress).not.toBe(identityBefore.transportAddress);
    expect(rotated.identityWallet).toBe(identityBefore.identityWallet);
    expect(rotated.graceExpiresAt).toBeDefined();

    const profiles = listLocalIdentityProfiles(deps, {
      masterPassword: "pass123",
    });
    expect(profiles.find((profile) => profile.role === "liw")?.walletAddress).toBe(
      identityBefore.identityWallet,
    );
    expect(profiles.find((profile) => profile.role === "acw")?.walletAddress).toBe(
      rotated.transportAddress,
    );
    expect(
      (profiles.find((profile) => profile.role === "acw")?.metadata?.graceReceiveKeys as unknown[])
        ?.length,
    ).toBe(1);
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
    expect(deps.store.getAgentLocalIdentity("liw")?.walletAlias).toBe("agent-comm-liw");
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
    const { envelope, command: plaintext } = decryptOutboundCommand(request.data, peerWallet.privateKey);
    expect(envelope.version).toBe(1);
    if (envelope.version !== 1) {
      throw new Error("expected v1 envelope");
    }

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
    const { command: plaintext } = decryptOutboundCommand(request.data, peerWallet.privateKey);

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

  it("sends connection_invite and persists pending_outbound state", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x5555555555555555555555555555555555555555555555555555555555555555",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      legacyPeerId: "peer-invite",
      status: "imported",
      supportedProtocols: ["agent-comm/2"],
      capabilities: [],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_invite",
      endpointStatus: "active",
      source: "unit-test",
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 9),
    });
    const sendTransaction = vi.fn(async (_request: { data: string }) => "0xtx-invite");
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    const result = await sendCommConnectionInvite(deps, {
      masterPassword: "pass123",
      contactId: contact.contactId,
      requestedProfile: "research-collab",
      requestedCapabilities: ["ping", "start_discovery"],
      note: "invite",
    });

    const requestCall = sendTransaction.mock.calls[0];
    expect(requestCall).toBeDefined();
    const request = requestCall?.[0] as unknown as { data: string };
    const { envelope, command: plaintext } = decryptOutboundCommand(request.data, peerWallet.privateKey);

    expect(result.txHash).toBe("0xtx-invite");
    expect(result.commandType).toBe("connection_invite");
    expect(result.envelopeVersion).toBe(2);
    expect(envelope.version).toBe(2);
    expect(result.contactStatus).toBe("pending_outbound");
    expect(result.connectionEventType).toBe("connection_invite");
    expect(result.connectionEventStatus).toBe("pending");
    expect(plaintext).toEqual({
      type: "connection_invite",
      schemaVersion: 2,
      payload: {
        requestedProfile: "research-collab",
        requestedCapabilities: ["ping", "start_discovery"],
        note: "invite",
      },
    });

    const updatedContact = deps.store.getAgentContact(contact.contactId);
    expect(updatedContact?.status).toBe("pending_outbound");
    const message = deps.store.findAgentMessage("peer-invite", "outbound", result.nonce);
    expect(message?.status).toBe("sent");
    const events = deps.store.listAgentConnectionEvents(10, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_invite",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventStatus).toBe("pending");
    expect(events[0]?.messageId).toBe(message?.id);
  });

  it("sends connection_accept and promotes pending inbound contact to trusted", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x6666666666666666666666666666666666666666666666666666666666666666",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      legacyPeerId: "peer-accept",
      status: "pending_inbound",
      supportedProtocols: ["agent-comm/2"],
      capabilities: ["ping"],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_accept",
      endpointStatus: "active",
      source: "unit-test",
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 10),
    });
    const sendTransaction = vi.fn(async (_request: { data: string }) => "0xtx-accept");
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    const result = await sendCommConnectionAccept(deps, {
      masterPassword: "pass123",
      contactId: contact.contactId,
      capabilityProfile: "research-collab",
      capabilities: ["ping", "start_discovery"],
      note: "approved",
    });

    const requestCall = sendTransaction.mock.calls[0];
    expect(requestCall).toBeDefined();
    const request = requestCall?.[0] as unknown as { data: string };
    const { command: plaintext } = decryptOutboundCommand(request.data, peerWallet.privateKey);

    expect(result.txHash).toBe("0xtx-accept");
    expect(result.commandType).toBe("connection_accept");
    expect(result.contactStatus).toBe("trusted");
    expect(result.connectionEventType).toBe("connection_accept");
    expect(result.connectionEventStatus).toBe("applied");
    expect(plaintext).toEqual({
      type: "connection_accept",
      schemaVersion: 2,
      payload: {
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
        note: "approved",
      },
    });

    const updatedContact = deps.store.getAgentContact(contact.contactId);
    expect(updatedContact?.status).toBe("trusted");
    expect(updatedContact?.capabilityProfile).toBe("research-collab");
    expect(updatedContact?.capabilities).toEqual(["ping", "start_discovery"]);
    const events = deps.store.listAgentConnectionEvents(10, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_accept",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventStatus).toBe("applied");
  });

  it("attaches an inline card bundle on connection_invite when requested", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      legacyPeerId: "peer-inline-invite",
      status: "imported",
      supportedProtocols: ["agent-comm/2"],
      capabilities: [],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_inline_invite",
      endpointStatus: "active",
      source: "unit-test",
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 25),
    });
    const sendTransaction = vi.fn(async (_request: { data: string }) => "0xtx-inline-invite");
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    await sendCommConnectionInvite(deps, {
      masterPassword: "pass123",
      contactId: contact.contactId,
      requestedProfile: "research-collab",
      requestedCapabilities: ["ping"],
      note: "invite with inline card",
      attachInlineCard: true,
    });

    const request = sendTransaction.mock.calls[0]?.[0] as { data: string };
    const { command: plaintext, body } = decryptOutboundCommand(request.data, peerWallet.privateKey);

    expect(plaintext.type).toBe("connection_invite");
    const inlineCard = (body?.attachments as {
      inlineCard?: {
        bundleVersion: number;
        contactCard: { identityWallet: string; legacyPeerId: string };
        transportBinding: { receiveAddress: string };
      };
    } | undefined)?.inlineCard;
    expect(inlineCard?.bundleVersion).toBe(1);
    expect(inlineCard?.contactCard.identityWallet).toBe(
      getCommIdentity(deps, { masterPassword: "pass123" }).identityWallet,
    );
    expect(inlineCard?.contactCard.legacyPeerId).toBe("agent-comm");
    expect(inlineCard?.transportBinding.receiveAddress).toBe(
      getCommIdentity(deps, { masterPassword: "pass123" }).transportAddress,
    );

    const outboundInvite = deps.store.listAgentConnectionEvents(10, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_invite",
    })[0];
    expect(outboundInvite?.metadata).toEqual(
      expect.objectContaining({
        inlineCardContactCardDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        inlineCardTransportBindingDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    );
  });

  it("derives connection_accept capability grants from the pending invite when options omit them", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x7777777777777777777777777777777777777777777777777777777777777777",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      legacyPeerId: "peer-accept-derived",
      status: "pending_inbound",
      supportedProtocols: ["agent-comm/2"],
      capabilities: [],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_accept_derived",
      endpointStatus: "active",
      source: "unit-test",
    });
    deps.store.upsertAgentConnectionEvent({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      direction: "inbound",
      eventType: "connection_invite",
      eventStatus: "pending",
      messageId: "inbound-invite-derive-1",
      txHash: "0xinvite-derive",
      occurredAt: "2026-03-07T00:00:00.000Z",
      metadata: {
        requestedProfile: "research-collab",
        requestedCapabilities: ["ping", "start_discovery"],
      },
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 11),
    });
    const sendTransaction = vi.fn(async (_request: { data: string }) => "0xtx-accept-derived");
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    const result = await sendCommConnectionAccept(deps, {
      masterPassword: "pass123",
      contactId: contact.contactId,
      note: "approved",
    });

    const request = sendTransaction.mock.calls[0]?.[0] as { data: string };
    const { command: plaintext } = decryptOutboundCommand(request.data, peerWallet.privateKey);

    expect(result.contactStatus).toBe("trusted");
    expect(plaintext).toEqual({
      type: "connection_accept",
      schemaVersion: 2,
      payload: {
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
        note: "approved",
      },
    });

    const updatedContact = deps.store.getAgentContact(contact.contactId);
    expect(updatedContact?.capabilityProfile).toBe("research-collab");
    expect(updatedContact?.capabilities).toEqual(["ping", "start_discovery"]);

    const events = deps.store.listAgentConnectionEvents(10, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_accept",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({
      capabilityProfile: "research-collab",
      capabilities: ["ping", "start_discovery"],
      senderPeerId: "agent-comm",
    });
  });

  it("sends connection_confirm, persists the outbound event, and leaves the contact trusted", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x9999999999999999999999999999999999999999999999999999999999999999",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      legacyPeerId: "peer-confirm",
      status: "pending_outbound",
      supportedProtocols: ["agent-comm/2"],
      capabilities: ["ping"],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_confirm",
      endpointStatus: "active",
      source: "unit-test",
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 12),
    });
    const sendTransaction = vi.fn(async (_request: { data: string }) => "0xtx-confirm");
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    const result = await sendCommConnectionConfirm(deps, {
      masterPassword: "pass123",
      contactId: contact.contactId,
      note: "confirmed",
    });

    const requestCall = sendTransaction.mock.calls[0];
    expect(requestCall).toBeDefined();
    const request = requestCall?.[0] as unknown as { data: string };
    const { command: plaintext } = decryptOutboundCommand(request.data, peerWallet.privateKey);

    expect(result.txHash).toBe("0xtx-confirm");
    expect(result.commandType).toBe("connection_confirm");
    expect(result.contactStatus).toBe("trusted");
    expect(result.connectionEventType).toBe("connection_confirm");
    expect(result.connectionEventStatus).toBe("applied");
    expect(plaintext).toEqual({
      type: "connection_confirm",
      schemaVersion: 2,
      payload: {
        note: "confirmed",
      },
    });

    const updatedContact = deps.store.getAgentContact(contact.contactId);
    expect(updatedContact?.status).toBe("trusted");
    expect(updatedContact?.capabilities).toEqual(["ping"]);
    const message = deps.store.findAgentMessage("peer-confirm", "outbound", result.nonce);
    const events = deps.store.listAgentConnectionEvents(10, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_confirm",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventStatus).toBe("applied");
    expect(events[0]?.messageId).toBe(message?.id);
    expect(events[0]?.reason).toBe("confirmed");
  });

  it("sends connection_reject and returns contact to imported", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0x7777777777777777777777777777777777777777777777777777777777777777",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      legacyPeerId: "peer-reject",
      status: "pending_inbound",
      supportedProtocols: ["agent-comm/2"],
      capabilities: ["ping"],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_reject",
      endpointStatus: "active",
      source: "unit-test",
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 11),
    });
    const sendTransaction = vi.fn(async (_request: { data: string }) => "0xtx-reject");
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    const result = await sendCommConnectionReject(deps, {
      masterPassword: "pass123",
      contactId: contact.contactId,
      reason: "policy",
      note: "not now",
    });

    const requestCall = sendTransaction.mock.calls[0];
    expect(requestCall).toBeDefined();
    const request = requestCall?.[0] as unknown as { data: string };
    const { command: plaintext } = decryptOutboundCommand(request.data, peerWallet.privateKey);

    expect(result.txHash).toBe("0xtx-reject");
    expect(result.commandType).toBe("connection_reject");
    expect(result.contactStatus).toBe("imported");
    expect(result.connectionEventType).toBe("connection_reject");
    expect(result.connectionEventStatus).toBe("applied");
    expect(plaintext).toEqual({
      type: "connection_reject",
      schemaVersion: 2,
      payload: {
        reason: "policy",
        note: "not now",
      },
    });

    const updatedContact = deps.store.getAgentContact(contact.contactId);
    expect(updatedContact?.status).toBe("imported");
    const events = deps.store.listAgentConnectionEvents(10, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_reject",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventStatus).toBe("applied");
    expect(events[0]?.reason).toBe("policy");
  });

  it("attaches an inline card bundle on connection_confirm when requested", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const localPrivateKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const peerWallet = restoreShadowWallet(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: localPrivateKey,
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      legacyPeerId: "peer-confirm-inline",
      status: "trusted",
      supportedProtocols: ["agent-comm/2"],
      capabilities: ["ping"],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_confirm_inline",
      endpointStatus: "active",
      source: "unit-test",
    });

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getTransactionCount: vi.fn(async () => 29),
    });
    const sendTransaction = vi.fn(async (_request: { data: string }) => "0xtx-confirm-inline");
    createWalletClientMock.mockReturnValue({
      sendTransaction,
    });

    await sendCommConnectionConfirm(deps, {
      masterPassword: "pass123",
      contactId: contact.contactId,
      note: "confirmed with inline card",
      attachInlineCard: true,
    });

    const request = sendTransaction.mock.calls[0]?.[0] as { data: string };
    const { command: plaintext, body } = decryptOutboundCommand(request.data, peerWallet.privateKey);
    expect(plaintext.type).toBe("connection_confirm");
    expect(plaintext.payload).toEqual(
      expect.objectContaining({
        note: "confirmed with inline card",
      }),
    );
    expect(body?.attachments).toEqual(
      expect.objectContaining({
        inlineCard: expect.objectContaining({
          bundleVersion: 1,
          contactCard: expect.objectContaining({
            identityWallet: getCommIdentity(deps, { masterPassword: "pass123" }).identityWallet,
          }),
        }),
      }),
    );

    const outboundConfirm = deps.store.listAgentConnectionEvents(10, {
      contactId: contact.contactId,
      direction: "outbound",
      eventType: "connection_confirm",
    })[0];
    expect(outboundConfirm?.metadata).toEqual(
      expect.objectContaining({
        inlineCardContactCardDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        inlineCardTransportBindingDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    );
  });

  it("requires pending_inbound status before sending connection_accept", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const peerWallet = restoreShadowWallet(
      "0x8888888888888888888888888888888888888888888888888888888888888888",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      status: "imported",
      supportedProtocols: ["agent-comm/2"],
      capabilities: [],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_fail",
      endpointStatus: "active",
      source: "unit-test",
    });

    await expect(
      sendCommConnectionAccept(deps, {
        masterPassword: "pass123",
        contactId: contact.contactId,
      }),
    ).rejects.toThrow("expected status pending_inbound");
  });

  it("requires trusted or pending_outbound status before sending connection_confirm", async () => {
    const deps = createDeps("alphaos-comm-entry-");
    const peerWallet = restoreShadowWallet(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    initCommWallet(deps, {
      masterPassword: "pass123",
      privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });
    const contact = deps.store.upsertAgentContact({
      identityWallet: peerWallet.getAddress(),
      status: "pending_inbound",
      supportedProtocols: ["agent-comm/2"],
      capabilities: [],
    });
    deps.store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: peerWallet.getAddress(),
      pubkey: peerWallet.getPublicKey(),
      keyId: "rk_peer_confirm_fail",
      endpointStatus: "active",
      source: "unit-test",
    });

    await expect(
      sendCommConnectionConfirm(deps, {
        masterPassword: "pass123",
        contactId: contact.contactId,
      }),
    ).rejects.toThrow("expected status trusted or pending_outbound");
  });
});
