# DSH Time Machine

为 DeepSeek Harness 提供工作区回滚、会话分叉和失败反思

在 DSH 的 session fork 边界上同步工作区状态，让你可以安全试错、回到旧 checkpoint，并保留被放弃分支。

## Install

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

当前发布目标是 DSH `>=0.1.5-rc.2 <0.2.0` 的 `web` profile，要求 Node.js `^22.19.0 || >=24.0.0`。仓库会提交预构建的 `dist/`，GitHub dependency 安装不需要构建插件。

当前版本尚未发布到 npm；在 npm release 完成前请使用上面的 GitHub 安装方式。发布后可改用：

```bash
dsh plugin --profile web add npm:dsh-plugin-time-machine
```

原生 Web UI companion 单独发布为 `dsh-plugin-time-machine-client`，需要与
目标 DSH Web client 版本匹配；它不会被主服务包自动安装。源码开发和发布
步骤见 [`client-companion/README.md`](client-companion/README.md) 与
[`docs/RELEASING.md`](docs/RELEASING.md)。

## Quickstart

在目标工作区执行：

```bash
dsh --profile web --dump-config
dsh --profile web
```

如果使用仓库源码安装，请将以下内容保存为该 profile 的
`cordis.patch.yml`（插件目录来自上面的 GitHub dependency）：

```yaml
plugins:
  - id: time-machine
    package: dsh-plugin-time-machine
    config:
      autoSnapshot: true
      restoreMode: safe
      enableWebUI: true
```

重启 DSH 后，可用下面的命令确认插件已加载：

```bash
dsh plugin --profile web list --depth 0
```

问题背景、威胁模型和明确的 non-goals 见 [`docs/PROBLEM.md`](docs/PROBLEM.md)。

在 DSH 会话中使用：

```text
/tm-tree
/tm-storage
/tm-agent-writes <checkpoint>
/tm-unattributed <checkpoint>
/tm-prune [keep-latest] [--older-than=<7d|12h|30m>]
/tm-prune [keep-latest] --repack-shadow
/tm-quarantine-migrate <backup-key>
/tm-external-compensate <checkpoint> <effect-id> [--execute]
/tm-external-record <checkpoint> <adapter> <operation> --failure=<text> [--reversible]
/tm-preview <checkpoint>
/tm-restore-files <checkpoint> <path...> [--plan=<id>]
/tm-fork <checkpoint> <branch>
/tm-list [limit]             # show recent active-lineage checkpoints
/tm-undo [count]             # undo the latest turn(s) by relative position
/tm-rewind <checkpoint> [--preserve-hand-edits|--no-preserve-hand-edits] [--plan=<id>]
```

插件会在每个 turn 开始前创建 checkpoint。`/tm-tree` 显示当前 DAG；`/tm-list` 以 `0=current`、`1=undo 1` 的相对编号列出活动 lineage；`/tm-preview` 在不修改文件的情况下列出回滚影响；`/tm-restore-files` 只恢复指定路径并保持当前会话不变；`/tm-fork` 从旧状态创建平行会话；`/tm-rewind` 恢复工作区并通过 DSH `sessionController` 创建对齐的新会话；`/tm-undo [count]` 是面向用户的快捷别名，按当前活动分支向前回退 count 个已完成 turn（默认 1），会忽略同一 turn 的 pre-command 和 rescue 内部节点，底层仍使用同一套 safe restore、rescue 和 fork 语义。Web 仪表盘的 rewind 也会先执行同样的预览。

## What you can do

