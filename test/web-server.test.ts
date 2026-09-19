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
    const sessionsRes = await fetch(`http://localhost:${testPort}/api/sessions`);
    expect(sessionsRes.status).toBe(200);
    expect((await sessionsRes.json()).sessions).toEqual([]);
    const dagRes = await fetch(`http://localhost:${testPort}/api/dag?sessionId=default`);
    expect(dagRes.status).toBe(404);
    expect((await dagRes.json()).code).toBe('SESSION_NOT_FOUND');

    const capabilitiesRes = await fetch(`http://localhost:${testPort}/api/capabilities`);
    expect(capabilitiesRes.status).toBe(200);
    const capabilities = (await capabilitiesRes.json()).capabilities;
    expect(capabilities.version).toBe(1);
    expect(capabilities.fallback).toBe(true);
    expect(capabilities.mergeRestore).toBe(false);
    expect(capabilities.selectiveRestore).toBe(true);
    expect(capabilities.quarantineEncryption).toBe(false);
    expect(capabilities.quarantineMigration).toBe(false);
    expect(capabilities.externalEffectLedger).toBe(true);
    expect(capabilities.unattributedMutationInventory).toBe(true);
    expect(capabilities.externalEffectAdapters).toEqual([]);
    expect(capabilities.preCommandTools).toEqual(expect.arrayContaining(['write', 'edit', 'str_replace_editor', 'bash']));
    expect(capabilities.workspaceIsolation).toBe('shared-lock');
    expect(capabilities.rewindSessionMode).toBe('fork');
    expect(capabilities.incrementalCapture).toBe(false);
    expect(capabilities.handEditPolicy).toBe('reject-drift');
    expect(capabilities.shadowStoreEncryption).toBe(false);
    expect(capabilities.policies).toMatchObject({
      restoreMode: 'safe',
      maxSnapshots: 0,
      maxStorageBytes: 0,
      retentionMaxAgeMs: 0,
      maxSnapshotFileBytes: 0,
      maxSnapshotBytes: 0,
    });

    const migrationRes = await fetch(`http://localhost:${testPort}/api/quarantine-migrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(migrationRes.status).toBe(400);

    // 3. 测试静态网页托管
    const htmlRes = await fetch(`http://localhost:${testPort}/`);
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('DSH Time Machine');
    expect(htmlText).toContain('Coordinated Session Fork');
    expect(htmlText).toContain('session-selector');
    expect(htmlText).toContain('btn-undo-latest');

    const clientRes = await fetch(`http://localhost:${testPort}/app.js`);
    expect(clientRes.status).toBe(200);
    const clientText = await clientRes.text();
    expect(clientText).toContain('Agent Write Ledger');
    expect(clientText).toContain('/api/undo');

    const blocked = await fetch(`http://localhost:${testPort}/api/status`, {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(blocked.status).toBe(403);
    const fetchMetadataBlocked = await fetch(`http://localhost:${testPort}/api/status`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(fetchMetadataBlocked.status).toBe(403);
  });

  it('advertises an optional host-provided in-place rewind contract', async () => {
    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {
      rewindSessionMode: () => 'in-place',
    });
    await server.start();
    const response = await fetch(`http://localhost:${testPort}/api/capabilities`);
    expect(response.status).toBe(200);
    expect((await response.json()).capabilities.rewindSessionMode).toBe('in-place');
  });

  it('discovers and switches between real persisted sessions without a default ghost', async () => {
    const first = await service.createTurnCheckpoint({
      sessionId: 'web-session-alpha', turnIndex: 1, prompt: 'alpha', sessionState: { sessionId: 'web-session-alpha', messages: [] },
    });
    await service.createTurnCheckpoint({
      sessionId: 'web-session-beta', turnIndex: 1, prompt: 'beta', sessionState: { sessionId: 'web-session-beta', messages: [] },
    });
    const sessions = await fetch(`http://localhost:${testPort}/api/sessions`);
    expect((await sessions.json()).sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'web-session-alpha', checkpointCount: 1, currentCheckpointId: first.id }),
      expect.objectContaining({ sessionId: 'web-session-beta', checkpointCount: 1 }),
    ]));
    const dag = await fetch(`http://localhost:${testPort}/api/dag?sessionId=web-session-alpha`);
    expect((await dag.json()).sessionId).toBe('web-session-alpha');
    const unknown = await fetch(`http://localhost:${testPort}/api/dag?sessionId=does-not-exist`);
    expect(unknown.status).toBe(404);

    const unknownStorage = await fetch(`http://localhost:${testPort}/api/storage?sessionId=does-not-exist`);
    expect(unknownStorage.status).toBe(404);
    expect((await unknownStorage.json()).code).toBe('SESSION_NOT_FOUND');
  });

  it('resolves assistant message actions to finalized checkpoints', async () => {
    const sessionId = 'message-action-session';
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'message action', sessionState: { sessionId, messages: [] },
    });
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success', assistantMessageId: 'assistant-2', assistantMessageIds: ['assistant-1', 'assistant-2'] });
    const response = await fetch(`http://localhost:${testPort}/api/checkpoint-for-message?sessionId=${sessionId}&messageId=assistant-1`);
    expect(response.status).toBe(200);
    expect((await response.json()).checkpoint.id).toBe(checkpoint.id);
    const missing = await fetch(`http://localhost:${testPort}/api/checkpoint-for-message?sessionId=${sessionId}&messageId=missing`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('CHECKPOINT_NOT_FOUND');
  });

  it('filters plugin sessions through the host session authority when available', async () => {
    const live = 'host-live-session';
    const stale = 'host-stale-session';
    await service.createTurnCheckpoint({ sessionId: live, turnIndex: 1, prompt: 'live', sessionState: { sessionId: live, messages: [] } });
    await service.createTurnCheckpoint({ sessionId: stale, turnIndex: 1, prompt: 'stale', sessionState: { sessionId: stale, messages: [] } });
    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {
      sessionExists: async sessionId => sessionId === live,
    });
    await server.start();

    const sessions = await (await fetch(`http://localhost:${testPort}/api/sessions`)).json();
    expect(sessions.sessions.map((item: { sessionId: string }) => item.sessionId)).toEqual([live]);
    const staleDag = await fetch(`http://localhost:${testPort}/api/dag?sessionId=${stale}`);
    expect(staleDag.status).toBe(404);
    expect((await staleDag.json()).code).toBe('SESSION_NOT_FOUND');
  });

  it('exposes a read-only Agent-write ledger endpoint', async () => {
    (service.config as any).enableAgentWriteLedger = true;
    const checkpoint = await service.createTurnCheckpoint({
      sessionId: 'ledger-web-session', turnIndex: 1, prompt: 'ledger', sessionState: { sessionId: 'ledger-web-session', messages: [] },
    });
    await fs.writeFile(path.join(tmpDir, 'ledger.txt'), 'agent\n', 'utf8');
    await service.recordAgentWrite('ledger-web-session', checkpoint.id, { path: 'ledger.txt', operation: 'create' });
    const response = await fetch(`http://localhost:${testPort}/api/agent-writes?sessionId=ledger-web-session&checkpoint=${encodeURIComponent(checkpoint.id)}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessionId).toBe('ledger-web-session');
    expect(body.checkpointId).toBe(checkpoint.id);
    expect(body.enabled).toBe(true);
    expect(body.writes).toEqual([expect.objectContaining({ path: 'ledger.txt', operation: 'create', sha256: expect.any(String) })]);
  });

  it('exposes a read-only unattributed mutation endpoint', async () => {
    const sessionId = 'unattributed-web-session';
    await execAsync('git', ['init'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.name', 'WebTest'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.email', 'web@test.com'], { cwd: tmpDir });
    const checkpoint = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'base', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(path.join(tmpDir, 'shell.txt'), 'shell\n', 'utf8');
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });
    const response = await fetch(`http://localhost:${testPort}/api/unattributed-changes?sessionId=${sessionId}&checkpoint=${encodeURIComponent(checkpoint.id)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId, checkpointId: checkpoint.id, changes: [{ path: 'shell.txt', status: 'added' }] });
  });

  it('exposes external compensation as a dry-run first and an explicit idempotent action', async () => {
    const sessionId = 'web-effects';
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'remote effect',
      sessionState: { sessionId, messages: [] },
    });
    const updated = await service.recordExternalEffect(sessionId, checkpoint.id, {
      adapter: 'web-adapter', operation: 'create remote', reversible: true,
      failureSemantics: 'retryable', status: 'unresolved',
    });
    let calls = 0;
    service.registerExternalEffectAdapter({
      name: 'web-adapter',
      async compensate() { calls += 1; return { status: 'compensated' }; },
    });
    const effectId = updated.externalEffects![0]!.id;
    const dry = await fetch(`http://localhost:${testPort}/api/external-effects/compensate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, checkpointId: checkpoint.id, effectId }),
    });
    expect(dry.status).toBe(200);
    expect((await dry.json()).result.dryRun).toBe(true);
    expect(calls).toBe(0);
    const execute = await fetch(`http://localhost:${testPort}/api/external-effects/compensate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, checkpointId: checkpoint.id, effectId, execute: true, idempotencyKey: 'web-1' }),
    });
    expect(execute.status).toBe(200);
    expect((await execute.json()).result.effect.status).toBe('compensated');
    expect(calls).toBe(1);
  });

  it('records external effects through the Web API without invoking an adapter', async () => {
    const sessionId = 'web-record-effect';
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'record remote effect', sessionState: { sessionId, messages: [] },
    });
    let called = false;
    service.registerExternalEffectAdapter({ name: 'record-only', async compensate() { called = true; return { status: 'compensated' }; } });
    const response = await fetch(`http://localhost:${testPort}/api/external-effects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId, checkpointId: checkpoint.id, adapter: 'record-only', operation: 'create namespace',
        reversible: true, compensation: 'delete namespace', failureSemantics: 'retryable',
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.checkpoint.externalEffects).toEqual([expect.objectContaining({ adapter: 'record-only', status: 'unresolved' })]);
    expect(called).toBe(false);
  });

  it('rejects malformed external effect declarations before touching the DAG', async () => {
    const sessionId = 'web-invalid-effect';
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'invalid effect', sessionState: { sessionId, messages: [] },
    });
    const response = await fetch(`http://localhost:${testPort}/api/external-effects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, checkpointId: checkpoint.id, adapter: 'adapter', operation: 'op', reversible: true, failureSemantics: 'retryable', status: 'bogus' }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('status must be');
    expect((await service.getDAGManager(sessionId)).getNode(checkpoint.id)?.externalEffects ?? []).toHaveLength(0);
  });

  it('returns a conflict instead of a server error when explicit compensation lacks an adapter', async () => {
    const sessionId = 'web-missing-adapter';
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'missing adapter', sessionState: { sessionId, messages: [] },
    });
    const updated = await service.recordExternalEffect(sessionId, checkpoint.id, {
      adapter: 'not-loaded', operation: 'create remote', reversible: true,
      failureSemantics: 'unknown', status: 'unresolved',
    });
    const effectId = updated.externalEffects![0]!.id;
    const response = await fetch(`http://localhost:${testPort}/api/external-effects/compensate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, checkpointId: checkpoint.id, effectId, execute: true }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('EXTERNAL_ADAPTER_UNAVAILABLE');
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
    const forkPreview = await fetch(`http://localhost:${testPort}/api/preview?sessionId=web-session&checkpoint=${encodeURIComponent(first.id)}`);
    expect(forkPreview.status).toBe(200);
    const forkPreviewBody = await forkPreview.json();
    const fork = await fetch(`http://localhost:${testPort}/api/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'web-session',
        checkpointId: first.id,
        branchName: 'web-hotfix',
        description: 'web API branch',
        force: true,
        restorePlanId: forkPreviewBody.preview.restorePlanId,
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

  it('supports relative turn undo through the Web API without counting internal checkpoints', async () => {
    const sessionId = 'web-undo-session';
    const checkpoints = [] as Array<{ id: string }>;
    for (let turnIndex = 1; turnIndex <= 3; turnIndex += 1) {
      const checkpoint = await service.createTurnCheckpoint({ sessionId, turnIndex, prompt: `turn ${turnIndex}`, sessionState: { sessionId, messages: [] } });
      checkpoints.push(checkpoint);
      await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });
    }
    await service.createTurnCheckpoint({ sessionId, turnIndex: 3, prompt: '[pre-command]', sessionState: { sessionId, messages: [] }, tags: ['pre-command'] });

    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {
      restartConversation: async (_source, checkpoint) => ({ sessionId: `undo-${checkpoint.id}` }),
    });
    await server.start();
    const response = await fetch(`http://localhost:${testPort}/api/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, count: 2 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.targetCheckpointId).toBe(checkpoints[0].id);
    expect(body.conversation.sessionId).toBe(`undo-${checkpoints[0].id}`);
  });

  it('restores a full workspace without requiring conversation restart', async () => {
    const sessionId = 'restore-workspace-web';
    const file = path.join(tmpDir, 'restore-workspace.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const checkpoint = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'restore', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'after\n', 'utf8');
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });
    const response = await fetch(`http://localhost:${testPort}/api/restore-workspace`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, checkpointId: checkpoint.id }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('before\n');
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
    expect(capabilities.unattributedMutationInventory).toBe(true);
    expect(capabilities.workspaceIsolation).toBe('shared-lock');
    expect(capabilities.rewindSessionMode).toBe('fork');
    expect(capabilities.incrementalCapture).toBe(true);
    expect(capabilities.handEditPolicy).toBe('reject-drift');
    expect(capabilities.shadowStoreEncryption).toBe(false);
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

    const missingRewindTarget = await fetch(`http://localhost:${testPort}/api/rewind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'missing-target' }),
    });
    expect(missingRewindTarget.status).toBe(400);
    expect((await missingRewindTarget.json()).error).toContain('checkpointId is required');

    const missingForkTarget = await fetch(`http://localhost:${testPort}/api/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'missing-target' }),
    });
    expect(missingForkTarget.status).toBe(400);
    expect((await missingForkTarget.json()).error).toContain('checkpointId and branchName are required');

    const missingSessionPreview = await fetch(`http://localhost:${testPort}/api/preview?checkpoint=ghost`);
    expect(missingSessionPreview.status).toBe(400);
    expect((await missingSessionPreview.json()).code).toBe('BAD_REQUEST');

    const unknownSessionDiff = await fetch(`http://localhost:${testPort}/api/diff?sessionId=ghost&base=a&target=b`);
    expect(unknownSessionDiff.status).toBe(404);
    expect((await unknownSessionDiff.json()).code).toBe('SESSION_NOT_FOUND');

    const unknownSessionPrune = await fetch(`http://localhost:${testPort}/api/prune`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ghost', keepLatest: 1 }),
    });
    expect(unknownSessionPrune.status).toBe(404);
    expect((await unknownSessionPrune.json()).code).toBe('SESSION_NOT_FOUND');
  });

  it('allows only explicitly configured trusted cross-origin companions', async () => {
    await server.stop();
    server = new TimeMachineWebServer(service, testPort, '127.0.0.1', {}, ['http://127.0.0.1:4173/']);
    await server.start();
    const allowed = await fetch(`http://localhost:${testPort}/api/status`, {
      headers: { Origin: 'http://127.0.0.1:4173' },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4173');
    const rejected = await fetch(`http://localhost:${testPort}/api/status`, {
      headers: { Origin: 'http://127.0.0.1:4174' },
    });
    expect(rejected.status).toBe(403);
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
