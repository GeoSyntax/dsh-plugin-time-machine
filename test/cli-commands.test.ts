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

  it('registers tm-tree, tm-fork, and tm-rewind handlers', () => {
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(['tm-tree', 'tm-fork', 'tm-rewind']));
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
});
