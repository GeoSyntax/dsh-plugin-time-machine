import path from 'node:path';
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
  restoreMode: Schema.union(['safe', 'force']).default('safe'),
  preservePaths: Schema.array(Schema.string()).default(['node_modules']),
  webHost: Schema.string().default('127.0.0.1'),
  maxSnapshots: Schema.number().default(0),
  maxStorageBytes: Schema.number().default(0),
  shadowStore: Schema.boolean().default(false),
  autoPrune: Schema.boolean().default(false),
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
}

interface SessionControllerLike {
  create(request: { readonly cwd?: string }): Promise<{ readonly sessionId: string }>;
  fork(request: { readonly sessionId: string; readonly atSeq?: number }): Promise<{ readonly sessionId: string }>;
}

interface CommandRuntimeLike {
  register(definition: unknown): () => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    timeMachine: TimeMachineService;
    agents: unknown;
    sessions: unknown;
    commands: CommandRuntimeLike;
    sessionController: SessionControllerLike;
  }

  interface Events {
    'agent/pre-step'(
      payload: { readonly agent: AgentLike; readonly turn: number; readonly step: number; readonly signal: AbortSignal },
      next: () => Promise<unknown>,
    ): Promise<unknown>;
    'session/event'(session: SessionLike, event: SessionEventLike): void;
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const workDir = path.resolve(process.cwd());
  const service = new TimeMachineService({ workDir, config });
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
  ctx.inject(['agents', 'sessions'], (scope: Context) => {
    scope.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      if (!service.config.autoSnapshot || step !== 1) return next();
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

    scope.on('session/event', (session, event) => {
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
      void service.finalizeTurnCheckpoint({
        sessionId: session.id,
        checkpointId,
        status: kind === 'completed' ? 'success' : kind === 'aborted' || kind === 'interrupted' ? 'aborted' : 'failed',
        errorMessage: typeof failure?.message === 'string' ? failure.message : kind === 'completed' ? undefined : `Turn ended: ${kind}`,
        failedTools: failedTools.length > 0 ? failedTools : undefined,
      }).catch((error: unknown) => {
        scope.logger.error(`[time-machine] could not finalize ${checkpointId}: ${errorMessage(error)}`);
      });
    });
  });

  ctx.logger.info(pc.green(`[${name}] active; restore mode=${service.config.restoreMode}`));
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
