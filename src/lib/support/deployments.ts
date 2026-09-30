import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { installSessions, session } from "@/lib/db/schema";
import { readDeploymentGrant } from "./security";

export async function listAuthorizedDeployments(grant: string) {
  const authorization = readDeploymentGrant(grant);
  if (!authorization) return { status: "authorization_expired" as const };
  if (!authorization.sessionId) return { status: "login_required" as const };
  // The live session determines ownership; neither the model nor its arguments do.
  const rows = await db
    .select({
      deploymentId: installSessions.id,
      name: installSessions.displayName,
      status: installSessions.status,
      createdAt: installSessions.createdAt,
      completedAt: installSessions.completedAt,
    })
    .from(session)
    .leftJoin(installSessions, eq(installSessions.userId, session.userId))
    .where(
      and(
        eq(session.id, authorization.sessionId),
        gt(session.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(installSessions.createdAt))
    .limit(21);
  if (!rows.length) return { status: "authorization_expired" as const };
  const deployments = rows.filter((row) => row.deploymentId !== null);
  return {
    status: "ok" as const,
    deployments: deployments.slice(0, 20).map((row) => ({
      name: (row.name ?? "Unnamed deployment").slice(0, 100),
      status: row.status,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    })),
    hasMore: deployments.length > 20,
    dashboardPath: "/profile",
    stateSource: "product_record_not_live_health",
  };
}
