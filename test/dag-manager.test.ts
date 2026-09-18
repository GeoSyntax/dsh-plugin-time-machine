import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { DAGStateManager } from '../src/core/dag-manager.js';
import type { CheckpointNode } from '../src/types.js';

describe('DAGStateManager', () => {
  let tmpDir: string;
  let dag: DAGStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-dag-test-'));
    dag = new DAGStateManager({
      sessionId: 'sess_dag_test',
      storageDir: tmpDir,
    });
    await dag.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('should add nodes and advance branch head', async () => {
    const node1: CheckpointNode = {
      id: 'chk_1',
      parentId: null,
      branch: 'main',
      turnIndex: 1,
      timestamp: Date.now(),
      prompt: 'Setup express server',
      summary: 'Created server.ts',
      gitTreeOid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      gitCommitOid: '6b825dc642cb6eb9a060e54bf8d69288fbee4904',
      sessionState: { sessionId: 'sess_dag_test', messages: [] },
      changedFiles: [{ path: 'server.ts', status: 'added' }],
      status: 'success',
    };

    await dag.addNode(node1);

    expect(dag.tree.currentCheckpointId).toBe('chk_1');
    expect(dag.tree.branches.main.headId).toBe('chk_1');
  });

  it('should fork a parallel branch from historical checkpoint', async () => {
    const node1: CheckpointNode = {
      id: 'chk_1',
      parentId: null,
      branch: 'main',
      turnIndex: 1,
      timestamp: 1000,
      prompt: 'Init project',
      summary: 'init',
      gitTreeOid: 'tree1',
      gitCommitOid: 'commit1',
      sessionState: { sessionId: 'sess_dag_test', messages: [] },
      changedFiles: [],
      status: 'success',
    };

    const node2: CheckpointNode = {
      id: 'chk_2',
      parentId: 'chk_1',
      branch: 'main',
      turnIndex: 2,
      timestamp: 2000,
      prompt: 'Implement Redis Auth',
      summary: 'redis auth',
      gitTreeOid: 'tree2',
      gitCommitOid: 'commit2',
      sessionState: { sessionId: 'sess_dag_test', messages: [] },
      changedFiles: [],
      status: 'failed',
      errorMessage: 'Redis connection timed out',
    };

    await dag.addNode(node1);
    await dag.addNode(node2);

    // 从 chk_1 分叉出新探索分支
    await dag.forkBranch('chk_1', 'exp/jwt-auth', 'Alternative JWT auth');

    expect(dag.tree.currentBranch).toBe('exp/jwt-auth');
    expect(dag.tree.currentCheckpointId).toBe('chk_1');
    expect(dag.tree.branches['exp/jwt-auth'].forkedFromId).toBe('chk_1');

    // 验证废弃子树能够正确识别出在 node2 处的失败
    const abandoned = dag.getAbandonedSubtrees('chk_1', 'exp/jwt-auth');
    expect(abandoned.length).toBe(1);
    expect(abandoned[0].id).toBe('chk_2');
    expect(abandoned[0].errorMessage).toContain('Redis connection timed out');
  });
});
