import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() => vi.fn());
const listAgentContactsMock = vi.hoisted(() => vi.fn());
const listAgentSignedArtifactsMock = vi.hoisted(() => vi.fn());
const listAgentTransportEndpointsMock = vi.hoisted(() => vi.fn());
const listAgentConnectionEventsMock = vi.hoisted(() => vi.fn());
const getAgentContactByLegacyPeerIdMock = vi.hoisted(() => vi.fn());
const storeCloseMock = vi.hoisted(() => vi.fn());
const stateStoreCtorMock = vi.hoisted(() =>
  vi.fn(function MockStateStore(
    this: {
      listAgentContacts: typeof listAgentContactsMock;
      listAgentSignedArtifacts: typeof listAgentSignedArtifactsMock;
      listAgentTransportEndpoints: typeof listAgentTransportEndpointsMock;
      listAgentConnectionEvents: typeof listAgentConnectionEventsMock;
      getAgentContactByLegacyPeerId: typeof getAgentContactByLegacyPeerIdMock;
      close: typeof storeCloseMock;
    },
    _dataDir: string,
  ) {
    this.listAgentContacts = listAgentContactsMock;
    this.listAgentSignedArtifacts = listAgentSignedArtifactsMock;
    this.listAgentTransportEndpoints = listAgentTransportEndpointsMock;
    this.listAgentConnectionEvents = listAgentConnectionEventsMock;
    this.getAgentContactByLegacyPeerId = getAgentContactByLegacyPeerIdMock;
    this.close = storeCloseMock;
  }),
);
const vaultCtorMock = vi.hoisted(() => vi.fn(function MockVaultService(_store: unknown) {}));
const bootstrapAgentCommStateMock = vi.hoisted(() => vi.fn());
const importIdentityArtifactBundleFromJsonMock = vi.hoisted(() => vi.fn());
const registerTrustedPeerEntryMock = vi.hoisted(() => vi.fn());
const rotateCommWalletMock = vi.hoisted(() => vi.fn());
const sendCommConnectionInviteMock = vi.hoisted(() => vi.fn());
const sendCommConnectionAcceptMock = vi.hoisted(() => vi.fn());
const sendCommConnectionRejectMock = vi.hoisted(() => vi.fn());
const sendCommProbeExecutionMock = vi.hoisted(() => vi.fn());
const sendCommProbeOnchainOsMock = vi.hoisted(() => vi.fn());
const sendCommRequestModeChangeMock = vi.hoisted(() => vi.fn());
const revokeIdentityArtifactMock = vi.hoisted(() => vi.fn());
const importRevocationNoticeFromJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../src/skills/alphaos/runtime/config", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../src/skills/alphaos/runtime/logger", () => ({
  createLogger: createLoggerMock,
}));

vi.mock("../src/skills/alphaos/runtime/state-store", () => ({
  StateStore: stateStoreCtorMock,
}));

vi.mock("../src/skills/alphaos/runtime/vault", () => ({
  VaultService: vaultCtorMock,
}));

vi.mock("../src/skills/alphaos/runtime/agent-comm/entrypoints", () => ({
  bootstrapAgentCommState: bootstrapAgentCommStateMock,
  exportIdentityArtifactBundle: vi.fn(),
  getCommIdentity: vi.fn(),
  importIdentityArtifactBundleFromJson: importIdentityArtifactBundleFromJsonMock,
  importRevocationNoticeFromJson: importRevocationNoticeFromJsonMock,
  initCommWallet: vi.fn(),
  initTemporaryDemoWallet: vi.fn(),
  LEGACY_MANUAL_PEER_TRUST_WARNING:
    "legacy/manual v1 fallback record created; prefer card import plus invite/accept for new contacts",
  listLocalIdentityProfiles: vi.fn(),
  registerTrustedPeerEntry: registerTrustedPeerEntryMock,
  revokeIdentityArtifact: revokeIdentityArtifactMock,
  rotateCommWallet: rotateCommWalletMock,
  sendCommConnectionAccept: sendCommConnectionAcceptMock,
  sendCommConnectionInvite: sendCommConnectionInviteMock,
  sendCommConnectionReject: sendCommConnectionRejectMock,
  sendCommPing: vi.fn(),
  sendCommProbeExecution: sendCommProbeExecutionMock,
  sendCommProbeOnchainOs: sendCommProbeOnchainOsMock,
  sendCommRequestModeChange: sendCommRequestModeChangeMock,
  sendCommStartDiscovery: vi.fn(),
}));

import { run } from "../src/index";

const originalArgv = [...process.argv];

