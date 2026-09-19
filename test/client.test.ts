import { describe, expect, it } from 'vitest';
import { buildCompanionTimeline, TimeMachineClient, TimeMachineClientError } from '../src/client.js';

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

    const action = await client.preview('s', 'c', { preserveVerifiedHandEdits: true });
    await client.rewind(action, { merge: true });
    await client.undo({ sessionId: 's', count: 1 });
    await client.fork(action, 'experiment');
    await client.restoreFilesFromPreview(action, ['src/app.ts'], { force: true });
    await client.restoreWorkspaceFromPreview(action, { force: true });
    await client.recordExternalEffect({ sessionId: 's', checkpointId: 'c', adapter: 'redis', operation: 'create', reversible: true, failureSemantics: 'retryable' });
    await client.compensateExternalEffect({ sessionId: 's', checkpointId: 'c', effectId: 'effect-1', execute: true, idempotencyKey: 'idem-1' });
    await client.externalEffects('s', 'c', true);
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1', merge: true });
    expect(calls[0].url).toContain('preserveHandEdits=true');
    expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({ sessionId: 's', count: 1 });
    expect(JSON.parse(String(calls[3].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1', branchName: 'experiment' });
    expect(JSON.parse(String(calls[4].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1', paths: ['src/app.ts'], force: true });
    expect(JSON.parse(String(calls[5].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', restorePlanId: 'plan-1', force: true });
    expect(JSON.parse(String(calls[6].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', adapter: 'redis', operation: 'create', reversible: true });
    expect(JSON.parse(String(calls[7].init?.body))).toMatchObject({ sessionId: 's', checkpointId: 'c', effectId: 'effect-1', execute: true, idempotencyKey: 'idem-1' });
    expect(calls[8].url).toContain('/api/external-effects?sessionId=s&unresolved=true&checkpoint=c');
  });

  it('discovers persisted sessions for a native companion selector', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async () => new Response(JSON.stringify({ sessions: [{ sessionId: 's', checkpointCount: 2, currentBranch: 'main', currentCheckpointId: 'c', updatedAt: 1 }] }), { status: 200 }),
    });
    await expect(client.sessions()).resolves.toEqual([expect.objectContaining({ sessionId: 's', checkpointCount: 2 })]);
  });

  it('reads the canonical workspace route for a session', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async (url) => {
        expect(String(url)).toContain('/api/workspace-route?sessionId=s');
        return new Response(JSON.stringify({ route: { workspaceId: 'root', cwd: 'C:/repo', isolation: 'shared-lock' } }), { status: 200 });
      },
    });
    await expect(client.workspaceRoute('s')).resolves.toMatchObject({ route: { workspaceId: 'root', isolation: 'shared-lock' } });
  });

  it('exposes explicit shadow-store migration to companion clients', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async (url, init) => {
        expect(String(url)).toContain('/api/shadow-migrate');
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({ success: true, result: { migrated: true, entries: 2 } }), { status: 200 });
      },
    });
    await expect(client.migrateShadowStore()).resolves.toMatchObject({ result: { migrated: true, entries: 2 } });
  });

  it('validates and forwards prune dry-run requests for companions', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ success: true, result: { dryRun: true, wouldRemoveCheckpointIds: ['c-1'] } }), { status: 200 });
      },
    });
    await client.prune({ sessionId: 's', keepLatest: 0, compactHistory: true, dryRun: true });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ sessionId: 's', keepLatest: 0, compactHistory: true, dryRun: true });
    await expect(client.prune({ sessionId: 's', keepLatest: -1 })).rejects.toThrow('non-negative integer');
  });

  it('forwards read-only reflection queries for companions', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async (url) => {
        expect(String(url)).toContain('/api/reflection?sessionId=s&checkpoint=c');
        return new Response(JSON.stringify({ reflection: { hasPastFailures: true } }), { status: 200 });
      },
    });
    await expect(client.reflection('s', 'c')).resolves.toEqual({ reflection: { hasPastFailures: true } });
  });

  it('forwards read-only tool mutation queries for companions', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async (url) => {
        expect(String(url)).toContain('/api/tool-mutations?sessionId=s&checkpoint=c');
        return new Response(JSON.stringify({ mutations: [{ toolName: 'bash', status: 'error' }] }), { status: 200 });
      },
    });
    await expect(client.toolMutations('s', 'c')).resolves.toEqual({ mutations: [{ toolName: 'bash', status: 'error' }] });
  });

  it('resolves a finalized assistant message to its checkpoint', async () => {
    const client = new TimeMachineClient({
      baseUrl: 'http://127.0.0.1:3088',
      fetch: async (url) => {
        expect(String(url)).toContain('/api/checkpoint-for-message?sessionId=s&messageId=m-1');
        return new Response(JSON.stringify({ checkpoint: { id: 'c-1', turnIndex: 2 } }), { status: 200 });
      },
    });
    await expect(client.checkpointForMessage('s', 'm-1')).resolves.toMatchObject({ id: 'c-1', turnIndex: 2 });
  });

  it('projects a safe native-companion timeline across internal checkpoints', async () => {
    const node = (id: string, parentId: string | null, turnIndex: number, tags: string[] = [], status: string = 'success') => ({
      id, parentId, branch: 'main', turnIndex, timestamp: turnIndex, prompt: `turn ${turnIndex}`, summary: '',
      gitTreeOid: '', gitCommitOid: '', sessionState: { sessionId: 's', messages: [] }, changedFiles: [], status, tags,
    });
    const dag: any = {
      sessionId: 's', currentBranch: 'main', currentCheckpointId: 'pre', branches: { main: { name: 'main', headId: 'pre', forkedFromId: null, createdAt: 1 } },
      nodes: {
        one: node('one', null, 1),
        two: node('two', 'one', 2),
        pre: node('pre', 'two', 2, ['pre-command']),
        running: node('running', 'pre', 3, [], 'running'),
      },
    };
    dag.currentCheckpointId = 'pre';
    const rows = buildCompanionTimeline(dag);
    expect(rows.find(row => row.checkpoint.id === 'pre')?.userVisible).toBe(false);
    expect(rows.find(row => row.checkpoint.id === 'running')?.canUndo).toBe(false);
    expect(rows.find(row => row.checkpoint.id === 'two')?.relativeUndo).toBe(0);
    expect(rows.find(row => row.checkpoint.id === 'two')?.warnings).toEqual([]);
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
