import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { GitPlumbingEngine } from './core/git-plumbing.js';
import { FallbackSnapshotEngine } from './core/fallback-engine.js';
import { DAGStateManager } from './core/dag-manager.js';
import { ReflectionAdvisor } from './core/reflection-advisor.js';
import { KeyedOperationLock } from './core/operation-lock.js';
import { WorkspaceFileLock } from './core/workspace-lock.js';
import type {
  CheckpointNode,
  ExternalEffectRecord,
  ExternalEffectAdapter,
  ExternalEffectCompensationResult,
  AgentWriteRecord,
  FileChange,
  DAGTree,
  DiffResult,
  ReflectionSummary,
  RestorePreview,
  RestoreOptions,
  RestoreResult,
  SelectiveRestoreResult,
  PruneResult,
  StorageStatus,
  SessionSummary,
  SessionState,
  TimeMachineConfig,
} from './types.js';

export interface TimeMachineServiceOptions {
  workDir: string;
  storageDir?: string;
  config?: TimeMachineConfig;
}

export class StorageQuotaError extends Error {
  readonly code = 'STORAGE_QUOTA_EXCEEDED';

  constructor(message: string) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export class RestorePlanError extends Error {
  readonly code = 'RESTORE_PLAN_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'RestorePlanError';
  }
}

interface RestorePlan {
  id: string;
  sessionId: string;
  checkpointId: string;
  currentCheckpointId: string | null;
  currentTreeOid: string;
  currentIgnoredPaths: string[];
  headOid: string | null;
  branch: string;
  operation: string | null;
  createdAt: number;
  expiresAt: number | null;
  preserveVerifiedHandEdits: boolean;
}

interface RestoreJournal {
  version: 1;
  id: string;
  sessionId: string;
  rescueCheckpointId: string;
  targetCheckpointId: string;
  kind: 'rewind' | 'fork' | 'selective-restore';
  phase: 'prepared' | 'workspace-restored';
  createdAt: number;
}

export class TimeMachineService {
  public readonly workDir: string;
  public readonly storageDir: string;
  public readonly config: Required<TimeMachineConfig>;

  private gitEngine: GitPlumbingEngine;
  private fallbackEngine: FallbackSnapshotEngine;
  private dagManagers = new Map<string, DAGStateManager>();
  private recoveredSessions = new Set<string>();
  private advisor = new ReflectionAdvisor();
  private operations = new KeyedOperationLock();
  private workspaceLock: WorkspaceFileLock;
  private readonly journalDir: string;
  private restorePlans = new Map<string, RestorePlan>();
  private externalEffectAdapters = new Map<string, ExternalEffectAdapter>();

  constructor(options: TimeMachineServiceOptions) {
    this.workDir = path.resolve(options.workDir);
    this.storageDir = options.storageDir
      ? path.resolve(options.storageDir)
      : path.join(this.workDir, '.dsh', 'time-machine');
    this.journalDir = path.join(this.storageDir, 'restore-journals');

    this.config = {
      autoSnapshot: options.config?.autoSnapshot ?? true,
      enableReflectionAdvisor: options.config?.enableReflectionAdvisor ?? true,
      refPrefix: options.config?.refPrefix || 'refs/dsh-tm',
      storageDir: this.storageDir,
      webPort: options.config?.webPort || 3088,
      enableWebUI: options.config?.enableWebUI ?? true,
      restoreMode: options.config?.restoreMode ?? 'safe',
      preservePaths: options.config?.preservePaths ?? ['node_modules'],
      webHost: options.config?.webHost ?? '127.0.0.1',
      webAllowedOrigins: [...(options.config?.webAllowedOrigins ?? [])],
      maxSnapshots: Math.max(0, Math.floor(options.config?.maxSnapshots ?? 0)),
      maxStorageBytes: Math.max(0, Math.floor(options.config?.maxStorageBytes ?? 0)),
      shadowStore: options.config?.shadowStore ?? false,
      autoPrune: options.config?.autoPrune ?? false,
      retentionMaxAgeMs: Math.max(0, Math.floor(options.config?.retentionMaxAgeMs ?? 0)),
      workspaceLockTimeoutMs: Math.max(0, Math.floor(options.config?.workspaceLockTimeoutMs ?? 30000)),
      maxQuarantineBytes: Math.max(0, Math.floor(options.config?.maxQuarantineBytes ?? 0)),
      quarantineEncryptionKeyEnv: options.config?.quarantineEncryptionKeyEnv ?? '',
      restorePlanTtlMs: Math.max(0, Math.floor(options.config?.restorePlanTtlMs ?? 900000)),
      maxSnapshotFileBytes: Math.max(0, Math.floor(options.config?.maxSnapshotFileBytes ?? 0)),
      maxSnapshotBytes: Math.max(0, Math.floor(options.config?.maxSnapshotBytes ?? 0)),
      allowPartialSnapshots: options.config?.allowPartialSnapshots ?? false,
      enableAgentWriteLedger: options.config?.preserveVerifiedHandEditsByDefault
        ? true
        : options.config?.enableAgentWriteLedger ?? false,
      preserveVerifiedHandEditsByDefault: options.config?.preserveVerifiedHandEditsByDefault ?? false,
      autoPreCommandSnapshot: options.config?.autoPreCommandSnapshot ?? false,
      preCommandTools: [...(options.config?.preCommandTools ?? ['write', 'edit', 'str_replace_editor', 'bash', 'shell', 'pwsh', 'powershell', 'terminal_bash', 'terminal_exec', 'run_code', 'python'])],
      preCommandMaxPerTurn: Math.max(0, Math.floor(options.config?.preCommandMaxPerTurn ?? 1)),
    };

    this.gitEngine = new GitPlumbingEngine({
      workDir: this.workDir,
      refPrefix: this.config.refPrefix,
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      quarantineDir: path.join(this.storageDir, 'ignored-quarantine'),
      shadowObjectDir: this.config.shadowStore ? path.join(this.storageDir, 'git-shadow', 'objects') : undefined,
      maxQuarantineBytes: this.config.maxQuarantineBytes,
      quarantineEncryptionKey: this.config.quarantineEncryptionKeyEnv
        ? process.env[this.config.quarantineEncryptionKeyEnv]
        : undefined,
      maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
      maxSnapshotBytes: this.config.maxSnapshotBytes,
      allowPartialSnapshots: this.config.allowPartialSnapshots,
    });

    this.fallbackEngine = new FallbackSnapshotEngine({
      workDir: this.workDir,
      storageDir: path.join(this.storageDir, 'fallback_backups'),
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
      maxSnapshotBytes: this.config.maxSnapshotBytes,
    });
    this.workspaceLock = new WorkspaceFileLock(path.join(this.storageDir, '.workspace.lock'), {
      timeoutMs: this.config.workspaceLockTimeoutMs,
    });
  }