async function runCli(args: string[]): Promise<string> {
  const chunks: string[] = [];
  process.argv = ["node", "src/index.ts", ...args];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as never);

  try {
    await run();
  } finally {
    stdoutSpy.mockRestore();
  }

  return chunks.join("");
}

beforeEach(() => {
  loadConfigMock.mockReturnValue({
    dataDir: "/tmp/agent-comm-cli",
    logLevel: "info",
  });
  createLoggerMock.mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  listAgentContactsMock.mockReturnValue([]);
  listAgentSignedArtifactsMock.mockReturnValue([]);
  listAgentTransportEndpointsMock.mockReturnValue([]);
  listAgentConnectionEventsMock.mockReturnValue([]);
  getAgentContactByLegacyPeerIdMock.mockReturnValue(undefined);
  bootstrapAgentCommStateMock.mockReturnValue({
    legacyPeerBackfill: {
      processedPeers: 0,
      createdContacts: 0,
      updatedContacts: 0,
      createdTransportEndpoints: 0,
      updatedTransportEndpoints: 0,
    },
  });
  rotateCommWalletMock.mockResolvedValue({
    txHash: "0xtx-rotate",
    previousTransportAddress: "0xold",
    transportAddress: "0xnew",
  });
  sendCommConnectionInviteMock.mockResolvedValue({
    txHash: "0xtx-invite",
    contactId: "ct_invite",
  });
  sendCommConnectionAcceptMock.mockResolvedValue({
    txHash: "0xtx-accept",
    contactId: "ct_accept",
  });
  sendCommConnectionRejectMock.mockResolvedValue({
    txHash: "0xtx-reject",
    contactId: "ct_reject",
  });
  sendCommProbeExecutionMock.mockResolvedValue({
    txHash: "0xtx-probe-execution",
    peerId: "peer-probe",
    commandType: "probe_execution",
  });
  sendCommProbeOnchainOsMock.mockResolvedValue({
    txHash: "0xtx-probe",
    peerId: "peer-probe",
    commandType: "probe_onchainos",
  });
  sendCommRequestModeChangeMock.mockResolvedValue({
    txHash: "0xtx-mode",
    peerId: "peer-mode",
    commandType: "request_mode_change",
  });
  revokeIdentityArtifactMock.mockResolvedValue({
    ok: true,
    reasons: [],
    failureCodes: [],
    artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    artifactType: "ContactCard",
    artifactStatus: "revoked",
    noticeDigest: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    affectedEndpointIds: [],
    affectedContactIds: ["ct_import"],
  });
  importRevocationNoticeFromJsonMock.mockResolvedValue({
    ok: true,
    reasons: [],
    failureCodes: [],
    artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    artifactType: "ContactCard",
    artifactStatus: "revoked",
    noticeDigest: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    affectedEndpointIds: [],
    affectedContactIds: ["ct_import"],
  });
  importIdentityArtifactBundleFromJsonMock.mockResolvedValue({
    ok: true,
    reasons: [],
    failureCodes: [],
    contactId: "ct_import",
  });
  registerTrustedPeerEntryMock.mockReturnValue({
    peerId: "peer-b",
    walletAddress: "0x2222222222222222222222222222222222222222",
    pubkey: "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: "trusted",
    capabilities: ["ping", "start_discovery"],
  });
});

afterEach(() => {
  process.argv = [...originalArgv];
  vi.clearAllMocks();
});

