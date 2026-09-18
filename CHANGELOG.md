# Changelog

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
- CLI, Web API, Dashboard, DSH source smoke tests, cross-platform CI, and
  machine-readable benchmark output.

### Safety boundaries

- `handEditPolicy` is currently `reject-drift`: the core does not infer whether
  a changed path belongs to the Agent or a user.
- `workspaceIsolation` is `shared-lock`, not an independent worktree or
  container.
- `shadowStoreEncryption` and native DSH message-action UI are not implemented.
- Database, network, process, and cloud side effects require explicit external
  adapters; filesystem restore never claims to undo them.

See [README.md](./README.md), [docs/COMPARISON.md](./docs/COMPARISON.md), and
[docs/ROADMAP.md](./docs/ROADMAP.md) for configuration and upgrade guidance.
