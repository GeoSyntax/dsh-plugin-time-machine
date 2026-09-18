import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TimeMachineService } from '../src/service.js';
import { TimeMachineWebServer } from '../src/web/server.js';

const execAsync = promisify(execFile);

describe('TimeMachineWebServer', () => {
  let tmpDir: string;
  let service: TimeMachineService;
  let server: TimeMachineWebServer;
  const testPort = 3199;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-web-test-'));
    service = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.dsh-tm'),
    });
    server = new TimeMachineWebServer(service, testPort);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('should serve status endpoint and web client HTML', async () => {
    // 1. 测试 API 状态
    const statusRes = await fetch(`http://localhost:${testPort}/api/status`);
    expect(statusRes.status).toBe(200);
    const statusData = await statusRes.json();
    expect(statusData.status).toBe('online');
    expect(statusData.version).toBe('0.2.0');

    // 2. 测试 DAG 数据接口
    const dagRes = await fetch(`http://localhost:${testPort}/api/dag?sessionId=default`);
    expect(dagRes.status).toBe(200);
    const dagData = await dagRes.json();
    expect(dagData.currentBranch).toBe('main');

    const capabilitiesRes = await fetch(`http://localhost:${testPort}/api/capabilities`);
    expect(capabilitiesRes.status).toBe(200);
    const capabilities = (await capabilitiesRes.json()).capabilities;
    expect(capabilities.version).toBe(1);
    expect(capabilities.fallback).toBe(true);
    expect(capabilities.mergeRestore).toBe(false);
    expect(capabilities.selectiveRestore).toBe(true);
    expect(capabilities.quarantineEncryption).toBe(false);
    expect(capabilities.workspaceIsolation).toBe('shared-lock');
    expect(capabilities.policies).toMatchObject({
      restoreMode: 'safe',
      maxSnapshots: 0,
      maxStorageBytes: 0,
      retentionMaxAgeMs: 0,
      maxSnapshotFileBytes: 0,
      maxSnapshotBytes: 0,
    });

    // 3. 测试静态网页托管
    const htmlRes = await fetch(`http://localhost:${testPort}/`);
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('DSH Time Machine');
    expect(htmlText).toContain('Coordinated Session Fork');

    const blocked = await fetch(`http://localhost:${testPort}/api/status`, {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(blocked.status).toBe(403);
  });

  it('should rewind and fork through the API while returning a new conversation', async () => {
    const file = path.join(tmpDir, 'app.txt');
    await fs.writeFile(file, 'v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId: 'web-session',
      turnIndex: 1,
      prompt: 'initial',
      sessionState: { sessionId: 'web-session', messages: [] },
    });
    await fs.writeFile(file, 'v2\n', 'utf8');
    const second = await service.createTurnCheckpoint({
      sessionId: 'web-session',
      turnIndex: 2,
      prompt: 'change',
      sessionState: { sessionId: 'web-session', messages: [{ role: 'assistant', content: 'v2' }] },
    });

    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {
      restartConversation: async (_source, checkpoint) => ({ sessionId: `forked-${checkpoint.id}` }),
    });
    await server.start();

    const preview = await fetch(`http://localhost:${testPort}/api/preview?sessionId=web-session&checkpoint=${encodeURIComponent(first.id)}`);
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.restorePlanId).toMatch(/^plan_/);

    const rewind = await fetch(`http://localhost:${testPort}/api/rewind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'web-session', checkpointId: first.id, restorePlanId: previewBody.preview.restorePlanId }),
    });
    expect(rewind.status).toBe(200);
    expect((await rewind.json()).conversation.sessionId).toBe(`forked-${first.id}`);
    expect(await fs.readFile(file, 'utf8')).toBe('v1\n');

    await fs.writeFile(file, 'v3\n', 'utf8');
    const fork = await fetch(`http://localhost:${testPort}/api/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'web-session',
        checkpointId: first.id,
        branchName: 'web-hotfix',
        description: 'web API branch',
        force: true,
      }),
    });
    expect(fork.status).toBe(200);
    const forkBody = await fork.json();
    expect(forkBody.success).toBe(true);
    expect(forkBody.result.forkedNode.branch).toBe('web-hotfix');
    expect(forkBody.conversation.sessionId).toBe(`forked-${first.id}`);
    expect(await fs.readFile(file, 'utf8')).toBe('v1\n');
    expect(second.id).not.toBe(first.id);
  });

  it('supports explicit merge rewind through the Web API', async () => {
    await execAsync('git', ['init'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.name', 'TestBot'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.email', 'bot@test.com'], { cwd: tmpDir });
    const left = path.join(tmpDir, 'merge-left.txt');
    const right = path.join(tmpDir, 'merge-right.txt');
    await fs.writeFile(left, 'base-left\n', 'utf8');
    await fs.writeFile(right, 'base-right\n', 'utf8');
    const base = await service.createTurnCheckpoint({ sessionId: 'merge-web', turnIndex: 1, prompt: 'base', sessionState: { sessionId: 'merge-web', messages: [] } });
    await fs.writeFile(left, 'target-left\n', 'utf8');
    await service.createTurnCheckpoint({ sessionId: 'merge-web', turnIndex: 2, prompt: 'target', sessionState: { sessionId: 'merge-web', messages: [] } });
    await fs.writeFile(right, 'live-right\n', 'utf8');

    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {
      restartConversation: async () => ({ sessionId: 'merge-web-fork' }),
    });
    await server.start();
    const response = await fetch(`http://localhost:${testPort}/api/rewind`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'merge-web', checkpointId: base.id, merge: true }),
    });
    expect(response.status).toBe(200);
    expect(await fs.readFile(left, 'utf8')).toBe('base-left\n');
    expect(await fs.readFile(right, 'utf8')).toBe('live-right\n');
  });

  it('reports Git merge capability when the workspace is a normal repository', async () => {
    await execAsync('git', ['init'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.name', 'TestBot'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.email', 'bot@test.com'], { cwd: tmpDir });
    const response = await fetch(`http://localhost:${testPort}/api/capabilities`);
    expect(response.status).toBe(200);
    const capabilities = (await response.json()).capabilities;
    expect(capabilities.git).toBe(true);
    expect(capabilities.fallback).toBe(false);
    expect(capabilities.mergeRestore).toBe(true);
    expect(capabilities.workspaceIsolation).toBe('shared-lock');
  });

  it('exposes a read-only rewind preview endpoint', async () => {
    const file = path.join(tmpDir, 'preview.txt');
    await fs.writeFile(file, 'v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId: 'preview-web', turnIndex: 1, prompt: 'initial', sessionState: { sessionId: 'preview-web', messages: [] },
    });
    await fs.writeFile(file, 'v2\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId: 'preview-web', turnIndex: 2, prompt: 'change', sessionState: { sessionId: 'preview-web', messages: [] },
    });
    const response = await fetch(`http://localhost:${testPort}/api/preview?sessionId=preview-web&checkpoint=${encodeURIComponent(first.id)}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.checkpointId).toBe(first.id);
    expect(body.preview.diffs.some((diff: any) => diff.file === 'preview.txt')).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('v2\n');
  });

  it('restores only requested paths through the Web API', async () => {
    const left = path.join(tmpDir, 'left.txt');
    const right = path.join(tmpDir, 'right.txt');
    await fs.writeFile(left, 'left-v1\n', 'utf8');
    await fs.writeFile(right, 'right-v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId: 'selective-web', turnIndex: 1, prompt: 'initial', sessionState: { sessionId: 'selective-web', messages: [] },
    });
    await fs.writeFile(left, 'left-v2\n', 'utf8');
    await fs.writeFile(right, 'right-v2\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId: 'selective-web', turnIndex: 2, prompt: 'change', sessionState: { sessionId: 'selective-web', messages: [] },
    });
    const response = await fetch(`http://localhost:${testPort}/api/restore-files`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'selective-web', checkpointId: first.id, paths: ['left.txt'] }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.restoredPaths).toEqual(['left.txt']);
    expect(await fs.readFile(left, 'utf8')).toBe('left-v1\n');
    expect(await fs.readFile(right, 'utf8')).toBe('right-v2\n');
  });

  it('exposes storage status and explicit prune controls', async () => {
    await fs.writeFile(path.join(tmpDir, 'storage.txt'), 'one\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId: 'storage-web', turnIndex: 1, prompt: 'storage', sessionState: { sessionId: 'storage-web', messages: [] },
    });
    const status = await fetch(`http://localhost:${testPort}/api/storage?sessionId=storage-web`);
    expect(status.status).toBe(200);
    expect((await status.json()).status.checkpoints).toBe(1);
    const prune = await fetch(`http://localhost:${testPort}/api/prune`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'storage-web', keepLatest: 0 }),
    });
    expect(prune.status).toBe(200);
    expect((await prune.json()).result.removedCheckpointIds).toEqual([]);
  });

  it('accepts a positive olderThanMs prune filter over the web API', async () => {
    const sessionId = 'storage-age-web';
    const file = path.join(tmpDir, 'storage-age.txt');
    await fs.writeFile(file, 'one\n', 'utf8');
    const first = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'one', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'two\n', 'utf8');
    await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'two', sessionState: { sessionId, messages: [] } });
    await new Promise(resolve => setTimeout(resolve, 5));
    const response = await fetch(`http://localhost:${testPort}/api/prune`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, keepLatest: 0, olderThanMs: 1, compactHistory: true }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.removedCheckpointIds).toContain(first.id);
  });

  it('should compensate a physical rewind when conversation restart fails', async () => {
    const file = path.join(tmpDir, 'compensation.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId: 'compensation-session',
      turnIndex: 1,
      prompt: 'before',
      sessionState: { sessionId: 'compensation-session', messages: [] },
    });
    await fs.writeFile(file, 'after\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId: 'compensation-session',
      turnIndex: 2,
      prompt: 'after',
      sessionState: { sessionId: 'compensation-session', messages: [] },
    });

    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {
      restartConversation: async () => { throw new Error('simulated session fork failure'); },
    });
    await server.start();

    const response = await fetch(`http://localhost:${testPort}/api/rewind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'compensation-session', checkpointId: first.id }),
    });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('simulated session fork failure');
    expect(await fs.readFile(file, 'utf8')).toBe('after\n');

    const dag = await (await fetch(`http://localhost:${testPort}/api/dag?sessionId=compensation-session`)).json();
    const current = dag.nodes[dag.currentCheckpointId];
    expect(current.tags).toContain('rescue');
  });

  it('should compensate a physical fork when conversation restart fails', async () => {
    const file = path.join(tmpDir, 'fork-compensation.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId: 'fork-compensation-session',
      turnIndex: 1,
      prompt: 'before',
      sessionState: { sessionId: 'fork-compensation-session', messages: [] },
    });
    await fs.writeFile(file, 'after\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId: 'fork-compensation-session',
      turnIndex: 2,
      prompt: 'after',
      sessionState: { sessionId: 'fork-compensation-session', messages: [] },
    });

    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {
      restartConversation: async () => { throw new Error('simulated fork session failure'); },
    });
    await server.start();

    const response = await fetch(`http://localhost:${testPort}/api/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'fork-compensation-session',
        checkpointId: first.id,
        branchName: 'failed-web-hotfix',
      }),
    });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('simulated fork session failure');
    expect(await fs.readFile(file, 'utf8')).toBe('after\n');

    const dag = await (await fetch(`http://localhost:${testPort}/api/dag?sessionId=fork-compensation-session`)).json();
    const current = dag.nodes[dag.currentCheckpointId];
    expect(current.tags).toContain('rescue');
  });

  it('should reject hostile host headers, malformed JSON, and missing API capabilities', async () => {
    const hostile = await requestWithHost(testPort, 'attacker.example');
    expect(hostile).toBe(403);

    const malformed = await fetch(`http://localhost:${testPort}/api/rewind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toContain('Invalid JSON payload');
  });
});

function requestWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/status',
      headers: { host },
    }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}
