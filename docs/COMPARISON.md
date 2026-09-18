# Capability comparison

This document explains where Time Machine fits among existing workspace undo and
checkpoint plugins. It is intentionally conservative: a capability is marked
supported only when it is covered by the current implementation and tests.

| Capability | Time Machine | Hermes checkpoints | Change Ledger | dsh-undo / dsh-rewind |
| --- | --- | --- | --- | --- |
| Full workspace snapshot | Git plumbing + non-Git fallback | Yes | Yes | Partial / lightweight |
| Remove ordinary orphan files | Yes | Yes | Yes | Depends on tracked set |
| Ignored-file safety | Preserve by default; quarantine on explicit delete | Configurable | Conflict-aware | Usually left untouched |
| Preview before restore | `tm-preview`, Web API, Web confirmation, conflict paths | Yes | Yes | Limited |
| Selective file restore | `tm-restore-files`, Web API | Yes | Yes | Varies |
| Conversation/session alignment | DSH `sessionController` fork | Product-specific | Product-specific | Usually undo/redo or same window |
| DAG branches | Yes, persistent | No user-facing DAG | Ledger history | Usually linear |
| Failed-tool reflection | Yes | No equivalent | No equivalent | No equivalent |
| Rescue/compensation | Yes | Snapshot-oriented | Journal-oriented | Varies |
| Storage quotas and pruning | Explicit status, conservative prune, explicit history compaction, optional abandoned-branch prune, opt-in hard guards | Yes | Yes | Varies |
| Durable interrupted-restore journal | Yes; startup restores rescue checkpoint | Store recovery | Yes | Varies |
| Independent shadow store | Opt-in `shadowStore: true`; loose GC plus explicit private-pack repack | Yes | Yes | Usually local backups |
| Cross-process workspace lock | Yes; bounded wait with stale-owner recovery | Product-specific | Change Ledger documents active-session blocking and Git-operation fences | Usually unavailable |

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
to create an aligned conversation. `/tm-restore-files` is deliberately
workspace-only; it restores selected paths, keeps the current conversation
messages, and records rescue/result checkpoints instead of pretending the
conversation was rewound.

The comparison is deliberately not a claim that Time Machine is ahead of every
peer. In particular, the current Change Ledger implementation has several
production-hardening features that are still on our roadmap: expiring,
session-bound restore plans; explicit Git HEAD/branch/in-progress-operation
fences; sparse-checkout and submodule policy; unsupported-file and per-file size
reporting; path-identity caches for large workspaces; and a host-native,
message-anchored rewind action. We should adopt those ideas where they fit
without copying their storage format.

Time Machine's remaining boundaries are also important: the cross-process lock
prevents concurrent mutation but does not create separate worktrees or
containers; restore is snapshot replacement rather than a three-way merge; and
database, network, process, cloud, and other external side effects are outside
the workspace snapshot. Quota-driven compaction is opt-in via `autoPrune`;
restore journals are durable and replayed on startup; pruning and history
compaction do not run repository-wide Git GC. Shadow-store encryption and
age-based expiration are not implemented yet.

Further reading:

- [Hermes checkpoint and rollback](https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback)
- [dsh-turn-rewind / Change Ledger](https://github.com/Anionex/dsh-turn-rewind)
- [dsh-undo](https://github.com/LingLambda/dsh-undo)
- [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)
- [dsh-rewind](https://github.com/SiriLee/dsh-rewind)
