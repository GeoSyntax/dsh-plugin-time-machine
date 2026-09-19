# Capability comparison

This document explains where Time Machine fits among existing workspace undo and
checkpoint plugins. It is intentionally conservative: a capability is marked
supported only when it is covered by the current implementation and tests.

## Peer verification (2026-09)

The comparison below is grounded in the peers' current public documentation,
not only their package names:

- [Hermes checkpoints and rollback](https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback)
  uses an opt-in shared shadow Git store, checkpoints before file/destructive
  terminal tools, keeps later hand-edits by default through an Agent-write hash
  ledger, and exposes `--all` for an explicit full overwrite. Time Machine
  matches the pre-command boundary and ledger seam, but keeps strict drift
  rejection as its default and adds persistent branches, reflection, and
  external-effect declarations.
- [PerryLink/dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)
  is the closest DSH peer: it captures before mutation, supports Git/copy
  providers, quotas, and a reversible guard checkpoint. Its restore is
  path-explicit and avoids deleting post-checkpoint files; Time Machine offers
  that selective mode plus a separately reviewed full restore that can remove
  ordinary orphans, with conflict and rescue checks.
- [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) centers
  on a Change Ledger and profile-bundle integration. That is a useful lower
  friction deployment model, while Time Machine deliberately exposes its
  native DSH capability seam and refuses to infer authorship for unobserved
  shell/PTC changes.
