# Capability comparison

This document explains where Time Machine fits among existing workspace undo and
checkpoint plugins. It is intentionally conservative: a capability is marked
supported only when it is covered by the current implementation and tests.

| Capability | Time Machine | Hermes checkpoints | Change Ledger | dsh-undo / dsh-rewind |
| --- | --- | --- | --- | --- |
| Full workspace snapshot | Git plumbing + non-Git fallback | Yes | Yes | Partial / lightweight |
| Remove ordinary orphan files | Yes | Yes | Yes | Depends on tracked set |
| Ignored-file safety | Preserve by default; quarantine on explicit delete | Configurable | Conflict-aware | Usually left untouched |
| Preview before restore | `tm-preview`, Web API, Web confirmation | Yes | Yes | Limited |
| Selective file restore | `tm-restore-files`, Web API | Yes | Yes | Varies |
| Conversation/session alignment | DSH `sessionController` fork | Product-specific | Product-specific | Usually undo/redo or same window |
| DAG branches | Yes, persistent | No user-facing DAG | Ledger history | Usually linear |
| Failed-tool reflection | Yes | No equivalent | No equivalent | No equivalent |
| Rescue/compensation | Yes | Snapshot-oriented | Journal-oriented | Varies |
| Storage quotas and pruning | Explicit status, conservative prune, explicit history compaction, optional abandoned-branch prune, opt-in hard guards | Yes | Yes | Varies |
| Durable interrupted-restore journal | Yes; startup restores rescue checkpoint | Store recovery | Yes | Varies |
| Independent shadow store | Opt-in `shadowStore: true`; loose GC plus explicit private-pack repack | Yes | Yes | Usually local backups |
| Cross-process workspace lock | Yes; bounded wait with stale-owner recovery | Product-specific | Usually process-local | Usually unavailable |

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

The remaining roadmap is safe migration tooling around shadow storage and true
multi-agent worktree isolation. The cross-process lock prevents concurrent mutation, but it
does not create separate workspaces. Quota-driven compaction is opt-in via `autoPrune`; restore
journals are durable and replayed on startup. Pruning and history compaction do
not run repository-wide Git GC.

Further reading:

- [Hermes checkpoint and rollback](https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback)
- [dsh-turn-rewind / Change Ledger](https://github.com/Anionex/dsh-turn-rewind)
- [dsh-undo](https://github.com/LingLambda/dsh-undo)
- [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)
- [dsh-rewind](https://github.com/SiriLee/dsh-rewind)
