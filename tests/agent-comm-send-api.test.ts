import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/skills/alphaos/runtime/agent-comm/entrypoints", async () => {
  const actual = await vi.importActual<typeof import("../src/skills/alphaos/runtime/agent-comm/entrypoints")>(
    "../src/skills/alphaos/runtime/agent-comm/entrypoints",
  );
  return {
    ...actual,
    exportIdentityArtifactBundle: vi.fn(),
    importRevocationNotice: vi.fn(),
    importIdentityArtifactBundle: vi.fn(),
    revokeIdentityArtifact: vi.fn(),
    rotateCommWallet: vi.fn(),
    sendCommConnectionAccept: vi.fn(),
    sendCommConnectionInvite: vi.fn(),
    sendCommConnectionReject: vi.fn(),
    sendCommPing: vi.fn(),
    sendCommProbeExecution: vi.fn(),
    sendCommProbeOnchainOs: vi.fn(),
    sendCommRequestModeChange: vi.fn(),
    sendCommStartDiscovery: vi.fn(),
  };
});

import { createServer } from "../src/skills/alphaos/api/server";
import {
  exportIdentityArtifactBundle,
  importRevocationNotice,
  importIdentityArtifactBundle,
  revokeIdentityArtifact,
  rotateCommWallet,
  sendCommConnectionAccept,
  sendCommConnectionInvite,
  sendCommConnectionReject,
  sendCommPing,
  sendCommProbeExecution,
  sendCommProbeOnchainOs,
  sendCommRequestModeChange,
  sendCommStartDiscovery,
  type AgentCommEntrypointDependencies,
} from "../src/skills/alphaos/runtime/agent-comm/entrypoints";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import { VaultService } from "../src/skills/alphaos/runtime/vault";
import type { EngineModeResponse, SkillManifest } from "../src/skills/alphaos/types";

const TEST_API_SECRET = "unit-test-api-secret";
const stores: StateStore[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

type ApiResponse = {
  status: number;
  body: unknown;
};

async function invokeApi(
  app: ReturnType<typeof createServer>,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<ApiResponse> {
  const socket = new PassThrough();
  (socket as { remoteAddress?: string }).remoteAddress = "127.0.0.1";
  const socketDestroy = socket.destroy.bind(socket);
  (socket as { destroy: () => PassThrough }).destroy = () => socket;

  let raw = "";
  let req: http.IncomingMessage;
  const write = socket.write.bind(socket);
  (socket as { write: (...args: unknown[]) => boolean }).write = (...args: unknown[]) => {
    const chunk = args[0];
    if (Buffer.isBuffer(chunk)) {
      raw += chunk.toString("utf8");
    } else if (typeof chunk === "string") {
      raw += chunk;
    }
    return write(...(args as Parameters<typeof write>));
  };

  req = new http.IncomingMessage(socket as never);
  req.method = method;
  req.url = url;
  req.headers = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    req.headers[key.toLowerCase()] = value;
  }

  const payloadText = payload ? JSON.stringify(payload) : undefined;
  if (payloadText) {
    req.push(payloadText);
    req.headers["content-type"] = "application/json";
    req.headers["content-length"] = String(Buffer.byteLength(payloadText));
  }
  req.push(null);

  const res = new http.ServerResponse(req);
  res.assignSocket(socket as never);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`request timeout ${method} ${url}`)), 1500);
    const clear = () => clearTimeout(timeout);

    req.on("error", (error) => {
      clear();
      reject(error);
    });
    res.on("error", (error) => {
      clear();
      reject(error);
    });
    res.on("finish", () => {
      clear();
      resolve();
    });

    (
      app as unknown as {
        handle: (r: http.IncomingMessage, s: http.ServerResponse, n: (e?: unknown) => void) => void;
      }
    ).handle(req, res, (error?: unknown) => {
      if (error) {
        clear();
        reject(error);
      }
    });
  });

  const splitAt = raw.indexOf("\r\n\r\n");
  const text = splitAt >= 0 ? raw.slice(splitAt + 4) : "";
  socketDestroy();
  return {
    status: res.statusCode,
    body: JSON.parse(text),
  };
}

