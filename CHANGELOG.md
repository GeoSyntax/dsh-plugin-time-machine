# Changelog

## Unreleased

- 收紧 companion API 的 session 边界：恢复、分叉、预览、diff、账本查询与存储裁剪不再隐式回落到 `default`，未知或未持久化 session 统一返回 `SESSION_NOT_FOUND`。
- 新增 `/tm-doctor`，在社区 profile 中诊断双轨恢复所需能力并提示缺失配置。
- 接入可选的 DSH `sessionController.inspect` 宿主核验，避免展示或操作已经从 DSH 会话目录删除的孤儿 session。
- 新增完整工作区“只恢复文件、不分叉会话”路径：`/tm-restore` 与 `/api/restore-workspace`。
- 更新合成基准记录：100/1,000/10,000 文件 fixture 的实际延迟与存储比例。

## 0.2.0 — 2026-09-19

### Added

- Git plumbing snapshots with isolated indexes, DAG branches, rescue points,
  interrupted-restore journals, and non-Git fallback snapshots.
- Safe, merge, force, and selective restore flows with single-use preview plans.
- Orphan-file cleanup, ignored-file quarantine, optional AES-GCM quarantine
  encryption, and explicit legacy quarantine migration.
- Snapshot/storage quotas, explicit and automatic retention, shadow object store
  maintenance, and cross-process workspace locking.
- Safe incremental dirty-path capture for large tracked workspaces, fenced by
  Git branch/HEAD control-plane identity.
- Partial snapshots as an explicit opt-in with persisted `omittedPaths`.
- External-effect ledger with dry-run compensation adapters, idempotency fences,
  unknown-outcome persistence, and structured unavailable-adapter errors.
- Versioned runtime capability discovery through `GET /api/capabilities`.
- Explicit Agent-write ledger integration: `recordAgentWrite()` records SHA-256
  evidence and `--preserve-hand-edits` preserves only verified post-write edits;
  missing evidence remains fail-closed.
- When enabled, native DSH `fs/observed` and `tools/result` events automatically
  record successful `write`, `edit`, and `str_replace_editor` operations; shell
  and arbitrary code writes still require explicit integration evidence.
- CLI, Web API, Dashboard, DSH source smoke tests, cross-platform CI, and
  machine-readable benchmark output.
- Opt-in Hermes-style pre-command checkpoints on DSH `tools/pre-execute` with
  `tools/execute` fallback, native file/shell mutation-tool defaults,
  configurable allowlist, per-turn limit, call-id deduplication, and a live
  source smoke assertion.
- Dependency-free `TimeMachineClient` companion contract for status,
  capabilities, storage, DAG, diff, preview-bound rewind/fork, selective
  restore, audit reads, and persisted `sessions()` discovery; Web fork now
  consumes the same restore-plan fence.
- Dashboard session discovery and switching through `GET /api/sessions`, with
  URL-bound selection and no implicit `default` DAG creation.
- Pre-command deduplication fallback for DSH adapters that omit `callId`.
- Fallback checkpoint-to-checkpoint unified diffs, including an explicit binary
  marker, now power `getDiff`, Web preview, and the dashboard.
- Explicit `webAllowedOrigins` support for trusted cross-port companions; wildcard
  CORS remains disabled.

### Safety boundaries

- `handEditPolicy` remains `reject-drift` by default. `ledger-opt-in` is
  available only when integrations enable the explicit Agent-write ledger; the
  core still never guesses authorship.
- `workspaceIsolation` is `shared-lock`, not an independent worktree or
  container.
- `shadowStoreEncryption` and native DSH message-action UI are not implemented.
- The companion client is a transport contract, not a native transcript slot;
  a separate DSH Web client package is still required to render buttons.
- Database, network, process, and cloud side effects require explicit external
  adapters; filesystem restore never claims to undo them.

See [README.md](./README.md), [docs/COMPARISON.md](./docs/COMPARISON.md), and
[docs/ROADMAP.md](./docs/ROADMAP.md) for configuration and upgrade guidance.
