import { parseArgs } from "node:util";
import { config } from "dotenv";

class CheckError extends Error {}

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    chat: { type: "boolean", default: false },
  },
});
config({ path: values.env ?? [".env.local", ".env"], quiet: true });

async function main() {
  if (values.chat)
    throw new CheckError(
      "聊天验证请使用 check.ts --url <网站地址> --chat，确保经过网站身份校验",
    );
  const base = process.env.DIFY_API_URL?.trim().replace(/\/$/, "");
  const key = process.env.DIFY_API_KEY?.trim();
  if (!base || !key) throw new CheckError("缺少 DIFY_API_URL 或 DIFY_API_KEY");
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new CheckError("DIFY_API_URL 必须是不含凭据的 HTTP(S) 地址");
  }
  for (const path of ["/info", "/parameters"]) {
    const response = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new CheckError(`${path}: HTTP ${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== "object")
      throw new CheckError(`${path}: 无效 JSON`);
    if (path === "/parameters") {
      const fields = (body.user_input_form ?? []).flatMap(
        (item: Record<string, { required?: boolean; variable?: string }>) =>
          Object.values(item),
      );
      const expected = ["deployment_grant"];
      if (
        expected.some(
          (name) =>
            !fields.some(
              (field: { variable?: string; required?: boolean }) =>
                field.variable === name && field.required,
            ),
        ) ||
        fields.some(
          (field: { variable?: string; required?: boolean }) =>
            field.required && !expected.includes(field.variable ?? ""),
        )
      )
        throw new CheckError("应用 inputs 不符合客服 Agent 契约");
    }
    console.log(`${path}: 认证与连接通过`);
  }
  const denied = await fetch(`${base}/info`, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (![401, 403].includes(denied.status)) {
    throw new CheckError(`无凭据访问未被拒绝: HTTP ${denied.status}`);
  }
  console.log("无凭据访问: 已拒绝");
}

main().catch((error) => {
  // Do not print upstream bodies, URLs, credentials, or network error causes.
  const message =
    error instanceof CheckError
      ? error.message
      : "连接失败，请检查网络和服务端配置";
  console.error(message);
  process.exitCode = 1;
});
