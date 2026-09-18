# dsh-plugin-time-machine

面向 DeepSeek Harness 的第三方社区插件：把工作区检查点、稳定会话边界、DAG 分支和失败反思协调成一次可恢复的操作。

> 当前版本：`0.2.0`（pre-1.0，建议先在非关键仓库试用）。要求 Node.js `^22.19 || >=24`，API 目标为 DSH `>=0.1.5-rc.2 <0.2.0`；真实 DSH 版本矩阵仍在建设中。

[![CI](https://github.com/GeoSyntax/dsh-plugin-time-machine/actions/workflows/ci.yml/badge.svg)](https://github.com/GeoSyntax/dsh-plugin-time-machine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 这个插件真正解决什么

真正的问题不是“如何把几个文件复制回去”，而是 **append-only 的会话历史与持续变化的工作区之间没有共同的回退边界**。

| 只处理一侧会发生什么 | 结果 |
|---|---|
| 只回退工作区 | Agent 仍记得已经不存在的代码、命令结果和错误结论，形成认知/文件 split-brain。 |
| 只 fork 会话 | 后续创建的文件、删除、重命名和缓存仍留在磁盘，新分支并非真正从旧状态开始。 |
| 线性覆盖式 undo | 从第 5 步回到第 2 步时，第 3–5 步的探索证据消失，无法比较或恢复平行方案。 |
| 直接 `git reset` / `git clean` | 可能破坏 staging、用户在 checkpoint 后的手改，以及 ignored 文件中的秘密或缓存。 |
| 文件恢复成功、会话 fork 失败 | 两个状态域永久错位；没有 rescue/补偿就只能手工救援。 |

Time Machine 的定位是 **协调层**：使用 DSH 官方 Session fork 作为会话侧边界，在工作区侧提供可恢复快照，再用 rescue checkpoint 和补偿恢复把两侧尽量保持一致。它不改写 DSH 的 append-only 日志，也不取代日常 Git 提交。

更完整的问题定义、失败模型与取舍见 [docs/PROBLEM.md](docs/PROBLEM.md)；发布前验收矩阵见 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。

## 社区定位：补充，而不是替代

最初的项目说明中“官方完全没有回滚”已经不准确：

- DSH 的 Session 仍是 append-only event log，但官方已经提供 `ctx.sessions.fork(source, boundary)`，可以在稳定的 `turn/end` 边界创建真正的会话分支。Compaction 只改变可见投影，不删除历史事件。
- Hermes Agent v2 已提供 opt-in checkpoints 和 `/rollback`，使用共享 shadow Git store，并默认保留 checkpoint 之后的用户手改。
- `@anionex/dsh-turn-rewind` 已有成熟的 Change Ledger：pre-step 捕获、恢复计划、rescue point、锁、崩溃恢复、ignored collision、symlink 和资源上限都已有覆盖。
- `dsh-retrace` 也在做消息锚点与工件版本的联合回退。

因此本项目不以“行业唯一”或“官方缺失的完整替代品”自居：

- 对 DSH，它补齐官方 Session fork 之外的工作区状态协调；
- 对已经使用 Hermes v2 的用户，官方 `/rollback` 通常是更自然的首选；
- 相比其他社区 rewind 插件，本项目专注显式 DAG 探索、被放弃分支的失败反思，以及 Git / 普通目录双后端。

参考：

- [DSH Sessions](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)
- [DSH Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Hermes Checkpoints and Rollback](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/checkpoints-and-rollback.md)
- [DSH Turn Rewind](https://github.com/Anionex/dsh-turn-rewind)

## 0.2.0 实际提供什么

### 正确的 DSH 生命周期接入

插件使用 `@deepseek-ai/cordis` 4.x，并在第一步 `agent/pre-step` 前建立工作区检查点。`session/event` 中的 `turn/end` 用于写回 completed / failed / aborted 状态及完成时工作区签名。

回退不会试图篡改 append-only Session。`/tm-rewind` 和 `/tm-fork` 通过 DSH 的 `sessionController` 在保存的事件边界创建新会话，使会话历史和文件状态重新对齐。

### Git 工作区引擎

- 用临时 `GIT_INDEX_FILE`、`write-tree`、`commit-tree` 和 `refs/dsh-tm/*` 保存不可变快照。
- 创建和恢复都使用隔离 index；用户真实 staging index 保持不变。
- 回退前默认校验工作区是否仍与当前 checkpoint 的完成态一致。检测到 checkpoint 之后的手改时拒绝覆盖。
- 每次回退前自动建立 rescue checkpoint；若 DSH 会话 fork 失败，工作区会补偿恢复。
- 不再使用无差别 `git clean -fd`。目标树恢复由隔离 index 完成。
- ignored 文件内容不会进入 Git object database。显式使用 `--delete-new-ignored` 时，新 ignored 文件先进入本地 quarantine，再被移除；回到 rescue checkpoint 可恢复它们。
- Session ID 和 checkpoint ID 会编码后用于 ref/path，避免路径穿越和非法 ref 名。

注意：当前 Git 后端仍把对象和私有 ref 写入用户仓库的 object database；它不污染普通 branch/log/index，但与 Hermes 的独立 shadow store 仍有差距。

### 非 Git 目录后端

普通目录使用 manifest + 内容哈希快照，支持：

- 删除快照之后产生的孤儿文件；
- 恢复被删除/修改的文件；
- 不跟随符号链接，并保存 symlink 本身；
- 原子发布 snapshot manifest；
- 动态排除插件自己的 storage 目录和配置的保留路径。

### DAG 与持久化

- 任意 checkpoint 可建立命名分支；原分支节点不会因为 rewind 而被删除。
- DAG JSON 使用临时文件 + rename 发布；损坏状态不再被静默当成空历史。
- 同一工作区的 create / rewind / fork / finalize 通过 FIFO mutex 串行化。
- Session state 在入库时做 JSON 深拷贝，避免调用方后续修改历史节点。

### Reflection Advisor

Advisor 会从被放弃子树中的失败状态、错误信息和 failed tool 记录生成防重复踩坑提示。当前提示会显示在 `/tm-fork` 的命令结果中；尚未自动注入下一次模型请求。

## 安装

### 直接从 GitHub 安装

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
dsh --profile web --dump-config
```

仓库提交预构建的 `dist/`，因此 Git dependency 不需要在安装时执行构建脚本。建议固定 release tag 或 commit，而不是长期追踪 `main`。

### 本地源码试用

```bash
git clone https://github.com/GeoSyntax/dsh-plugin-time-machine.git
cd dsh-plugin-time-machine
pnpm install --frozen-lockfile
pnpm check
dsh plugin --profile web add .
dsh --profile web --dump-config
```

`cordis.patch.yml` 会将插件作为 DSH bundle 挂载。当前 npm 名称可用，但 `0.2.0` 尚未发布到 npm；正式发布后才可使用 `dsh plugin --profile web add dsh-plugin-time-machine`。

## 命令

为避免与 Hermes、dsh-retrace 或其他 rewind 插件冲突，命令使用 `tm-` 前缀：

```text
/tm-tree
/tm-rewind <checkpoint> [--force] [--delete-new-ignored]
/tm-fork <checkpoint> <branch> [--force]
```

- 默认是 safe restore；checkpoint 之后存在额外手改时会拒绝。
- `--force` 明确允许覆盖 managed files。
- `--delete-new-ignored` 明确允许移除目标 checkpoint 当时不存在的 ignored 路径；内容会先放入本地 quarantine。
- `/tm-rewind` 和 `/tm-fork` 要求当前 DSH profile 提供 `sessionController`，否则不会执行 workspace-only 假回滚。

## 配置

在 profile 的 `cordis.patch.yml` 中按 bundle 行的 `id` 覆盖完整配置：

```yaml
- id: time-machine
  config:
    autoSnapshot: true
    enableReflectionAdvisor: true
    refPrefix: refs/dsh-tm
    storageDir: /absolute/path/outside-or-inside-workspace
    restoreMode: safe
    preservePaths:
      - node_modules
    enableWebUI: true
    webHost: 127.0.0.1
    webPort: 3088
```

配置由运行时 Schema 校验。修改后使用 `dsh --profile web --dump-config` 确认只出现一个 `time-machine` 行，再启动 profile。

Standalone dashboard 只绑定 loopback，并拒绝跨域/非本机 Host。Web 上的 rewind/fork 也必须取得 DSH conversation restart capability，不会只改文件却谎称会话已回退。

## 已知边界

- 一个插件实例当前只管理启动时的一个 `workDir`。DSH Session 的 `cwd` 不同时会被明确跳过；多 workspace 路由是下一阶段工作。
- Git 快照仍使用用户仓库的 object database/private refs，尚未迁移到全局 shadow store。
- ignored 文件只有在显式删除时才会进入 quarantine；默认不会复制秘密、缓存或依赖目录。
- 多文件恢复具备 rescue/compensation，但底层文件系统没有跨文件事务，不能宣传为严格 ACID。
- Web UI 目前能展示 DAG 和 diff；成功 fork 后返回新 Session ID，尚未自动切换 DSH 前端路由。
- CI 已覆盖声明宿主的 bundle smoke；Web API 的 rewind/fork 与故障补偿已有自动化测试，真实交互式 `/tm-rewind`、`/tm-fork` 仍按 [docs/TEST_PLAN.md](docs/TEST_PLAN.md) 作为发布前专项验收。

## 卸载与数据保留

```bash
dsh plugin --profile web remove dsh-plugin-time-machine
```

卸载不会自动删除 `.dsh/time-machine`、`refs/dsh-tm/*`、quarantine 或已经写入 Git object database 的不可达对象，以免破坏最后的恢复路径。确认不再需要 checkpoint 并完成备份后再人工清理；自动 retention/prune 在路线图中。

## 验证

```bash
pnpm test
pnpm build
pnpm pack --dry-run
pnpm audit --prod --audit-level=high
# Requires a real dsh executable and uses a temporary DSH_HOME.
pnpm smoke:dsh
# Requires a local deepseek-harness source checkout.
TM_DSH_SOURCE=E:/desktop/dsh/deepseek-harness pnpm smoke:dsh:source
# Optional live model turn; inject the key through the environment only.
TM_DSH_SOURCE=E:/desktop/dsh/deepseek-harness TM_DSH_LIVE=1 TM_GEMINI_API_KEY=<redacted> pnpm smoke:dsh:source

# Optional: additionally force a non-zero shell command and verify failedTools extraction.
TM_DSH_SOURCE=E:/desktop/dsh/deepseek-harness TM_DSH_LIVE=1 TM_DSH_LIVE_TOOL_FAILURE=1 TM_GEMINI_API_KEY=<redacted> pnpm smoke:dsh:source

# Optional: run a second process with the same DSH_HOME/workspace and verify DAG history survives.
TM_DSH_SOURCE=E:/desktop/dsh/deepseek-harness TM_DSH_LIVE=1 TM_DSH_LIVE_RESTART=1 TM_GEMINI_API_KEY=<redacted> pnpm smoke:dsh:source

# Optional: boot the real DSH web host and exercise session/create, prompt, fork, and rewind.
TM_DSH_SOURCE=E:/desktop/dsh/deepseek-harness TM_GEMINI_API_KEY=<redacted> pnpm smoke:dsh:web

# Optional: verify an unreachable model endpoint still produces a durable failed checkpoint.
TM_DSH_SOURCE=E:/desktop/dsh/deepseek-harness pnpm smoke:dsh:failure
```

测试覆盖 Git index 不污染、managed orphan 删除、ignored quarantine/rescue、safe drift refusal、非 Git 精确恢复、DAG 分支、反思和 loopback Web 安全边界。

## 参与贡献

问题报告、设计讨论和 PR 都欢迎。文件恢复类插件的回归风险较高，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。路线图见 [ROADMAP.md](ROADMAP.md)。

## License

MIT