- **试验平行方案:** 从任意 checkpoint 创建命名分支，原分支和失败证据继续保留。
- **安全回滚工作区:** Git 后端使用隔离 index 和私有 `refs/dsh-tm/*`，不改写普通 branch、log 或用户 staging index。
- **清理孤儿文件:** 恢复目标树时删除 checkpoint 后产生的受管新增文件和目录。
- **保护 ignored 内容:** ignored 文件默认不删除；显式 `--delete-new-ignored` 时先进入 quarantine，再允许清理并支持从 rescue checkpoint 恢复。
- **回顾失败原因:** failed turn、stderr 和失败工具会生成 fork 前的 reflection advisory，减少重复踩坑。
- **运行在非 Git 目录:** fallback 后端使用 manifest 和内容哈希快照，支持普通文件、目录和 symlink。
- **先看再回滚:** Git 和非 Git fallback 都提供 checkpoint 间文本 diff（binary 文件显示 binary marker）；preview 还会列出导致 safe restore 拒绝覆盖的 `conflictingPaths`。
- **显式三方合并恢复:** `/tm-rewind <checkpoint> --merge`（Web API 传 `merge: true`）以当前 checkpoint 为 base，保留与目标快照不冲突的本地修改；同一路径双方都改动时返回 `RESTORE_MERGE_CONFLICT`，默认 safe 模式行为不变。该模式要求 Git 工作区。
- **选择性恢复:** `/tm-restore-files` 只写入指定文件/目录，并创建 rescue 和结果 checkpoint；它不会伪造会话回滚。
- **存储治理:** `/tm-storage` 查看插件目录占用；`/tm-prune` 默认只删除不属于 current/branch head 且没有子节点的旧叶子节点，并清理已无 DAG 引用的 ignored quarantine；明确传入 `--abandoned-branches` 才会删除非当前探索分支；明确传入 `--compact-history` 才会压缩旧线性节点并重新挂接子节点。Git object 是共享的，删除私有 ref 不会自动执行危险的全仓库 GC。
- **Shadow pack 维护:** `shadowStore: true` 时，显式传入 `--repack-shadow`（或 Web API `repackShadowObjects: true`）会仅根据 `refs/dsh-tm/*` 重建 shadow pack，并删除旧的不可达 pack；不会运行用户仓库的全局 GC。
- **崩溃恢复:** rewind/fork/选择性恢复会写入 durable restore journal；插件下次启动时如果发现未完成操作，会先恢复 rescue checkpoint，再清理 journal。
- **可验证的人工修改保留（显式 opt-in）:** 开启 `enableAgentWriteLedger` 后，插件会从 DSH 原生 `fs/observed` + `tools/result` 事件自动登记 `write`、`edit`、`str_replace_editor` 的成功写入；删除事件也会登记为 `delete`，使用确定性的 absent tombstone 哈希。其他集成也可调用 `recordAgentWrite()` 登记路径和 SHA-256。`/tm-rewind --preserve-hand-edits` 只保留登记哈希已经变化的路径。未登记路径不会被猜测为人工修改，哈希缺失或账本损坏仍然 fail-closed。
- **可选的 Hermes 风格默认保留:** 设置 `preserveVerifiedHandEditsByDefault: true` 会自动启用 Agent-write ledger，并在未显式传入 `--preserve-hand-edits` 时保留账本已验证、后来发生人工修改的路径；CLI 可用 `--no-preserve-hand-edits`，Web/API 可传 `preserveVerifiedHandEdits: false` 恢复严格覆盖语义。默认值为 `false`，因此现有安全策略不变。
- **账本可审计:** 时间线检查点详情、CLI `/tm-agent-writes <checkpoint>` 与只读 `GET /api/agent-writes?sessionId=...&checkpoint=...` 暴露已验证的路径、操作、SHA-256 和时间戳，便于在回滚前解释哪些内容由 Agent 写入。
- **未归因变更显式告警:** turn 结束时 Git 或 fallback manifest 会对比 checkpoint 起点与 settled workspace；没有对应 Agent-write 证据的路径会记录为 `unattributedChanges`，并在时间线中标记。插件不会把这类 bash/PTC/人工修改猜成 Agent 写入。
- **未归因变更可查询:** CLI `/tm-unattributed <checkpoint>` 与 `GET /api/unattributed-changes?sessionId=...&checkpoint=...` 提供机器可读的只读清单。
- **硬配额:** `maxSnapshots` 和 `maxStorageBytes` 默认关闭；启用后达到上限会安全拒绝新 checkpoint，不会静默删除历史。
- **自动配额清理:** `autoPrune: true` 才会在普通 checkpoint 前尝试压缩旧节点；无法安全腾出空间时仍然拒绝 checkpoint，不会强行删除 current 或 branch head。
- **自动年龄保留:** `retentionMaxAgeMs` 大于 0 时，普通 checkpoint 前会自动压缩超过该年龄的非 current、非 branch head 节点；默认关闭，内部 rescue checkpoint 不触发清理。
- **明文 quarantine 迁移:** 启用 `quarantineEncryptionKeyEnv` 后，`/tm-quarantine-migrate <backup-key>` 或 `POST /api/quarantine-migrate` 可显式把旧明文备份转换为 AES-256-GCM；迁移失败会保留原目录，插件不会自动混用明文。
- **显式部分快照（谨慎启用）:** 同时设置 `allowPartialSnapshots: true` 与快照大小上限后，超限 regular file 会记录在 checkpoint 的 `omittedPaths` 中并从不可变树排除；恢复时保留该路径的实时内容，不会假装已捕获。默认仍然拒绝超限快照并返回 `SNAPSHOT_SIZE_LIMIT`。
- **外部副作用补偿边界:** 集成方可注册命名 compensation adapter；`/tm-external-compensate` 和 `POST /api/external-effects/compensate` 默认只 dry-run，只有显式 `--execute`/`execute: true` 才调用适配器。核心持久化幂等 key、结果和 unknown 状态，但不替适配器管理认证或远程事务。
  dry-run 即使 adapter 尚未加载也会返回 `adapterAvailable: false` 的结构化告警；只有真正执行时才会因缺少 adapter 拒绝请求，并返回 `EXTERNAL_ADAPTER_UNAVAILABLE`（Web HTTP 409）。
