# 客服 Agent 实施与验收

2026-09-30 知识库重建：新增 `ClawSimple Support Knowledge`，从项目三份 Markdown 完成重新索引。中、英、日价格查询分别在有无重排序时测试，六组均命中且包含价格；客服草稿已绑定新库并使用原始 query，最新草稿已重新导出。旧库和已发布版本保留，未发布、未推送；尚未完成新草稿端到端聊天验收。此前固定查询、Agent 空 query 的导出记录仅代表当时状态。

2026-09-30 远端重新导出：iMac Dify 1.17.0 的 ClawSimple Support Chatflow 草稿已同步到 `support/dify/app.yml`，恢复知识库、工具占位符并补回导出器遗漏的 Agent／模型插件依赖。知识库为 high_quality，embedding 为 SiliconFlow `BAAI/bge-m3`，工作流重排序为 `BAAI/bge-reranker-v2-m3`；记忆 6 轮，应用最大活跃请求数 5（应用元数据不随 DSL 导出）。已确认草稿和当前发布版本均存在检索固定主题、Agent query 为常量空字符串的问题；本轮保留导出状态，未修复或发布远端。新增检索模型调用的预算覆盖待验证，下方历史验收不证明本版问答正确。

2026-09-30：本地增加共享 PostgreSQL IP 限流，每 IP 每 60 秒 6 次，IPv6 按 /64 合并；新增 `0067_support_ip_rate_limit` 迁移，尚未应用生产环境。下方 2026-09-28 验收记录属于此次限流改动之前。

输入限制现可通过 `SUPPORT_CHAT_MAX_QUERY_LENGTH` 和 `SUPPORT_CHAT_MAX_BODY_BYTES` 调节，默认仍为 2000 个 UTF-16 代码单元和 8192 字节；服务端页面将问题长度配置传给输入框，API 使用同一配置校验。此次配置改动不需要额外数据库迁移。

本轮本地验证：32 项客服测试、TypeScript、相关 ESLint 通过；使用临时 PGlite 执行实际迁移与限流 SQL，验证 20 次请求放行 6 次、IP 隔离、窗口过期恢复、Retry-After 和旧记录清理。PGlite 验证不替代多连接 PostgreSQL 并发测试；目标测试环境迁移、真实代理 IP 和并发行为尚待复验。本轮未连接 iMac Dify，未应用生产迁移或推送。

2026-09-28：费用控制改为 Cloudflare AI Gateway，模型更新为 `deepseek-flash`（DeepSeek V4.1 Flash）。独立测试环境已完成核心复验，供应商 key 已移入 Secrets Store，Dify 网关 token 改为加密保存；未批准生产发布。

## 当前实现

- Chatflow 使用 Knowledge → Agent → Answer，项目 DSL 保存节点、提示词和插件版本。
- 三份英文 Markdown（FAQ、定价、部署机制）已改用 high_quality 语义检索，embedding 为 `BAAI/bge-m3`，重排序为 `BAAI/bge-reranker-v2-m3`；新增调用的预算覆盖待复验。
- 唯一业务工具 `list_my_deployments` 复查现有登录 Session，只返回所属账号的最小部署字段。
- 工具授权为 120 秒签名凭据，可在有效期内重复只读查询，不再承诺一次性使用或运行结束即撤销。
- 会话签名仍绑定访客、账号和 Session；登录、退出或切换账号后不能复用旧会话。
- 模型直接经独立 AI Gateway 调用，每日 USD 3、滚动一小时 USD 0.50、全网关每分钟 20 次请求。Agent 最多三轮，每次最多 700 输出 token，关闭思考模式。
- 网站不维护费用账本或模型代理；IP 限流新增计数表，需要应用 `0067_support_ip_rate_limit` 迁移。现有登录与部署业务表仍然保留。

## 本次已验证

| 项目       | 结果                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 专用权限   | 管理 token 仅 AI Gateway Read/Write；运行 token 仅 AI Gateway Run，均限制在目标账户                           |
| 网关认证   | 正确认证 HTTP 200；不带网关认证 HTTP 401                                                                      |
| 最新 Flash | 供应商模型列表与实际请求均确认 `deepseek-flash`                                                               |
| Dify 插件  | BYOK 兼容接口使用标准 API key 字段认证，原生凭证校验通过，没有跳过实际模型验证                                |
| 完整问答   | 验收网站 → Dify → AI Gateway → DeepSeek 返回知识库价格；网关记录 2938 输入、91 输出 token，估算 USD 0.0004953 |
| 网关预算   | 临时低额度触发 HTTP 429、错误码 2045；受阻请求记录为零 token、零费用，随后恢复正常预算                        |

