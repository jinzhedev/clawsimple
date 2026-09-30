// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  gatewayDifferences,
  policySchema,
  syncGatewayPolicy,
} from "../../../scripts/support/gateway-policy";
const policy = policySchema.parse(
  JSON.parse(readFileSync("support/gateway/policy.json", "utf8")),
);
it("ignores unmanaged fields and rule ordering but detects scoped or extra budgets", () => {
  const remote = structuredClone(policy);
  remote.spend_limits.rules.reverse();
  expect(
    gatewayDifferences(policy, { ...remote, id: "test", created_at: "date" }),
  ).toEqual([]);
  expect(
    gatewayDifferences(policy, {
      ...remote,
      spend_limits: {
        ...remote.spend_limits,
        rules: [
          ...remote.spend_limits.rules,
          { ...remote.spend_limits.rules[0], id: "extra" },
        ],
      },
    }),
  ).toEqual(["spend_limits"]);
  expect(
    gatewayDifferences(policy, {
      ...remote,
      spend_limits: {
        ...remote.spend_limits,
        rules: remote.spend_limits.rules.map((r) => ({
          ...r,
          metadata: { user: { mode: "partition" } },
        })),
      },
    }),
  ).toEqual(["spend_limits"]);
});
it("check mode never mutates and apply skips identical settings", async () => {
  const run = vi.fn().mockResolvedValue({ ...policy, collect_logs: true });
  expect((await syncGatewayPolicy(policy, false, run)).differences).toEqual([
    "collect_logs",
  ]);
  expect(run.mock.calls).toEqual([["get"]]);
  run.mockReset().mockResolvedValue(policy);
  expect((await syncGatewayPolicy(policy, true, run)).applied).toBe(false);
  expect(run.mock.calls).toEqual([["get"]]);
});
it("updates only after dry-run and verifies with a fresh read", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ ...policy, rate_limiting_limit: 99 })
    .mockResolvedValueOnce({ method: "PUT", body: policy })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(policy);
  expect((await syncGatewayPolicy(policy, true, run)).applied).toBe(true);
  expect(run.mock.calls).toEqual([["get"], ["preview"], ["update"], ["get"]]);
});
it("does not write when CLI omits the nested budget rules", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      method: "PUT",
      body: { ...policy, spend_limits: { enabled: true } },
    });
  await expect(syncGatewayPolicy(policy, true, run)).rejects.toThrow(
    "未执行更新",
  );
  expect(run).toHaveBeenCalledTimes(2);
});
it("fails verification when the API ignores an update", async () => {
  const remote = { ...policy, collect_logs: true };
  const run = vi
    .fn()
    .mockResolvedValueOnce(remote)
    .mockResolvedValueOnce({ method: "PUT", body: policy })
    .mockResolvedValueOnce(policy)
    .mockResolvedValueOnce(remote);
  await expect(syncGatewayPolicy(policy, true, run)).rejects.toThrow(
    "collect_logs",
  );
});
it("rejects misspelled fields, negative budgets and duplicate IDs", () => {
  expect(policySchema.safeParse({ ...policy, spend_limit: {} }).success).toBe(
    false,
  );
  expect(
    policySchema.safeParse({
      ...policy,
      spend_limits: {
        enabled: true,
        rules: [{ ...policy.spend_limits.rules[0], limit: -1 }],
      },
    }).success,
  ).toBe(false);
  expect(
    policySchema.safeParse({
      ...policy,
      spend_limits: {
        enabled: true,
        rules: [policy.spend_limits.rules[0], policy.spend_limits.rules[0]],
      },
    }).success,
  ).toBe(false);
});
