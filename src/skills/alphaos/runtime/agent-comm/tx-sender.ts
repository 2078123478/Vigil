import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { StateStore } from "../state-store";
import type { ShadowWallet } from "./shadow-wallet";
import { decodeEnvelope } from "./calldata-codec";
import type { AgentCommandType, AgentMessage } from "./types";

export interface OutboundMessageContext {
  peerId: string;
  messageId?: string;
  nonce: string;
  commandType: AgentCommandType;
  envelopeVersion?: number;
  msgId?: string;
  contactId?: string;
  identityWallet?: string;
  transportAddress?: string;
  trustOutcome?: string;
  decryptedCommandType?: AgentCommandType;
}

export interface TxSenderOptions {
  rpcUrl: string;
  chainId: number;
  walletAlias: string;
  store?: StateStore;
  outboundMessage?: OutboundMessageContext;
}

export interface SendResult {
  txHash: string;
  nonce: string;
  sentAt: string;
}

interface PersistOutboundMessagePayload {
  nonce: string;
  commandType: AgentCommandType;
  envelopeVersion?: number;
  msgId?: string;
  contactId?: string;
  identityWallet?: string;
  transportAddress?: string;
  trustOutcome?: string;
  decryptedCommandType?: AgentCommandType;
  ciphertext: string;
  txHash?: string;
  sentAt?: string;
  error?: string;
}

function normalizeAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${reason}`);
  }
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createCommChain(options: TxSenderOptions) {
  return defineChain({
    id: options.chainId,
    name: `agent-comm-${options.chainId}`,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [options.rpcUrl],
      },
    },
  });
}

function resolveExistingOutboundMessage(
  store: StateStore,
  outboundMessage: OutboundMessageContext,
  nonce: string,
): AgentMessage | null {
  const existingMessageById = outboundMessage.messageId
    ? store.getAgentMessage(outboundMessage.messageId)
    : null;
  if (!existingMessageById) {
    return store.findAgentMessage(outboundMessage.peerId, "outbound", nonce);
  }
  if (
    existingMessageById.direction !== "outbound" ||
    existingMessageById.peerId !== outboundMessage.peerId ||
    existingMessageById.nonce !== nonce
  ) {
    throw new Error(`Outbound message context mismatch for ${existingMessageById.id}`);
  }
  return existingMessageById;
}

function persistOutboundMessage(
  options: TxSenderOptions,
  payload: PersistOutboundMessagePayload,
): void {
  const { store, outboundMessage } = options;
  if (!store || !outboundMessage) {
    return;
  }

  const existingMessage = resolveExistingOutboundMessage(store, outboundMessage, payload.nonce);
  const status = payload.txHash ? "sent" : "failed";

  if (existingMessage) {
    store.updateAgentMessageStatus(existingMessage.id, status, {
      txHash: payload.txHash,
      envelopeVersion: payload.envelopeVersion,
      msgId: payload.msgId,
      contactId: payload.contactId,
      identityWallet: payload.identityWallet,
      transportAddress: payload.transportAddress,
      trustOutcome: payload.trustOutcome,
      decryptedCommandType: payload.decryptedCommandType,
      sentAt: payload.sentAt,
      error: payload.error,
    });
    return;
  }

  store.insertAgentMessage({
    id: outboundMessage.messageId,
    direction: "outbound",
    peerId: outboundMessage.peerId,
    txHash: payload.txHash,
    nonce: payload.nonce,
    commandType: payload.commandType,
    envelopeVersion: payload.envelopeVersion,
    msgId: payload.msgId,
    contactId: payload.contactId,
    identityWallet: payload.identityWallet,
    transportAddress: payload.transportAddress,
    trustOutcome: payload.trustOutcome,
    decryptedCommandType: payload.decryptedCommandType,
    ciphertext: payload.ciphertext,
    status,
    sentAt: payload.sentAt,
    error: payload.error,
  });
}

export async function sendCalldata(
  options: TxSenderOptions,
  wallet: ShadowWallet,
  toAddress: string,
  calldata: Hex,
): Promise<SendResult> {
  const envelope = decodeEnvelope(calldata);
  const targetAddress = normalizeAddress(toAddress, "toAddress");

  if (envelope.version === 1) {
    const recipient = normalizeAddress(envelope.recipient, "envelope recipient");

    if (recipient !== targetAddress) {
      throw new Error(
        `Envelope recipient mismatch: expected ${targetAddress}, received ${recipient}`,
      );
    }

    if (!sameHex(wallet.getPublicKey(), envelope.senderPubkey)) {
      throw new Error(
        `Envelope senderPubkey does not match wallet alias "${options.walletAlias}"`,
      );
    }
  }

  const chain = createCommChain(options);
  const publicClient = createPublicClient({
    chain,
    transport: http(options.rpcUrl),
  });
  const account = privateKeyToAccount(wallet.privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(options.rpcUrl),
  });

  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== options.chainId) {
    throw new Error(
      `RPC chainId mismatch: expected ${options.chainId}, received ${rpcChainId}`,
    );
  }

  const txNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const sentAt = new Date().toISOString();

  try {
    const txHash = await walletClient.sendTransaction({
      account,
      to: targetAddress,
      value: 0n,
      data: calldata,
      nonce: txNonce,
    });

    persistOutboundMessage(options, {
      nonce: options.outboundMessage?.nonce ?? (envelope.version === 1 ? envelope.nonce : crypto.randomUUID()),
      commandType:
        options.outboundMessage?.commandType
        ?? (envelope.version === 1 ? envelope.command.type : "ping"),
      envelopeVersion: options.outboundMessage?.envelopeVersion ?? envelope.version,
      msgId: options.outboundMessage?.msgId,
      contactId: options.outboundMessage?.contactId,
      identityWallet: options.outboundMessage?.identityWallet,
      transportAddress: options.outboundMessage?.transportAddress,
      trustOutcome: options.outboundMessage?.trustOutcome,
      decryptedCommandType: options.outboundMessage?.decryptedCommandType,
      ciphertext: envelope.ciphertext,
      txHash,
      sentAt,
    });

    return {
      txHash,
      nonce: options.outboundMessage?.nonce ?? (envelope.version === 1 ? envelope.nonce : ""),
      sentAt,
    };
  } catch (error) {
    const reason = toErrorMessage(error);
    persistOutboundMessage(options, {
      nonce: options.outboundMessage?.nonce ?? (envelope.version === 1 ? envelope.nonce : crypto.randomUUID()),
      commandType:
        options.outboundMessage?.commandType
        ?? (envelope.version === 1 ? envelope.command.type : "ping"),
      envelopeVersion: options.outboundMessage?.envelopeVersion ?? envelope.version,
      msgId: options.outboundMessage?.msgId,
      contactId: options.outboundMessage?.contactId,
      identityWallet: options.outboundMessage?.identityWallet,
      transportAddress: options.outboundMessage?.transportAddress,
      trustOutcome: options.outboundMessage?.trustOutcome,
      decryptedCommandType: options.outboundMessage?.decryptedCommandType,
      ciphertext: envelope.ciphertext,
      error: reason,
    });
    throw new Error(
      `Failed to send calldata transaction on chain ${options.chainId}: ${reason}`,
    );
  }
}
