import { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';

interface SessionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: unknown;
    name?: string;
    tool_call_id?: string;
    tool_calls?: any[];
    [key: string]: any;
}
interface SessionState {
    sessionId: string;
    messages: SessionMessage[];
    variables?: Record<string, any>;
    tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    contextWindowSize?: number;
    /** Inclusive DSH event boundary used to fork a coherent conversation. */
    boundarySeq?: number;
}
interface FileChange {
    path: string;
    status: 'added' | 'modified' | 'deleted';
    stagedLinesAdded?: number;
    stagedLinesDeleted?: number;
}
interface CheckpointNode {
    id: string;
    parentId: string | null;
    branch: string;
    turnIndex: number;
    timestamp: number;
    prompt: string;
    summary: string;
    gitTreeOid: string;
    gitCommitOid: string;
    sessionState: SessionState;
    changedFiles: FileChange[];
    status: 'running' | 'success' | 'failed' | 'aborted';
    errorMessage?: string;
    failedTools?: Array<{
        toolName: string;
        input: any;
        error: string;
    }>;
    tags?: string[];
    /** Ignored paths are names only; their contents are never written to Git objects. */
    ignoredPaths?: string[];
    /** Workspace signature observed when the anchored turn finished. */
    settledGitTreeOid?: string;
    settledIgnoredPaths?: string[];
    /** Local quarantine containing ignored files removed by an explicit restore. */
    ignoredBackupKey?: string;
}
interface DAGTree {
    sessionId: string;
    currentBranch: string;
    currentCheckpointId: string | null;
    nodes: Record<string, CheckpointNode>;
    branches: Record<string, {
        name: string;
        headId: string;
        forkedFromId: string | null;
        createdAt: number;
        description?: string;
    }>;
}
interface TimeMachineConfig {
    autoSnapshot?: boolean;
    enableReflectionAdvisor?: boolean;
    refPrefix?: string;
    storageDir?: string;
    webPort?: number;
    enableWebUI?: boolean;
    /** Refuse to overwrite changes made after the latest checkpoint unless forced. */
    restoreMode?: 'safe' | 'force';
    /** Ignored paths that are never scanned or removed by restore. */
    preservePaths?: string[];
    /** Address for the standalone dashboard. Defaults to loopback only. */
    webHost?: string;
    /** Hard per-session checkpoint limit; 0 disables the guard. */
    maxSnapshots?: number;
    /** Hard plugin-storage byte limit; 0 disables the guard. */
    maxStorageBytes?: number;
}
interface RestoreOptions {
    mode?: 'safe' | 'force';
    /** Delete ignored paths created after the target checkpoint. Off by default. */
    deleteNewIgnoredPaths?: boolean;
    /** Internal compensation restores do not create another rescue point. */
    createRescuePoint?: boolean;
    /** Internal key used to quarantine ignored paths before deletion. */
    ignoredBackupKey?: string;
}
interface RestoreResult {
    targetNode: CheckpointNode;
    restoredSessionState: SessionState;
    rescueCheckpointId?: string;
    deletedIgnoredPaths: string[];
    restoreJournalId?: string;
}
interface DiffResult {
    file: string;
    status: 'added' | 'modified' | 'deleted';
    diffText: string;
}
/** Read-only impact report for a prospective rewind/fork. */
interface RestorePreview {
    sessionId: string;
    checkpointId: string;
    currentCheckpointId: string | null;
    currentTreeOid: string;
    targetTreeOid: string;
    currentIgnoredPaths: string[];
    targetIgnoredPaths: string[];
    ignoredPathsToDelete: string[];
    diffs: DiffResult[];
    workspaceDrifted: boolean;
    requiresForce: boolean;
}
interface SelectiveRestoreResult {
    checkpointId: string;
    restoredPaths: string[];
    rescueCheckpointId?: string;
    resultCheckpointId?: string;
    restoreJournalId?: string;
}
interface StorageStatus {
    storageDir: string;
    bytes: number;
    files: number;
    sessions: number;
    checkpoints: number;
    pruneCandidates: number;
    gitObjectsShared: boolean;
}
interface PruneResult {
    sessionId: string;
    removedCheckpointIds: string[];
    reclaimedBytes: number;
    gitRefsRemoved: number;
    note: string;
}
interface ReflectionSummary {
    hasPastFailures: boolean;
    failedNodeCount: number;
    summaryNote: string;
    suggestedPromptPrefix: string;
}

