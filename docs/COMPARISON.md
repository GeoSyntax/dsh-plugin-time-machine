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
| Storage quotas and pruning | Not yet complete | Yes | Yes | Varies |
| Durable interrupted-restore journal | Not yet complete | Store recovery | Yes | Varies |
| Independent shadow store | Not yet; Git objects are reused | Yes | Yes | Usually local backups |

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

The remaining roadmap is storage governance (quota/prune), durable restore
journals, and a fully independent shadow store. These are separate from the
core safety invariant and should not be represented as already supported.

Further reading:

- [Hermes checkpoint and rollback](https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback)
- [dsh-turn-rewind / Change Ledger](https://github.com/Anionex/dsh-turn-rewind)
- [dsh-undo](https://github.com/LingLambda/dsh-undo)
- [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)
- [dsh-rewind](https://github.com/SiriLee/dsh-rewind)
