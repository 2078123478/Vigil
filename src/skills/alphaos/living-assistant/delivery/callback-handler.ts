export interface CallbackResult {
  ok: boolean;
  action: string;
  answeredAt: string;
  error?: string;
}

export interface CallbackEvent {
  callbackQueryId: string;
  callbackData: string;
  messageId?: number;
  chatId?: number;
  fromUserId?: number;
}

interface TelegramCallbackHandlerConfig {
  botToken: string;
  chatId?: string;
}

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
  result?: unknown;
}

interface TelegramUpdateResponse extends TelegramApiResponse {
  result?: TelegramUpdate[];
}

interface TelegramUpdate {
  update_id?: number;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramCallbackQuery {
  id?: string;
  data?: string;
  from?: {
    id?: number;
  };
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    chat?: {
      id?: number;
    };
  };
}

interface StoredMessageContext {
  chatId?: string;
  messageId?: number;
  originalText?: string;
}

interface CallbackActionDefinition {
  action: string;
  answerText: string;
  appendedLabel?: string;
}

const POLL_TIMEOUT_SECONDS = 30;
const POLL_RETRY_DELAY_MS = 1000;

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asMessageId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asChatId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

function toActionDefinition(callbackData: string): CallbackActionDefinition {
  switch (callbackData.trim()) {
    case "la:act_now":
      return {
        action: "act_now",
        answerText: "✅ Acknowledged. Taking action now.",
        appendedLabel: "[✅ Acknowledged]",
      };
    case "la:defer_5m":
      return {
        action: "defer_5m",
        answerText: "⏰ Deferred. Will remind in 5 minutes.",
        appendedLabel: "[⏰ Deferred 5m]",
      };
    case "la:ignore_once":
      return {
        action: "ignore_once",
        answerText: "🔕 Ignored this time.",
        appendedLabel: "[🔕 Ignored]",
      };
    default:
      return {
        action: callbackData.startsWith("la:") ? callbackData.slice(3) || "unknown" : "unknown",
        answerText: "Unknown action",
      };
  }
}

