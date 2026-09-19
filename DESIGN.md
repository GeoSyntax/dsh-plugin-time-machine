# Design notes

## Scope

Time Machine coordinates two independently durable domains:

1. a workspace checkpoint (Git tree/private ref or ordinary-directory manifest), and
2. a stable DSH Session event boundary used to create a new conversation fork.

It never rewrites the append-only DSH event log. A rewind restores files and asks the host `sessionController` to create/fork a conversation. If the conversation operation fails, the workspace is restored from the automatic rescue checkpoint.

## State model

Each `CheckpointNode` records a parent, logical branch, pre-turn workspace object, Session boundary, turn outcome, and optional settled workspace signature. A pre-turn node therefore has two relevant signatures:

- `gitTreeOid` / `ignoredPaths`: state to restore;
- `settledGitTreeOid` / `settledIgnoredPaths`: state expected after the turn, used to detect later hand edits.

Integrations may attach `externalEffects` declarations to a node through
`recordExternalEffect()`. These records describe mutations in databases,
networks, processes, or cloud systems; they are persisted and surfaced in fork
reflection, but the core never executes compensation implicitly.

DAG mutations and workspace mutations are serialized per configured workspace. DAG files are published by writing a unique temporary file and renaming it into place.

## Restore protocol

1. Resolve and validate the target node.
2. In safe mode, compare the current workspace with the active node's settled signature.
3. Create a rescue node from the current workspace.
4. Restore the target using an isolated Git index or exact directory manifest.
5. Move the DAG cursor only after the workspace restore succeeds.
6. Fork the DSH conversation at `boundarySeq`.
7. If step 6 fails, restore the rescue node and cursor.

This is compensating transaction semantics, not a filesystem-wide ACID transaction.

## Git decisions

- Both capture and restore use a temporary `GIT_INDEX_FILE`; the user's real index is not modified.
- Snapshots use `write-tree` + `commit-tree` + a private `refs/dsh-tm/*` ref. Normal branches and `git log` are untouched. With `shadowStore: true`, plugin-created objects live in `storageDir/git-shadow/objects`; the main object database is read-only alternate storage.
- Plugin storage and configured preserved paths are removed from the temporary index.
- `git clean` is not used. The temporary current-state index gives `read-tree --reset -u` the information needed to remove managed paths absent from the target.
- Ignored contents are excluded from Git objects. Explicit ignored-path deletion copies content to a plugin quarantine first; rescue restoration copies it back.

The shadow store is opt-in. Loose unreachable objects are reclaimed after plugin refs are deleted. Explicit shadow repack rebuilds packs only from `refs/dsh-tm/*`; no repository-wide Git GC is invoked. Repack is never automatic.

## Threat model

### Assets

- user source files, ignored secrets and staged Git state;
- DSH Session history and branch boundary identity;
- private snapshot refs, DAG files and quarantine content;
- local dashboard mutation endpoints.

### Threats and controls

| Threat | Control |
|---|---|
| Path traversal through Session/checkpoint IDs | IDs are base64url-encoded before filesystem/ref use; manifests validate relative paths. |
| Symlink escape | Directory scans use `lstat` and never recurse through symlinks. Restore destinations are resolved beneath the workspace root. |
| Loss of staged changes | Capture and restore use isolated indexes; regression test compares cached diff before/after restore. |
| Overwriting hand edits | Safe mode compares the current tree and ignored-name set with the active settled signature. |
| Irrecoverable ignored-file deletion | Deletion is explicit and quarantines contents outside Git before removal. |
| Cross-origin localhost attack / DNS rebinding | Server binds loopback, validates `Host` and `Origin`, disables permissive CORS and uses a restrictive CSP. |
| DOM XSS from checkpoint metadata | Dashboard builds nodes with `textContent`; no dynamic `innerHTML` or inline event handlers. |
| Workspace/session split-brain | Mutating UI/commands require `sessionController`; session-fork failure triggers rescue compensation. |
| Concurrent restore/create races | Keyed FIFO mutex plus a cross-process workspace lock serializes state-changing operations. |
| False belief that file restore undoes external mutations | External-effect records require adapter/failure semantics and generate fork warnings; no implicit compensation is attempted. |

### Accepted risks

