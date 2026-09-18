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
        deriveMessages() { return []; },
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
      ctx.emit('session/event', session, { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } });
      const service = ctx.get('timeMachine') as TimeMachineService;
      expect(service.storageDir).toBe(path.join(workDir, '.dsh-tm'));
      let node = (await service.getDAGManager(session.id)).getCurrentNode();
      for (let attempt = 0; attempt < 100 && !node?.agentWrites?.length; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
        node = (await service.getDAGManager(session.id)).getCurrentNode();
      }
      expect(node?.agentWrites).toEqual([expect.objectContaining({ path: 'native.txt', operation: 'modify', sha256: expect.any(String) })]);
      expect(node?.status).toBe('success');
    } finally {
      await (ctx?.fiber?.dispose?.() ?? Promise.resolve());
      process.chdir(previousCwd);
      await fs.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
