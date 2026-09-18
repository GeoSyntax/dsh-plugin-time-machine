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
/tm-prune [keep-latest] [--older-than=<7d|12h|30m>]
/tm-prune [keep-latest] --repack-shadow
/tm-preview <checkpoint>
/tm-restore-files <checkpoint> <path...> [--plan=<id>]
/tm-fork <checkpoint> <branch>
/tm-rewind <checkpoint> [--plan=<id>]
```

插件会在每个 turn 开始前创建 checkpoint。`/tm-tree` 显示当前 DAG；`/tm-preview` 在不修改文件的情况下列出回滚影响；`/tm-restore-files` 只恢复指定路径并保持当前会话不变；`/tm-fork` 从旧状态创建平行会话；`/tm-rewind` 恢复工作区并通过 DSH `sessionController` 创建对齐的新会话。Web 仪表盘的 rewind 也会先执行同样的预览。

## What you can do

- **试验平行方案:** 从任意 checkpoint 创建命名分支，原分支和失败证据继续保留。
- **安全回滚工作区:** Git 后端使用隔离 index 和私有 `refs/dsh-tm/*`，不改写普通 branch、log 或用户 staging index。
- **清理孤儿文件:** 恢复目标树时删除 checkpoint 后产生的受管新增文件和目录。
- **保护 ignored 内容:** ignored 文件默认不删除；显式 `--delete-new-ignored` 时先进入 quarantine，再允许清理并支持从 rescue checkpoint 恢复。
- **回顾失败原因:** failed turn、stderr 和失败工具会生成 fork 前的 reflection advisory，减少重复踩坑。
- **运行在非 Git 目录:** fallback 后端使用 manifest 和内容哈希快照，支持普通文件、目录和 symlink。
- **先看再回滚:** Git 工作区提供文本 diff；preview 还会列出导致 safe restore 拒绝覆盖的 `conflictingPaths`；非 Git fallback 至少列出将被目标快照覆盖的路径，并明确提示暂不提供文本 diff。
- **显式三方合并恢复:** `/tm-rewind <checkpoint> --merge`（Web API 传 `merge: true`）以当前 checkpoint 为 base，保留与目标快照不冲突的本地修改；同一路径双方都改动时返回 `RESTORE_MERGE_CONFLICT`，默认 safe 模式行为不变。该模式要求 Git 工作区。
- **选择性恢复:** `/tm-restore-files` 只写入指定文件/目录，并创建 rescue 和结果 checkpoint；它不会伪造会话回滚。
- **存储治理:** `/tm-storage` 查看插件目录占用；`/tm-prune` 默认只删除不属于 current/branch head 且没有子节点的旧叶子节点，并清理已无 DAG 引用的 ignored quarantine；明确传入 `--abandoned-branches` 才会删除非当前探索分支；明确传入 `--compact-history` 才会压缩旧线性节点并重新挂接子节点。Git object 是共享的，删除私有 ref 不会自动执行危险的全仓库 GC。
- **Shadow pack 维护:** `shadowStore: true` 时，显式传入 `--repack-shadow`（或 Web API `repackShadowObjects: true`）会仅根据 `refs/dsh-tm/*` 重建 shadow pack，并删除旧的不可达 pack；不会运行用户仓库的全局 GC。
- **崩溃恢复:** rewind/fork/选择性恢复会写入 durable restore journal；插件下次启动时如果发现未完成操作，会先恢复 rescue checkpoint，再清理 journal。
- **硬配额:** `maxSnapshots` 和 `maxStorageBytes` 默认关闭；启用后达到上限会安全拒绝新 checkpoint，不会静默删除历史。
- **自动配额清理:** `autoPrune: true` 才会在普通 checkpoint 前尝试压缩旧节点；无法安全腾出空间时仍然拒绝 checkpoint，不会强行删除 current 或 branch head。
- **自动年龄保留:** `retentionMaxAgeMs` 大于 0 时，普通 checkpoint 前会自动压缩超过该年龄的非 current、非 branch head 节点；默认关闭，内部 rescue checkpoint 不触发清理。

## Safety model

默认使用 safe restore。若 checkpoint 之后出现用户手改、staged 变化或 ignored 路径漂移，插件会拒绝覆盖并报告 `WORKSPACE_DRIFT`。显式 `--merge` 仅在 Git 工作区尝试保留非冲突修改；只有显式 `--force` 才允许无条件覆盖受管文件。

每次 rewind/fork 前都会建立 rescue checkpoint。如果物理恢复成功但 DSH 会话 fork 失败，插件会恢复 rescue 状态，不执行 workspace-only 的“假回滚”。插件不会修改 DSH 的 append-only session log，也不会静默删除 ignored 文件。

## Configuration

通过 profile 的 `cordis.patch.yml` 覆盖配置。挂载 id 是 `time-machine`：

```yaml
- id: time-machine
  config:
    autoSnapshot: true
    enableReflectionAdvisor: true
    restoreMode: safe # safe | merge | force
    preservePaths:
      - node_modules
    enableWebUI: true
    webHost: 127.0.0.1
    webPort: 3088
    # 0 disables the hard guard; pruning remains explicit.
    maxSnapshots: 0
    maxStorageBytes: 0
    shadowStore: false
    autoPrune: false
    # 0 disables automatic age retention; e.g. 604800000 = 7 days.
    retentionMaxAgeMs: 0
    workspaceLockTimeoutMs: 30000
    maxQuarantineBytes: 0
    # Optional: env var name containing the quarantine encryption key.
    quarantineEncryptionKeyEnv: ''
    # Preview plans are single-use and expire after 15 minutes by default.
    restorePlanTtlMs: 900000
    # 0 disables capture-size guards.
    maxSnapshotFileBytes: 0
    maxSnapshotBytes: 0
```

Web dashboard 只绑定 loopback，并拒绝非本机 Host 和跨 origin 请求。`/tm-rewind` 与 `/tm-fork` 需要宿主提供 `sessionController`，否则插件会拒绝只恢复文件的危险降级行为。
集成方可读取带有 `version: 1` 的 `GET /api/capabilities`，提前判断当前工作区是否支持 Git 三方 merge、selective restore、shadow store、quarantine 加密，以及 sparse checkout/submodule/进行中操作限制；返回的 `policies` 还公开 restore 模式、快照/存储/quarantine 配额、自动保留年龄和锁等待上限，便于 UI 在操作前解释边界；`workspaceIsolation: shared-lock` 明确表示当前是共享工作区加锁，不是独立 worktree/container。

## Verification

```bash
pnpm test
pnpm test:release
pnpm benchmark
# Scale the fixture for larger repositories:
TM_BENCH_FILE_COUNT=1000 TM_BENCH_TURNS=5 pnpm benchmark
```

如果本地有从源码构建的 DSH，可验证真实宿主加载（不会调用模型）：

```bash
TM_DSH_SOURCE=/path/to/deepseek-harness pnpm smoke:dsh:source
```

要验证真实 OpenAI-compatible endpoint 的文件创建、重启续接和工具失败记录，额外设置 `TM_DSH_LIVE=1`、`TM_DSH_LIVE_RESTART=1`、`TM_DSH_LIVE_TOOL_FAILURE=1`、`TM_GEMINI_BASE_URL`、`TM_GEMINI_MODEL` 和 `TM_GEMINI_API_KEY`。测试会使用临时 `DSH_HOME` 与临时工作区，不会修改当前仓库。

## Notes

- 当前一个插件实例管理一个启动时 `workDir`；不同 session `cwd` 会被跳过。
- 默认模式下 Git 快照复用用户仓库的 object database 和私有 refs；需要独立对象目录时开启 `shadowStore`。
- `shadowStore: true` 会把插件新写入的 Git objects 放到 `storageDir/git-shadow/objects`，主仓库 objects 仅作为只读 alternate；这是 opt-in。删除插件 refs 时会清理 shadow loose objects；显式 `--repack-shadow` 会按私有 refs 重建 pack，但不会改写或执行用户仓库的全局 Git GC。
- 工作区变更操作带有跨进程文件锁；`workspaceLockTimeoutMs` 控制等待其他 DSH 实例的最长时间。它能避免并发覆盖，但不会替代为多个 Agent 创建独立 worktree。
- `maxQuarantineBytes` 可选限制 ignored 文件 quarantine 的总容量；超过上限时返回 `QUARANTINE_QUOTA_EXCEEDED`，不会丢弃备份。
- `quarantineEncryptionKeyEnv` 可选指定一个环境变量名；启用后 ignored-file quarantine 使用 AES-256-GCM 加密，密钥本身不会写入 DAG、manifest 或 Git refs。缺少密钥、密文损坏或发现旧的明文 quarantine 会返回 `QUARANTINE_KEY_INVALID` 并保留备份，不会静默删除或混用数据；明文迁移必须由运维显式执行。
- `maxSnapshotFileBytes` 和 `maxSnapshotBytes` 在捕获前限制单文件与单 checkpoint 的 regular-file 总大小；超过限制返回 `SNAPSHOT_SIZE_LIMIT`，不会创建半成品 checkpoint。默认均为 0（不限制），而存储目录总量仍由 `maxStorageBytes` 控制。
- `/tm-prune --older-than=7d` 提供显式的时间保留策略；它只让超过阈值且不受 DAG head/ancestor 保护的节点进入清理候选，不会自动运行，也不会删除当前分支所需的历史。
- 如需自动生命周期治理，可设置 `retentionMaxAgeMs`；它只在创建普通 checkpoint 前运行，并沿用 DAG 保护规则。自动策略默认关闭，避免用户在未察觉时丢失探索历史。

### 性能边界（合成基准）

`pnpm benchmark` 默认使用 100 个文件，也可以通过
`TM_BENCH_FILE_COUNT` 和 `TM_BENCH_TURNS` 放大 fixture。当前本机结果为：

| 文件数 | Git 快照延迟（相对传统复制） | Git 对象存储（相对传统复制） |
| ---: | ---: | ---: |
| 100 | 约 6.4× | 约 0.1× |
| 1,000 | 约 2.1× | 约 0.2× |
| 10,000 | 约 3.6× | 约 0.4× |

这是可重复的合成 TypeScript 文件基准，不代表所有真实仓库。Git 方案用延迟
换取不可变历史、分支安全和更低的增量存储；10k+ 文件的全量工作区扫描仍是
已知 P1 瓶颈；当前仅对完全 clean 的 Git worktree 做保守树复用，任何 staged、
modified 或 untracked 文件都会禁用复用。后续更广泛的增量缓存必须以 HEAD、
index、ignored 集合和 protected paths 变化为失效条件，不能牺牲快照完整性。
- `/tm-preview` 和 Web 预览会签发一次性、会话绑定的 restore plan；Web rewind 会把 plan 一并提交，若预览后工作区、活动 checkpoint、Git HEAD/branch/进行中操作或 plan TTL 发生变化，服务返回 `RESTORE_PLAN_INVALID`（HTTP 409）并要求重新预览。`restorePlanTtlMs: 0` 可关闭过期时间，但 plan 仍只能消费一次。
- 多文件恢复提供 rescue/compensation 和崩溃后 journal 恢复，但文件系统本身没有跨文件 ACID 事务。
- Git sparse checkout、submodule 和 merge/rebase/cherry-pick 进行中状态会被明确识别并拒绝创建/预览/恢复 checkpoint（`UNSUPPORTED_WORKSPACE_STATE`），避免把不完整工作区误报为可回滚快照；请先完成操作或使用普通 worktree。
- 当前 manifest 只声明 `web` profile；原生 TUI 不在兼容承诺范围内。
- Hermes Agent v2 已有自己的 checkpoint/rollback；本插件适合需要 DSH Session fork、DAG 探索或失败反思的场景。

问题定义、设计取舍、同类能力对照、社区路线图和完整验收矩阵见 [docs/PROBLEM.md](docs/PROBLEM.md)、[docs/COMPARISON.md](docs/COMPARISON.md)、[docs/ROADMAP.md](docs/ROADMAP.md)、[DESIGN.md](DESIGN.md) 和 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。

## License

MIT
