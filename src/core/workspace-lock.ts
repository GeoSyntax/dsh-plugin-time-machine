import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export interface WorkspaceLockOptions {
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number;
}

/** Cross-process lock for workspace-changing operations. */
export class WorkspaceBusyError extends Error {
  readonly code = 'WORKSPACE_BUSY';

  constructor(lockPath: string, timeoutMs: number) {
    super(`Workspace is busy (lock: ${lockPath}); waited ${timeoutMs}ms.`);
    this.name = 'WorkspaceBusyError';
  }
}

export class WorkspaceFileLock {
  private readonly lockPath: string;
  private readonly timeoutMs: number;
  private readonly retryMs: number;
  private readonly staleMs: number;

  constructor(lockPath: string, options: WorkspaceLockOptions = {}) {
    this.lockPath = path.resolve(lockPath);
    this.timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 30_000));
    this.retryMs = Math.max(5, Math.floor(options.retryMs ?? 25));
    this.staleMs = Math.max(this.retryMs, Math.floor(options.staleMs ?? 120_000));
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const handle = await this.acquire(token);
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      await this.release(token);
    }
  }

  private async acquire(token: string): Promise<fs.FileHandle> {
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await fs.open(this.lockPath, 'wx');
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: os.hostname(), createdAt: Date.now() }), 'utf8');
        return handle;
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        await this.removeDeadOwner();
        if (Date.now() - startedAt >= this.timeoutMs) throw new WorkspaceBusyError(this.lockPath, this.timeoutMs);
        await new Promise(resolve => setTimeout(resolve, this.retryMs));
      }
    }
  }

  private async removeDeadOwner(): Promise<void> {
    const stat = await fs.stat(this.lockPath).catch(() => undefined);
    if (!stat) return;
    const owner = await fs.readFile(this.lockPath, 'utf8').then(value => JSON.parse(value) as { pid?: number; createdAt?: number }).catch(() => ({}));
    const age = Date.now() - (owner.createdAt ?? stat.mtimeMs);
    if (owner.pid && owner.pid !== process.pid) {
      try {
        process.kill(owner.pid, 0);
        return;
      } catch {
        await fs.rm(this.lockPath, { force: true }).catch(() => undefined);
        return;
      }
    }
    if (age > this.staleMs) await fs.rm(this.lockPath, { force: true }).catch(() => undefined);
  }

  private async release(token: string): Promise<void> {
    const owner = await fs.readFile(this.lockPath, 'utf8').then(value => JSON.parse(value) as { token?: string }).catch(() => undefined);
    if (owner?.token === token) await fs.rm(this.lockPath, { force: true }).catch(() => undefined);
  }
}
