import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { SUPPORT_LIMITS } from "@/config/support";
import { supportHash } from "./security";

// IPv6 addresses share a /64 bucket; canonicalize IPv4-mapped IPv6 too.
export function normalizeSupportIp(value: string): string | null {
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6 || value.includes("%")) return null;
  const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const parts =
    right === undefined
      ? head
      : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  const words = parts.map((part) => Number.parseInt(part, 16));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 65535) {
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join(
      ".",
    );
  }
  return (
    words
      .slice(0, 4)
      .map((word) => word.toString(16))
      .join(":") + "::/64"
  );
}

export function supportClientIp(headers: Headers): string {
  // On Vercel this header is overwritten by the platform, not trusted from clients.
  // Self-hosted deployments must configure a proxy that OVERWRITES this header
  // and block direct access to the origin before opting in.
  const header =
    process.env.VERCEL === "1"
      ? "x-forwarded-for"
      : process.env.SUPPORT_CHAT_TRUSTED_IP_HEADER;
  if (!header) {
    if (process.env.NODE_ENV !== "production") return "127.0.0.1";
    throw new Error("Support trusted IP source missing");
  }
  const ip = normalizeSupportIp(headers.get(header)?.trim() ?? "");
  if (!ip) throw new Error("Support trusted IP missing or invalid");
  return ip;
}

export function supportRateLimitQuery(key: string) {
  const { ipRequests, ipWindowSeconds } = SUPPORT_LIMITS;
  return sql`
    WITH cleanup AS (
      DELETE FROM support_rate_limit WHERE key IN (
        SELECT key FROM support_rate_limit
        WHERE expires_at < now() - interval '1 day' AND key <> ${key}
        ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
      )
    )
    INSERT INTO support_rate_limit (key, count, expires_at)
    VALUES (${key}, 1, now() + ${ipWindowSeconds} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN support_rate_limit.expires_at <= now() THEN 1
        ELSE LEAST(support_rate_limit.count + 1, ${ipRequests + 1}) END,
      expires_at = CASE WHEN support_rate_limit.expires_at <= now()
        THEN now() + ${ipWindowSeconds} * interval '1 second'
        ELSE support_rate_limit.expires_at END
    RETURNING count <= ${ipRequests} AS allowed,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::integer AS retry_after
  `;
}

export async function checkSupportIpLimit(headers: Headers) {
  const key = supportHash(`rate:ip:${supportClientIp(headers)}`);
  const { db } = await import("@/lib/db");
  const result = await db.execute<{ allowed: boolean; retry_after: number }>(
    supportRateLimitQuery(key),
  );
  const row = result.rows[0];
  if (!row) throw new Error("Support rate limit unavailable");
  return { allowed: row.allowed, retryAfter: row.retry_after };
}
