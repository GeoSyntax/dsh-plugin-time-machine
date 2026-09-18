# dsh-plugin-time-machine 测试与验收计划

本计划的目标不是证明“某个函数返回了预期值”，而是证明插件在 DSH 的真实生命周期中能够保持：

> 会话状态、工作区文件状态、DAG 分支和失败反思在 checkpoint 边界上保持一致，并且回滚不会产生不可逆的数据损失。

## 1. 发布结论和门禁

### P0 必须通过

1. **真实宿主加载**：DSH 源码宿主和声明的发布宿主都能加载插件；本插件 manifest 当前只声明 `web` profile，不承诺原生 TUI。
2. **边界 checkpoint**：每个 turn 在 agent 执行前创建 checkpoint，turn 结束后正确记录 `success`、`failed` 或 `aborted`。
3. **安全回滚**：默认模式检测工作区漂移；未获得显式 `--force` 时不得覆盖用户在 checkpoint 后的修改。
4. **完整清理**：回滚会删除 checkpoint 后创建的受管文件；新增 ignored 文件默认不删除，显式删除时进入 quarantine。
5. **分支保留**：从旧 checkpoint rewind/fork 后，原探索分支仍可查询，不能被破坏性覆写。
6. **会话补偿**：物理恢复成功但 DSH Session fork 失败时，能够通过 rescue checkpoint 恢复原工作区。
7. **安全边界**：不越出 workspace 删除文件；插件存储目录、用户 Git index 和 Git 普通提交历史不被污染。
8. **发布可复现**：构建产物、依赖审计、打包内容和真实 DSH smoke 全部通过。

任何 P0 失败都阻止公开发布。

### P1 应通过

- Web Dashboard 的 DAG、Diff、Rewind、Fork API 与 CLI 命令行为一致，并显示 safe restore 的冲突路径。
- Git 与非 Git fallback 的核心语义一致。
- Windows、Linux、macOS、Node 22、Node 24 的构建和核心行为一致。
- 长会话、重复 checkpoint、并发操作和异常中断不会损坏 DAG 元数据。
- 多进程实例共享同一 storageDir 时，跨进程锁串行化工作区变更；超时和死锁 owner 可诊断恢复。

### P2 观察项

- 大仓库性能、超大文件、符号链接、大小写敏感路径。
- 模型网关延迟、流式响应中断和 API 重试。
- Web UI 视觉回归和长期存储压缩。

## 2. 测试环境矩阵

| 环境 | 用途 | 是否阻断发布 |
|---|---|---|
| Node 22 + Ubuntu | 完整单测、集成、真实 DSH smoke | 是 |
| Node 24 + Ubuntu | 兼容性回归 | 是 |
| Node 22/24 + Windows | 构建、打包、平台路径检查；Git plumbing 需单独记录 runner 版本 | 是（构建）；行为测试按 Git 版本标注 |
| DSH `0.1.5-rc.2` | 当前声明兼容宿主 | 是 |
| DSH 源码 `0.1.6-alpha.1` | 前沿宿主兼容性 | 是（发布前至少一次） |
| 本地 OpenAI-compatible 网关 | 真实模型链路 | 发布前验收，不作为无密钥 CI 门禁 |

所有测试使用临时 `DSH_HOME`、临时 workspace 和临时 Git 仓库。API key 只通过环境变量注入，日志、artifact 和断言中禁止出现密钥原文。

## 3. 测试分层

### L0：静态与构建门禁

| ID | 验证项 | 证据 |
|---|---|---|
| B-01 | TypeScript 构建成功 | `pnpm build` |
| B-02 | 全部自动化测试通过 | `pnpm test` |
| B-03 | 打包内容只包含声明文件 | `pnpm pack --dry-run` |
| B-04 | 依赖无 high/critical 漏洞 | `pnpm audit --prod --audit-level=high` |
| B-05 | 构建后的 `dist` 与提交内容一致 | CI `git diff --exit-code -- dist/...` |
| B-06 | DSH bundle 能发现插件 | `pnpm smoke:dsh` 或源码 DSH 等价命令 |
| B-06a | 本地发布门禁一次性通过 | `pnpm test:release` |
| B-07 | 本地 DSH 源码宿主加载插件 | `TM_DSH_SOURCE=... pnpm smoke:dsh:source` |
| B-08 | 本地 OpenAI-compatible 模型驱动真实 turn | `TM_DSH_LIVE=1 TM_GEMINI_API_KEY=... pnpm smoke:dsh:source` |
| B-09 | 同一 DSH_HOME/workspace 重启并保留 DAG | `TM_DSH_LIVE=1 TM_DSH_LIVE_RESTART=1 TM_GEMINI_API_KEY=... pnpm smoke:dsh:source` |
| B-10 | 真实 DSH Web 宿主 session + checkpoint + fork + rewind | `TM_GEMINI_API_KEY=... pnpm smoke:dsh:web` |
| B-11 | 真实 DSH 模型端点失败仍持久化 failed checkpoint 和错误证据 | `TM_DSH_SOURCE=... pnpm smoke:dsh:failure` |
| B-12 | 真实 DSH 工具失败事件提取为 `failedTools` | `TM_DSH_LIVE_TOOL_FAILURE=1 TM_GEMINI_API_KEY=... pnpm smoke:dsh:source` |
| B-13 | 本地发布门禁包含跨进程锁回归和 shadow loose/packed-object 回收 | `pnpm test:release` |

