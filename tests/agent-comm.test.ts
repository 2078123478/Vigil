import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeEnvelope, encodeEnvelope } from "../src/skills/alphaos/runtime/agent-comm/calldata-codec";
import { decrypt } from "../src/skills/alphaos/runtime/agent-comm/ecdh-crypto";
import { startListener } from "../src/skills/alphaos/runtime/agent-comm/tx-listener";
import {
  AGENT_COMM_DEFAULT_MAX_MESSAGE_BYTES,
  AGENT_COMM_ENVELOPE_VERSION,
  AGENT_COMM_KEX_SUITE_V2,
  AGENT_COMM_LEGACY_ENVELOPE_VERSION,
  type EncryptedEnvelopeV1,
} from "../src/skills/alphaos/runtime/agent-comm/types";
import type { StateStore } from "../src/skills/alphaos/runtime/state-store";

const createPublicClientMock = vi.hoisted(() => vi.fn());

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
  };
});

const baseEnvelope: EncryptedEnvelopeV1 = {
  version: AGENT_COMM_LEGACY_ENVELOPE_VERSION,
  senderPeerId: "peer-a",
  senderPubkey: "03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  recipient: "0x1111111111111111111111111111111111111111",
  nonce: "nonce-1",
  timestamp: "2026-03-06T00:00:00.000Z",
  command: {
    type: "ping",
    schemaVersion: 1,
  },
  ciphertext: "0xdeadbeef",
  signature: "0xsig",
};

describe("agent-comm crypto and codec", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid ciphertext hex with explicit error", () => {
    expect(() => decrypt("0xzz", "0x11")).toThrow("Invalid ciphertext: expected hex characters only");
  });

  it("encodes and decodes envelope payload", () => {
    const encoded = encodeEnvelope(baseEnvelope);
    const decoded = decodeEnvelope(encoded);

    expect(decoded).toEqual(baseEnvelope);
  });

  it("encodes and decodes v2 envelope payloads", () => {
    const v2Envelope = {
      version: AGENT_COMM_ENVELOPE_VERSION,
      kex: {
        suite: AGENT_COMM_KEX_SUITE_V2,
        recipientKeyId: "rk_receiver",
        ephemeralPubkey: "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      ciphertext: "0x1234abcd",
    } as const;

    const encoded = encodeEnvelope(v2Envelope);
    const decoded = decodeEnvelope(encoded);

    expect(decoded).toEqual(v2Envelope);
  });

  it("enforces max envelope message bytes", () => {
    const oversized: EncryptedEnvelopeV1 = {
      ...baseEnvelope,
      ciphertext: `0x${"ab".repeat(AGENT_COMM_DEFAULT_MAX_MESSAGE_BYTES)}`,
    };

    expect(() => encodeEnvelope(oversized)).toThrow("Envelope message exceeds max size");
  });
});

describe("tx-listener inbound filtering", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("only emits transactions addressed to the listener wallet", async () => {
    const targetAddress = "0x1111111111111111111111111111111111111111";
    const inboundTx = {
      hash: "0xaaa",
      from: "0x2222222222222222222222222222222222222222",
      to: targetAddress,
      input: "0x1234",
      blockNumber: 7n,
    };
    const outboundTx = {
      hash: "0xbbb",
      from: targetAddress,
      to: "0x3333333333333333333333333333333333333333",
      input: "0x5678",
      blockNumber: 7n,
    };
    const unrelatedTx = {
      hash: "0xccc",
      from: "0x4444444444444444444444444444444444444444",
      to: "0x5555555555555555555555555555555555555555",
      input: "0x9abc",
      blockNumber: 7n,
    };

    createPublicClientMock.mockReturnValue({
      getChainId: vi.fn(async () => 196),
      getBlockNumber: vi.fn(async () => 7n),
      getBlock: vi.fn(async () => ({
        timestamp: 1n,
        transactions: [inboundTx, outboundTx, unrelatedTx],
      })),
    });

    const onTransaction = vi.fn(async () => undefined);
    const store = {
      getListenerCursor: vi.fn(() => null),
      upsertListenerCursor: vi.fn(),
    } as unknown as StateStore;

    const stop = startListener(
      {
        rpcUrl: "http://localhost:8545",
        chainId: 196,
        address: targetAddress,
        pollIntervalMs: 1000,
        store,
        mode: "poll",
        startBlockNumber: 7n,
      },
      onTransaction,
    );

    await vi.waitFor(() => {
      expect(onTransaction).toHaveBeenCalledTimes(1);
    });
    stop();

    expect(onTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: inboundTx.hash,
        to: targetAddress,
      }),
    );
  });
});
