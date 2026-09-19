# DSH Time Machine

为 DeepSeek Harness 补上工作区回滚、会话分叉和失败反思。

安装后，你可以在 DSH 中预览一次回滚影响、恢复旧 checkpoint，或从历史状态开启平行会话，而不会改写 DSH 的 append-only session log。

## Install

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

当前通过 GitHub dependency 分发，支持 DSH `>=0.1.5-rc.2 <0.2.0` 的 `web` profile，要求 Node.js `^22.19.0 || >=24.0.0`。插件仓库提交了可直接加载的 `dist/`，不需要先编译。

## Quickstart

在目标工作区启动 DSH：

```bash
dsh --profile web
```

在该 profile 的 `cordis.patch.yml` 中启用插件：

```yaml
plugins:
  - id: time-machine
    package: dsh-plugin-time-machine
    config:
      autoSnapshot: true
      restoreMode: safe
      enableWebUI: true
```

重启 DSH 后，在会话中运行：

```text
/tm-list
/tm-preview <checkpoint>
/tm-rewind <checkpoint>
```

Dashboard 默认绑定 `127.0.0.1:3088`。先 preview，再执行 rewind；服务会重新检查工作区漂移、Git 分支、一次性 plan 和外部副作用状态。

## What you can do

- **回到旧状态:** Git 项目使用隔离 index 和 `refs/dsh-tm/*` 私有引用；普通 branch、用户 staging index 和 DSH session log 不会被改写。
- **清理孤儿文件:** full restore 会清理 checkpoint 之后产生的普通新增文件；ignored 文件默认保留，显式删除时先进入可恢复 quarantine。
- **平行探索:** `/tm-fork <checkpoint> <branch>` 保留原 DAG、失败证据和新分支，不覆盖历史。
- **选择性恢复:** `/tm-restore-files <checkpoint> <path...>` 只恢复指定路径，并保持当前会话不变。
- **保留人工修改:** 启用 `enableAgentWriteLedger` 后，可用 `--preserve-hand-edits` 只保留有明确 Agent-write 证据、随后被人工改动的路径。
- **解释失败原因:** failed turn、失败工具和清洗后的错误摘要会形成 reflection advisory，供下一次 fork 前查看。
- **支持非 Git 目录:** fallback 引擎使用 manifest 和内容哈希，仍会处理新增文件、目录和 symlink 安全边界。
- **先看再改:** preview 提供新增、删除、冲突、partial snapshot 和文本 diff；过期或重复使用的 restore plan 会失败关闭。
- **记录外部副作用:** 数据库、网络、云资源和进程变更可登记到 effect ledger。补偿默认 dry-run，严格模式可在未解决时阻断 rewind/fork。

## Commands

| Command | Purpose |
| --- | --- |
| `/tm-list` | 查看当前活动分支的相对 checkpoint 编号 |
| `/tm-tree` | 查看彩色 DAG 拓扑 |
| `/tm-preview <checkpoint>` | 只读预览恢复影响 |
| `/tm-undo [count]` | 按已完成 turn 回退，默认 1 |
| `/tm-rewind <checkpoint>` | 恢复工作区并创建对齐的新 DSH session |
| `/tm-fork <checkpoint> <branch>` | 从历史状态创建平行 session |
| `/tm-restore <checkpoint>` | 恢复整个工作区但保留当前会话 |
| `/tm-restore-files <checkpoint> <path...>` | 选择性恢复文件或目录 |
| `/tm-agent-writes <checkpoint>` | 查看 Agent-write 账本 |
| `/tm-unattributed <checkpoint>` | 查看没有归因证据的变更 |
| `/tm-reflection <checkpoint>` | 查看失败分支反思提示 |
| `/tm-external-list [checkpoint]` | 查看尚未补偿的外部副作用 |
| `/tm-doctor` | 检查 profile、宿主能力和安全配置 |
| `/tm-storage` | 查看快照、quarantine 和 shadow store 占用 |

## Safety boundaries

