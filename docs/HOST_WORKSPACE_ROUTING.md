# Host workspace routing contract

Time Machine deliberately reports `workspaceRouting: "single-root"` when it
is loaded through the current public DSH alpha API. A plugin instance owns one
canonical `workDir`; sessions whose `header.cwd` differs are skipped instead
of being attached to the wrong repository.

This document defines the smallest host extension needed to support multiple
workspaces and isolated forked sessions without weakening that safety rule.

The portable plugin now exposes `GET /api/workspace-route?sessionId=...` and
`TimeMachineClient.workspaceRoute()` so a companion can inspect the current
route. Without a host adapter the response is explicitly
`configured-root`/`shared-lock`; an adapter-provided route is validated before
it is returned, and invalid relative paths fail closed.

## Required host surface

The host adapter should provide all of the following operations as one atomic
capability. Partial implementations must not advertise multi-workspace mode.

```ts
interface TimeMachineWorkspaceHost {
  resolveSessionWorkspace(sessionId: string): Promise<{
    workspaceId: string;
    cwd: string;
    isolation: 'shared-lock' | 'isolated-worktree' | 'isolated-container';
  }>;

  forkSession(request: {
    sourceSessionId: string;
    atSeq?: number;
    workspaceId: string;
    cwd: string;
  }): Promise<{ sessionId: string; workspaceId: string; cwd: string }>;
}
```

`resolveSessionWorkspace()` must return a canonical, real path. The plugin must
reject a path that is relative, escapes the declared root, or changes while an
operation is running. `forkSession()` must create/attach the child session and
route it to the returned workspace before resolving; returning a session id
first and attaching later is not sufficient for rewind atomicity.

## Plugin behavior when enabled

For each `workspaceId`, the plugin creates an independent service context:

- a separate `GitPlumbingEngine` and fallback engine;
- a separate DAG namespace and restore journal;
- a separate cross-process lock;
- a storage directory derived from the configured root and workspace id;
- a session-to-workspace index used by Web, CLI, and companion requests.

The parent checkpoint and child fork must use the same workspace route during
the restore transaction. If route resolution, workspace creation, physical
restore, or session fork fails, the rescue checkpoint compensates the parent
workspace and the child is never reported as usable.

## Capability states

The host should expose one of these explicit combinations through
`GET /api/capabilities`:

| Host contract | `workspaceRouting` | `workspaceIsolation` | Allowed behavior |
| --- | --- | --- | --- |
| No adapter | `single-root` | `shared-lock` | Current behavior; foreign `cwd` is skipped |
| Resolver only | `multi-root` | `shared-lock` | Multiple roots may be checkpointed, but fork remains serialized per root |
| Resolver + isolated fork | `multi-root` | `isolated-worktree` or `isolated-container` | Parallel fork exploration is allowed |
| Adapter error/unknown | `single-root` | `shared-lock` | Fail closed; never infer isolation from a workspace id |

The existing `workspaceIsolation` values must remain claims about actual
filesystem routing, not user configuration. A host that merely labels a
session as belonging to a workspace must still report `shared-lock` until the
child cwd is created and attached.

## Acceptance matrix

An implementation is ready to advertise `multi-root` only after it proves:

1. Two sessions with different `cwd` values create checkpoints in different
   DAG/storage roots and cannot read each other's private refs.
2. A forked child receives the requested workspace before its first turn.
3. A failed child attach restores the parent rescue checkpoint and leaves no
   orphan workspace or session index entry.
4. Concurrent restores in different roots proceed independently, while two
   restores in one root remain serialized by that root's lock.
5. Restart/recovery reconstructs the session-to-workspace index without
   creating a ghost session or silently switching a session to another root.
6. The Web dashboard, CLI, and companion client all reject an unknown or
   mismatched `workspaceId` with a structured error.

## Why this is an upstream contract

The current DSH `SessionForkRequest` accepts only `sessionId` and `atSeq`; the
host derives the child workspace from the source session. A third-party plugin
cannot safely add a cwd argument by monkey-patching that request. The proper
fix belongs in the host session controller, after which Time Machine can
implement the adapter above without changing its append-only session-log
semantics.

Until that API exists, running one plugin instance per workspace remains the
supported community deployment. This is intentionally stricter than simple
backup plugins: a snapshot in the wrong repository is worse than a skipped
snapshot.
