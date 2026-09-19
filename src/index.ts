import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import pc from 'picocolors';
import { TimeMachineService } from './service.js';
import { TimeMachineWebServer } from './web/server.js';
import { registerCliCommands } from './cli/commands.js';
import type { SessionMessage, TimeMachineConfig } from './types.js';

export { TimeMachineService } from './service.js';

export const name = 'dsh-plugin-time-machine';
export interface Config extends TimeMachineConfig {}
export const Config: Schema<Config> = Schema.object({
  autoSnapshot: Schema.boolean().default(true),
  enableReflectionAdvisor: Schema.boolean().default(true),
  refPrefix: Schema.string().default('refs/dsh-tm'),
  storageDir: Schema.string(),
  webPort: Schema.number().default(3088),
  enableWebUI: Schema.boolean().default(true),
  restoreMode: Schema.union(['safe', 'merge', 'force']).default('safe'),
  preservePaths: Schema.array(Schema.string()).default(['node_modules']),
  webHost: Schema.string().default('127.0.0.1'),
  maxSnapshots: Schema.number().default(0),
  maxStorageBytes: Schema.number().default(0),
  shadowStore: Schema.boolean().default(false),
  autoPrune: Schema.boolean().default(false),
  retentionMaxAgeMs: Schema.number().default(0),
  workspaceLockTimeoutMs: Schema.number().default(30000),
  maxQuarantineBytes: Schema.number().default(0),
  quarantineEncryptionKeyEnv: Schema.string().default(''),
  restorePlanTtlMs: Schema.number().default(900000),
  maxSnapshotFileBytes: Schema.number().default(0),
  maxSnapshotBytes: Schema.number().default(0),
  allowPartialSnapshots: Schema.boolean().default(false),
  enableAgentWriteLedger: Schema.boolean().default(false),
  autoPreCommandSnapshot: Schema.boolean().default(false),
  preCommandTools: Schema.array(Schema.string()).default(['bash', 'shell', 'pwsh', 'powershell', 'terminal_bash', 'terminal_exec', 'run_code', 'python']),
});

interface SessionEventLike {
  readonly type: string;
  readonly seq: number;
  readonly data: Record<string, unknown>;
}

interface SessionLike {
  readonly id: string;
  readonly header: { readonly cwd?: string };
  readonly events?: readonly SessionEventLike[];
  snapshotEvents?(): readonly SessionEventLike[];
  deriveMessages?(): readonly unknown[];
}

interface AgentLike {
  readonly session: SessionLike;
  readonly ctx?: Context;
}

interface SessionControllerLike {
  create(request: { readonly cwd?: string }): Promise<{ readonly sessionId: string }>;
  fork(request: { readonly sessionId: string; readonly atSeq?: number }): Promise<{ readonly sessionId: string }>;
}

interface CommandRuntimeLike {
  register(definition: unknown): () => void;
}

interface FsObservedTargetLike {
  readonly displayPath: string;
}

interface FsObservedLike {
  readonly kind: 'present' | 'absent';
}

interface ToolEventExecutionLike {
  readonly callId: string;
  readonly name: string;
  readonly agent?: { readonly session?: SessionLike };
}

interface ToolEventResultLike {
  readonly isError?: boolean;
}

