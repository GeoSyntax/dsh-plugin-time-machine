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
/**
 * A declaration from an integration that changed state outside the workspace.
 * Time Machine records it for audit/reflection; it never runs compensation
 * implicitly because the adapter owns the external system's semantics.
 */
interface ExternalEffectRecord {
    id: string;
    adapter: string;
    operation: string;
    reversible: boolean;
    compensation?: string;
    failureSemantics: string;
    status: 'unresolved' | 'compensated' | 'unknown';
    recordedAt: number;
    /** Last explicit compensation idempotency key, if an adapter was invoked. */
    compensationIdempotencyKey?: string;
    compensationAttemptedAt?: number;
}
interface ExternalEffectCompensationContext {
    sessionId: string;
    checkpointId: string;
    effect: ExternalEffectRecord;
    idempotencyKey: string;
}
interface ExternalEffectAdapter {
    name: string;
    compensate(context: ExternalEffectCompensationContext): Promise<{
        status: 'compensated' | 'unknown';
        note?: string;
    }>;
}
interface ExternalEffectCompensationResult {
    sessionId: string;
    checkpointId: string;
    effect: ExternalEffectRecord;
    adapter: string;
    /** Whether the named adapter is currently registered in this process. */
    adapterAvailable: boolean;
    dryRun: boolean;
    idempotencyKey: string;
    replayed: boolean;
    note?: string;
}
/** A successful Agent-side write observed by an integration. */
interface AgentWriteRecord {
    path: string;
    sha256: string;
    recordedAt: number;
    operation?: 'create' | 'modify' | 'delete';
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
    /** Files deliberately omitted by an opt-in partial snapshot. */
    omittedPaths?: string[];
    /** External mutations declared by integrations; never compensated implicitly. */
    externalEffects?: ExternalEffectRecord[];
    /** Explicit Agent-write evidence used by opt-in hand-edit preservation. */
    agentWrites?: AgentWriteRecord[];
    /** Git changes observed at turn finalization that lack Agent-write evidence. */
    unattributedChanges?: FileChange[];
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
    restoreMode?: 'safe' | 'merge' | 'force';
    /** Ignored paths that are never scanned or removed by restore. */
    preservePaths?: string[];
    /** Address for the standalone dashboard. Defaults to loopback only. */
    webHost?: string;
    /** Hard per-session checkpoint limit; 0 disables the guard. */
    maxSnapshots?: number;
    /** Hard plugin-storage byte limit; 0 disables the guard. */
    maxStorageBytes?: number;
    /** Store plugin-created Git objects outside the user's normal object directory. */
    shadowStore?: boolean;
    /** Allow quota-triggered compaction before ordinary checkpoints; disabled by default. */
    autoPrune?: boolean;
    /** Automatically compact checkpoints older than this age before ordinary checkpoints; 0 disables it. */
    retentionMaxAgeMs?: number;
    /** Maximum time to wait for another process to finish a workspace operation. */
    workspaceLockTimeoutMs?: number;
    /** Hard limit for ignored-file quarantine bytes; 0 disables the guard. */
    maxQuarantineBytes?: number;
    /** Optional environment variable containing a key used to encrypt quarantine backups. */
    quarantineEncryptionKeyEnv?: string;
    /** Lifetime of a preview restore plan. Set to 0 to disable plan expiry. */
    restorePlanTtlMs?: number;
    /** Maximum size of one captured regular file; 0 disables the guard. */
    maxSnapshotFileBytes?: number;
    /** Maximum aggregate regular-file bytes in one checkpoint; 0 disables the guard. */
    maxSnapshotBytes?: number;
    /** Opt in to omitting files that exceed snapshot limits; disabled by default. */
    allowPartialSnapshots?: boolean;
    /** Record integration-supplied Agent writes for explicit hand-edit preservation. */
    enableAgentWriteLedger?: boolean;
    /** Create a workspace checkpoint immediately before high-risk external tools. */
    autoPreCommandSnapshot?: boolean;
    /** Tool names treated as high-risk when autoPreCommandSnapshot is enabled. */
    preCommandTools?: string[];
    /** Maximum pre-command checkpoints per session turn; 0 means unlimited. */
    preCommandMaxPerTurn?: number;
}
interface RestoreOptions {
    mode?: 'safe' | 'merge' | 'force';
    /** Delete ignored paths created after the target checkpoint. Off by default. */
    deleteNewIgnoredPaths?: boolean;
    /** Internal compensation restores do not create another rescue point. */
    createRescuePoint?: boolean;
    /** Internal key used to quarantine ignored paths before deletion. */
    ignoredBackupKey?: string;
    /** Session-bound token returned by previewRestore; consumed by the next restore. */
    restorePlanId?: string;
    /** Preserve paths whose current content differs from the recorded Agent hash. */
    preserveVerifiedHandEdits?: boolean;
    /** Internal path list calculated from the active Agent-write ledger. */
    preservePaths?: string[];
}
interface RestoreResult {
    targetNode: CheckpointNode;
    restoredSessionState: SessionState;
    rescueCheckpointId?: string;
    deletedIgnoredPaths: string[];
    restoreJournalId?: string;
    /** Paths preserved because verified Agent-write hashes no longer matched. */
    preservedHandEditPaths?: string[];
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
    targetOmittedPaths?: string[];
    ignoredPathsToDelete: string[];
    diffs: DiffResult[];
    /** Paths changed after the active checkpoint that make safe restore refuse overwrite. */
    conflictingPaths: string[];
    workspaceDrifted: boolean;
    requiresForce: boolean;
    /** Short-lived session-bound plan used to bind a reviewed preview to mutation. */
    restorePlanId: string;
    restorePlanExpiresAt: number | null;
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
    /** Shadow Git objects are currently plaintext at rest; quarantine may differ. */
    gitObjectsEncrypted: boolean;
    quarantineEncrypted: boolean;
}
interface PruneResult {
    sessionId: string;
    removedCheckpointIds: string[];
    reclaimedBytes: number;
    gitRefsRemoved: number;
    quarantineReclaimedBytes?: number;
    shadowObjectsReclaimedBytes?: number;
    shadowRepackSkippedReason?: string;
    note: string;
}
interface ReflectionSummary {
    hasPastFailures: boolean;
    failedNodeCount: number;
    summaryNote: string;
    suggestedPromptPrefix: string;
    hasExternalEffects?: boolean;
    externalEffectCount?: number;
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
    updateNode(checkpointId: string, patch: Partial<Pick<CheckpointNode, 'status' | 'errorMessage' | 'failedTools' | 'summary' | 'settledGitTreeOid' | 'settledIgnoredPaths' | 'ignoredBackupKey' | 'externalEffects' | 'agentWrites' | 'unattributedChanges'>>): Promise<CheckpointNode>;
    /** Remove only leaf checkpoints that are not current or a branch head. */
    removeLeafNodes(checkpointIds: string[]): Promise<CheckpointNode[]>;
    /** Remove historical nodes while reparenting surviving children to the nearest ancestor. */
    compactNodes(checkpointIds: string[]): Promise<CheckpointNode[]>;
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
declare class RestorePlanError extends Error {
    readonly code = "RESTORE_PLAN_INVALID";
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
    private workspaceLock;
    private readonly journalDir;
    private restorePlans;
    private externalEffectAdapters;
    constructor(options: TimeMachineServiceOptions);
    private runWorkspaceOperation;
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
     * Record a successful Agent write. This is deliberately an integration API:
     * the core never guesses authorship from a tool name or file timestamp.
     */
    recordAgentWrite(sessionId: string, checkpointId: string, write: Omit<AgentWriteRecord, 'recordedAt' | 'sha256'> & {
        sha256?: string;
    }): Promise<CheckpointNode>;
    getAgentWriteLedger(sessionId: string, checkpointId: string): Promise<AgentWriteRecord[]>;
    getUnattributedChanges(sessionId: string, checkpointId: string): Promise<FileChange[]>;
    /**
     * Record an external mutation against a checkpoint. The core deliberately
     * does not execute compensation; an adapter can later use this declaration
     * to perform an explicit, user-approved reversal.
     */
    recordExternalEffect(sessionId: string, checkpointId: string, effect: Omit<ExternalEffectRecord, 'id' | 'recordedAt'> & {
        id?: string;
    }): Promise<CheckpointNode>;
    /**
     * Register an explicit compensation adapter. Adapters own authentication,
     * remote API semantics, and idempotency; the core only coordinates the
     * durable declaration and requires an explicit execute request.
     */
    registerExternalEffectAdapter(adapter: ExternalEffectAdapter): () => void;
    listExternalEffectAdapters(): string[];
    /**
     * Perform one adapter compensation only when the caller explicitly opts in.
     * A deterministic idempotency key is used when none is supplied, and a
     * different key cannot be used after an attempt has been recorded.
     */
    compensateExternalEffect(sessionId: string, checkpointId: string, effectId: string, options?: {
        execute?: boolean;
        idempotencyKey?: string;
    }): Promise<ExternalEffectCompensationResult>;
    /** Explicitly migrate a legacy plaintext ignored-file quarantine to AES-GCM. */
    migrateIgnoredBackup(key: string): Promise<{
        migrated: boolean;
        bytesRewritten: number;
        entryCount: number;
    }>;
    /**
     * 核心：回滚物理工作区与会话状态至指定快照
     */
    rewindToCheckpoint(sessionId: string, checkpointId: string, options?: RestoreOptions): Promise<RestoreResult>;
    /** Restore selected workspace paths without changing the DSH conversation. */
    restoreSelectedPaths(sessionId: string, checkpointId: string, paths: string[], options?: Pick<RestoreOptions, 'mode' | 'restorePlanId'>): Promise<SelectiveRestoreResult>;
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
    private expireRestorePlans;
    /** Consume a preview token and fail closed if the reviewed workspace changed. */
    private consumeRestorePlan;
    private inspectWorkspaceSignature;
    private inspectControlPlane;
    /**
     * 打印终端彩色 ASCII 拓扑树
     */
    renderTree(sessionId: string): Promise<string>;
    getStorageStatus(sessionId?: string): Promise<StorageStatus>;
    /** Report runtime capabilities so Web/CLI integrations can fail early. */
    getCapabilities(): Promise<{
        version: 1;
        git: boolean;
        fallback: boolean;
        mergeRestore: boolean;
        selectiveRestore: boolean;
        shadowStore: boolean;
        shadowStoreEncryption: false;
        quarantineEncryption: boolean;
        quarantineMigration: boolean;
        partialSnapshots: boolean;
        /** Safe dirty-path overlay is available for normal Git workspaces. */
        incrementalCapture: boolean;
        /** Current restore semantics; ledger mode is explicit and opt-in. */
        handEditPolicy: 'reject-drift' | 'ledger-opt-in';
        agentWriteLedger: boolean;
        preCommandSnapshots: boolean;
        preCommandTools: string[];
        preCommandMaxPerTurn: number;
        unattributedMutationInventory: boolean;
        externalEffectLedger: true;
        externalEffectAdapters: string[];
        workspaceIsolation: 'shared-lock';
        workspace: {
            sparseCheckout: boolean;
            submodulePaths: string[];
            inProgressOperation: string | null;
        };
        policies: {
            restoreMode: 'safe' | 'merge' | 'force';
            maxSnapshots: number;
            maxStorageBytes: number;
            retentionMaxAgeMs: number;
            maxSnapshotFileBytes: number;
            maxSnapshotBytes: number;
            allowPartialSnapshots: boolean;
            enableAgentWriteLedger: boolean;
            autoPreCommandSnapshot: boolean;
            preCommandTools: string[];
            preCommandMaxPerTurn: number;
            maxQuarantineBytes: number;
            workspaceLockTimeoutMs: number;
        };
    }>;
    prune(sessionId: string, options?: {
        keepLatest?: number;
        olderThanMs?: number;
        abandonedBranches?: boolean;
        compactHistory?: boolean;
        repackShadowObjects?: boolean;
    }): Promise<PruneResult>;
    private autoPruneForQuota;
    private autoPruneForAge;
    private reclaimNodes;
    private referencedIgnoredBackupKeys;
    private pruneCandidates;
    private listStoredSessions;
    private enforceStorageQuota;
    private restoreWithRescue;
    private restoreNode;
    private findVerifiedHandEdits;
    private hashWorkspacePath;
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
    /** Optional object directory for plugin-created objects. */
    shadowObjectDir?: string;
    /** Hard limit for ignored-file quarantine bytes; 0 disables the guard. */
    maxQuarantineBytes?: number;
    /** Optional operator-provided key for encrypting ignored-file quarantine backups. */
    quarantineEncryptionKey?: string;
    /** Maximum size of one captured regular file; 0 disables the guard. */
    maxSnapshotFileBytes?: number;
    /** Maximum aggregate regular-file bytes in one checkpoint; 0 disables the guard. */
    maxSnapshotBytes?: number;
    /** Opt in to omitting files that exceed snapshot limits. */
    allowPartialSnapshots?: boolean;
}
interface GitSnapshot {
    treeOid: string;
    commitOid: string;
    changedFiles: FileChange[];
    ignoredPaths: string[];
    omittedPaths: string[];
}
interface WorkspaceCapabilities {
    sparseCheckout: boolean;
    submodulePaths: string[];
    inProgressOperation: string | null;
}
interface ShadowGcResult {
    removedObjects: number;
    reclaimedBytes: number;
    packedObjectsSkipped: boolean;
}
interface ShadowRepackResult {
    repacked: boolean;
    removedPackFiles: number;
    reclaimedBytes: number;
    reachableRefs: number;
    skippedReason?: string;
}
interface QuarantineMigrationResult {
    migrated: boolean;
    bytesRewritten: number;
    entryCount: number;
}
interface GitRestoreOptions {
    expectedCurrentTreeOid?: string;
    expectedCurrentIgnoredPaths?: string[];
    targetIgnoredPaths?: string[];
    mode?: 'safe' | 'merge' | 'force';
    deleteNewIgnoredPaths?: boolean;
    ignoredBackupKey?: string;
    /** Paths omitted from the target snapshot; preserve their live content. */
    omittedPaths?: string[];
    /** Live paths to preserve after restore because verified hand-edits differ. */
    preservePaths?: string[];
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
declare class UnsupportedWorkspaceStateError extends Error {
    readonly capabilities: WorkspaceCapabilities;
    readonly code = "UNSUPPORTED_WORKSPACE_STATE";
    constructor(capabilities: WorkspaceCapabilities);
}
declare class WorkspaceRestoreConflictError extends Error {
    readonly paths: string[];
    readonly code = "RESTORE_CONFLICT";
    constructor(paths: string[]);
}
declare class WorkspaceMergeConflictError extends Error {
    readonly paths: string[];
    readonly code = "RESTORE_MERGE_CONFLICT";
    constructor(paths: string[]);
}
declare class QuarantineQuotaError extends Error {
    readonly limitBytes: number;
    readonly requiredBytes: number;
    readonly code = "QUARANTINE_QUOTA_EXCEEDED";
    constructor(limitBytes: number, requiredBytes: number);
}
declare class QuarantineKeyError extends Error {
    readonly code = "QUARANTINE_KEY_INVALID";
    constructor(message: string);
}
declare class SnapshotSizeError extends Error {
    readonly details: {
        file?: string;
        fileBytes?: number;
        totalBytes?: number;
        limitBytes: number;
    };
    readonly code = "SNAPSHOT_SIZE_LIMIT";
    constructor(details: {
        file?: string;
        fileBytes?: number;
        totalBytes?: number;
        limitBytes: number;
    });
}
declare class GitPlumbingEngine {
    readonly workDir: string;
    readonly refPrefix: string;
    private preservePaths;
    private readonly quarantineDir?;
    private isRepoCached;
    private repoRootCached;
    private gitDirCached;
    private readonly shadowObjectDir?;
    private readonly maxQuarantineBytes;
    private readonly maxSnapshotFileBytes;
    private readonly maxSnapshotBytes;
    private readonly allowPartialSnapshots;
    private readonly quarantineKey?;
    private shadowReady?;
    /** Last complete managed tree and the Git status signature that produced it. */
    private workspaceTreeCache?;
    constructor(options: GitPlumbingOptions);
    get usesShadowStore(): boolean;
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
    inspectWorkspace(options?: {
        omitPaths?: string[];
    }): Promise<{
        treeOid: string;
        ignoredPaths: string[];
    }>;
    /** Read Git control-plane state without touching the user's index or refs. */
    inspectControlPlane(): Promise<{
        headOid: string | null;
        branch: string;
        operation: string | null;
    }>;
    /** Detect Git modes whose contents are not fully represented by one worktree tree. */
    inspectWorkspaceCapabilities(): Promise<WorkspaceCapabilities>;
    assertSupportedWorkspace(): Promise<void>;
    /** Restore with an isolated index so the user's staged changes are never rewritten. */
    restoreSnapshot(commitOrTreeOid: string, options?: GitRestoreOptions): Promise<{
        deletedIgnoredPaths: string[];
        restoredTreeOid: string;
    }>;
    private stashWorkspacePaths;
    private restoreStashedWorkspacePaths;
    private mergeWorkspaceTree;
    /** Restore only selected tracked workspace paths using a disposable index. */
    restoreSelectedPaths(commitOrTreeOid: string, paths: string[], options?: GitSelectiveRestoreOptions): Promise<string[]>;
    /** Restore quarantined ignored content without ever writing it into Git objects. */
    restoreIgnoredBackup(key: string): Promise<void>;
    /** Validate encrypted quarantine content before a restore mutates the workspace. */
    validateIgnoredBackup(key: string): Promise<void>;
    /** Remove a quarantine backup only after the DAG no longer references its key. */
    removeIgnoredBackup(key: string): Promise<number>;
    getDiffBetween(baseOid: string, targetOid: string): Promise<DiffResult[]>;
    private runGitBuffer;
    private readShadowBlob;
    private gitEnv;
    private writeWorkspaceTree;
    /**
     * Cheap-enough complete workspace identity used to skip a redundant tree
     * write only for a fully clean worktree. Porcelain-v2 includes staged,
     * unstaged, untracked and branch-head state, but an untracked path entry does
     * not contain its content hash; therefore any file entry disables reuse.
     * Ignored paths are intentionally handled separately by listIgnoredPaths().
     */
    private workspaceStatusSignature;
    private assertSnapshotSize;
    private listIgnoredPaths;
    private listTreeFiles;
    private listTreeFileNames;
    private listTreeEntries;
    private computeChangedFiles;
    private diffNameOnly;
    private protectedRepoPaths;
    private isPreservedRelative;
    private safeWorkspacePath;
    private backupIgnoredPath;
    private backupIgnoredPathEncrypted;
    /** Explicitly convert one legacy plaintext quarantine into encrypted form. */
    migrateIgnoredBackup(key: string): Promise<QuarantineMigrationResult>;
    private collectEncryptedQuarantineEntries;
    private parseUnifiedDiff;
    cleanupSession(sessionId: string): Promise<void>;
    deleteCheckpointRef(sessionId: string, checkpointId: string): Promise<boolean>;
    /** Remove unreachable loose objects from the opt-in shadow store only. */
    pruneShadowObjects(): Promise<ShadowGcResult>;
    /** Rebuild only the opt-in shadow pack from the plugin's private refs. */
    repackShadowObjects(): Promise<ShadowRepackResult>;
    private ensureShadowStore;
    private runGitInput;
}

interface FallbackOptions {
    workDir: string;
    storageDir: string;
    preservePaths?: string[];
    maxSnapshotFileBytes?: number;
    maxSnapshotBytes?: number;
}
/** Exact-copy fallback for ordinary directories, including deletions and symlinks. */
declare class FallbackSnapshotEngine {
    readonly workDir: string;
    readonly storageDir: string;
    private readonly preservePaths;
    private readonly maxSnapshotFileBytes;
    private readonly maxSnapshotBytes;
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
    /** Compare a persisted fallback manifest with the current workspace. */
    getChangedFiles(sessionId: string, checkpointId: string): Promise<FileChange[]>;
    restoreSnapshot(sessionId: string, checkpointId: string): Promise<void>;
    restoreSelectedPaths(sessionId: string, checkpointId: string, paths: string[], options?: {
        expectedCurrentTreeOid?: string;
        mode?: 'safe' | 'force';
    }): Promise<string[]>;
    removeSnapshot(sessionId: string, checkpointId: string): Promise<number>;
    private captureTree;
    private entriesEqual;
    private assertSnapshotSize;
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

/**
 * Small, dependency-free companion client for native DSH/Web integrations.
 * It deliberately knows the restore-plan fence, but does not render UI.
 */

interface TimeMachineClientOptions {
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
}
declare class TimeMachineClientError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
interface RewindRequest {
    sessionId: string;
    checkpointId: string;
    restorePlanId?: string;
    merge?: boolean;
    force?: boolean;
    preserveVerifiedHandEdits?: boolean;
    deleteNewIgnoredPaths?: boolean;
}
interface ForkRequest extends RewindRequest {
    branchName: string;
    description?: string;
}
interface RestoreFilesRequest {
    sessionId: string;
    checkpointId: string;
    paths: string[];
    restorePlanId?: string;
    merge?: boolean;
    force?: boolean;
}
interface PreviewBoundAction {
    readonly sessionId: string;
    readonly checkpointId: string;
    readonly restorePlanId: string;
    readonly preview: RestorePreview;
}
declare class TimeMachineClient {
    private readonly baseUrl;
    private readonly http;
    constructor(options: TimeMachineClientOptions);
    capabilities(): Promise<Record<string, unknown>>;
    status(): Promise<Record<string, unknown>>;
    storage(sessionId?: string): Promise<Record<string, unknown>>;
    dag(sessionId: string): Promise<DAGTree>;
    preview(sessionId: string, checkpointId: string): Promise<PreviewBoundAction>;
    rewind(action: PreviewBoundAction, options?: Omit<RewindRequest, 'sessionId' | 'checkpointId' | 'restorePlanId'>): Promise<unknown>;
    fork(action: PreviewBoundAction, branchName: string, options?: Omit<ForkRequest, 'sessionId' | 'checkpointId' | 'restorePlanId' | 'branchName'>): Promise<unknown>;
    restoreFiles(request: RestoreFilesRequest): Promise<unknown>;
    restoreFilesFromPreview(action: PreviewBoundAction, paths: string[], options?: Omit<RestoreFilesRequest, 'sessionId' | 'checkpointId' | 'paths' | 'restorePlanId'>): Promise<unknown>;
    diff(sessionId: string, baseCheckpointId: string, targetCheckpointId: string): Promise<unknown>;
    agentWrites(sessionId: string, checkpointId: string): Promise<unknown>;
    unattributedChanges(sessionId: string, checkpointId: string): Promise<unknown>;
    private assertBinding;
    private get;
    private post;
    private request;
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
    readonly ctx?: Context;
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
interface FsObservedTargetLike {
    readonly displayPath: string;
}
interface FsObservedLike {
    readonly kind: 'present' | 'absent';
}
interface ToolEventExecutionLike {
    readonly callId: string;
    readonly name: string;
    readonly agent?: {
        readonly session?: SessionLike;
    };
}
interface ToolEventResultLike {
    readonly isError?: boolean;
}
interface ToolExecutionLike {
    readonly callId?: string;
    readonly name?: string;
    readonly arguments?: unknown;
    readonly agent?: {
        readonly session?: SessionLike;
    };
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
        'agent/pre-step'(payload: {
            readonly agent: AgentLike;
            readonly turn: number;
            readonly step: number;
            readonly signal: AbortSignal;
        }, next: () => Promise<unknown>): Promise<unknown>;
        'session/event'(session: SessionLike, event: SessionEventLike): void;
        'fs/observed'(target: FsObservedTargetLike, observation: FsObservedLike, actor: unknown): void;
        'tools/result'(execution: ToolEventExecutionLike, result: ToolEventResultLike): undefined;
        'tools/execute'(execution: ToolExecutionLike, next: () => Promise<unknown>): Promise<unknown>;
        'tools/pre-execute'(execution: ToolExecutionLike, next: () => Promise<unknown>): Promise<unknown>;
        'agent/created'(payload: {
            readonly agent: AgentLike;
        }): undefined | Promise<undefined>;
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

export { type AgentWriteRecord, type CheckpointNode, Config, type DAGManagerOptions, DAGStateManager, type DAGTree, type DiffResult, type ExternalEffectAdapter, type ExternalEffectCompensationContext, type ExternalEffectCompensationResult, type ExternalEffectRecord, type FallbackOptions, FallbackSnapshotEngine, type FileChange, type ForkRequest, GitPlumbingEngine, type GitPlumbingOptions, type GitRestoreOptions, type GitSelectiveRestoreOptions, type GitSnapshot, type PreviewBoundAction, type PruneResult, QuarantineKeyError, type QuarantineMigrationResult, QuarantineQuotaError, ReflectionAdvisor, type ReflectionSummary, type RestoreFilesRequest, type RestoreOptions, RestorePlanError, type RestorePreview, type RestoreResult, type RewindRequest, type SelectiveRestoreResult, type SessionMessage, type SessionState, type ShadowGcResult, type ShadowRepackResult, SnapshotSizeError, StorageQuotaError, type StorageStatus, TimeMachineClient, TimeMachineClientError, type TimeMachineClientOptions, type TimeMachineConfig, TimeMachinePlugin, TimeMachineService, type TimeMachineServiceOptions, UnsupportedWorkspaceStateError, type WorkspaceCapabilities, WorkspaceDriftError, WorkspaceMergeConflictError, WorkspaceRestoreConflictError, apply, collectFailedTools, TimeMachinePlugin as default, name };
