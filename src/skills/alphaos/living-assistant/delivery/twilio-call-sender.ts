export interface TwilioCallConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  defaultToNumber: string;
}

export interface TwilioCallResult {
  ok: boolean;
  callSid?: string;
  error?: string;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getCallSid(payload: Record<string, unknown> | null): string | undefined {
  return (
    asString(payload?.sid) ??
    asString(payload?.callSid) ??
    asString(payload?.CallSid) ??
    asString(payload?.call_sid)
  );
}

export class TwilioCallSender {
  constructor(private config: TwilioCallConfig) {}

  async callWithTts(
    text: string,
    options?: {
      toNumber?: string;
      language?: string;
      voice?: string;
    },
  ): Promise<TwilioCallResult> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return { ok: false, error: "callWithTts failed: text is empty" };
    }

    const language = optionalText(options?.language) ?? "zh-CN";
    const voice = optionalText(options?.voice);
    const attributes = [`language="${escapeXml(language)}"`];
    if (voice) {
      attributes.push(`voice="${escapeXml(voice)}"`);
    }
    const twiml = `<Response><Say ${attributes.join(" ")}>${escapeXml(normalizedText)}</Say></Response>`;

    return this.createCall(twiml, options?.toNumber, "callWithTts");
  }

  async callWithAudio(
    audioUrl: string,
    options?: {
      toNumber?: string;
    },
  ): Promise<TwilioCallResult> {
    const normalizedUrl = audioUrl.trim();
    if (!normalizedUrl) {
      return { ok: false, error: "callWithAudio failed: audioUrl is empty" };
    }

    const twiml = `<Response><Play>${escapeXml(normalizedUrl)}</Play></Response>`;
    return this.createCall(twiml, options?.toNumber, "callWithAudio");
  }

  private async createCall(
    twiml: string,
    overrideToNumber: string | undefined,
    operation: "callWithTts" | "callWithAudio",
  ): Promise<TwilioCallResult> {
    const accountSid = this.config.accountSid.trim();
    const authToken = this.config.authToken.trim();
    const fromNumber = this.config.fromNumber.trim();
    const toNumber = (overrideToNumber ?? this.config.defaultToNumber).trim();

    if (!accountSid || !authToken) {
      return { ok: false, error: `${operation} failed: Twilio credentials are missing` };
    }
    if (!fromNumber || !toNumber) {
      return { ok: false, error: `${operation} failed: phone number is missing` };
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64");

    const body = new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Twiml: twiml,
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const payload = await this.readJson(response);
      const callSid = getCallSid(payload);
      if (response.ok && callSid) {
        return { ok: true, callSid };
      }

      const message = optionalText(payload?.message) ?? optionalText(payload?.Message);
      const status = `${response.status} ${response.statusText}`.trim();
      return {
        ok: false,
        error: `${operation} failed: ${(message ?? status) || "unknown response"}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: asError(`${operation} failed`, error),
      };
    }
  }

  private async readJson(response: Response): Promise<Record<string, unknown> | null> {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
