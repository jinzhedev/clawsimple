# Support 客服后端实现与切换指南

首页客服通过本站 `POST /api/support/chat` 调用后端。浏览器不直接访问 Dify，也不持有 Dify、工具或模型凭据。当前只实现 Dify，通过服务端适配器隔离平台协议。

## 请求链路

1. 本站校验 Origin、请求大小和问题，检查共享 IP 限流，再读取真实登录 Session。
2. 签发有效期 120 秒的只读部署查询授权，不新增运行记录。会话标识签名绑定访客、账号及登录 Session；登录、退出、切换账号后，旧标识返回 `409 conversation_expired`。
3. Dify 适配器检查 Chatflow 必填输入，再传入问题、绑定身份和工具授权。
4. Chatflow 检索知识，Agent 经 Cloudflare AI Gateway 调用模型。需要查询部署时，调用本站只读工具；服务器重新检查 Session 并限定所属账号，模型不传账号 ID。
5. Cloudflare 记录各次模型调用费用，并执行预算与总频率限制。最终回答以纯文本返回浏览器。

## 配置

```dotenv
SUPPORT_CHAT_PUBLIC_ENABLED=false
SUPPORT_CHAT_MAX_QUERY_LENGTH=2000
SUPPORT_CHAT_MAX_BODY_BYTES=8192
DIFY_API_URL=https://support-api.example.com/v1
DIFY_API_KEY=<Chatflow 应用 API key>
SUPPORT_CHAT_SESSION_SECRET=<至少 32 字符的随机秘密值>
```

这些都是服务端变量。`DIFY_API_URL` 包含 `/v1`，不是网页或完整聊天接口地址。各网站实例使用相同签名秘密值和业务数据库。IP 限流使用 `support_rate_limit` 表，上线前须应用 `0067_support_ip_rate_limit` 迁移；不维护客服费用账本。生产迁移与切换须单独确认。

开关必须严格为 `true`。首页渲染可能受构建与缓存影响，修改开关后要重新部署并验证实际入口和 API。反向隧道只转发所需应用 API，保留应用鉴权，不开放管理后台。

Dify 定义、英文知识与导入步骤见 [`support/dify/README.md`](../../support/dify/README.md)。

## 代码职责

| 文件                                             | 职责                                           |
| ------------------------------------------------ | ---------------------------------------------- |
| `src/components/support/support-chat.tsx`        | 首页窗口、登录变化时清空会话、控制台及邮件入口 |
| `src/config/support.ts`                          | 客服开关、工具授权期限和执行限制               |
| `src/app/api/support/chat/route.ts`              | 身份、会话签名、请求校验和工具授权签发         |
| `src/lib/support/backend.ts`、`service.ts`       | 通用后端契约和装配                             |
| `src/lib/support/dify-backend.ts`                | Dify 鉴权、必填输入检查、请求和响应转换        |
| `src/lib/support/strip-reasoning.ts`             | 通用推理块清理                                 |
| `src/lib/support/security.ts`                    | 会话签名、短期只读授权的签发和验证             |
| `src/lib/support/rate-limit.ts`                  | 可信 IP 读取、地址归一化、共享数据库原子限流   |
| `src/lib/support/deployments.ts`                 | 复查有效 Session，仅查询所属账号的部署         |
| `src/app/api/support/tools/deployments/route.ts` | 只读部署工具接口                               |

## 后端契约与切换

`SupportBackend.chat()` 接收 `query`、可选 `conversationId`、`visitorId`、`toolGrant` 和取消 `signal`，返回 `{ answer, conversationId }`。适配器接收的是已校验的原始上游会话 ID；浏览器持有的是本站签名包装，不是账号授权。

- 搬迁 Dify 或切换兼容服务：修改地址、应用 key，并重新绑定目标工作区的知识、工具和专用模型。不能只改地址就假定业务权限与预算仍有效。
- 修改提示词或知识：更新项目源文件，在测试 Dify 中验证并发布；网站前端协议不变。
- 更换其他 Agent 平台：新增 `SupportBackend` 实现，在 `service.ts` 装配；必须安全传递服务器授权，并让所有付费调用经过 AI Gateway。平台不支持这些约束时，工作范围超过字段转换。

不实现多平台选择器、自动故障转移或历史迁移。换应用时开始新对话。相同签名秘密值只能保持本站身份，不能保证上游会话兼容。

