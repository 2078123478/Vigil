import { z } from "zod";
import {
  getAddress,
  hashTypedData,
  type Address,
  type Hex,
  type TypedData,
  type TypedDataDomain,
} from "viem";

export const AGENT_COMM_ARTIFACT_DOMAIN_NAME = "AgentComm";
export const AGENT_COMM_ARTIFACT_DOMAIN_VERSION = "2";
export const AGENT_COMM_CONTACT_CARD_VERSION = 1;
export const AGENT_COMM_TRANSPORT_BINDING_VERSION = 1;
export const AGENT_COMM_REVOCATION_NOTICE_VERSION = 1;
export const AGENT_COMM_EMPTY_ARTIFACT_DIGEST =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const agentCommArtifactPrimaryTypes = [
  "ContactCard",
  "TransportBinding",
  "RevocationNotice",
] as const;
export const revocableAgentCommArtifactTypes = ["ContactCard", "TransportBinding"] as const;

const unixTimestampSecondsSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();

function normalizeAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`Invalid ${label}: expected EVM address`);
  }
}

function parseAddress(value: string, label: string, ctx: z.RefinementCtx): Address {
  try {
    return getAddress(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ${label}: expected EVM address`,
    });
    return z.NEVER;
  }
}

function parseHex(
  value: string,
  label: string,
  ctx: z.RefinementCtx,
  options: {
    exactBytes?: number;
    minBytes?: number;
    prefixByte?: "02" | "03";
  } = {},
): Hex {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ${label}: expected 0x-prefixed hex`,
    });
    return z.NEVER;
  }

  const normalized = value.toLowerCase();
  const byteLength = (normalized.length - 2) / 2;

  if (options.exactBytes !== undefined && byteLength !== options.exactBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ${label}: expected ${options.exactBytes} bytes`,
    });
    return z.NEVER;
  }

  if (options.minBytes !== undefined && byteLength < options.minBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ${label}: expected at least ${options.minBytes} bytes`,
    });
    return z.NEVER;
  }

  if (options.prefixByte && !normalized.startsWith(`0x${options.prefixByte}`)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ${label}: expected compressed secp256k1 public key`,
    });
    return z.NEVER;
  }

  return normalized as Hex;
}

const addressSchema = (label: string) =>
  z.string().transform((value, ctx) => parseAddress(value, label, ctx));

const bytes32HexSchema = (label: string) =>
  z.string().transform((value, ctx) => parseHex(value, label, ctx, { exactBytes: 32 }));

const compressedPubkeySchema = z
  .string()
  .transform((value, ctx) =>
    parseHex(value, "transport pubkey", ctx, { exactBytes: 33, prefixByte: "02" }),
  )
  .or(
    z
      .string()
      .transform((value, ctx) =>
        parseHex(value, "transport pubkey", ctx, { exactBytes: 33, prefixByte: "03" }),
      ),
  );

const agentCommArtifactPrimaryTypeSchema = z.enum(agentCommArtifactPrimaryTypes);
const revocableAgentCommArtifactTypeSchema = z.enum(revocableAgentCommArtifactTypes);

export const agentCommArtifactDomainSchema = z
  .object({
    name: z.literal(AGENT_COMM_ARTIFACT_DOMAIN_NAME),
    version: z.literal(AGENT_COMM_ARTIFACT_DOMAIN_VERSION),
    chainId: positiveIntegerSchema,
    salt: bytes32HexSchema("domain salt").optional(),
  })
  .strict();

export const contactCardTransportSchema = z
  .object({
    chainId: positiveIntegerSchema,
    receiveAddress: addressSchema("transport receiveAddress"),
    pubkey: compressedPubkeySchema,
    keyId: z.string().min(1),
  })
  .strict();

export const contactCardDefaultsSchema = z
  .object({
    capabilityProfile: z.string().min(1),
    capabilities: z.array(z.string().min(1)),
  })
  .strict();

export const contactCardSchema = z
  .object({
    cardVersion: z.literal(AGENT_COMM_CONTACT_CARD_VERSION),
    protocols: z.array(z.string().min(1)).min(1),
    displayName: z.string().min(1),
    handle: z.string(),
    identityWallet: addressSchema("identityWallet"),
    transport: contactCardTransportSchema,
    defaults: contactCardDefaultsSchema,
    issuedAt: unixTimestampSecondsSchema,
    expiresAt: unixTimestampSecondsSchema,
    legacyPeerId: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expiresAt <= value.issuedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expiresAt must be greater than issuedAt",
        path: ["expiresAt"],
      });
    }
  });

export const transportBindingSchema = z
  .object({
    bindingVersion: z.literal(AGENT_COMM_TRANSPORT_BINDING_VERSION),
    identityWallet: addressSchema("identityWallet"),
    chainId: positiveIntegerSchema,
    receiveAddress: addressSchema("receiveAddress"),
    pubkey: compressedPubkeySchema,
    keyId: z.string().min(1),
    issuedAt: unixTimestampSecondsSchema,
    expiresAt: unixTimestampSecondsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expiresAt <= value.issuedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expiresAt must be greater than issuedAt",
        path: ["expiresAt"],
      });
    }
  });

export const revocationNoticeSchema = z
  .object({
    noticeVersion: z.literal(AGENT_COMM_REVOCATION_NOTICE_VERSION),
    identityWallet: addressSchema("identityWallet"),
    chainId: positiveIntegerSchema,
    artifactType: revocableAgentCommArtifactTypeSchema,
    artifactDigest: bytes32HexSchema("artifactDigest"),
    replacementDigest: bytes32HexSchema("replacementDigest"),
    reason: z.string(),
    revokedAt: unixTimestampSecondsSchema,
  })
  .strict();

export const AGENT_COMM_CONTACT_CARD_TYPED_DATA = {
  ContactCardTransport: [
    { name: "chainId", type: "uint256" },
    { name: "receiveAddress", type: "address" },
    { name: "pubkey", type: "bytes" },
    { name: "keyId", type: "string" },
  ],
  ContactCardDefaults: [
    { name: "capabilityProfile", type: "string" },
    { name: "capabilities", type: "string[]" },
  ],
  ContactCard: [
    { name: "cardVersion", type: "uint32" },
    { name: "protocols", type: "string[]" },
    { name: "displayName", type: "string" },
    { name: "handle", type: "string" },
    { name: "identityWallet", type: "address" },
    { name: "transport", type: "ContactCardTransport" },
    { name: "defaults", type: "ContactCardDefaults" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "legacyPeerId", type: "string" },
  ],
} as const satisfies TypedData;

export const AGENT_COMM_TRANSPORT_BINDING_TYPED_DATA = {
  TransportBinding: [
    { name: "bindingVersion", type: "uint32" },
    { name: "identityWallet", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "receiveAddress", type: "address" },
    { name: "pubkey", type: "bytes" },
    { name: "keyId", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const satisfies TypedData;

export const AGENT_COMM_REVOCATION_NOTICE_TYPED_DATA = {
  RevocationNotice: [
    { name: "noticeVersion", type: "uint32" },
    { name: "identityWallet", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "artifactType", type: "string" },
    { name: "artifactDigest", type: "bytes32" },
    { name: "replacementDigest", type: "bytes32" },
    { name: "reason", type: "string" },
    { name: "revokedAt", type: "uint64" },
  ],
} as const satisfies TypedData;

export interface AgentCommArtifactDomainOptions {
  salt?: Hex;
}

function toBigInt(value: number): bigint {
  return BigInt(value);
}

export function createAgentCommArtifactDomain(
  chainId: number,
  options: AgentCommArtifactDomainOptions = {},
): TypedDataDomain {
  const domain = agentCommArtifactDomainSchema.parse({
    name: AGENT_COMM_ARTIFACT_DOMAIN_NAME,
    version: AGENT_COMM_ARTIFACT_DOMAIN_VERSION,
    chainId,
    ...(options.salt ? { salt: options.salt } : {}),
  });

  return domain;
}

export function getContactCardTypedData(
  card: AgentCommContactCardInput,
  options: AgentCommArtifactDomainOptions = {},
) {
  const message = contactCardSchema.parse(card);
  return {
    domain: createAgentCommArtifactDomain(message.transport.chainId, options),
    types: AGENT_COMM_CONTACT_CARD_TYPED_DATA,
    primaryType: "ContactCard" as const,
    message: {
      ...message,
      transport: {
        ...message.transport,
        chainId: toBigInt(message.transport.chainId),
      },
      issuedAt: toBigInt(message.issuedAt),
      expiresAt: toBigInt(message.expiresAt),
    },
  };
}

export function getTransportBindingTypedData(
  binding: AgentCommTransportBindingInput,
  options: AgentCommArtifactDomainOptions = {},
) {
  const message = transportBindingSchema.parse(binding);
  return {
    domain: createAgentCommArtifactDomain(message.chainId, options),
    types: AGENT_COMM_TRANSPORT_BINDING_TYPED_DATA,
    primaryType: "TransportBinding" as const,
    message: {
      ...message,
      chainId: toBigInt(message.chainId),
      issuedAt: toBigInt(message.issuedAt),
      expiresAt: toBigInt(message.expiresAt),
    },
  };
}

export function getRevocationNoticeTypedData(
  notice: AgentCommRevocationNoticeInput,
  options: AgentCommArtifactDomainOptions = {},
) {
  const message = revocationNoticeSchema.parse(notice);
  return {
    domain: createAgentCommArtifactDomain(message.chainId, options),
    types: AGENT_COMM_REVOCATION_NOTICE_TYPED_DATA,
    primaryType: "RevocationNotice" as const,
    message: {
      ...message,
      chainId: toBigInt(message.chainId),
      revokedAt: toBigInt(message.revokedAt),
    },
  };
}

export function computeContactCardDigest(
  card: AgentCommContactCardInput,
  options: AgentCommArtifactDomainOptions = {},
): Hex {
  return hashTypedData(getContactCardTypedData(card, options));
}

export function computeTransportBindingDigest(
  binding: AgentCommTransportBindingInput,
  options: AgentCommArtifactDomainOptions = {},
): Hex {
  return hashTypedData(getTransportBindingTypedData(binding, options));
}

export function computeRevocationNoticeDigest(
  notice: AgentCommRevocationNoticeInput,
  options: AgentCommArtifactDomainOptions = {},
): Hex {
  return hashTypedData(getRevocationNoticeTypedData(notice, options));
}

export function formatArtifactFingerprint(digest: Hex): string {
  const normalized = bytes32HexSchema("artifact digest").parse(digest);
  return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`;
}

export function normalizeArtifactSignerAddress(value: string): Address {
  return normalizeAddress(value, "artifact signer");
}

export type AgentCommArtifactPrimaryType = z.infer<typeof agentCommArtifactPrimaryTypeSchema>;
export type RevocableAgentCommArtifactType = z.infer<typeof revocableAgentCommArtifactTypeSchema>;
export type AgentCommArtifactDomain = z.infer<typeof agentCommArtifactDomainSchema>;
export type AgentCommContactCardTransport = z.infer<typeof contactCardTransportSchema>;
export type AgentCommContactCardDefaults = z.infer<typeof contactCardDefaultsSchema>;
export type AgentCommContactCardInput = z.input<typeof contactCardSchema>;
export type AgentCommContactCard = z.infer<typeof contactCardSchema>;
export type AgentCommTransportBindingInput = z.input<typeof transportBindingSchema>;
export type AgentCommTransportBinding = z.infer<typeof transportBindingSchema>;
export type AgentCommRevocationNoticeInput = z.input<typeof revocationNoticeSchema>;
export type AgentCommRevocationNotice = z.infer<typeof revocationNoticeSchema>;
