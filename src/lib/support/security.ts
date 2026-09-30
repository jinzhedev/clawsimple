import { createHmac, timingSafeEqual } from "node:crypto";
import { SUPPORT_LIMITS } from "@/config/support";

function secret() {
  const value = process.env.SUPPORT_CHAT_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("Support secret missing");
  return value;
}

export function supportHash(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function matchesSecret(value: string, expected: string) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signDeploymentGrant(sessionId?: string) {
  const data = Buffer.from(
    JSON.stringify({
      scope: "support:deployments:read",
      sessionId: sessionId ?? null,
      expires: Date.now() + SUPPORT_LIMITS.toolGrantSeconds * 1000,
    }),
  ).toString("base64url");
  return `${data}.${supportHash(`deployment:${data}`)}`;
}

export function readDeploymentGrant(
  value: string,
): { sessionId: string | null } | null {
  if (value.length > 2048) return null;
  const [data, signature, extra] = value.split(".");
  if (
    !data ||
    !/^[A-Za-z0-9_-]+$/.test(data) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    extra ||
    !matchesSecret(signature, supportHash(`deployment:${data}`))
  )
    return null;
  try {
    const grant = JSON.parse(Buffer.from(data, "base64url").toString());
    const now = Date.now();
    if (
      grant.scope !== "support:deployments:read" ||
      !Number.isSafeInteger(grant.expires) ||
      grant.expires <= now ||
      grant.expires > now + SUPPORT_LIMITS.toolGrantSeconds * 1000 ||
      (grant.sessionId !== null &&
        (typeof grant.sessionId !== "string" ||
          !grant.sessionId ||
          grant.sessionId.length > 256))
    )
      return null;
    return { sessionId: grant.sessionId };
  } catch {
    return null;
  }
}

export function signConversation(id: string, binding: string) {
  const data = Buffer.from(
    JSON.stringify({ id, binding, expires: Date.now() + 86_400_000 }),
  ).toString("base64url");
  return `${data}.${supportHash(`conversation:${data}`)}`;
}

export function readConversation(
  value: string,
  binding: string,
): string | null {
  const [data, signature, extra] = value.split(".");
  if (
    !data ||
    !signature ||
    extra ||
    !matchesSecret(signature, supportHash(`conversation:${data}`))
  )
    return null;
  try {
    const decoded = JSON.parse(Buffer.from(data, "base64url").toString());
    return decoded.binding === binding &&
      decoded.expires > Date.now() &&
      typeof decoded.id === "string"
      ? decoded.id
      : null;
  } catch {
    return null;
  }
}