describe("agent-comm CLI contact/connect commands", () => {
  it("shows contact/connect commands as available in help text", async () => {
    const output = await runCli(["agent-comm:help"]);

    expect(output).toContain("Available now:");
    expect(output).toContain("agent-comm:contacts:list");
    expect(output).toContain("agent-comm:connect:invite <contactRef>");
    expect(output).toContain("agent-comm:connect:accept <contactRef>");
    expect(output).toContain("--attach-inline-card");
    expect(output).toContain("agent-comm:connect:reject <contactRef>");
    expect(output).toContain("agent-comm:artifact:revoke <artifactDigest>");
    expect(output).toContain("agent-comm:artifact:import-revocation <file|raw-json>");
    expect(output).toContain("agent-comm:peer:trust    (legacy/manual v1 fallback)");
    expect(output).toContain("agent-comm:wallet:rotate");
    expect(output).toContain("agent-comm:send <ping|probe_execution|start_discovery|request_mode_change>");
    expect(output).toContain("Preferred flow: add contact via card import, then connect via invite/accept.");
    expect(output).toContain("Business send accepts a trusted peerId or contact:<contactId>.");
    expect(output).toContain("Legacy alias still supported: probe_onchainos → probe_execution.");
    expect(output).toContain("agent-comm:card:import <file|raw-json|share-url>");
    expect(output).not.toContain("reserved, not implemented in this phase");
  });

  it("imports a card bundle from a share-url payload", async () => {
    const inlineJson = JSON.stringify({ bundleVersion: 1 });
    const shareUrl = `agentcomm://card?v=1&bundle=${Buffer.from(inlineJson).toString("base64url")}`;

    const output = await runCli(["agent-comm:card:import", shareUrl]);

    expect(importIdentityArtifactBundleFromJsonMock).toHaveBeenCalledWith(
      {
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
      },
      inlineJson,
      {
        source: `share-url:${shareUrl}`,
      },
    );
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:card:import",
      inputSource: `share-url:${shareUrl}`,
      ok: true,
      reasons: [],
      failureCodes: [],
      contactId: "ct_import",
    });
  });

  it("forwards artifact revoke flags to the entrypoint", async () => {
    const output = await runCli([
      "agent-comm:artifact:revoke",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "--artifact-type",
      "ContactCard",
      "--reason",
      "rotated",
      "--revoked-at",
      "1741349900",
    ]);

    expect(revokeIdentityArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        artifactType: "ContactCard",
        reason: "rotated",
        revokedAt: 1741349900,
        replacementDigest: undefined,
        source: undefined,
      },
    );
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        action: "agent-comm:artifact:revoke",
        ok: true,
        artifactStatus: "revoked",
      }),
    );
  });

  it("imports a revocation notice from raw json", async () => {
    const raw = JSON.stringify({
      noticeVersion: 1,
      identityWallet: "0x1111111111111111111111111111111111111111",
    });
    const output = await runCli(["agent-comm:artifact:import-revocation", raw]);

    expect(importRevocationNoticeFromJsonMock).toHaveBeenCalledWith(
      {
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
      },
      raw,
      {
        source: "inline-json",
        expectedChainId: undefined,
        nowUnixSeconds: undefined,
      },
    );
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        action: "agent-comm:artifact:import-revocation",
        inputSource: "inline-json",
        ok: true,
        artifactStatus: "revoked",
      }),
    );
  });

  it("lists contacts through the CLI", async () => {
    listAgentContactsMock.mockReturnValue([
      {
        contactId: "ct_list",
        identityWallet: "0x1111111111111111111111111111111111111111",
        legacyPeerId: "peer-list",
        status: "imported",
        supportedProtocols: ["agent-comm/2"],
        capabilities: ["ping"],
      },
    ]);

    const output = await runCli(["agent-comm:contacts:list"]);

    expect(stateStoreCtorMock).toHaveBeenCalledWith("/tmp/agent-comm-cli");
    expect(storeCloseMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:contacts:list",
      contacts: [
        {
          contactId: "ct_list",
          identityWallet: "0x1111111111111111111111111111111111111111",
          legacyPeerId: "peer-list",
          status: "imported",
          supportedProtocols: ["agent-comm/2"],
          capabilities: ["ping"],
          pendingInvites: {
            inbound: 0,
            outbound: 0,
            total: 0,
          },
          legacyMarkers: [],
          legacyProtocolOnly: false,
          legacyManualPeerRecord: false,
        },
      ],
    });
  });

  it("forwards connect invite flags to the entrypoint", async () => {
    const output = await runCli([
      "agent-comm:connect:invite",
      "ct_invite",
      "--sender-peer-id",
      "peer-local",
      "--requested-profile",
      "research-collab",
      "--requested-capabilities",
      "ping,start_discovery",
      "--note",
      "invite note",
      "--attach-inline-card",
    ]);

    expect(sendCommConnectionInviteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        contactId: "ct_invite",
        senderPeerId: "peer-local",
        requestedProfile: "research-collab",
        requestedCapabilities: ["ping", "start_discovery"],
        note: "invite note",
        attachInlineCard: true,
      },
    );
    expect(storeCloseMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:connect:invite",
      txHash: "0xtx-invite",
      contactId: "ct_invite",
    });
  });

  it("forwards connect accept flags to the entrypoint", async () => {
    const output = await runCli([
      "agent-comm:connect:accept",
      "ct_accept",
      "--sender-peer-id",
      "peer-local",
      "--capability-profile",
      "research-collab",
      "--capabilities",
      "ping,start_discovery",
      "--note",
      "approved",
      "--attach-inline-card",
    ]);

    expect(sendCommConnectionAcceptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        contactId: "ct_accept",
        senderPeerId: "peer-local",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
        note: "approved",
        attachInlineCard: true,
      },
    );
    expect(storeCloseMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:connect:accept",
      txHash: "0xtx-accept",
      contactId: "ct_accept",
    });
  });

  it("forwards connect reject flags to the entrypoint", async () => {
    const output = await runCli([
      "agent-comm:connect:reject",
      "ct_reject",
      "--sender-peer-id",
      "peer-local",
      "--reason",
      "policy",
      "--note",
      "not now",
    ]);

    expect(sendCommConnectionRejectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        contactId: "ct_reject",
        senderPeerId: "peer-local",
        reason: "policy",
        note: "not now",
      },
    );
    expect(storeCloseMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:connect:reject",
      txHash: "0xtx-reject",
      contactId: "ct_reject",
    });
  });

  it("forwards probe_execution send flags to the entrypoint", async () => {
    const output = await runCli([
      "agent-comm:send",
      "probe_execution",
      "peer-probe",
      "--sender-peer-id",
      "peer-local",
      "--pair",
      "eth/usdc",
      "--chain-index",
      "196",
      "--notional-usd",
      "42.5",
    ]);

    expect(sendCommProbeExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        peerId: "peer-probe",
        senderPeerId: "peer-local",
        pair: "ETH/USDC",
        chainIndex: "196",
        notionalUsd: 42.5,
      },
    );
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:send",
      txHash: "0xtx-probe-execution",
      peerId: "peer-probe",
      commandType: "probe_execution",
    });
  });

  it("still supports the legacy probe_onchainos alias", async () => {
    const output = await runCli([
      "agent-comm:send",
      "probe_onchainos",
      "peer-probe",
      "--pair",
      "eth/usdc",
      "--chain-index",
      "196",
      "--notional-usd",
      "42.5",
    ]);

    expect(sendCommProbeOnchainOsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        peerId: "peer-probe",
        pair: "ETH/USDC",
        chainIndex: "196",
        notionalUsd: 42.5,
      },
    );
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:send",
      txHash: "0xtx-probe",
      peerId: "peer-probe",
      commandType: "probe_onchainos",
    });
  });

  it("forwards request_mode_change send flags to the entrypoint", async () => {
    const output = await runCli([
      "agent-comm:send",
      "request_mode_change",
      "peer-mode",
      "--sender-peer-id",
      "peer-local",
      "--requested-mode",
      "live",
      "--reason",
      "operator requested",
    ]);

    expect(sendCommRequestModeChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        peerId: "peer-mode",
        senderPeerId: "peer-local",
        requestedMode: "live",
        reason: "operator requested",
      },
    );
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:send",
      txHash: "0xtx-mode",
      peerId: "peer-mode",
      commandType: "request_mode_change",
    });
  });

  it("forwards wallet rotate flags to the entrypoint", async () => {
    rotateCommWalletMock.mockResolvedValue({
      transportAddress: "0x9999999999999999999999999999999999999999",
      previousTransportAddress: "0x1111111111111111111111111111111111111111",
      graceExpiresAt: "2026-03-09T00:00:00.000Z",
    });

    const output = await runCli([
      "agent-comm:wallet:rotate",
      "--grace-period-hours",
      "48",
      "--display-name",
      "Rotated",
      "--capability-profile",
      "research-collab",
      "--capabilities",
      "ping,start_discovery",
    ]);

    expect(rotateCommWalletMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          dataDir: "/tmp/agent-comm-cli",
        }),
        store: expect.any(Object),
        vault: expect.any(Object),
      }),
      {
        gracePeriodHours: 48,
        displayName: "Rotated",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
      },
    );
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:wallet:rotate",
      transportAddress: "0x9999999999999999999999999999999999999999",
      previousTransportAddress: "0x1111111111111111111111111111111111111111",
      graceExpiresAt: "2026-03-09T00:00:00.000Z",
    });
  });

  it("emits a soft-deprecation warning for legacy manual peer trust", async () => {
    const output = await runCli([
      "agent-comm:peer:trust",
      "peer-b",
      "0x2222222222222222222222222222222222222222",
      "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);

    expect(registerTrustedPeerEntryMock).toHaveBeenCalledWith(
      {
        store: expect.any(Object),
      },
      {
        peerId: "peer-b",
        walletAddress: "0x2222222222222222222222222222222222222222",
        pubkey: "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        name: undefined,
        capabilities: undefined,
        metadata: undefined,
      },
    );
    expect(JSON.parse(output)).toEqual({
      action: "agent-comm:peer:trust",
      peer: {
        peerId: "peer-b",
        walletAddress: "0x2222222222222222222222222222222222222222",
        pubkey: "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "trusted",
        capabilities: ["ping", "start_discovery"],
      },
      legacyManualRecord: true,
      legacyMarkers: ["manual_peer_record"],
      contactId: undefined,
      warnings: [
        "legacy/manual v1 fallback record created; prefer card import plus invite/accept for new contacts",
      ],
    });
  });
});
