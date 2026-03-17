import {
  BinanceAnnouncementsPoller,
  type BinanceAnnouncementsPollerConfig,
  type BinanceAnnouncementsPollerResult,
} from "./pollers/binance-announcements";
import {
  BinanceSquarePoller,
  type BinanceSquarePollerConfig,
  type BinanceSquarePollerResult,
} from "./pollers/binance-square";

export * from "./types";
export * from "./normalizer";
export * from "./capsule-loader";
export * from "./pollers/binance-announcements";
export * from "./pollers/binance-square";

export async function pollBinanceAnnouncements(
  config?: BinanceAnnouncementsPollerConfig,
): Promise<BinanceAnnouncementsPollerResult> {
  const poller = new BinanceAnnouncementsPoller(config);
  return poller.poll();
}

export async function pollBinanceSquare(
  config?: BinanceSquarePollerConfig,
): Promise<BinanceSquarePollerResult> {
  const poller = new BinanceSquarePoller(config);
  return poller.poll();
}
