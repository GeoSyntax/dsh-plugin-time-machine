import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import TimeMachinePlugin, { collectFailedTools, TimeMachineService } from '../src/index.js';

describe('DSH Cordis plugin entry', () => {
  it('is constructable and provides the timeMachine service through Cordis 4.x', () => {
    const ctx = new Context();
    new TimeMachinePlugin(ctx, { autoSnapshot: false, enableWebUI: false });
    expect(ctx.get('timeMachine')).toBeInstanceOf(TimeMachineService);
  });

  it('extracts failed tool calls from DSH durable events for reflection', () => {
    const failures = collectFailedTools([
      { type: 'tool/call', seq: 1, data: { turn: 2, callId: 'call-1', name: 'shell', arguments: '{"cmd":"false"}' } },
      { type: 'tool/result', seq: 2, data: { turn: 2, isError: true, message: { role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', isError: true }] }, error: { name: 'ToolError', code: 'EXIT_NONZERO', reason: 'exit code 1' } } },
      { type: 'tool/call', seq: 3, data: { turn: 2, callId: 'call-2', name: 'read', arguments: '{}' } },
      { type: 'tool/result', seq: 4, data: { turn: 2, message: { role: 'user', source: { kind: 'tool', callId: 'call-2' }, content: [{ type: 'tool-result', isError: false }] } } },
    ], 2);
    expect(failures).toEqual([{ toolName: 'shell', input: { cmd: 'false' }, error: 'exit code 1' }]);
  });

  it('fails closed for sessions routed to a different workspace root', async () => {
    const previousCwd = process.cwd();
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-root-routing-'));
    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-other-root-'));
    let ctx: Context | undefined;
    let eventScope: Context | undefined;
    try {
      process.chdir(workDir);
      ctx = new Context();
      ctx.provide('agents', {} as never);
      ctx.provide('sessions', {} as never);
      new TimeMachinePlugin(ctx, { enableWebUI: false, storageDir: path.join(workDir, '.dsh-tm') });
      await ctx.inject(['agents', 'sessions'], (scope: Context) => { eventScope = scope; });
      const session = {
        id: 'other-root-session',
        header: { cwd: otherDir },
        events: [{ type: 'turn/start', seq: 1, data: { turn: 1 } }],
        snapshotEvents() { return this.events; },
        deriveMessages() { return []; },
      } as any;
      await eventScope!.waterfall('agent/pre-step', {
        agent: { session },
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      }, async () => undefined);
      const service = ctx.get('timeMachine') as TimeMachineService;
      expect((await service.getCapabilities()).workspaceRouting).toBe('single-root');
      expect(Object.keys((await service.getDAGManager(session.id)).tree.nodes)).toHaveLength(0);
    } finally {
      await (ctx?.fiber?.dispose?.() ?? Promise.resolve());
      process.chdir(previousCwd);
      await fs.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await fs.rm(otherDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('waits for native write ledger evidence before turn finalization', async () => {
    const previousCwd = process.cwd();
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-native-ledger-'));
    let ctx: Context | undefined;
    let eventScope: Context | undefined;
    try {
      process.chdir(workDir);
      ctx = new Context();
      ctx.provide('agents', {} as never);
      ctx.provide('sessions', {} as never);
      new TimeMachinePlugin(ctx, {
        enableWebUI: false,
        enableAgentWriteLedger: true,
        storageDir: path.join(workDir, '.dsh-tm'),
      });
      await ctx.inject(['agents', 'sessions'], (scope: Context) => { eventScope = scope; });
      expect(eventScope).toBeDefined();
      const session = {
        id: 'native-ledger-session',
        header: { cwd: workDir },
        events: [{ type: 'turn/start', seq: 1, data: { turn: 1 } }],
        snapshotEvents() { return this.events; },
        deriveMessages() { return [{ id: 'user-turn-1', role: 'user', content: 'make the change' }]; },
      } as any;
      const agent = { session };
      const file = path.join(workDir, 'native.txt');
      await fs.writeFile(file, 'agent content\n', 'utf8');

      await eventScope!.waterfall('agent/pre-step', {
        agent,
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      }, async () => undefined);
      const execution = { callId: 'native-call', name: 'write', agent };
      ctx.emit('fs/observed', { displayPath: file }, { kind: 'present' }, execution);
      ctx.emit('tools/result', execution, { isError: false });
      const deleteExecution = { callId: 'native-delete-call', name: 'edit', agent };
      ctx.emit('fs/observed', { displayPath: path.join(workDir, 'removed.txt') }, { kind: 'absent' }, deleteExecution);
      ctx.emit('tools/result', deleteExecution, { isError: false });
      ctx.emit('session/event', session, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } });
      const service = ctx.get('timeMachine') as TimeMachineService;
      expect(service.storageDir).toBe(path.join(workDir, '.dsh-tm'));
      let node = (await service.getDAGManager(session.id)).getCurrentNode();
      for (let attempt = 0; attempt < 100 && !node?.agentWrites?.length; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
        node = (await service.getDAGManager(session.id)).getCurrentNode();
      }
      expect(node?.agentWrites).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'native.txt', operation: 'modify', sha256: expect.any(String) }),
        expect.objectContaining({ path: 'removed.txt', operation: 'delete', sha256: expect.any(String) }),
      ]));
      expect(node?.status).toBe('success');
      expect(node?.userMessageId).toBe('user-turn-1');
    } finally {
      await (ctx?.fiber?.dispose?.() ?? Promise.resolve());
      process.chdir(previousCwd);
      await fs.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('captures an opt-in pre-command checkpoint before a high-risk DSH tool', async () => {
    const previousCwd = process.cwd();
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-pre-command-'));
    let ctx: Context | undefined;
    let eventScope: Context | undefined;
    try {
      process.chdir(workDir);
      ctx = new Context();
      ctx.provide('agents', {} as never);
      ctx.provide('sessions', {} as never);
      ctx.provide('tools', {} as never);
      new TimeMachinePlugin(ctx, {
        enableWebUI: false,
        autoPreCommandSnapshot: true,
        storageDir: path.join(workDir, '.dsh-tm'),
      });
      await ctx.inject(['agents', 'sessions'], (scope: Context) => { eventScope = scope; });
      const session = {
        id: 'pre-command-session',
        header: { cwd: workDir },
        events: [{ type: 'turn/start', seq: 1, data: { turn: 1 } }],
        snapshotEvents() { return this.events; },
        deriveMessages() { return []; },
      } as any;
      const agent = { session, ctx };
      ctx.emit('agent/created', { agent });
      await eventScope!.waterfall('agent/pre-step', {
        agent,
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      }, async () => undefined);
      const result = await ctx.waterfall('tools/pre-execute', {
        callId: 'high-risk-call',
        name: 'bash',
        arguments: { command: 'rm -rf build' },
        agent,
      }, async () => ({ kind: 'allow' }));
      expect(result).toEqual({ kind: 'allow' });
      await ctx.waterfall('tools/execute', {
        callId: 'high-risk-call',
        name: 'bash',
        arguments: { command: 'rm -rf build' },
        agent,
      }, async () => { await fs.writeFile(path.join(workDir, 'tool-created.txt'), 'created by bash\n', 'utf8'); return { isError: false }; });
      // The host may finalize the turn before a streamed tool/result callback arrives.
      ctx.emit('session/event', session, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } });
      ctx.emit('tools/result', { callId: 'high-risk-call', name: 'bash', agent }, { isError: false });
      const service = ctx.get('timeMachine') as TimeMachineService;
      let firstNode = Object.values((await service.getDAGManager(session.id)).tree.nodes).find(node => node.tags?.includes('pre-command'));
      for (let attempt = 0; attempt < 50 && !firstNode?.toolMutations?.length; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
        firstNode = Object.values((await service.getDAGManager(session.id)).tree.nodes).find(node => node.tags?.includes('pre-command'));
      }
      expect(firstNode?.toolMutations).toEqual(expect.arrayContaining([
        expect.objectContaining({ toolName: 'bash', status: 'success', changedFiles: expect.arrayContaining([{ path: 'tool-created.txt', status: 'added' }]) }),
      ]));
      await ctx.waterfall('tools/pre-execute', {
        callId: 'second-high-risk-call',
        name: 'bash',
        arguments: { command: 'rm -rf dist' },
        agent,
      }, async () => ({ kind: 'allow' }));
      expect(Object.values((await (ctx.get('timeMachine') as TimeMachineService).getDAGManager(session.id)).tree.nodes)).toHaveLength(2);
      const nodes = Object.values((await (ctx.get('timeMachine') as TimeMachineService).getDAGManager(session.id)).tree.nodes);
      expect(nodes).toHaveLength(2);
      expect(nodes[1]).toMatchObject({
        status: 'success',
        tags: ['pre-command', 'tool:bash'],
      });
      session.events.push({ type: 'turn/start', seq: 3, data: { turn: 2 } });
      await eventScope!.waterfall('agent/pre-step', {
        agent,
        turn: 2,
        step: 1,
        signal: new AbortController().signal,
      }, async () => undefined);
      await ctx.waterfall('tools/pre-execute', {
        callId: 'high-risk-call',
        name: 'bash',
        arguments: { command: 'rm -rf build' },
        agent,
      }, async () => ({ kind: 'allow' }));
      ctx.emit('tools/result', { callId: 'high-risk-call', name: 'bash', agent }, { isError: true, error: { code: 'EXIT_NONZERO', reason: 'exit code 1' } });
      let nextNodes = Object.values((await (ctx.get('timeMachine') as TimeMachineService).getDAGManager(session.id)).tree.nodes);
      for (let attempt = 0; attempt < 50 && !nextNodes.some(node => node.toolMutations?.some(item => item.status === 'error')); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
        nextNodes = Object.values((await (ctx.get('timeMachine') as TimeMachineService).getDAGManager(session.id)).tree.nodes);
      }
      expect(nextNodes).toHaveLength(4);
      expect(nextNodes.filter(node => node.tags?.includes('pre-command'))).toHaveLength(2);
      const failedBoundary = nextNodes.find(node => node.tags?.includes('pre-command') && node.turnIndex === 2);
      expect(failedBoundary?.toolMutations).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'error', error: 'code=EXIT_NONZERO; reason=exit code 1' }),
      ]));
    } finally {
      await (ctx?.fiber?.dispose?.() ?? Promise.resolve());
      process.chdir(previousCwd);
      await fs.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('deduplicates anonymous executions by object identity, not tool name', async () => {
    const previousCwd = process.cwd();
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-anonymous-command-'));
    let ctx: Context | undefined;
    let eventScope: Context | undefined;
    try {
      process.chdir(workDir);
      ctx = new Context();
      ctx.provide('agents', {} as never);
      ctx.provide('sessions', {} as never);
      ctx.provide('tools', {} as never);
      new TimeMachinePlugin(ctx, {
        enableWebUI: false,
        autoPreCommandSnapshot: true,
        preCommandMaxPerTurn: 0,
        storageDir: path.join(workDir, '.dsh-tm'),
      });
      await ctx.inject(['agents', 'sessions'], (scope: Context) => { eventScope = scope; });
      const session = {
        id: 'anonymous-command-session',
        header: { cwd: workDir },
        events: [{ type: 'turn/start', seq: 1, data: { turn: 1 } }],
        snapshotEvents() { return this.events; },
        deriveMessages() { return []; },
      } as any;
      const agent = { session, ctx };
      ctx.emit('agent/created', { agent });
      await eventScope!.waterfall('agent/pre-step', { agent, turn: 1, step: 1, signal: new AbortController().signal }, async () => undefined);
      const first = { name: 'bash', arguments: {}, agent };
      await ctx.waterfall('tools/pre-execute', first, async () => undefined);
      await ctx.waterfall('tools/execute', first, async () => undefined);
      const second = { name: 'bash', arguments: {}, agent };
      await ctx.waterfall('tools/pre-execute', second, async () => undefined);
      const nodes = Object.values((await (ctx.get('timeMachine') as TimeMachineService).getDAGManager(session.id)).tree.nodes);
      expect(nodes.filter(node => node.tags?.includes('pre-command'))).toHaveLength(2);
    } finally {
      await (ctx?.fiber?.dispose?.() ?? Promise.resolve());
      process.chdir(previousCwd);
      await fs.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
