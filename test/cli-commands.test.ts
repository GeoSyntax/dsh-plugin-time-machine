import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerCliCommands } from '../src/cli/commands.js';
import { TimeMachineService } from '../src/service.js';

const execAsync = promisify(execFile);

describe('registered DSH time-machine commands', () => {
  let root: string;
  let service: TimeMachineService;
  let handlers: Record<string, (invocation: any) => Promise<any>>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-cli-command-test-'));
    await execAsync('git', ['init'], { cwd: root });
    await execAsync('git', ['config', 'user.name', 'TestBot'], { cwd: root });
    await execAsync('git', ['config', 'user.email', 'bot@test.com'], { cwd: root });
    service = new TimeMachineService({ workDir: root, storageDir: path.join(root, '.dsh-tm') });
    handlers = {};

    const scope: any = {
      commands: {
        register(definition: any) {
          handlers[definition.name] = definition.handler;
        },
      },
      get(key: string) {
        if (key !== 'sessionController') throw new Error(`unexpected dependency ${key}`);
        return {
          create: async () => ({ sessionId: 'cli-created-session' }),
          fork: async () => ({ sessionId: 'cli-forked-session' }),
        };
      },
    };
    const ctx: any = { inject(_deps: string[], callback: (value: any) => void) { callback(scope); } };
    registerCliCommands(ctx, service);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('registers tm-tree, tm-doctor, tm-fork, tm-rewind, and tm-restore handlers', () => {
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(['tm-tree', 'tm-doctor', 'tm-fork', 'tm-rewind', 'tm-restore', 'tm-agent-writes', 'tm-unattributed', 'tm-quarantine-migrate', 'tm-external-record', 'tm-external-compensate']));
  });

  it('diagnoses dual-track readiness and actionable warnings', async () => {
    const result = await handlers['tm-doctor']({ agent: { session: { id: 'doctor-session' } }, rawInput: '' });
    expect(result.kind).toBe('success');
    expect(result.text).toContain('Conversation fork/rewind: available');
    expect(result.text).toContain('Pre-command checkpoints: disabled');
    expect(result.text).toContain('enable autoPreCommandSnapshot');
  });

  it('restores the full workspace without invoking the session controller', async () => {
    const sessionId = 'cli-restore-session';
    const file = path.join(root, 'restore.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const checkpoint = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'restore', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'after\n', 'utf8');
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });
    const result = await handlers['tm-restore']({ agent: { session: { id: sessionId } }, rawInput: checkpoint.id });
    expect(result.kind).toBe('success');
    expect(result.text).toContain('conversation unchanged');
    expect(await fs.readFile(file, 'utf8')).toBe('before\n');
  });

  it('exposes a read-only Agent-write ledger view', async () => {
    (service.config as any).enableAgentWriteLedger = true;
    const checkpoint = await service.createTurnCheckpoint({
      sessionId: 'ledger-cli-session', turnIndex: 1, prompt: 'ledger', sessionState: { sessionId: 'ledger-cli-session', messages: [] },
    });
    await fs.writeFile(path.join(root, 'ledger.txt'), 'agent\n', 'utf8');
    await service.recordAgentWrite('ledger-cli-session', checkpoint.id, { path: 'ledger.txt', operation: 'create' });
    const result = await handlers['tm-agent-writes']({
      agent: { session: { id: 'ledger-cli-session' } }, rawInput: checkpoint.id,
    });
    expect(result.kind).toBe('success');
    expect(result.text).toContain('Verified Agent writes');
    expect(result.text).toContain('create ledger.txt');
  });

  it('exposes a read-only unattributed mutation view', async () => {
    const sessionId = 'unattributed-cli-session';
    const file = path.join(root, 'shell.txt');
    const checkpoint = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'base', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'shell\n', 'utf8');
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });
    const result = await handlers['tm-unattributed']({ agent: { session: { id: sessionId } }, rawInput: checkpoint.id });
    expect(result).toEqual({ kind: 'success', text: `Unattributed workspace changes for ${checkpoint.id}:\nadded shell.txt` });
  });

  it('records external effects from the CLI without executing compensation', async () => {
    const sessionId = 'cli-external-record';
    const checkpoint = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'base', sessionState: { sessionId, messages: [] } });
    const result = await handlers['tm-external-record']({
      agent: { session: { id: sessionId } },
      rawInput: `${checkpoint.id} redis create-namespace --failure=retryable --reversible --compensation=delete-namespace`,
    });
    expect(result.kind).toBe('success');
    expect(result.text).toContain('no remote call was executed');
    expect((await service.getDAGManager(sessionId)).getNode(checkpoint.id)?.externalEffects).toEqual([
      expect.objectContaining({ adapter: 'redis', operation: 'create-namespace', reversible: true, status: 'unresolved' }),
    ]);
  });

  it('runs tm-tree and tm-fork through the real service and session controller contract', async () => {
    const sessionId = 'cli-session';
    const file = path.join(root, 'cli.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'cli boundary', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(file, 'after\n', 'utf8');
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });

    const tree = await handlers['tm-tree']({ agent: { session: { id: sessionId } }, rawInput: '' });
    expect(tree.kind).toBe('success');
    expect(tree.text).toContain('DSH Time Machine DAG Tree');

    const fork = await handlers['tm-fork']({
      agent: { session: { id: sessionId } }, rawInput: `${checkpoint.id} cli-alt`,
    });
    expect(fork.kind).toBe('success');
    expect(fork.text).toContain('cli-created-session');
    expect(await fs.readFile(file, 'utf8')).toBe('before\n');
  });

  it('runs tm-rewind and returns the new conversation identity', async () => {
    const sessionId = 'cli-rewind-session';
    const file = path.join(root, 'rewind.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'rewind boundary', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(file, 'after\n', 'utf8');
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });

    const result = await handlers['tm-rewind']({
      agent: { session: { id: sessionId } }, rawInput: checkpoint.id,
    });
    expect(result.kind).toBe('success');
    expect(result.text).toContain('cli-created-session');
    expect(await fs.readFile(file, 'utf8')).toBe('before\n');
  });

  it('shows conflicting paths in tm-preview output', async () => {
    const sessionId = 'cli-preview-session';
    const file = path.join(root, 'preview.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const checkpoint = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'preview boundary', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(file, 'after\n', 'utf8');
    await service.finalizeTurnCheckpoint({ sessionId, checkpointId: checkpoint.id, status: 'success' });
    await fs.writeFile(file, 'local drift\n', 'utf8');

    const result = await handlers['tm-preview']({
      agent: { session: { id: sessionId } }, rawInput: checkpoint.id,
    });
    expect(result.kind).toBe('success');
    expect(result.text).toContain('Conflicting paths: preview.txt');
  });

  it('parses explicit age pruning durations and rejects invalid values', async () => {
    const sessionId = 'cli-prune-session';
    await fs.writeFile(path.join(root, 'prune.txt'), 'one\n', 'utf8');
    await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'one', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(path.join(root, 'prune.txt'), 'two\n', 'utf8');
    await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'two', sessionState: { sessionId, messages: [] } });
    await new Promise(resolve => setTimeout(resolve, 5));

    const invalid = await handlers['tm-prune']({ agent: { session: { id: sessionId } }, rawInput: '--older-than=not-a-duration' });
    expect(invalid.kind).toBe('error');
    const valid = await handlers['tm-prune']({ agent: { session: { id: sessionId } }, rawInput: '0 --older-than=1ms --compact-history' });
    expect(valid.kind).toBe('success');
    expect(valid.text).toContain('Pruned');
  });
});