interface ToolExecutionLike {
  readonly callId?: string;
  readonly name?: string;
  readonly arguments?: unknown;
  readonly agent?: { readonly session?: SessionLike };
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    timeMachine: TimeMachineService;
    agents: unknown;
    sessions: unknown;
    tools: unknown;
    commands: CommandRuntimeLike;
    sessionController: SessionControllerLike;
  }

  interface Events {
    'agent/pre-step'(
      payload: { readonly agent: AgentLike; readonly turn: number; readonly step: number; readonly signal: AbortSignal },
      next: () => Promise<unknown>,
    ): Promise<unknown>;
    'session/event'(session: SessionLike, event: SessionEventLike): void;
    'fs/observed'(target: FsObservedTargetLike, observation: FsObservedLike, actor: unknown): void;
    'tools/result'(execution: ToolEventExecutionLike, result: ToolEventResultLike): undefined;
    'tools/execute'(execution: ToolExecutionLike, next: () => Promise<unknown>): Promise<unknown>;
    'agent/created'(payload: { readonly agent: AgentLike }): undefined | Promise<undefined>;
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const workDir = path.resolve(process.cwd());
  const service = new TimeMachineService({ workDir, storageDir: config.storageDir, config });
  ctx.provide('timeMachine', service);

  registerCliCommands(ctx, service);

  if (config.enableWebUI !== false) {
    const webServer = new TimeMachineWebServer(service, config.webPort ?? 3088, config.webHost ?? '127.0.0.1', {
      restartConversation: async (sourceSessionId, checkpoint) => {
        const controller = ctx.get('sessionController') as SessionControllerLike | undefined;
        if (!controller) throw new Error('This DSH profile has no sessionController.');
        const boundary = checkpoint.sessionState.boundarySeq;
        return boundary === undefined
          ? controller.create({ cwd: service.workDir })
          : controller.fork({ sessionId: sourceSessionId, atSeq: boundary });
      },
    });
    ctx.effect(() => {
      void webServer.start().then((url) => {
        ctx.logger.info(`[time-machine] dashboard listening on ${url}`);
      }).catch((error: unknown) => {
        ctx.logger.warn(`[time-machine] dashboard unavailable: ${errorMessage(error)}`);
      });
      return () => webServer.stop();
    }, 'time-machine.web');
  }

  const checkpoints = new Map<string, string>();
  const observedWrites = new Map<string, { sessionId: string; turn: number; paths: Map<string, 'modify' | 'delete'> }>();
  const pendingLedgerWrites = new Map<string, Promise<void>>();

  // Hermes-style pre-destructive boundaries. DSH's tools/execute waterfall is
  // the last reliable seam before a shell/PTC tool mutates the workspace. We
  // keep this opt-in because every high-risk call intentionally creates a DAG
  // node and some profiles do not expose the waterfall.
  let installAgentToolBoundary: ((agent: AgentLike) => void) | undefined;
  if (service.config.autoPreCommandSnapshot) {
    const installedAgents = new WeakSet<object>();
    installAgentToolBoundary = (agent: AgentLike): void => {
      const agentContext = agent.ctx;
      if (!agentContext || installedAgents.has(agent)) return;
      installedAgents.add(agent);
      agentContext.on('tools/execute', async (execution, next) => {
        const session = execution.agent?.session;
        const toolName = execution.name;
        const turn = session ? currentSessionTurn(session) : undefined;
        const turnCheckpoint = session && Number.isSafeInteger(turn)
          ? checkpoints.get(checkpointKey(session.id, turn as number))
          : undefined;
        const configured = service.config.preCommandTools ?? [];
        if (!session || !toolName || !configured.includes(toolName) || !turnCheckpoint) return next();
        try {
          const boundary = await service.createTurnCheckpoint({
            sessionId: session.id,
            turnIndex: turn as number,
            prompt: `DSH pre-command boundary: ${toolName}`,
            summary: `Workspace immediately before high-risk tool ${toolName}`,
            sessionState: {
              sessionId: session.id,
              messages: getMessages(session),
              ...(getEvents(session).length > 0 ? { boundarySeq: getEvents(session).at(-1)?.seq } : {}),
            },
            status: 'success',
            tags: ['pre-command', `tool:${toolName}`],
          });
          ctx.logger.info(`[time-machine] captured pre-command checkpoint ${boundary.id} before ${toolName}`);
        } catch (error) {
          ctx.logger.warn(`[time-machine] pre-command checkpoint skipped for ${toolName}: ${errorMessage(error)}`);
        }
        return next();
      }, { prepend: true });
    };
    ctx.on('agent/created', ({ agent }) => { installAgentToolBoundary?.(agent); return undefined; });
  }

  // These are global lifecycle observations. Register them on the plugin root
  // (rather than an injected service scope) so native DSH events emitted by
  // agent-owned child scopes are still visible to the ledger.
  if (service.config.enableAgentWriteLedger) {
    ctx.on('fs/observed', (target, _observation, actor) => {
      const execution = actor as ToolEventExecutionLike | undefined;
      const session = execution?.agent?.session;
      const sessionId = session?.id;
      const turn = session ? currentSessionTurn(session) : undefined;
      if (!sessionId || !Number.isSafeInteger(turn) || !execution?.callId || !target?.displayPath) return;
      if (!isNativeWriteTool(execution.name)) return;
      const key = `${sessionId}\0${execution.callId}`;
      const existing = observedWrites.get(key) ?? { sessionId, turn: turn as number, paths: new Map<string, 'modify' | 'delete'>() };
      existing.paths.set(target.displayPath, _observation.kind === 'absent' ? 'delete' : 'modify');
      observedWrites.set(key, existing);
    });

    ctx.on('tools/result', (execution, result) => {
      const key = `${execution.agent?.session?.id ?? ''}\0${execution.callId}`;
      const observed = observedWrites.get(key);
      observedWrites.delete(key);
      if (!observed || result?.isError === true) return;
      const checkpointId = checkpoints.get(checkpointKey(observed.sessionId, observed.turn));
      if (!checkpointId) return;
      const turnKey = checkpointKey(observed.sessionId, observed.turn);
      let chain = pendingLedgerWrites.get(turnKey) ?? Promise.resolve();
      for (const [displayPath, operation] of observed.paths) {
        const relative = workspaceRelativePath(workDir, displayPath);
        if (!relative) continue;
        const sha256 = operation === 'delete'
          ? createHash('sha256').update(`dsh-time-machine:absent:${relative}`).digest('hex')
          : undefined;
        chain = chain.then(() => service.recordAgentWrite(observed.sessionId, checkpointId, { path: relative, operation, ...(sha256 ? { sha256 } : {}) })
          .then(() => undefined)
          .catch((error: unknown) => {
            ctx.logger.warn(`[time-machine] could not record Agent write ${relative}: ${errorMessage(error)}`);
          }));
      }
      pendingLedgerWrites.set(turnKey, chain);
    });
  }

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return;
    const turn = event.data.turn;
    if (!Number.isSafeInteger(turn)) return;
    const key = checkpointKey(session.id, turn as number);
    const checkpointId = checkpoints.get(key);
    if (!checkpointId) return;
    checkpoints.delete(key);
    const reason = asRecord(event.data.reason);
    const kind = typeof reason?.kind === 'string' ? reason.kind : 'error';
    const failure = asRecord(reason?.error);
    const failedTools = collectFailedTools(getEvents(session), turn as number);
    const ledgerWrites = pendingLedgerWrites.get(key) ?? Promise.resolve();
    pendingLedgerWrites.delete(key);
    void ledgerWrites.then(() => service.finalizeTurnCheckpoint({
      sessionId: session.id,
      checkpointId,
      status: kind === 'completed' ? 'success' : kind === 'aborted' || kind === 'interrupted' ? 'aborted' : 'failed',
      errorMessage: typeof failure?.message === 'string' ? failure.message : kind === 'completed' ? undefined : `Turn ended: ${kind}`,
      failedTools: failedTools.length > 0 ? failedTools : undefined,
    })).catch((error: unknown) => {
      ctx.logger.error(`[time-machine] could not finalize ${checkpointId}: ${errorMessage(error)}`);
    });
  });

  ctx.inject(['agents', 'sessions'], (scope: Context) => {
    scope.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      if (!service.config.autoSnapshot || step !== 1) return next();
      installAgentToolBoundary?.(agent);
      const session = agent.session;
      const cwd = session.header.cwd ? path.resolve(session.header.cwd) : workDir;
      if (cwd !== service.workDir) {
        scope.logger.warn(`[time-machine] skipped session ${session.id}: cwd ${cwd} differs from configured workspace ${service.workDir}`);
        return next();
      }

      const events = getEvents(session);
      const start = findLastEvent(events, event => event.type === 'turn/start' && event.data.turn === turn);
      if (!start) {
        scope.logger.warn(`[time-machine] skipped turn ${turn}: turn/start event is unavailable`);
        return next();
      }

      try {
        const checkpoint = await service.createTurnCheckpoint({
          sessionId: session.id,
          turnIndex: turn,
          prompt: `DSH turn ${turn} (pre-execution boundary)`,
          summary: `Workspace before DSH turn ${turn}`,
          sessionState: {
            sessionId: session.id,
            messages: getMessages(session),
            ...(start.seq > 0 ? { boundarySeq: start.seq - 1 } : {}),
          },
          status: 'running',
        });
        checkpoints.set(checkpointKey(session.id, turn), checkpoint.id);
      } catch (error) {
        scope.logger.error(`[time-machine] checkpoint for turn ${turn} failed: ${errorMessage(error)}`);
        throw error;
      }
      return next();
    }, { prepend: true });

  });

  ctx.logger.info(pc.green(`[${name}] active; restore mode=${service.config.restoreMode}`));
}

