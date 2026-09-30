import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import dotenv from "dotenv";
import {
  policySchema,
  syncGatewayPolicy,
  type GatewayRunner,
} from "./gateway-policy";

const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    env: { type: "string" },
    apply: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main() {
  if (values.apply && values["dry-run"])
    throw new Error("--apply 与 --dry-run 不能同时使用");
  const env = {
    ...process.env,
    ...(values.env ? dotenv.parse(readFileSync(values.env)) : {}),
  };
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const gateway = env.SUPPORT_AI_GATEWAY_ID;
  if (!account || !/^[a-f0-9]{32}$/.test(account))
    throw new Error("缺少有效 CLOUDFLARE_ACCOUNT_ID");
  if (!gateway || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(gateway))
    throw new Error("缺少有效 SUPPORT_AI_GATEWAY_ID");
  if (!values["dry-run"] && !env.CLOUDFLARE_API_TOKEN)
    throw new Error("缺少网关管理用 CLOUDFLARE_API_TOKEN");
  const parsed = policySchema.safeParse(
    JSON.parse(readFileSync("support/gateway/policy.json", "utf8")),
  );
  if (!parsed.success)
    throw new Error("policy.json 格式无效，请检查字段、数值与预算规则 ID");
  const policy = parsed.data;
  const directory = mkdtempSync(join(tmpdir(), "support-gateway-"));
  const file = join(directory, "policy.json");
  writeFileSync(file, JSON.stringify(policy), { mode: 0o600 });
  const cf = resolve("node_modules/.bin/cf");
  const run: GatewayRunner = async (operation) => {
    const args = [
      "ai-gateway",
      "gateways",
      operation === "get" ? "get" : "update",
      gateway,
    ];
    if (operation !== "get") args.push("--body", `@${file}`);
    if (operation === "preview") args.push("--dry-run");
    let stdout: string;
    try {
      ({ stdout } = await exec(cf, args, {
        env,
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      }));
    } catch {
      // CLI diagnostics can contain account details or credentials. Do not echo them.
      throw new Error(
        `cf ${operation} 失败；请检查 CLI 安装、网络及网关管理权限。若更新已经发出，请先重新执行只读检查。`,
      );
    }
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(
        "cf 未返回有效 JSON；若更新已经发出，请先重新执行只读检查",
      );
    }
  };
  try {
    if (values["dry-run"]) {
      const preview = (await run("preview")) as {
        method?: string;
        body?: unknown;
        url?: string;
      };
      const expected = `https://api.cloudflare.com/client/v4/accounts/${account}/ai-gateway/gateways/${gateway}`;
      if (
        preview.url !== expected ||
        preview.method !== "PUT" ||
        JSON.stringify(preview.body) !== JSON.stringify(policy)
      )
        throw new Error("cf dry-run 与预期请求不一致");
      console.log(
        "cf dry-run 通过：PUT 请求完整包含 policy 配置，未访问远端网关。",
      );
      return;
    }
    const result = await syncGatewayPolicy(policy, values.apply, run);
    if (!result.differences.length)
      console.log("远端受管字段与 policy 一致，无需更新。");
    else if (result.applied)
      console.log(`已更新并回读确认：${result.differences.join(", ")}`);
    else {
      console.log(
        `发现配置差异：${result.differences.join(", ")}。未写入；使用 --apply 同步。`,
      );
      process.exitCode = 2;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && !("path" in error)
      ? error.message
      : "无法读取配置文件",
  );
  process.exitCode = 1;
});
