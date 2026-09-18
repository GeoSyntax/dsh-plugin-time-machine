# DSH Time Machine

为 DeepSeek Harness 提供工作区回滚、会话分叉和失败反思

在 DSH 的 session fork 边界上同步工作区状态，让你可以安全试错、回到旧 checkpoint，并保留被放弃分支。

## Install

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

当前发布目标是 DSH `>=0.1.5-rc.2 <0.2.0` 的 `web` profile，要求 Node.js `^22.19.0 || >=24.0.0`。仓库会提交预构建的 `dist/`，GitHub dependency 安装不需要构建插件。

## Quickstart

在目标工作区执行：

```bash
dsh --profile web --dump-config
dsh --profile web
```

在 DSH 会话中使用：

```text
/tm-tree
/tm-storage
/tm-prune [keep-latest]
/tm-preview <checkpoint>
/tm-restore-files <checkpoint> <path...>
/tm-fork <checkpoint> <branch>
/tm-rewind <checkpoint>
```

插件会在每个 turn 开始前创建 checkpoint。`/tm-tree` 显示当前 DAG；`/tm-preview` 在不修改文件的情况下列出回滚影响；`/tm-restore-files` 只恢复指定路径并保持当前会话不变；`/tm-fork` 从旧状态创建平行会话；`/tm-rewind` 恢复工作区并通过 DSH `sessionController` 创建对齐的新会话。Web 仪表盘的 rewind 也会先执行同样的预览。

## What you can do

- **试验平行方案:** 从任意 checkpoint 创建命名分支，原分支和失败证据继续保留。
- **安全回滚工作区:** Git 后端使用隔离 index 和私有 `refs/dsh-tm/*`，不改写普通 branch、log 或用户 staging index。
- **清理孤儿文件:** 恢复目标树时删除 checkpoint 后产生的受管新增文件和目录。
- **保护 ignored 内容:** ignored 文件默认不删除；显式 `--delete-new-ignored` 时先进入 quarantine，再允许清理并支持从 rescue checkpoint 恢复。
- **回顾失败原因:** failed turn、stderr 和失败工具会生成 fork 前的 reflection advisory，减少重复踩坑。
- **运行在非 Git 目录:** fallback 后端使用 manifest 和内容哈希快照，支持普通文件、目录和 symlink。
- **先看再回滚:** Git 工作区提供文本 diff；非 Git fallback 至少列出将被目标快照覆盖的路径，并明确提示暂不提供文本 diff。
- **选择性恢复:** `/tm-restore-files` 只写入指定文件/目录，并创建 rescue 和结果 checkpoint；它不会伪造会话回滚。
- **存储治理:** `/tm-storage` 查看插件目录占用；`/tm-prune` 只删除不属于 current/branch head 且没有子节点的旧叶子节点；明确传入 `--abandoned-branches` 才会删除非当前探索分支。Git object 是共享的，删除私有 ref 不会自动执行危险的全仓库 GC。

## Safety model

默认使用 safe restore。若 checkpoint 之后出现用户手改、staged 变化或 ignored 路径漂移，插件会拒绝覆盖并报告 `WORKSPACE_DRIFT`。只有显式 `--force` 才允许覆盖受管文件。

每次 rewind/fork 前都会建立 rescue checkpoint。如果物理恢复成功但 DSH 会话 fork 失败，插件会恢复 rescue 状态，不执行 workspace-only 的“假回滚”。插件不会修改 DSH 的 append-only session log，也不会静默删除 ignored 文件。

## Configuration

通过 profile 的 `cordis.patch.yml` 覆盖配置。挂载 id 是 `time-machine`：

```yaml
- id: time-machine
  config:
    autoSnapshot: true
    enableReflectionAdvisor: true
    restoreMode: safe
    preservePaths:
      - node_modules
    enableWebUI: true
    webHost: 127.0.0.1
    webPort: 3088
```

Web dashboard 只绑定 loopback，并拒绝非本机 Host 和跨 origin 请求。`/tm-rewind` 与 `/tm-fork` 需要宿主提供 `sessionController`，否则插件会拒绝只恢复文件的危险降级行为。

## Notes

- 当前一个插件实例管理一个启动时 `workDir`；不同 session `cwd` 会被跳过。
- Git 快照复用用户仓库的 object database 和私有 refs，尚未迁移到独立 shadow store。
- 多文件恢复提供 rescue/compensation，但文件系统本身没有跨文件 ACID 事务。
- 当前 manifest 只声明 `web` profile；原生 TUI 不在兼容承诺范围内。
- Hermes Agent v2 已有自己的 checkpoint/rollback；本插件适合需要 DSH Session fork、DAG 探索或失败反思的场景。

问题定义、设计取舍、同类能力对照和完整验收矩阵见 [docs/PROBLEM.md](docs/PROBLEM.md)、[docs/COMPARISON.md](docs/COMPARISON.md)、[DESIGN.md](DESIGN.md) 和 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。

## License

MIT
