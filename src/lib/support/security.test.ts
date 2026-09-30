// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readDeploymentGrant,
  signDeploymentGrant,
  signConversation,
  supportHash,
} from "./security";

beforeEach(() => {
  vi.stubEnv("SUPPORT_CHAT_SESSION_SECRET", "test-secret".repeat(4));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("binds only the server-selected session and permits read-only replay during its TTL", () => {
  const token = signDeploymentGrant("session-a");
  expect(readDeploymentGrant(token)).toEqual({ sessionId: "session-a" });
  expect(readDeploymentGrant(token)).toEqual({ sessionId: "session-a" });
  expect(readDeploymentGrant(signDeploymentGrant())).toEqual({
    sessionId: null,
  });
});
it("rejects tampering, wrong purpose, malformed input, and expiration", () => {
  const token = signDeploymentGrant("session-a");
  for (const invalid of [
    token + "x",
    token + ".extra",
    "x.y",
    "x".repeat(2049),
    signConversation("id", "binding"),
  ])
    expect(readDeploymentGrant(invalid)).toBeNull();
  vi.advanceTimersByTime(120_000);
  expect(readDeploymentGrant(token)).toBeNull();
});
it("rejects signed payloads with invalid scope, session or lifetime", () => {
  for (const override of [
    { scope: "admin" },
    { sessionId: 42 },
    { sessionId: "" },
    { expires: Date.now() + 120001 },
    { expires: "future" },
  ]) {
    const data = Buffer.from(
      JSON.stringify({
        scope: "support:deployments:read",
        sessionId: "s",
        expires: Date.now() + 120000,
        ...override,
      }),
    ).toString("base64url");
    expect(
      readDeploymentGrant(`${data}.${supportHash(`deployment:${data}`)}`),
    ).toBeNull();
  }
});
it("fails closed without a signing secret", () => {
  vi.stubEnv("SUPPORT_CHAT_SESSION_SECRET", "");
  expect(() => signDeploymentGrant("s")).toThrow();
});
