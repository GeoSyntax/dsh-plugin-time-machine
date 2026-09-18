import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GitPlumbingEngine } from './core/git-plumbing.js';
import { FallbackSnapshotEngine } from './core/fallback-engine.js';
import { DAGStateManager } from './core/dag-manager.js';
import { ReflectionAdvisor } from './core/reflection-advisor.js';
import { KeyedOperationLock } from './core/operation-lock.js';
import type {
  CheckpointNode,
  DAGTree,
  DiffResult,
  ReflectionSummary,
  RestoreOptions,
  RestoreResult,
  SessionState,
  TimeMachineConfig,
} from './types.js';

export interface TimeMachineServiceOptions {
  workDir: string;
  storageDir?: string;
  config?: TimeMachineConfig;
}

export class TimeMachineService {
  public readonly workDir: string;
  public readonly storageDir: string;
  public readonly config: Required<TimeMachineConfig>;

  private gitEngine: GitPlumbingEngine;
  private fallbackEngine: FallbackSnapshotEngine;
  private dagManagers = new Map<string, DAGStateManager>();
  private advisor = new ReflectionAdvisor();
  private operations = new KeyedOperationLock();

  constructor(options: TimeMachineServiceOptions) {
    this.workDir = path.resolve(options.workDir);
    this.storageDir = options.storageDir
      ? path.resolve(options.storageDir)
      : path.join(this.workDir, '.dsh', 'time-machine');

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
    };

    this.gitEngine = new GitPlumbingEngine({
      workDir: this.workDir,
      refPrefix: this.config.refPrefix,
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      quarantineDir: path.join(this.storageDir, 'ignored-quarantine'),
    });

    this.fallbackEngine = new FallbackSnapshotEngine({
      workDir: this.workDir,
      storageDir: path.join(this.storageDir, 'fallback_backups'),
      preservePaths: [this.storageDir, ...this.config.preservePaths],
    });
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
    return this.operations.run(this.workDir, () => this.createTurnCheckpointUnlocked(params));
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
    return this.operations.run(this.workDir, async () => {
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
    return this.operations.run(this.workDir, async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
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
      return {
        targetNode: cloneJson(target),
        restoredSessionState: cloneJson(target.sessionState),
        rescueCheckpointId: restored.rescue?.id,
        deletedIgnoredPaths: restored.deletedIgnoredPaths,
      };
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
  }> {
    return this.operations.run(this.workDir, async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const baseNode = dag.validateFork(params.fromCheckpointId, params.newBranchName);
      const restored = await this.restoreWithRescue(dag, baseNode, params.restore ?? {});
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
        reflectionAdvisory = this.advisor.generateReflectionNote(abandonedNodes);
      }

      return {
        forkedNode: cloneJson(forkedNode),
        restoredSessionState: cloneJson(forkedNode.sessionState),
        reflectionAdvisory,
        rescueCheckpointId: restored.rescue?.id,
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
   * 打印终端彩色 ASCII 拓扑树
   */
  async renderTree(sessionId: string): Promise<string> {
    const dag = await this.getDAGManager(sessionId);
    return dag.renderAsciiTree();
  }

  private async restoreWithRescue(
    dag: DAGStateManager,
    target: CheckpointNode,
    options: RestoreOptions,
  ): Promise<{ rescue?: CheckpointNode; deletedIgnoredPaths: string[] }> {
    const current = dag.getCurrentNode() ?? undefined;
    const mode = options.mode ?? this.config.restoreMode;

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
      return { rescue, deletedIgnoredPaths: result.deletedIgnoredPaths };
    } catch (error) {
      if (rescue) {
        try {
          await this.restoreNode(rescue, undefined, { mode: 'force', createRescuePoint: false });
          await dag.rewindTo(rescue.id);
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
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
