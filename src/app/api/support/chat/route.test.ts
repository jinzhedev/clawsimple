// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { cleanDifyAnswer } from "@/lib/support/dify-answer";
const upstream = vi.fn();
function request(
  body: unknown,
  cookie?: string,
  origin = "http://localhost:3000",
) {
  return new NextRequest("http://localhost:3000/api/support/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("SUPPORT_CHAT_PUBLIC_ENABLED", "true");
  vi.stubEnv("DIFY_API_URL", "http://dify.test/v1");
  vi.stubEnv("DIFY_API_KEY", "private-key");
  vi.stubEnv("SUPPORT_CHAT_SESSION_SECRET", "test-secret");
  vi.stubGlobal("fetch", upstream);
  upstream.mockReset();
  upstream.mockImplementation(() =>
    Response.json({
      answer: "<think>hidden reasoning</think>Hello",
      conversation_id: "12345678-1234-1234-1234-123456789abc",
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Dify support boundary", () => {
  it("keeps credentials and reasoning server-side and signs the visitor cookie", async () => {
    const response = await POST(request({ query: "Hello" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      answer: "Hello",
      conversationId: "12345678-1234-1234-1234-123456789abc",
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(upstream.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer private-key",
    );
  });
  it("reuses signed identity but rejects forged identity", async () => {
    const first = await POST(request({ query: "Hello" }));
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    const user = JSON.parse(upstream.mock.calls[0][1].body).user;
    await POST(request({ query: "Again" }, cookie));
    expect(JSON.parse(upstream.mock.calls[1][1].body).user).toBe(user);
    await POST(request({ query: "Again" }, cookie + "f"));
    expect(JSON.parse(upstream.mock.calls[2][1].body).user).not.toBe(user);
  });
  it("rejects cross-origin requests before contacting Dify", async () => {
    expect(
      (
        await POST(
          request({ query: "Hello" }, undefined, "https://elsewhere.test"),
        )
      ).status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects invalid input and oversized bodies", async () => {
    expect((await POST(request({ query: "" }))).status).toBe(400);
    expect((await POST(request({ query: "x".repeat(9000) }))).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not expose upstream errors or secrets", async () => {
    upstream.mockResolvedValue(
      new Response("private upstream details", { status: 500 }),
    );
    const response = await POST(request({ query: "Hello" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
  it("handles network failure and empty answers", async () => {
    upstream.mockRejectedValueOnce(new Error("private network detail"));
    expect((await POST(request({ query: "Hello" }))).status).toBe(504);
    upstream.mockResolvedValueOnce(
      Response.json({
        answer: "<think>only reasoning</think>",
        conversation_id: "id",
      }),
    );
    expect((await POST(request({ query: "Hello" }))).status).toBe(502);
  });
  it("fails closed in production until rollout is enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPPORT_CHAT_PUBLIC_ENABLED", "");
    expect((await POST(request({ query: "Hello" }))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("can be disabled in development as well", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SUPPORT_CHAT_PUBLIC_ENABLED", "false");
    expect((await POST(request({ query: "Hello" }))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("switches Dify hosts through configuration and preserves conversation identity", async () => {
    vi.stubEnv("DIFY_API_URL", "https://cloud.example.test/v1/");
    const first = await POST(request({ query: "Hello" }));
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    expect(first.headers.get("set-cookie")).toContain("Path=/api/support;");
    await POST(
      request(
        { query: " Continue ", conversationId: "opaque-conversation_123" },
        cookie,
      ),
    );
    expect(upstream.mock.calls[1][0]).toBe(
      "https://cloud.example.test/v1/chat-messages",
    );
    const payload = JSON.parse(upstream.mock.calls[1][1].body);
    expect(payload.query).toBe("Continue");
    expect(payload.conversation_id).toBe("opaque-conversation_123");
    expect(payload.user).toBe(JSON.parse(upstream.mock.calls[0][1].body).user);
    expect(upstream.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("normalizes upstream rate limits and malformed responses", async () => {
    upstream.mockResolvedValueOnce(new Response("secret", { status: 429 }));
    const limited = await POST(request({ query: "Hello" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    upstream.mockResolvedValueOnce(new Response("not json"));
    expect((await POST(request({ query: "Hello" }))).status).toBe(502);
    upstream.mockResolvedValueOnce(Response.json(null));
    expect((await POST(request({ query: "Hello" }))).status).toBe(502);
  });
  it("enforces the visitor limit before calling the backend", async () => {
    const first = await POST(request({ query: "Hello" }));
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    for (let i = 0; i < 9; i++) {
      expect((await POST(request({ query: "Again" }, cookie))).status).toBe(
        200,
      );
    }
    expect((await POST(request({ query: "Again" }, cookie))).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(10);
  });
  it("removes incomplete and multiple reasoning blocks", () => {
    expect(cleanDifyAnswer("<think>hidden")).toBe("");
    expect(cleanDifyAnswer("<think>a</think>Answer<think>b</think>")).toBe(
      "Answer",
    );
  });
});
