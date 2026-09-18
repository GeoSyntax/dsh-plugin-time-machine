import { describe, expect, it } from 'vitest';
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
});
