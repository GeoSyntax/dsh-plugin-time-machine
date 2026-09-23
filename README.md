# DSH Time Machine

**Rewind the workspace and the DSH session together, then fork without losing failed work**

Use preview-first checkpoints, safe workspace restore, persistent DAG branches, and failure reflection in DeepSeek Harness.

[中文说明](README.zh-CN.md)

## Demo

The verified demo below shows a failed Redis branch, a rescue checkpoint, orphan-file cleanup, and a successful JWT branch that keeps the failure evidence.

![DSH Time Machine DAG and reflection demo](https://raw.githubusercontent.com/GeoSyntax/dsh-plugin-time-machine/main/docs/assets/dag-demo.svg)

## Install

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

The current distribution is a GitHub dependency for DSH `>=0.1.5-rc.2 <0.2.0` on the `web` profile. It requires Node.js `^22.19.0 || >=24.0.0`.

## Quickstart

Add the plugin to the profile's `cordis.patch.yml`, then restart DSH:

```yaml
plugins:
  - id: time-machine
    package: dsh-plugin-time-machine
    config:
      autoSnapshot: true
      restoreMode: safe
      enableWebUI: true
```

Use these commands in a session:

```text
/tm-list                              # show checkpoints on the active lineage
/tm-preview <checkpoint>              # inspect files, conflicts, and side effects
/tm-rewind <checkpoint>               # restore the workspace and fork an aligned session
/tm-fork <checkpoint> experiment/jwt   # explore a parallel branch without overwriting history
```

The standalone dashboard listens on `http://127.0.0.1:3088` when `enableWebUI` is enabled. Preview a plan before every destructive operation.

## What you can do

- **Clean up orphan files:** remove ordinary files and directories created after a checkpoint, while ignored files remain protected by default and explicit deletion uses recoverable quarantine.
- **Keep every experiment:** preserve failed branches, rescue points, and successful alternatives in a persistent DAG instead of overwriting a linear undo chain.
- **Align memory with disk:** store DSH messages, token state, message anchors, and workspace trees in one checkpoint boundary.
- **Learn from failed turns:** carry sanitized failed-tool evidence and reflection guidance into a new fork so the Agent can avoid repeating a known-bad approach.
- **Review before mutation:** inspect unified diffs, added/deleted paths, conflicts, omitted paths, external effects, and a single-use restore plan before changing files.
- **Protect verified hand-edits:** opt into the Agent-write ledger and preserve a path only when recorded write evidence proves that a later edit is not the same Agent write.
- **Work outside Git:** use the fallback manifest engine with content hashes and the same path-safety checks when the workspace is not a Git repository.
- **Audit external effects:** declare database, network, process, or cloud changes and block restore/fork in strict mode until an explicit compensation adapter resolves them.

## Safety model

Time Machine uses an isolated Git index and private `refs/dsh-tm/*` objects, so ordinary branches, the user's staging index, and DSH's append-only session log remain untouched. Every rewind or fork creates a rescue checkpoint first.

Safe mode refuses unverified user/staged/ignored drift. Git-only `--merge` keeps non-conflicting edits and reports conflicts. Symlink ancestors, hard-linked targets, sparse checkouts, submodules, and in-progress merge/rebase/cherry-pick states fail closed before mutation.

Optional AES-256-GCM encryption protects session metadata, shadow objects, and quarantine backups. Restore journals recover interrupted operations on the next startup.

## Compared with similar plugins

| Product | Primary workflow | Time Machine's difference |
| --- | --- | --- |
| Hermes checkpoints | Pre-tool snapshots, Agent-write hashes, same-window rollback | Adds persistent DAG exploration, session alignment, failure reflection, and external-effect gates while keeping strict drift rejection as the default |
| Change Ledger | Lightweight mutation ledger and selective restore | Adds full orphan cleanup, preview plans, rescue journals, and a session-aware branch model |
| `dsh-checkpoint-rewind` | DSH checkpoint/rewind with Git or copy providers | Extends the turn boundary with durable branches, reflection, and evidence-based restore policies |
| `dsh-undo` / `dsh-rewind` | Low-friction linear or same-window undo | Keeps the original exploration branches and makes a new session explicit when the host only supports shared workspaces |

Choose a smaller undo plugin for a simple Ctrl+Z interaction. Choose Time Machine when the workspace, conversation, failed attempts, and parallel exploration need to remain explainable together. See the [full comparison](docs/COMPARISON.md).

## Boundaries

- **External systems:** file restore cannot undo a database transaction, network request, process, or cloud mutation. Register a compensation adapter or use strict mode to block the restore.
- **Workspace isolation:** current public DSH alpha hosts expose a shared workspace fork, not a new worktree or container. The plugin reports `shared-lock` and refuses to pretend it is isolated.
- **Compatibility:** the manifest declares the `web` profile only. The optional [`client-companion/`](client-companion/README.md) package adds DSH Web action slots; it is not required by the core service.
- **Partial snapshots:** oversized files can be omitted only with an explicit opt-in, and every omitted path remains visible in preview and restore results.

## Verification

The release gate covers 143 automated tests, build and consumer imports, package contents, dependency audit, DSH bundle smoke, and Node 22/24 on Ubuntu, macOS, and Windows.

The project has also passed real DSH source-host and Web smoke runs with a local OpenAI-compatible Gemini gateway: finalized checkpoints, Agent-write evidence, restart DAGs, failed tools, pre-command checkpoints, Web fork/rewind, and SessionController failure compensation.

- [Test plan and evidence](docs/TEST_PLAN.md)
- [Community submission package](docs/COMMUNITY_SUBMISSION.md)
- [Release process](docs/RELEASING.md)

## License

MIT
