# Community roadmap

This roadmap is intentionally narrower than a feature wish list. Each item has
an acceptance boundary so contributors do not trade away the safety guarantees
documented in [PROBLEM.md](./PROBLEM.md) and [COMPARISON.md](./COMPARISON.md).

## P0 — safety and compatibility

### Encrypted sensitive-state storage

Protect optional shadow objects and the remaining sensitive metadata at rest.
Ignored-file quarantine is now covered by `quarantineEncryptionKeyEnv`; an
explicit `/tm-quarantine-migrate` path converts legacy plaintext backups while
preserving fail-closed behavior. Shadow object encryption remains.
Use an operator-provided key (prefer an environment-backed key reference; never
write the secret into the DAG). Migration must be explicit, and a missing/invalid
key must fail closed without deleting plaintext backups.

**Acceptance:** restore works after restart with the key; wrong keys cannot
read content; explicit migration preserves the legacy backup on failure;
quota/prune accounting remains correct; no key material appears in logs,
manifests, or Git refs.

### Host capability contract

Keep `GET /api/capabilities` versioned as new host integrations land. A DSH
session-controller adapter may advertise worktree/container isolation only when
the host can create the isolated cwd and route the forked session there.

**Acceptance:** shared-lock remains the honest fallback; unsupported host
contracts are rejected before mutating the workspace.

## P1 — scale and workflow parity

### Large-workspace incremental capture

Measure and reduce Git process overhead for repositories with 10k+ files. The
first conservative optimization now reuses a tree only for a completely clean
worktree; any staged, modified, or untracked path disables reuse because Git's
porcelain path entry does not carry an untracked content hash. A broader cache
keyed by `(repo HEAD, index stat data, preserve paths)` still needs a
content-safe invalidation design and must never reuse a tree after a file,
ignored-path set, or staged index changed.

**Acceptance:** `TM_BENCH_FILE_COUNT` benchmark runs (including
`TM_BENCH_FORMAT=json` for comparison tooling) report latency and storage for
100, 1k, and 10k-file fixtures; staged-index isolation and orphan cleanup tests
remain green.

Latest Windows Node 22 synthetic measurements are recorded in the README. They
show the expected trade-off: Git plumbing uses substantially less storage, but
10k-file snapshots still take seconds because the safe path re-scans the
workspace. This is an evidence-backed performance gap, not a claim of parity
with path-identity caches in Change Ledger.

### Native DSH timeline action

Expose preview/merge/force choices as a host message-anchored action when DSH
provides that extension point. Keep the standalone dashboard and CLI as the
portable fallback.

**Acceptance:** the action carries the session-bound restore-plan token, shows
conflict paths before mutation, and reports the new forked session id.

### Explicit partial-capture mode (opt-in only) — implemented

Community users can opt into Change Ledger-style oversized-file skipping with
`allowPartialSnapshots`. Omitted paths are persisted in each Git checkpoint,
removed from the immutable tree, preserved as live content during restore, and
returned by preview/capability APIs. The default remains
`SNAPSHOT_SIZE_LIMIT` fail-closed.

**Acceptance:** a successful partial checkpoint can never claim complete
workspace coverage; restore and preview preserve/expose omitted paths, while
default mode and fallback mode continue to reject oversized captures.

## P2 — scope beyond the filesystem

### External side-effect ledger — adapter seam implemented

The first extension surface is available through
`TimeMachineService.recordExternalEffect()`. Integrations can persist an
adapter name, operation, reversibility declaration, compensation description,
failure semantics, and status on a checkpoint. Named adapters can now be
registered and discovered; compensation is dry-run by default and requires an
explicit execute request. The core persists an idempotency key and unknown
outcome, while authentication, remote transaction semantics, and retry policy
remain adapter-owned.

**Acceptance:** each adapter declares compensation guarantees and failure
semantics; a missing adapter produces an explicit warning in the checkpoint and
reflection report; dry-run performs no remote call; repeated execution with the
same key is replay-safe and a different key is rejected after an attempt. The
core must never claim that a filesystem snapshot undoes an external mutation.

## Current non-goals

- Silent partial snapshots in the default mode.
- Repository-wide `git gc` initiated by pruning.
- Claiming process locks are equivalent to worktree/container isolation.
- Automatic mutation of external systems without an explicit adapter.
