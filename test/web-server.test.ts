import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
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
});