### L1：纯逻辑单元测试

必须覆盖以下模块，并且每个断言都检查状态和副作用，而不仅是返回值：

- `git-plumbing`：tree、commit、隔离 index、删除新增文件、保留用户 staged index、保护路径。
- `fallback-engine`：未初始化 Git 时的快照、恢复、备份和路径安全。
- `dag-manager`：root、parent、fork、游标、分支拓扑、持久化重载。
- `reflection-advisor`：失败 stderr 提取、重复失败提示、无失败时不注入内容。
- `service`：双轨 checkpoint、safe/force、rescue、ignored quarantine、进程内/跨进程操作锁、shadow 回收。
- `service`：checkpoint prune 后仅清理无 DAG 引用的 quarantine，仍被 rescue 节点引用的备份必须保留。
- `git-plumbing`：quarantine 达到 `maxQuarantineBytes` 时拒绝删除并保留原文件。
- `git-plumbing` / `fallback-engine`：`maxSnapshotFileBytes` 与 `maxSnapshotBytes` 在复制/写入前拒绝超限文件或 checkpoint，不能留下半成品。
- `service`：显式 `olderThanMs` 只清理超过时间阈值且不受 DAG head/ancestor 保护的节点；未提供阈值时行为与旧版本一致。
- `service`：preview plan 必须绑定 session/checkpoint、在工作区漂移或重复消费时 fail closed，并覆盖 TTL 配置。
- `git-plumbing`：sparse checkout、submodule gitlink 和 merge/rebase/cherry-pick 进行中状态必须报告 `UNSUPPORTED_WORKSPACE_STATE`，不能创建或恢复不完整快照。
- `web-server`：status/dag/diff/rewind/fork、非法 JSON、非 loopback、Origin 校验。

### L2：状态机与性质测试

使用随机但可复现的操作序列，模型状态与实际文件系统状态同时推进：

```text
create-file → modify-file → add-ignored → checkpoint → fork
             → modify → rewind → force-rewind → reload
```

每一步检查：

1. 当前 DAG head 与当前 branch 一致。
2. 当前 workspace tree hash 等于节点记录，或 safe 模式明确报告 drift。
3. `refs/dsh-tm/*` 可重载，普通 `git log` 不变。
4. `.dsh/time-machine`、`.dsh-tm` 等保护路径从 workspace tree 排除。
5. 操作重复执行不会产生第二个不可解释的状态。

## 4. 核心验收场景

### TM-01：最小成功回滚

1. 初始 Git 仓库只有 `README.md`。
2. turn 1 修改 `app.ts`，自动创建 checkpoint。
3. turn 2 修改 `app.ts` 并新增 `feature.ts`。
4. rewind 到 turn 1。

预期：`app.ts` 回到 turn 1，`feature.ts` 被删除，DAG 保留两个节点，普通 Git index 和 `git log` 不变。

### TM-02：孤儿文件清理

在 turn 2 创建：

- 未跟踪普通文件
- 未跟踪目录
- ignored 私钥文件
- ignored cache 目录

预期：普通受管文件回滚时物理删除；ignored 文件默认保留并阻止危险覆盖；使用 `--delete-new-ignored` 后先 quarantine 再删除；再次恢复 rescue checkpoint 能还原 ignored 内容。

### TM-03：安全漂移拒绝

checkpoint 后由用户手动修改受管文件、staged 文件和 ignored 文件，然后执行 safe rewind。

预期：返回 `WORKSPACE_DRIFT`，错误中列出 expected/observed tree 和 changed paths；任何文件不得被覆盖。

### TM-04：显式 force

在 TM-03 状态下使用 `--force`。

预期：只有显式 force 才允许覆盖受管文件；ignored 文件仍遵循是否显式删除和 quarantine 的策略；结果包含删除清单。

### TM-05：平行分支探索

从 turn 1 fork 出 `hotfix/clean`，在新分支制造另一套修改，再查询原 branch 和新 branch。

