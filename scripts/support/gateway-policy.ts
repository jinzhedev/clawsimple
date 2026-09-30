import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const rule = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean(),
    limitType: z.literal("cost"),
    limit: z.number().positive(),
    window: z.number().int().positive(),
    technique: z.enum(["fixed", "sliding"]),
  })
  .strict();
export const policySchema = z
  .object({
    authentication: z.boolean(),
    byok_only: z.boolean(),
    cache_invalidate_on_update: z.boolean(),
    cache_ttl: z.number().int().nonnegative(),
    collect_logs: z.boolean(),
    rate_limiting_interval: z.number().int().positive(),
    rate_limiting_limit: z.number().int().positive(),
    rate_limiting_technique: z.enum(["fixed", "sliding"]),
    retry_max_attempts: z.number().int().min(1).max(5),
    spend_limits: z
      .object({ enabled: z.boolean(), rules: z.array(rule).min(1) })
      .strict(),
  })
  .strict()
  .refine(
    (p) =>
      new Set(p.spend_limits.rules.map((r) => r.id)).size ===
      p.spend_limits.rules.length,
    "预算规则 ID 不得重复",
  );
export type Policy = z.infer<typeof policySchema>;
export type GatewayRunner = (
  operation: "get" | "preview" | "update",
) => Promise<unknown>;

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(normalize);
    if (items.every((v) => v && typeof v === "object" && "id" in v))
      items.sort((a, b) =>
        String((a as { id: unknown }).id).localeCompare(
          String((b as { id: unknown }).id),
        ),
      );
    return items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

export function gatewayDifferences(policy: Policy, remote: unknown): string[] {
  if (!remote || typeof remote !== "object" || Array.isArray(remote))
    throw new Error("cf 返回的网关配置格式无效");
  const data = remote as Record<string, unknown>;
  // Only compare managed top-level fields. Within spend_limits, extra rules or
  // non-null scoping fields change enforcement and must count as drift.
  return Object.keys(policy).filter(
    (key) =>
      !isDeepStrictEqual(
        normalize(policy[key as keyof Policy]),
        normalize(data[key]),
      ),
  );
}

export async function syncGatewayPolicy(
  policy: Policy,
  apply: boolean,
  run: GatewayRunner,
) {
  const before = await run("get");
  const differences = gatewayDifferences(policy, before);
  if (!apply || !differences.length) return { differences, applied: false };
  const preview = (await run("preview")) as { method?: string; body?: unknown };
  if (preview?.method !== "PUT" || !isDeepStrictEqual(preview.body, policy))
    throw new Error("cf dry-run 请求体与 policy 不一致，未执行更新");
  await run("update");
  const remaining = gatewayDifferences(policy, await run("get"));
  if (remaining.length)
    throw new Error(
      `更新后回读仍不一致：${remaining.join(", ")}。远端可能已部分更新，请检查；未自动回滚。`,
    );
  return { differences, applied: true };
}