- **外部副作用登记 API:** companion 集成可通过 `POST /api/external-effects` 声明 adapter、操作、可逆性和失败语义；该接口只写入审计账本，不会调用远程系统，成功返回 HTTP 201。
- **审计 ID 唯一性与输入边界:** 外部 effect 若显式提供已存在的 `id` 会以 `EXTERNAL_EFFECT_DUPLICATE` 拒绝（HTTP 409），避免补偿目标歧义；Web `/api/rewind` 与 `/api/fork` 缺少 `checkpointId`/`branchName` 时返回 HTTP 400，而不是把客户端输入错误伪装成服务端故障。
- **高风险工具前置边界（可选）:** 设置 `autoPreCommandSnapshot: true` 后，插件会在 DSH `tools/pre-execute`（并以 `tools/execute` 作为后备）进入原生文件工具 `write`、`edit`、`str_replace_editor`，以及 `bash`、`shell`、`pwsh`、`terminal_bash`、`terminal_exec`、`run_code`、`python` 前创建带 `pre-command` 标签的 checkpoint；同一 callId 会去重。可通过 `preCommandTools` 收紧或扩展工具集合。该能力只覆盖经过 DSH waterfall 的工具，不会拦截宿主外部手工 shell。
- **无 callId 宿主兼容:** 若某个 DSH 适配器没有提供 `callId`，插件会按 execution 对象身份去重同一次调用跨越的两个 waterfall；不同的匿名 execution 不会因工具名相同而被错误合并。
- **多 Session Dashboard:** `GET /api/sessions` 会列出已持久化的真实 DSH session；Dashboard 默认选择最近更新的 session，也支持 `?sessionId=...` 和下拉切换，不会因访问空页面制造 `default` 时间线。
- **Session 边界一致性:** `/api/preview`、`/api/diff`、`/api/rewind`、`/api/fork`、`/api/restore-files`、`/api/prune`、`/api/storage` 及账本查询都要求显式且已持久化的 `sessionId`；未知会话统一返回 `404 SESSION_NOT_FOUND`，不会隐式创建幽灵 `default` 会话。
- **宿主会话核验:** 在 DSH profile 提供 `sessionController.inspect` 时，Dashboard 会过滤已被宿主删除的孤儿 checkpoint session，恢复类 API 也会在执行前再次核验宿主会话。
- **浏览器请求防护:** 除 Host/Origin 围栏外，未显式 allowlist 的 `Sec-Fetch-Site: cross-site` 请求也会被拒绝，降低无 Origin 跨站 POST 的 CSRF 风险。
- **完整工作区恢复而不分叉会话:** `/tm-restore <checkpoint>` 或 `POST /api/restore-workspace` 可将整个工作区恢复到 checkpoint，同时保留当前 DSH 对话；需要新对话上下文时再使用 `/tm-rewind`。
- **Companion contract 同步:** `TimeMachineClient` 同步提供 `restoreWorkspaceFromPreview()`，原生 companion 不必绕过一次性 restore-plan 绑定直接拼 HTTP 请求。
- `TimeMachineClient` 也提供 `recordExternalEffect()` 与 `compensateExternalEffect()`，外部副作用默认仍是 dry-run，显式执行和幂等 key 由调用方控制。
- **可诊断的社区安装:** `/tm-doctor` 会检查当前 profile 是否有 `sessionController`、Git/fallback 引擎、Web Dashboard、预命令边界和 Agent-write ledger，并给出可执行的配置警告。

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
    # Optional: exact trusted browser Origins for a separate DSH client companion.
    # Keep empty unless the companion is served from a known local origin.
    webAllowedOrigins: []
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
    # Dangerous compatibility mode: preserve and report files omitted by the limits.
    allowPartialSnapshots: false
    # Optional, disabled by default. Enables integration-supplied Agent-write evidence.
    enableAgentWriteLedger: false
    # Optional. Implies enableAgentWriteLedger and preserves verified hand-edits
    # unless the request explicitly sets preserveVerifiedHandEdits=false.
    preserveVerifiedHandEditsByDefault: false
    # Optional Hermes-style boundary before high-risk DSH tools.
    autoPreCommandSnapshot: false
    preCommandTools:
      - write
      - edit
      - str_replace_editor
      - bash
      - shell
      - pwsh
      - powershell
      - terminal_bash
      - terminal_exec
      - run_code
      - python
    # Match Hermes' one pre-command boundary per turn; 0 means unlimited.
    preCommandMaxPerTurn: 1
