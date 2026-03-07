import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";

function createStore(prefix: string): { dir: string; store: StateStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, store: new StateStore(dir) };
}

describe("StateStore P0 safety", () => {
  it("rolls back trade insert when pnl update fails inside transaction", () => {
    const { dir, store } = createStore("alphaos-state-");
    const db = (store as unknown as { alphaDb: Database.Database }).alphaDb;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS test_abort_pnl_insert
      BEFORE INSERT ON pnl_daily
      BEGIN
        SELECT RAISE(ABORT, 'forced pnl failure');
      END;
    `);

    store.insertOpportunity(
      {
        id: "opp-rollback",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: new Date().toISOString(),
      },
      1,
      1,
      "executed",
    );

    expect(() =>
      store.insertTrade(
        "opp-rollback",
        "paper",
        {
          success: true,
          txHash: "tx-rollback",
          status: "confirmed",
          grossUsd: 4,
          feeUsd: 1,
          netUsd: 3,
        },
        new Date().toISOString(),
      ),
    ).toThrow(/forced pnl failure/);

    expect((store.listTrades(10) as unknown[]).length).toBe(0);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("computes current balance from baseline plus cumulative pnl", () => {
    const { dir, store } = createStore("alphaos-state-");
    const now = new Date().toISOString();
    store.ensureBalanceBaseline("paper", 1000);

    store.insertOpportunity(
      {
        id: "opp-bal-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
      },
      1,
      1,
      "executed",
    );
    store.insertTrade(
      "opp-bal-1",
      "paper",
      {
        success: true,
        txHash: "tx-bal-1",
        status: "confirmed",
        grossUsd: 12,
        feeUsd: 2,
        netUsd: 10,
      },
      now,
    );

    store.insertOpportunity(
      {
        id: "opp-bal-2",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 100.5,
        grossEdgeBps: 50,
        detectedAt: now,
      },
      1,
      -1,
      "failed",
    );
    store.insertTrade(
      "opp-bal-2",
      "paper",
      {
        success: false,
        txHash: "tx-bal-2",
        status: "failed",
        grossUsd: 0,
        feeUsd: 5,
        netUsd: -5,
      },
      now,
    );

    expect(store.getCurrentBalance("paper")).toBe(1005);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates execution quality stats for risk gate inputs", () => {
    const { dir, store } = createStore("alphaos-state-");
    const now = new Date().toISOString();

    store.insertOpportunity(
      {
        id: "opp-quality-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
      },
      1,
      1,
      "rejected",
    );
    store.insertOpportunity(
      {
        id: "opp-quality-2",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
      },
      1,
      1,
      "executed",
    );

    store.insertTrade(
      "opp-quality-2",
      "live",
      {
        success: false,
        txHash: "tx-quality-1",
        status: "failed",
        grossUsd: 0,
        feeUsd: 1,
        netUsd: -1,
        errorType: "permission_denied",
        latencyMs: 6000,
        slippageDeviationBps: 90,
      },
      now,
    );
    store.insertAlert("warn", "live_permission_degraded", "permission denied");

    const stats = store.getExecutionQualityStats(24);
    expect(stats.permissionFailures).toBe(2);
    expect(stats.rejectRate).toBe(0.5);
    expect(stats.avgLatencyMs).toBe(6000);
    expect(stats.avgSlippageDeviationBps).toBe(90);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates market state stats from opportunity metadata", () => {
    const { dir, store } = createStore("alphaos-state-");
    const now = new Date().toISOString();

    store.insertOpportunity(
      {
        id: "opp-market-1",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
        metadata: { volatility: 0.1, liquidityUsd: 120_000, gasBuyUsd: 1, gasSellUsd: 2 },
      },
      1,
      1,
      "detected",
    );
    store.insertOpportunity(
      {
        id: "opp-market-2",
        strategyId: "dex-arbitrage",
        pair: "ETH/USDC",
        buyDex: "a",
        sellDex: "b",
        buyPrice: 100,
        sellPrice: 101,
        grossEdgeBps: 100,
        detectedAt: now,
        metadata: { volatility: 0.3, liquidityUsd: 80_000, gasBuyUsd: 3, gasSellUsd: 5 },
      },
      1,
      1,
      "detected",
    );

    const stats = store.getMarketStateStats(24);
    expect(stats.samples).toBe(2);
    expect(stats.volatility24h).toBeCloseTo(0.2, 6);
    expect(stats.gasP90Usd24h).toBeCloseTo(4.4, 6);
    expect(stats.liquidityMedianUsd24h).toBeCloseTo(100_000, 6);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records stale quote count and average quote latency", () => {
    const { dir, store } = createStore("alphaos-state-");
    store.recordQuoteQuality({ stale: false, latencyMs: 100 });
    store.recordQuoteQuality({ stale: true, latencyMs: 400 });
    store.recordQuoteQuality({ stale: true, latencyMs: null });

    const metrics = store.getTodayMetrics();
    expect(metrics.staleQuotes).toBe(2);
    expect(metrics.avgQuoteLatencyMs).toBe(250);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists phase 2 agent peer, message, and cursor CRUD with message nonce dedupe", () => {
    const { dir, store } = createStore("alphaos-state-");

    const peer = store.upsertAgentPeer({
      peerId: "peer-1",
      walletAddress: "0xpeer1",
      pubkey: "pubkey-1",
      name: "Peer One",
      status: "trusted",
      capabilities: ["ping", "start_discovery"],
      metadata: { source: "test" },
    });
    expect(store.getAgentPeer(peer.peerId)?.name).toBe("Peer One");
    expect(store.getAgentPeerByWalletAddress(peer.walletAddress)?.peerId).toBe(peer.peerId);
    expect(store.listAgentPeers(10, "trusted").map((item) => item.peerId)).toContain(peer.peerId);

    const message = store.insertAgentMessage({
      id: "msg-1",
      direction: "outbound",
      peerId: peer.peerId,
      nonce: "nonce-1",
      commandType: "ping",
      envelopeVersion: 1,
      contactId: "ct-1",
      identityWallet: peer.walletAddress,
      transportAddress: peer.walletAddress,
      trustOutcome: "pending_outbound",
      ciphertext: "0xdeadbeef",
      status: "pending",
    });
    expect(store.getAgentMessage(message.id)?.nonce).toBe("nonce-1");
    expect(store.getAgentMessage(message.id)?.trustOutcome).toBe("pending_outbound");

    const updatedMessage = store.updateAgentMessageStatus(message.id, "sent", {
      txHash: "0xtx1",
      trustOutcome: "trusted",
      sentAt: "2026-03-06T00:00:00.000Z",
    });
    expect(updatedMessage.txHash).toBe("0xtx1");
    expect(updatedMessage.status).toBe("sent");
    expect(updatedMessage.envelopeVersion).toBe(1);
    expect(updatedMessage.contactId).toBe("ct-1");
    expect(updatedMessage.identityWallet).toBe(peer.walletAddress);
    expect(updatedMessage.transportAddress).toBe(peer.walletAddress);
    expect(updatedMessage.trustOutcome).toBe("trusted");
    expect(
      store.listAgentMessages(10, {
        peerId: peer.peerId,
        direction: "outbound",
        status: "sent",
      }),
    ).toHaveLength(1);

    expect(() =>
      store.insertAgentMessage({
        id: "msg-dup",
        direction: "outbound",
        peerId: peer.peerId,
        nonce: "nonce-1",
        commandType: "ping",
        ciphertext: "0xduplicate",
      }),
    ).toThrow(/UNIQUE constraint failed|unique/i);

    const cursor = store.upsertListenerCursor({
      address: "0xlistener",
      chainId: 8453,
      cursor: "12345",
    });
    expect(cursor.chainId).toBe("8453");
    expect(store.getListenerCursor("0xlistener", "8453")?.cursor).toBe("12345");
    expect(
      store.upsertListenerCursor({
        address: "0xlistener",
        chainId: "8453",
        cursor: "12346",
      }).cursor,
    ).toBe("12346");

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists local identity roles and signed artifact records for v2 groundwork", () => {
    const { dir, store } = createStore("alphaos-state-");

    const liw = store.upsertAgentLocalIdentity({
      role: "liw",
      walletAlias: "agent-comm",
      walletAddress: "0x1111111111111111111111111111111111111111",
      identityWallet: "0x1111111111111111111111111111111111111111",
      chainId: 196,
      mode: "temporary_dual_use",
    });
    const acw = store.upsertAgentLocalIdentity({
      role: "acw",
      walletAlias: "agent-comm",
      walletAddress: "0x1111111111111111111111111111111111111111",
      identityWallet: "0x1111111111111111111111111111111111111111",
      chainId: 196,
      mode: "temporary_dual_use",
      activeBindingDigest: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      transportKeyId: "rk_2026_01",
    });

    expect(liw.role).toBe("liw");
    expect(acw.activeBindingDigest).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(store.listAgentLocalIdentities(10).map((profile) => profile.role)).toEqual(
      expect.arrayContaining(["liw", "acw"]),
    );

    const digest = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const saved = store.upsertAgentSignedArtifact({
      artifactType: "ContactCard",
      digest,
      signer: "0x1111111111111111111111111111111111111111",
      identityWallet: "0x1111111111111111111111111111111111111111",
      chainId: 196,
      issuedAt: 1741348800,
      expiresAt: 1757246400,
      payload: {
        cardVersion: 1,
      },
      proof: {
        type: "eip712",
      },
      verificationStatus: "verified",
      source: "unit-test",
    });
    expect(saved.artifactType).toBe("ContactCard");
    expect(store.getAgentSignedArtifact(digest)?.verificationStatus).toBe("verified");

    store.upsertAgentSignedArtifact({
      artifactType: "ContactCard",
      digest,
      signer: "0x1111111111111111111111111111111111111111",
      identityWallet: "0x1111111111111111111111111111111111111111",
      chainId: 196,
      issuedAt: 1741348800,
      expiresAt: 1757246400,
      payload: {
        cardVersion: 1,
      },
      proof: {
        type: "eip712",
      },
      verificationStatus: "invalid",
      verificationError: "bad signature",
      source: "unit-test-import",
    });
    expect(store.getAgentSignedArtifact(digest)?.verificationStatus).toBe("invalid");
    expect(store.listAgentSignedArtifacts(10, { artifactType: "ContactCard" })).toHaveLength(1);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists contact-oriented v2 records and resolves by contact, identity, legacy peer, and active receive address", () => {
    const { dir, store } = createStore("alphaos-state-");

    const contact = store.upsertAgentContact({
      contactId: "ct-test-1",
      identityWallet: "0x2222222222222222222222222222222222222222",
      legacyPeerId: "peer-legacy-1",
      displayName: "Peer Contact",
      status: "trusted",
      supportedProtocols: ["agent-comm/2", "agent-comm/1"],
      capabilityProfile: "research-collab",
      capabilities: ["ping", "start_discovery"],
      metadata: { source: "unit-test" },
    });
    expect(store.getAgentContact(contact.contactId)?.identityWallet).toBe(contact.identityWallet);
    expect(store.getAgentContactByIdentityWallet(contact.identityWallet)?.contactId).toBe(contact.contactId);
    expect(store.getAgentContactByLegacyPeerId("peer-legacy-1")?.contactId).toBe(contact.contactId);

    const endpoint = store.upsertAgentTransportEndpoint({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      chainId: 8453,
      receiveAddress: "0x3333333333333333333333333333333333333333",
      pubkey: "pubkey-transport-1",
      keyId: "rk_contact_1",
      endpointStatus: "active",
      source: "unit-test",
      metadata: { active: true },
    });
    expect(endpoint.endpointStatus).toBe("active");
    expect(
      store.getAgentContactByActiveReceiveAddress("0x3333333333333333333333333333333333333333")
        ?.contactId,
    ).toBe(contact.contactId);

    const event = store.upsertAgentConnectionEvent({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      direction: "inbound",
      eventType: "connection_invite",
      eventStatus: "pending",
      messageId: "msg-invite-1",
      txHash: "0xinvite1",
      occurredAt: "2026-03-07T00:00:00.000Z",
    });
    const eventUpdated = store.upsertAgentConnectionEvent({
      contactId: contact.contactId,
      identityWallet: contact.identityWallet,
      direction: "inbound",
      eventType: "connection_invite",
      eventStatus: "applied",
      messageId: "msg-invite-1",
      txHash: "0xinvite1",
      reason: "accepted",
      occurredAt: "2026-03-07T00:01:00.000Z",
    });
    expect(eventUpdated.id).toBe(event.id);
    expect(store.listAgentConnectionEvents(10, { contactId: contact.contactId })).toHaveLength(1);
    expect(store.getAgentConnectionEvent(event.id)?.eventStatus).toBe("applied");

    const digest = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    store.upsertAgentArtifactStatus({
      artifactDigest: digest,
      artifactType: "TransportBinding",
      identityWallet: contact.identityWallet,
      status: "active",
    });
    const revoked = store.upsertAgentArtifactStatus({
      artifactDigest: digest,
      artifactType: "TransportBinding",
      identityWallet: contact.identityWallet,
      status: "revoked",
      revokedByDigest: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      revokedAt: 1741348800,
      reason: "key rotation",
    });
    expect(revoked.status).toBe("revoked");
    expect(store.listAgentArtifactStatuses(10, { status: "revoked" })).toHaveLength(1);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("idempotently backfills legacy agent_peers into contact-oriented storage", () => {
    const { dir, store } = createStore("alphaos-state-");

    store.upsertAgentPeer({
      peerId: "legacy-peer-1",
      walletAddress: "0x4444444444444444444444444444444444444444",
      pubkey: "legacy-pubkey-1",
      status: "trusted",
      capabilities: ["ping"],
    });
    store.upsertAgentPeer({
      peerId: "legacy-peer-2",
      walletAddress: "0x5555555555555555555555555555555555555555",
      pubkey: "legacy-pubkey-2",
      status: "blocked",
      capabilities: ["start_discovery"],
    });

    const first = store.backfillAgentContactsFromLegacyPeers({ chainId: 8453 });
    expect(first).toEqual({
      processedPeers: 2,
      createdContacts: 2,
      updatedContacts: 0,
      createdTransportEndpoints: 2,
      updatedTransportEndpoints: 0,
    });

    expect(store.listAgentContacts(10)).toHaveLength(2);
    expect(store.listAgentTransportEndpoints(10)).toHaveLength(2);
    expect(store.getAgentContactByLegacyPeerId("legacy-peer-1")?.status).toBe("trusted");
    expect(store.getAgentContactByLegacyPeerId("legacy-peer-2")?.status).toBe("blocked");
    expect(
      store.getAgentContactByActiveReceiveAddress("0x4444444444444444444444444444444444444444")
        ?.legacyPeerId,
    ).toBe("legacy-peer-1");
    expect(store.getAgentContactByActiveReceiveAddress("0x5555555555555555555555555555555555555555")).toBe(
      null,
    );

    const second = store.backfillAgentContactsFromLegacyPeers({ chainId: 8453 });
    expect(second).toEqual({
      processedPeers: 2,
      createdContacts: 0,
      updatedContacts: 2,
      createdTransportEndpoints: 0,
      updatedTransportEndpoints: 2,
    });
    expect(store.listAgentContacts(10)).toHaveLength(2);
    expect(store.listAgentTransportEndpoints(10)).toHaveLength(2);

    store.upsertAgentPeer({
      peerId: "legacy-peer-1",
      walletAddress: "0x4444444444444444444444444444444444444444",
      pubkey: "legacy-pubkey-1",
      status: "revoked",
      capabilities: ["ping"],
    });
    const single = store.backfillAgentContactFromLegacyPeer("legacy-peer-1", { chainId: 8453 });
    expect(single).toEqual({
      processedPeers: 1,
      createdContacts: 0,
      updatedContacts: 1,
      createdTransportEndpoints: 0,
      updatedTransportEndpoints: 1,
    });
    expect(store.getAgentContactByLegacyPeerId("legacy-peer-1")?.status).toBe("revoked");
    expect(
      store
        .listAgentTransportEndpoints(10, { contactId: store.getAgentContactByLegacyPeerId("legacy-peer-1")!.contactId })
        .map((item) => item.endpointStatus),
    ).toContain("revoked");

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stores v2 agent message metadata on a fresh database bootstrap", () => {
    const { dir, store } = createStore("alphaos-state-");

    const message = store.insertAgentMessage({
      direction: "outbound",
      peerId: "peer-v2",
      nonce: "nonce-v2",
      commandType: "ping",
      envelopeVersion: 2,
      msgId: "11111111-1111-4111-8111-111111111111",
      contactId: "ct_v2",
      identityWallet: "0x7777777777777777777777777777777777777777",
      transportAddress: "0x8888888888888888888888888888888888888888",
      trustOutcome: "trusted_sender",
      decryptedCommandType: "ping",
      ciphertext: "0xdeadbeef",
      status: "sent",
      sentAt: "2026-03-07T00:00:00.000Z",
    });

    expect(message).toEqual(
      expect.objectContaining({
        envelopeVersion: 2,
        msgId: "11111111-1111-4111-8111-111111111111",
        contactId: "ct_v2",
        identityWallet: "0x7777777777777777777777777777777777777777",
        transportAddress: "0x8888888888888888888888888888888888888888",
        trustOutcome: "trusted_sender",
        decryptedCommandType: "ping",
      }),
    );
    expect(
      store.findAgentMessageByMsgId("outbound", "11111111-1111-4111-8111-111111111111")?.id,
    ).toBe(message.id);
    expect(store.listAgentMessages(10, { contactId: "ct_v2" })).toHaveLength(1);
    expect(
      store.listAgentMessages(10, {
        identityWallet: "0x7777777777777777777777777777777777777777",
      }),
    ).toHaveLength(1);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("drops obsolete agent comm tables and enforces message uniqueness when opening a legacy db", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-state-legacy-"));
    const legacyDb = new Database(path.join(dir, "alpha.db"));
    legacyDb.exec(`
      CREATE TABLE agent_peers (
        peer_id TEXT PRIMARY KEY,
        name TEXT,
        wallet_address TEXT NOT NULL UNIQUE,
        pubkey TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        tx_hash TEXT,
        nonce TEXT NOT NULL,
        command_type TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        status TEXT NOT NULL,
        sent_at TEXT,
        received_at TEXT,
        executed_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE agent_message_receipts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        receipt_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL UNIQUE,
        shared_key_hint TEXT,
        last_nonce TEXT,
        last_tx_hash TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE listener_cursors (
        address TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        cursor TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(address, chain_id)
      );

      CREATE TABLE x402_receipts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        payer TEXT NOT NULL,
        amount TEXT NOT NULL,
        asset TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        verified INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacyDb.close();

    const store = new StateStore(dir);
    const db = (store as unknown as { alphaDb: Database.Database }).alphaDb;
    const tables = db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'agent_peers',
             'agent_messages',
             'listener_cursors',
             'agent_message_receipts',
             'agent_sessions',
             'x402_receipts'
           )
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      "agent_messages",
      "agent_peers",
      "listener_cursors",
    ]);

    store.upsertAgentPeer({
      peerId: "legacy-peer",
      walletAddress: "0xlegacy",
      pubkey: "legacy-pubkey",
    });
    store.insertAgentMessage({
      id: "legacy-msg-1",
      direction: "inbound",
      peerId: "legacy-peer",
      nonce: "legacy-nonce",
      commandType: "ping",
      ciphertext: "0x01",
    });

    expect(() =>
      store.insertAgentMessage({
        id: "legacy-msg-2",
        direction: "inbound",
        peerId: "legacy-peer",
        nonce: "legacy-nonce",
        commandType: "ping",
        ciphertext: "0x02",
      }),
    ).toThrow(/UNIQUE constraint failed|unique/i);

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
