// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { normalizeSupportIp, supportClientIp } from "./rate-limit";

afterEach(() => vi.unstubAllEnvs());

it("canonicalizes IPv6 and groups rotating addresses in the same /64", () => {
  expect(normalizeSupportIp("2001:0DB8:0001:0002::1")).toBe(
    "2001:db8:1:2::/64",
  );
  expect(normalizeSupportIp("2001:db8:1:2::ffff")).toBe("2001:db8:1:2::/64");
  expect(normalizeSupportIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
  expect(normalizeSupportIp("192.0.2.1")).toBe("192.0.2.1");
  expect(normalizeSupportIp("::1")).toBe("0:0:0:0::/64");
  expect(normalizeSupportIp("192.0.2.1, 192.0.2.2")).toBeNull();
  expect(normalizeSupportIp("fe80::1%eth0")).toBeNull();
});

it("uses only the platform IP header on Vercel", () => {
  vi.stubEnv("VERCEL", "1");
  const headers = new Headers({
    "x-forwarded-for": "192.0.2.1",
    "cf-connecting-ip": "192.0.2.2",
    "x-real-ip": "192.0.2.3",
  });
  expect(supportClientIp(headers)).toBe("192.0.2.1");
  headers.delete("x-forwarded-for");
  expect(() => supportClientIp(headers)).toThrow();
});

it("requires an explicitly trusted proxy outside Vercel in production", () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUPPORT_CHAT_TRUSTED_IP_HEADER", "");
  const headers = new Headers({ "x-real-ip": "192.0.2.1" });
  expect(() => supportClientIp(headers)).toThrow();
  vi.stubEnv("SUPPORT_CHAT_TRUSTED_IP_HEADER", "x-real-ip");
  expect(supportClientIp(headers)).toBe("192.0.2.1");
});
