import { isSupportChatEnabled } from "@/config/support";
import { getRequestSession } from "@/lib/auth/session";
import { supportHash } from "@/lib/support/security";

export async function GET(request: Request) {
  if (!isSupportChatEnabled()) return new Response(null, { status: 503 });
  try {
    const session = await getRequestSession(request.headers);
    return Response.json(
      {
        signedIn: !!session,
        identity: session
          ? supportHash(`session:${session.session.id}:${session.user.id}`)
          : "anonymous",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return new Response(null, { status: 503 });
  }
}