- 默认 `safe` 模式遇到用户手改、staged 变化或 ignored 路径漂移会拒绝覆盖。
- Git-only `--merge` 只保留非冲突修改；冲突会返回 `RESTORE_MERGE_CONFLICT`。
- symlink ancestor、共享 hard-link inode、sparse checkout、submodule 和进行中的 merge/rebase/cherry-pick 会 fail-closed。
- 每次 rewind/fork 前都会建立 rescue checkpoint；恢复或 session fork 失败时会尝试补偿，而不是报告一个只恢复了文件的假回滚。
- 一个插件实例默认管理一个启动时 `workDir`，并以跨进程锁串行化同一工作区。它不是独立 worktree 或 container。
- 外部系统不会被文件恢复假装回滚。只有明确注册的 compensation adapter 才能执行远程补偿。

## Configuration

最小配置如下：

```yaml
config:
  autoSnapshot: true
  restoreMode: safe # safe | merge | force
  enableWebUI: true
  workspaceLockTimeoutMs: 30000
  restorePlanTtlMs: 900000
```

常用增强项包括：

- `autoPreCommandSnapshot: true`：在 DSH 高风险工具前创建 `pre-command` checkpoint。
- `enableAgentWriteLedger: true`：登记原生 `write`、`edit`、`str_replace_editor` 结果。
- `preserveVerifiedHandEditsByDefault: true`：默认保留有账本证据的人工修改。
- `shadowStore: true`：把插件 Git objects 放入独立 shadow store。
- `stateEncryptionKeyEnv`、`shadowStoreEncryptionKeyEnv`、`quarantineEncryptionKeyEnv`：分别保护 DAG/session、shadow objects 和 quarantine。
- `maxSnapshots`、`maxStorageBytes`、`retentionMaxAgeMs`：限制快照数量、空间和自动保留年龄。

完整配置、错误码和迁移说明见 [`docs/PROBLEM.md`](docs/PROBLEM.md)、[`DESIGN.md`](DESIGN.md) 和 [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)。

## Compared with similar plugins

Time Machine 适合需要“工作区与会话一起移动”、DAG 平行探索和失败反思的 DSH 用户。Hermes 风格 checkpoint 更强调同窗口回滚和 Agent-write 默认保留；Change Ledger 更偏向轻量选择性恢复；`dsh-checkpoint-rewind` 更偏向单 session 的 pre-execute 快照。

本插件的额外能力是持久 DAG、孤儿文件清理、restore plan、rescue journal、未归因变更审计、外部副作用门禁和加密存储。它仍不能自动撤销数据库、网络、进程或云资源，也不能在 DSH 没有 workspace fork API 时凭空创建独立 worktree。详细逐项对照见 [`docs/COMPARISON.md`](docs/COMPARISON.md)。

## Optional Web companion

`client-companion/` 提供 DSH Web session header 和 assistant-message action slot。它是可选包，不会随主服务自动安装，支持 DSH client `0.1.6-alpha.1` 和 `0.1.6-alpha.2`。使用说明见 [`client-companion/README.md`](client-companion/README.md)。

## Verification

```bash
pnpm test:release
pnpm benchmark
```

真实 DSH source smoke 需要设置 `TM_DSH_SOURCE`；真实模型 smoke 还需要 `TM_GEMINI_BASE_URL`、`TM_GEMINI_MODEL` 和 `TM_GEMINI_API_KEY`。测试使用临时工作区和临时 DSH_HOME，不修改当前仓库。

更多资料：[`docs/COMPARISON.md`](docs/COMPARISON.md)（同类对照）、[`docs/ROADMAP.md`](docs/ROADMAP.md)（路线图）、[`docs/HOST_WORKSPACE_ROUTING.md`](docs/HOST_WORKSPACE_ROUTING.md)（多 workspace 契约）、[`docs/DSH_NATIVE_UI.md`](docs/DSH_NATIVE_UI.md)（Web companion）和 [`docs/RELEASING.md`](docs/RELEASING.md)（发布）。

## License

MIT
