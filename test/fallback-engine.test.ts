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

  it('rejects an oversized file before copying a fallback snapshot', async () => {
    engine = new FallbackSnapshotEngine({ workDir: root, storageDir: storage, preservePaths: [storage], maxSnapshotFileBytes: 4 });
    await fs.writeFile(path.join(root, 'large.txt'), '12345', 'utf8');
    await expect(engine.createSnapshot({ sessionId: 'limits', checkpointId: 'one' }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_SIZE_LIMIT' });
    await expect(fs.access(path.join(storage, 'limits'))).rejects.toThrow();
  });

  it('fails closed before restoring through a symlink ancestor', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fallback-outside-'));
    try {
      await fs.mkdir(path.join(root, 'escape'));
      await fs.writeFile(path.join(root, 'escape', 'state.txt'), 'safe\n', 'utf8');
      await engine.createSnapshot({ sessionId: 'symlink-ancestor', checkpointId: 'base' });
      await fs.rm(path.join(root, 'escape'), { recursive: true, force: true });
      await fs.writeFile(path.join(outside, 'state.txt'), 'outside\n', 'utf8');
      await fs.symlink(outside, path.join(root, 'escape'), 'junction');

      await expect(engine.restoreSnapshot('symlink-ancestor', 'base')).rejects.toMatchObject({
        code: 'UNSUPPORTED_WORKSPACE_STATE',
        paths: ['escape'],
      });
      expect(await fs.readFile(path.join(outside, 'state.txt'), 'utf8')).toBe('outside\n');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('inventories added, modified, and deleted files against a fallback manifest', async () => {
    await fs.writeFile(path.join(root, 'modified.txt'), 'before\n', 'utf8');
    await fs.writeFile(path.join(root, 'deleted.txt'), 'remove\n', 'utf8');
    await engine.createSnapshot({ sessionId: 'inventory', checkpointId: 'base' });
    await fs.writeFile(path.join(root, 'modified.txt'), 'after\n', 'utf8');
    await fs.rm(path.join(root, 'deleted.txt'));
    await fs.writeFile(path.join(root, 'added.txt'), 'new\n', 'utf8');
    await expect(engine.getChangedFiles('inventory', 'base')).resolves.toEqual([
      { path: 'added.txt', status: 'added' },
      { path: 'deleted.txt', status: 'deleted' },
      { path: 'modified.txt', status: 'modified' },
    ]);
  });

  it('renders text and binary diffs between fallback checkpoints', async () => {
    await fs.writeFile(path.join(root, 'app.txt'), 'one\ntwo\n', 'utf8');
    await fs.writeFile(path.join(root, 'removed.txt'), 'gone\n', 'utf8');
    await engine.createSnapshot({ sessionId: 'diffs', checkpointId: 'base' });
    await fs.writeFile(path.join(root, 'app.txt'), 'one\nthree\n', 'utf8');
    await fs.rm(path.join(root, 'removed.txt'));
    await fs.writeFile(path.join(root, 'added.txt'), 'new\n', 'utf8');
    const target = await engine.createSnapshot({ sessionId: 'diffs', checkpointId: 'target' });
    expect(target.commitOid).toMatch(/^fallback_/);
    const result = await engine.getDiffBetween('diffs', 'base', 'target');
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'added.txt', status: 'added', diffText: expect.stringContaining('+new') }),
      expect.objectContaining({ file: 'app.txt', status: 'modified', diffText: expect.stringContaining('-two') }),
      expect.objectContaining({ file: 'removed.txt', status: 'deleted', diffText: expect.stringContaining('-gone') }),
    ]));

    await fs.writeFile(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2]), 'binary');
    await engine.createSnapshot({ sessionId: 'diffs', checkpointId: 'binary-base' });
    await fs.writeFile(path.join(root, 'blob.bin'), Buffer.from([0, 1, 3]), 'binary');
    await engine.createSnapshot({ sessionId: 'diffs', checkpointId: 'binary-target' });
    await expect(engine.getDiffBetween('diffs', 'binary-base', 'binary-target')).resolves.toEqual([
      expect.objectContaining({ file: 'blob.bin', status: 'modified', diffText: 'Binary files a/blob.bin and b/blob.bin differ' }),
    ]);
  });
});