- [SiriLee/dsh-rewind](https://github.com/SiriLee/dsh-rewind) prioritizes
  same-window in-place conversation rewind. Time Machine's default contract is
  a new forked session, with in-place rewind available only through an explicit
  host `sessionController.rewind()` capability.
- [23swccp/dsh-undo](https://github.com/23swccp/dsh-undo) combines Shadow Git
  snapshots with conversation undo and archived-task management. Its archive
  lifecycle is a useful operational model; Time Machine instead keeps a
  persistent DAG and makes pruning explicit, so an exploratory branch is not
  silently converted into an archived/deleted task.
- [Taler97/dsh-rollback](https://github.com/Taler97/dsh-rollback) deliberately
  focuses on file-mutation rollback through a model-facing `rollback_files`
  tool and a human `/rollback` command. That is a lower-surface-area option;
  Time Machine covers the larger turn/session boundary but therefore needs
  stricter host capability checks.
- [XSJUSTC/dsh-rewind](https://github.com/XSJUSTC/dsh-rewind) demonstrates a
  lightweight client-side same-window conversation rewind with optional file
  restore. Its minimal dependency footprint is attractive for installation;
  Time Machine accepts a larger service surface in exchange for encrypted
  metadata, previews, quotas, branches, and audit records.

These are policy differences rather than claims that one implementation wins
every workflow. Operators should choose based on whether they value in-place
UX, selective non-destructive restore, or durable branch exploration.

| Capability | Time Machine | Hermes checkpoints | Change Ledger | dsh-undo / dsh-rewind |
| --- | --- | --- | --- | --- |
| Full workspace snapshot | Git plumbing + non-Git fallback; explicitly refuses sparse/submodule/in-progress Git states | Yes | Yes; explicit unsupported-state policy | Partial / lightweight |
| Remove ordinary orphan files | Yes | Yes | Yes | Depends on tracked set |
| Ignored-file safety | Preserve by default; quarantine on explicit delete | Configurable | Conflict-aware | Usually left untouched |
| Preview before restore | `tm-preview`, Web API, Web confirmation, conflict paths, single-use session-bound plan; fallback also returns text diff | Yes | Yes; expiring plan and stale-plan fences | Limited |
| Non-conflicting drift merge | Explicit `/tm-rewind --merge` for Git workspaces; path-level conflicts fail closed | Product-specific | Three-way / selective conflict handling | Varies |
| Runtime capability discovery | Versioned `GET /api/capabilities` exposes Git/fallback, merge, incremental capture, explicit `handEditPolicy`, shadow-store and shadow-encryption status, quarantine encryption/migration, external-effect ledger, unsupported-state, single-root session routing, shared-lock isolation, and active policy limits | Product-specific | Host/UI-dependent | Varies |
| On-disk history compatibility | Versioned DAG JSON; legacy unversioned files are validated and atomically migrated, future versions fail closed without rewriting | Product-specific | Varies | Varies |
| Session metadata at-rest protection | Optional AES-256-GCM envelope for DAG/session messages with key-aware discovery and fail-closed restart behavior | Product-specific | Varies | Varies |
| Quarantine at-rest encryption | Opt-in AES-256-GCM via environment-backed key; missing/wrong key fails closed | Product-specific | Varies | Varies |
| External side-effect ledger | Adapter declarations persist reversibility, compensation and failure semantics; named adapters support dry-run, explicit execution and idempotency fences; missing adapters are surfaced as `adapterAvailable: false`; fork reflection still warns | Product-specific | Varies | Usually absent |
| Selective file restore | `tm-restore-files`, Web API | Yes | Yes | Varies |
| Full workspace restore without conversation fork | `tm-restore`, `POST /api/restore-workspace` | Product-specific | Product-specific | Often the default undo behavior |
| Conversation/session alignment | DSH `sessionController` fork | Product-specific | Product-specific | Usually undo/redo or same window |
| Message-anchored rewind contract | `GET /api/checkpoint-for-message` and `TimeMachineClient.checkpointForMessage()` resolve finalized assistant messages and turn-opening user messages; companion currently renders the assistant slot | Product-specific | Host/UI-dependent | `dsh-rewind` focuses on same-window message rewind |
| Multi-session discovery | `GET /api/sessions`, URL-bound Dashboard selector, and companion `sessions()` API; unknown IDs fail closed | Product-specific | Host/UI-dependent | Usually same-window only |
| Cross-origin companion boundary | Disabled by default; exact `webAllowedOrigins` entries enable local client packages with explicit CORS headers | Host-managed | Host/UI-dependent | Usually unavailable |
| Agent-write ledger / hand-edit preservation | Explicit opt-in `enableAgentWriteLedger`, or optional `preserveVerifiedHandEditsByDefault`; native `write`/`edit`/`str_replace_editor` events auto-record, other integrations use `recordAgentWrite()`; preservation remains fail-closed without evidence | Hermes records hashes of agent writes and keeps later hand-edits by default; `--all` opts into overwrite | Product-specific | Varies |
| Ledger audit surface | `/tm-agent-writes <checkpoint>` and `GET /api/agent-writes` expose path, operation, hash, and timestamp before a restore | Checkpoint UI/CLI exposes write evidence | Product-specific | Varies |
| Unknown mutation visibility | Turn-finalization inventory records `unattributedChanges` and surfaces them in the dashboard instead of guessing authorship | Product-specific | Usually not exposed | Varies |
| Symlink / hard-link restore safety | Symlinks are represented explicitly; Git restore rejects hard-linked target inodes before mutation, while fallback unlinks before writing | Hermes refuses unsupported mounted/special paths; SiriLee explicitly skips symlink/hard-link targets | Product-specific | Often unspecified |
| Tool-level mutation attribution | `toolMutations` links configured high-risk tools to path deltas, sanitized failure summaries, delayed-result correlation, CLI/Web/Dashboard/companion readers | Usually mutation-boundary snapshots without a durable per-tool ledger | Product-specific | Usually absent |
| Workspace route inspection | `GET /api/workspace-route` and `TimeMachineClient.workspaceRoute()` expose canonical cwd, workspace id and honest isolation mode; invalid adapter routes fail closed | Host/UI-dependent | Host/UI-dependent | Usually absent |
| External-effect declaration surface | Service API plus `POST /api/external-effects`; declaration is audit-only, compensation remains explicit/dry-run first | Product-specific | Usually outside file undo scope | Varies |
| External-effect identity safety | Explicit ids are unique per checkpoint; duplicates fail closed with a structured 409 | Product-specific | Product-specific | Usually absent |
| DAG branches | Yes, persistent | No user-facing DAG | Ledger history | Usually linear |
| Failed-tool reflection | Yes | No equivalent | No equivalent | No equivalent |
| Rescue/compensation | Yes | Snapshot-oriented | Journal-oriented | Varies |
| Storage quotas and pruning | Explicit status, conservative prune, explicit history compaction, explicit age/abandoned-branch prune, opt-in hard guards | Yes | Yes; per-file/aggregate capture budgets and retention | Varies |
| Incremental dirty-tree capture | Safe overlay of status-reported paths onto the prior complete tree; fallback to full isolated-index capture when limits/preserved paths make the optimization unsafe | Path-identity cache | Path-identity cache | Varies |
| Automatic age retention | Opt-in `retentionMaxAgeMs`; runs before ordinary checkpoints and protects current/branch heads | Product-specific | Retention policies | Varies |
| Oversized-file policy | Default fail-closed with `SNAPSHOT_SIZE_LIMIT`; explicit `allowPartialSnapshots` records `omittedPaths` and preserves those live paths during restore | Product-specific | Can skip/report unsupported files | Varies |
| Durable interrupted-restore journal | Yes; startup restores rescue checkpoint | Store recovery | Yes | Varies |
| Independent shadow store | Opt-in `shadowStore: true`; loose GC plus explicit private-pack repack | Yes | Yes | Usually local backups |
| Shadow object encryption | Opt-in AES-256-GCM archive with disposable Git runtime, explicit plaintext migration, fail-closed key errors, and previous-key rotation | Product-specific | Product-specific | Usually unavailable |
| Cross-process workspace lock | Yes; bounded wait with stale-owner recovery | Product-specific | Change Ledger documents active-session blocking and Git-operation fences | Usually unavailable |
| Pre-destructive tool checkpoint | Opt-in `autoPreCommandSnapshot` on DSH `tools/pre-execute` with `tools/execute` fallback; defaults include native file tools and destructive shell/PTC tools, tagged `pre-command` | Opt-in; automatic before file tools and destructive terminal commands, at most one checkpoint per directory per turn | Before every configured mutation tool; `maxSnapshots`/byte quotas and turn-end pruning | `dsh-undo`/`dsh-rewind` vary; mutation-level tools are usually lighter than a full DAG checkpoint |

## Choosing the right tool

- Use Time Machine when a DSH user needs the workspace and conversation to move
  together, wants parallel branches, or needs failed-turn evidence carried into
  a retry.
- Use a simple undo plugin when the desired interaction is an in-place,
  single-window Ctrl+Z/Ctrl+Y flow and session branching is not important.
- Use a ledger/checkpoint product when selective restoration, retention policy,
  or independent backup storage is the primary requirement.

## Important boundaries

`/tm-rewind` is a dual-track operation: it restores the workspace and asks DSH
to create an aligned conversation. `/tm-restore` is full-workspace-only: it
restores every captured path, keeps the current conversation messages, and
records rescue/result state without pretending the conversation was rewound.
`/tm-restore-files` is the narrower selective variant for a chosen path set.

The comparison is deliberately not a claim that Time Machine is ahead of every
peer. Time Machine now has expiring, single-use, session-bound restore plans
with Git HEAD/branch/in-progress-operation fences for reviewed Web/CLI restores.
The current Change Ledger implementation still goes further with
path-identity caches for large workspaces; and a host-native,
message-anchored rewind action. We should adopt those ideas where they fit
without copying their storage format. It also offers an explicit Git-only
three-way merge restore for non-conflicting workspace drift; safe mode remains
the default and still fails closed on any drift.

The newer [PerryLink/dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)
project is a particularly close peer: it snapshots before every configured
mutation tool at `tools/pre-execute`, supports Git/copy providers, turn-boundary
forks, quotas, and explicit pre-rewind checkpoints. The remaining
differentiators here are the persistent DAG/reflection model, Agent-write and
unattributed-mutation audit surfaces, selective/merge restore, and the explicit
external-effect adapter contract. PerryLink currently offers a simpler
single-session rewind workflow; Time Machine deliberately keeps parallel branch
history instead of pruning it into one linear cursor.

The current peer documentation also exposes an important policy trade-off that
should remain visible to adopters: PerryLink's restore is path-explicit and
never deletes files created after a checkpoint, while Time Machine's full Git
restore can remove ordinary orphan files only after an explicit reviewed plan
(`git clean -fd` is never an implicit turn action). This is why the dashboard
and CLI surface deleted/new paths before confirmation. PerryLink's guard
checkpoint makes its rewind reversible; Time Machine provides the equivalent
rescue checkpoint plus a persistent DAG, but callers must still choose the
restore target deliberately.

Hermes currently offers a different hand-edit contract: its agent-write ledger
records content hashes for successful file writes and skips files whose current
contents no longer match, while `/rollback --all` opts into a full overwrite.
Time Machine intentionally does not infer authorship from file contents; safe
restore rejects drift and explicit Git merge reports path conflicts. This is
more conservative for an untrusted multi-process workspace, but less convenient
for users who expect automatic preservation of hand-edits. See the
[Hermes checkpoint documentation](https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback)
for that behavior.

Hermes' current checkpoint documentation specifies opt-in snapshots before
file tools and destructive terminal commands, with at most one checkpoint per
directory per turn. Time Machine now offers the same boundary for
DSH tools when `autoPreCommandSnapshot` is enabled: the `tools/pre-execute`
waterfall (with an `execute` fallback) creates a tagged checkpoint before configured high-risk tools. This
does not intercept a shell launched outside DSH, and disabled-by-default keeps
the extra DAG nodes and snapshot cost explicit. First-party file-tool events
remain ledger-backed while later shell/PTC changes are still inventoried as
unattributed. See the
[Hermes secure-workstation guide](https://hermes-agent.nousresearch.com/docs/guides/secure-hermes-on-a-work-machine)
for the peer behavior.

Time Machine now offers a deliberately explicit partial-capture mode for
compatibility with Change Ledger's oversized-file behavior. It is disabled by
default: when enabled, omitted paths are persisted in the DAG and restore
preserves their live content rather than deleting or replacing it. The mode is
still not a complete workspace backup, and integrations must surface
`omittedPaths` before presenting a checkpoint as restorable.

Time Machine's remaining boundaries are also important: the cross-process lock
prevents concurrent mutation but does not create separate worktrees or
containers; the default restore is snapshot replacement (an explicit Git-only
`--merge` mode handles non-conflicting drift, but is not a general patch
editor); and
database, network, process, cloud, and other external side effects are outside
the workspace snapshot. Registered compensation adapters are an explicit escape
hatch, not automatic transaction rollback: authentication, authorization,
remote idempotency, and retry policy remain adapter-owned. Quota-driven compaction is opt-in via `autoPrune`;
restore journals are durable and replayed on startup; pruning and history
compaction do not run repository-wide Git GC. Manual age filtering is available
through `/tm-prune --older-than=...` and `olderThanMs` in the Web API, but
automatic time-based expiration is available as the opt-in
`retentionMaxAgeMs` policy; it protects current and branch-head checkpoints.
Shadow-object encryption is now opt-in through `shadowStoreEncryptionKeyEnv`.
`GET /api/storage` reports `gitObjectsEncrypted: true` only when the service is
actually using the AES-GCM archive (or the encrypted store is freshly configured
with no objects yet); otherwise it remains `false`. `GET /api/capabilities`
surfaces `shadowStoreMigrationRequired: true` when legacy plaintext objects are
detected. Existing plaintext objects require explicit `/tm-shadow-migrate`, and normal operations
remove the disposable Git runtime directory after each plumbing call. The
archive uses a durable append journal to remove interrupted staging and
unreferenced payloads on the next access; the remaining plaintext runtime
window is documented as an explicit security boundary.
Ignored-file quarantine can independently be encrypted with
`quarantineEncryptionKeyEnv`.

This worktree limitation is also a current DSH host-contract limitation, not
just a plugin policy choice. DSH's `workspaceRegistry` and session APIs can
attach a session to an existing workspace directory, but the public
`SessionForkRequest` currently accepts only `sessionId` and optional `atSeq`.
The built-in fork path therefore reuses the source workspace; it cannot ask
the host to create a new worktree or container for the child. Time Machine
keeps the limitation visible through capability discovery and uses its
cross-process lock until DSH exposes an explicit isolated-workspace fork API.

Further reading:

- [Hermes checkpoint and rollback](https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback)
- [dsh-turn-rewind / Change Ledger](https://github.com/Anionex/dsh-turn-rewind)
- [dsh-undo](https://github.com/LingLambda/dsh-undo)
- [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)
- [dsh-rewind](https://github.com/SiriLee/dsh-rewind)
- [dsh-undo](https://github.com/23swccp/dsh-undo)
- [dsh-rollback](https://github.com/Taler97/dsh-rollback)
- [XSJUSTC/dsh-rewind](https://github.com/XSJUSTC/dsh-rewind)
