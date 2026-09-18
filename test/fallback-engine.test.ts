import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FallbackSnapshotEngine } from '../src/core/fallback-engine.js';

describe('FallbackSnapshotEngine', () => {
  let root: string;
  let storage: string;
  let engine: FallbackSnapshotEngine;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fallback-'));
    storage = path.join(root, '.state');
    engine = new FallbackSnapshotEngine({ workDir: root, storageDir: storage, preservePaths: [storage] });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('restores content and removes orphan files without recursing into its own storage', async () => {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'app.txt'), 'one\n');
    await engine.createSnapshot({ sessionId: '../unsafe-session', checkpointId: '../unsafe-checkpoint' });

    await fs.writeFile(path.join(root, 'src', 'app.txt'), 'two\n');
    await fs.writeFile(path.join(root, 'orphan.txt'), 'remove me\n');
    await engine.restoreSnapshot('../unsafe-session', '../unsafe-checkpoint');

    expect(await fs.readFile(path.join(root, 'src', 'app.txt'), 'utf8')).toBe('one\n');
    await expect(fs.access(path.join(root, 'orphan.txt'))).rejects.toThrow();
    expect((await fs.readdir(storage)).length).toBeGreaterThan(0);
  });
});
