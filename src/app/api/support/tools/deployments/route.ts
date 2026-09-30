import { isSupportChatEnabled } from "@/config/support";
import { listAuthorizedDeployments } from "@/lib/support/deployments";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const reply = (body: object, status: number) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isSupportChatEnabled()) return reply({ status: "unavailable" }, 503);
  const header = request.headers.get("authorization");
  const grant = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!grant || grant.length > 2048)
    return reply({ status: "authorization_expired" }, 401);
  try {
    const result = await listAuthorizedDeployments(grant);
    return reply(result, result.status === "authorization_expired" ? 401 : 200);
  } catch {
    return reply({ status: "unavailable" }, 503);
  }
}
