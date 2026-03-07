import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import {
  AGENT_COMM_CONTACT_CARD_VERSION,
  AGENT_COMM_EMPTY_ARTIFACT_DIGEST,
  AGENT_COMM_REVOCATION_NOTICE_VERSION,
  AGENT_COMM_TRANSPORT_BINDING_VERSION,
  computeContactCardDigest,
  computeRevocationNoticeDigest,
  computeTransportBindingDigest,
  contactCardSchema,
  formatArtifactFingerprint,
  getContactCardTypedData,
  getTransportBindingTypedData,
  revocationNoticeSchema,
  transportBindingSchema,
} from "../src/skills/alphaos/runtime/agent-comm/artifact-contracts";

const identityPrivateKey =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const account = privateKeyToAccount(identityPrivateKey);

const contactCard = contactCardSchema.parse({
  cardVersion: AGENT_COMM_CONTACT_CARD_VERSION,
  protocols: ["agent-comm/2", "agent-comm/1"],
  displayName: "Xiaoyin",
  handle: "@xiaoyin",
  identityWallet: account.address.toLowerCase(),
  transport: {
    chainId: 196,
    receiveAddress: "0x2222222222222222222222222222222222222222",
    pubkey: "0x02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    keyId: "rk_2026_01",
  },
  defaults: {
    capabilityProfile: "research-collab",
    capabilities: ["ping", "start_discovery"],
  },
  issuedAt: 1741348800,
  expiresAt: 1757246400,
  legacyPeerId: "",
});

const transportBinding = transportBindingSchema.parse({
  bindingVersion: AGENT_COMM_TRANSPORT_BINDING_VERSION,
  identityWallet: account.address,
  chainId: 196,
  receiveAddress: "0x2222222222222222222222222222222222222222",
  pubkey: "0x02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  keyId: "rk_2026_01",
  issuedAt: 1741348800,
  expiresAt: 1757246400,
});

const revocationNotice = revocationNoticeSchema.parse({
  noticeVersion: AGENT_COMM_REVOCATION_NOTICE_VERSION,
  identityWallet: account.address,
  chainId: 196,
  artifactType: "TransportBinding",
  artifactDigest: computeTransportBindingDigest(transportBinding),
  replacementDigest: AGENT_COMM_EMPTY_ARTIFACT_DIGEST,
  reason: "",
  revokedAt: 1750000000,
});

describe("agent-comm artifact contracts", () => {
  it("produces a stable contact card digest and canonical short fingerprint", () => {
    const digest = computeContactCardDigest(contactCard);

    expect(digest).toBe("0xfff1fb0ce3198300f5883b8ede17145f0cfcced2f5087f1413f270d21403b6b2");
    expect(formatArtifactFingerprint(digest)).toBe("0xfff1fb0c...1403b6b2");
  });

  it("signs and verifies the canonical contact card typed data", async () => {
    const typedData = getContactCardTypedData(contactCard);
    const signature = await account.signTypedData(typedData);

    await expect(
      verifyTypedData({
        address: account.address,
        ...typedData,
        signature,
      }),
    ).resolves.toBe(true);
  });

  it("produces stable digests for transport bindings and revocation notices", () => {
    expect(computeTransportBindingDigest(transportBinding)).toBe(
      "0xa81bb2c470a2c3b09285ddfdc3e7e364ab80283e1c2ec43a8b3e893fada47750",
    );
    expect(computeRevocationNoticeDigest(revocationNotice)).toBe(
      "0x5bd118378facdcae831797ac941a221c9ee19e8b321f91c3ee5b39d9a412345e",
    );
  });

  it("normalizes addresses during schema parsing", () => {
    const typedData = getTransportBindingTypedData({
      ...transportBinding,
      identityWallet: account.address.toLowerCase(),
      receiveAddress: "0x2222222222222222222222222222222222222222".toLowerCase(),
    });

    expect(typedData.message.identityWallet).toBe(account.address);
    expect(typedData.message.receiveAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  it("rejects revocation digests that are not bytes32", () => {
    expect(() =>
      revocationNoticeSchema.parse({
        ...revocationNotice,
        artifactDigest: "0x1234",
      }),
    ).toThrow("Invalid artifactDigest: expected 32 bytes");
  });
});
