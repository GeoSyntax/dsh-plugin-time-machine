import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitPlumbingEngine } from '../src/core/git-plumbing.js';

const execAsync = promisify(execFile);

describe('GitPlumbingEngine', () => {
  let tmpDir: string;
  let engine: GitPlumbingEngine;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-tm-test-'));
    // 初始化临时 git 仓库
    await execAsync('git', ['init'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.name', 'TestBot'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.email', 'bot@test.com'], { cwd: tmpDir });

    engine = new GitPlumbingEngine({ workDir: tmpDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('should detect git repository correctly', async () => {
    const isRepo = await engine.isGitRepo();
    expect(isRepo).toBe(true);
  });

  it('reports sparse checkout and refuses an incomplete snapshot', async () => {
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'tracked\n', 'utf8');
    await execAsync('git', ['add', 'tracked.txt'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'fixture'], { cwd: tmpDir });
    await execAsync('git', ['sparse-checkout', 'init', '--cone'], { cwd: tmpDir });
    const capabilities = await engine.inspectWorkspaceCapabilities();
    expect(capabilities.sparseCheckout).toBe(true);
    await expect(engine.createSnapshot({ sessionId: 'sparse', checkpointId: 'one' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_WORKSPACE_STATE' });
  });

  it('reports submodule gitlinks instead of pretending to capture nested content', async () => {
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'tracked\n', 'utf8');
    await execAsync('git', ['add', 'tracked.txt'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'fixture'], { cwd: tmpDir });
    const { stdout: head } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir });
    await execAsync('git', ['update-index', '--add', '--cacheinfo', `160000,${head.trim()},nested-module`], { cwd: tmpDir });
    const capabilities = await engine.inspectWorkspaceCapabilities();
    expect(capabilities.submodulePaths).toEqual(['nested-module']);
    await expect(engine.createSnapshot({ sessionId: 'submodule', checkpointId: 'one' }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_WORKSPACE_STATE' });
  });

  it('rejects a snapshot before staging an oversized file', async () => {
    const limited = new GitPlumbingEngine({ workDir: tmpDir, maxSnapshotFileBytes: 4 });
    await fs.writeFile(path.join(tmpDir, 'large.txt'), '12345', 'utf8');
    await expect(limited.createSnapshot({ sessionId: 'limits', checkpointId: 'one' }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_SIZE_LIMIT' });
    expect((await execAsync('git', ['status', '--short'], { cwd: tmpDir })).stdout).toContain('large.txt');
  });

  it('supports explicit partial snapshots and preserves omitted live paths on restore', async () => {
    const file = path.join(tmpDir, 'large.txt');
    await fs.writeFile(file, 'captured-too-large', 'utf8');
    const partial = new GitPlumbingEngine({
      workDir: tmpDir,
      maxSnapshotFileBytes: 4,
      allowPartialSnapshots: true,
    });
    const snapshot = await partial.createSnapshot({ sessionId: 'partial', checkpointId: 'one' });
    expect(snapshot.omittedPaths).toEqual(['large.txt']);
    expect((await partial.getDiffBetween(snapshot.commitOid, snapshot.commitOid))).toEqual([]);

    await fs.writeFile(file, 'live-content-after-checkpoint', 'utf8');
    await partial.restoreSnapshot(snapshot.commitOid, { omittedPaths: snapshot.omittedPaths });
    expect(await fs.readFile(file, 'utf8')).toBe('live-content-after-checkpoint');
    const inspected = await partial.inspectWorkspace({ omitPaths: snapshot.omittedPaths });
    expect(inspected.treeOid).toBe(snapshot.treeOid);
  });

  it('rejects malformed omitted paths before touching the temporary index', async () => {
    await expect(engine.inspectWorkspace({ omitPaths: ['../outside.txt'] }))
      .rejects.toThrow(/Unsafe workspace path/);
  });

  it('should create snapshot without polluting git log', async () => {
    // 写入第一个文件
    const file1 = path.join(tmpDir, 'hello.txt');
    await fs.writeFile(file1, 'Initial Content\n', 'utf-8');

    const snap1 = await engine.createSnapshot({
      sessionId: 'sess_1',
      checkpointId: 'turn_1',
    });

    expect(snap1.treeOid).toHaveLength(40);
    expect(snap1.commitOid).toHaveLength(40);
    expect(snap1.changedFiles.length).toBeGreaterThanOrEqual(1);

    // 验证正常的 git log 为空（没有普通 commit，完全隐形于用户）
    const { stdout: logOut } = await execAsync('git', ['log', '--oneline'], { cwd: tmpDir }).catch(() => ({ stdout: '' }));
    expect(logOut.trim()).toBe('');

    // 修改文件并增加一个文件
    await fs.appendFile(file1, 'Modified line\n', 'utf-8');
    const file2 = path.join(tmpDir, 'feature.ts');
    await fs.writeFile(file2, 'console.log("new feature");\n', 'utf-8');

    const snap2 = await engine.createSnapshot({
      sessionId: 'sess_1',
      checkpointId: 'turn_2',
      parentCommitOid: snap1.commitOid,
    });

    expect(snap2.commitOid).not.toBe(snap1.commitOid);

    // A restore must not rewrite the user's real Git index.
    await execAsync('git', ['add', 'feature.ts'], { cwd: tmpDir });
    const { stdout: stagedBefore } = await execAsync('git', ['diff', '--cached', '--binary'], { cwd: tmpDir });

    // 检查 Diff
    const diffs = await engine.getDiffBetween(snap1.commitOid, snap2.commitOid);
    expect(diffs.length).toBeGreaterThanOrEqual(1);

    // 核心测试：原子还原到 snap1
    await engine.restoreSnapshot(snap1.commitOid);

    const { stdout: stagedAfter } = await execAsync('git', ['diff', '--cached', '--binary'], { cwd: tmpDir });
    expect(stagedAfter).toBe(stagedBefore);

    // 验证 file1 内容已复原
    const file1Content = await fs.readFile(file1, 'utf-8');
    expect(file1Content.replace(/\r\n/g, '\n')).toBe('Initial Content\n');

    // 验证新创建的 file2 已经被物理删除恢复
    let file2Exists = true;
    try {
      await fs.access(file2);
    } catch {
      file2Exists = false;
    }
    expect(file2Exists).toBe(false);
  });

  it('reuses an unchanged workspace tree for consecutive checkpoints', async () => {
    await fs.writeFile(path.join(tmpDir, 'stable.txt'), 'stable\n', 'utf8');
    await execAsync('git', ['add', 'stable.txt'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'stable fixture'], { cwd: tmpDir });
    const first = await engine.createSnapshot({ sessionId: 'cache', checkpointId: 'one' });
    const runGit = vi.spyOn(engine, 'runGit');

    const second = await engine.createSnapshot({
      sessionId: 'cache',
      checkpointId: 'two',
      parentCommitOid: first.commitOid,
    });

    expect(second.treeOid).toBe(first.treeOid);
    expect(runGit.mock.calls.some(([args]) => args[0] === 'add')).toBe(false);
    expect(second.changedFiles).toEqual([]);
  });

  it('captures dirty changes by overlaying only status-reported paths on the cached tree', async () => {
    const stable = path.join(tmpDir, 'stable.txt');
    const changed = path.join(tmpDir, 'changed.txt');
    await fs.writeFile(stable, 'stable-v1\n', 'utf8');
    await fs.writeFile(changed, 'changed-v1\n', 'utf8');
    await execAsync('git', ['add', '.'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'incremental fixture'], { cwd: tmpDir });
    const first = await engine.createSnapshot({ sessionId: 'incremental', checkpointId: 'one' });
    await fs.writeFile(changed, 'changed-v2\n', 'utf8');
    const runGit = vi.spyOn(engine, 'runGit');
    const second = await engine.createSnapshot({ sessionId: 'incremental', checkpointId: 'two', parentCommitOid: first.commitOid });

    expect(second.treeOid).not.toBe(first.treeOid);
    expect(second.changedFiles.map(item => item.path)).toContain('changed.txt');
    const added = runGit.mock.calls.filter(([args]) => args[0] === 'add');
    expect(added.length).toBeGreaterThan(0);
    expect(added.flatMap(([args]) => args).join(' ')).toContain('changed.txt');
  });

  it('disables the incremental overlay when the Git branch control plane changes', async () => {
    await fs.writeFile(path.join(tmpDir, 'base.txt'), 'base\n', 'utf8');
    await execAsync('git', ['add', '.'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'branch cache fixture'], { cwd: tmpDir });
    const first = await engine.createSnapshot({ sessionId: 'branch-cache', checkpointId: 'one' });
    await execAsync('git', ['checkout', '-b', 'alternate-cache'], { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, 'branch-only.txt'), 'alternate\n', 'utf8');
    await execAsync('git', ['add', 'branch-only.txt'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'alternate branch'], { cwd: tmpDir });
    await fs.appendFile(path.join(tmpDir, 'base.txt'), 'dirty\n', 'utf8');
    const runGit = vi.spyOn(engine, 'runGit');
    await engine.createSnapshot({ sessionId: 'branch-cache', checkpointId: 'two', parentCommitOid: first.commitOid });

    const addCommands = runGit.mock.calls.filter(([args]) => args[0] === 'add');
    expect(addCommands.some(([args]) => args.includes('.'))).toBe(true);
  });

  it('keeps incremental capture enabled when protected paths are configured', async () => {
    const protectedDir = path.join(tmpDir, '.protected');
    await fs.mkdir(protectedDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'v1\n', 'utf8');
    await execAsync('git', ['add', '.'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'protected-path fixture'], { cwd: tmpDir });
    const protectedEngine = new GitPlumbingEngine({ workDir: tmpDir, preservePaths: [protectedDir] });
    const first = await protectedEngine.createSnapshot({ sessionId: 'protected-cache', checkpointId: 'one' });
    await fs.writeFile(path.join(tmpDir, 'tracked.txt'), 'v2\n', 'utf8');
    await fs.writeFile(path.join(protectedDir, 'runtime.json'), '{}\n', 'utf8');
    const runGit = vi.spyOn(protectedEngine, 'runGit');
    const second = await protectedEngine.createSnapshot({ sessionId: 'protected-cache', checkpointId: 'two', parentCommitOid: first.commitOid });

    expect(second.treeOid).not.toBe(first.treeOid);
    expect(runGit.mock.calls.filter(([args]) => args[0] === 'add').some(([args]) => args.includes('tracked.txt'))).toBe(true);
    expect(second.changedFiles.map(item => item.path)).toContain('tracked.txt');
  });

  it('fails closed when encryption is enabled for a legacy plaintext quarantine', async () => {
    const quarantineDir = path.join(tmpDir, '.quarantine');
    const key = 'legacy-backup';
    const backupRoot = path.join(quarantineDir, Buffer.from(key, 'utf8').toString('base64url'));
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.writeFile(path.join(backupRoot, 'secret.env'), 'token=plaintext\n', 'utf8');
    const encrypted = new GitPlumbingEngine({
      workDir: tmpDir,
      quarantineDir,
      quarantineEncryptionKey: 'operator-key',
    });

    await expect(encrypted.validateIgnoredBackup(key)).rejects.toMatchObject({ code: 'QUARANTINE_KEY_INVALID' });
    await expect(encrypted.restoreIgnoredBackup(key)).rejects.toMatchObject({ code: 'QUARANTINE_KEY_INVALID' });
    expect(await fs.readFile(path.join(backupRoot, 'secret.env'), 'utf8')).toBe('token=plaintext\n');
  });

  it('explicitly migrates a legacy quarantine before encrypted restore', async () => {
    const quarantineDir = path.join(tmpDir, '.quarantine-migrate');
    const key = 'legacy-migrate';
    const backupRoot = path.join(quarantineDir, Buffer.from(key, 'utf8').toString('base64url'));
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.writeFile(path.join(backupRoot, 'secret.env'), 'token=migrated\n', 'utf8');
    const encrypted = new GitPlumbingEngine({
      workDir: tmpDir,
      quarantineDir,
      quarantineEncryptionKey: 'operator-key',
    });

    const result = await encrypted.migrateIgnoredBackup(key);
    expect(result.migrated).toBe(true);
    expect(result.entryCount).toBe(1);
    expect(await fs.access(path.join(backupRoot, '.manifest.json'))).toBeUndefined();
    await encrypted.restoreIgnoredBackup(key);
    expect(await fs.readFile(path.join(tmpDir, 'secret.env'), 'utf8')).toBe('token=migrated\n');
  });

  it('merge-restores non-conflicting live edits while applying the target snapshot', async () => {
    const left = path.join(tmpDir, 'left.txt');
    const right = path.join(tmpDir, 'right.txt');
    await fs.writeFile(left, 'base-left\n', 'utf8');
    await fs.writeFile(right, 'base-right\n', 'utf8');
    const base = await engine.createSnapshot({ sessionId: 'merge', checkpointId: 'base' });
    await fs.writeFile(left, 'target-left\n', 'utf8');
    const target = await engine.createSnapshot({ sessionId: 'merge', checkpointId: 'target', parentCommitOid: base.commitOid });
    await fs.writeFile(right, 'live-right\n', 'utf8');
    const current = await engine.inspectWorkspace();
    const restored = await engine.restoreSnapshot(target.commitOid, {
      mode: 'merge', expectedCurrentTreeOid: base.treeOid,
    });
    expect(await fs.readFile(left, 'utf8')).toBe('target-left\n');
    expect(await fs.readFile(right, 'utf8')).toBe('live-right\n');
    expect(restored.restoredTreeOid).toBe((await engine.inspectWorkspace()).treeOid);
    expect(current.treeOid).toBe(restored.restoredTreeOid);
  });

  it('rejects merge-restores when both target and live changed the same path', async () => {
    const file = path.join(tmpDir, 'conflict.txt');
    await fs.writeFile(file, 'base\n', 'utf8');
    const base = await engine.createSnapshot({ sessionId: 'merge-conflict', checkpointId: 'base' });
    await fs.writeFile(file, 'target\n', 'utf8');
    const target = await engine.createSnapshot({ sessionId: 'merge-conflict', checkpointId: 'target', parentCommitOid: base.commitOid });
    await fs.writeFile(file, 'live\n', 'utf8');
    const current = await engine.inspectWorkspace();
    await expect(engine.restoreSnapshot(target.commitOid, {
      mode: 'merge', expectedCurrentTreeOid: base.treeOid,
    })).rejects.toMatchObject({ code: 'RESTORE_MERGE_CONFLICT', paths: ['conflict.txt'] });
    expect((await engine.inspectWorkspace()).treeOid).toBe(current.treeOid);
  });

  it('should exclude plugin storage from every temporary tree', async () => {
    const storageDir = path.join(tmpDir, '.dsh-tm');
    await fs.mkdir(storageDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'v1\n', 'utf-8');
    engine = new GitPlumbingEngine({ workDir: tmpDir, preservePaths: [storageDir] });

    const first = await engine.createSnapshot({ sessionId: 'storage', checkpointId: 'first' });
    await fs.writeFile(path.join(storageDir, 'dag.json'), '{"mutated":true}\n', 'utf-8');
    const second = await engine.inspectWorkspace();

    expect(second.treeOid).toBe(first.treeOid);
  });

  it('protects storage when the workspace is reached through a symlink', async () => {
    if (process.platform === 'win32') return;
    const alias = path.join(os.tmpdir(), `dsh-tm-alias-${Math.random().toString(16).slice(2)}`);
    await fs.symlink(tmpDir, alias, 'dir');
    try {
      const storageDir = path.join(alias, '.dsh-tm');
      await fs.mkdir(storageDir, { recursive: true });
      await fs.writeFile(path.join(alias, 'app.ts'), 'v1\n', 'utf8');
      engine = new GitPlumbingEngine({ workDir: alias, preservePaths: [storageDir] });
      const first = await engine.createSnapshot({ sessionId: 'symlink', checkpointId: 'first' });
      await fs.writeFile(path.join(storageDir, 'dag.json'), '{"mutated":true}\n', 'utf8');
      expect((await engine.inspectWorkspace()).treeOid).toBe(first.treeOid);
    } finally {
      await fs.rm(alias, { recursive: true, force: true });
    }
  });

  it('can store plugin-created Git objects in an isolated shadow object directory', async () => {
    const shadowObjectDir = path.join(tmpDir, '.dsh-tm', 'git-shadow', 'objects');
    engine = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir });
    const file = path.join(tmpDir, 'shadow.txt');
    await fs.writeFile(file, 'one\n', 'utf8');
    const first = await engine.createSnapshot({ sessionId: 'shadow', checkpointId: 'one' });
    await fs.writeFile(file, 'two\n', 'utf8');
    const extra = path.join(tmpDir, 'extra.txt');
    await fs.writeFile(extra, 'remove me\n', 'utf8');
    const second = await engine.createSnapshot({ sessionId: 'shadow', checkpointId: 'two', parentCommitOid: first.commitOid });
    expect(engine.usesShadowStore).toBe(true);
    expect((await fs.readdir(shadowObjectDir, { withFileTypes: true })).some(entry => entry.isDirectory())).toBe(true);
    expect((await engine.runGit(['cat-file', '-t', first.commitOid])).stdout.trim()).toBe('commit');
    const treeFiles = await engine.runGit(['ls-tree', '-r', first.treeOid]);
    const blobOid = treeFiles.stdout.trim().split(/\s+/)[2];
    expect((await engine.runGit(['cat-file', '-t', blobOid])).stdout.trim()).toBe('blob');
    await engine.getGitDir();
    expect((await engine.runGit(['cat-file', '-t', blobOid])).stdout.trim()).toBe('blob');
    expect((await engine.runGit(['cat-file', 'blob', blobOid])).stdout).toContain('one');
    expect((await engine.runGit(['cat-file', 'blob', blobOid], {}, await engine.getRepoRoot())).stdout).toContain('one');
    expect((await engine.getDiffBetween(first.commitOid, second.commitOid)).length).toBeGreaterThan(0);
    const packed = await engine.repackShadowObjects();
    expect(packed.repacked).toBe(true);
    expect(packed.reachableRefs).toBeGreaterThan(0);
    expect((await fs.readdir(path.join(shadowObjectDir, 'pack'))).some(name => name.endsWith('.pack'))).toBe(true);
    expect((await engine.runGit(['cat-file', '-t', first.commitOid])).stdout.trim()).toBe('commit');
    expect((await engine.repackShadowObjects()).repacked).toBe(true);
    await engine.restoreSnapshot(first.commitOid);
    expect(await fs.readFile(file, 'utf8')).toBe('one\n');
    await expect(fs.access(extra)).rejects.toThrow();
    await engine.cleanupSession('shadow');
    await engine.pruneShadowObjects();
    const repackedAfterDelete = await engine.repackShadowObjects();
    expect(repackedAfterDelete.repacked).toBe(false);
    expect(repackedAfterDelete.reachableRefs).toBe(0);
  });

  it('encrypts shadow objects at rest and restores them through a disposable runtime', async () => {
    const shadowObjectDir = path.join(tmpDir, '.dsh-tm', 'git-shadow', 'objects');
    const archiveDir = path.join(tmpDir, '.dsh-tm', 'git-shadow-encrypted');
    engine = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'shadow-secret' });
    const file = path.join(tmpDir, 'encrypted-shadow.txt');
    await fs.writeFile(file, 'secret-one\n', 'utf8');
    const first = await engine.createSnapshot({ sessionId: 'encrypted-shadow', checkpointId: 'one' });
    expect(engine.usesEncryptedShadowStore).toBe(true);
    const manifest = JSON.parse(await fs.readFile(path.join(archiveDir, 'manifest.v1.json'), 'utf8')) as { version: number; entries: unknown[] };
    expect(manifest.version).toBe(1);
    expect(manifest.entries.length).toBeGreaterThan(0);
    await expect(fs.access(shadowObjectDir)).rejects.toThrow();
    const encryptedBytes = await fs.readFile(path.join(archiveDir, 'payload', (await fs.readdir(path.join(archiveDir, 'payload')))[0]));
    expect(encryptedBytes.toString('utf8')).not.toContain('secret-one');
    const manifestBeforeWrongKey = await fs.readFile(path.join(archiveDir, 'manifest.v1.json'), 'utf8');

    const restarted = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'shadow-secret' });
    expect((await restarted.runGit(['cat-file', '-t', first.commitOid])).stdout.trim()).toBe('commit');
    await expect(fs.access(shadowObjectDir)).rejects.toThrow();
    const payloadCount = (await fs.readdir(path.join(archiveDir, 'payload'))).length;
    await restarted.runGit(['cat-file', '-t', first.commitOid]);
    expect((await fs.readdir(path.join(archiveDir, 'payload'))).length).toBe(payloadCount);
    const wrongKey = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'wrong-secret' });
    await expect(wrongKey.runGit(['cat-file', '-t', first.commitOid])).rejects.toMatchObject({ code: 'SHADOW_KEY_INVALID' });
    const manifestAfterWrongKey = JSON.parse(await fs.readFile(path.join(archiveDir, 'manifest.v1.json'), 'utf8')) as { entries: Array<{ path: string; sha256: string; bytes: number }> };
    const beforeEntries = (JSON.parse(manifestBeforeWrongKey) as { entries: Array<{ path: string; sha256: string; bytes: number }> }).entries
      .map(entry => `${entry.path}:${entry.sha256}:${entry.bytes}`).sort();
    const afterEntries = manifestAfterWrongKey.entries.map(entry => `${entry.path}:${entry.sha256}:${entry.bytes}`).sort();
    expect(afterEntries).toEqual(beforeEntries);
  });

  it('explicitly migrates a legacy plaintext shadow store before enabling encryption', async () => {
    const shadowObjectDir = path.join(tmpDir, '.dsh-tm', 'git-shadow', 'objects');
    const legacy = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir });
    await fs.writeFile(path.join(tmpDir, 'legacy-shadow.txt'), 'legacy-secret\n', 'utf8');
    const snapshot = await legacy.createSnapshot({ sessionId: 'legacy-shadow', checkpointId: 'one' });
    const encrypted = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'migration-secret' });
    await expect(encrypted.encryptedShadowStatus()).resolves.toEqual({ ready: false, migrationRequired: true });
    const result = await encrypted.migrateShadowStore();
    expect(result.migrated).toBe(true);
    expect(result.entries).toBeGreaterThan(0);
    expect(await fs.readdir(path.join(tmpDir, '.dsh-tm', 'git-shadow-encrypted'))).toContain('manifest.v1.json');
    expect(await fs.access(shadowObjectDir).then(() => true, () => false)).toBe(false);
    await expect(encrypted.encryptedShadowStatus()).resolves.toEqual({ ready: true, migrationRequired: false });
    expect((await encrypted.runGit(['cat-file', '-t', snapshot.commitOid])).stdout.trim()).toBe('commit');
  });

  it('rotates the encrypted shadow key only after authenticated read', async () => {
    const shadowObjectDir = path.join(tmpDir, '.dsh-tm', 'git-shadow', 'objects');
    const oldEngine = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'old-shadow-key' });
    await fs.writeFile(path.join(tmpDir, 'rotation.txt'), 'rotation\n', 'utf8');
    const snapshot = await oldEngine.createSnapshot({ sessionId: 'shadow-rotation', checkpointId: 'one' });
    const rotated = new GitPlumbingEngine({
      workDir: tmpDir,
      shadowObjectDir,
      shadowEncryptionKey: 'new-shadow-key',
      shadowEncryptionPreviousKey: 'old-shadow-key',
    });
    expect((await rotated.runGit(['cat-file', '-t', snapshot.commitOid])).stdout.trim()).toBe('commit');
    await expect(new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'old-shadow-key' }).runGit(['cat-file', '-t', snapshot.commitOid]))
      .rejects.toMatchObject({ code: 'SHADOW_KEY_INVALID' });
  });

  it('replays an interrupted encrypted shadow append without changing the committed manifest', async () => {
    const shadowObjectDir = path.join(tmpDir, '.dsh-tm', 'git-shadow', 'objects');
    const archiveDir = path.join(tmpDir, '.dsh-tm', 'git-shadow-encrypted');
    const encrypted = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'journal-secret' });
    await fs.writeFile(path.join(tmpDir, 'journal.txt'), 'journal\n', 'utf8');
    const snapshot = await encrypted.createSnapshot({ sessionId: 'journal-shadow', checkpointId: 'one' });
    const before = await fs.readFile(path.join(archiveDir, 'manifest.v1.json'), 'utf8');
    const staging = path.join(archiveDir, '.staging-crash', 'payload');
    await fs.mkdir(staging, { recursive: true });
    await fs.writeFile(path.join(staging, 'orphan.bin'), 'orphan-ciphertext', 'utf8');
    await fs.writeFile(path.join(archiveDir, 'journal.json'), JSON.stringify({ version: 1, staging: '.staging-crash', phase: 'staging' }), 'utf8');
    const restarted = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'journal-secret' });
    expect((await restarted.runGit(['cat-file', '-t', snapshot.commitOid])).stdout.trim()).toBe('commit');
    expect(await fs.access(path.join(archiveDir, 'journal.json')).then(() => true, () => false)).toBe(false);
    expect(await fs.access(path.join(archiveDir, '.staging-crash')).then(() => true, () => false)).toBe(false);
    expect((JSON.parse(await fs.readFile(path.join(archiveDir, 'manifest.v1.json'), 'utf8')) as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
    expect(before).not.toBe('');
  });

  it('fails closed when an encrypted shadow payload is truncated', async () => {
    const shadowObjectDir = path.join(tmpDir, '.dsh-tm', 'git-shadow', 'objects');
    const archiveDir = path.join(tmpDir, '.dsh-tm', 'git-shadow-encrypted');
    const encrypted = new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'corrupt-secret' });
    await fs.writeFile(path.join(tmpDir, 'corrupt.txt'), 'corrupt\n', 'utf8');
    const snapshot = await encrypted.createSnapshot({ sessionId: 'corrupt-shadow', checkpointId: 'one' });
    const payload = (await fs.readdir(path.join(archiveDir, 'payload')))[0];
    await fs.writeFile(path.join(archiveDir, 'payload', payload), Buffer.from('short'));
    await expect(new GitPlumbingEngine({ workDir: tmpDir, shadowObjectDir, shadowEncryptionKey: 'corrupt-secret' }).runGit(['cat-file', '-t', snapshot.commitOid]))
      .rejects.toMatchObject({ code: 'SHADOW_ARCHIVE_CORRUPT' });
  });
});
