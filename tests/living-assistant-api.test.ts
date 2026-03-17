import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/skills/alphaos/api/server";
import { StateStore } from "../src/skills/alphaos/runtime/state-store";
import type { EngineModeResponse, SkillManifest } from "../src/skills/alphaos/types";

const stores: Array<{ dir: string; store: StateStore }> = [];
const API_SECRET = "living-assistant-api-secret";

afterEach(() => {
  for (const entry of stores.splice(0)) {
    entry.store.close();
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }
});

function setupApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaos-living-assistant-api-"));
  const store = new StateStore(dir);
  stores.push({ dir, store });

  const engine = {
    getCurrentMode: () => "paper",
    requestMode: (mode: "paper" | "live"): EngineModeResponse => ({
      ok: true,
      requestedMode: mode,
      currentMode: mode,
      reasons: [],
    }),
  };

  const manifest: SkillManifest = {
    id: "alphaos",
    version: "0.2.0",
    description: "living assistant api test",
    strategyIds: ["dex-arbitrage"],
  };

  return createServer(engine as never, store, manifest, {
    apiSecret: API_SECRET,
    demoPublic: false,
  });
}

type ApiResponse = {
  status: number;
  body: unknown;
};

function authHeaders(secret = API_SECRET): Record<string, string> {
  return { authorization: `Bearer ${secret}` };
}

async function invokeApi(
  app: ReturnType<typeof createServer>,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
): Promise<ApiResponse> {
  const socket = new PassThrough();
  (socket as { remoteAddress?: string }).remoteAddress = "127.0.0.1";
  const socketDestroy = socket.destroy.bind(socket);
  (socket as { destroy: () => PassThrough }).destroy = () => socket;

  let raw = "";
  const write = socket.write.bind(socket);
  (socket as { write: (...args: unknown[]) => boolean }).write = (...args: unknown[]) => {
    const chunk = args[0];
    if (Buffer.isBuffer(chunk)) {
      raw += chunk.toString("utf8");
    } else if (typeof chunk === "string") {
      raw += chunk;
    }
    return write(...(args as Parameters<typeof write>));
  };

  const req = new http.IncomingMessage(socket as never);
  req.method = method;
  req.url = url;
  req.headers = {};
  for (const [key, value] of Object.entries(authHeaders())) {
    req.headers[key.toLowerCase()] = value;
  }

  const payloadText = payload ? JSON.stringify(payload) : undefined;
  if (payloadText) {
    req.push(payloadText);
    req.headers["content-type"] = "application/json";
    req.headers["content-length"] = String(Buffer.byteLength(payloadText));
  }
  req.push(null);

  const res = new http.ServerResponse(req);
  res.assignSocket(socket as never);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`request timeout ${method} ${url}`)), 1500);
    const clear = () => clearTimeout(timeout);

    req.on("error", (error) => {
      clear();
      reject(error);
    });
    res.on("error", (error) => {
      clear();
      reject(error);
    });
    res.on("finish", () => {
      clear();
      resolve();
    });

    (
      app as unknown as {
        handle: (r: http.IncomingMessage, s: http.ServerResponse, n: (e?: unknown) => void) => void;
      }
    ).handle(req, res, (error?: unknown) => {
      if (error) {
        clear();
        reject(error);
      }
    });
  });

  const splitAt = raw.indexOf("\r\n\r\n");
  const text = splitAt >= 0 ? raw.slice(splitAt + 4) : "";
  const body = text ? (JSON.parse(text) as unknown) : undefined;

  socketDestroy();
  return {
    status: res.statusCode,
    body,
  };
}

describe("living assistant API routes", () => {
  it("/evaluate accepts a signal and returns loop output", async () => {
    const app = setupApp();
    const response = await invokeApi(app, "POST", "/api/v1/living-assistant/evaluate", {
      signal: {
        kind: "binance_announcement",
        title: "ETH listing update",
        body: "Listing window now open.",
        type: "new_listing",
        pair: "ETH/USDC",
        urgency: "high",
        relevanceHint: "likely_relevant",
        detectedAt: "2026-03-17T10:10:00.000Z",
      },
      userContext: {
        localHour: 10,
        recentContactCount: 0,
        activeStrategies: ["spread-threshold"],
        watchlist: ["ETH/USDC"],
        riskTolerance: "moderate",
      },
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect((body.signal as { source: string }).source).toBe("binance_announcement");
    expect((body.decision as { attentionLevel: string }).attentionLevel).toBe("voice_brief");
    expect(body.brief).toBeDefined();
    expect(typeof body.loopCompletedAt).toBe("string");
  });

  it("/demo/:scenarioName loads fixture and returns loop result", async () => {
    const app = setupApp();
    const response = await invokeApi(app, "GET", "/api/v1/living-assistant/demo/quiet-hours-downgrade");

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect((body.signal as { signalId: string }).signalId).toBe("scenario-quiet-hours-1");
    expect((body.decision as { attentionLevel: string }).attentionLevel).toBe("digest");
    expect(body.demoMode).toBe(true);
  });

  it("/capsules lists available signal capsules", async () => {
    const app = setupApp();
    const response = await invokeApi(app, "GET", "/api/v1/living-assistant/capsules");

    expect(response.status).toBe(200);
    const body = response.body as { items: string[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toContain("arbitrage-opportunity-eth-usdc.json");
    expect(body.items).toContain("binance-announcement-eth-listing.json");
  });
});
