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
    /** Durable assistant message produced by this turn, when the host exposes one. */
    assistantMessageId?: string;
    /** All finalized assistant messages produced by this turn, including tool-loop intermediates. */
    assistantMessageIds?: string[];
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
/** Read-only summary used by dashboards to discover persisted DSH sessions. */
interface SessionSummary {
    sessionId: string;
    checkpointCount: number;
    currentBranch: string;
    currentCheckpointId: string | null;
    updatedAt: number | null;
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
    /** Explicit browser Origins allowed to call the loopback API cross-origin. */
    webAllowedOrigins?: string[];
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
    /** Automatically preserve verified hand edits during restore when the ledger is enabled. */
    preserveVerifiedHandEditsByDefault?: boolean;
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
    /** Verified Agent-write paths whose later hand-edits are preserved by policy. */
    preservedHandEditPaths?: string[];
    /** External effects recorded on the active lineage after the target; file restore does not undo these. */
    externalEffects?: ExternalEffectRecord[];
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
/** Host-reported workspace isolation mode; shared-lock is the honest fallback. */
type WorkspaceIsolation = 'shared-lock' | 'isolated-worktree' | 'isolated-container';
interface PruneResult {
    sessionId: string;
    /** True when this result is an audit-only plan and no checkpoints were removed. */
    dryRun?: boolean;
    /** Checkpoints that would be removed by a dry-run. */
    wouldRemoveCheckpointIds?: string[];
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
type RestoreWorkspaceRequest = Omit<RewindRequest, 'checkpointId'> & {
    checkpointId: string;
};
interface UndoRequest extends Omit<RewindRequest, 'checkpointId'> {
    count?: number;
}
interface ExternalEffectRequest {
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
interface ExternalCompensationRequest {
    sessionId: string;
    checkpointId: string;
    effectId: string;
    execute?: boolean;
    idempotencyKey?: string;
}
interface PruneRequest {
    sessionId: string;
    keepLatest?: number;
    olderThanMs?: number;
    abandonedBranches?: boolean;
    compactHistory?: boolean;
    repackShadowObjects?: boolean;
    dryRun?: boolean;
}
interface PreviewBoundAction {
    readonly sessionId: string;
    readonly checkpointId: string;
    readonly restorePlanId: string;
    readonly preview: RestorePreview;
}
/** UI-neutral timeline row for native DSH or standalone companion clients. */
interface CompanionTimelineEntry {
    checkpoint: CheckpointNode;
    /** 0 is the current completed user turn; null means the node is not on the active lineage. */
    relativeUndo: number | null;
    isCurrent: boolean;
    /** Internal safety boundaries remain inspectable but should not be offered as user undo targets. */
    userVisible: boolean;
    canUndo: boolean;
    warnings: string[];
}
declare class TimeMachineClient {
    private readonly baseUrl;
    private readonly http;
    constructor(options: TimeMachineClientOptions);
    capabilities(): Promise<Record<string, unknown>>;
    status(): Promise<Record<string, unknown>>;
    storage(sessionId?: string): Promise<Record<string, unknown>>;
    dag(sessionId: string): Promise<DAGTree>;
    sessions(): Promise<SessionSummary[]>;
    /** Resolve the checkpoint anchored to a finalized assistant message. */
    checkpointForMessage(sessionId: string, messageId: string): Promise<CheckpointNode>;
    /** Build a bounded, newest-first timeline without coupling consumers to React or DSH slots. */
    timeline(sessionId: string, limit?: number): Promise<CompanionTimelineEntry[]>;
    preview(sessionId: string, checkpointId: string, options?: {
        preserveVerifiedHandEdits?: boolean;
    }): Promise<PreviewBoundAction>;
    rewind(action: PreviewBoundAction, options?: Omit<RewindRequest, 'sessionId' | 'checkpointId' | 'restorePlanId'>): Promise<unknown>;
    /** Direct relative-turn undo for CLI-like companions; preview-first UIs may use timeline()+preview()+rewind(). */
    undo(request: UndoRequest): Promise<unknown>;
    fork(action: PreviewBoundAction, branchName: string, options?: Omit<ForkRequest, 'sessionId' | 'checkpointId' | 'restorePlanId' | 'branchName'>): Promise<unknown>;
    restoreFiles(request: RestoreFilesRequest): Promise<unknown>;
    restoreFilesFromPreview(action: PreviewBoundAction, paths: string[], options?: Omit<RestoreFilesRequest, 'sessionId' | 'checkpointId' | 'paths' | 'restorePlanId'>): Promise<unknown>;
    restoreWorkspace(request: RestoreWorkspaceRequest): Promise<unknown>;
    restoreWorkspaceFromPreview(action: PreviewBoundAction, options?: Omit<RestoreWorkspaceRequest, 'sessionId' | 'checkpointId' | 'restorePlanId'>): Promise<unknown>;
    recordExternalEffect(request: ExternalEffectRequest): Promise<unknown>;
    compensateExternalEffect(request: ExternalCompensationRequest): Promise<unknown>;
    externalEffects(sessionId: string, checkpointId?: string, unresolvedOnly?: boolean): Promise<unknown>;
    reflection(sessionId: string, checkpointId: string): Promise<unknown>;
    prune(request: PruneRequest): Promise<unknown>;
    diff(sessionId: string, baseCheckpointId: string, targetCheckpointId: string): Promise<unknown>;
    agentWrites(sessionId: string, checkpointId: string): Promise<unknown>;
    unattributedChanges(sessionId: string, checkpointId: string): Promise<unknown>;
    private assertBinding;
    private get;
    private post;
    private request;
}

/** Pure timeline projection shared by browser clients and tests. */
declare function buildCompanionTimeline(dag: DAGTree, limit?: number): CompanionTimelineEntry[];

export { type AgentWriteRecord as A, type CheckpointNode as C, type DAGTree as D, type ExternalEffectRecord as E, type FileChange as F, type PruneResult as P, type RestoreOptions as R, type SessionState as S, type TimeMachineConfig as T, type UndoRequest as U, type WorkspaceIsolation as W, type ExternalEffectAdapter as a, type ExternalEffectCompensationResult as b, type RestoreResult as c, type SelectiveRestoreResult as d, type ReflectionSummary as e, type DiffResult as f, type RestorePreview as g, type StorageStatus as h, type SessionSummary as i, type CompanionTimelineEntry as j, type ExternalCompensationRequest as k, type ExternalEffectCompensationContext as l, type ExternalEffectRequest as m, type ForkRequest as n, type PreviewBoundAction as o, type PruneRequest as p, type RestoreFilesRequest as q, type RestoreWorkspaceRequest as r, type RewindRequest as s, type SessionMessage as t, TimeMachineClient as u, TimeMachineClientError as v, type TimeMachineClientOptions as w, buildCompanionTimeline as x };