- Quarantine is local storage; by default it is plaintext and needs the same OS permissions as the workspace. `quarantineEncryptionKeyEnv` enables AES-256-GCM at-rest encryption without persisting key material. Orphaned backups are removed when their DAG references are pruned. Optional `maxQuarantineBytes` rejects a deletion that would exceed the hard limit.
- A read-only preview issues a one-shot, session/checkpoint-bound restore plan. Web clients must submit that plan to mutate; the service rechecks its TTL, active checkpoint, workspace signature, and Git HEAD/branch/in-progress-operation state under the workspace lock, then consumes the token before restore. Direct service/CLI restores remain available without a plan for automation, while reviewed Web restores fail closed on stale plans.
- Optional `maxSnapshotFileBytes` and `maxSnapshotBytes` are checked before Git staging or fallback copying. The policy intentionally fails the checkpoint rather than silently omitting content; this preserves the invariant that a successful checkpoint describes the complete eligible workspace.
- A process or machine crash during the small interval between workspace restore and DAG cursor publication is recovered from the durable restore journal on next startup; filesystem restore itself remains compensating rather than ACID.
- One plugin instance currently owns one configured workspace. Sessions with a different `cwd` are skipped rather than routed incorrectly.
- Packed shadow objects are not repacked automatically; users must opt in to `--repack-shadow`, and shared-object mode still does not run repository-wide GC.
- The lock prevents concurrent mutation but does not provide separate worktrees for multiple Agents.
- External-effect declarations are an audit/reflection contract, not a transaction log: adapters still own authentication, idempotency, compensation execution, and verification.

## Change history

### 2026-09-18 — 0.2.0 safety and DSH compatibility pass

**Changes:** migrated to `@deepseek-ai/cordis` 4.x, added real pre-step/turn-end integration and DSH session forks, isolated restore indexes, safe drift checks, rescue compensation, ignored quarantine, exact non-Git restore, atomic DAG writes, operation locking, loopback HTTP controls and DOM-safe rendering.

**Reason:** the earlier prototype used a non-existent lifecycle event, modified the real Git index during restore, only returned an in-memory Session-shaped object, and overstated atomicity.

**Impact:** command names are now `/tm-*`; restore defaults to safe mode; workspace-only Web mutations are refused; the declared API target is DSH `>=0.1.5-rc.2 <0.2.0` pending a real-host CI matrix.

**Evidence:** current DSH Session/architecture documentation, Hermes checkpoint documentation, and `@anionex/dsh-turn-rewind` safety semantics.

### 2026-09-19 — storage and concurrency hardening

**Changes:** added opt-in shadow object storage and loose-object cleanup, quota-aware
history compaction, durable restore-journal replay, and a cross-process workspace lock
with timeout and dead-owner recovery.

**Remaining boundary:** packed-object repacking and true multi-Agent worktree isolation
remain future work; the lock prevents races but does not create independent workspaces.

### 2026-09-19 — API boundary and external-effect identity hardening

**Changes:** explicit external-effect IDs are now unique within a checkpoint and
duplicate declarations fail closed with `EXTERNAL_EFFECT_DUPLICATE`; Web rewind/fork
validate required target parameters before invoking the service.

**Reason:** a duplicate audit ID makes a later compensation target ambiguous, while
client omissions should be reported as input errors rather than internal failures.

**Impact:** companion clients receive deterministic HTTP 409/400 responses and can
retry or prompt for correction without mutating the DAG or workspace.

### 2026-09-19 — anonymous tool execution compatibility

**Changes:** pre-command deduplication uses the host `callId` when present;
otherwise it assigns a process-local identity to the execution object. The same
anonymous object crossing both waterfalls is captured once, while distinct calls
are not collapsed by tool name.

### 2026-09-19 — persisted session discovery

**Changes:** added a read-only `listSessions()` service boundary and
`GET /api/sessions`; the dashboard and companion client can select real persisted
session IDs instead of assuming `default`. The DAG endpoint rejects missing or
unknown IDs without creating an empty DAG.

**Reason:** DSH checkpoints are keyed by the host's session ID. A fixed `default`
Dashboard hid valid timelines and made post-fork sessions appear to disappear.

**Impact:** session discovery is restart-safe and does not alter restore semantics.
