# 客服 AI Gateway 配置同步

`policy.json` 是网关受管配置的来源，包含认证、限流、预算、日志及缓存设置。修改文件不会自动修改远端；网站运行时也不读取它。

同步脚本依据 [Cloudflare cf CLI 发布说明](https://blog.cloudflare.com/cloudflare-cf-cli-launch/)，使用项目固定版本 `cf@1.0.0-beta.5` 的 `ai-gateway gateways get/update` 命令。Wrangler 继续负责原有部署，不参与网关 policy 同步。

在项目根目录执行。先在本地、已被 Git 忽略的环境文件中配置：

```dotenv
CLOUDFLARE_ACCOUNT_ID=<目标账户 ID>
SUPPORT_AI_GATEWAY_ID=<目标网关 ID>
CLOUDFLARE_API_TOKEN=<仅目标账户的 AI Gateway 管理 token>
```

管理 token 与 Dify 调用网关的 token 分开；检查需要读取权限，应用需要编辑权限。不把该文件或 token 提交到仓库。脚本只加载显式指定的环境文件，也支持已导出的环境变量。

```sh
# 验证实际 cf CLI 生成的 URL、PUT 方法和完整请求体，不请求远端网关
pnpm support:gateway --env <本地环境文件> --dry-run

# 默认只读：比较 policy 中的字段
pnpm support:gateway --env <本地环境文件>

# 应用差异，然后重新读取远端配置确认一致
pnpm support:gateway --env <本地环境文件> --apply
```

`--dry-run` 不需要 token，但需要账户和网关 ID。退出码：`0` 表示检查一致、预览通过或同步验证成功；`2` 表示只读检查发现差异；`1` 表示配置、CLI 或回读验证失败。

更新时把经过校验的 policy 快照通过 `--body @文件` 传给 cf，避免独立命令参数遗漏嵌套的预算规则。先执行 cf dry-run 验证请求体，再更新并重新读取。相同配置不写入；比较忽略无关顶层字段和预算规则排列顺序，但会识别额外预算规则及非空的作用域设置。同步会以本地配置替换受管字段，包括完整预算规则列表。

超时或回读失败不自动重试、回滚；远端可能已更新，先重新执行只读检查。配置回读一致仅证明设置已保存，不能替代预算触发、计费延迟和缓存行为的运行验收。`request-headers.json` 是调用端请求头，需单独配置，不由此脚本同步。

当前验证包含实际 cf 本地 dry-run 和同步流程自动化测试；本次实现未执行远端更新。CLI 仍处于 beta，升级后需重新验证 schema、dry-run 和回读格式。
