/**
 * Small, dependency-free companion client for native DSH/Web integrations.
 * It deliberately knows the restore-plan fence, but does not render UI.
 */

import type { CheckpointNode, DAGTree, RestorePreview, SessionSummary } from './types.js';

export interface TimeMachineClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export class TimeMachineClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'TimeMachineClientError';
    this.status = status;
    this.body = body;
    this.code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
      ? body.code
      : body && typeof body === 'object' && 'error' in body && typeof body.error === 'object' && body.error && 'code' in body.error && typeof body.error.code === 'string'
        ? body.error.code
        : undefined;
  }
}

export interface RewindRequest {
  sessionId: string;
  checkpointId: string;
  restorePlanId?: string;
  merge?: boolean;
  force?: boolean;
  preserveVerifiedHandEdits?: boolean;
  deleteNewIgnoredPaths?: boolean;
}

export interface ForkRequest extends RewindRequest {
  branchName: string;
  description?: string;
}

export interface RestoreFilesRequest {
  sessionId: string;
  checkpointId: string;
  paths: string[];
  restorePlanId?: string;
  merge?: boolean;
  force?: boolean;
}

export type RestoreWorkspaceRequest = Omit<RewindRequest, 'checkpointId'> & { checkpointId: string };

export interface ExternalEffectRequest {
  sessionId: string;
  checkpointId: string;
  adapter: string;
  operation: string;
  reversible: boolean;
  failureSemantics: string;
  compensation?: string;
  status?: 'unresolved' | 'compensated' | 'unknown';
  id?: string;
}

export interface ExternalCompensationRequest {
  sessionId: string;
  checkpointId: string;
  effectId: string;
  execute?: boolean;
  idempotencyKey?: string;
}

export interface PreviewBoundAction {
  readonly sessionId: string;
  readonly checkpointId: string;
  readonly restorePlanId: string;
  readonly preview: RestorePreview;
}

/** UI-neutral timeline row for native DSH or standalone companion clients. */
export interface CompanionTimelineEntry {
  checkpoint: CheckpointNode;
  /** 0 is the current completed user turn; null means the node is not on the active lineage. */
  relativeUndo: number | null;
  isCurrent: boolean;
  /** Internal safety boundaries remain inspectable but should not be offered as user undo targets. */
  userVisible: boolean;
  canUndo: boolean;
  warnings: string[];
}

export class TimeMachineClient {
  private readonly baseUrl: string;
  private readonly http: typeof globalThis.fetch;

  constructor(options: TimeMachineClientOptions) {
    if (!options.baseUrl.trim()) throw new Error('TimeMachineClient requires a non-empty baseUrl.');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.http = options.fetch ?? globalThis.fetch;
    if (typeof this.http !== 'function') throw new Error('TimeMachineClient requires fetch in this runtime.');
  }

  async capabilities(): Promise<Record<string, unknown>> {
    return this.get('/api/capabilities').then((body) => objectField(body, 'capabilities'));
  }

  async status(): Promise<Record<string, unknown>> {
    return this.get('/api/status') as Promise<Record<string, unknown>>;
  }

  async storage(sessionId?: string): Promise<Record<string, unknown>> {
    return this.get(`/api/storage${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`) as Promise<Record<string, unknown>>;
  }

  async dag(sessionId: string): Promise<DAGTree> {
    return this.get(`/api/dag?sessionId=${encodeURIComponent(sessionId)}`) as Promise<DAGTree>;
  }

  async sessions(): Promise<SessionSummary[]> {
    const body = await this.get('/api/sessions');
    return objectField(body, 'sessions') as SessionSummary[];
  }

