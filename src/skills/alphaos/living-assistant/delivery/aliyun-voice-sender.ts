import { createHmac, randomUUID } from "node:crypto";

export interface AliyunVoiceConfig {
  accessKeyId: string;
  accessKeySecret: string;
  calledShowNumber: string;
  defaultCalledNumber: string;
  ttsCode: string;
  endpoint?: string;
}

export interface AliyunVoiceResult {
  ok: boolean;
  callId?: string;
  error?: string;
}

type AliyunPayload = Record<string, unknown>;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asError(prefix: string, error: unknown): string {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: ${String(error)}`;
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");
}

function signQuery(canonical: string, accessKeySecret: string): string {
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
  return createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
}

function pickCallId(payload: AliyunPayload | null): string | undefined {
  return (
    optionalText(payload?.CallId) ??
    optionalText(payload?.callId) ??
    optionalText((payload?.Data as Record<string, unknown> | undefined)?.CallId)
  );
}

function pickMessage(payload: AliyunPayload | null): string | undefined {
  return optionalText(payload?.Message) ?? optionalText(payload?.message);
}

export class AliyunVoiceSender {
  constructor(private config: AliyunVoiceConfig) {}

  async callWithTts(
    ttsParam: Record<string, string>,
    options?: {
      calledNumber?: string;
      ttsCode?: string;
    },
  ): Promise<AliyunVoiceResult> {
    const accessKeyId = trimText(this.config.accessKeyId);
    const accessKeySecret = trimText(this.config.accessKeySecret);
    const calledShowNumber = trimText(this.config.calledShowNumber);
    const calledNumber = trimText(options?.calledNumber ?? this.config.defaultCalledNumber);
    const ttsCode = trimText(options?.ttsCode ?? this.config.ttsCode);
    const endpoint = trimText(this.config.endpoint) || "dyvmsapi.aliyuncs.com";

    if (!accessKeyId || !accessKeySecret) {
      return { ok: false, error: "callWithTts failed: Aliyun access key is missing" };
    }
    if (!calledShowNumber || !calledNumber) {
      return { ok: false, error: "callWithTts failed: called number is missing" };
    }
    if (!ttsCode) {
      return { ok: false, error: "callWithTts failed: TTS template code is missing" };
    }

    const baseParams: Record<string, string> = {
      Action: "SingleCallByTts",
      AccessKeyId: accessKeyId,
      CalledShowNumber: calledShowNumber,
      CalledNumber: calledNumber,
      TtsCode: ttsCode,
      TtsParam: JSON.stringify(ttsParam),
      Format: "JSON",
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: randomUUID(),
      SignatureVersion: "1.0",
      Timestamp: new Date().toISOString(),
      Version: "2017-05-25",
    };

    const canonical = canonicalQuery(baseParams);
    const signature = signQuery(canonical, accessKeySecret);
    const signedQuery = canonicalQuery({
      ...baseParams,
      Signature: signature,
    });

    const url = `https://${endpoint}/?${signedQuery}`;

    try {
      const response = await fetch(url, {
        method: "GET",
      });
      const payload = await this.readJson(response);
      const code = optionalText(payload?.Code);
      const callId = pickCallId(payload);

      if (response.ok && (code === "OK" || !code)) {
        return { ok: true, callId };
      }

      const status = `${response.status} ${response.statusText}`.trim();
      return {
        ok: false,
        error: `callWithTts failed: ${(pickMessage(payload) ?? code ?? status) || "unknown response"}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: asError("callWithTts failed", error),
      };
    }
  }

  private async readJson(response: Response): Promise<AliyunPayload | null> {
    try {
      return (await response.json()) as AliyunPayload;
    } catch {
      return null;
    }
  }
}