## 接口与会话

浏览器仅发送 `{ query, conversationId? }`，成功返回 `{ answer, conversationId }`。请求体不包含历史消息，历史由 Dify 按会话关联。请求体默认最多 8192 字节，由 `SUPPORT_CHAT_MAX_BODY_BYTES` 调节；问题默认最多 2000 个 UTF-16 代码单元（JavaScript `string.length`），由 `SUPPORT_CHAT_MAX_QUERY_LENGTH` 调节，前端输入框与后端校验使用同一配置。常用汉字或英文字母通常占 1 个代码单元，普通 emoji 通常占 2 个。签名会话仍最多 2048 个代码单元。Origin 必须与本站一致，Content-Type 为 JSON。

两项配置只接受正的安全整数，未设置或格式无效时分别使用默认值。增加问题长度时，应同时给请求体预留 UTF-8 编码、JSON 转义和会话标识的空间；两项限制独立生效。例如可设置问题长度 4000、请求体 32768 字节。修改环境变量后重新部署（本地重启开发服务），并刷新页面以更新输入框限制。Dify 的六轮记忆窗口由流程定义单独配置。

| HTTP            | error                               | 含义                                 |
| --------------- | ----------------------------------- | ------------------------------------ |
| 400 / 413 / 415 | `invalid_request` / `too_large`     | 输入不合法或过大                     |
| 403             | `forbidden`                         | 来源不匹配                           |
| 409             | `conversation_expired`              | 会话签名、归属或期限不符             |
| 429             | `rate_limited` / `budget_exhausted` | 请求额度或客服预算不足               |
| 502 / 503 / 504 | `unavailable`                       | 配置关闭、上游失败、存储不可用或超时 |

错误不透传供应商正文。本站日志只记录请求 ID、状态与耗时，不记录问题、回答或凭据。匿名 cookie 为 HttpOnly、SameSite Strict，生产增加 Secure，期限一天；cookie 不代表登录。前端会在打开窗口、切回页面及定期检查时核对真实 Session，身份变化会清空并取消旧对话。

工具只返回名称、记录状态、创建/完成时间，最多 20 条及 `hasMore`。它不返回 IP、内部地址、密钥或服务器指纹，也不查询实时健康、不重启、不退款、不建工单。匿名授权返回 `login_required`；无效、过期授权或已失效 Session 返回 401。授权在 120 秒内可重复执行同一只读查询，不承诺一次性消费；聊天结束不会提前撤销授权。错误不能解释为没有部署。

每轮请求重新签发授权，通过 Dify `inputs.deployment_grant` 传入。工具 Authorization 固定绑定 `start.deployment_grant`（`auto: 0`），不由模型从历史中提取或填写。未知产品问题按提示词说明资料不足并提供支持邮箱；无关问题简短拒答。页面的控制台或登录、邮件入口始终保留。

Dify 非成功响应的 `message` 同时包含 `Spend limit exceeded:` 与 `2045` 时，适配器映射为 `429 budget_exhausted`；其余 Dify HTTP 429 映射为 `429 rate_limited`，其他上游错误为 502。此预算识别依赖供应商错误文本，升级后需复验；网关限流若被 Dify 包装成其他 HTTP 状态，目前只会显示通用不可用。

## 费用与数据

独立 AI Gateway 配置每天 USD 3（86400 秒 fixed 窗口）、滚动一小时 USD 0.50，以及全网关每 60 秒 20 次模型请求。Dify Agent 最多三轮，每次输出最多 700 token，关闭思考模式，记忆窗口六轮。网关管理权限和调用权限使用不同 token，不启用绕过预算的 fallback。

规则源文件为 `support/gateway/policy.json`，不含账户、网关 ID 或凭据。使用 `pnpm support:gateway --env <本地环境文件>` 检查差异，加 `--apply` 后通过 cf CLI 更新并回读确认；`--dry-run` 只验证请求构造，详见[同步说明](../../support/gateway/README.md)。创建 API 可能忽略预算字段，不能只验证创建成功。默认关闭请求日志收集，测试可短时开启仅用于合成内容，完成后恢复。调用端还须配置 `support/gateway/request-headers.json` 中的显式缓存跳过头；不能把 `cache_ttl: 0` 等同于已验证无缓存。供应商 key、网关认证与插件保存注意事项见 [Dify 接入说明](../../support/dify/README.md)。

