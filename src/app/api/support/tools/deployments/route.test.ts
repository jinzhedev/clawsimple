// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
const consume = vi.hoisted(() => vi.fn());
vi.mock("@/lib/support/deployments", () => ({
  listAuthorizedDeployments: consume,
}));
const request = (authorization = `Bearer ${"a".repeat(43)}`) =>
  new Request("https://site.test/api/support/tools/deployments", {
    method: "POST",
    headers: { authorization },
  });
beforeEach(() => {
  vi.stubEnv("SUPPORT_CHAT_PUBLIC_ENABLED", "true");
  consume.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it("returns login_required as a readable tool result, not an empty list", async () => {
  consume.mockResolvedValue({ status: "login_required" });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "login_required" });
  expect(consume).toHaveBeenCalledWith("a".repeat(43));
});
it("rejects missing bearer and expired grants", async () => {
  expect((await POST(request("bad"))).status).toBe(401);
  expect(consume).not.toHaveBeenCalled();
  consume.mockResolvedValue({ status: "authorization_expired" });
  expect((await POST(request())).status).toBe(401);
});
it("fails closed without exposing database errors", async () => {
  consume.mockRejectedValue(new Error("private database details"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  vi.stubEnv("SUPPORT_CHAT_PUBLIC_ENABLED", "false");
  consume.mockClear();
  expect((await POST(request())).status).toBe(503);
  expect(consume).not.toHaveBeenCalled();
});
