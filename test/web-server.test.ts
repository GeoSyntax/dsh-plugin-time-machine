import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import { TimeMachineService } from '../src/service.js';
import { TimeMachineWebServer } from '../src/web/server.js';

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

    const rewind = await fetch(`http://localhost:${testPort}/api/rewind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'web-session', checkpointId: first.id }),
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
