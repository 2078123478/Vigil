import type { NormalizedSignal, SignalRelevanceHint, SignalUrgency } from "../types";

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface BinanceSquarePollerConfig {
  endpoint?: string;
  pageSize?: number;
  pollIntervalMs?: number;
  includeKeywords?: string[];
  queryParams?: Record<string, string | number | boolean>;
}

export interface BinanceSquarePollerResult {
  signals: NormalizedSignal[];
  fetchedAt: string;
  postCount: number;
  error?: string;
}

export interface BinanceSquarePost {
  id: string;
  title: string;
  body?: string;
  authorName?: string;
  symbols: string[];
  tags: string[];
  trendScore: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewCount: number;
  publishedAt: string;
  rawPayload: Record<string, unknown>;
}

type TrendNarrativeType =
  | "meme_surge"
  | "listing_narrative"
  | "airdrop_narrative"
  | "risk_narrative"
  | "narrative_surge";

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function readCount(input: unknown): number {
  const value = readNumber(input);
  if (value === null) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function asPositiveInt(input: number | undefined, fallback: number): number {
  const value = typeof input === "number" && Number.isFinite(input) ? Math.floor(input) : fallback;
  return value > 0 ? value : fallback;
}

function normalizeKeywords(input: string[] | undefined): string[] {
  if (!input || input.length === 0) {
    return [];
  }

  return [...new Set(input.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function readString(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const values = input
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (isRecord(item)) {
        return (
          readString(item.name)
          ?? readString(item.value)
          ?? readString(item.tag)
          ?? readString(item.topic)
          ?? readString(item.symbol)
          ?? ""
        );
      }
      return "";
    })
    .filter(Boolean);

  return [...new Set(values)];
}

function readTextFromRecord(record: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
      continue;
    }
    if (isRecord(value)) {
      const nested =
        readString(value.text)
        ?? readString(value.content)
        ?? readString(value.title)
        ?? readString(value.body)
        ?? readString(value.description);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function toSummaryTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 88) {
    return normalized;
  }
  return `${normalized.slice(0, 85)}...`;
}

function normalizeTimestamp(input: unknown, fallbackIso: string): string {
  const numeric = readNumber(input);
  let candidate: Date | null = null;
  if (numeric !== null) {
    const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      candidate = parsed;
    }
  } else if (typeof input === "string" && input.trim()) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      candidate = parsed;
    }
  }

  return candidate ? candidate.toISOString() : fallbackIso;
}

