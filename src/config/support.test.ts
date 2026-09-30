import { afterEach, expect, it, vi } from "vitest";
import { getSupportInputLimits } from "./support";

afterEach(() => vi.unstubAllEnvs());

it.each([
  undefined,
  "",
  "0",
  "-1",
  "1.5",
  "10bytes",
  "Infinity",
  "9007199254740992",
])("uses safe defaults for invalid input limits: %s", (value) => {
  vi.stubEnv("SUPPORT_CHAT_MAX_QUERY_LENGTH", value);
  vi.stubEnv("SUPPORT_CHAT_MAX_BODY_BYTES", value);
  expect(getSupportInputLimits()).toEqual({
    queryCodeUnits: 2000,
    bodyBytes: 8192,
  });
});

it("reads both limits from server configuration", () => {
  vi.stubEnv("SUPPORT_CHAT_MAX_QUERY_LENGTH", "4000");
  vi.stubEnv("SUPPORT_CHAT_MAX_BODY_BYTES", "32768");
  expect(getSupportInputLimits()).toEqual({
    queryCodeUnits: 4000,
    bodyBytes: 32768,
  });
});
