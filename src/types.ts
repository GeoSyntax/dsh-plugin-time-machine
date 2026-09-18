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

export interface TimeMachineConfig {
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
  /** Store plugin-created Git objects outside the user's normal object directory. */
  shadowStore?: boolean;
}

export interface RestoreOptions {
  mode?: 'safe' | 'force';
  /** Delete ignored paths created after the target checkpoint. Off by default. */
  deleteNewIgnoredPaths?: boolean;
  /** Internal compensation restores do not create another rescue point. */
  createRescuePoint?: boolean;
  /** Internal key used to quarantine ignored paths before deletion. */
  ignoredBackupKey?: string;
}

export interface RestoreResult {
  targetNode: CheckpointNode;
  restoredSessionState: SessionState;
  rescueCheckpointId?: string;
  deletedIgnoredPaths: string[];
  restoreJournalId?: string;
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
  ignoredPathsToDelete: string[];
  diffs: DiffResult[];
  workspaceDrifted: boolean;
  requiresForce: boolean;
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
}

export interface PruneResult {
  sessionId: string;
  removedCheckpointIds: string[];
  reclaimedBytes: number;
  gitRefsRemoved: number;
  note: string;
}

export interface ReflectionSummary {
  hasPastFailures: boolean;
  failedNodeCount: number;
  summaryNote: string;
  suggestedPromptPrefix: string;
}
