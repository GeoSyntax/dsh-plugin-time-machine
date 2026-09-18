import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import TimeMachinePlugin, { TimeMachineService } from '../src/index.js';

describe('DSH Cordis plugin entry', () => {
  it('is constructable and provides the timeMachine service through Cordis 4.x', () => {
    const ctx = new Context();
    new TimeMachinePlugin(ctx, { autoSnapshot: false, enableWebUI: false });
    expect(ctx.get('timeMachine')).toBeInstanceOf(TimeMachineService);
  });
});