  /** Build a bounded, newest-first timeline without coupling consumers to React or DSH slots. */
  async timeline(sessionId: string, limit = 50): Promise<CompanionTimelineEntry[]> {
    if (!sessionId.trim()) throw new Error('timeline requires a non-empty sessionId.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('timeline limit must be an integer between 1 and 500.');
    return buildCompanionTimeline(await this.dag(sessionId), limit);
  }

  async preview(sessionId: string, checkpointId: string): Promise<PreviewBoundAction> {
    const body = await this.get(`/api/preview?sessionId=${encodeURIComponent(sessionId)}&checkpoint=${encodeURIComponent(checkpointId)}`);
    const preview = objectField(body, 'preview') as unknown as RestorePreview;
    if (preview.sessionId !== sessionId || preview.checkpointId !== checkpointId || typeof preview.restorePlanId !== 'string' || !preview.restorePlanId) {
      throw new Error('Time Machine returned an invalid restore preview binding.');
    }
    return { sessionId, checkpointId, restorePlanId: preview.restorePlanId, preview };
  }

  async rewind(action: PreviewBoundAction, options: Omit<RewindRequest, 'sessionId' | 'checkpointId' | 'restorePlanId'> = {}): Promise<unknown> {
    this.assertBinding(action);
    return this.post('/api/rewind', { ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, restorePlanId: action.restorePlanId });
  }

  async fork(action: PreviewBoundAction, branchName: string, options: Omit<ForkRequest, 'sessionId' | 'checkpointId' | 'restorePlanId' | 'branchName'> = {}): Promise<unknown> {
    this.assertBinding(action);
    if (!branchName.trim()) throw new Error('branchName must be non-empty.');
    return this.post('/api/fork', { ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, restorePlanId: action.restorePlanId, branchName });
  }

  async restoreFiles(request: RestoreFilesRequest): Promise<unknown> {
    if (!request.sessionId || !request.checkpointId || request.paths.length === 0) throw new Error('restoreFiles requires sessionId, checkpointId, and paths.');
    return this.post('/api/restore-files', request);
  }

  async restoreFilesFromPreview(action: PreviewBoundAction, paths: string[], options: Omit<RestoreFilesRequest, 'sessionId' | 'checkpointId' | 'paths' | 'restorePlanId'> = {}): Promise<unknown> {
    this.assertBinding(action);
    return this.restoreFiles({ ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, paths, restorePlanId: action.restorePlanId });
  }

  async restoreWorkspace(request: RestoreWorkspaceRequest): Promise<unknown> {
    if (!request.sessionId || !request.checkpointId) throw new Error('restoreWorkspace requires sessionId and checkpointId.');
    return this.post('/api/restore-workspace', request);
  }

  async restoreWorkspaceFromPreview(action: PreviewBoundAction, options: Omit<RestoreWorkspaceRequest, 'sessionId' | 'checkpointId' | 'restorePlanId'> = {}): Promise<unknown> {
    this.assertBinding(action);
    return this.restoreWorkspace({ ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, restorePlanId: action.restorePlanId });
  }

  async recordExternalEffect(request: ExternalEffectRequest): Promise<unknown> {
    if (!request.sessionId || !request.checkpointId || !request.adapter || !request.operation || !request.failureSemantics) {
      throw new Error('recordExternalEffect requires sessionId, checkpointId, adapter, operation, and failureSemantics.');
    }
    return this.post('/api/external-effects', request);
  }

  async compensateExternalEffect(request: ExternalCompensationRequest): Promise<unknown> {
    if (!request.sessionId || !request.checkpointId || !request.effectId) {
      throw new Error('compensateExternalEffect requires sessionId, checkpointId, and effectId.');
    }
    return this.post('/api/external-effects/compensate', request);
  }

  async diff(sessionId: string, baseCheckpointId: string, targetCheckpointId: string): Promise<unknown> {
    return this.get(`/api/diff?sessionId=${encodeURIComponent(sessionId)}&base=${encodeURIComponent(baseCheckpointId)}&target=${encodeURIComponent(targetCheckpointId)}`);
  }

  async agentWrites(sessionId: string, checkpointId: string): Promise<unknown> {
    return this.get(`/api/agent-writes?sessionId=${encodeURIComponent(sessionId)}&checkpoint=${encodeURIComponent(checkpointId)}`);
  }

  async unattributedChanges(sessionId: string, checkpointId: string): Promise<unknown> {
    return this.get(`/api/unattributed-changes?sessionId=${encodeURIComponent(sessionId)}&checkpoint=${encodeURIComponent(checkpointId)}`);
  }

  private assertBinding(action: PreviewBoundAction): void {
    if (!action || action.preview.sessionId !== action.sessionId || action.preview.checkpointId !== action.checkpointId || action.preview.restorePlanId !== action.restorePlanId) {
      throw new Error('Restore action is not bound to its preview session/checkpoint.');
    }
  }

  private async get(pathname: string): Promise<any> {
    return this.request(pathname, { method: 'GET' });
  }

  private async post(pathname: string, body: unknown): Promise<any> {
    return this.request(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  private async request(pathname: string, init: RequestInit): Promise<any> {
    const response = await this.http(`${this.baseUrl}${pathname}`, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new TimeMachineClientError(`Time Machine request failed (${response.status}).`, response.status, body);
    return body;
  }
}

function objectField(value: unknown, field: string): any {
  if (!value || typeof value !== 'object' || !(field in value)) throw new Error(`Time Machine response is missing '${field}'.`);
  return (value as Record<string, unknown>)[field];
}

export type { CheckpointNode, DAGTree, RestorePreview, SessionSummary };

/** Pure timeline projection shared by browser clients and tests. */
export function buildCompanionTimeline(dag: DAGTree, limit = 50): CompanionTimelineEntry[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('timeline limit must be an integer between 1 and 500.');
  const currentId = dag.currentCheckpointId;
  const lineage = currentId ? lineageFor(dag, currentId) : [];
  const relativeById = new Map<string, number>();
  const seenTurns = new Set<number>();
  let relativeUndo = 0;
  for (const node of [...lineage].reverse()) {
    if (!isUserVisible(node) || seenTurns.has(node.turnIndex)) continue;
    seenTurns.add(node.turnIndex);
    relativeById.set(node.id, relativeUndo);
    relativeUndo += 1;
  }
  return Object.values(dag.nodes)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit)
    .map((checkpoint) => {
      const userVisible = isUserVisible(checkpoint);
      const warnings: string[] = [];
      if (checkpoint.status === 'running') warnings.push('turn is still running');
      if (checkpoint.omittedPaths?.length) warnings.push(`${checkpoint.omittedPaths.length} path(s) omitted`);
      if (checkpoint.unattributedChanges?.length) warnings.push(`${checkpoint.unattributedChanges.length} unattributed change(s)`);
      if (checkpoint.externalEffects?.some(effect => effect.status !== 'compensated')) warnings.push('external effects require review');
      const relative = relativeById.get(checkpoint.id);
      return {
        checkpoint,
        relativeUndo: relative ?? null,
        isCurrent: checkpoint.id === currentId,
        userVisible,
        canUndo: userVisible && checkpoint.status !== 'running' && relative !== undefined && relative > 0,
        warnings,
      };
    });
}

function isUserVisible(node: CheckpointNode): boolean {
  return node.status !== 'running'
    && !node.tags?.includes('pre-command')
    && !node.tags?.includes('rescue')
    && !node.tags?.includes('selective-restore');
}

function lineageFor(dag: DAGTree, checkpointId: string): CheckpointNode[] {
  const result: CheckpointNode[] = [];
  let cursor: string | null = checkpointId;
  while (cursor) {
    const node: CheckpointNode | undefined = dag.nodes[cursor];
    if (!node) break;
    result.unshift(node);
    cursor = node.parentId;
  }
  return result;
}
