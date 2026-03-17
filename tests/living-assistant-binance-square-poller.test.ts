import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BinanceSquarePoller,
  pollBinanceSquare,
  squarePostToSignal,
} from "../src/skills/alphaos/living-assistant/signal-radar";
import type { BinanceSquarePost } from "../src/skills/alphaos/living-assistant/signal-radar/pollers/binance-square";

const originalFetch = globalThis.fetch;
const originalSquareEndpoint = process.env.BINANCE_SQUARE_ENDPOINT;

function buildPost(id: string, title: string, overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id,
    title,
    content: `Narrative body for ${title}`,
    publishTime: 1773716401712,
    tags: ["narrative"],
    symbols: [],
    stats: {
      likeCount: 12,
      commentCount: 5,
      shareCount: 3,
      viewCount: 800,
    },
    ...overrides,
  };
}

function buildApiResponse(posts: Record<string, unknown>[]): unknown {
  return {
    code: "000000",
    success: true,
    data: {
      posts,
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalSquareEndpoint === undefined) {
    delete process.env.BINANCE_SQUARE_ENDPOINT;
  } else {
    process.env.BINANCE_SQUARE_ENDPOINT = originalSquareEndpoint;
  }
});

describe("living assistant binance square poller", () => {
  it("maps a square post into a normalized signal", () => {
    const post: BinanceSquarePost = {
      id: "post-9001",
      title: "Meme narrative surged for $PEPE",
      body: "Volume of meme mentions jumped rapidly.",
      authorName: "square-user",
      symbols: ["PEPE"],
      tags: ["meme", "trend"],
      trendScore: 82,
      likeCount: 190,
      commentCount: 68,
      shareCount: 21,
      viewCount: 22000,
      publishedAt: "2026-03-17T08:16:00.000Z",
      rawPayload: {
        id: "post-9001",
      },
    };

    const signal = squarePostToSignal(post);

    expect(signal.signalId).toBe("binance-square-post-9001");
    expect(signal.source).toBe("binance_square");
    expect(signal.type).toBe("meme_surge");
    expect(signal.urgency).toBe("high");
    expect(signal.relevanceHint).toBe("likely_relevant");
    expect(signal.detectedAt).toBe(post.publishedAt);
    expect(signal.metadata?.channel).toBe("square");
  });

  it("deduplicates square posts across consecutive poll calls", async () => {
    const payload = buildApiResponse([
      buildPost("sq-1001", "Square trend one"),
      buildPost("sq-1002", "Square trend two"),
    ]);

    const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const poller = new BinanceSquarePoller({
      endpoint: "https://example.com/square-feed",
      pageSize: 15,
    });

    const first = await poller.poll();
    const second = await poller.poll();

    expect(first.error).toBeUndefined();
    expect(first.postCount).toBe(2);
    expect(first.signals).toHaveLength(2);
    expect(second.error).toBeUndefined();
    expect(second.postCount).toBe(2);
    expect(second.signals).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [requestUrl] = mockFetch.mock.calls[0] ?? [];
    expect(String(requestUrl)).toContain("pageNo=1");
    expect(String(requestUrl)).toContain("pageSize=15");
  });

  it("filters square posts based on includeKeywords", async () => {
    const payload = buildApiResponse([
      buildPost("sq-2001", "General market chat", {
        content: "Conversation unrelated to watched assets.",
      }),
      buildPost("sq-2002", "BNB narrative accelerating", {
        content: "Strong BNB mentions are rising quickly.",
      }),
    ]);

    const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const poller = new BinanceSquarePoller({
      endpoint: "https://example.com/square-feed",
      includeKeywords: ["bnb"],
    });
    const result = await poller.poll();

    expect(result.error).toBeUndefined();
    expect(result.postCount).toBe(1);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.signalId).toBe("binance-square-sq-2002");
  });

  it("returns an error result when endpoint is not configured", async () => {
    delete process.env.BINANCE_SQUARE_ENDPOINT;
    const poller = new BinanceSquarePoller();
    const result = await poller.poll();

    expect(result.signals).toEqual([]);
    expect(result.postCount).toBe(0);
    expect(result.error).toContain("endpoint is not configured");
  });

  it("returns an error result when network fetch fails", async () => {
    const failingFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => {
        throw new Error("square api down");
      },
    );
    globalThis.fetch = failingFetch as unknown as typeof fetch;

    const poller = new BinanceSquarePoller({
      endpoint: "https://example.com/square-feed",
    });
    const result = await poller.poll();

    expect(result.signals).toEqual([]);
    expect(result.postCount).toBe(0);
    expect(result.error).toContain("square api down");
  });

  it("supports start and stop interval polling", async () => {
    vi.useFakeTimers();

    const payloads = [
      buildApiResponse([
        buildPost("sq-3001", "Narrative 1"),
      ]),
      {
        code: "000000",
        data: {
          list: [
            buildPost("sq-3001", "Narrative 1"),
            buildPost("sq-3002", "Narrative 2", {
              text: "Now $BNB/USDT chatter is rising.",
              symbols: [],
            }),
          ],
        },
      },
    ];

    let callIndex = 0;
    const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => {
        const payload = payloads[Math.min(callIndex, payloads.length - 1)] as unknown;
        callIndex += 1;
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const poller = new BinanceSquarePoller({
      endpoint: "https://example.com/square-feed",
      pollIntervalMs: 1000,
    });
    const callbackSignals: string[][] = [];

    poller.start((signals) => {
      callbackSignals.push(signals.map((item) => item.signalId));
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(callbackSignals).toEqual([["binance-square-sq-3001"]]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(callbackSignals).toEqual([["binance-square-sq-3001"], ["binance-square-sq-3002"]]);
    expect(callbackSignals[1]?.[0]).toBe("binance-square-sq-3002");

    poller.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(callbackSignals).toHaveLength(2);
  });

  it("exposes pollBinanceSquare helper", async () => {
    const payload = buildApiResponse([
      buildPost("sq-4001", "Airdrop narrative", {
        content: "Users discuss airdrop momentum for $BNB",
      }),
    ]);
    const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await pollBinanceSquare({
      endpoint: "https://example.com/square-feed",
    });

    expect(result.error).toBeUndefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.source).toBe("binance_square");
  });
});