  private runWorkspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
    return this.operations.run(this.workDir, () => this.workspaceLock.run(operation));
  }

  /**
   * 获取或初始化指定会话的 DAG 管理器
   */
  async getDAGManager(sessionId: string): Promise<DAGStateManager> {
    let mgr = this.dagManagers.get(sessionId);
    if (!mgr) {
      mgr = new DAGStateManager({
        sessionId,
        storageDir: this.storageDir,
      });
      await mgr.init();
      this.dagManagers.set(sessionId, mgr);
    }
    if (!this.recoveredSessions.has(sessionId)) {
      await this.recoverInterruptedRestores(sessionId, mgr);
      this.recoveredSessions.add(sessionId);
    }
    return mgr;
  }

  /** Resolve a user-facing undo distance on the active lineage, ignoring internal nodes. */
  async resolveRelativeTurnCheckpoint(sessionId: string, count: number): Promise<CheckpointNode | null> {
    if (!Number.isInteger(count) || count < 1) throw new Error('Undo count must be a positive integer.');
    return (await this.listRelativeTurnCheckpoints(sessionId))[count] ?? null;
  }

  /** Return newest-first user-visible boundaries for CLI, REST, and companion projections. */
  async listRelativeTurnCheckpoints(sessionId: string, limit = 500): Promise<CheckpointNode[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Undo list limit must be an integer between 1 and 500.');
    const dag = await this.getDAGManager(sessionId);
    const current = dag.getCurrentNode();
    if (!current) return [];
    const selected: CheckpointNode[] = [];
    const seenTurns = new Set<number>();
    for (const node of [...dag.getLineage(current.id)].reverse()) {
      if (node.status === 'running' || node.tags?.includes('pre-command') || node.tags?.includes('rescue') || node.tags?.includes('selective-restore')) continue;
      if (seenTurns.has(node.turnIndex)) continue;
      seenTurns.add(node.turnIndex);
      selected.push(node);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  /**
   * 核心：创建原子双轨快照（状态轨 + 工作区轨）
   */
  async createTurnCheckpoint(params: {
    sessionId: string;
    turnIndex: number;
    prompt: string;
    summary?: string;
    sessionState: SessionState;
    status?: 'running' | 'success' | 'failed' | 'aborted';
    errorMessage?: string;
    failedTools?: Array<{ toolName: string; input: any; error: string }>;
    tags?: string[];
  }): Promise<CheckpointNode> {
    return this.runWorkspaceOperation(() => this.createTurnCheckpointUnlocked(params));
  }

  private async createTurnCheckpointUnlocked(params: {
    sessionId: string;
    turnIndex: number;
    prompt: string;
    summary?: string;
    sessionState: SessionState;
    status?: 'running' | 'success' | 'failed' | 'aborted';
    errorMessage?: string;
    failedTools?: Array<{ toolName: string; input: any; error: string }>;
    tags?: string[];
  }): Promise<CheckpointNode> {
    const dag = await this.getDAGManager(params.sessionId);
    const internalSafetyCheckpoint = params.tags?.includes('rescue') || params.tags?.includes('selective-restore');
    if (!internalSafetyCheckpoint) {
      if (this.config.autoPrune) await this.autoPruneForQuota(dag);
      if (this.config.retentionMaxAgeMs > 0) await this.autoPruneForAge(dag);
      await this.enforceStorageQuota(dag);
    }
    const checkpointId = `chk_t${params.turnIndex}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const currentNode = dag.getCurrentNode();
    const parentCommitOid = currentNode ? currentNode.gitCommitOid : null;

    let treeOid = '';
    let commitOid = '';
    let changedFiles = [];
    let ignoredPaths: string[] = [];
    let omittedPaths: string[] = [];

    const isGit = await this.gitEngine.isGitRepo();
    if (isGit) {
      const snap = await this.gitEngine.createSnapshot({
        sessionId: params.sessionId,
        checkpointId,
        parentCommitOid,
        message: `Turn ${params.turnIndex}: ${params.prompt.slice(0, 50)}`,
      });
      treeOid = snap.treeOid;
      commitOid = snap.commitOid;
      changedFiles = snap.changedFiles;
      ignoredPaths = snap.ignoredPaths;
      omittedPaths = snap.omittedPaths;
    } else {
      const snap = await this.fallbackEngine.createSnapshot({
        sessionId: params.sessionId,
        checkpointId,
      });
      treeOid = snap.treeOid;
      commitOid = snap.commitOid;
      changedFiles = snap.changedFiles;
    }

    const node: CheckpointNode = {
      id: checkpointId,
      parentId: currentNode ? currentNode.id : null,
      branch: dag.tree.currentBranch,
      turnIndex: params.turnIndex,
      timestamp: Date.now(),
      prompt: params.prompt,
      summary: params.summary || `Executed turn ${params.turnIndex}`,
      gitTreeOid: treeOid,
      gitCommitOid: commitOid,
      sessionState: cloneJson(params.sessionState),
      changedFiles,
      status: params.status || 'success',
      errorMessage: params.errorMessage,
      failedTools: params.failedTools,
      tags: params.tags,
      ignoredPaths,
      omittedPaths,
    };

    await dag.addNode(node);
    return cloneJson(node);
  }

  async finalizeTurnCheckpoint(params: {
    sessionId: string;
    checkpointId: string;
    status: 'success' | 'failed' | 'aborted';
    errorMessage?: string;
    failedTools?: Array<{ toolName: string; input: any; error: string }>;
    assistantMessageId?: string;
    assistantMessageIds?: string[];
  }): Promise<CheckpointNode> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const current = dag.getNode(params.checkpointId);
      const isGit = await this.gitEngine.isGitRepo();
      const settled = isGit
        ? await this.gitEngine.inspectWorkspace({ omitPaths: current?.omittedPaths ?? [] })
        : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const knownAgentPaths = new Set((current?.agentWrites ?? []).map(item => item.path));
      const changes = isGit && current
        ? (await this.gitEngine.getDiffBetween(current.gitTreeOid, settled.treeOid)).map(change => ({ path: change.file, status: change.status }))
        : current
          ? await this.fallbackEngine.getChangedFiles(params.sessionId, params.checkpointId)
          : [];
      const unattributedChanges = changes.filter(change => !knownAgentPaths.has(change.path));
      return dag.updateNode(params.checkpointId, {
        status: params.status,
        errorMessage: params.errorMessage,
        failedTools: params.failedTools,
        ...(params.assistantMessageId ? { assistantMessageId: params.assistantMessageId } : {}),
        ...(params.assistantMessageIds?.length ? { assistantMessageIds: [...new Set(params.assistantMessageIds)] } : {}),
        settledGitTreeOid: settled?.treeOid,
        settledIgnoredPaths: settled?.ignoredPaths,
        unattributedChanges,
      });
    });
  }

  /** Resolve a finalized assistant message to its turn checkpoint for message actions. */
  async findCheckpointByAssistantMessage(sessionId: string, messageId: string): Promise<CheckpointNode | null> {
    if (!messageId.trim()) return null;
    const dag = await this.getDAGManager(sessionId);
    const matches = Object.values(dag.tree.nodes)
      .filter(node => node.assistantMessageId === messageId || node.assistantMessageIds?.includes(messageId))
      .sort((left, right) => right.timestamp - left.timestamp);
    return matches[0] ? cloneJson(matches[0]) : null;
  }

  /**
   * Record a successful Agent write. This is deliberately an integration API:
   * the core never guesses authorship from a tool name or file timestamp.
   */
  async recordAgentWrite(
    sessionId: string,
    checkpointId: string,
    write: Omit<AgentWriteRecord, 'recordedAt' | 'sha256'> & { sha256?: string },
  ): Promise<CheckpointNode> {
    return this.runWorkspaceOperation(async () => {
      if (!this.config.enableAgentWriteLedger) throw new Error('Agent-write ledger is disabled; set enableAgentWriteLedger: true.');
      const normalized = normalizeRelativePath(write.path);
      if (!normalized) throw new Error('Agent write path must be workspace-relative.');
      const sha256 = write.sha256 ?? await this.hashWorkspacePath(normalized);
      if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Agent write sha256 must be a 64-character hexadecimal digest.');
      const dag = await this.getDAGManager(sessionId);
      const node = dag.getNode(checkpointId);
      if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const record: AgentWriteRecord = {
        path: normalized,
        sha256: sha256.toLowerCase(),
        recordedAt: Date.now(),
        ...(write.operation ? { operation: write.operation } : {}),
      };
      const previous = (node.agentWrites ?? []).filter(item => item.path !== normalized);
      return dag.updateNode(checkpointId, { agentWrites: [...previous, record] });
    });
  }

  async getAgentWriteLedger(sessionId: string, checkpointId: string): Promise<AgentWriteRecord[]> {
    const dag = await this.getDAGManager(sessionId);
    const node = dag.getNode(checkpointId);
    if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    return cloneJson(node.agentWrites ?? []);
  }

  async getUnattributedChanges(sessionId: string, checkpointId: string): Promise<FileChange[]> {
    const dag = await this.getDAGManager(sessionId);
    const node = dag.getNode(checkpointId);
    if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    return cloneJson(node.unattributedChanges ?? []);
  }

  /**
   * Record an external mutation against a checkpoint. The core deliberately
   * does not execute compensation; an adapter can later use this declaration
   * to perform an explicit, user-approved reversal.
   */
  async recordExternalEffect(
    sessionId: string,
    checkpointId: string,
    effect: Omit<ExternalEffectRecord, 'id' | 'recordedAt'> & { id?: string },
  ): Promise<CheckpointNode> {
    return this.runWorkspaceOperation(async () => {
      if (!effect.adapter.trim() || !effect.operation.trim() || !effect.failureSemantics.trim()) {
        throw new Error('External effect adapter, operation, and failureSemantics are required.');
      }
      if (typeof effect.reversible !== 'boolean') {
        throw new Error('External effect reversible must be a boolean.');
      }
      if (!['unresolved', 'compensated', 'unknown'].includes(effect.status)) {
        throw new Error('External effect status must be unresolved, compensated, or unknown.');
      }
      if (effect.id !== undefined && (!effect.id.trim() || /\s/.test(effect.id))) {
        throw new Error('External effect id must be non-empty and contain no whitespace.');
      }
      const dag = await this.getDAGManager(sessionId);
      const node = dag.getNode(checkpointId);
      if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const record: ExternalEffectRecord = {
        adapter: effect.adapter.trim(),
        operation: effect.operation.trim(),
        reversible: effect.reversible,
        ...(effect.compensation?.trim() ? { compensation: effect.compensation.trim() } : {}),
        failureSemantics: effect.failureSemantics.trim(),
        status: effect.status,
        id: effect.id?.trim() || randomUUID(),
        recordedAt: Date.now(),
      };
      if ((node.externalEffects ?? []).some(item => item.id === record.id)) {
        throw Object.assign(new Error(`External effect '${record.id}' already exists on checkpoint '${checkpointId}'.`), {
          code: 'EXTERNAL_EFFECT_DUPLICATE',
        });
      }
      return dag.updateNode(checkpointId, {
        externalEffects: [...(node.externalEffects ?? []), record],
      });
    });
  }

  /**
   * Register an explicit compensation adapter. Adapters own authentication,
   * remote API semantics, and idempotency; the core only coordinates the
   * durable declaration and requires an explicit execute request.
   */
  registerExternalEffectAdapter(adapter: ExternalEffectAdapter): () => void {
    if (!adapter || !adapter.name.trim() || /\s/.test(adapter.name) || typeof adapter.compensate !== 'function') {
      throw new Error('External effect adapter requires a non-empty name and compensate function.');
    }
    if (this.externalEffectAdapters.has(adapter.name)) {
      throw new Error(`External effect adapter '${adapter.name}' is already registered.`);
    }
    this.externalEffectAdapters.set(adapter.name, adapter);
    return () => {
      if (this.externalEffectAdapters.get(adapter.name) === adapter) this.externalEffectAdapters.delete(adapter.name);
    };
  }

  listExternalEffectAdapters(): string[] {
    return [...this.externalEffectAdapters.keys()].sort();
  }

  /** Read external effects on a checkpoint lineage without executing compensation. */
  async listExternalEffects(sessionId: string, checkpointId?: string, unresolvedOnly = false): Promise<ExternalEffectRecord[]> {
    const dag = await this.getDAGManager(sessionId);
    const node = checkpointId === undefined ? dag.getCurrentNode() : dag.getNode(checkpointId);
    if (!node) throw new Error(checkpointId === undefined
      ? `Session '${sessionId}' has no current checkpoint.`
      : `Checkpoint '${checkpointId}' does not exist in DAG.`);
    const effects = dag.getLineage(node.id).flatMap(item => item.externalEffects ?? []);
    return cloneJson(unresolvedOnly ? effects.filter(effect => effect.status !== 'compensated') : effects);
  }

  /**
   * Perform one adapter compensation only when the caller explicitly opts in.
   * A deterministic idempotency key is used when none is supplied, and a
   * different key cannot be used after an attempt has been recorded.
   */
  async compensateExternalEffect(
    sessionId: string,
    checkpointId: string,
    effectId: string,
    options: { execute?: boolean; idempotencyKey?: string } = {},
  ): Promise<ExternalEffectCompensationResult> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const node = dag.getNode(checkpointId);
      if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const effect = node.externalEffects?.find(item => item.id === effectId);
      if (!effect) throw new Error(`External effect '${effectId}' does not exist on checkpoint '${checkpointId}'.`);
      const adapter = this.externalEffectAdapters.get(effect.adapter);
      const idempotencyKey = options.idempotencyKey?.trim() || `dsh-tm:${sessionId}:${checkpointId}:${effectId}`;
      if (!idempotencyKey || idempotencyKey.length > 256 || /\s/.test(idempotencyKey)) {
        throw new Error('External compensation idempotencyKey must be non-empty, <=256 characters, and contain no whitespace.');
      }
      if (options.execute !== true) {
        return {
          sessionId, checkpointId, effect: cloneJson(effect), adapter: effect.adapter,
          adapterAvailable: adapter !== undefined,
          dryRun: true, idempotencyKey, replayed: false,
          note: !adapter
            ? `No external effect adapter '${effect.adapter}' is registered; dry-run only.`
            : effect.status === 'compensated'
              ? 'Effect is already marked compensated.'
              : 'Dry run; no external mutation was requested.',
        };
      }
      if (!adapter) {
        throw Object.assign(new Error(`No external effect adapter '${effect.adapter}' is registered.`), {
          code: 'EXTERNAL_ADAPTER_UNAVAILABLE',
        });
      }
      if (!effect.reversible) throw new Error(`External effect '${effectId}' is declared irreversible.`);
      if (effect.compensationIdempotencyKey && effect.compensationIdempotencyKey !== idempotencyKey) {
        throw new Error(`External effect '${effectId}' already has a different compensation idempotency key.`);
      }
      if (effect.status === 'compensated' && effect.compensationIdempotencyKey === idempotencyKey) {
        return { sessionId, checkpointId, effect: cloneJson(effect), adapter: adapter.name, adapterAvailable: true, dryRun: false, idempotencyKey, replayed: true };
      }

      const attemptedAt = Date.now();
      const mark = (patch: Partial<ExternalEffectRecord>): Promise<CheckpointNode> => dag.updateNode(checkpointId, {
        externalEffects: (node.externalEffects ?? []).map(item => item.id === effectId
          ? { ...item, ...patch, compensationIdempotencyKey: idempotencyKey, compensationAttemptedAt: attemptedAt }
          : item),
      });
      await mark({ status: 'unknown' });
      try {
        const outcome = await adapter.compensate({ sessionId, checkpointId, effect: cloneJson({ ...effect, status: 'unknown', compensationIdempotencyKey: idempotencyKey, compensationAttemptedAt: attemptedAt }), idempotencyKey });
        if (!outcome || !['compensated', 'unknown'].includes(outcome.status)) throw new Error('Adapter returned an invalid compensation status.');
        const updated = await mark({ status: outcome.status, ...(outcome.note ? { compensation: outcome.note } : {}) });
        const finalEffect = updated.externalEffects!.find(item => item.id === effectId)!;
        return { sessionId, checkpointId, effect: cloneJson(finalEffect), adapter: adapter.name, adapterAvailable: true, dryRun: false, idempotencyKey, replayed: false, note: outcome.note };
      } catch (error) {
        await mark({ status: 'unknown' });
        throw Object.assign(new Error(`External compensation '${effectId}' is unknown after adapter failure: ${error instanceof Error ? error.message : String(error)}`), { code: 'EXTERNAL_COMPENSATION_UNKNOWN' });
      }
    });
  }

  /** Explicitly migrate a legacy plaintext ignored-file quarantine to AES-GCM. */
  async migrateIgnoredBackup(key: string): Promise<{ migrated: boolean; bytesRewritten: number; entryCount: number }> {
    return this.runWorkspaceOperation(async () => {
      if (!(await this.gitEngine.isGitRepo())) {
        throw new Error('Ignored quarantine migration requires a Git-backed workspace.');
      }
      return this.gitEngine.migrateIgnoredBackup(key);
    });
  }

  /**
   * 核心：回滚物理工作区与会话状态至指定快照
   */
  async rewindToCheckpoint(sessionId: string, checkpointId: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const reviewedPreserve = await this.consumeRestorePlan(sessionId, checkpointId, options.restorePlanId, dag);
      const effectiveOptions = this.applyReviewedRestorePolicy(options, reviewedPreserve);
      const restored = await this.restoreWithRescue(dag, target, effectiveOptions);
      try {
        await dag.rewindTo(checkpointId);
      } catch (error) {
        if (restored.rescue) {
          try {
            await this.restoreNode(restored.rescue, undefined, { mode: 'force', createRescuePoint: false });
            await dag.rewindTo(restored.rescue.id);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'DAG update failed and rescue compensation also failed');
          }
        }
        throw error;
      }
      await this.completeRestoreJournal(restored.journalId);
      return {
        targetNode: cloneJson(target),
        restoredSessionState: cloneJson(target.sessionState),
        rescueCheckpointId: restored.rescue?.id,
        deletedIgnoredPaths: restored.deletedIgnoredPaths,
        restoreJournalId: restored.journalId,
        preservedHandEditPaths: restored.preservedHandEditPaths,
      };
    });
  }

  /** Restore the full workspace and DAG cursor without requiring a host session fork. */
  async restoreWorkspaceToCheckpoint(sessionId: string, checkpointId: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    return this.rewindToCheckpoint(sessionId, checkpointId, options);
  }

  /** Restore selected workspace paths without changing the DSH conversation. */
  async restoreSelectedPaths(
    sessionId: string,
    checkpointId: string,
    paths: string[],
    options: Pick<RestoreOptions, 'mode' | 'restorePlanId'> = {},
  ): Promise<SelectiveRestoreResult> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      await this.consumeRestorePlan(sessionId, checkpointId, options.restorePlanId, dag);
      const selectiveMode = options.mode ?? this.config.restoreMode;
      if (selectiveMode === 'merge') throw new Error('Merge mode is only available for full Git-backed rewind/fork operations.');
      if (await this.gitEngine.isGitRepo()) await this.gitEngine.assertSupportedWorkspace();
      const current = dag.getCurrentNode();
      let rescue: CheckpointNode | undefined;
      let journalId: string | undefined;
      if (current) {
        rescue = await this.createTurnCheckpointUnlocked({
          sessionId, turnIndex: current.turnIndex, prompt: '[automatic selective-restore rescue point]',
          summary: `Rescue point before selectively restoring ${checkpointId}`, sessionState: current.sessionState,
          status: 'success', tags: ['rescue', 'selective-restore'],
        });
        journalId = await this.createRestoreJournal({
          sessionId, rescueCheckpointId: rescue.id, targetCheckpointId: checkpointId, kind: 'selective-restore',
        });
      }
      try {
        const isGit = await this.gitEngine.isGitRepo();
        if (isGit && !target.gitCommitOid.startsWith('fallback_')) {
          await this.gitEngine.restoreSelectedPaths(target.gitCommitOid, paths, {
            mode: selectiveMode,
            expectedCurrentTreeOid: rescue?.gitTreeOid ?? current?.gitTreeOid,
          });
        } else {
          await this.fallbackEngine.restoreSelectedPaths(target.sessionState.sessionId, target.id, paths, {
            mode: selectiveMode,
            expectedCurrentTreeOid: rescue?.gitTreeOid ?? current?.gitTreeOid,
          });
        }
        const resultNode = await this.createTurnCheckpointUnlocked({
          sessionId, turnIndex: current?.turnIndex ?? target.turnIndex,
          prompt: `[selective restore] ${checkpointId}`, summary: `Restored selected paths from ${checkpointId}`,
          sessionState: current?.sessionState ?? target.sessionState, status: 'success', tags: ['selective-restore'],
        });
        await this.updateRestoreJournal(journalId, 'workspace-restored');
        await this.completeRestoreJournal(journalId);
        return {
          checkpointId,
          restoredPaths: [...new Set(paths)],
          rescueCheckpointId: rescue?.id,
          resultCheckpointId: resultNode.id,
          restoreJournalId: journalId,
        };
      } catch (error) {
        if (rescue) {
          await this.restoreNode(rescue, undefined, { mode: 'force', createRescuePoint: false });
          await dag.rewindTo(rescue.id);
          await this.completeRestoreJournal(journalId);
        }
        throw error;
      }
    });
  }

  /**
   * 核心：从历史任意快照点 Fork 开辟新的平行探索分支
   */
  async forkNewBranch(params: {
    sessionId: string;
    fromCheckpointId: string;
    newBranchName: string;
    description?: string;
    restore?: RestoreOptions;
  }): Promise<{
    forkedNode: CheckpointNode;
    restoredSessionState: SessionState;
    reflectionAdvisory: ReflectionSummary;
    rescueCheckpointId?: string;
    restoreJournalId?: string;
  }> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const baseNode = dag.validateFork(params.fromCheckpointId, params.newBranchName);
      const reviewedPreserve = await this.consumeRestorePlan(params.sessionId, params.fromCheckpointId, params.restore?.restorePlanId, dag);
      const effectiveRestore = this.applyReviewedRestorePolicy(params.restore ?? {}, reviewedPreserve);
      const restored = await this.restoreWithRescue(dag, baseNode, effectiveRestore, 'fork');
      let forkedNode: CheckpointNode;
      try {
        forkedNode = await dag.forkBranch(params.fromCheckpointId, params.newBranchName, params.description);
      } catch (error) {
        if (restored.rescue) {
          await this.restoreNode(restored.rescue, restored.rescue, { mode: 'force', createRescuePoint: false });
          await dag.rewindTo(restored.rescue.id);
        }
        throw error;
      }

    // 提取被放弃分支中的历史失败/死循环错误，提炼反思注记
      let reflectionAdvisory: ReflectionSummary = {
      hasPastFailures: false,
      failedNodeCount: 0,
      summaryNote: '',
      suggestedPromptPrefix: '',
    };

      if (this.config.enableReflectionAdvisor) {
        const abandonedNodes = dag.getAbandonedSubtrees(params.fromCheckpointId, params.newBranchName);
        const forkPoint = dag.getNode(params.fromCheckpointId);
        const forkPointHasFailure = forkPoint !== null
          && (forkPoint.status === 'failed'
            || forkPoint.errorMessage !== undefined
            || (forkPoint.failedTools?.length ?? 0) > 0);
        reflectionAdvisory = this.advisor.generateReflectionNote(
          forkPointHasFailure && forkPoint !== undefined ? [forkPoint, ...abandonedNodes] : abandonedNodes,
        );
      }

      return {
        forkedNode: cloneJson(forkedNode),
        restoredSessionState: cloneJson(forkedNode.sessionState),
        reflectionAdvisory,
        rescueCheckpointId: restored.rescue?.id,
        restoreJournalId: restored.journalId,
      };
    });
  }

  /**
   * 获取指定快照与当前（或另一快照）的代码差异
   */
  async getDiff(sessionId: string, baseId: string, targetId: string): Promise<DiffResult[]> {
    const dag = await this.getDAGManager(sessionId);
    const baseNode = dag.getNode(baseId);
    const targetNode = dag.getNode(targetId);

    if (!baseNode || !targetNode) return [];

    const isGit = await this.gitEngine.isGitRepo();
    if (isGit) {
      return await this.gitEngine.getDiffBetween(baseNode.gitCommitOid, targetNode.gitCommitOid);
    }
    return await this.fallbackEngine.getDiffBetween(sessionId, baseId, targetId);
  }

  /**
   * Produce a read-only impact report before a rewind/fork. This deliberately
   * does not create a rescue point, mutate the DAG, or touch workspace files.
   */
  async previewRestore(sessionId: string, checkpointId: string, options: { preserveVerifiedHandEdits?: boolean } = {}): Promise<RestorePreview> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const current = dag.getCurrentNode();
      const isGit = await this.gitEngine.isGitRepo();
      if (isGit) await this.gitEngine.assertSupportedWorkspace();
      const currentState = isGit
        ? await this.gitEngine.inspectWorkspace({ omitPaths: current?.omittedPaths ?? [] })
        : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const controlPlane = isGit
        ? await this.gitEngine.inspectControlPlane()
        : { headOid: null, branch: '', operation: null };
      const targetIgnoredPaths = target.ignoredPaths ?? [];
      const diffs = isGit
        ? await this.gitEngine.getDiffBetween(currentState.treeOid, target.gitCommitOid)
        : current
          ? await this.fallbackEngine.getDiffBetween(sessionId, current.id, target.id)
          : target.changedFiles.map(change => ({
            file: change.path,
            status: change.status,
            diffText: 'Fallback snapshot: no previous checkpoint is available for a text diff.',
          }));
      const expectedTree = current?.settledGitTreeOid ?? current?.gitTreeOid;
      const expectedIgnored = current?.settledIgnoredPaths ?? current?.ignoredPaths ?? [];
      const preserveHandEdits = options.preserveVerifiedHandEdits === true
        || (options.preserveVerifiedHandEdits === undefined && this.config.preserveVerifiedHandEditsByDefault);
      const preservedHandEditPaths = preserveHandEdits && current
        ? await this.findVerifiedHandEdits(current)
        : [];
      const driftDiffs = isGit && current && expectedTree && currentState.treeOid !== expectedTree
        ? await this.gitEngine.getDiffBetween(expectedTree, currentState.treeOid)
        : !isGit && current && expectedTree && currentState.treeOid !== expectedTree
          ? (await this.fallbackEngine.getChangedFiles(sessionId, current.id)).map(item => ({ file: item.path }))
          : [];
      const allConflictingPaths = [...new Set([
        ...driftDiffs.map(diff => diff.file),
        ...symmetricDifference(expectedIgnored, currentState.ignoredPaths).map(item => `(ignored) ${item}`),
      ])].sort();
      const conflictingPaths = allConflictingPaths.filter(file => !preservedHandEditPaths.some(path => file === path || file.startsWith(`${path}/`)));
      const currentLineage = current ? dag.getLineage(current.id) : [];
      const targetIndex = currentLineage.findIndex(node => node.id === checkpointId);
      const externalEffects = currentLineage
        .slice(targetIndex >= 0 ? targetIndex + 1 : 0)
        .flatMap(node => node.externalEffects ?? [])
        .map(effect => cloneJson(effect));
      const workspaceDrifted = Boolean(current && (
        currentState.treeOid !== expectedTree || !sameStrings(currentState.ignoredPaths, expectedIgnored)
      ));
      this.expireRestorePlans();
      const planId = `plan_${randomUUID().replace(/-/g, '')}`;
      const createdAt = Date.now();
      const expiresAt = this.config.restorePlanTtlMs > 0 ? createdAt + this.config.restorePlanTtlMs : null;
      this.restorePlans.set(planId, {
        id: planId,
        sessionId,
        checkpointId,
        currentCheckpointId: current?.id ?? null,
        currentTreeOid: currentState.treeOid,
        currentIgnoredPaths: [...currentState.ignoredPaths],
        headOid: controlPlane.headOid,
        branch: controlPlane.branch,
        operation: controlPlane.operation,
        createdAt,
        expiresAt,
        preserveVerifiedHandEdits: preserveHandEdits,
      });
      return {
        sessionId,
        checkpointId,
        currentCheckpointId: current?.id ?? null,
        currentTreeOid: currentState.treeOid,
        targetTreeOid: target.gitTreeOid,
        currentIgnoredPaths: currentState.ignoredPaths,
        targetIgnoredPaths,
        targetOmittedPaths: target.omittedPaths ?? [],
        ignoredPathsToDelete: currentState.ignoredPaths.filter(item => !targetIgnoredPaths.includes(item)),
        diffs,
        conflictingPaths,
        preservedHandEditPaths,
        externalEffects,
        workspaceDrifted,
        requiresForce: conflictingPaths.length > 0,
        restorePlanId: planId,
        restorePlanExpiresAt: expiresAt,
      };
    });
  }

  private expireRestorePlans(now = Date.now()): void {
    for (const [id, plan] of this.restorePlans) {
      if (plan.expiresAt !== null && plan.expiresAt <= now) this.restorePlans.delete(id);
    }
  }

  /** Consume a preview token and fail closed if the reviewed workspace changed. */
  private async consumeRestorePlan(
    sessionId: string,
    checkpointId: string,
    planId: string | undefined,
    dag: DAGStateManager,
  ): Promise<boolean | undefined> {
    if (!planId) return undefined;
    this.expireRestorePlans();
    const plan = this.restorePlans.get(planId);
    this.restorePlans.delete(planId);
    if (!plan) throw new RestorePlanError('Restore preview plan is missing or expired; run preview again.');
    if (plan.sessionId !== sessionId || plan.checkpointId !== checkpointId) {
      throw new RestorePlanError('Restore preview plan belongs to a different session or checkpoint.');
    }
    const current = dag.getCurrentNode();
    if ((current?.id ?? null) !== plan.currentCheckpointId) {
      throw new RestorePlanError('The active checkpoint changed after preview; run preview again.');
    }
    const actual = await this.inspectWorkspaceSignature(current?.omittedPaths ?? []);
    if (actual.treeOid !== plan.currentTreeOid || !sameStrings(actual.ignoredPaths, plan.currentIgnoredPaths)) {
      throw new RestorePlanError('Workspace changed after preview; run preview again before restoring.');
    }
    const controlPlane = await this.inspectControlPlane();
    if (controlPlane.headOid !== plan.headOid || controlPlane.branch !== plan.branch || controlPlane.operation !== plan.operation) {
      throw new RestorePlanError('Git HEAD, branch, or in-progress operation changed after preview; run preview again.');
    }
    return plan.preserveVerifiedHandEdits;
  }

  private applyReviewedRestorePolicy(options: RestoreOptions, reviewedPreserve: boolean | undefined): RestoreOptions {
    if (reviewedPreserve === undefined) return options;
    if (options.preserveVerifiedHandEdits !== undefined && options.preserveVerifiedHandEdits !== reviewedPreserve) {
      throw new RestorePlanError('Restore request hand-edit policy differs from the reviewed preview; run preview again.');
    }
    return options.preserveVerifiedHandEdits === undefined
      ? { ...options, preserveVerifiedHandEdits: reviewedPreserve }
      : options;
  }

  private async inspectWorkspaceSignature(omitPaths: string[] = []): Promise<{ treeOid: string; ignoredPaths: string[] }> {
    return await this.gitEngine.isGitRepo()
      ? await this.gitEngine.inspectWorkspace({ omitPaths })
      : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
  }

  private async inspectControlPlane(): Promise<{ headOid: string | null; branch: string; operation: string | null }> {
    return await this.gitEngine.isGitRepo()
      ? await this.gitEngine.inspectControlPlane()
      : { headOid: null, branch: '', operation: null };
  }

  /**
   * 打印终端彩色 ASCII 拓扑树
   */
  async renderTree(sessionId: string): Promise<string> {
    const dag = await this.getDAGManager(sessionId);
    return dag.renderAsciiTree();
  }

  async getStorageStatus(sessionId?: string): Promise<StorageStatus> {
    const sessions = sessionId ? [sessionId] : (await this.listSessions()).map(item => item.sessionId);
    const managers = await Promise.all(sessions.map(item => this.getDAGManager(item)));
    const checkpoints = managers.reduce((sum, manager) => sum + Object.keys(manager.tree.nodes).length, 0);
    const leaves = managers.reduce((sum, manager) => sum + this.pruneCandidates(manager).length, 0);
    const files = await countFiles(this.storageDir);
    const bytes = await directoryBytes(this.storageDir);
    return {
      storageDir: this.storageDir,
      bytes,
      files,
      sessions: sessions.length,
      checkpoints,
      pruneCandidates: leaves,
      gitObjectsShared: await this.gitEngine.isGitRepo() && !this.config.shadowStore,
      gitObjectsEncrypted: false,
      quarantineEncrypted: Boolean(this.config.quarantineEncryptionKeyEnv && process.env[this.config.quarantineEncryptionKeyEnv]),
    };
  }

  /** Enumerate persisted sessions without creating a new empty DAG. */
  async listSessions(): Promise<SessionSummary[]> {
    const entries = await fs.readdir(this.storageDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
    const summaries: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('dag_') || !entry.name.endsWith('.json')) continue;
      try {
        const tree = JSON.parse(await fs.readFile(path.join(this.storageDir, entry.name), 'utf8')) as DAGTree;
        if (typeof tree.sessionId !== 'string') continue;
        const nodes = Object.values(tree.nodes ?? {}) as CheckpointNode[];
        summaries.push({
          sessionId: tree.sessionId,
          checkpointCount: nodes.length,
          currentBranch: tree.currentBranch,
          currentCheckpointId: tree.currentCheckpointId,
          updatedAt: nodes.length ? Math.max(...nodes.map(node => node.timestamp)) : null,
        });
      } catch { /* ignore corrupt/partial files in best-effort discovery */ }
    }
    return summaries.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.sessionId.localeCompare(right.sessionId));
  }

  /** Report runtime capabilities so Web/CLI integrations can fail early. */
  async getCapabilities(): Promise<{
    version: 1;
    git: boolean;
    fallback: boolean;
    mergeRestore: boolean;
    fallbackTextDiff: boolean;
    selectiveRestore: boolean;
    shadowStore: boolean;
    shadowStoreEncryption: false;
    quarantineEncryption: boolean;
    quarantineMigration: boolean;
    partialSnapshots: boolean;
    /** Safe dirty-path overlay is available for normal Git workspaces. */
    incrementalCapture: boolean;
    /** Current restore semantics; ledger mode is explicit and opt-in. */
    handEditPolicy: 'reject-drift' | 'ledger-opt-in' | 'ledger-default';
    agentWriteLedger: boolean;
    preCommandSnapshots: boolean;
    preCommandTools: string[];
    preCommandMaxPerTurn: number;
    unattributedMutationInventory: boolean;
    externalEffectLedger: true;
    externalEffectAdapters: string[];
    workspaceIsolation: 'shared-lock';
    /** Rewind restores files and opens a new DSH session; it never rewrites the append-only log. */
    rewindSessionMode: 'fork';
    workspace: { sparseCheckout: boolean; submodulePaths: string[]; inProgressOperation: string | null };
    policies: {
      restoreMode: 'safe' | 'merge' | 'force';
      maxSnapshots: number;
      maxStorageBytes: number;
      retentionMaxAgeMs: number;
      maxSnapshotFileBytes: number;
      maxSnapshotBytes: number;
      allowPartialSnapshots: boolean;
      enableAgentWriteLedger: boolean;
      preserveVerifiedHandEditsByDefault: boolean;
      autoPreCommandSnapshot: boolean;
      preCommandTools: string[];
      preCommandMaxPerTurn: number;
      maxQuarantineBytes: number;
      workspaceLockTimeoutMs: number;
    };
  }> {
    const git = await this.gitEngine.isGitRepo();
    const workspace = git
      ? await this.gitEngine.inspectWorkspaceCapabilities()
      : { sparseCheckout: false, submodulePaths: [], inProgressOperation: null };
    const usable = git && !workspace.sparseCheckout && workspace.submodulePaths.length === 0 && !workspace.inProgressOperation;
    return {
      version: 1,
      git,
      fallback: !git,
      mergeRestore: usable,
      fallbackTextDiff: !git,
      selectiveRestore: usable || !git,
      shadowStore: git && this.config.shadowStore,
      shadowStoreEncryption: false,
      quarantineEncryption: Boolean(this.config.quarantineEncryptionKeyEnv && process.env[this.config.quarantineEncryptionKeyEnv]),
      quarantineMigration: git && Boolean(this.config.quarantineEncryptionKeyEnv),
      partialSnapshots: git && this.config.allowPartialSnapshots && (this.config.maxSnapshotFileBytes > 0 || this.config.maxSnapshotBytes > 0),
      incrementalCapture: usable && this.config.maxSnapshotFileBytes === 0 && this.config.maxSnapshotBytes === 0,
      handEditPolicy: this.config.preserveVerifiedHandEditsByDefault
        ? 'ledger-default'
        : this.config.enableAgentWriteLedger ? 'ledger-opt-in' : 'reject-drift',
      agentWriteLedger: this.config.enableAgentWriteLedger,
      preCommandSnapshots: this.config.autoPreCommandSnapshot,
      preCommandTools: [...this.config.preCommandTools],
      preCommandMaxPerTurn: this.config.preCommandMaxPerTurn,
      unattributedMutationInventory: true,
      externalEffectLedger: true,
      externalEffectAdapters: this.listExternalEffectAdapters(),
      workspaceIsolation: 'shared-lock',
      rewindSessionMode: 'fork',
      workspace,
      policies: {
        restoreMode: this.config.restoreMode,
        maxSnapshots: this.config.maxSnapshots,
        maxStorageBytes: this.config.maxStorageBytes,
        retentionMaxAgeMs: this.config.retentionMaxAgeMs,
        maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
        maxSnapshotBytes: this.config.maxSnapshotBytes,
        allowPartialSnapshots: this.config.allowPartialSnapshots,
        enableAgentWriteLedger: this.config.enableAgentWriteLedger,
        preserveVerifiedHandEditsByDefault: this.config.preserveVerifiedHandEditsByDefault,
        autoPreCommandSnapshot: this.config.autoPreCommandSnapshot,
        preCommandTools: [...this.config.preCommandTools],
        preCommandMaxPerTurn: this.config.preCommandMaxPerTurn,
        maxQuarantineBytes: this.config.maxQuarantineBytes,
        workspaceLockTimeoutMs: this.config.workspaceLockTimeoutMs,
      },
    };
  }

  async prune(sessionId: string, options: { keepLatest?: number; olderThanMs?: number; abandonedBranches?: boolean; compactHistory?: boolean; repackShadowObjects?: boolean; dryRun?: boolean } = {}): Promise<PruneResult> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const keepLatest = Math.max(0, Math.floor(options.keepLatest ?? 20));
      const nodes = Object.values(dag.tree.nodes).sort((left, right) => right.timestamp - left.timestamp);
      const keep = new Set(nodes.slice(0, keepLatest).map(node => node.id));
      const olderThanMs = options.olderThanMs !== undefined ? Math.max(0, Math.floor(options.olderThanMs)) : undefined;
      const cutoff = olderThanMs !== undefined && olderThanMs > 0 ? Date.now() - olderThanMs : undefined;
      let removed: CheckpointNode[] = [];
      const dryRun = options.dryRun === true;
      const currentLineageIds = new Set(dag.getLineage(dag.tree.currentCheckpointId ?? '').map(node => node.id));
      const protectedIds = new Set<string>([
        ...(dag.tree.currentCheckpointId ? [dag.tree.currentCheckpointId] : []),
        ...Object.values(dag.tree.branches).map(branch => branch.headId).filter(Boolean),
      ]);
      const plannedBranchRemoval = options.abandonedBranches
        ? nodes.filter(node => node.branch !== dag.tree.currentBranch && !currentLineageIds.has(node.id))
        : [];
      if (options.abandonedBranches) {
        if (dryRun) removed.push(...plannedBranchRemoval);
        else {
          const abandonedBranches = Object.keys(dag.tree.branches).filter(branch => branch !== dag.tree.currentBranch);
          for (const branch of abandonedBranches) removed.push(...await dag.removeBranch(branch));
        }
      }
      const remainingNodes = dryRun
        ? nodes.filter(node => !plannedBranchRemoval.some(item => item.id === node.id))
        : Object.values(dag.tree.nodes);
      const candidates = remainingNodes.filter(node => !keep.has(node.id) && (cutoff === undefined || node.timestamp < cutoff));
      const childIds = new Set(remainingNodes.map(node => node.parentId).filter((id): id is string => Boolean(id)));
      const plannedCandidates = options.compactHistory
        ? candidates.filter(node => !protectedIds.has(node.id))
        : candidates.filter(node => !protectedIds.has(node.id) && !childIds.has(node.id));
      if (options.compactHistory) {
        if (dryRun) removed.push(...plannedCandidates);
        else removed.push(...await dag.compactNodes(candidates.map(node => node.id)));
      } else {
        if (dryRun) removed.push(...plannedCandidates);
        else removed.push(...await dag.removeLeafNodes(candidates.map(node => node.id)));
      }
      const reclaimed = dryRun ? { reclaimedBytes: 0, gitRefsRemoved: 0, quarantineReclaimedBytes: 0 } : await this.reclaimNodes(sessionId, removed);
      const shadowRepack = !dryRun && options.repackShadowObjects && this.config.shadowStore
        ? await this.gitEngine.repackShadowObjects()
        : undefined;
      return {
        sessionId,
        dryRun,
        ...(dryRun ? { wouldRemoveCheckpointIds: removed.map(node => node.id) } : {}),
        removedCheckpointIds: dryRun ? [] : removed.map(node => node.id),
        reclaimedBytes: reclaimed.reclaimedBytes,
        gitRefsRemoved: reclaimed.gitRefsRemoved,
        quarantineReclaimedBytes: reclaimed.quarantineReclaimedBytes,
        shadowObjectsReclaimedBytes: shadowRepack?.reclaimedBytes,
        shadowRepackSkippedReason: shadowRepack?.skippedReason,
        note: dryRun
          ? `Dry run: ${removed.length} checkpoint(s) would be removed; no DAG, quarantine, or Git objects were changed.`
          : reclaimed.gitRefsRemoved > 0
          ? (this.config.shadowStore
            ? 'Plugin refs and shadow objects were pruned; the user repository was not garbage-collected.'
            : 'Git objects are shared; run repository maintenance only if you understand its impact.')
          : cutoff === undefined
          ? 'Fallback snapshot bytes were removed from plugin storage.'
          : `Only checkpoints older than ${olderThanMs} ms were eligible; protected DAG nodes were retained.`,
      };
    });
  }

  private async autoPruneForQuota(dag: DAGStateManager): Promise<void> {
    const nodes = Object.values(dag.tree.nodes).sort((left, right) => left.timestamp - right.timestamp);
    const protectedIds = new Set([
      ...(dag.tree.currentCheckpointId ? [dag.tree.currentCheckpointId] : []),
      ...Object.values(dag.tree.branches).map(branch => branch.headId).filter(Boolean),
    ]);
    let candidates = nodes.filter(node => !protectedIds.has(node.id));
    if (this.config.maxSnapshots > 0) {
      const removeCount = Math.max(0, nodes.length - this.config.maxSnapshots + 1);
      candidates = candidates.slice(0, removeCount);
    }
    if (this.config.maxStorageBytes > 0 && await directoryBytes(this.storageDir) >= this.config.maxStorageBytes) {
      candidates = candidates.length ? candidates : nodes.filter(node => !protectedIds.has(node.id));
    }
    if (candidates.length === 0) return;
    const removed = await dag.compactNodes(candidates.map(node => node.id));
    await this.reclaimNodes(dag.tree.sessionId, removed);
  }

  private async autoPruneForAge(dag: DAGStateManager): Promise<void> {
    const cutoff = Date.now() - this.config.retentionMaxAgeMs;
    const protectedIds = new Set([
      ...(dag.tree.currentCheckpointId ? [dag.tree.currentCheckpointId] : []),
      ...Object.values(dag.tree.branches).map(branch => branch.headId).filter(Boolean),
    ]);
    const candidates = Object.values(dag.tree.nodes)
      .filter(node => node.timestamp < cutoff && !protectedIds.has(node.id));
    if (candidates.length === 0) return;
    const removed = await dag.compactNodes(candidates.map(node => node.id));
    await this.reclaimNodes(dag.tree.sessionId, removed);
  }

  private async reclaimNodes(sessionId: string, nodes: CheckpointNode[]): Promise<{ reclaimedBytes: number; gitRefsRemoved: number; quarantineReclaimedBytes: number }> {
    let reclaimedBytes = 0;
    let gitRefsRemoved = 0;
    let quarantineReclaimedBytes = 0;
    for (const node of nodes) {
      if (node.gitCommitOid.startsWith('fallback_')) reclaimedBytes += await this.fallbackEngine.removeSnapshot(sessionId, node.id);
      else if (await this.gitEngine.isGitRepo() && await this.gitEngine.deleteCheckpointRef(sessionId, node.id)) gitRefsRemoved += 1;
    }
    const referencedBackups = await this.referencedIgnoredBackupKeys();
    for (const key of new Set(nodes.map(node => node.ignoredBackupKey).filter((item): item is string => Boolean(item)))) {
      if (!referencedBackups.has(key)) quarantineReclaimedBytes += await this.gitEngine.removeIgnoredBackup(key);
    }
    if (this.config.shadowStore) await this.gitEngine.pruneShadowObjects();
    return { reclaimedBytes, gitRefsRemoved, quarantineReclaimedBytes };
  }

  private async referencedIgnoredBackupKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    const collect = (raw: any): void => {
      for (const node of Object.values(raw?.nodes ?? {}) as Array<CheckpointNode>) {
        if (node.ignoredBackupKey) keys.add(node.ignoredBackupKey);
      }
    };
    for (const manager of this.dagManagers.values()) collect(manager.tree);
    for (const entry of await fs.readdir(this.storageDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
      if (!entry.isFile() || !entry.name.startsWith('dag_') || !entry.name.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(this.storageDir, entry.name), 'utf8')
        .then(value => JSON.parse(value))
        .catch(() => undefined);
      if (raw) collect(raw);
    }
    return keys;
  }

  private pruneCandidates(dag: DAGStateManager): CheckpointNode[] {
    const protectedIds = new Set([
      ...(dag.tree.currentCheckpointId ? [dag.tree.currentCheckpointId] : []),
      ...Object.values(dag.tree.branches).map(branch => branch.headId).filter(Boolean),
    ]);
    const parents = new Set(Object.values(dag.tree.nodes).map(node => node.parentId).filter((id): id is string => Boolean(id)));
    return Object.values(dag.tree.nodes).filter(node => !protectedIds.has(node.id) && !parents.has(node.id));
  }

  private async enforceStorageQuota(dag: DAGStateManager): Promise<void> {
    if (this.config.maxSnapshots > 0 && Object.keys(dag.tree.nodes).length >= this.config.maxSnapshots) {
      throw new StorageQuotaError(
        `Session '${dag.tree.sessionId}' reached maxSnapshots=${this.config.maxSnapshots}. Run /tm-prune or increase the limit.`,
      );
    }
    if (this.config.maxStorageBytes > 0) {
      const bytes = await directoryBytes(this.storageDir);
      if (bytes >= this.config.maxStorageBytes) {
        throw new StorageQuotaError(
          `Time Machine storage reached maxStorageBytes=${this.config.maxStorageBytes}. Run /tm-prune or increase the limit.`,
        );
      }
    }
  }

  private async restoreWithRescue(
    dag: DAGStateManager,
    target: CheckpointNode,
    options: RestoreOptions,
    kind: RestoreJournal['kind'] = 'rewind',
  ): Promise<{ rescue?: CheckpointNode; deletedIgnoredPaths: string[]; journalId?: string; preservedHandEditPaths: string[] }> {
    const current = dag.getCurrentNode() ?? undefined;
    const mode = options.mode ?? this.config.restoreMode;
    const preserveHandEdits = options.preserveVerifiedHandEdits === true
      || (options.preserveVerifiedHandEdits === undefined && this.config.preserveVerifiedHandEditsByDefault);
    const preservedPaths = preserveHandEdits && current ? await this.findVerifiedHandEdits(current) : [];
    const isGit = await this.gitEngine.isGitRepo();
    if (isGit) await this.gitEngine.assertSupportedWorkspace();

    if (mode === 'safe' && current) {
      const actual = isGit
        ? await this.gitEngine.inspectWorkspace({ omitPaths: current.omittedPaths ?? [] })
        : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const expectedTree = current.settledGitTreeOid ?? current.gitTreeOid;
      const expectedIgnored = current.settledIgnoredPaths ?? current.ignoredPaths ?? [];
      if (actual.treeOid !== expectedTree || !sameStrings(actual.ignoredPaths, expectedIgnored)) {
        const { WorkspaceDriftError } = await import('./core/git-plumbing.js');
        const changed = actual.treeOid === expectedTree
          ? []
          : (isGit
            ? (await this.gitEngine.getDiffBetween(expectedTree, actual.treeOid)).map(item => item.file)
            : current
              ? (await this.fallbackEngine.getChangedFiles(dag.tree.sessionId, current.id)).map(item => item.path)
              : [])
            .filter(file => !preservedPaths.some(path => file === path || file.startsWith(`${path}/`)));
        const ignoredDrift = !sameStrings(actual.ignoredPaths, expectedIgnored);
        if (changed.length || ignoredDrift) {
          const details = actual.treeOid === expectedTree
            ? ['workspace no longer matches the active checkpoint']
            : [`managed tree changed (expected ${expectedTree}, observed ${actual.treeOid})${changed.length ? `: ${changed.join(', ')}` : ''}`];
          if (ignoredDrift) details.push('ignored path set changed');
          throw new WorkspaceDriftError(details);
        }
      }
    }

    let rescue: CheckpointNode | undefined;
    let journalId: string | undefined;
    if (options.createRescuePoint !== false && current) {
      rescue = await this.createTurnCheckpointUnlocked({
        sessionId: dag.tree.sessionId,
        turnIndex: current.turnIndex,
        prompt: '[automatic pre-restore rescue point]',
        summary: `Rescue point before restoring ${target.id}`,
        sessionState: current.sessionState,
        status: 'success',
        tags: ['rescue'],
      });
      journalId = await this.createRestoreJournal({
        sessionId: dag.tree.sessionId, rescueCheckpointId: rescue.id, targetCheckpointId: target.id, kind,
      });
    }

    // Merge mode must use the original active checkpoint as the 3-way base;
    // the rescue point is only compensation state and includes the live drift.
    const expected = mode === 'merge' ? current : (rescue ?? current);
    if (rescue && options.deleteNewIgnoredPaths) {
      rescue = await dag.updateNode(rescue.id, { ignoredBackupKey: rescue.id });
    }
    try {
      const result = await this.restoreNode(target, expected, {
        ...options,
        mode,
        ignoredBackupKey: rescue?.ignoredBackupKey,
        preservePaths: preservedPaths,
      });
      await this.updateRestoreJournal(journalId, 'workspace-restored');
      return { rescue, deletedIgnoredPaths: result.deletedIgnoredPaths, journalId, preservedHandEditPaths: preservedPaths };
    } catch (error) {
      if (rescue) {
        try {
          await this.restoreNode(rescue, undefined, { mode: 'force', createRescuePoint: false });
          await dag.rewindTo(rescue.id);
          await this.completeRestoreJournal(journalId);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Restore failed and rescue compensation also failed');
        }
      }
      throw error;
    }
  }

  private async restoreNode(
    target: CheckpointNode,
    expected: CheckpointNode | undefined,
    options: RestoreOptions,
  ): Promise<{ deletedIgnoredPaths: string[] }> {
    const isGit = await this.gitEngine.isGitRepo();
    if (isGit && target.gitCommitOid && !target.gitCommitOid.startsWith('fallback_')) {
      const backupKey = options.ignoredBackupKey ?? target.ignoredBackupKey;
      if (backupKey) await this.gitEngine.validateIgnoredBackup(backupKey);
      const result = await this.gitEngine.restoreSnapshot(target.gitCommitOid, {
        mode: options.mode,
        expectedCurrentTreeOid: expected?.gitTreeOid,
        expectedCurrentIgnoredPaths: expected?.ignoredPaths ?? [],
        targetIgnoredPaths: target.ignoredPaths ?? [],
        deleteNewIgnoredPaths: options.deleteNewIgnoredPaths,
        ignoredBackupKey: options.ignoredBackupKey,
        omittedPaths: target.omittedPaths ?? [],
        preservePaths: options.preservePaths ?? [],
      });
      if (target.ignoredBackupKey) await this.gitEngine.restoreIgnoredBackup(target.ignoredBackupKey);
      const preservePaths = options.preservePaths ?? [];
      const verified = await this.gitEngine.inspectWorkspace({ omitPaths: [...(target.omittedPaths ?? []), ...preservePaths] });
      const expectedTree = options.mode === 'merge' ? result.restoredTreeOid : target.gitTreeOid;
      const treeMismatch = verified.treeOid !== expectedTree;
      const allowedMismatch = treeMismatch && preservePaths.length
        ? (await this.gitEngine.getDiffBetween(expectedTree, verified.treeOid)).every(item => preservePaths.some(path => item.file === path || item.file.startsWith(`${path}/`)))
        : false;
      if ((treeMismatch && !allowedMismatch) || (!sameStrings(verified.ignoredPaths, target.ignoredPaths ?? []))) {
        throw new Error(`Workspace integrity check failed after restoring checkpoint '${target.id}'.`);
      }
      return result;
    }
    if (options.mode === 'merge') {
      throw new Error('Merge restore is only supported for Git-backed checkpoints.');
    }
    const preservePaths = options.preservePaths ?? [];
    await this.fallbackEngine.restoreSnapshot(target.sessionState.sessionId, target.id, { preservePaths });
    const verified = await this.fallbackEngine.inspectWorkspace({ omitPaths: preservePaths });
    const expectedTree = preservePaths.length
      ? await this.fallbackEngine.snapshotTreeOid(target.sessionState.sessionId, target.id, preservePaths)
      : target.gitTreeOid;
    if (verified !== expectedTree) {
      throw new Error(`Fallback workspace integrity check failed after restoring checkpoint '${target.id}'.`);
    }
    return { deletedIgnoredPaths: [] };
  }

  private async findVerifiedHandEdits(current: CheckpointNode): Promise<string[]> {
    const records = current.agentWrites ?? [];
    const preserved: string[] = [];
    for (const record of records) {
      if (!normalizeRelativePath(record.path) || !/^[a-f0-9]{64}$/i.test(record.sha256)) {
        throw new Error(`AGENT_WRITE_LEDGER_INVALID: checkpoint '${current.id}' contains invalid write evidence.`);
      }
      const actual = await this.hashWorkspacePath(record.path).catch(() => undefined);
      if (actual && actual !== record.sha256) preserved.push(record.path);
    }
    return preserved;
  }

  private async hashWorkspacePath(relative: string): Promise<string> {
    const absolute = path.resolve(this.workDir, relative);
    if (!absolute.startsWith(`${path.resolve(this.workDir)}${path.sep}`)) throw new Error('Path escapes workspace.');
    const stat = await fs.lstat(absolute);
    const hash = createHash('sha256');
    if (stat.isSymbolicLink()) hash.update(`symlink:${await fs.readlink(absolute)}`);
    else if (stat.isFile()) hash.update(await fs.readFile(absolute));
    else throw new Error(`Agent write path '${relative}' is not a regular file or symlink.`);
    return hash.digest('hex');
  }

  async completeRestoreJournal(journalId?: string): Promise<void> {
    if (!journalId) return;
    await fs.rm(path.join(this.journalDir, `${journalId}.json`), { force: true }).catch(() => undefined);
  }

  private async createRestoreJournal(
    params: Omit<RestoreJournal, 'version' | 'id' | 'phase' | 'createdAt'>,
  ): Promise<string> {
    const id = `restore_${randomUUID().replace(/-/g, '')}`;
    const journal: RestoreJournal = { version: 1, id, phase: 'prepared', createdAt: Date.now(), ...params };
    await fs.mkdir(this.journalDir, { recursive: true });
    const file = path.join(this.journalDir, `${id}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    return id;
  }

  private async updateRestoreJournal(journalId: string | undefined, phase: RestoreJournal['phase']): Promise<void> {
    if (!journalId) return;
    const file = path.join(this.journalDir, `${journalId}.json`);
    const raw = await fs.readFile(file, 'utf8').catch(() => undefined);
    if (!raw) return;
    const journal = JSON.parse(raw) as RestoreJournal;
    journal.phase = phase;
    await fs.writeFile(file, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  }

  private async recoverInterruptedRestores(sessionId: string, dag: DAGStateManager): Promise<void> {
    const entries = await fs.readdir(this.journalDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(this.journalDir, entry.name);
      let journal: RestoreJournal;
      try {
        journal = JSON.parse(await fs.readFile(file, 'utf8')) as RestoreJournal;
      } catch {
        continue;
      }
      if (journal.version !== 1 || journal.sessionId !== sessionId) continue;
      const rescue = dag.getNode(journal.rescueCheckpointId);
      if (!rescue) {
        await fs.rm(file, { force: true });
        continue;
      }
      await this.restoreNode(rescue, undefined, { mode: 'force', createRescuePoint: false });
      await dag.rewindTo(rescue.id);
      await fs.rm(file, { force: true });
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid workspace-relative path '${value}'.`);
  }
  return normalized;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function symmetricDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  return [...left.filter(item => !rightSet.has(item)), ...right.filter(item => !leftSet.has(item))];
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += (await fs.stat(absolute).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}

async function countFiles(root: string): Promise<number> {
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += 1;
    }
  };
  await visit(root);
  return total;
}
