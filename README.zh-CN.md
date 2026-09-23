# DSH Time Machine（时光机）

**让工作区、会话记忆和失败分支一起回滚，并且可以从任意检查点继续探索。**

Time Machine 是面向 DeepSeek Harness 的非官方社区插件。它补上 DSH 原生 append-only 会话日志缺少的工作区物理回滚能力，并把“文件状态”和“Agent 认知状态”放进同一个可解释的检查点。

[English README](README.en.md) · [官方 DSH 社区介绍](https://github.com/deepseek-ai/deepseek-harness/discussions/7191) · [插件目录提交](https://github.com/alexchenzl/dsh-plugin-directory/issues/247)

## 真实效果

下面的效果来自本地运行的 Web 仪表盘：一次失败的 Redis 分支、一处自动救援点，以及继续成功的 JWT 分支会同时保留在时间线中。回滚后新增的配置文件和临时目录会被清理，失败信息仍可用于下一次 Agent 推理。

![DSH Time Machine 本地实机仪表盘](https://raw.githubusercontent.com/GeoSyntax/dsh-plugin-time-machine/main/docs/assets/dashboard-real.png)

这张图来自本地真实运行的 Web 仪表盘，而不是示意图：左侧同时保留成功基线、失败 Redis 分支、自动救援检查点和成功的 `experiment/jwt` 分支；右侧展示当前检查点的 Git 元数据、Agent 写入审计和可恢复文件。你可以直接复制下面的命令启动同一个界面。

![DSH Time Machine DAG 结构示意](https://raw.githubusercontent.com/GeoSyntax/dsh-plugin-time-machine/main/docs/assets/dag-demo.svg)

本地实机页面包含四个关键区域：分支状态、DAG 时间线、检查点详情和文件变更/恢复操作。启动后访问 `http://127.0.0.1:3088` 即可查看。

## 安装

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

当前公开包适用于 DSH `>=0.1.5-rc.2 <0.2.0` 的 `web` profile，需要 Node.js `^22.19.0 || >=24.0.0`。这是 GitHub 依赖安装方式；项目尚未发布 npm 版本。

## 快速开始

在 profile 的 `cordis.patch.yml` 中加入插件，然后重启 DSH：

```yaml
plugins:
  - id: time-machine
    package: dsh-plugin-time-machine
    config:
      autoSnapshot: true
      restoreMode: safe
      enableWebUI: true
```

在会话中使用：

```text
/tm-list                              # 查看当前分支的检查点
/tm-preview <checkpoint>              # 先预览文件、冲突和副作用
/tm-rewind <checkpoint>               # 回滚工作区，并对齐会话状态
/tm-fork <checkpoint> experiment/jwt  # 从旧检查点开辟平行分支
```

默认仪表盘地址为 `http://127.0.0.1:3088`。所有破坏性操作都建议先执行 preview。

## 它解决什么问题

- **物理回滚而不是只回滚文本：** 使用隔离 Git index、不可变 tree 和私有 `refs/dsh-tm/*` 保存工作区快照。
- **清理孤儿文件：** 回滚时清理检查点之后新增的普通文件和目录，避免临时配置、日志和密钥残留。
- **保留失败探索：** 从旧检查点 fork 出新的 DAG 分支，不覆盖原失败路径，也不丢失错误证据。
- **同步 Agent 记忆：** 检查点同时保存消息、token 状态、锚点和工作区树，避免“磁盘回去了、Agent 还记得错误代码”的认知分裂。
- **失败反思闭环：** 从失败工具和 stderr 中生成脱敏的反思提示，注入新的分支，减少重复踩坑。
- **非 Git 兜底：** 未初始化 Git 的目录使用 manifest、内容 hash 和同等的路径安全检查。

## 安全边界

- Safe 模式会拒绝未验证的用户修改、staged drift 和 ignored drift。
- Git-only merge 模式会保留不冲突的编辑，并明确报告冲突。
- symlink ancestor、hard link、sparse checkout、submodule，以及进行中的 merge/rebase/cherry-pick 默认 fail closed。
- 外部数据库、网络请求、进程和云资源无法通过文件回滚自动撤销；可以注册 compensation adapter，或使用 strict 模式阻止恢复。
- 当前公开 DSH alpha host 暴露的是共享工作区 fork，不是假装成独立 worktree 或容器的隔离环境。
- 可选 AES-256-GCM 加密保护会话元数据、shadow objects 和 quarantine backup；恢复日志可以在重启后继续处理被中断的操作。

## 和其他回滚插件的区别

| 方案 | 更适合 | Time Machine 的补充 |
| --- | --- | --- |
| Hermes checkpoint | Agent 写入证据和同窗口回滚 | 增加持久 DAG、会话对齐、失败反思和外部副作用门禁 |
| Change Ledger | 轻量变更账本和选择性恢复 | 增加孤儿清理、preview plan、rescue journal 和会话分支模型 |
| `dsh-checkpoint-rewind` | 单会话 checkpoint/rewind | 增加可持久化分支、失败证据和证据驱动的恢复策略 |
| `dsh-undo` / `dsh-rewind` | 低摩擦线性撤销 | 保留原探索路径，并显式创建新的会话分支 |

如果你只需要简单 Ctrl+Z，可以选择更小的 undo 插件；如果你希望工作区、对话、失败尝试和并行探索保持可解释，选择 Time Machine。

## 验证状态

当前仓库已经通过完整 CI：

- 143 个自动化测试
- Node 22/24
- Ubuntu、macOS、Windows
- DSH bundle smoke
- Native DSH client companion
- DSH `0.1.6-alpha.1` 与 `0.1.6-alpha.2` companion 检查
- 生产依赖安全审计
- 本地 DSH source/Web smoke 和 Gemini gateway 实机验证

更详细的证据见 [测试计划](docs/TEST_PLAN.md)、[同类对照](docs/COMPARISON.md) 和 [社区提交材料](docs/COMMUNITY_SUBMISSION.md)。

## 许可证

MIT
