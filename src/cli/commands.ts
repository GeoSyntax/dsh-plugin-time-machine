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
      name: 'tm-doctor',
      description: 'Diagnose Time Machine profile capabilities and recovery readiness',
      recordInput: false,
      handler: async ({ agent }: CommandInvocationLike): Promise<CommandResult> => {
        const sessionId = agent.session.id;
        const capabilities = await service.getCapabilities();
        const storage = await service.getStorageStatus(sessionId);
        let sessionController = false;
        try {
          sessionController = Boolean(scope.get('sessionController'));
        } catch {
          sessionController = false;
        }
        const lines = [
          `Session: ${sessionId}`,
          `Workspace engine: ${capabilities.git ? 'Git plumbing' : 'fallback snapshots'}`,
          `Conversation fork/rewind: ${sessionController ? 'available' : 'unavailable (no sessionController)'}`,
          `Web dashboard: ${service.config.enableWebUI === false ? 'disabled' : `available on ${service.config.webHost ?? '127.0.0.1'}:${service.config.webPort ?? 3088}`}`,
          `Pre-command checkpoints: ${service.config.autoPreCommandSnapshot ? 'enabled' : 'disabled'}`,
          `Agent-write ledger: ${service.config.enableAgentWriteLedger ? 'enabled' : 'disabled'}`,
          `Storage: ${formatBytes(storage.bytes)} in ${storage.files} files; ${storage.checkpoints} checkpoints`,
        ];
        const warnings: string[] = [];
        if (!capabilities.git) warnings.push('Git is unavailable; restores use fallback snapshots and textual diffs only.');
        if (!sessionController) warnings.push('Workspace restore can run, but the conversation cannot be switched automatically.');
        if (!service.config.autoPreCommandSnapshot) warnings.push('High-risk tool boundaries are not captured; enable autoPreCommandSnapshot for stronger crash recovery.');
        if (warnings.length > 0) lines.push(`Warnings:\n- ${warnings.join('\n- ')}`);
        else lines.push('Status: ready for dual-track checkpoint, rewind, and fork workflows.');
        return { kind: 'success', text: lines.join('\n') };
      },
    });

    scope.commands.register({
      name: 'tm-storage',
      description: 'Show Time Machine snapshot storage usage',
      recordInput: false,
      handler: async ({ agent }: CommandInvocationLike): Promise<CommandResult> => {
        const status = await service.getStorageStatus(agent.session.id);
        return { kind: 'success', text: `Time Machine storage: ${formatBytes(status.bytes)} in ${status.files} files; ${status.checkpoints} checkpoints; ${status.pruneCandidates} safe leaf candidate(s).` };
      },
    });

    scope.commands.register({
      name: 'tm-agent-writes',
      description: 'Show verified Agent writes recorded for a checkpoint',
      input: { hint: '<checkpoint>' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const checkpointId = rawInput.trim().split(/\s+/).filter(Boolean)[0];
        if (!checkpointId) return { kind: 'error', text: 'Usage: /tm-agent-writes <checkpoint>' };
        if (!service.config.enableAgentWriteLedger) return { kind: 'error', text: 'Agent-write ledger is disabled; set enableAgentWriteLedger: true.' };
        const writes = await service.getAgentWriteLedger(agent.session.id, checkpointId);
        if (writes.length === 0) return { kind: 'success', text: `No verified Agent writes recorded for ${checkpointId}.` };
        const lines = writes.map(item => `${item.operation ?? 'modify'} ${item.path} sha256=${item.sha256} (${new Date(item.recordedAt).toISOString()})`);
        return { kind: 'success', text: `Verified Agent writes for ${checkpointId}:\n${lines.join('\n')}` };
      },
    });

    scope.commands.register({
      name: 'tm-unattributed',
      description: 'Show workspace changes without Agent-write evidence',
      input: { hint: '<checkpoint>' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const checkpointId = rawInput.trim().split(/\s+/).filter(Boolean)[0];
        if (!checkpointId) return { kind: 'error', text: 'Usage: /tm-unattributed <checkpoint>' };
        const changes = await service.getUnattributedChanges(agent.session.id, checkpointId);
        if (changes.length === 0) return { kind: 'success', text: `No unattributed workspace changes for ${checkpointId}.` };
        return { kind: 'success', text: `Unattributed workspace changes for ${checkpointId}:\n${changes.map(item => `${item.status} ${item.path}`).join('\n')}` };
      },
    });

    scope.commands.register({
      name: 'tm-prune',
      description: 'Prune old non-head Time Machine checkpoints',
      input: { hint: '[keep-latest] [--older-than=<duration>] [--abandoned-branches] [--compact-history] [--repack-shadow]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const keepArg = args.find(arg => !arg.startsWith('--'));
        const keepLatest = keepArg ? Number(keepArg) : 20;
        if (!Number.isInteger(keepLatest) || keepLatest < 0) return { kind: 'error', text: 'Usage: /tm-prune [non-negative keep-latest]' };
        const olderThanRaw = optionValue(args, '--older-than');
        const olderThanMs = olderThanRaw === undefined ? undefined : parseDurationMs(olderThanRaw);
        if (olderThanRaw !== undefined && olderThanMs === undefined) return { kind: 'error', text: 'Usage: /tm-prune [--older-than=<7d|12h|30m|45s>]' };
        const result = await service.prune(agent.session.id, {
          keepLatest,
          olderThanMs,
          abandonedBranches: args.includes('--abandoned-branches'),
          compactHistory: args.includes('--compact-history'),
          repackShadowObjects: args.includes('--repack-shadow'),
        });
        const quarantine = result.quarantineReclaimedBytes ? ` Quarantine reclaimed ${formatBytes(result.quarantineReclaimedBytes)}.` : '';
        const shadow = result.shadowObjectsReclaimedBytes ? ` Shadow packs reclaimed ${formatBytes(result.shadowObjectsReclaimedBytes)}.` : '';
        const warning = result.shadowRepackSkippedReason ? ` Shadow repack skipped: ${result.shadowRepackSkippedReason}.` : '';
        return { kind: 'success', text: `Pruned ${result.removedCheckpointIds.length} checkpoint(s), reclaimed ${formatBytes(result.reclaimedBytes)}.${quarantine}${shadow}${warning} ${result.note}` };
      },
    });

    scope.commands.register({
      name: 'tm-quarantine-migrate',
      description: 'Encrypt one legacy plaintext ignored-file quarantine backup',
      input: { hint: '<backup-key>' },
      handler: async ({ rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const key = rawInput.trim();
        if (!key || /\s/.test(key)) return { kind: 'error', text: 'Usage: /tm-quarantine-migrate <backup-key>' };
        const result = await service.migrateIgnoredBackup(key);
        return {
          kind: 'success',
          text: result.migrated
            ? `Encrypted quarantine backup ${key}: ${result.entryCount} ${result.entryCount === 1 ? 'entry' : 'entries'} rewritten (${formatBytes(result.bytesRewritten)}).`
            : `Quarantine backup ${key} is already encrypted or empty.`,
        };
      },
    });

    scope.commands.register({
      name: 'tm-external-compensate',
      description: 'Preview or explicitly execute an external-effect compensation',
      input: { hint: '<checkpoint> <effect-id> [--execute] [--key=<idempotency-key>]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter(arg => !arg.startsWith('--'));
        if (positionals.length < 2) return { kind: 'error', text: 'Usage: /tm-external-compensate <checkpoint> <effect-id> [--execute] [--key=<idempotency-key>]' };
        const result = await service.compensateExternalEffect(agent.session.id, positionals[0], positionals[1], {
          execute: args.includes('--execute'),
          idempotencyKey: optionValue(args, '--key'),
        });
        return {
          kind: 'success',
          text: result.dryRun
            ? `Dry run: adapter '${result.adapter}' is available for effect ${positionals[1]}; no external mutation was executed. Use --execute with key ${result.idempotencyKey}.`
            : `${result.replayed ? 'Replayed' : 'Executed'} compensation for ${positionals[1]} via '${result.adapter}' with key ${result.idempotencyKey}; status=${result.effect.status}.`,
        };
      },
    });

    scope.commands.register({
      name: 'tm-external-record',
      description: 'Record an external side effect without executing compensation',
      input: { hint: '<checkpoint> <adapter> <operation> [--reversible] [--failure=<text>] [--compensation=<text>]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter(arg => !arg.startsWith('--'));
        if (positionals.length < 3) return { kind: 'error', text: 'Usage: /tm-external-record <checkpoint> <adapter> <operation> [--reversible] [--failure=<text>] [--compensation=<text>]' };
        const failureSemantics = optionValue(args, '--failure');
        if (!failureSemantics) return { kind: 'error', text: 'Usage requires --failure=<text>.' };
        const updated = await service.recordExternalEffect(agent.session.id, positionals[0], {
          adapter: positionals[1], operation: positionals[2], reversible: args.includes('--reversible'),
          compensation: optionValue(args, '--compensation'), failureSemantics, status: 'unresolved',
        });
        const effect = updated.externalEffects?.at(-1);
        return { kind: 'success', text: `Recorded external effect ${effect?.id ?? '(unknown)'} via '${positionals[1]}'; no remote call was executed.` };
      },
    });

    scope.commands.register({
      name: 'tm-rewind',
      description: 'Restore workspace and fork conversation at a checkpoint',
      input: { hint: '<checkpoint> [--merge|--force] [--preserve-hand-edits] [--delete-new-ignored] [--plan=<id>]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const checkpointId = args.find(arg => !arg.startsWith('--'));
        if (!checkpointId) return { kind: 'error', text: 'Usage: /tm-rewind <checkpoint> [--merge|--force] [--delete-new-ignored]' };
        const controller = scope.get('sessionController') as SessionControllerLike | undefined;
        if (!controller) return { kind: 'error', text: 'This DSH profile has no sessionController; dual-track rewind is unavailable.' };

        const sessionId = agent.session.id;
        const result = await service.rewindToCheckpoint(sessionId, checkpointId, {
          mode: args.includes('--force') ? 'force' : args.includes('--merge') ? 'merge' : undefined,
          preserveVerifiedHandEdits: args.includes('--preserve-hand-edits'),
          deleteNewIgnoredPaths: args.includes('--delete-new-ignored'),
          restorePlanId: optionValue(args, '--plan'),
        });
        try {
          const created = await restartConversation(controller, sessionId, result.targetNode, service.workDir);
          await service.completeRestoreJournal(result.restoreJournalId);
          return {
            kind: 'success',
            text: `Restored ${checkpointId}. Continue in forked session ${created.sessionId}. Rescue point: ${result.rescueCheckpointId ?? 'none'}.${result.preservedHandEditPaths?.length ? ` Preserved hand-edited paths: ${result.preservedHandEditPaths.join(', ')}.` : ''}`,
          };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          await service.completeRestoreJournal(result.restoreJournalId);
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
        const omitted = preview.targetOmittedPaths?.length
          ? ` INCOMPLETE checkpoint: omitted paths preserved live: ${preview.targetOmittedPaths.join(', ')}.`
          : '';
        const conflicts = preview.conflictingPaths.length ? ` Conflicting paths: ${preview.conflictingPaths.join(', ')}.` : '';
        const plan = ` Restore plan: ${preview.restorePlanId}${preview.restorePlanExpiresAt ? ` (expires ${new Date(preview.restorePlanExpiresAt).toISOString()})` : ' (no expiry)'}.`;
        return { kind: 'success', text: `Preview ${checkpointId}: ${drift}. Changes: ${files}.${ignored}${omitted}${conflicts}${plan}` };
      },
    });

    scope.commands.register({
      name: 'tm-restore-files',
      description: 'Restore selected workspace paths from a checkpoint without changing conversation',
      input: { hint: '<checkpoint> <path...> [--force] [--plan=<id>]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter(arg => !arg.startsWith('--'));
        if (positionals.length < 2) return { kind: 'error', text: 'Usage: /tm-restore-files <checkpoint> <path...> [--force]' };
        const result = await service.restoreSelectedPaths(agent.session.id, positionals[0], positionals.slice(1), {
          mode: args.includes('--force') ? 'force' : undefined,
          restorePlanId: optionValue(args, '--plan'),
        });
        return { kind: 'success', text: `Restored ${result.restoredPaths.join(', ')} from ${positionals[0]}. Conversation unchanged. Result checkpoint: ${result.resultCheckpointId ?? 'none'}.` };
      },
    });

    scope.commands.register({
      name: 'tm-fork',
      description: 'Create a named exploration branch from a checkpoint',
      input: { hint: '<checkpoint> <branch> [--merge|--force]' },
      handler: async ({ agent, rawInput }: CommandInvocationLike): Promise<CommandResult> => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter(arg => !arg.startsWith('--'));
        if (positionals.length < 2) return { kind: 'error', text: 'Usage: /tm-fork <checkpoint> <branch> [--merge|--force]' };
        const controller = scope.get('sessionController') as SessionControllerLike | undefined;
        if (!controller) return { kind: 'error', text: 'This DSH profile has no sessionController; dual-track fork is unavailable.' };

        const sessionId = agent.session.id;
        const result = await service.forkNewBranch({
          sessionId,
          fromCheckpointId: positionals[0],
          newBranchName: positionals[1],
          restore: { mode: args.includes('--force') ? 'force' : args.includes('--merge') ? 'merge' : undefined },
        });
        try {
          const created = await restartConversation(controller, sessionId, result.forkedNode, service.workDir);
          await service.completeRestoreJournal(result.restoreJournalId);
          const reflection = result.reflectionAdvisory.hasPastFailures
            ? `\n\n${result.reflectionAdvisory.suggestedPromptPrefix}`
            : '';
          return { kind: 'success', text: `Forked ${positionals[1]} into DSH session ${created.sessionId}.${reflection}` };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          await service.completeRestoreJournal(result.restoreJournalId);
          throw error;
        }
      },
    });
  });
}

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) || undefined : undefined;
}

function parseDurationMs(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const factor: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const result = amount * factor[match[2].toLowerCase()];
  return Number.isSafeInteger(Math.floor(result)) ? Math.floor(result) : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
