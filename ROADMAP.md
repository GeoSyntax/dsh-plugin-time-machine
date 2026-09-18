# Roadmap

路线图只表示优先方向，不是交付承诺。

## 0.2.x — 社区验证

- 在真实 DSH profile 上补充 GitHub/Linux/macOS/Windows 安装与回退验证；
- 扩展 staged deletion、rename、nested repository、权限错误与异常中断测试；
- 收集 Git/fallback 两种后端的可复现兼容性报告；
- 完成首次 npm 发布前的 provenance 与 release checklist。

## 0.3 — 存储隔离与恢复日志

- 将 Git 对象迁移到独立 shadow store，避免增长用户仓库 object database；
- 引入 durable restore journal，启动时识别未完成事务并给出恢复路径；
- 加入 checkpoint/quarantine retention、容量上限、prune 与 dry-run；
- 提供存储格式版本与迁移工具。

## 后续方向

- 一个插件实例路由多个 Session `cwd`；
- 将 Reflection Advisor 安全地注入下一分支的模型上下文；
- Web UI 完成新 Session 的宿主路由切换；
- 导出/导入 DAG、可视化分支比较和可审计恢复计划；
- 针对 DSH 版本的自动兼容性矩阵。

## 暂不计划

- 替代 Git 托管、远程备份或完整 IDE local history；
- 静默清理 ignored 文件、自动覆盖用户手改；
- 修改 DSH append-only event log；
- 在没有宿主 Session fork capability 时执行 workspace-only “假回退”。
