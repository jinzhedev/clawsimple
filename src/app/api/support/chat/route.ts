import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SupportBackendError } from "@/lib/support/backend";
import { isSupportChatEnabled } from "@/lib/support/config";
import { getSupportBackend } from "@/lib/support/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cookieName = "support_visitor";
const buckets = new Map<string, { count: number; expires: number }>();

function signature(id: string, secret: string) {
  return createHmac("sha256", secret).update(id).digest("hex");
}

function visitor(cookie: string | undefined, secret: string) {
  const [id, sig] = (cookie ?? "").split(".");
  if (/^[a-f0-9-]{36}$/.test(id ?? "") && /^[a-f0-9]{64}$/.test(sig ?? "")) {
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(signature(id, secret))))
      return id;
  }
  return randomUUID();
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const reply = (body: object, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  if (!isSupportChatEnabled()) return reply({ error: "unavailable" }, 503);
  const backend = getSupportBackend();
  const secret = process.env.SUPPORT_CHAT_SESSION_SECRET;
  if (!backend || !secret) return reply({ error: "unavailable" }, 503);
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return reply({ error: "forbidden" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reply({ error: "invalid_request" }, 415);
  let body: { query?: unknown; conversationId?: unknown };
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "invalid_request" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return reply({ error: "too_large" }, 413);
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
  if (
    typeof body.query !== "string" ||
    !body.query.trim() ||
    body.query.length > 2000 ||
    (body.conversationId !== undefined &&
      (typeof body.conversationId !== "string" ||
        !body.conversationId ||
        body.conversationId.length > 256 ||
        /[\x00-\x20\x7f]/.test(body.conversationId)))
  )
    return reply({ error: "invalid_request" }, 400);
  const user = visitor(request.cookies.get(cookieName)?.value, secret);
  const now = Date.now();
  for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
  // Local defense only; the edge policy must cover all Vercel instances.
  const bucket = buckets.get(user) ?? { count: 0, expires: now + 60_000 };
  if (bucket.count >= 10 || buckets.size > 10000)
    return reply({ error: "rate_limited" }, 429);
  bucket.count++;
  buckets.set(user, bucket);
  let status = 502;
  try {
    const result = await backend.chat({
      query: body.query.trim(),
      conversationId: body.conversationId as string | undefined,
      visitorId: user,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    });
    status = 200;
    const response = reply(result, 200);
    response.cookies.set(cookieName, `${user}.${signature(user, secret)}`, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/support",
      maxAge: 86400,
    });
    return response;
  } catch (error) {
    status = error instanceof SupportBackendError ? error.status : 502;
    return reply(
      { error: status === 429 ? "rate_limited" : "unavailable" },
      status,
    );
  } finally {
    process.stdout.write(
      JSON.stringify({
        event: "support_chat",
        request_id: requestId,
        status,
        duration_ms: Date.now() - startedAt,
      }) + "\n",
    );
  }
}