interface DAGManagerOptions {
    sessionId: string;
    storageDir: string;
    initialBranch?: string;
}
declare class DAGStateManager {
    tree: DAGTree;
    private readonly storageFile;
    constructor(options: DAGManagerOptions);
    /**
     * 初始化并尝试从本地恢复树结构
     */
    init(): Promise<void>;
    /**
     * 持久化当前 DAG 树到本地 JSON
     */
    persist(): Promise<void>;
    /**
     * 添加一个新快照节点并推进当前分支 HEAD
     */
    addNode(node: CheckpointNode): Promise<void>;
    /**
     * 获取当前活动的快照节点
     */
    getCurrentNode(): CheckpointNode | null;
    /**
     * 获取指定 ID 的节点
     */
    getNode(checkpointId: string): CheckpointNode | null;
    updateNode(checkpointId: string, patch: Partial<Pick<CheckpointNode, 'status' | 'errorMessage' | 'failedTools' | 'summary' | 'settledGitTreeOid' | 'settledIgnoredPaths' | 'ignoredBackupKey'>>): Promise<CheckpointNode>;
    /** Remove only leaf checkpoints that are not current or a branch head. */
    removeLeafNodes(checkpointIds: string[]): Promise<CheckpointNode[]>;
    /** Explicitly remove a non-current exploration branch and its private nodes. */
    removeBranch(branchName: string): Promise<CheckpointNode[]>;
    /**
     * 回滚当前指针到指定历史节点（保持在当前分支）
     */
    rewindTo(checkpointId: string): Promise<CheckpointNode>;
    /**
     * 核心功能：从任意历史节点 Fork 出一个新的平行探索分支
     */
    forkBranch(checkpointId: string, newBranchName: string, description?: string): Promise<CheckpointNode>;
    validateFork(checkpointId: string, newBranchName: string): CheckpointNode;
    /**
     * 切换当前活动分支
     */
    switchBranch(branchName: string): Promise<CheckpointNode>;
    /**
     * 获取从根节点到指定节点的分支线性链路
     */
    getLineage(checkpointId: string): CheckpointNode[];
    /**
     * 获取在指定分叉点后，其他分支中失败或被放弃的节点（供反思分析）
     */
    getAbandonedSubtrees(forkPointId: string, currentActiveBranch: string): CheckpointNode[];
    private collectSubtree;
    /**
     * 渲染用于终端 `/tree` 命令展示的彩色 ASCII/Unicode 拓扑图
     */
    renderAsciiTree(): string;
    private assertTree;
    private commitMutation;
}

