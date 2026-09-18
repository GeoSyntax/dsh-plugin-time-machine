import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { GitPlumbingEngine } from './core/git-plumbing.js';
import { FallbackSnapshotEngine } from './core/fallback-engine.js';
import { DAGStateManager } from './core/dag-manager.js';
import { ReflectionAdvisor } from './core/reflection-advisor.js';
import { KeyedOperationLock } from './core/operation-lock.js';
import { WorkspaceFileLock } from './core/workspace-lock.js';
import type {
  CheckpointNode,
  DAGTree,
  DiffResult,
  ReflectionSummary,
  RestorePreview,
  RestoreOptions,
  RestoreResult,
  SelectiveRestoreResult,
  PruneResult,
  StorageStatus,
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
      maxSnapshots: Math.max(0, Math.floor(options.config?.maxSnapshots ?? 0)),
      maxStorageBytes: Math.max(0, Math.floor(options.config?.maxStorageBytes ?? 0)),
      shadowStore: options.config?.shadowStore ?? false,
      autoPrune: options.config?.autoPrune ?? false,
      workspaceLockTimeoutMs: Math.max(0, Math.floor(options.config?.workspaceLockTimeoutMs ?? 30000)),
      maxQuarantineBytes: Math.max(0, Math.floor(options.config?.maxQuarantineBytes ?? 0)),
      restorePlanTtlMs: Math.max(0, Math.floor(options.config?.restorePlanTtlMs ?? 900000)),
      maxSnapshotFileBytes: Math.max(0, Math.floor(options.config?.maxSnapshotFileBytes ?? 0)),
      maxSnapshotBytes: Math.max(0, Math.floor(options.config?.maxSnapshotBytes ?? 0)),
    };

    this.gitEngine = new GitPlumbingEngine({
      workDir: this.workDir,
      refPrefix: this.config.refPrefix,
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      quarantineDir: path.join(this.storageDir, 'ignored-quarantine'),
      shadowObjectDir: this.config.shadowStore ? path.join(this.storageDir, 'git-shadow', 'objects') : undefined,
      maxQuarantineBytes: this.config.maxQuarantineBytes,
      maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
      maxSnapshotBytes: this.config.maxSnapshotBytes,
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
      await this.enforceStorageQuota(dag);
    }
    const checkpointId = `chk_t${params.turnIndex}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const currentNode = dag.getCurrentNode();
    const parentCommitOid = currentNode ? currentNode.gitCommitOid : null;

    let treeOid = '';
    let commitOid = '';
    let changedFiles = [];
    let ignoredPaths: string[] = [];

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
  }): Promise<CheckpointNode> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const settled = await this.gitEngine.isGitRepo()
        ? await this.gitEngine.inspectWorkspace()
        : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      return dag.updateNode(params.checkpointId, {
        status: params.status,
        errorMessage: params.errorMessage,
        failedTools: params.failedTools,
        settledGitTreeOid: settled?.treeOid,
        settledIgnoredPaths: settled?.ignoredPaths,
      });
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
      await this.consumeRestorePlan(sessionId, checkpointId, options.restorePlanId, dag);
      const restored = await this.restoreWithRescue(dag, target, options);
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
      };
    });
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
            mode: options.mode ?? this.config.restoreMode,
            expectedCurrentTreeOid: rescue?.gitTreeOid ?? current?.gitTreeOid,
          });
        } else {
          await this.fallbackEngine.restoreSelectedPaths(target.sessionState.sessionId, target.id, paths, {
            mode: options.mode ?? this.config.restoreMode,
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
      const restored = await this.restoreWithRescue(dag, baseNode, params.restore ?? {}, 'fork');
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
    return [];
  }

  /**
   * Produce a read-only impact report before a rewind/fork. This deliberately
   * does not create a rescue point, mutate the DAG, or touch workspace files.
   */
  async previewRestore(sessionId: string, checkpointId: string): Promise<RestorePreview> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const current = dag.getCurrentNode();
      const isGit = await this.gitEngine.isGitRepo();
      if (isGit) await this.gitEngine.assertSupportedWorkspace();
      const currentState = isGit
        ? await this.gitEngine.inspectWorkspace()
        : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const controlPlane = isGit
        ? await this.gitEngine.inspectControlPlane()
        : { headOid: null, branch: '', operation: null };
      const targetIgnoredPaths = target.ignoredPaths ?? [];
      const diffs = isGit
        ? await this.gitEngine.getDiffBetween(currentState.treeOid, target.gitCommitOid)
        : target.changedFiles.map(change => ({
          file: change.path,
          status: change.status,
          diffText: 'Fallback snapshot: content diff is unavailable; file is included in the target snapshot.',
        }));
      const expectedTree = current?.settledGitTreeOid ?? current?.gitTreeOid;
      const expectedIgnored = current?.settledIgnoredPaths ?? current?.ignoredPaths ?? [];
      const driftDiffs = isGit && current && expectedTree && currentState.treeOid !== expectedTree
        ? await this.gitEngine.getDiffBetween(expectedTree, currentState.treeOid)
        : [];
      const conflictingPaths = [...new Set([
        ...driftDiffs.map(diff => diff.file),
        ...(!isGit && current && expectedTree && currentState.treeOid !== expectedTree ? ['(fallback workspace; content diff unavailable)'] : []),
        ...symmetricDifference(expectedIgnored, currentState.ignoredPaths).map(item => `(ignored) ${item}`),
      ])].sort();
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
      });
      return {
        sessionId,
        checkpointId,
        currentCheckpointId: current?.id ?? null,
        currentTreeOid: currentState.treeOid,
        targetTreeOid: target.gitTreeOid,
        currentIgnoredPaths: currentState.ignoredPaths,
        targetIgnoredPaths,
        ignoredPathsToDelete: currentState.ignoredPaths.filter(item => !targetIgnoredPaths.includes(item)),
        diffs,
        conflictingPaths,
        workspaceDrifted,
        requiresForce: workspaceDrifted,
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
  ): Promise<void> {
    if (!planId) return;
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
    const actual = await this.inspectWorkspaceSignature();
    if (actual.treeOid !== plan.currentTreeOid || !sameStrings(actual.ignoredPaths, plan.currentIgnoredPaths)) {
      throw new RestorePlanError('Workspace changed after preview; run preview again before restoring.');
    }
    const controlPlane = await this.inspectControlPlane();
    if (controlPlane.headOid !== plan.headOid || controlPlane.branch !== plan.branch || controlPlane.operation !== plan.operation) {
      throw new RestorePlanError('Git HEAD, branch, or in-progress operation changed after preview; run preview again.');
    }
  }

  private async inspectWorkspaceSignature(): Promise<{ treeOid: string; ignoredPaths: string[] }> {
    return await this.gitEngine.isGitRepo()
      ? await this.gitEngine.inspectWorkspace()
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
    const sessions = sessionId ? [sessionId] : await this.listStoredSessions();
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
    };
  }

  async prune(sessionId: string, options: { keepLatest?: number; olderThanMs?: number; abandonedBranches?: boolean; compactHistory?: boolean; repackShadowObjects?: boolean } = {}): Promise<PruneResult> {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const keepLatest = Math.max(0, Math.floor(options.keepLatest ?? 20));
      const nodes = Object.values(dag.tree.nodes).sort((left, right) => right.timestamp - left.timestamp);
      const keep = new Set(nodes.slice(0, keepLatest).map(node => node.id));
      const olderThanMs = options.olderThanMs !== undefined ? Math.max(0, Math.floor(options.olderThanMs)) : undefined;
      const cutoff = olderThanMs !== undefined && olderThanMs > 0 ? Date.now() - olderThanMs : undefined;
      let removed: CheckpointNode[] = [];
      if (options.abandonedBranches) {
        const abandonedBranches = Object.keys(dag.tree.branches).filter(branch => branch !== dag.tree.currentBranch);
        for (const branch of abandonedBranches) removed.push(...await dag.removeBranch(branch));
      }
      const candidates = Object.values(dag.tree.nodes).filter(node => !keep.has(node.id) && (cutoff === undefined || node.timestamp < cutoff));
      if (options.compactHistory) {
        removed.push(...await dag.compactNodes(candidates.map(node => node.id)));
      } else {
        removed.push(...await dag.removeLeafNodes(candidates.map(node => node.id)));
      }
      const reclaimed = await this.reclaimNodes(sessionId, removed);
      const shadowRepack = options.repackShadowObjects && this.config.shadowStore
        ? await this.gitEngine.repackShadowObjects()
        : undefined;
      return {
        sessionId,
        removedCheckpointIds: removed.map(node => node.id),
        reclaimedBytes: reclaimed.reclaimedBytes,
        gitRefsRemoved: reclaimed.gitRefsRemoved,
        quarantineReclaimedBytes: reclaimed.quarantineReclaimedBytes,
        shadowObjectsReclaimedBytes: shadowRepack?.reclaimedBytes,
        shadowRepackSkippedReason: shadowRepack?.skippedReason,
        note: reclaimed.gitRefsRemoved > 0
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

  private async listStoredSessions(): Promise<string[]> {
    const entries = await fs.readdir(this.storageDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
    const sessions = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('dag_') || !entry.name.endsWith('.json')) continue;
      try {
        const tree = JSON.parse(await fs.readFile(path.join(this.storageDir, entry.name), 'utf8')) as DAGTree;
        if (typeof tree.sessionId === 'string') sessions.add(tree.sessionId);
      } catch { /* status must remain best-effort for corrupt/partial storage */ }
    }
    return [...sessions];
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
  ): Promise<{ rescue?: CheckpointNode; deletedIgnoredPaths: string[]; journalId?: string }> {
    const current = dag.getCurrentNode() ?? undefined;
    const mode = options.mode ?? this.config.restoreMode;
    if (await this.gitEngine.isGitRepo()) await this.gitEngine.assertSupportedWorkspace();

    if (mode === 'safe' && current) {
      const actual = await this.gitEngine.isGitRepo()
        ? await this.gitEngine.inspectWorkspace()
        : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const expectedTree = current.settledGitTreeOid ?? current.gitTreeOid;
      const expectedIgnored = current.settledIgnoredPaths ?? current.ignoredPaths ?? [];
      if (actual.treeOid !== expectedTree || !sameStrings(actual.ignoredPaths, expectedIgnored)) {
        const { WorkspaceDriftError } = await import('./core/git-plumbing.js');
        const changed = actual.treeOid === expectedTree
          ? []
          : (await this.gitEngine.getDiffBetween(expectedTree, actual.treeOid)).map(item => item.file);
        const details = actual.treeOid === expectedTree
          ? ['workspace no longer matches the active checkpoint']
          : [`managed tree changed (expected ${expectedTree}, observed ${actual.treeOid})${changed.length ? `: ${changed.join(', ')}` : ''}`];
        if (!sameStrings(actual.ignoredPaths, expectedIgnored)) details.push('ignored path set changed');
        throw new WorkspaceDriftError(details);
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

    const expected = rescue ?? current;
    if (rescue && options.deleteNewIgnoredPaths) {
      rescue = await dag.updateNode(rescue.id, { ignoredBackupKey: rescue.id });
    }
    try {
      const result = await this.restoreNode(target, expected, {
        ...options,
        mode,
        ignoredBackupKey: rescue?.ignoredBackupKey,
      });
      await this.updateRestoreJournal(journalId, 'workspace-restored');
      return { rescue, deletedIgnoredPaths: result.deletedIgnoredPaths, journalId };
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
      const result = await this.gitEngine.restoreSnapshot(target.gitCommitOid, {
        mode: options.mode,
        expectedCurrentTreeOid: expected?.gitTreeOid,
        expectedCurrentIgnoredPaths: expected?.ignoredPaths ?? [],
        targetIgnoredPaths: target.ignoredPaths ?? [],
        deleteNewIgnoredPaths: options.deleteNewIgnoredPaths,
        ignoredBackupKey: options.ignoredBackupKey,
      });
      if (target.ignoredBackupKey) await this.gitEngine.restoreIgnoredBackup(target.ignoredBackupKey);
      const verified = await this.gitEngine.inspectWorkspace();
      if (verified.treeOid !== target.gitTreeOid || !sameStrings(verified.ignoredPaths, target.ignoredPaths ?? [])) {
        throw new Error(`Workspace integrity check failed after restoring checkpoint '${target.id}'.`);
      }
      return result;
    }
    await this.fallbackEngine.restoreSnapshot(target.sessionState.sessionId, target.id);
    const verified = await this.fallbackEngine.inspectWorkspace();
    if (verified !== target.gitTreeOid) {
      throw new Error(`Fallback workspace integrity check failed after restoring checkpoint '${target.id}'.`);
    }
    return { deletedIgnoredPaths: [] };
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
