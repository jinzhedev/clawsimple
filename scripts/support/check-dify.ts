import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { createDifyBackend } from "../../src/lib/support/dify-backend";

class CheckError extends Error {}

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    chat: { type: "boolean", default: false },
  },
});
config({ path: values.env ?? [".env.local", ".env"], quiet: true });

async function main() {
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
      const required = (body.user_input_form ?? []).some(
        (item: Record<string, { required?: boolean }>) =>
          Object.values(item).some((field) => field?.required),
      );
      if (required)
        throw new CheckError("应用包含必填 inputs，当前适配器无法调用");
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
  if (!values.chat) return;
  const backend = createDifyBackend(base, key);
  const visitorId = `support-check-${randomUUID()}`;
  const first = await backend.chat({
    query: "你好，请用一句话说明你能提供什么客服帮助。",
    visitorId,
    signal: AbortSignal.timeout(45_000),
  });
  const second = await backend.chat({
    query: "谢谢，请用一句话告诉我下一步。",
    visitorId,
    conversationId: first.conversationId,
    signal: AbortSignal.timeout(45_000),
  });
  if (second.conversationId !== first.conversationId) {
    throw new CheckError("续聊返回了不同的会话 ID");
  }
  console.log("首次问答与续聊: 通过（已产生模型调用）");
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
