import { describe, expect, it } from "vitest";
import {
  allowsLegacyFallback,
  getLocalSupportedProtocols,
  isLegacyOnlyProtocolSet,
  negotiateProtocolVersion,
  supportsEnvelopeV2,
} from "../src/skills/alphaos/runtime/agent-comm/protocol-negotiation";

describe("agent-comm protocol negotiation", () => {
  it("advertises v2 first with legacy fallback available locally", () => {
    expect(getLocalSupportedProtocols()).toEqual(["agent-comm/2", "agent-comm/1"]);
  });

  it("detects legacy-only protocol sets", () => {
    expect(isLegacyOnlyProtocolSet(["agent-comm/1"])).toBe(true);
    expect(isLegacyOnlyProtocolSet(["agent-comm/2", "agent-comm/1"])).toBe(false);
    expect(supportsEnvelopeV2(["agent-comm/2"])).toBe(true);
    expect(allowsLegacyFallback(["agent-comm/2"])).toBe(false);
    expect(allowsLegacyFallback(["agent-comm/1"])).toBe(true);
  });

  it("prefers the highest mutual protocol version", () => {
    expect(negotiateProtocolVersion(["agent-comm/2", "agent-comm/1"])).toEqual({
      protocol: "agent-comm/2",
      envelopeVersion: 2,
      legacyFallback: false,
    });
    expect(negotiateProtocolVersion(["agent-comm/1"])).toEqual({
      protocol: "agent-comm/1",
      envelopeVersion: 1,
      legacyFallback: true,
    });
  });

  it("fails when there is no mutual protocol version", () => {
    expect(() => negotiateProtocolVersion(["agent-comm/1"], ["agent-comm/2"]))
      .toThrow("No mutually supported agent-comm protocol version");
  });
});
