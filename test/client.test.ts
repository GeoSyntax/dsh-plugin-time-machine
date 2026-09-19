import { describe, expect, it } from 'vitest';
import { TimeMachineClient, TimeMachineClientError } from '../src/client.js';

describe('TimeMachineClient companion contract', () => {
  it('binds preview tokens to rewind and fork requests', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088/',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        const body = String(url).includes('/api/preview')
          ? { preview: { sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1' } }
          : { success: true, conversation: { sessionId: 'new' } };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    const action = await client.preview('s', 'c');
    await client.rewind(action, { merge: true });
    await client.fork(action, 'experiment');
    await client.restoreFilesFromPreview(action, ['src/app.ts'], { force: true });
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1', merge: true });
    expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1', branchName: 'experiment' });
    expect(JSON.parse(String(calls[3].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1', paths: ['src/app.ts'], force: true });
  });

  it('discovers persisted sessions for a native companion selector', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async () => new Response(JSON.stringify({ sessions: [{ sessionId: 's', checkpointCount: 2, currentBranch: 'main', currentCheckpointId: 'c', updatedAt: 1 }] }), { status: 200 }),
    });
    await expect(client.sessions()).resolves.toEqual([expect.objectContaining({ sessionId: 's', checkpointCount: 2 })]);
  });

  it('rejects malformed preview bindings and exposes structured HTTP errors', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async (url) => new Response(JSON.stringify(String(url).includes('/preview')
        ? { preview: { sessionId: 'other', checkpointId: 'c', restorePlanId: 'plan' } }
        : { error: { code: 'WORKSPACE_DRIFT' } }), { status: String(url).includes('/preview') ? 200 : 409 }),
    });
    await expect(client.preview('s', 'c')).rejects.toThrow('invalid restore preview binding');
    await expect(client.rewind({ sessionId: 's', checkpointId: 'c', restorePlanId: 'p', preview: { sessionId: 's', checkpointId: 'c', restorePlanId: 'p' } as any })).rejects.toThrow();
    const errorClient = new TimeMachineClient({ baseUrl: 'http://127.0.0.1:3088', fetch: async () => new Response(JSON.stringify({ error: { code: 'WORKSPACE_DRIFT' } }), { status: 409 }) });
    await expect(errorClient.capabilities()).rejects.toMatchObject<Partial<TimeMachineClientError>>({ status: 409, code: 'WORKSPACE_DRIFT' });
  });
});
