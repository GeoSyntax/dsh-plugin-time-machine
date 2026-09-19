export interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
  [key: string]: any;
}

export interface SessionState {
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

export interface FileChange {
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
export interface ExternalEffectRecord {
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

export interface ExternalEffectCompensationContext {
  sessionId: string;
  checkpointId: string;
  effect: ExternalEffectRecord;
  idempotencyKey: string;
}

export interface ExternalEffectAdapter {
  name: string;
  compensate(context: ExternalEffectCompensationContext): Promise<{
    status: 'compensated' | 'unknown';
    note?: string;
  }>;
}

export interface ExternalEffectCompensationResult {
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
export interface AgentWriteRecord {
  path: string;
  sha256: string;
  recordedAt: number;
  operation?: 'create' | 'modify' | 'delete';
}

export interface CheckpointNode {
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
  failedTools?: Array<{ toolName: string; input: any; error: string }>;
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

export interface DAGTree {
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
export interface SessionSummary {
  sessionId: string;
  checkpointCount: number;
  currentBranch: string;
  currentCheckpointId: string | null;
  updatedAt: number | null;
}

export interface TimeMachineConfig {
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

export interface RestoreOptions {
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

export interface RestoreResult {
  targetNode: CheckpointNode;
  restoredSessionState: SessionState;
  rescueCheckpointId?: string;
  deletedIgnoredPaths: string[];
  restoreJournalId?: string;
  /** Paths preserved because verified Agent-write hashes no longer matched. */
  preservedHandEditPaths?: string[];
}

export interface DiffResult {
  file: string;
  status: 'added' | 'modified' | 'deleted';
  diffText: string;
}

/** Read-only impact report for a prospective rewind/fork. */
export interface RestorePreview {
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

export interface SelectiveRestoreResult {
  checkpointId: string;
  restoredPaths: string[];
  rescueCheckpointId?: string;
  resultCheckpointId?: string;
  restoreJournalId?: string;
}

export interface StorageStatus {
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

export interface PruneResult {
  sessionId: string;
  removedCheckpointIds: string[];
  reclaimedBytes: number;
  gitRefsRemoved: number;
  quarantineReclaimedBytes?: number;
  shadowObjectsReclaimedBytes?: number;
  shadowRepackSkippedReason?: string;
  note: string;
}

export interface ReflectionSummary {
  hasPastFailures: boolean;
  failedNodeCount: number;
  summaryNote: string;
  suggestedPromptPrefix: string;
  hasExternalEffects?: boolean;
  externalEffectCount?: number;
}