低额度规则有传播延迟，测试中曾连续放行后才拦截。因此此方案是最终一致的费用保护，不是严格硬上限；并发突发可能短暂超额。费用估算以 Cloudflare 记录为准，实际账单仍需核对供应商。没有每用户或每 IP 的独立额度。

本次无账本版本的额外复验：

- 27 项自动化测试、TypeScript、相关 ESLint 与预览构建通过。
- 真实数据库验证仅返回所属账号的合成部署，授权有效期内可重复读取；Session 过期或删除后拒绝。测试 Session 已清理，没有修改用户实际登录 Session。
- 用户此前完成邮件登录的浏览器能够通过客服入口查询自己的合成部署；匿名请求提示登录。原授权期限过后，同一会话重新查询成功。
- 通用检查脚本验证首问、续聊和跨访客拒绝通过；Dify 连接、鉴权与输入契约检查通过。
- 网站收到 `429 budget_exhausted`，页面显示静态额度提示并保留控制台、邮件入口；恢复预算后再次查询成功。
- 网关已恢复版本化预算规则并关闭请求日志收集，回读配置一致。

前一版已验证空账号、未知政策与无关问题拒答，以及手机窗口；这些历史结果不替代未来模型或前端改动后的回归。

## 凭据与缓存

供应商 key 已移入 Cloudflare Secrets Store，scope 仅 `ai_gateway`。Dify 的标准 `api_key` 字段加密保存目标账户的 AI Gateway Run token，不再保存自定义认证头。存储检查确认当前凭据中没有明文网关 token。临时 Secrets Store Write token 已撤销，验证返回 HTTP 401，本地临时凭证文件已删除。

BYOK 链路已复验知识问答、登录部署查询与网站 `429 budget_exhausted`。网关 `cache_ttl: 0` 配置下仍观察到重复探针命中缓存，因此调用端还需显式设置 `cf-aig-skip-cache: true`；该非秘密请求头单独版本化。Dify 表单保存时可能过滤此字段，重新保存后必须复验，不能把配置回读当成运行证明。

当前兼容接口已被 Cloudflare 标记为单模型调用 deprecated，现有接入仍可使用。后续需评估替代接口；详见 [Dify 接入说明](../../support/dify/README.md)。

### 新 REST API 迁移验证

2026-09-29：使用目标账户的独立 `Workers AI Read` token 请求 `/ai/v1/chat/completions`，显式指定客服网关和跳过缓存，模型为 `deepseek/deepseek-flash`。接口返回 HTTP 404、错误码 7003，消息为 `Model not found: deepseek/deepseek-flash`，未进入模型调用与预算复验阶段。

[官方模型目录](https://developers.cloudflare.com/ai/models/)未列出该直连模型；目录中的 Cloudflare 托管 Flash 版本不能视为同一供应商、模型版本或计费方式。此次没有修改 Dify 工作配置，也没有更换模型、启用统一计费或切换生产。新 REST API 迁移尚未完成，须待目标模型受支持，或另行确认模型与计费变更后再验证。

## 复验

```bash
pnpm exec vitest run src/lib/support src/app/api/support
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm exec tsx scripts/support/check-dify.ts --env .env.support-test
pnpm exec tsx scripts/support/check.ts --url <测试网站> --chat
```

测试使用独立数据库与明确标注的合成部署记录，不创建真实服务器、订阅或订单。预算测试完成后必须恢复 `support/gateway/policy.json`；测试日志关闭后回读网关配置。详细接入步骤见[后端指南](support-chat.md)及 [Dify 定义](../../support/dify/README.md)。

## 生产发布前

1. 针对最终目标环境复查凭据加密、缓存跳过、模型调用和预算，以及登录、Session 撤销、账号隔离、匿名查询与恢复；评估兼容接口的弃用风险。
2. 审查网站、Dify、Cloudflare 和供应商的数据保留、权限、删除策略及用户隐私说明。清空聊天窗口不会删除上游记录。
3. 确认所有付费调用经过目标网关，没有直连 fallback；复核最新模型价格和预算。网关总限流不替代网站与 Dify 的入口防刷。
4. 先在目标测试环境应用 IP 限流迁移，确认可信 IP 来源、超限和恢复行为。用户确认后再推送、应用生产迁移、部署和切换生产。保留原网站版本与配置作为回滚依据，不执行客服账本迁移。

当前未向生产数据库应用迁移，未推送代码，未开启生产客服。运行环境地址、资源 ID、秘密值及机器配置不纳入本文或 DSL。
