import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
