import type { Context } from '@deepseek-ai/cordis';
import type { CheckpointNode } from '../types.js';
import type { TimeMachineService } from '../service.js';

interface CommandInvocationLike {
  readonly agent: { readonly session: { readonly id: string } };
  readonly rawInput: string;
}

interface SessionControllerLike {
  create(request: { readonly cwd?: string }): Promise<{ readonly sessionId: string }>;
  fork(request: { readonly sessionId: string; readonly atSeq?: number }): Promise<{ readonly sessionId: string }>;
}

type CommandResult = { kind: 'success' | 'error'; text: string };

/** Register real DSH human commands when the command service is present. */
export function registerCliCommands(ctx: Context, service: TimeMachineService): void {
  ctx.inject(['commands'], (scope: Context) => {
    scope.commands.register({
      name: 'tm-tree',
      description: 'Show the Time Machine checkpoint DAG',
      recordInput: false,
      handler: async ({ agent }: CommandInvocationLike): Promise<CommandResult> => ({
        kind: 'success',
        text: await service.renderTree(agent.session.id),
      }),
    });

    scope.commands.register({
      name: 'tm-rewind',
      description: 'Restore workspace and fork conversation at a checkpoint',
      input: { hint: '<checkpoint> [--force] [--delete-new-ignored]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const checkpointId = args.find(arg => !arg.startsWith('--'));
        if (!checkpointId) return { kind: 'error', text: 'Usage: /tm-rewind <checkpoint> [--force] [--delete-new-ignored]' };
        const controller = scope.get('sessionController') as SessionControllerLike | undefined;
        if (!controller) return { kind: 'error', text: 'This DSH profile has no sessionController; dual-track rewind is unavailable.' };

        const sessionId = agent.session.id;
        const result = await service.rewindToCheckpoint(sessionId, checkpointId, {
          mode: args.includes('--force') ? 'force' : undefined,
          deleteNewIgnoredPaths: args.includes('--delete-new-ignored'),
        });
        try {
          const created = await restartConversation(controller, sessionId, result.targetNode, service.workDir);
          return {
            kind: 'success',
            text: `Restored ${checkpointId}. Continue in forked session ${created.sessionId}. Rescue point: ${result.rescueCheckpointId ?? 'none'}.`,
          };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          throw error;
        }
      },
    });

    scope.commands.register({
      name: 'tm-preview',
      description: 'Preview workspace changes before a rewind or fork',
      input: { hint: '<checkpoint>' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const checkpointId = rawInput.trim().split(/\s+/).filter(Boolean)[0];
        if (!checkpointId) return { kind: 'error', text: 'Usage: /tm-preview <checkpoint>' };
        const preview = await service.previewRestore(agent.session.id, checkpointId);
        const drift = preview.requiresForce ? 'workspace drift detected; --force may be required' : 'workspace matches active checkpoint';
        const files = preview.diffs.length ? preview.diffs.map(item => `${item.status} ${item.file}`).join(', ') : 'no managed file changes';
        const ignored = preview.ignoredPathsToDelete.length ? ` Ignored paths to delete: ${preview.ignoredPathsToDelete.join(', ')}.` : '';
        return { kind: 'success', text: `Preview ${checkpointId}: ${drift}. Changes: ${files}.${ignored}` };
      },
    });

    scope.commands.register({
      name: 'tm-restore-files',
      description: 'Restore selected workspace paths from a checkpoint without changing conversation',
      input: { hint: '<checkpoint> <path...> [--force]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter(arg => !arg.startsWith('--'));
        if (positionals.length < 2) return { kind: 'error', text: 'Usage: /tm-restore-files <checkpoint> <path...> [--force]' };
        const result = await service.restoreSelectedPaths(agent.session.id, positionals[0], positionals.slice(1), {
          mode: args.includes('--force') ? 'force' : undefined,
        });
        return { kind: 'success', text: `Restored ${result.restoredPaths.join(', ')} from ${positionals[0]}. Conversation unchanged. Result checkpoint: ${result.resultCheckpointId ?? 'none'}.` };
      },
    });

    scope.commands.register({
      name: 'tm-fork',
      description: 'Create a named exploration branch from a checkpoint',
      input: { hint: '<checkpoint> <branch> [--force]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter(arg => !arg.startsWith('--'));
        if (positionals.length < 2) return { kind: 'error', text: 'Usage: /tm-fork <checkpoint> <branch> [--force]' };
        const controller = scope.get('sessionController') as SessionControllerLike | undefined;
        if (!controller) return { kind: 'error', text: 'This DSH profile has no sessionController; dual-track fork is unavailable.' };

        const sessionId = agent.session.id;
        const result = await service.forkNewBranch({
          sessionId,
          fromCheckpointId: positionals[0],
          newBranchName: positionals[1],
          restore: { mode: args.includes('--force') ? 'force' : undefined },
        });
        try {
          const created = await restartConversation(controller, sessionId, result.forkedNode, service.workDir);
          const reflection = result.reflectionAdvisory.hasPastFailures
            ? `\n\n${result.reflectionAdvisory.suggestedPromptPrefix}`
            : '';
          return { kind: 'success', text: `Forked ${positionals[1]} into DSH session ${created.sessionId}.${reflection}` };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          throw error;
        }
      },
    });
  });
}

async function restartConversation(
  controller: SessionControllerLike,
  sourceSessionId: string,
  checkpoint: CheckpointNode,
  cwd: string,
): Promise<{ sessionId: string }> {
  const boundary = checkpoint.sessionState.boundarySeq;
  return boundary === undefined
    ? controller.create({ cwd })
    : controller.fork({ sessionId: sourceSessionId, atSeq: boundary });
}

async function compensate(service: TimeMachineService, sessionId: string, rescueCheckpointId?: string): Promise<void> {
  if (!rescueCheckpointId) return;
  await service.rewindToCheckpoint(sessionId, rescueCheckpointId, {
    mode: 'force',
    createRescuePoint: false,
  });
}