预期：两个 branch 都可见；旧节点 commit/tree 不变；新分支的恢复不会覆写旧分支的 DAG 记录。

### TM-06：失败反思

让 turn 2 执行会失败的命令并记录 stderr，然后从 turn 1 fork。

预期：新分支结果包含失败摘要和建议；原始失败不会被静默删除；反思内容只作为 review material，不自动修改系统提示词。

### TM-07：Session fork 失败补偿

注入 `sessionController.fork()` 一次性失败：

1. 先完成物理恢复和 rescue checkpoint。
2. 让 fork 抛错。
3. 检查补偿路径。

预期：工作区恢复到调用 rewind/fork 前的状态；rescue 节点仍可查询；错误同时保留原始 fork 错误和补偿结果。

### TM-08：进程中断与重启

在 checkpoint 写入、DAG 持久化和 Web API 操作的不同阶段终止进程，重新启动同一 `DSH_HOME`。

预期：最后一个完整 checkpoint 可加载；半写文件不会破坏已有 DAG；重复恢复是幂等的。

### TM-09：非 Git fallback

在没有 `.git` 的临时目录运行同一组基础场景。

预期：插件明确进入 fallback 能力边界；仍能安全创建/恢复快照；README 中声明的 Git-only 能力不会伪装成可用。

### TM-10：路径与权限安全

覆盖：`..` 路径、workspace 外 symlink、只读文件、同名文件/目录冲突、Windows 路径分隔符、大小写变化。

预期：拒绝越界删除；错误可解释；不会跟随 workspace 外 symlink；临时 index 和 quarantine 在异常后清理。

## 5. 真实 DSH 验收流程

这是发布前必须人工或自动保存证据的一组测试，不能由纯 service 单测替代。

### DSH-01：宿主安装与配置

```powershell
$env:DSH_HOME = '<temp-home>'
node <dsh-source>/apps/cli/lib/bin.js plugin --profile tm-live add <plugin-repo>
node <dsh-source>/apps/cli/lib/bin.js --profile tm-live --dump-config
```

验收：dump 中出现 `dsh-plugin-time-machine`，profile 能正常启动，Web Dashboard 返回 `/api/status`。

### DSH-02：真实模型驱动文件变更

使用 OpenAI-compatible 本地网关，要求模型执行：创建文件、修改文件、创建 ignored 文件，并在响应中确认结果。

验收：

- 模型请求成功。
- agent 执行前产生 checkpoint。
- turn 结束状态为 `success`。
- checkpoint 的 tree 不包含插件自己的 `.dsh` 存储。
- DSH session log 不包含 API key。

### DSH-03：真实 `/tm-tree`

在同一个 Web session 执行 `/tm-tree`。

验收：输出包含当前 session 的 DAG、checkpoint id、当前 branch 和节点状态。

### DSH-04：真实 `/tm-rewind`

模型完成第二次修改后，执行 `/tm-rewind <checkpoint>`。

验收：

- Web/CLI 返回新的 forked session id。
- 工作区回到目标 checkpoint。
- 原 session 的历史仍可查询。
- 新 session 的 message 边界与目标 checkpoint 对齐。

### DSH-05：真实 `/tm-fork`

从旧 checkpoint 执行 `/tm-fork <checkpoint> <branch>`，在新会话中继续修改。

验收：原 branch 和新 branch 均保留，且新修改只出现在新 branch。

### DSH-06：真实失败与补偿

让模型执行一个确定失败的命令，随后模拟 session fork 失败或中断浏览器连接。

验收：失败节点有错误摘要，rescue checkpoint 可恢复，工作区不进入未知状态。

`test/smoke-dsh-web.mjs` 还包含一条真实宿主拒绝路径：为不存在于 DSH 的 session 持久化插件 checkpoint，调用 Web fork 触发真实 `SessionController` 的 `session/not-found`，再验证 rescue 补偿恢复调用前工作区。该路径仍需要有效模型网关密钥，因为同一 smoke 先建立真实会话。

## 6. Web API 验收矩阵

| Endpoint | 正常用例 | 异常用例 |
|---|---|---|
| `/api/status` | 返回 online、workspace、version | 服务停止后连接失败 |
| `/api/dag` | 返回指定 session DAG | 不存在 session、默认 session |
| `/api/diff` | 两 checkpoint diff | 空 id、无效 id |
| `/api/rewind` | safe、force、delete ignored | 非法 JSON、缺 checkpoint、无 sessionController |
| `/api/fork` | 新 branch、description | 重名 branch、缺参数、fork 失败补偿 |

所有 Web API 还要验证：非 loopback Host 返回 403、跨 origin 返回 403、请求体超过 64 KiB 被拒绝、错误响应不泄漏密钥或绝对敏感路径。

## 7. 性能和可靠性基线