```

Web dashboard 只绑定 loopback，并拒绝非本机 Host 和跨 origin 请求。若要让独立的 DSH client companion 跨端口调用 API，必须显式配置 `webAllowedOrigins`；该列表只允许精确的 `http(s)` Origin，默认为空。Dashboard 顶部提供 `Undo latest turn` 快捷操作，它调用与 CLI 相同的 `/api/undo` contract；需要查看冲突和 partial 路径时仍应使用时间线中的 preview/rewind。`/tm-rewind` 与 `/tm-fork` 需要宿主提供 `sessionController`，否则插件会拒绝只恢复文件的危险降级行为。
集成方可读取带有 `version: 1` 的 `GET /api/capabilities`，提前判断当前工作区是否支持 Git 三方 merge、fallback 文本 diff、selective restore、shadow store、shadow 加密、quarantine 加密/迁移、外部副作用账本、增量捕获、Agent-write ledger、pre-command snapshots 和已注册的 compensation adapters，以及 sparse checkout/submodule/进行中操作限制；`handEditPolicy: reject-drift` 表示默认不会猜测文件作者，`ledger-opt-in` 表示已开启显式 Agent-write 账本但仍需传入 `--preserve-hand-edits`，`ledger-default` 表示已启用经账本验证的人工修改默认保留；返回的 `policies` 还公开 restore 模式、快照/存储/quarantine 配额、自动保留年龄、锁等待上限和前置高风险工具集合，便于 UI 在操作前解释边界；`workspaceIsolation: shared-lock` 明确表示当前是共享工作区加锁，不是独立 worktree/container；公开 DSH alpha 返回 `rewindSessionMode: fork`，但支持可选宿主扩展 `sessionController.rewind()` 的环境会报告 `in-place`，并使用原地会话回退。

## Verification

```bash
pnpm test
pnpm test:release
pnpm benchmark
# Scale the fixture for larger repositories:
TM_BENCH_FILE_COUNT=1000 TM_BENCH_TURNS=5 pnpm benchmark
# Machine-readable result for comparison tooling:
TM_BENCH_FORMAT=json TM_BENCH_FILE_COUNT=1000 TM_BENCH_TURNS=5 pnpm benchmark
```

如果本地有从源码构建的 DSH，可验证真实宿主加载（不会调用模型）：

```bash
TM_DSH_SOURCE=/path/to/deepseek-harness pnpm smoke:dsh:source
```

要验证真实 OpenAI-compatible endpoint 的文件创建、Agent-write ledger、重启续接和工具失败记录，额外设置 `TM_DSH_LIVE=1`、`TM_DSH_LIVE_RESTART=1`、`TM_DSH_LIVE_TOOL_FAILURE=1`、`TM_GEMINI_BASE_URL`、`TM_GEMINI_MODEL` 和 `TM_GEMINI_API_KEY`。若要验证高风险工具前置 checkpoint，再设置 `TM_DSH_LIVE_PRECOMMAND=1`；source smoke 会启用 `autoPreCommandSnapshot` 并要求失败 shell turn 持久化 `pre-command` 节点。live fixture 会明确要求模型使用原生 `write` 工具；这只证明一方文件工具的自动归因，不代表 bash/PTC/子进程修改也会被自动归因。测试会使用临时 `DSH_HOME` 与临时工作区，不会修改当前仓库。

## Notes

- 当前一个插件实例管理一个启动时 `workDir`；不同 session `cwd` 会被跳过。
- 默认模式下 Git 快照复用用户仓库的 object database 和私有 refs；需要独立对象目录时开启 `shadowStore`。
- `shadowStore: true` 会把插件新写入的 Git objects 放到 `storageDir/git-shadow/objects`，主仓库 objects 仅作为只读 alternate；这是 opt-in。删除插件 refs 时会清理 shadow loose objects；显式 `--repack-shadow` 会按私有 refs 重建 pack，但不会改写或执行用户仓库的全局 Git GC。
- Shadow Git objects 当前仍是明文 at rest；`GET /api/storage` 会明确返回 `gitObjectsEncrypted: false`。只有 ignored-file quarantine 可通过 `quarantineEncryptionKeyEnv` 加密，不能把 shadow store 当作加密备份。
- Shadow object 加密仍未实现；安全设计、迁移和崩溃恢复验收边界见 [`docs/ENCRYPTED_SHADOW_DESIGN.md`](docs/ENCRYPTED_SHADOW_DESIGN.md)。插件不会直接改写 Git loose object/pack 字节来伪装加密。
- 工作区变更操作带有跨进程文件锁；`workspaceLockTimeoutMs` 控制等待其他 DSH 实例的最长时间。它能避免并发覆盖，但不会替代为多个 Agent 创建独立 worktree。
- `maxQuarantineBytes` 可选限制 ignored 文件 quarantine 的总容量；超过上限时返回 `QUARANTINE_QUOTA_EXCEEDED`，不会丢弃备份。
- `quarantineEncryptionKeyEnv` 可选指定一个环境变量名；启用后 ignored-file quarantine 使用 AES-256-GCM 加密，密钥本身不会写入 DAG、manifest 或 Git refs。缺少密钥、密文损坏或发现旧的明文 quarantine 会返回 `QUARANTINE_KEY_INVALID` 并保留备份，不会静默删除或混用数据；明文迁移必须由运维显式执行。
- `maxSnapshotFileBytes` 和 `maxSnapshotBytes` 在捕获前限制单文件与单 checkpoint 的 regular-file 总大小；默认均为 0（不限制）。默认超过限制返回 `SNAPSHOT_SIZE_LIMIT`，不会创建半成品 checkpoint；只有显式开启 `allowPartialSnapshots` 才会成功创建带 `omittedPaths` 的部分 checkpoint。部分 checkpoint 永远不会覆盖这些路径，且必须在 UI/CLI 中向用户显示其不完整性。
- 外部副作用补偿默认是 dry-run；执行前必须注册同名 adapter 并显式提供执行标记。适配器应自行完成认证、远程幂等和授权检查；核心会拒绝不可逆声明、重复使用不同 idempotency key，并在适配器失败后把状态保留为 `unknown`。
- `/tm-prune --older-than=7d` 提供显式的时间保留策略；它只让超过阈值且不受 DAG head/ancestor 保护的节点进入清理候选，不会自动运行，也不会删除当前分支所需的历史。
- 如需自动生命周期治理，可设置 `retentionMaxAgeMs`；它只在创建普通 checkpoint 前运行，并沿用 DAG 保护规则。自动策略默认关闭，避免用户在未察觉时丢失探索历史。

### 性能边界（合成基准）

`pnpm benchmark` 默认使用 100 个文件，也可以通过
`TM_BENCH_FILE_COUNT` 和 `TM_BENCH_TURNS` 放大 fixture。当前本机结果为：

| 文件数 | Git 平均延迟（相对传统复制） | Git P50 / P95（ms） | Git 对象存储（相对传统复制） |
| ---: | ---: | ---: | ---: |
| 100 | 2.62× | 642 / 687 | 0.043× |
| 1,000 | 0.50× | 1,259 / 1,381 | 0.090× |
| 10,000 | 0.19× | 2,139 / 2,147 | 0.245× |

这是 2026-09-19 Windows Node 22 的可重复合成 TypeScript 文件基准，不代表所有真实仓库。基准先提交一个
tracked baseline，再模拟每轮只修改 5 个文件；Git 路径会从上一个完整树安全叠加
Git status 报告的变更路径。小仓库仍有 Git 进程启动开销，但在 1k/10k 文件场景
已体现增量捕获收益；完整性仍由 status 路径枚举和临时隔离 index 保证。
在 100 文件、100 个连续 turn 的长会话 fixture 中，Git 路径相对传统复制约
2.76× 平均延迟（P50/P95 为 679/769ms），但对象存储约 0.038×；这说明长期保留的主要收益在存储和历史密度，
而不是小仓库的单轮延迟。
- `/tm-preview` 和 Web 预览会签发一次性、会话绑定的 restore plan；Web rewind 会把 plan 一并提交，若预览后工作区、活动 checkpoint、Git HEAD/branch/进行中操作或 plan TTL 发生变化，服务返回 `RESTORE_PLAN_INVALID`（HTTP 409）并要求重新预览。`restorePlanTtlMs: 0` 可关闭过期时间，但 plan 仍只能消费一次。
- 多文件恢复提供 rescue/compensation 和崩溃后 journal 恢复，但文件系统本身没有跨文件 ACID 事务。
- Git sparse checkout、submodule 和 merge/rebase/cherry-pick 进行中状态会被明确识别并拒绝创建/预览/恢复 checkpoint（`UNSUPPORTED_WORKSPACE_STATE`），避免把不完整工作区误报为可回滚快照；请先完成操作或使用普通 worktree。
- 当前 manifest 只声明 `web` profile；原生 TUI 不在兼容承诺范围内。`autoPreCommandSnapshot` 只对宿主实际派发到 `tools/execute` 的工具生效。
- Hermes Agent v2 已有自己的 checkpoint/rollback；本插件适合需要 DSH Session fork、DAG 探索或失败反思的场景。
- 外部数据库、网络、进程或云资源变更不会被文件恢复假装“回滚”。集成方可调用 `service.recordExternalEffect(...)` 记录 adapter、操作、可逆性、补偿说明和失败语义；这些记录会持久化到 checkpoint，并在 fork 反思中生成警告，但核心不会未经用户批准执行补偿。

问题定义、设计取舍、同类能力对照、社区路线图和完整验收矩阵见 [docs/PROBLEM.md](docs/PROBLEM.md)、[docs/COMPARISON.md](docs/COMPARISON.md)、[docs/ROADMAP.md](docs/ROADMAP.md)、[DESIGN.md](DESIGN.md) 和 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。

DSH 原生消息操作的扩展边界和 companion package 验收条件见
[docs/DSH_NATIVE_UI.md](docs/DSH_NATIVE_UI.md)。主服务包不会把 React client
slot 集成伪装成默认能力；仓库同时提供可选的 `client-companion/` React/slot
包源码。它需要与目标 DSH Web 版本匹配的 client peer dependencies，尚未随
主服务包自动安装；匹配的 DSH alpha client 还会提供 finalized assistant message
上的消息级回滚按钮，无法映射到 checkpoint 的旧消息会自动隐藏。

如果要开发自己的原生 UI companion，可直接复用无依赖的
`TimeMachineClient`（`import { TimeMachineClient } from 'dsh-plugin-time-machine/client'`）。
它提供 status、capabilities、storage、DAG、diff、preview、rewind、fork、选择性恢复和审计读取方法，
其中 `restoreFilesFromPreview()` 与 rewind/fork 一样复用一次性 preview 绑定，
并强制把 `restorePlanId` 绑定到 preview 返回的 session/checkpoint；服务端返回
409 时会抛出带 `status`/`code`/`body` 的 `TimeMachineClientError`。`undo({ sessionId, count })`
提供 CLI-like 的相对 turn 回退；需要向用户展示冲突并确认的 UI 应优先使用
`timeline()` → `preview()` → `rewind()`。`timeline(sessionId)`
还返回 UI 无关的活动 lineage 投影，标记 running、内部安全节点、partial checkpoint、
未归因变更和待审查外部副作用，避免每个 UI 重复实现安全规则。

## License

MIT
