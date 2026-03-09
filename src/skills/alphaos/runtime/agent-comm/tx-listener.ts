import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import type { StateStore } from "../state-store";

export interface TxListenerOptions {
  rpcUrl: string;
  chainId: number;
  address: string;
  pollIntervalMs: number;
  store: StateStore;
  mode?: "poll";
  startBlockNumber?: bigint;
  onError?: (error: Error) => void;
}

export interface TransactionEvent {
  txHash: string;
  from: Address;
  to: Address;
  calldata: Hex;
  blockNumber: bigint;
  timestamp: string;
}

class ChainIdMismatchError extends Error {}
type MinedTransaction = Transaction & { to: Address; blockNumber: bigint };
type BlockReceiptSupport = "unknown" | "supported" | "unsupported";
const CATCH_UP_BACKLOG_THRESHOLD = 1n;

function normalizeAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${reason}`);
  }
}

function sameAddress(left: string | null, right: Address): boolean {
  if (!left) {
    return false;
  }
  try {
    return getAddress(left) === right;
  } catch {
    return false;
  }
}

function blockTimestampToIso(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toISOString();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBlockReceiptsUnsupported(error: unknown): boolean {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === -32601
  ) {
    return true;
  }

  const message = toErrorMessage(error).toLowerCase();
  if (!message.includes("eth_getblockreceipts")) {
    return false;
  }
  return (
    message.includes("method not found")
    || message.includes("unsupported")
    || message.includes("not available")
    || message.includes("does not exist")
    || message.includes("-32601")
  );
}

function normalizeStartBlockNumber(startBlockNumber: bigint | undefined): bigint | undefined {
  if (startBlockNumber === undefined) {
    return undefined;
  }
  return startBlockNumber < 0n ? 0n : startBlockNumber;
}

function parseCursorBlockNumber(cursor: string, address: Address, chainId: number): bigint {
  try {
    return BigInt(cursor);
  } catch {
    throw new Error(
      `Invalid listener cursor for ${address} on chain ${chainId}: expected integer block number`,
    );
  }
}

function resolveNextBlockNumber(
  store: StateStore,
  chainId: number,
  address: Address,
  startBlockNumber: bigint | undefined,
  latestBlockNumber: bigint,
): bigint {
  const cursor = store.getListenerCursor(address, chainId);
  if (cursor) {
    return parseCursorBlockNumber(cursor.cursor, address, chainId) + 1n;
  }
  const normalizedStartBlockNumber = normalizeStartBlockNumber(startBlockNumber);
  if (normalizedStartBlockNumber !== undefined) {
    return normalizedStartBlockNumber;
  }
  return latestBlockNumber;
}

function isRelevantTransaction(
  transaction: Transaction,
  targetAddress: Address,
): transaction is MinedTransaction {
  if (transaction.to === null || transaction.blockNumber === null) {
    return false;
  }
  return sameAddress(transaction.to, targetAddress);
}

function toTransactionEvent(transaction: MinedTransaction, timestamp: string): TransactionEvent {
  return {
    txHash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    calldata: transaction.input,
    blockNumber: transaction.blockNumber,
    timestamp,
  };
}

function sortReceiptsByTransactionIndex(
  left: Pick<TransactionReceipt, "transactionIndex">,
  right: Pick<TransactionReceipt, "transactionIndex">,
): number {
  if (left.transactionIndex === right.transactionIndex) {
    return 0;
  }
  return left.transactionIndex < right.transactionIndex ? -1 : 1;
}

export function startListener(
  options: TxListenerOptions,
  onTransaction: (event: TransactionEvent) => void | Promise<void>,
): () => void {
  if ((options.mode ?? "poll") !== "poll") {
    throw new Error("tx-listener only supports poll mode");
  }

  const targetAddress = normalizeAddress(options.address, "listener address");
  const publicClient = createPublicClient({
    transport: http(options.rpcUrl),
  });
  const pollIntervalMs = Math.max(100, Math.floor(options.pollIntervalMs));

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let isPolling = false;
  let blockReceiptSupport: BlockReceiptSupport = "unknown";

  const reportError = (error: unknown): void => {
    const normalized =
      error instanceof Error ? error : new Error(`tx-listener failed: ${toErrorMessage(error)}`);
    options.onError?.(normalized);
  };

  const scheduleNext = (): void => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void pollOnce();
    }, pollIntervalMs);
  };

  const pollOnce = async (): Promise<void> => {
    if (stopped || isPolling) {
      return;
    }
    isPolling = true;

    try {
      const rpcChainId = await publicClient.getChainId();
      if (rpcChainId !== options.chainId) {
        throw new ChainIdMismatchError(
          `RPC chainId mismatch: expected ${options.chainId}, received ${rpcChainId}`,
        );
      }

      const latestBlockNumber = await publicClient.getBlockNumber();
      const nextBlockNumber = resolveNextBlockNumber(
        options.store,
        options.chainId,
        targetAddress,
        options.startBlockNumber,
        latestBlockNumber,
      );
      if (nextBlockNumber > latestBlockNumber) {
        return;
      }
      const useReceiptCatchUp =
        latestBlockNumber - nextBlockNumber >= CATCH_UP_BACKLOG_THRESHOLD;

      for (
        let blockNumber = nextBlockNumber;
        blockNumber <= latestBlockNumber && !stopped;
        blockNumber += 1n
      ) {
        if (useReceiptCatchUp && blockReceiptSupport !== "unsupported") {
          let receipts: TransactionReceipt[];
          try {
            receipts = await publicClient.getBlockReceipts({ blockNumber });
            blockReceiptSupport = "supported";
          } catch (error) {
            if (!isBlockReceiptsUnsupported(error)) {
              throw error;
            }
            blockReceiptSupport = "unsupported";
            receipts = [];
          }

          if (blockReceiptSupport === "supported") {
            const matchingReceipts = receipts
              .filter((receipt) => sameAddress(receipt.to, targetAddress))
              .sort(sortReceiptsByTransactionIndex);

            if (matchingReceipts.length > 0) {
              const block = await publicClient.getBlock({ blockNumber });
              const timestamp = blockTimestampToIso(block.timestamp);

              for (const receipt of matchingReceipts) {
                const transaction = await publicClient.getTransaction({
                  hash: receipt.transactionHash,
                });
                if (!isRelevantTransaction(transaction, targetAddress)) {
                  continue;
                }
                await onTransaction(toTransactionEvent(transaction, timestamp));
              }
            }

            options.store.upsertListenerCursor({
              address: targetAddress,
              chainId: options.chainId,
              cursor: blockNumber.toString(),
            });
            continue;
          }
        }

        const block = await publicClient.getBlock({
          blockNumber,
          includeTransactions: true,
        });
        const timestamp = blockTimestampToIso(block.timestamp);

        for (const transaction of block.transactions) {
          if (!isRelevantTransaction(transaction, targetAddress)) {
            continue;
          }

          await onTransaction(toTransactionEvent(transaction, timestamp));
        }

        options.store.upsertListenerCursor({
          address: targetAddress,
          chainId: options.chainId,
          cursor: blockNumber.toString(),
        });
      }
    } catch (error) {
      if (error instanceof ChainIdMismatchError) {
        stopped = true;
      }
      reportError(error);
    } finally {
      isPolling = false;
      scheduleNext();
    }
  };

  void pollOnce();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
