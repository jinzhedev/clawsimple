import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

class CheckError extends Error {}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      chat: { type: "boolean", default: false },
      "headers-file": { type: "string" },
    },
  });
  if (!values.url) throw new CheckError("请用 --url 指定网站地址");
  const site = new URL(values.url);
  if (
    !["http:", "https:"].includes(site.protocol) ||
    site.username ||
    site.password ||
    site.search ||
    site.hash ||
    site.pathname !== "/"
  )
    throw new CheckError("--url 必须是不含路径、凭据或查询参数的网站地址");
  const headers = new Headers();
  if (values["headers-file"]) {
    const extra: unknown = JSON.parse(
      readFileSync(values["headers-file"], "utf8"),
    );
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
      throw new CheckError("请求头文件必须是 JSON 对象");
    }
    for (const [name, value] of Object.entries(extra)) {
      if (
        typeof value !== "string" ||
        /^(origin|cookie|host|content-type|content-length)$/i.test(name)
      ) {
        throw new CheckError("请求头文件含无效或由检查脚本管理的字段");
      }
      headers.set(name, value);
    }
  }
  headers.set("Content-Type", "application/json");

  async function request(body: object, cookie?: string, origin = site.origin) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Origin", origin);
    if (cookie) requestHeaders.set("Cookie", cookie);
    const response = await fetch(new URL("/api/support/chat", site), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(55_000),
    });
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new CheckError(`客服接口未返回 JSON 对象：HTTP ${response.status}`);
    }
    return { response, data: data as Record<string, unknown> };
  }

  const foreignOrigin =
    site.origin === "https://untrusted.example"
      ? "https://other.example"
      : "https://untrusted.example";
  const foreign = await request({ query: "Hello" }, undefined, foreignOrigin);
  if (foreign.response.status !== 403 || foreign.data.error !== "forbidden") {
    throw new CheckError(
      `来源校验失败：HTTP ${foreign.response.status}（请确认客服已开启）`,
    );
  }
  const empty = await request({ query: "" });
  if (empty.response.status !== 400 || empty.data.error !== "invalid_request") {
    throw new CheckError(`输入校验失败：HTTP ${empty.response.status}`);
  }
  console.log("来源与输入校验: 通过");
  if (!values.chat) return;

  function checkReply(result: Awaited<ReturnType<typeof request>>) {
    if (
      result.response.status !== 200 ||
      typeof result.data.answer !== "string" ||
      !result.data.answer.trim() ||
      typeof result.data.conversationId !== "string" ||
      !result.data.conversationId
    ) {
      throw new CheckError(`问答失败：HTTP ${result.response.status}`);
    }
  }
  const first = await request({
    query: "你好，请用一句话说明你能提供什么客服帮助。",
  });
  checkReply(first);
  const cookies = first.response.headers.getSetCookie();
  const cookie = cookies.map((value) => value.split(";", 1)[0]).join("; ");
  if (!cookie) throw new CheckError("首次回复没有设置访客 cookie");
  const second = await request(
    {
      query: "谢谢，请用一句话告诉我下一步。",
      conversationId: first.data.conversationId,
    },
    cookie,
  );
  checkReply(second);
  if (second.data.conversationId !== first.data.conversationId) {
    throw new CheckError("续聊返回了不同的会话 ID");
  }
  console.log("首次问答与续聊: 通过（已产生模型调用）");

  const isolated = await request({
    query: "上一轮我问了什么？",
    conversationId: first.data.conversationId,
  });
  if (
    [401, 403, 404, 409].includes(isolated.response.status) &&
    !isolated.data.answer
  ) {
    console.log("跨访客续聊: 已拒绝");
  } else if (
    isolated.response.status === 502 &&
    isolated.data.error === "unavailable"
  ) {
    console.log(
      "跨访客续聊: 未成功；502 无法区分权限拒绝与上游故障，需核对服务端日志",
    );
    process.exitCode = 2;
  } else {
    throw new CheckError(
      `跨访客续聊未得到明确拒绝：HTTP ${isolated.response.status}`,
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof CheckError
      ? error.message
      : "检查失败，请检查地址、访问认证、网络和响应格式",
  );
  process.exitCode = 1;
});
