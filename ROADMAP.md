# Roadmap

路线图只表示优先方向，不是交付承诺。

## 0.2.x — 社区验证

- 在真实 DSH profile 上补充 GitHub/Linux/macOS/Windows 安装与回退验证；
- CI 已在 Ubuntu、Windows、macOS 矩阵运行完整测试；真实 DSH 宿主 smoke 仍固定在 Linux。
- 扩展 staged deletion、rename、nested repository、权限错误与异常中断测试；
- 收集 Git/fallback 两种后端的可复现兼容性报告；
- 已交付：真实 DSH smoke、safe restore、选择性恢复、跨进程锁和 shadow loose-object 回收；
- 完成首次 npm 发布前的 provenance 与 release checklist。

## 0.3 — 存储隔离与恢复日志

- 已交付：可选 shadow store、durable restore journal、checkpoint/quarantine retention、容量上限与 prune；
- 已交付：显式 shadow packed-object repack；继续完善可审计的存储迁移/回收 dry-run；
- 提供存储格式版本与迁移工具。

## 后续方向

- 一个插件实例路由多个 Session `cwd`；
- 将 Reflection Advisor 安全地注入下一分支的模型上下文；
- Web UI 完成新 Session 的宿主路由切换；
- 导出/导入 DAG、可视化分支比较和可审计恢复计划；
- 针对 DSH 版本的自动兼容性矩阵。
- 为多个 Agent 提供独立 worktree/container 隔离，而不仅是并发锁。

## 暂不计划

- 替代 Git 托管、远程备份或完整 IDE local history；
- 静默清理 ignored 文件、自动覆盖用户手改；
- 修改 DSH append-only event log；
- 在没有宿主 Session fork capability 时执行 workspace-only “假回退”。
