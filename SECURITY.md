# Security policy

## Supported versions

当前项目仍处于 pre-1.0 阶段，仅最新的 `0.2.x` 代码线接收安全修复。尚未发布的 `main` 可能发生存储格式变化。

## Reporting a vulnerability

请使用仓库的 [GitHub Private Vulnerability Reporting](https://github.com/GeoSyntax/dsh-plugin-time-machine/security/advisories/new)，不要先创建公开 Issue。

报告中请包含受影响版本、操作系统、Git/fallback 后端、最小复现步骤与影响范围。请删除 token、私钥、Session 内容、绝对用户路径和 quarantine 中的真实文件。

优先级最高的问题包括：

- 工作区外路径写入/删除或 symlink escape；
- 未经确认覆盖 checkpoint 后的用户修改；
- 污染真实 Git index、branch 或普通 commit history；
- ignored secret 被写入 Git object database 或 Web 响应；
- localhost dashboard 的跨域请求、DNS rebinding 或 XSS；
- Session 与工作区错误配对，且 rescue 无法恢复。
- 外部 compensation adapter 在未明确 `execute` 或跨 idempotency key 重复执行远程副作用；适配器认证信息泄露或 unknown 状态被错误标记为已补偿。

## Incident preservation

发现异常恢复后，请先停止 DSH，并复制工作区与 `.dsh/time-machine` 到安全位置。不要立即运行 `git gc`、`git clean` 或删除 private refs/quarantine；这些数据可能是恢复与定位问题所必需的。
