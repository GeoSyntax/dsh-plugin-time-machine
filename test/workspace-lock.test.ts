import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceBusyError, WorkspaceFileLock } from '../src/core/workspace-lock.js';

describe('WorkspaceFileLock', () => {
  it('serializes independent lock instances sharing a lock file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-lock-test-'));
    const lockPath = path.join(dir, 'workspace.lock');
    const first = new WorkspaceFileLock(lockPath, { timeoutMs: 1000, retryMs: 5 });
    const second = new WorkspaceFileLock(lockPath, { timeoutMs: 1000, retryMs: 5 });
    const events: string[] = [];
    const held = first.run(async () => {
      events.push('first-enter');
      await new Promise(resolve => setTimeout(resolve, 40));
      events.push('first-exit');
    });
    await new Promise(resolve => setTimeout(resolve, 5));
    const queued = second.run(async () => { events.push('second-enter'); });
    await Promise.all([held, queued]);
    expect(events).toEqual(['first-enter', 'first-exit', 'second-enter']);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports a live owner instead of overwriting it after timeout', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-lock-timeout-'));
    const lockPath = path.join(dir, 'workspace.lock');
    const first = new WorkspaceFileLock(lockPath, { timeoutMs: 500, retryMs: 5 });
    const second = new WorkspaceFileLock(lockPath, { timeoutMs: 25, retryMs: 5 });
    const held = first.run(async () => new Promise(resolve => setTimeout(resolve, 80)));
    await new Promise(resolve => setTimeout(resolve, 5));
    await expect(second.run(async () => undefined)).rejects.toBeInstanceOf(WorkspaceBusyError);
    await held;
    await fs.rm(dir, { recursive: true, force: true });
  });
});
