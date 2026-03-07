import type { Logger } from "pino";
import { createPublicClient, http } from "viem";
import type { AlphaOsConfig } from "../config";
import type { DiscoveryEngine } from "../discovery/discovery-engine";
import type { OnchainOsClient } from "../onchainos-client";
import type { StateStore } from "../state-store";
import type { VaultService } from "../vault";
import {
  processInbox,
  InboxProcessingError,
  type ProcessInboxResult,
} from "./inbox-processor";
import { resolveLocalIdentityState } from "./local-identity";
import { routeCommand } from "./task-router";
import { startListener, type TransactionEvent } from "./tx-listener";
import type { CommListenerMode, ListenerCursor } from "./types";

export interface AgentCommRuntimeErrorSnapshot {
  code: string;
  message: string;
  at: string;
  details?: Record<string, unknown>;
}

export interface AgentCommRuntimeSnapshot {
  enabled: boolean;
  chainId: number;
  listenerMode: CommListenerMode;
  walletAlias: string;
  localAddress?: string;
  localPubkey?: string;
  identityWallet?: string;
  localIdentityMode?: string;
  receiveAddresses?: string[];
  graceReceiveAddresses?: string[];
  lastCursor?: ListenerCursor;
  lastRuntimeError?: AgentCommRuntimeErrorSnapshot;
}

export interface AgentCommRuntimeHandle {
  stop(): void;
  getSnapshot(): AgentCommRuntimeSnapshot;
}

export interface StartAgentCommRuntimeOptions {
  config: AlphaOsConfig;
  logger: Logger;
  store: StateStore;
  discovery: DiscoveryEngine;
  onchain: OnchainOsClient;
  vault: VaultService;
}

interface AgentCommRuntimeState {
  localAddress?: string;
  localPubkey?: string;
  identityWallet?: string;
  localIdentityMode?: string;
  receiveAddresses: string[];
  graceReceiveAddresses: string[];
  lastRuntimeError?: AgentCommRuntimeErrorSnapshot;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertRuntimeConfig(config: AlphaOsConfig): void {
  if (!config.commEnabled) {
    return;
  }
  if (!config.commRpcUrl) {
    throw new Error("COMM_ENABLED=true requires COMM_RPC_URL");
  }
  if (config.commListenerMode === "ws") {
    throw new Error("COMM_LISTENER_MODE=ws is not supported in agent-comm v0.1");
  }
}

function createSnapshotGetter(
  config: AlphaOsConfig,
  store: StateStore,
  state: AgentCommRuntimeState,
): () => AgentCommRuntimeSnapshot {
  return () => ({
    enabled: config.commEnabled,
    chainId: config.commChainId,
    listenerMode: config.commListenerMode,
    walletAlias: config.commWalletAlias,
    localAddress: state.localAddress,
    localPubkey: state.localPubkey,
    identityWallet: state.identityWallet,
    localIdentityMode: state.localIdentityMode,
    receiveAddresses: state.receiveAddresses,
    graceReceiveAddresses: state.graceReceiveAddresses,
    lastCursor: state.localAddress
      ? (store.getListenerCursor(state.localAddress, config.commChainId) ?? undefined)
      : undefined,
    lastRuntimeError: state.lastRuntimeError,
  });
}

async function assertRpcChainId(rpcUrl: string, chainId: number): Promise<void> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const actualChainId = await client.getChainId();
  if (actualChainId !== chainId) {
    throw new Error(`RPC chainId mismatch: expected ${chainId}, received ${actualChainId}`);
  }
}

function createRuntimeState(): AgentCommRuntimeState {
  return {
    receiveAddresses: [],
    graceReceiveAddresses: [],
  };
}

function createDisabledRuntimeHandle(
  getSnapshot: () => AgentCommRuntimeSnapshot,
): AgentCommRuntimeHandle {
  return {
    stop() {},
    getSnapshot,
  };
}

function getRequiredMasterPassword(): string {
  const masterPassword = process.env.VAULT_MASTER_PASSWORD;
  if (!masterPassword) {
    throw new Error("COMM_ENABLED=true requires VAULT_MASTER_PASSWORD");
  }
  return masterPassword;
}

function getRequiredRpcUrl(config: AlphaOsConfig): string {
  if (!config.commRpcUrl) {
    throw new Error("COMM_ENABLED=true requires COMM_RPC_URL");
  }
  return config.commRpcUrl;
}

function restoreRuntimeIdentityState(
  options: StartAgentCommRuntimeOptions,
  masterPassword: string,
  state: AgentCommRuntimeState,
) {
  options.store.backfillAgentContactsFromLegacyPeers({
    chainId: options.config.commChainId,
  });

  const localState = resolveLocalIdentityState(
    {
      config: options.config,
      store: options.store,
      vault: options.vault,
    },
    masterPassword,
  );

  state.localAddress = localState.acwWallet.getAddress();
  state.localPubkey = localState.acwWallet.getPublicKey();
  state.identityWallet = localState.liwProfile.identityWallet;
  state.localIdentityMode = localState.acwProfile.mode;
  state.receiveAddresses = localState.receiveKeys.map((entry) => entry.walletAddress);
  state.graceReceiveAddresses = localState.receiveKeys
    .filter((entry) => entry.status === "grace")
    .map((entry) => entry.walletAddress);

  return localState;
}