function appendStatusLabel(originalText: string, label: string): string {
  const trimmed = originalText.trimEnd();
  if (trimmed.includes(label)) {
    return trimmed;
  }
  return `${trimmed}\n\n${label}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class TelegramCallbackHandler {
  private readonly botToken: string;
  private readonly defaultChatId?: string;
  private readonly callbackContexts = new Map<string, StoredMessageContext>();
  private readonly messageContexts = new Map<number, StoredMessageContext>();
  private nextUpdateOffset?: number;
  private polling = false;
  private pollAbortController?: AbortController;

  constructor(config: TelegramCallbackHandlerConfig) {
    this.botToken = (config.botToken ?? "").trim();
    this.defaultChatId = asOptionalString(config.chatId);
  }

  async handleCallback(
    callbackQueryId: string,
    callbackData: string,
    messageId?: number,
  ): Promise<CallbackResult> {
    const answeredAt = nowIso();
    const normalizedCallbackQueryId = asOptionalString(callbackQueryId);
    if (!this.botToken) {
      return {
        ok: false,
        action: "unknown",
        answeredAt,
        error: "handleCallback failed: bot token is missing",
      };
    }
    if (!normalizedCallbackQueryId) {
      return {
        ok: false,
        action: "unknown",
        answeredAt,
        error: "handleCallback failed: callback query id is missing",
      };
    }

    const normalizedCallbackData = asOptionalString(callbackData);
    if (!normalizedCallbackData) {
      return {
        ok: false,
        action: "unknown",
        answeredAt,
        error: "handleCallback failed: callback data is missing",
      };
    }

    const actionDefinition = toActionDefinition(normalizedCallbackData);
    try {
      await this.answerCallbackQuery(normalizedCallbackQueryId, actionDefinition.answerText);

      if (!actionDefinition.appendedLabel) {
        return {
          ok: true,
          action: actionDefinition.action,
          answeredAt,
        };
      }

      const context = this.resolveMessageContext(normalizedCallbackQueryId, messageId);
      const resolvedMessageId = messageId ?? context?.messageId;
      if (!resolvedMessageId) {
        return {
          ok: false,
          action: actionDefinition.action,
          answeredAt,
          error: "handleCallback failed: message id is missing",
        };
      }

      const resolvedChatId = asOptionalString(context?.chatId) ?? this.defaultChatId;
      if (!resolvedChatId) {
        return {
          ok: false,
          action: actionDefinition.action,
          answeredAt,
          error: "handleCallback failed: chat id is missing",
        };
      }

      const originalText = asOptionalString(context?.originalText);
      if (!originalText) {
        return {
          ok: false,
          action: actionDefinition.action,
          answeredAt,
          error: "handleCallback failed: original message text is missing",
        };
      }

      const updatedText = appendStatusLabel(originalText, actionDefinition.appendedLabel);
      await this.editMessageText(resolvedChatId, resolvedMessageId, updatedText);
      this.storeMessageContext(normalizedCallbackQueryId, {
        chatId: resolvedChatId,
        messageId: resolvedMessageId,
        originalText: updatedText,
      });

      return {
        ok: true,
        action: actionDefinition.action,
        answeredAt,
      };
    } catch (error) {
      return {
        ok: false,
        action: actionDefinition.action,
        answeredAt,
        error: errorMessage("handleCallback failed", error),
      };
    }
  }

  startPolling(onCallback: (data: CallbackEvent) => void): void {
    if (this.polling || !this.botToken) {
      return;
    }

    this.polling = true;
    void this.pollLoop(onCallback);
  }

  stopPolling(): void {
    this.polling = false;
    this.pollAbortController?.abort();
    this.pollAbortController = undefined;
  }

  private async pollLoop(onCallback: (data: CallbackEvent) => void): Promise<void> {
    while (this.polling) {
      const abortController = new AbortController();
      this.pollAbortController = abortController;

      try {
        const updates = await this.getUpdates(abortController.signal);
        for (const update of updates) {
          const updateId = typeof update.update_id === "number" ? update.update_id : undefined;
          if (typeof updateId === "number") {
            this.nextUpdateOffset = updateId + 1;
          }

          const event = this.toCallbackEvent(update.callback_query);
          if (!event) {
            continue;
          }

          this.storeMessageContext(event.callbackQueryId, {
            chatId: typeof event.chatId === "number" ? String(event.chatId) : this.defaultChatId,
            messageId: event.messageId,
            originalText: this.toMessageText(update.callback_query?.message),
          });
          onCallback(event);
        }
      } catch (error) {
        if (!this.polling || this.isAbortError(error)) {
          break;
        }
        await delay(POLL_RETRY_DELAY_MS);
      } finally {
        if (this.pollAbortController === abortController) {
          this.pollAbortController = undefined;
        }
      }
    }
  }

  private resolveMessageContext(callbackQueryId: string, messageId?: number): StoredMessageContext | undefined {
    const callbackContext = this.callbackContexts.get(callbackQueryId);
    if (callbackContext) {
      return callbackContext;
    }
    if (typeof messageId === "number") {
      return this.messageContexts.get(messageId);
    }
    return undefined;
  }

  private storeMessageContext(callbackQueryId: string, context: StoredMessageContext): void {
    this.callbackContexts.set(callbackQueryId, context);
    if (typeof context.messageId === "number") {
      this.messageContexts.set(context.messageId, context);
    }
  }

  private toCallbackEvent(callbackQuery?: TelegramCallbackQuery): CallbackEvent | undefined {
    const callbackQueryId = asOptionalString(callbackQuery?.id);
    const callbackData = asOptionalString(callbackQuery?.data);
    if (!callbackQueryId || !callbackData) {
      return undefined;
    }

    return {
      callbackQueryId,
      callbackData,
      messageId: asMessageId(callbackQuery?.message?.message_id),
      chatId: asChatId(callbackQuery?.message?.chat?.id),
      fromUserId: asChatId(callbackQuery?.from?.id),
    };
  }

  private toMessageText(message?: TelegramCallbackQuery["message"]): string | undefined {
    return asOptionalString(message?.text) ?? asOptionalString(message?.caption);
  }

  private async getUpdates(signal: AbortSignal): Promise<TelegramUpdate[]> {
    const response = await fetch(this.apiUrl("getUpdates"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeout: POLL_TIMEOUT_SECONDS,
        offset: this.nextUpdateOffset,
        allowed_updates: ["callback_query"],
      }),
      signal,
    });

    const payload = await this.readPayload<TelegramUpdateResponse>(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(this.apiError("getUpdates", response, payload));
    }

    return Array.isArray(payload?.result) ? payload.result : [];
  }

  private async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    const response = await fetch(this.apiUrl("answerCallbackQuery"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });

    const payload = await this.readPayload(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(this.apiError("answerCallbackQuery", response, payload));
    }
  }

  private async editMessageText(chatId: string, messageId: number, text: string): Promise<void> {
    const response = await fetch(this.apiUrl("editMessageText"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
      }),
    });

    const payload = await this.readPayload(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(this.apiError("editMessageText", response, payload));
    }
  }

  private async readPayload<T extends TelegramApiResponse>(response: Response): Promise<T | null> {
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  private apiError(operation: string, response: Response, payload: TelegramApiResponse | null): string {
    const description = asOptionalString(payload?.description);
    if (description) {
      return `${operation} failed: ${description}`;
    }

    const status = `${response.status} ${response.statusText}`.trim();
    return `${operation} failed: ${status || "unknown response"}`;
  }

  private apiUrl(method: "answerCallbackQuery" | "editMessageText" | "getUpdates"): string {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