发布前记录以下基线，不设过早的绝对性能承诺：

- 100、1,000、10,000 文件 workspace 的 checkpoint/inspect/restore P50/P95。
- 100 个 checkpoint、20 个 branch 的 DAG reload 时间。
- 100 次连续 safe rewind/fork 的失败率和存储增长。
- 10 MB、100 MB、1 GB 文件的行为和峰值内存。
- 并发请求同一 workspace 时，`KeyedOperationLock` 是否保持串行一致性。

性能测试必须使用独立临时仓库，不得污染开发仓库。

## 8. 证据包格式

每次发布候选版本保存：

```text
artifacts/<run-id>/
  environment.json       # OS, Node, Git, DSH commit/version
  test-summary.json      # 每个测试 ID 的 pass/fail/skip
  dsh-config.txt         # 脱敏后的 dump-config
  session-events.jsonl   # 脱敏后的 session 事件
  dag-before.json
  dag-after.json
  git-refs.txt
  git-status-before.txt
  git-status-after.txt
  api-transcript.json    # 删除 Authorization、API key、用户路径
```

证据包只能保留脱敏数据；发现 secret 时整包作废并重新执行。

## 9. 当前状态与剩余缺口

当前已经有证据：

- L1 核心测试 23/23 通过；新增 DSH durable `tool/call`/`tool/result` 失败配对、反思输入提取、失败 fork 点反思，以及 Web fork 失败补偿测试。
- Git 与 fallback 恢复完成后均执行工作区摘要校验；持久化 DAG 加载会校验节点、父节点、分支和会话归属。
- 真实 DSH 源码宿主加载插件通过。
- 真实本地模型请求、文件创建、turn 结束后的 finalized checkpoint 落盘通过。
- 使用同一 `DSH_HOME` 与 workspace 的 live restart 测试通过，第二次运行保留并新增 DAG checkpoint。
- live restart 还验证每个持久化节点的 `sessionState.sessionId` 与 DAG 所属 session 一致，且原 session DAG 未丢失。
- 真实 DSH Web 宿主通过 `session/create`、`session/prompt` 驱动 turn，并完成真实 `/api/fork` 与 `/api/rewind`。
- 同一真实 Web session 中，失败工具证据会在从失败 checkpoint 分叉时进入 `reflectionAdvisory`。
- 真实 DSH 不可达模型端点会产生并持久化 `failed` checkpoint，且保留错误证据。
- 真实 DSH 强制执行退出码非零的 shell 命令后，checkpoint 持久化了 `failedTools` 证据。
- 真实 DSH Web smoke 在 Windows 上通过有效本地网关完成真实 turn、fork、rewind，并触发真实缺失 session 的 `SessionController` fork 拒绝；rescue 补偿恢复了 fork 调用前工作区。
- Web UI 在 fork/rewind 后采用服务端返回的新 conversation sessionId，后续 DAG 查询不再使用旧会话。
- CLI 命令注册层已自动化覆盖 `/tm-tree`、`/tm-fork`、`/tm-rewind`，包括 sessionController 返回的新会话身份和工作区恢复。
- `turn/end` 生命周期会从 DSH 持久事件中提取失败工具、输入和错误原因，并传入 checkpoint 反思顾问；已用接近真实 DSH 消息结构的单元测试覆盖。
- 真实 checkpoint DAG 和 Dashboard status/dag 通过。
- Web API rewind/fork、Host/JSON 安全、Session fork 失败补偿和重启 DAG 持久化已有自动化覆盖。

仍需补齐的 P1/P2 证据：

1. 原生 TUI 不在当前 manifest 兼容范围内；如未来声明支持，需要单独增加 TUI 宿主矩阵。
2. 长会话、并发操作、进程中断和大仓库性能基线仍应作为后续版本的专项验收，不作为当前 Web profile 的 P0 发布阻断项。

注：原生 TUI 不属于当前 manifest 的兼容范围；真实 Web smoke 已覆盖插件 REST API 的 fork/rewind 与宿主 SessionController，CLI 命令层则由注册契约测试覆盖。

P0 门禁与当前声明的 Web profile 集成证据已经全部通过；当前版本可标记为 **release-qualified for the declared Web profile**。上述 TUI、长会话/并发、进程中断和性能项目仍属于后续 P1/P2 验收，不应扩大当前兼容承诺。

## 10. 推荐执行顺序

```text
L0 构建门禁
  → L1 单元/服务测试
  → L2 状态机与故障注入
  → DSH-01 宿主加载
  → DSH-02 真实模型 turn
  → DSH-03/04/05 Web 命令
  → DSH-06 失败补偿
  → 重启恢复与性能基线
  → 脱敏证据包审查
  → 发布决定
```