function createRuntimeErrorRecorder(
  logger: Logger,
  state: AgentCommRuntimeState,
): (code: string, message: string, details?: Record<string, unknown>) => void {
  return (code: string, message: string, details?: Record<string, unknown>): void => {
    state.lastRuntimeError = {
      code,
      message,
      at: new Date().toISOString(),
      details,
    };
    logger.error(
      {
        code,
        details,
      },
      message,
    );
  };
}

function shouldExecuteMessage(result: ProcessInboxResult): boolean {
  if (result.message.status === "executed" || result.message.status === "rejected") {
    return false;
  }
  return result.message.status === "decrypted";
}

async function executeInboundMessage(
  options: Pick<StartAgentCommRuntimeOptions, "discovery" | "onchain" | "store">,
  result: ProcessInboxResult,
): Promise<void> {
  if (!shouldExecuteMessage(result)) {
    return;
  }

  const routeResult = await routeCommand(
    {
      discovery: options.discovery,
      onchain: options.onchain,
      store: options.store,
    },
    result.command,
  );

  if (routeResult.success) {
    options.store.updateAgentMessageStatus(result.message.id, "executed", {
      executedAt: new Date().toISOString(),
    });
    return;
  }

  options.store.updateAgentMessageStatus(result.message.id, "rejected", {
    executedAt: new Date().toISOString(),
    error: routeResult.error ?? "command rejected",
  });
}

function createTransactionHandler(
  options: Pick<StartAgentCommRuntimeOptions, "config" | "discovery" | "onchain" | "store">,
  input: ReturnType<typeof resolveLocalIdentityState>,
  setRuntimeError: (code: string, message: string, details?: Record<string, unknown>) => void,
): (event: TransactionEvent) => Promise<void> {
  return async (event: TransactionEvent): Promise<void> => {
    try {
      const result = await processInbox(
        {
          wallet: input.acwWallet,
          receiveKeys: input.receiveKeys,
          store: options.store,
          expectedChainId: options.config.commChainId,
        },
        event,
      );

      await executeInboundMessage(options, result);
    } catch (error) {
      if (error instanceof InboxProcessingError) {
        setRuntimeError(error.code, error.message, error.details);
        return;
      }
      setRuntimeError("INBOUND_RUNTIME_FAILED", toErrorMessage(error), {
        txHash: event.txHash,
      });
    }
  };
}

function startRuntimeListeners(
  config: AlphaOsConfig,
  logger: Logger,
  store: StateStore,
  receiveAddresses: string[],
  rpcUrl: string,
  handleTransaction: (event: TransactionEvent) => Promise<void>,
  setRuntimeError: (code: string, message: string, details?: Record<string, unknown>) => void,
): () => void {
  if (config.commListenerMode !== "poll") {
    logger.warn(
      {
        chainId: config.commChainId,
        listenerMode: config.commListenerMode,
      },
      "agent-comm runtime started without listener",
    );
    return () => {};
  }

  const stops = [...new Set(receiveAddresses.map((address) => address.toLowerCase()))].map((normalized) => {
    const address = receiveAddresses.find((candidate) => candidate.toLowerCase() === normalized) ?? normalized;
    return startListener(
      {
        rpcUrl,
        chainId: config.commChainId,
        address,
        pollIntervalMs: config.commPollIntervalMs,
        store,
        mode: "poll",
        onError: (error) => {
          setRuntimeError("LISTENER_FAILED", error.message, {
            chainId: config.commChainId,
            address,
          });
        },
      },
      handleTransaction,
    );
  });

  logger.info(
    {
      chainId: config.commChainId,
      addresses: receiveAddresses,
      listenerMode: config.commListenerMode,
    },
    "agent-comm runtime started",
  );

  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}

function createRuntimeHandle(
  stopListener: () => void,
  getSnapshot: () => AgentCommRuntimeSnapshot,
): AgentCommRuntimeHandle {
  let stopped = false;

  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      stopListener();
    },
    getSnapshot,
  };
}

export async function startAgentCommRuntime(
  options: StartAgentCommRuntimeOptions,
): Promise<AgentCommRuntimeHandle> {
  const { config, logger, store } = options;
  assertRuntimeConfig(config);

  const runtimeState = createRuntimeState();
  const getSnapshot = createSnapshotGetter(config, store, runtimeState);

  if (!config.commEnabled) {
    return createDisabledRuntimeHandle(getSnapshot);
  }

  const rpcUrl = getRequiredRpcUrl(config);
  const masterPassword = getRequiredMasterPassword();
  const localState = restoreRuntimeIdentityState(options, masterPassword, runtimeState);

  await assertRpcChainId(rpcUrl, config.commChainId);

  const setRuntimeError = createRuntimeErrorRecorder(logger, runtimeState);
  const handleTransaction = createTransactionHandler(
    {
      config,
      discovery: options.discovery,
      onchain: options.onchain,
      store,
    },
    localState,
    setRuntimeError,
  );
  const stopListener = startRuntimeListeners(
    config,
    logger,
    store,
    localState.receiveKeys.map((entry) => entry.walletAddress),
    rpcUrl,
    handleTransaction,
    setRuntimeError,
  );

  return createRuntimeHandle(stopListener, getSnapshot);
}
