// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listAuthorizedDeployments } from "./deployments";
import { signDeploymentGrant } from "./security";
const mocks = vi.hoisted(() => ({ select: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));
beforeEach(() => {
  vi.stubEnv("SUPPORT_CHAT_SESSION_SECRET", "test-secret".repeat(4));
  const chain = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: mocks.limit,
  };
  for (const fn of [chain.from, chain.leftJoin, chain.where, chain.orderBy])
    fn.mockReturnValue(chain);
  mocks.select.mockReset().mockReturnValue(chain);
  mocks.limit.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
it("rejects invalid tokens and handles anonymous requests without querying deployments", async () => {
  expect(await listAuthorizedDeployments("invalid")).toEqual({
    status: "authorization_expired",
  });
  expect(await listAuthorizedDeployments(signDeploymentGrant())).toEqual({
    status: "login_required",
  });
  expect(mocks.select).not.toHaveBeenCalled();
});
it("rejects a deleted or expired session even while the grant is valid", async () => {
  expect(
    await listAuthorizedDeployments(signDeploymentGrant("expired-session")),
  ).toEqual({ status: "authorization_expired" });
});
it("distinguishes an empty account from an invalid session", async () => {
  mocks.limit.mockResolvedValue([{ deploymentId: null }]);
  expect(
    await listAuthorizedDeployments(signDeploymentGrant("active-session")),
  ).toMatchObject({ status: "ok", deployments: [], hasMore: false });
});
it("returns bounded public fields without ids or internal fields", async () => {
  mocks.limit.mockResolvedValue(
    Array.from({ length: 21 }, (_, i) => ({
      deploymentId: String(i),
      name: "n".repeat(200),
      status: "completed",
      createdAt: null,
      completedAt: null,
      secret: "hidden",
    })),
  );
  const result = await listAuthorizedDeployments(
    signDeploymentGrant("active-session"),
  );
  expect(result).toMatchObject({ status: "ok", hasMore: true });
  if (result.status !== "ok") throw new Error("Expected authorized result");
  expect(result.deployments).toHaveLength(20);
  expect(result.deployments[0].name).toHaveLength(100);
  expect(result.deployments[0]).not.toHaveProperty("secret");
  expect(result.deployments[0]).not.toHaveProperty("deploymentId");
});