function isNativeWriteTool(name: string): boolean {
  return name === 'write' || name === 'edit' || name === 'str_replace_editor';
}

function workspaceRelativePath(workDir: string, displayPath: string): string | undefined {
  const absolute = path.resolve(workDir, displayPath);
  const root = path.resolve(workDir);
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return undefined;
  return relative;
}

function currentSessionTurn(session: SessionLike): number | undefined {
  const events = getEvents(session);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turn = events[index].data.turn;
    if (Number.isSafeInteger(turn)) return turn as number;
  }
  return undefined;
}

/** Extract model-visible tool failures from DSH's durable event pair. */
export function collectFailedTools(
  events: readonly SessionEventLike[],
  turn: number,
): Array<{ toolName: string; input: unknown; error: string }> {
  const calls = new Map<string, { name: string; input: unknown }>();
  const failures: Array<{ toolName: string; input: unknown; error: string }> = [];
  for (const event of events) {
    if (event.data.turn !== turn) continue;
    const data = event.data;
    if (event.type === 'tool/call') {
      const callId = typeof data.callId === 'string' ? data.callId : undefined;
      if (!callId) continue;
      calls.set(callId, { name: typeof data.name === 'string' ? data.name : 'unknown', input: parseToolArguments(data.arguments) });
      continue;
    }
    if (event.type !== 'tool/result') continue;
    const message = asRecord(data.message);
    const error = asRecord(data.error);
    const content = Array.isArray(message?.content) ? asRecord(message.content[0]) : undefined;
    const isError = data.isError === true || message?.isError === true || content?.isError === true || error !== undefined;
    if (!isError) continue;
    const source = asRecord(message?.source);
    const callId = typeof message?.callId === 'string'
      ? message.callId
      : typeof source?.callId === 'string'
      ? source.callId
      : typeof content?.callId === 'string'
      ? content.callId
      : undefined;
    const call = callId ? calls.get(callId) : undefined;
    const reason = typeof error?.reason === 'string'
      ? error.reason
      : typeof error?.code === 'string'
      ? error.code
      : 'Tool returned an error result';
    failures.push({ toolName: call?.name ?? 'unknown', input: call?.input ?? {}, error: reason });
  }
  return failures;
}

function getEvents(session: SessionLike): readonly SessionEventLike[] {
  return typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events ?? [];
}

function getMessages(session: SessionLike): SessionMessage[] {
  if (typeof session.deriveMessages !== 'function') return [];
  return session.deriveMessages().map(message => message as SessionMessage);
}

function findLastEvent(
  events: readonly SessionEventLike[],
  predicate: (event: SessionEventLike) => boolean,
): SessionEventLike | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
}

function checkpointKey(sessionId: string, turn: number): string {
  return `${sessionId}\0${turn}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try { return JSON.parse(value); } catch { return value; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cordis loads profile-bundle defaults as constructable plugins. */
export class TimeMachinePlugin {
  constructor(ctx: Context, config: Config = {}) {
    apply(ctx, config);
  }
}

export default TimeMachinePlugin;

export * from './types.js';
export * from './service.js';
export * from './core/git-plumbing.js';
export * from './core/fallback-engine.js';
export * from './core/dag-manager.js';
export * from './core/reflection-advisor.js';