interface TimeMachineServiceOptions {
    workDir: string;
    storageDir?: string;
    config?: TimeMachineConfig;
}
declare class StorageQuotaError extends Error {
    readonly code = "STORAGE_QUOTA_EXCEEDED";
    constructor(message: string);
}
declare class TimeMachineService {
    readonly workDir: string;
    readonly storageDir: string;
    readonly config: Required<TimeMachineConfig>;
    private gitEngine;
    private fallbackEngine;
    private dagManagers;
    private recoveredSessions;
    private advisor;
    private operations;
    private readonly journalDir;
    constructor(options: TimeMachineServiceOptions);
    /**
     * 获取或初始化指定会话的 DAG 管理器
     */
    getDAGManager(sessionId: string): Promise<DAGStateManager>;
    /**
     * 核心：创建原子双轨快照（状态轨 + 工作区轨）
     */
    createTurnCheckpoint(params: {
        sessionId: string;
        turnIndex: number;
        prompt: string;
        summary?: string;
        sessionState: SessionState;
        status?: 'running' | 'success' | 'failed' | 'aborted';
        errorMessage?: string;
        failedTools?: Array<{
            toolName: string;
            input: any;
            error: string;
        }>;
        tags?: string[];
    }): Promise<CheckpointNode>;
    private createTurnCheckpointUnlocked;
    finalizeTurnCheckpoint(params: {
        sessionId: string;
        checkpointId: string;
        status: 'success' | 'failed' | 'aborted';
        errorMessage?: string;
        failedTools?: Array<{
            toolName: string;
            input: any;
            error: string;
        }>;
    }): Promise<CheckpointNode>;
    /**
     * 核心：回滚物理工作区与会话状态至指定快照
     */
    rewindToCheckpoint(sessionId: string, checkpointId: string, options?: RestoreOptions): Promise<RestoreResult>;
    /** Restore selected workspace paths without changing the DSH conversation. */
    restoreSelectedPaths(sessionId: string, checkpointId: string, paths: string[], options?: Pick<RestoreOptions, 'mode'>): Promise<SelectiveRestoreResult>;
    /**
     * 核心：从历史任意快照点 Fork 开辟新的平行探索分支
     */
    forkNewBranch(params: {
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
    }>;
    /**
     * 获取指定快照与当前（或另一快照）的代码差异
     */
    getDiff(sessionId: string, baseId: string, targetId: string): Promise<DiffResult[]>;
    /**
     * Produce a read-only impact report before a rewind/fork. This deliberately
     * does not create a rescue point, mutate the DAG, or touch workspace files.
     */
    previewRestore(sessionId: string, checkpointId: string): Promise<RestorePreview>;
    /**
     * 打印终端彩色 ASCII 拓扑树
     */
    renderTree(sessionId: string): Promise<string>;
    getStorageStatus(sessionId?: string): Promise<StorageStatus>;
    prune(sessionId: string, options?: {
        keepLatest?: number;
        abandonedBranches?: boolean;
    }): Promise<PruneResult>;
    private pruneCandidates;
    private listStoredSessions;
    private enforceStorageQuota;
    private restoreWithRescue;
    private restoreNode;
    completeRestoreJournal(journalId?: string): Promise<void>;
    private createRestoreJournal;
    private updateRestoreJournal;
    private recoverInterruptedRestores;
}

interface GitPlumbingOptions {
    workDir: string;
    refPrefix?: string;
    preservePaths?: string[];
    quarantineDir?: string;
}
interface GitSnapshot {
    treeOid: string;
    commitOid: string;
    changedFiles: FileChange[];
    ignoredPaths: string[];
}
interface GitRestoreOptions {
    expectedCurrentTreeOid?: string;
    expectedCurrentIgnoredPaths?: string[];
    targetIgnoredPaths?: string[];
    mode?: 'safe' | 'force';
    deleteNewIgnoredPaths?: boolean;
    ignoredBackupKey?: string;
}
interface GitSelectiveRestoreOptions {
    expectedCurrentTreeOid?: string;
    mode?: 'safe' | 'force';
}
declare class WorkspaceDriftError extends Error {
    readonly details: string[];
    readonly code = "WORKSPACE_DRIFT";
    constructor(details: string[]);
}
declare class WorkspaceRestoreConflictError extends Error {
    readonly paths: string[];
    readonly code = "RESTORE_CONFLICT";
    constructor(paths: string[]);
}
declare class GitPlumbingEngine {
    readonly workDir: string;
    readonly refPrefix: string;
    private readonly preservePaths;
    private readonly quarantineDir?;
    private isRepoCached;
    private repoRootCached;
    private gitDirCached;
    constructor(options: GitPlumbingOptions);
    isGitRepo(): Promise<boolean>;
    getRepoRoot(): Promise<string>;
    getGitDir(): Promise<string>;
    runGit(args: string[], extraEnv?: Record<string, string>, cwd?: string): Promise<{
        stdout: string;
        stderr: string;
    }>;
    createSnapshot(params: {
        sessionId: string;
        checkpointId: string;
        parentCommitOid?: string | null;
        message?: string;
    }): Promise<GitSnapshot>;
    /** Compute the current managed tree without publishing a commit or ref. */
    inspectWorkspace(): Promise<{
        treeOid: string;
        ignoredPaths: string[];
    }>;
    /** Restore with an isolated index so the user's staged changes are never rewritten. */
    restoreSnapshot(commitOrTreeOid: string, options?: GitRestoreOptions): Promise<{
        deletedIgnoredPaths: string[];
    }>;
    /** Restore only selected tracked workspace paths using a disposable index. */
    restoreSelectedPaths(commitOrTreeOid: string, paths: string[], options?: GitSelectiveRestoreOptions): Promise<string[]>;
    /** Restore quarantined ignored content without ever writing it into Git objects. */
    restoreIgnoredBackup(key: string): Promise<void>;
    getDiffBetween(baseOid: string, targetOid: string): Promise<DiffResult[]>;
    private writeWorkspaceTree;
    private listIgnoredPaths;
    private listTreeFiles;
    private listTreeFileNames;
    private computeChangedFiles;
    private diffNameOnly;
    private protectedRepoPaths;
    private isPreservedRelative;
    private safeWorkspacePath;
    private backupIgnoredPath;
    private parseUnifiedDiff;
    cleanupSession(sessionId: string): Promise<void>;
    deleteCheckpointRef(sessionId: string, checkpointId: string): Promise<boolean>;
}

interface FallbackOptions {
    workDir: string;
    storageDir: string;
    preservePaths?: string[];
}
/** Exact-copy fallback for ordinary directories, including deletions and symlinks. */
declare class FallbackSnapshotEngine {
    readonly workDir: string;
    readonly storageDir: string;
    private readonly preservePaths;
    constructor(options: FallbackOptions);
    private getCheckpointDir;
    createSnapshot(params: {
        sessionId: string;
        checkpointId: string;
    }): Promise<{
        treeOid: string;
        commitOid: string;
        changedFiles: FileChange[];
    }>;
    inspectWorkspace(): Promise<string>;
    restoreSnapshot(sessionId: string, checkpointId: string): Promise<void>;
    restoreSelectedPaths(sessionId: string, checkpointId: string, paths: string[], options?: {
        expectedCurrentTreeOid?: string;
        mode?: 'safe' | 'force';
    }): Promise<string[]>;
    removeSnapshot(sessionId: string, checkpointId: string): Promise<number>;
    private captureTree;
    private scanTree;
    private isPreserved;
    private resolveSafe;
}

declare class ReflectionAdvisor {
    /**
     * 分析已放弃或失败的分支节点，提炼结构化反思提示词
     */
    generateReflectionNote(abandonedNodes: CheckpointNode[]): ReflectionSummary;
}

declare const name = "dsh-plugin-time-machine";
interface Config extends TimeMachineConfig {
}
declare const Config: Schema<Config>;
interface SessionEventLike {
    readonly type: string;
    readonly seq: number;
    readonly data: Record<string, unknown>;
}
interface SessionLike {
    readonly id: string;
    readonly header: {
        readonly cwd?: string;
    };
    readonly events?: readonly SessionEventLike[];
    snapshotEvents?(): readonly SessionEventLike[];
    deriveMessages?(): readonly unknown[];
}
interface AgentLike {
    readonly session: SessionLike;
}
interface SessionControllerLike {
    create(request: {
        readonly cwd?: string;
    }): Promise<{
        readonly sessionId: string;
    }>;
    fork(request: {
        readonly sessionId: string;
        readonly atSeq?: number;
    }): Promise<{
        readonly sessionId: string;
    }>;
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
        'agent/pre-step'(payload: {
            readonly agent: AgentLike;
            readonly turn: number;
            readonly step: number;
            readonly signal: AbortSignal;
        }, next: () => Promise<unknown>): Promise<unknown>;
        'session/event'(session: SessionLike, event: SessionEventLike): void;
    }
}
declare function apply(ctx: Context, config?: Config): void;
/** Extract model-visible tool failures from DSH's durable event pair. */
declare function collectFailedTools(events: readonly SessionEventLike[], turn: number): Array<{
    toolName: string;
    input: unknown;
    error: string;
}>;
/** Cordis loads profile-bundle defaults as constructable plugins. */
declare class TimeMachinePlugin {
    constructor(ctx: Context, config?: Config);
}

export { type CheckpointNode, Config, type DAGManagerOptions, DAGStateManager, type DAGTree, type DiffResult, type FallbackOptions, FallbackSnapshotEngine, type FileChange, GitPlumbingEngine, type GitPlumbingOptions, type GitRestoreOptions, type GitSelectiveRestoreOptions, type GitSnapshot, type PruneResult, ReflectionAdvisor, type ReflectionSummary, type RestoreOptions, type RestorePreview, type RestoreResult, type SelectiveRestoreResult, type SessionMessage, type SessionState, StorageQuotaError, type StorageStatus, type TimeMachineConfig, TimeMachinePlugin, TimeMachineService, type TimeMachineServiceOptions, WorkspaceDriftError, WorkspaceRestoreConflictError, apply, collectFailedTools, TimeMachinePlugin as default, name };
