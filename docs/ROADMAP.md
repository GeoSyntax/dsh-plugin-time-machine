# Community roadmap

This roadmap is intentionally narrower than a feature wish list. Each item has
an acceptance boundary so contributors do not trade away the safety guarantees
documented in [PROBLEM.md](./PROBLEM.md) and [COMPARISON.md](./COMPARISON.md).

## P0 — safety and compatibility

### Versioned DAG storage and migration — implemented

Persisted session history now carries a `formatVersion`. Existing unversioned
files are upgraded only after full validation and an atomic rewrite; a future or
unknown version fails closed and remains untouched. `GET /api/capabilities`
reports the current `dagStorageFormatVersion` so companion clients can gate
features before mutating history.

**Acceptance:** legacy history opens and is rewritten with the current version;
future-version history is rejected without modification; malformed or foreign
files remain rejected.

### Encrypted sensitive-state storage

Protect optional shadow objects and sensitive metadata at rest. DAG/session
metadata is now covered by `stateEncryptionKeyEnv`: it uses an authenticated
AES-256-GCM envelope, migrates validated legacy plaintext on first open, and
fails closed when the key is missing or wrong. Key rotation is supported by
temporarily configuring `stateEncryptionPreviousKeyEnv`; authenticated files
are rewritten with the current key atomically. Ignored-file quarantine is now
covered by `quarantineEncryptionKeyEnv`; an explicit `/tm-quarantine-migrate`
path converts legacy plaintext backups while preserving fail-closed behavior.
Shadow object encryption is now implemented through a disposable Git-readable
runtime directory and an authenticated AES-256-GCM archive. Existing plaintext
objects require the explicit `/tm-shadow-migrate` command; current and previous
keys support authenticated rotation.
Use an operator-provided key (prefer an environment-backed key reference; never
write the secret into the DAG). Migration must be explicit, and a missing/invalid
key must fail closed without deleting plaintext backups.

**Acceptance:** restore and session discovery work after restart with the key;
wrong keys cannot read content; explicit quarantine migration preserves the
legacy backup on failure;
quota/prune accounting remains correct; no key material appears in logs,
manifests, or Git refs.

The implementation boundary and failure matrix are documented in
[ENCRYPTED_SHADOW_DESIGN.md](./ENCRYPTED_SHADOW_DESIGN.md). Directly encrypting
Git loose objects or packs is explicitly rejected because Git would no longer
be able to read the shadow store.

### Host capability contract

Keep `GET /api/capabilities` versioned as new host integrations land. A DSH
session-controller adapter may advertise worktree/container isolation only when
the host can create the isolated cwd and route the forked session there.

**Acceptance:** shared-lock remains the honest fallback; unsupported host
contracts are rejected before mutating the workspace.

The current `workspaceRouting: "single-root"` capability is intentional: one
plugin instance owns one configured `workDir` and skips sessions whose
`header.cwd` differs. Multi-project routing remains a host-integration item;
silently binding those sessions to the wrong root would be unsafe.

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

Latest Windows Node 22 synthetic measurements are recorded in the README,
including P50/P95. The benchmark now commits a tracked baseline and exercises
the incremental overlay path; the current five-turn 10k-file fixture measured
about 2.94s P50 versus 15.24s for traditional copying while retaining
status-path validation. This is evidence for the narrow safe case, not a claim
of parity with every path-identity cache in Change Ledger; absolute latency
varies with machine load.

### Native DSH timeline action — companion package and matrix configured

The optional `client-companion/` package now exposes preview/confirmation and
fork navigation from both the session header and finalized assistant-message
action slots. CI has a cross-version slot matrix for DSH client
`0.1.6-alpha.1/.2`, and the package peer range is capped at `<0.2.0` until a
new host contract is verified. A first hosted GitHub-run result and a published
package remain release evidence tasks. Keep the standalone dashboard and CLI as
the portable fallback.

**Acceptance:** the action carries the session-bound restore-plan token, shows
conflict paths before mutation, and reports the new forked session id.

The host slot and the companion-package boundary are documented in
[DSH_NATIVE_UI.md](./DSH_NATIVE_UI.md); the service package intentionally does not
load the separate Web package or claim assistant message actions by itself.

Fallback checkpoint diffs are implemented independently of this UI item: service
and preview APIs return unified text diffs for ordinary files and an explicit
binary marker for binary content. Native slot rendering remains separate.

### Pre-command safety boundary — implemented (opt-in)

`autoPreCommandSnapshot` now hooks each Agent's `tools/pre-execute` waterfall
and keeps `tools/execute` as a compatibility fallback. Configured high-risk
tools, including native `write`, `edit`, and `str_replace_editor`, receive a
`pre-command` checkpoint before dispatch or argument rejection;
call ids are deduplicated and `preCommandMaxPerTurn` defaults to one boundary,
matching Hermes' per-turn anti-spam behavior. A value of zero permits one
checkpoint per high-risk call. The source smoke can enable the live assertion
with `TM_DSH_LIVE_PRECOMMAND=1`.

**Acceptance:** the same call crossing both waterfalls creates one node;
multiple calls in one turn respect the limit; a new turn resets the limit;
failed capture does not block the tool; and a real DSH source smoke persists a
`pre-command` node before a shell failure.

Adapters that omit `callId` are supported as well: the same execution object is
deduplicated across both waterfalls, while distinct anonymous calls remain
distinct when `preCommandMaxPerTurn: 0` is used.

### Web session discovery — implemented

The dashboard now discovers persisted DSH sessions through `GET /api/sessions`,
selects the most recently updated session by default, supports `?sessionId=...`,
and lets operators switch timelines without manufacturing a `default` DAG. The
companion client exposes the same `sessions()` read API.

**Acceptance:** multiple sessions survive service restart and remain selectable;
unknown or missing session IDs return a structured 404/400 instead of creating a
ghost timeline.

### Agent-write ledger for hand-edit preservation — implemented (opt-in/default-preserve)

Hermes records hashes for successful agent writes and preserves later user edits
during ordinary rollback. Time Machine now provides the same evidence-based seam
without guessing authorship: integrations enable `enableAgentWriteLedger`; the
native DSH `fs/observed` + `tools/result` pair automatically covers first-party
`write`, `edit`, and `str_replace_editor`, while other integrations can call
`recordAgentWrite()`. Users opt into `--preserve-hand-edits`. A path is preserved
only when its current SHA-256 no longer matches the recorded Agent hash; missing
or corrupt evidence remains fail-closed. `preserveVerifiedHandEditsByDefault` is an
optional convenience policy that implies the ledger and applies preservation when
the request does not explicitly set `preserveVerifiedHandEdits: false`; the
legacy default remains strict drift rejection.

**Acceptance:** an opt-in mode restores Agent-owned paths while preserving
verified post-checkpoint hand-edits, and explicit safe/merge/force modes remain
available as full-overwrite or conflict-resolution escape hatches.

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