function buildApp() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-agent-comm-send-api-"));
  tempDirs.push(tempDir);
  const store = new StateStore(tempDir);
  stores.push(store);
  const vault = new VaultService(store);
  const config = {
    commWalletAlias: "agent-comm",
    commChainId: 196,
  } as AgentCommEntrypointDependencies["config"];

  const engine = {
    getCurrentMode: () => "paper",
    requestMode: (mode: "paper" | "live"): EngineModeResponse => ({
      ok: true,
      requestedMode: mode,
      currentMode: mode,
      reasons: [],
    }),
  };

  const manifest: SkillManifest = {
    id: "alphaos",
    version: "0.2.0",
    description: "test",
    strategyIds: ["dex-arbitrage"],
  };

  const app = createServer(engine as never, store, manifest, {
    apiSecret: TEST_API_SECRET,
    demoPublic: false,
    agentCommSendDeps: {
      config,
      vault,
    },
  });

  return {
    app,
    store,
    vault,
    config,
  };
}

describe("agent-comm HTTP API", () => {
  it("keeps send routes behind bearer auth", async () => {
    const { app } = buildApp();

    const response = await invokeApi(app, "POST", "/api/v1/agent-comm/send/ping", {
      peerId: "peer-b",
    });

    expect(response.status).toBe(401);
    expect(vi.mocked(sendCommPing)).not.toHaveBeenCalled();
  });

  it("validates probe_onchainos and request_mode_change send payloads", async () => {
    const { app } = buildApp();

    const invalidProbeResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/probe-onchainos",
      {
        peerId: "peer-b",
        notionalUsd: 0,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(invalidProbeResponse.status).toBe(400);
    expect(invalidProbeResponse.body).toEqual({
      error: "notionalUsd must be a positive number",
    });
    expect(vi.mocked(sendCommProbeOnchainOs)).not.toHaveBeenCalled();

    const invalidModeResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/request-mode-change",
      {
        peerId: "peer-b",
        requestedMode: "turbo",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(invalidModeResponse.status).toBe(400);
    expect(invalidModeResponse.body).toEqual({
      error: "requestedMode must be paper or live",
    });
    expect(vi.mocked(sendCommRequestModeChange)).not.toHaveBeenCalled();
  });

  it("lists contacts and pending invite records from the store", async () => {
    const { app, store } = buildApp();
    const contact = store.upsertAgentContact({
      identityWallet: "0x1111111111111111111111111111111111111111",
      legacyPeerId: "peer-contact",
      status: "imported",
      supportedProtocols: ["agent-comm/2"],
      capabilities: ["ping"],
    });
    store.upsertAgentSignedArtifact({
      artifactType: "ContactCard",
      digest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      signer: contact.identityWallet,
      identityWallet: contact.identityWallet,
      chainId: 196,
      issuedAt: 1741305600,
      expiresAt: 1772841600,
      payload: {
        displayName: "Contact Agent",
      },
      proof: {
        type: "eip712",
      },
      verificationStatus: "verified",
      source: "unit-test",
    });
    store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 196,
      receiveAddress: "0x2222222222222222222222222222222222222222",
      pubkey: "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      keyId: "rk_contact",
      bindingDigest: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      endpointStatus: "active",
      source: "unit-test",
    });
    store.upsertAgentConnectionEvent({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      direction: "inbound",
      eventType: "connection_invite",
      eventStatus: "pending",
      reason: "invite",
      metadata: {
        requestedProfile: "research-collab",
        requestedCapabilities: ["ping", "start_discovery"],
        note: "invite",
        senderPeerId: "peer-contact",
      },
      occurredAt: "2026-03-06T00:00:00.000Z",
    });
    store.upsertAgentConnectionEvent({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      direction: "outbound",
      eventType: "connection_accept",
      eventStatus: "applied",
      occurredAt: "2026-03-06T00:01:00.000Z",
    });

    const contactsResponse = await invokeApi(
      app,
      "GET",
      "/api/v1/agent-comm/contacts?status=imported",
      undefined,
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(contactsResponse.status).toBe(200);
    expect(contactsResponse.body).toEqual({
      items: [
        expect.objectContaining({
          contactId: contact.contactId,
          identityWallet: contact.identityWallet,
          status: "imported",
          signerFingerprint: "0xaaaaaaaa...aaaaaaaa",
          proofSigner: contact.identityWallet,
          currentTransportAddress: "0x2222222222222222222222222222222222222222",
          pendingInvites: {
            inbound: 1,
            outbound: 0,
            total: 1,
          },
          latestPendingInvite: {
            direction: "inbound",
            occurredAt: "2026-03-06T00:00:00.000Z",
            requestedProfile: "research-collab",
            requestedCapabilities: ["ping", "start_discovery"],
            note: "invite",
          },
        }),
      ],
    });

    const invitesResponse = await invokeApi(
      app,
      "GET",
      "/api/v1/agent-comm/invites?direction=inbound&status=pending",
      undefined,
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(invitesResponse.status).toBe(200);
    expect(invitesResponse.body).toEqual({
      items: [
        expect.objectContaining({
          contactId: contact.contactId,
          direction: "inbound",
          eventType: "connection_invite",
          eventStatus: "pending",
          contactStatus: "imported",
          signerFingerprint: "0xaaaaaaaa...aaaaaaaa",
          proofSigner: contact.identityWallet,
          currentTransportAddress: "0x2222222222222222222222222222222222222222",
          requestedProfile: "research-collab",
          requestedCapabilities: ["ping", "start_discovery"],
          note: "invite",
          senderPeerId: "peer-contact",
        }),
      ],
    });
  });

  it("validates the new contact and connection route inputs", async () => {
    const { app } = buildApp();

    const contactsResponse = await invokeApi(
      app,
      "GET",
      "/api/v1/agent-comm/contacts?status=not-a-status",
      undefined,
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );
    expect(contactsResponse.status).toBe(400);
    expect(contactsResponse.body).toEqual({
      error: "invalid contact status",
    });

    const inviteResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/connections/invite",
      {
        requestedProfile: "research-collab",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(inviteResponse.status).toBe(400);
    expect(inviteResponse.body).toEqual({
      error: "contactId is required",
    });
    expect(vi.mocked(sendCommConnectionInvite)).not.toHaveBeenCalled();

    const invalidInlineFlagResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/connections/invite",
      {
        contactId: "ct_bad_flag",
        attachInlineCard: "maybe",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );
    expect(invalidInlineFlagResponse.status).toBe(400);
    expect(invalidInlineFlagResponse.body).toEqual({
      error: "attachInlineCard must be a boolean",
    });
    expect(vi.mocked(sendCommConnectionInvite)).not.toHaveBeenCalled();
  });

  it("validates revocation route payloads", async () => {
    const { app } = buildApp();

    const missingDigest = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/artifacts/revoke",
      {
        artifactType: "ContactCard",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );
    expect(missingDigest.status).toBe(400);
    expect(missingDigest.body).toEqual({
      error: "artifactDigest is required",
    });

    const badType = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/artifacts/revoke",
      {
        artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        artifactType: "Unknown",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );
    expect(badType.status).toBe(400);
    expect(badType.body).toEqual({
      error: "artifactType must be ContactCard or TransportBinding",
    });

    const missingNotice = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/artifacts/revocations/import",
      {
        source: "api-test",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );
    expect(missingNotice.status).toBe(400);
    expect(missingNotice.body).toEqual({
      error: "notice is required",
    });

    expect(vi.mocked(revokeIdentityArtifact)).not.toHaveBeenCalled();
    expect(vi.mocked(importRevocationNotice)).not.toHaveBeenCalled();
  });

  it("forwards card and connection routes to the matching entrypoints", async () => {
    const { app, store, vault, config } = buildApp();

    vi.mocked(importIdentityArtifactBundle).mockResolvedValue({
      ok: true,
      reasons: [],
      failureCodes: [],
      contactId: "ct_imported",
      identityWallet: "0x9999999999999999999999999999999999999999",
      status: "imported",
      activeTransportAddress: "0x8888888888888888888888888888888888888888",
    } as Awaited<ReturnType<typeof importIdentityArtifactBundle>>);
    vi.mocked(exportIdentityArtifactBundle).mockResolvedValue({
      contactCardDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shareUrl: "agentcomm://card?v=1&bundle=ZXhhbXBsZQ",
      bundle: {
        contactCard: {
          displayName: "Exported Agent",
        },
      },
    } as Awaited<ReturnType<typeof exportIdentityArtifactBundle>>);
    vi.mocked(revokeIdentityArtifact).mockResolvedValue({
      ok: true,
      reasons: [],
      failureCodes: [],
      artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      artifactType: "ContactCard",
      artifactStatus: "revoked",
      noticeDigest: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      noticeFingerprint: "0xbbbbbbbb...bbbbbbbb",
      affectedEndpointIds: [],
      affectedContactIds: ["ct_route"],
      identityWallet: "0x1111111111111111111111111111111111111111",
      notice: {
        noticeVersion: 1,
      },
    } as unknown as Awaited<ReturnType<typeof revokeIdentityArtifact>>);
    vi.mocked(importRevocationNotice).mockResolvedValue({
      ok: true,
      reasons: [],
      failureCodes: [],
      artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      artifactType: "ContactCard",
      artifactStatus: "revoked",
      noticeDigest: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      noticeFingerprint: "0xcccccccc...cccccccc",
      affectedEndpointIds: [],
      affectedContactIds: ["ct_route"],
    } as Awaited<ReturnType<typeof importRevocationNotice>>);
    vi.mocked(sendCommConnectionInvite).mockResolvedValue({
      txHash: "0xinvite",
      contactId: "ct_route",
      commandType: "connection_invite",
      connectionEventType: "connection_invite",
      connectionEventStatus: "pending",
    } as Awaited<ReturnType<typeof sendCommConnectionInvite>>);
    vi.mocked(sendCommConnectionAccept).mockResolvedValue({
      txHash: "0xaccept",
      contactId: "ct_route",
      commandType: "connection_accept",
      connectionEventType: "connection_accept",
      connectionEventStatus: "applied",
    } as Awaited<ReturnType<typeof sendCommConnectionAccept>>);
    vi.mocked(sendCommConnectionReject).mockResolvedValue({
      txHash: "0xreject",
      contactId: "ct_route",
      commandType: "connection_reject",
      connectionEventType: "connection_reject",
      connectionEventStatus: "applied",
    } as Awaited<ReturnType<typeof sendCommConnectionReject>>);

    const importResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/cards/import",
      {
        bundle: {
          contactCard: {
            displayName: "Imported Agent",
          },
        },
        source: "api-test",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(importResponse.status).toBe(200);
    expect(importResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        contactId: "ct_imported",
      }),
    );
    expect(vi.mocked(importIdentityArtifactBundle)).toHaveBeenCalledWith(
      {
        config,
        store,
      },
      {
        bundle: {
          contactCard: {
            displayName: "Imported Agent",
          },
        },
        source: "api-test",
      },
    );

    const exportResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/cards/export",
      {
        displayName: "Exported Agent",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
        expiresInDays: 30,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body).toEqual(
      expect.objectContaining({
        contactCardDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(vi.mocked(exportIdentityArtifactBundle)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        displayName: "Exported Agent",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
        expiresInDays: 30,
      },
    );

    const revokeResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/artifacts/revoke",
      {
        artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        artifactType: "ContactCard",
        reason: "rotated",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        artifactStatus: "revoked",
      }),
    );
    expect(vi.mocked(revokeIdentityArtifact)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        artifactDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        artifactType: "ContactCard",
        reason: "rotated",
      },
    );

    const importRevocationResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/artifacts/revocations/import",
      {
        notice: {
          noticeVersion: 1,
        },
        source: "api-test",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );
    expect(importRevocationResponse.status).toBe(200);
    expect(importRevocationResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        artifactStatus: "revoked",
      }),
    );
    expect(vi.mocked(importRevocationNotice)).toHaveBeenCalledWith(
      {
        config,
        store,
      },
      {
        notice: {
          noticeVersion: 1,
        },
        source: "api-test",
      },
    );

    const inviteResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/connections/invite",
      {
        contactId: "ct_route",
        senderPeerId: "agent-a",
        requestedProfile: "research-collab",
        requestedCapabilities: ["ping", "start_discovery"],
        note: "invite",
        attachInlineCard: true,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(inviteResponse.status).toBe(200);
    expect(inviteResponse.body).toEqual(
      expect.objectContaining({
        txHash: "0xinvite",
        contactId: "ct_route",
      }),
    );
    expect(vi.mocked(sendCommConnectionInvite)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        contactId: "ct_route",
        senderPeerId: "agent-a",
        requestedProfile: "research-collab",
        requestedCapabilities: ["ping", "start_discovery"],
        note: "invite",
        attachInlineCard: true,
      },
    );

    const acceptResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/connections/ct_route/accept",
      {
        senderPeerId: "agent-a",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
        note: "approved",
        attachInlineCard: true,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body).toEqual(
      expect.objectContaining({
        txHash: "0xaccept",
        contactId: "ct_route",
      }),
    );
    expect(vi.mocked(sendCommConnectionAccept)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        contactId: "ct_route",
        senderPeerId: "agent-a",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
        note: "approved",
        attachInlineCard: true,
      },
    );

    const rejectResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/connections/ct_route/reject",
      {
        senderPeerId: "agent-a",
        reason: "policy",
        note: "not now",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body).toEqual(
      expect.objectContaining({
        txHash: "0xreject",
        contactId: "ct_route",
      }),
    );
    expect(vi.mocked(sendCommConnectionReject)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        contactId: "ct_route",
        senderPeerId: "agent-a",
        reason: "policy",
        note: "not now",
      },
    );
  });

  it("rotates the active comm wallet through the HTTP route", async () => {
    const { app, store, vault, config } = buildApp();

    vi.mocked(rotateCommWallet).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      identityWallet: "0x1111111111111111111111111111111111111111",
      transportAddress: "0x2222222222222222222222222222222222222222",
      localIdentityMode: "standard",
      supportedProtocols: ["agent-comm/2", "agent-comm/1"],
      previousTransportAddress: "0x9999999999999999999999999999999999999999",
      archivedWalletAlias: "agent-comm-acw-prev-123",
      graceExpiresAt: "2026-03-09T00:00:00.000Z",
      contactCardDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      contactCardFingerprint: "0xaaaaaaaa...aaaaaaaa",
      transportBindingDigest: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      transportBindingFingerprint: "0xbbbbbbbb...bbbbbbbb",
      shareUrl: "agentcomm://card?v=1&bundle=ZXhhbXBsZQ",
    });

    const response = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/wallets/rotate",
      {
        gracePeriodHours: 48,
        displayName: "Rotated Operator",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(response.status).toBe(200);
    expect((response.body as { archivedWalletAlias: string }).archivedWalletAlias).toBe(
      "agent-comm-acw-prev-123",
    );
    expect(vi.mocked(rotateCommWallet)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        gracePeriodHours: 48,
        displayName: "Rotated Operator",
        capabilityProfile: "research-collab",
        capabilities: ["ping", "start_discovery"],
      },
    );
  });

  it("forwards Agent-Comm send routes to the matching entrypoints", async () => {
    const { app, store, vault, config } = buildApp();

    vi.mocked(sendCommPing).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      identityWallet: "0x1111111111111111111111111111111111111111",
      transportAddress: "0x1111111111111111111111111111111111111111",
      localIdentityMode: "temporary_dual_use",
      supportedProtocols: ["agent-comm/2", "agent-comm/1"],
      txHash: "0xping",
      nonce: "ping-nonce",
      sentAt: "2026-03-06T00:00:00.000Z",
      peerId: "peer-b",
      recipient: "0x9999999999999999999999999999999999999999",
      senderPeerId: "agent-a",
      commandType: "ping",
      envelopeVersion: 1,
      legacyFallbackUsed: true,
    });
    vi.mocked(sendCommProbeExecution).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      identityWallet: "0x1111111111111111111111111111111111111111",
      transportAddress: "0x1111111111111111111111111111111111111111",
      localIdentityMode: "temporary_dual_use",
      supportedProtocols: ["agent-comm/2", "agent-comm/1"],
      txHash: "0xprobe-execution",
      nonce: "probe-execution-nonce",
      sentAt: "2026-03-06T00:00:00.500Z",
      peerId: "peer-b",
      recipient: "0x9999999999999999999999999999999999999999",
      senderPeerId: "agent-a",
      commandType: "probe_execution",
      envelopeVersion: 2,
      legacyFallbackUsed: false,
    });
    vi.mocked(sendCommProbeOnchainOs).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      identityWallet: "0x1111111111111111111111111111111111111111",
      transportAddress: "0x1111111111111111111111111111111111111111",
      localIdentityMode: "temporary_dual_use",
      supportedProtocols: ["agent-comm/2", "agent-comm/1"],
      txHash: "0xprobe",
      nonce: "probe-nonce",
      sentAt: "2026-03-06T00:00:00.500Z",
      peerId: "peer-b",
      recipient: "0x9999999999999999999999999999999999999999",
      senderPeerId: "agent-a",
      commandType: "probe_onchainos",
      envelopeVersion: 1,
      legacyFallbackUsed: true,
    });
    vi.mocked(sendCommStartDiscovery).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      identityWallet: "0x1111111111111111111111111111111111111111",
      transportAddress: "0x1111111111111111111111111111111111111111",
      localIdentityMode: "temporary_dual_use",
      supportedProtocols: ["agent-comm/2", "agent-comm/1"],
      txHash: "0xdiscovery",
      nonce: "discovery-nonce",
      sentAt: "2026-03-06T00:00:01.000Z",
      peerId: "peer-b",
      recipient: "0x9999999999999999999999999999999999999999",
      senderPeerId: "agent-a",
      commandType: "start_discovery",
      envelopeVersion: 1,
      legacyFallbackUsed: true,
    });
    vi.mocked(sendCommRequestModeChange).mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
      pubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chainId: 196,
      walletAlias: "agent-comm",
      defaultSenderPeerId: "agent-comm",
      identityWallet: "0x1111111111111111111111111111111111111111",
      transportAddress: "0x1111111111111111111111111111111111111111",
      localIdentityMode: "temporary_dual_use",
      supportedProtocols: ["agent-comm/2", "agent-comm/1"],
      txHash: "0xmode",
      nonce: "mode-nonce",
      sentAt: "2026-03-06T00:00:02.000Z",
      peerId: "peer-b",
      recipient: "0x9999999999999999999999999999999999999999",
      senderPeerId: "agent-a",
      commandType: "request_mode_change",
      envelopeVersion: 1,
      legacyFallbackUsed: true,
    });

    const pingResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/ping",
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        echo: "hello",
        note: "smoke",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(pingResponse.status).toBe(200);
    expect((pingResponse.body as { txHash: string }).txHash).toBe("0xping");
    expect(vi.mocked(sendCommPing)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCommPing)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        echo: "hello",
        note: "smoke",
      },
    );

    const probeResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/probe-execution",
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        pair: "eth/usdc",
        chainIndex: "196",
        notionalUsd: 42.5,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(probeResponse.status).toBe(200);
    expect((probeResponse.body as { txHash: string }).txHash).toBe("0xprobe-execution");
    expect(vi.mocked(sendCommProbeExecution)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCommProbeExecution)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        pair: "ETH/USDC",
        chainIndex: "196",
        notionalUsd: 42.5,
      },
    );

    const legacyProbeResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/probe-onchainos",
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        pair: "eth/usdc",
        chainIndex: "196",
        notionalUsd: 42.5,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(legacyProbeResponse.status).toBe(200);
    expect((legacyProbeResponse.body as { txHash: string }).txHash).toBe("0xprobe");
    expect(vi.mocked(sendCommProbeOnchainOs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCommProbeOnchainOs)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        pair: "ETH/USDC",
        chainIndex: "196",
        notionalUsd: 42.5,
      },
    );

    const discoveryResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/start-discovery",
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        strategyId: "spread-threshold",
        pairs: ["eth/usdc", "BTC/USDC"],
        durationMinutes: 30,
        sampleIntervalSec: 5,
        topN: 10,
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(discoveryResponse.status).toBe(200);
    expect((discoveryResponse.body as { txHash: string }).txHash).toBe("0xdiscovery");
    expect(vi.mocked(sendCommStartDiscovery)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCommStartDiscovery)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        strategyId: "spread-threshold",
        pairs: ["ETH/USDC", "BTC/USDC"],
        durationMinutes: 30,
        sampleIntervalSec: 5,
        topN: 10,
      },
    );

    const modeResponse = await invokeApi(
      app,
      "POST",
      "/api/v1/agent-comm/send/request-mode-change",
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        requestedMode: "live",
        reason: "operator requested",
      },
      {
        authorization: `Bearer ${TEST_API_SECRET}`,
      },
    );

    expect(modeResponse.status).toBe(200);
    expect((modeResponse.body as { txHash: string }).txHash).toBe("0xmode");
    expect(vi.mocked(sendCommRequestModeChange)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCommRequestModeChange)).toHaveBeenCalledWith(
      {
        config,
        store,
        vault,
      },
      {
        peerId: "peer-b",
        senderPeerId: "agent-a",
        requestedMode: "live",
        reason: "operator requested",
      },
    );
  });
});
