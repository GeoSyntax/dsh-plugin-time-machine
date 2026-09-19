import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertNoSymlinkAncestors } from '../src/core/path-safety.js';

describe('workspace path safety', () => {
  it('rejects paths whose ancestor is a symlink', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-tm-path-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-tm-outside-'));
    await fs.symlink(outside, path.join(root, 'escape'), 'junction');
    await expect(assertNoSymlinkAncestors(root, ['escape/file.txt'])).rejects.toMatchObject({
      code: 'UNSUPPORTED_WORKSPACE_STATE',
      paths: ['escape'],
    });
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('allows ordinary workspace descendants', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-tm-path-'));
    await fs.mkdir(path.join(root, 'src'));
    await expect(assertNoSymlinkAncestors(root, ['src/file.txt'])).resolves.toBeUndefined();
    await fs.rm(root, { recursive: true, force: true });
  });
});
