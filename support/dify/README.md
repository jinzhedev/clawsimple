# Dify 客服应用定义

`app.yml` 保存客服 Chatflow 的节点、提示词、模型参数和插件版本。知识源位于 `../knowledge/`；部署查询工具的 OpenAPI 定义是 `deployment-tool.openapi.yml`。凭据和工作区资源绑定不提交到仓库。

## 应用结构

当前草稿：用户原始问题 → Knowledge 语义检索 → Agent → 回答。

2026-09-30：新建 `ClawSimple Support Knowledge`，从项目三份 Markdown 重新生成向量索引并绑定客服草稿。旧知识库和已发布版本保留。Knowledge 查询为 `sys.query`；Agent query 保留界面配置 `user's original query: {{#sys.query#}}`。固定主题节点已不在当前草稿中。

- Chatflow 接收必填输入 `deployment_grant`，由本站后端生成，只传给工具执行层。
- 远端知识库已改为 high_quality，embedding 为 SiliconFlow `BAAI/bge-m3`；工作流启用 SiliconFlow `BAAI/bge-reranker-v2-m3` 重排序，`top_k=10`。embedding 属于知识库设置，不随应用 DSL 完整导出，需要在目标知识库单独配置。
- Agent 使用 `deepseek-flash`（DeepSeek V4.1 Flash），关闭思考模式，最多三轮，每轮输出不超过 700 token。产品事实只能来自知识；未知问题转人工，无关任务简短拒绝。
- 唯一业务工具为 `list_my_deployments`，只读取当前登录账号的部署记录。账号状态来自工具，不来自知识库。
- 提示词只维护在 `app.yml` 的 Agent instruction 中，不另存副本。

## 绑定与导入

1. 安装 DSL 声明的 Agent、OpenAI API Compatible 和 SiliconFlow 插件。
2. 新建 high_quality 知识库，配置 SiliconFlow `BAAI/bge-m3`，上传 `../knowledge/` 中的三份 Markdown 并确认索引完成；流程重排序使用 `BAAI/bge-reranker-v2-m3`。模型凭据须在目标工作区单独绑定。
3. 以 `deployment-tool.openapi.yml` 创建自定义 API 工具，将示例 server 替换为目标网站 HTTPS origin。若测试网站有访问保护，额外的保护请求头保存在工具供应商凭据中，不写入 DSL。
4. 将 DeepSeek key 存入 Cloudflare Secrets Store，scope 仅 `ai_gateway`，按官方 BYOK 规则命名为 `<gateway>_deepseek_default`，关联网关的 store 和 DeepSeek 默认供应商配置。客服专用 OpenAI API Compatible 模型名为 `deepseek-flash`，实际模型名（`endpoint_model_name`）为 `deepseek/deepseek-flash`，endpoint 为 `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat`。Dify 标准 API key 字段只保存目标账户的 AI Gateway Run token，由 Dify 加密；不设置自定义认证头。context 32768、max tokens 700、Tool Call 开启、流式 Function Calling 关闭。额外配置 `../gateway/request-headers.json` 中不含秘密的缓存跳过头。网站不持有模型凭据，不要修改其他应用共用的模型配置。
5. 将知识库和工具供应商 ID 写入被 Git 忽略的环境文件：

   ```dotenv
   DIFY_SUPPORT_DATASET_ID=<知识库 UUID>
   DIFY_SUPPORT_TOOL_PROVIDER_ID=<工具供应商 UUID>
   ```

6. 渲染带目标绑定的 DSL，先导入测试工作区：

   ```bash
   pnpm exec tsx scripts/support/render-dify.ts --env .env.support-test
   ```

   默认产物是 `tmp/support/app.yml`。仓库中的 `app.yml` 使用占位符，不能不经绑定直接发布。

7. 检查工具的 `Authorization` 参数为执行层变量 `start.deployment_grant`，`auto=0`。变量已经包含 `Bearer ` 前缀，不再拼接；它不能成为模型生成参数或提示词内容。
8. 发布测试应用，把应用 API key 配置到测试网站。验证知识问答、无关拒答、登录与匿名查询、账号隔离和预算耗尽后，再申请生产切换。

当前插件表单未声明 `extra_headers`，保存时会过滤额外头。测试配置通过 Dify 服务层在表单校验后补入固定的 `cf-aig-skip-cache: true`，再执行插件原生凭证验证和保存；没有跳过实际模型校验。标准 API key 被加密，额外头仍为明文，因此这里只能存非秘密设置，不能存认证信息。在界面重新保存凭据后，须重新配置并复验缓存跳过头。实测 `cache_ttl: 0` 仍出现缓存命中，不能仅凭网关配置断言缓存已关闭。

当前使用 [Cloudflare OpenAI 兼容接口](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)承载标准 API key 认证。官方已将该接口的单模型调用标为 deprecated，但说明现有接入仍可用；生产发布前评估替代接口与 Dify 插件兼容性。替换仅涉及模型供应商配置，不需要改网站接口。Secrets Store 临时写权限用于配置后即撤销，管理 token 不进入 Dify。

2026-09-29 实测新 REST API `/ai/v1/chat/completions` 使用 `Workers AI Read` token 时，对 `deepseek/deepseek-flash` 返回 HTTP 404、错误码 7003（模型不存在）。因此暂未替换现有 endpoint，不能仅换 URL 后宣称迁移成功，也不能擅自改用 Cloudflare 托管的其他 Flash 版本。详见[迁移验证记录](../../docs/reference/support-agent-implementation.md#新-rest-api-迁移验证)。

网关使用独立预算，开启认证、关闭缓存，不设置绕过预算的供应商直连或自动 fallback。管理 token 与运行 token 分离；管理 token 不放入 Dify。预算规则与验收步骤见后端指南。

应用最大活跃请求数当前为 5，Agent 记忆窗口为 6 轮。并发上限属于应用元数据，不在本次 DSL 中，迁移时单独设置。embedding 和重排序新增调用的网关路由及计费保护尚未在本轮核验，不能沿用“全部调用已受现有网关预算保护”的结论。

重建检索验收：中文、英文、日文价格问题，在关闭和开启重排序两种模式下均返回资料，且包含价格文档。六组测试通过；这属于知识库检索测试，不等于完整聊天验收。新知识库默认关闭重排序，工作流仍保留已验证的重排序配置。本机新绑定保存在被 Git 忽略的 `tmp/support/rebuilt-bindings.env`，可传给 `render-dify.ts --env` 渲染。

## 更新与迁移

在测试应用调试后，通过 Dify 原生功能导出，不包含秘密变量。审查导出内容，恢复知识库和工具 ID 占位符，并保留插件依赖，再更新仓库。导出器可能漏掉 Agent 插件依赖，不能因此删除声明。

新工作区要重新绑定知识库、工具和专用模型凭据。DSL 不包含聊天记录、供应商凭据、索引数据或部署环境；Git 提交也不会自动发布 Dify。

接入、费用与验证说明见[客服后端指南](../../docs/reference/support-chat.md)和[实施状态](../../docs/reference/support-agent-implementation.md)。
