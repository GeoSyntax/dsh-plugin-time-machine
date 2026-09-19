import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { forkThroughWorkspaceHost } from '../src/core/workspace-host.js';

describe('workspace host adapter contract', () => {
  it('routes a valid same-root fork with the canonical route', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-host-'));
    const calls: any[] = [];
    try {
      const result = await forkThroughWorkspaceHost({
        resolveSessionWorkspace: async () => ({ workspaceId: 'root', cwd: root, isolation: 'shared-lock' }),
        forkSession: async request => { calls.push(request); return { sessionId: 'child', workspaceId: request.workspaceId, cwd: request.cwd }; },
      }, 'source', 7, root);
      expect(result).toEqual({ sessionId: 'child' });
      expect(calls).toEqual([{ sourceSessionId: 'source', atSeq: 7, workspaceId: 'root', cwd: root }]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a filesystem alias while preserving the host route spelling', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-host-alias-'));
    const aliasParent = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-host-alias-parent-'));
    const alias = path.join(aliasParent, 'workspace');
    const calls: any[] = [];
    try {
      try {
        await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return;
      }
      await expect(forkThroughWorkspaceHost({
        resolveSessionWorkspace: async () => ({ workspaceId: 'root', cwd: alias, isolation: 'shared-lock' }),
        forkSession: async request => { calls.push(request); return { sessionId: 'child', workspaceId: request.workspaceId, cwd: request.cwd }; },
      }, 'source', undefined, root)).resolves.toEqual({ sessionId: 'child' });
      expect(calls[0]?.cwd).toBe(alias);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(aliasParent, { recursive: true, force: true });
    }
  });

  it('rejects a route outside the configured root before calling the host', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-host-root-'));
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-host-other-'));
    let called = false;
    try {
      await expect(forkThroughWorkspaceHost({
        resolveSessionWorkspace: async () => ({ workspaceId: 'other', cwd: other, isolation: 'isolated-worktree' }),
        forkSession: async () => { called = true; return { sessionId: 'unexpected', workspaceId: 'other', cwd: other }; },
      }, 'source', undefined, root)).rejects.toMatchObject({ code: 'WORKSPACE_ROUTE_MISMATCH' });
      expect(called).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('rejects an invalid host result', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-host-result-'));
    try {
      await expect(forkThroughWorkspaceHost({
        resolveSessionWorkspace: async () => ({ workspaceId: 'root', cwd: root, isolation: 'shared-lock' }),
        forkSession: async () => ({ sessionId: '', workspaceId: 'root', cwd: root }),
      }, 'source', undefined, root)).rejects.toMatchObject({ code: 'WORKSPACE_HOST_INVALID_RESULT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
