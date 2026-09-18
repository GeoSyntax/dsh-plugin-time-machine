# Community roadmap

This roadmap is intentionally narrower than a feature wish list. Each item has
an acceptance boundary so contributors do not trade away the safety guarantees
documented in [PROBLEM.md](./PROBLEM.md) and [COMPARISON.md](./COMPARISON.md).

## P0 — safety and compatibility

### Encrypted sensitive-state storage

Protect optional shadow objects and the remaining sensitive metadata at rest.
Ignored-file quarantine is now covered by `quarantineEncryptionKeyEnv`; shadow
object encryption and explicit migration of existing plaintext quarantine remain.
Use an operator-provided key (prefer an environment-backed key reference; never
write the secret into the DAG). Migration must be explicit, and a missing/invalid
key must fail closed without deleting plaintext backups.

**Acceptance:** restore works after restart with the key; wrong keys cannot
read content; quota/prune accounting remains correct; no key material appears
in logs, manifests, or Git refs.

### Host capability contract

Keep `GET /api/capabilities` versioned as new host integrations land. A DSH
session-controller adapter may advertise worktree/container isolation only when
the host can create the isolated cwd and route the forked session there.

**Acceptance:** shared-lock remains the honest fallback; unsupported host
contracts are rejected before mutating the workspace.

## P1 — scale and workflow parity

### Large-workspace incremental capture

Measure and reduce Git process overhead for repositories with 10k+ files. A
candidate design is a cache keyed by `(repo HEAD, index stat data, preserve
paths)` with invalidation on control-plane changes. It must never reuse a tree
after a file, ignored-path set, or staged index changed.

**Acceptance:** benchmark reports latency and storage for 100, 1k, and 10k-file
fixtures; staged-index isolation and orphan cleanup tests remain green.

### Native DSH timeline action

Expose preview/merge/force choices as a host message-anchored action when DSH
provides that extension point. Keep the standalone dashboard and CLI as the
portable fallback.

**Acceptance:** the action carries the session-bound restore-plan token, shows
conflict paths before mutation, and reports the new forked session id.

### Explicit partial-capture mode (opt-in only)

If community users need Change Ledger-style oversized-file skipping, persist
omitted paths and reasons in each checkpoint, preserve omitted live paths during
restore, and surface them in CLI/Web/API responses. The default remains
`SNAPSHOT_SIZE_LIMIT` fail-closed.

**Acceptance:** a successful partial checkpoint can never claim complete
workspace coverage; restore, prune, quota, and capability output all expose the
omitted-path state.

## P2 — scope beyond the filesystem

### External side-effect ledger

Provide an extension interface for integrations to record reversible database,
process, network, or cloud mutations. The core plugin must not pretend that a
filesystem snapshot can undo them.

**Acceptance:** each adapter declares compensation guarantees and failure
semantics; a missing adapter produces an explicit warning in the checkpoint and
reflection report.

## Current non-goals

- Silent partial snapshots in the default mode.
- Repository-wide `git gc` initiated by pruning.
- Claiming process locks are equivalent to worktree/container isolation.
- Automatic mutation of external systems without an explicit adapter.
