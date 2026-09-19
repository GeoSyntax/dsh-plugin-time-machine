import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { DAGStateKeyError, DAGStateManager } from '../src/core/dag-manager.js';
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
    const forked = await dag.forkBranch('chk_1', 'exp/jwt-auth', 'Alternative JWT auth');

    expect(dag.tree.currentBranch).toBe('exp/jwt-auth');
    expect(dag.tree.currentCheckpointId).toBe('chk_1');
    expect(dag.tree.branches['exp/jwt-auth'].forkedFromId).toBe('chk_1');
    expect(forked.branch).toBe('exp/jwt-auth');
    expect(dag.getNode('chk_1')?.branch).toBe('main');

    // 验证废弃子树能够正确识别出在 node2 处的失败
    const abandoned = dag.getAbandonedSubtrees('chk_1', 'exp/jwt-auth');
    expect(abandoned.length).toBe(1);
    expect(abandoned[0].id).toBe('chk_2');
    expect(abandoned[0].errorMessage).toContain('Redis connection timed out');
  });

  it('rejects a persisted DAG whose current checkpoint is missing', async () => {
    const sessionId = 'invalid-session';
    const file = path.join(tmpDir, `dag_${Buffer.from(sessionId).toString('base64url')}.json`);
    await fs.writeFile(file, JSON.stringify({
      sessionId,
      currentBranch: 'main',
      currentCheckpointId: 'missing',
      nodes: {},
      branches: { main: { name: 'main', headId: '', forkedFromId: null, createdAt: Date.now() } },
    }));
    const manager = new DAGStateManager({ sessionId, storageDir: tmpDir });
    await expect(manager.init()).rejects.toThrow('current checkpoint');
  });

  it('migrates a valid legacy DAG without a format version atomically', async () => {
    const sessionId = 'legacy-session';
    const file = path.join(tmpDir, `dag_${Buffer.from(sessionId).toString('base64url')}.json`);
    const legacy = {
      sessionId,
      currentBranch: 'main',
      currentCheckpointId: null,
      nodes: {},
      branches: { main: { name: 'main', headId: '', forkedFromId: null, createdAt: Date.now() } },
    };
    await fs.writeFile(file, JSON.stringify(legacy));
    const manager = new DAGStateManager({ sessionId, storageDir: tmpDir });
    await manager.init();
    expect(manager.tree.formatVersion).toBe(1);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).formatVersion).toBe(1);
  });

  it('rejects a future DAG format without rewriting it', async () => {
    const sessionId = 'future-session';
    const file = path.join(tmpDir, `dag_${Buffer.from(sessionId).toString('base64url')}.json`);
    const future = {
      formatVersion: 99,
      sessionId,
      currentBranch: 'main',
      currentCheckpointId: null,
      nodes: {},
      branches: { main: { name: 'main', headId: '', forkedFromId: null, createdAt: Date.now() } },
    };
    await fs.writeFile(file, JSON.stringify(future));
    const manager = new DAGStateManager({ sessionId, storageDir: tmpDir });
    await expect(manager.init()).rejects.toThrow('Unsupported DAG storage format 99');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).formatVersion).toBe(99);
  });

  it('encrypts DAG metadata, reloads with the key, and fails closed with a wrong key', async () => {
    const sessionId = 'encrypted-session';
    const encrypted = new DAGStateManager({ sessionId, storageDir: tmpDir, encryptionKey: 'operator-secret' });
    await encrypted.init();
    encrypted.tree.nodes.note = {
      id: 'note', parentId: null, branch: 'main', turnIndex: 1, timestamp: Date.now(),
      prompt: 'sensitive prompt should not be plaintext', summary: 'secret', gitTreeOid: 'tree',
      gitCommitOid: 'commit', sessionState: { sessionId, messages: [{ role: 'user', content: 'private' }] },
      changedFiles: [], status: 'success',
    };
    await encrypted.persist();
    const file = path.join(tmpDir, `dag_${Buffer.from(sessionId).toString('base64url')}.json`);
    const raw = await fs.readFile(file, 'utf8');
    expect(raw).toContain('dsh-time-machine-dag');
    expect(raw).not.toContain('sensitive prompt should not be plaintext');

    const reloaded = new DAGStateManager({ sessionId, storageDir: tmpDir, encryptionKey: 'operator-secret' });
    await reloaded.init();
    expect(reloaded.tree.nodes.note.prompt).toContain('sensitive prompt');
    const wrong = new DAGStateManager({ sessionId, storageDir: tmpDir, encryptionKey: 'wrong-secret' });
    await expect(wrong.init()).rejects.toBeInstanceOf(DAGStateKeyError);
    const missing = new DAGStateManager({ sessionId, storageDir: tmpDir });
    await expect(missing.init()).rejects.toMatchObject({ code: 'DAG_STATE_KEY_INVALID' });
  });
});
