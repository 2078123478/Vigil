import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramCallbackHandler, type CallbackEvent } from "./callback-handler";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function callbackUpdate(
  callbackQueryId: string,
  callbackData: string,
  messageText = "Strong interrupt context:\n\nSuggested actions:\n1. Act now",
) {
  return {
    ok: true,
    result: [
      {
        update_id: 1,
        callback_query: {
          id: callbackQueryId,
          data: callbackData,
          from: { id: 9001 },
          message: {
            message_id: 101,
            text: messageText,
            chat: { id: 777000 },
          },
        },
      },
    ],
  };
}

async function pollOnce(
  handler: TelegramCallbackHandler,
  callbackQueryId: string,
  callbackData: string,
  messageText?: string,
): Promise<CallbackEvent> {
  const getUpdatesFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => jsonResponse(callbackUpdate(callbackQueryId, callbackData, messageText)),
  );
  globalThis.fetch = getUpdatesFetch as unknown as typeof fetch;

  const event = await new Promise<CallbackEvent>((resolve) => {
    handler.startPolling((data) => {
      handler.stopPolling();
      resolve(data);
    });
  });

  expect(getUpdatesFetch).toHaveBeenCalledTimes(1);
  expect(String(getUpdatesFetch.mock.calls[0][0])).toBe("https://api.telegram.org/bottest-token/getUpdates");
  return event;
}

describe("telegram callback handler", () => {
  it.each([
    [
      "la:act_now",
      "act_now",
      "✅ Acknowledged. Taking action now.",
      "[✅ Acknowledged]",
    ],
    [
      "la:defer_5m",
      "defer_5m",
      "⏰ Deferred. Will remind in 5 minutes.",
      "[⏰ Deferred 5m]",
    ],
    [
      "la:ignore_once",
      "ignore_once",
      "🔕 Ignored this time.",
      "[🔕 Ignored]",
    ],
  ])(
    "handles %s and edits the original message",
    async (callbackData, expectedAction, expectedAnswerText, expectedLabel) => {
      const handler = new TelegramCallbackHandler({ botToken: "test-token" });
      const event = await pollOnce(handler, `cb-${expectedAction}`, callbackData);

      const actionFetch = vi
        .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(jsonResponse({ ok: true, result: true }))
        .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: event.messageId } }));
      globalThis.fetch = actionFetch as unknown as typeof fetch;

      const result = await handler.handleCallback(event.callbackQueryId, event.callbackData, event.messageId);

      expect(result.ok).toBe(true);
      expect(result.action).toBe(expectedAction);
      expect(result.answeredAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(actionFetch).toHaveBeenCalledTimes(2);

      const [answerUrl, answerInit] = actionFetch.mock.calls[0];
      expect(String(answerUrl)).toBe("https://api.telegram.org/bottest-token/answerCallbackQuery");
      expect(JSON.parse(String(answerInit?.body))).toEqual({
        callback_query_id: event.callbackQueryId,
        text: expectedAnswerText,
      });

      const [editUrl, editInit] = actionFetch.mock.calls[1];
      expect(String(editUrl)).toBe("https://api.telegram.org/bottest-token/editMessageText");
      expect(JSON.parse(String(editInit?.body))).toEqual({
        chat_id: "777000",
        message_id: 101,
        text: "Strong interrupt context:\n\nSuggested actions:\n1. Act now\n\n" + expectedLabel,
      });
    },
  );

  it("answers unknown living assistant actions without editing the message", async () => {
    const handler = new TelegramCallbackHandler({ botToken: "test-token" });
    const event = await pollOnce(handler, "cb-unknown", "la:unexpected");

    const actionFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse({ ok: true, result: true }),
    );
    globalThis.fetch = actionFetch as unknown as typeof fetch;

    const result = await handler.handleCallback(event.callbackQueryId, event.callbackData, event.messageId);

    expect(result).toMatchObject({
      ok: true,
      action: "unexpected",
    });
    expect(actionFetch).toHaveBeenCalledTimes(1);
    expect(String(actionFetch.mock.calls[0][0])).toBe(
      "https://api.telegram.org/bottest-token/answerCallbackQuery",
    );
    expect(JSON.parse(String(actionFetch.mock.calls[0][1]?.body))).toEqual({
      callback_query_id: "cb-unknown",
      text: "Unknown action",
    });
  });

  it("returns an error when edit context is missing", async () => {
    const handler = new TelegramCallbackHandler({
      botToken: "test-token",
    });

    const actionFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse({ ok: true, result: true }),
    );
    globalThis.fetch = actionFetch as unknown as typeof fetch;

    const result = await handler.handleCallback("cb-missing", "la:act_now", 101);

    expect(result.ok).toBe(false);
    expect(result.action).toBe("act_now");
    expect(result.error).toBe("handleCallback failed: chat id is missing");
    expect(actionFetch).toHaveBeenCalledTimes(1);
  });

  it("returns an error when Telegram requests fail", async () => {
    const handler = new TelegramCallbackHandler({ botToken: "test-token" });
    const event = await pollOnce(handler, "cb-network", "la:act_now");

    const networkErrorFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => {
        throw new Error("network down");
      },
    );
    globalThis.fetch = networkErrorFetch as unknown as typeof fetch;

    const result = await handler.handleCallback(event.callbackQueryId, event.callbackData, event.messageId);

    expect(result.ok).toBe(false);
    expect(result.action).toBe("act_now");
    expect(result.error).toContain("network down");
  });

  it("returns an error when required callback params are missing", async () => {
    const handler = new TelegramCallbackHandler({ botToken: "" });

    const result = await handler.handleCallback("", "");

    expect(result.ok).toBe(false);
    expect(result.action).toBe("unknown");
    expect(result.error).toBe("handleCallback failed: bot token is missing");
  });
});