function readAuthorName(input: Record<string, unknown>): string | undefined {
  const direct =
    readString(input.authorName)
    ?? readString(input.publisherName)
    ?? readString(input.nickName)
    ?? readString(input.nickname);
  if (direct) {
    return direct;
  }

  const author = isRecord(input.author) ? input.author : isRecord(input.publisher) ? input.publisher : null;
  if (!author) {
    return undefined;
  }

  return (
    readString(author.nickName)
    ?? readString(author.nickname)
    ?? readString(author.name)
    ?? readString(author.userName)
    ?? undefined
  );
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-z0-9_]{2,}/gi) ?? [];
  return [...new Set(matches.map((item) => item.replace(/^#/, "").toLowerCase()))];
}

function extractSymbols(text: string): string[] {
  const cashtagMatches = text.match(/\$[A-Z0-9]{2,15}/g) ?? [];
  const pairMatches = text.match(/[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}/g) ?? [];
  const symbols = [...cashtagMatches.map((item) => item.slice(1)), ...pairMatches];
  return [...new Set(symbols.map((item) => item.toUpperCase()))];
}

function extractNumericFromStats(post: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const direct = readCount(post[key]);
    if (direct > 0) {
      return direct;
    }
  }

  const statLikeKeys = ["stat", "stats", "metrics", "engagement"];
  for (const statKey of statLikeKeys) {
    const block = post[statKey];
    if (!isRecord(block)) {
      continue;
    }
    for (const key of keys) {
      const nested = readCount(block[key]);
      if (nested > 0) {
        return nested;
      }
    }
  }
  return 0;
}

function deriveTrendScore(post: Record<string, unknown>, counts: {
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewCount: number;
}): number {
  const explicit = readNumber(post.trendScore) ?? readNumber(post.hotScore) ?? readNumber(post.score) ?? readNumber(post.heat);
  if (explicit !== null) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }

  if (counts.likeCount === 0 && counts.commentCount === 0 && counts.shareCount === 0 && counts.viewCount === 0) {
    return 0;
  }

  // Keep inferred trend in [0, 100] while giving comments/shares extra weight.
  const inferred =
    Math.log10(1 + counts.viewCount) * 14
    + Math.log10(1 + counts.likeCount) * 20
    + Math.log10(1 + counts.commentCount) * 24
    + Math.log10(1 + counts.shareCount) * 28;
  return Math.max(0, Math.min(100, Math.round(inferred)));
}

function parseSquarePost(input: unknown, fetchedAt: string): BinanceSquarePost | null {
  if (!isRecord(input)) {
    return null;
  }

  const idRaw = input.id ?? input.postId ?? input.noteId ?? input.articleId ?? input.code;
  const idNumeric = readNumber(idRaw);
  const id = readString(idRaw) ?? (idNumeric !== null ? String(Math.trunc(idNumeric)) : null);
  if (!id) {
    return null;
  }

  const title =
    readTextFromRecord(input, ["title", "headline", "subject"])
    ?? (() => {
      const fallback = readTextFromRecord(input, ["body", "content", "text", "description", "summary", "message"]);
      return fallback ? toSummaryTitle(fallback) : null;
    })();
  if (!title) {
    return null;
  }

  const body = readTextFromRecord(input, ["body", "content", "text", "description", "summary", "message"]);
  const detectedAt = normalizeTimestamp(
    input.publishTime
      ?? input.publishedAt
      ?? input.releaseDate
      ?? input.createTime
      ?? input.createdAt
      ?? input.updateTime
      ?? input.updatedAt
      ?? input.timestamp,
    fetchedAt,
  );

  const likeCount = extractNumericFromStats(input, ["likeCount", "likes", "likeNum", "thumbUpCount", "upCount"]);
  const commentCount = extractNumericFromStats(input, ["commentCount", "comments", "commentNum", "replyCount"]);
  const shareCount = extractNumericFromStats(input, ["shareCount", "shares", "forwardCount", "repostCount"]);
  const viewCount = extractNumericFromStats(input, ["viewCount", "views", "readCount", "impressionCount"]);

  const symbols = [
    ...readStringArray(input.symbols),
    ...readStringArray(input.symbolList),
    ...extractSymbols(`${title} ${body ?? ""}`),
  ];
  const tags = [
    ...readStringArray(input.tags),
    ...readStringArray(input.topics),
    ...readStringArray(input.topicList),
    ...extractHashtags(`${title} ${body ?? ""}`),
  ];

  return {
    id,
    title,
    body: body ?? undefined,
    authorName: readAuthorName(input),
    symbols: [...new Set(symbols.map((symbol) => symbol.toUpperCase()))],
    tags: [...new Set(tags.map((tag) => tag.toLowerCase()))],
    trendScore: deriveTrendScore(input, { likeCount, commentCount, shareCount, viewCount }),
    likeCount,
    commentCount,
    shareCount,
    viewCount,
    publishedAt: detectedAt,
    rawPayload: input,
  };
}

function parsePostsFromPayload(payload: unknown, fetchedAt: string): BinanceSquarePost[] | null {
  if (!isRecord(payload)) {
    return null;
  }

  const candidates: unknown[] = [];
  const data = payload.data;
  if (Array.isArray(data)) {
    candidates.push(data);
  } else if (isRecord(data)) {
    candidates.push(
      data.posts,
      data.postsList,
      data.postList,
      data.items,
      data.list,
      data.feeds,
      data.records,
      data.results,
    );
  }

  candidates.push(payload.posts, payload.items, payload.list, payload.feeds, payload.records, payload.results);
  const rawList = candidates.find((entry) => Array.isArray(entry));
  if (!Array.isArray(rawList)) {
    return null;
  }

  return rawList
    .map((item) => parseSquarePost(item, fetchedAt))
    .filter((item): item is BinanceSquarePost => item !== null);
}

function matchesKeywords(post: BinanceSquarePost, includeKeywords: Set<string>): boolean {
  if (includeKeywords.size === 0) {
    return true;
  }

  const haystack = [post.title, post.body ?? "", post.tags.join(" "), post.symbols.join(" ")]
    .join(" ")
    .toLowerCase();
  for (const keyword of includeKeywords) {
    if (haystack.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function inferNarrativeType(post: BinanceSquarePost): TrendNarrativeType {
  const text = [post.title, post.body ?? "", post.tags.join(" "), post.symbols.join(" ")].join(" ").toLowerCase();
  if (text.includes("meme")) {
    return "meme_surge";
  }
  if (text.includes("airdrop") || text.includes("launchpool") || text.includes("launchpad")) {
    return "airdrop_narrative";
  }
  if (text.includes("listing") || text.includes("listings") || text.includes("delist")) {
    return "listing_narrative";
  }
  if (
    text.includes("exploit")
    || text.includes("risk")
    || text.includes("incident")
    || text.includes("hack")
    || text.includes("depeg")
  ) {
    return "risk_narrative";
  }
  return "narrative_surge";
}

function urgencyFromPost(post: BinanceSquarePost, narrativeType: TrendNarrativeType): SignalUrgency {
  if (narrativeType === "risk_narrative" && post.trendScore >= 80) {
    return "critical";
  }
  if (post.trendScore >= 75) {
    return "high";
  }
  if (post.trendScore >= 40) {
    return "medium";
  }
  return "low";
}

function relevanceFromPost(post: BinanceSquarePost, narrativeType: TrendNarrativeType): SignalRelevanceHint {
  if (post.symbols.length > 0 || narrativeType === "listing_narrative" || narrativeType === "airdrop_narrative") {
    return "likely_relevant";
  }
  if (narrativeType === "risk_narrative") {
    return "unknown";
  }
  return "likely_irrelevant";
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function buildRequestUrl(
  endpoint: string,
  pageSize: number,
  queryParams: Record<string, string | number | boolean>,
): string {
  const params = new URLSearchParams();
  params.set("pageNo", "1");
  params.set("pageSize", String(pageSize));

  for (const [key, value] of Object.entries(queryParams)) {
    params.set(key, String(value));
  }

  try {
    const url = new URL(endpoint);
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    const qs = params.toString();
    const joiner = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${joiner}${qs}`;
  }
}

function maybePairFromSymbols(symbols: string[]): string | undefined {
  return symbols.find((symbol) => symbol.includes("/"));
}

export function squarePostToSignal(post: BinanceSquarePost): NormalizedSignal {
  const narrativeType = inferNarrativeType(post);
  return {
    signalId: `binance-square-${post.id}`,
    source: "binance_square",
    type: narrativeType,
    title: post.title,
    body: post.body,
    urgency: urgencyFromPost(post, narrativeType),
    relevanceHint: relevanceFromPost(post, narrativeType),
    pair: maybePairFromSymbols(post.symbols),
    detectedAt: post.publishedAt,
    rawPayload: post.rawPayload,
    metadata: {
      channel: "square",
      authorName: post.authorName,
      symbols: post.symbols,
      tags: post.tags,
      trendScore: post.trendScore,
      engagement: {
        likes: post.likeCount,
        comments: post.commentCount,
        shares: post.shareCount,
        views: post.viewCount,
      },
    },
  };
}

export class BinanceSquarePoller {
  private readonly endpoint: string;
  private readonly pageSize: number;
  private readonly pollIntervalMs: number;
  private readonly includeKeywords: Set<string>;
  private readonly queryParams: Record<string, string | number | boolean>;
  private readonly lastFetchedPostIds: Set<string> = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private pollInFlight = false;

  constructor(config: BinanceSquarePollerConfig = {}) {
    this.endpoint = config.endpoint?.trim() || process.env.BINANCE_SQUARE_ENDPOINT?.trim() || "";
    this.pageSize = asPositiveInt(config.pageSize, DEFAULT_PAGE_SIZE);
    this.pollIntervalMs = asPositiveInt(config.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    this.includeKeywords = new Set(normalizeKeywords(config.includeKeywords));
    this.queryParams = config.queryParams ?? {};
  }

  async poll(): Promise<BinanceSquarePollerResult> {
    const fetchedAt = new Date().toISOString();
    if (!this.endpoint) {
      return {
        signals: [],
        fetchedAt,
        postCount: 0,
        error: "[binance-square] endpoint is not configured (set config.endpoint or BINANCE_SQUARE_ENDPOINT)",
      };
    }

    const requestUrl = buildRequestUrl(this.endpoint, this.pageSize, this.queryParams);

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: "GET",
      });
    } catch (error) {
      return {
        signals: [],
        fetchedAt,
        postCount: 0,
        error: `[binance-square] request failed: ${messageFromError(error)}`,
      };
    }

    if (!response.ok) {
      const details = await safeReadText(response);
      const suffix = details ? ` - ${details}` : "";
      return {
        signals: [],
        fetchedAt,
        postCount: 0,
        error: `[binance-square] HTTP ${response.status} ${response.statusText}${suffix}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return {
        signals: [],
        fetchedAt,
        postCount: 0,
        error: `[binance-square] failed to parse JSON response: ${messageFromError(error)}`,
      };
    }

    const posts = parsePostsFromPayload(payload, fetchedAt);
    if (!posts) {
      return {
        signals: [],
        fetchedAt,
        postCount: 0,
        error: "[binance-square] unexpected response shape",
      };
    }

    const filteredPosts = posts.filter((post) => matchesKeywords(post, this.includeKeywords));
    const signals: NormalizedSignal[] = [];
    for (const post of filteredPosts) {
      if (this.lastFetchedPostIds.has(post.id)) {
        continue;
      }
      this.lastFetchedPostIds.add(post.id);
      signals.push(squarePostToSignal(post));
    }

    return {
      signals,
      fetchedAt,
      postCount: filteredPosts.length,
    };
  }

  start(onNewSignals: (signals: NormalizedSignal[]) => void): void {
    if (this.timer) {
      return;
    }

    const run = async (): Promise<void> => {
      if (this.pollInFlight) {
        return;
      }

      this.pollInFlight = true;
      try {
        const result = await this.poll();
        if (result.signals.length > 0) {
          try {
            onNewSignals(result.signals);
          } catch {
            // Callback failures should not stop interval polling.
          }
        }
      } finally {
        this.pollInFlight = false;
      }
    };

    void run();
    this.timer = setInterval(() => {
      void run();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }
}