Cloudflare 在请求完成后记录费用，限制是最终一致的：并发及传播延迟可能造成短暂超额，不能当作严格余额扣减。费用是基于 token 的估算，不等于供应商账单；网关故障时不直连供应商。Agent 对话模型按当前配置经过独立网关，费用不扣客户 AI 余额；新加入的 embedding 和重排序是否经过该网关尚待复验。参见 [Spend Limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)。

本站入口每 IP 每 60 秒最多接收 6 次合法聊天请求，从首次请求开始计时；IPv6 按 /64 合并，IPv4-mapped IPv6 与对应 IPv4 共用额度。数据库原子更新供所有实例共享；新会话、清除 cookie、登录或退出不会重置同 IP 计数。上游失败仍计次，超限返回 `429 rate_limited` 和 `Retry-After` 秒数。数据库或可信 IP 来源不可用时停止调用 Dify。表只保存 IP 的 HMAC 摘要、计数和窗口结束时间；后续请求分批清理过期超过一天的记录（每次最多 100 条），无流量时不会主动清理。固定窗口边界可能连续放行两批请求，共享出口用户也共用额度；全局网关限制继续生效。

Vercel 部署读取平台覆盖的 `x-forwarded-for`，不回退到客户端可伪造的其它头。自托管生产环境必须设置 `SUPPORT_CHAT_TRUSTED_IP_HEADER`，并确保入口代理覆盖该头、源站不能被直接访问；不接受逗号分隔地址列表。本地开发未配置可信头时共用回环地址桶。若 Vercel 前面另有代理，必须复核取得的是用户 IP 还是代理 IP。参见 [Vercel 请求头说明](https://vercel.com/docs/headers/request-headers)。

当前没有账号或匿名访客独立额度。账号限流应使用服务端 Session 的 `user.id`，在 IP 检查通过后再检查，不用浏览器参数、Session ID 或 Dify 出站 IP 代替账号。网站与 Dify 自身的非模型资源仍需平台边缘防刷保护；应用层计数不替代边缘防护。

2026-09-30 远端知识库已改为 high_quality，使用 SiliconFlow `BAAI/bge-m3` embedding，工作流启用 `BAAI/bge-reranker-v2-m3` 重排序；新增调用的网关路由与预算覆盖尚未复验。已重建知识库并绑定客服草稿，检索改用原始 `sys.query`，Agent query 已包含原始问题。中、英、日价格检索在有无重排序时均通过；尚未发布新绑定或完成完整聊天验收，详见 Dify 接入说明。前端清空聊天不会删除 Dify 记录。问题、回答、短期授权及工具结果可能存在 Dify 执行日志中，授权仅到期或 Session 失效后不可用。供应商会处理问题、检索资料和最小化工具结果。公开上线前必须审查隐私说明，以及 Dify、Cloudflare 和供应商的日志权限、保留与删除策略。

网站上游超时 45 秒、客户端 50 秒、路由执行上限 60 秒。取消请求不保证已经开始的模型调用不计费。

前后端均不自动重试。窗口发送期间禁用输入和发送；失败后把问题恢复到输入框，保留已显示的用户消息与旧会话 ID，由用户决定是否重发。409 会清空会话；普通错误和超时不会清空，上游仍可能完成并保存未展示的回答，因此手动重发可能造成重复消息。用户可以使用清空入口开始新会话。

## 验证

```bash
pnpm exec vitest run src/lib/support src/app/api/support
pnpm exec tsc --noEmit
pnpm exec tsx scripts/support/check-dify.ts --env .env.support-test
pnpm exec tsx scripts/support/check.ts --url http://localhost:3000 --chat
```

Dify 专用脚本只检查连接、鉴权和必填字段，不直接发起聊天。通用脚本通过本站入口检查问答、续聊与跨访客拒绝；`--chat` 产生模型费用。受保护环境可传 `--headers-file` 读取被 Git 忽略的 JSON 请求头文件。

预算验收使用独立网关的极低临时额度，核对 429、供应商零 token/零费用和恢复后成功，并记录传播延迟；测试结束恢复正常预算。发布还需验证真实登录、无部署、有部署、越权、退出后旧授权失效、拒答和手机窗口。最新结果见[实施状态](support-agent-implementation.md)。
