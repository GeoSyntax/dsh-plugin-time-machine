import path from 'node:path';
import fs from 'node:fs/promises';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import pc from 'picocolors';
import type { CheckpointNode, DAGTree } from '../types.js';

/** Current on-disk DAG schema. Bump only with an explicit migration path. */
export const DAG_FORMAT_VERSION = 1 as const;
const DAG_ENVELOPE_VERSION = 1 as const;

export class DAGStateKeyError extends Error {
  readonly code = 'DAG_STATE_KEY_INVALID';

  constructor(message = 'DAG state encryption key is missing or invalid.') {
    super(message);
    this.name = 'DAGStateKeyError';
  }
}

export interface DAGManagerOptions {
  sessionId: string;
  storageDir: string;
  initialBranch?: string;
  /** Optional operator-provided key for encrypting persisted session metadata. */
  encryptionKey?: string;
  /** Optional previous key accepted only to re-encrypt an authenticated legacy envelope. */
  previousEncryptionKey?: string;
}

export class DAGStateManager {
  public tree: DAGTree;
  private readonly storageFile: string;
  private readonly encryptionKey?: Buffer;
  private readonly previousEncryptionKey?: Buffer;

  constructor(options: DAGManagerOptions) {
    const branch = options.initialBranch || 'main';
    this.encryptionKey = options.encryptionKey?.trim()
      ? createHash('sha256').update(options.encryptionKey).digest()
      : undefined;
    this.previousEncryptionKey = options.previousEncryptionKey?.trim()
      ? createHash('sha256').update(options.previousEncryptionKey).digest()
      : undefined;
    this.tree = {
      formatVersion: DAG_FORMAT_VERSION,
      sessionId: options.sessionId,
      currentBranch: branch,
      currentCheckpointId: null,
      nodes: {},
      branches: {
        [branch]: {
          name: branch,
          headId: '',
          forkedFromId: null,
          createdAt: Date.now(),
          description: 'Primary exploration branch',
        },
      },
    };
    const safeSessionKey = Buffer.from(options.sessionId, 'utf8').toString('base64url') || '_';
    this.storageFile = path.join(options.storageDir, `dag_${safeSessionKey}.json`);
  }

  /**
   * 初始化并尝试从本地恢复树结构
   */
  async init(): Promise<void> {
    try {
      const content = await fs.readFile(this.storageFile, 'utf-8');
      const decoded = this.decode(content);
      const { tree, migrated } = this.migrateTree(decoded.tree);
      this.assertTree(tree);
      this.tree = tree;
      // Legacy files are upgraded only after they have passed full validation.
      // This keeps a corrupt/foreign file untouched for diagnosis and makes the
      // migration atomic through the normal temporary-file persistence path.
      if (migrated || decoded.usedPreviousKey || this.isPlaintext(content)) await this.persist();
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  /**
   * 持久化当前 DAG 树到本地 JSON
   */
  async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.storageFile), { recursive: true });
    const temporary = `${this.storageFile}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, this.encode(this.tree), { encoding: 'utf-8', flag: 'wx' });
      await fs.rename(temporary, this.storageFile);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  /**
   * 添加一个新快照节点并推进当前分支 HEAD
   */
  async addNode(node: CheckpointNode): Promise<void> {
    if (this.tree.nodes[node.id]) throw new Error(`Checkpoint '${node.id}' already exists.`);
    if (node.branch !== this.tree.currentBranch) {
      throw new Error(`Checkpoint branch '${node.branch}' is not the active branch '${this.tree.currentBranch}'.`);
    }
    if (node.parentId !== this.tree.currentCheckpointId) {
      throw new Error(`Checkpoint '${node.id}' has a stale parent.`);
    }
    await this.commitMutation(() => {
      this.tree.nodes[node.id] = cloneJson(node);
      this.tree.currentCheckpointId = node.id;
      if (!this.tree.branches[node.branch]) {
        this.tree.branches[node.branch] = {
          name: node.branch,
          headId: node.id,
          forkedFromId: node.parentId,
          createdAt: Date.now(),
        };
      } else {
        this.tree.branches[node.branch].headId = node.id;
      }
    });
  }

  /**
   * 获取当前活动的快照节点
   */
  getCurrentNode(): CheckpointNode | null {
    if (!this.tree.currentCheckpointId) return null;
    return this.tree.nodes[this.tree.currentCheckpointId] || null;
  }

  /**
   * 获取指定 ID 的节点
   */
  getNode(checkpointId: string): CheckpointNode | null {
    return this.tree.nodes[checkpointId] || null;
  }

  async updateNode(checkpointId: string, patch: Partial<Pick<CheckpointNode, 'status' | 'errorMessage' | 'failedTools' | 'summary' | 'settledGitTreeOid' | 'settledIgnoredPaths' | 'ignoredBackupKey' | 'externalEffects' | 'agentWrites' | 'unattributedChanges' | 'toolMutations'>>): Promise<CheckpointNode> {
    const node = this.getNode(checkpointId);
    if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    const updated = { ...node, ...cloneJson(patch) };
    await this.commitMutation(() => { this.tree.nodes[checkpointId] = updated; });
    return cloneJson(updated);
  }

  /** Remove only leaf checkpoints that are not current or a branch head. */
  async removeLeafNodes(checkpointIds: string[]): Promise<CheckpointNode[]> {
    const requested = new Set(checkpointIds);
    const protectedIds = new Set<string>([
      ...(this.tree.currentCheckpointId ? [this.tree.currentCheckpointId] : []),
      ...Object.values(this.tree.branches).map(branch => branch.headId).filter(Boolean),
    ]);
    const children = new Set(Object.values(this.tree.nodes).map(node => node.parentId).filter((id): id is string => Boolean(id)));
    const removable = Object.values(this.tree.nodes).filter(node => requested.has(node.id) && !protectedIds.has(node.id) && !children.has(node.id));
    if (removable.length === 0) return [];
    await this.commitMutation(() => {
      for (const node of removable) delete this.tree.nodes[node.id];
    });
    return removable.map(cloneJson);
  }

  /** Remove historical nodes while reparenting surviving children to the nearest ancestor. */
  async compactNodes(checkpointIds: string[]): Promise<CheckpointNode[]> {
    const requested = new Set(checkpointIds);
    const protectedIds = new Set<string>([
      ...(this.tree.currentCheckpointId ? [this.tree.currentCheckpointId] : []),
      ...Object.values(this.tree.branches).map(branch => branch.headId).filter(Boolean),
    ]);
    const removable = Object.values(this.tree.nodes).filter(node => requested.has(node.id) && !protectedIds.has(node.id));
    if (removable.length === 0) return [];
    const removedIds = new Set(removable.map(node => node.id));
    const nearestSurvivor = (parentId: string | null): string | null => {
      let cursor = parentId;
      while (cursor && removedIds.has(cursor)) cursor = this.tree.nodes[cursor]?.parentId ?? null;
      return cursor;
    };
    await this.commitMutation(() => {
      for (const node of Object.values(this.tree.nodes)) {
        if (!removedIds.has(node.id)) node.parentId = nearestSurvivor(node.parentId);
      }
      for (const branch of Object.values(this.tree.branches)) {
        branch.forkedFromId = nearestSurvivor(branch.forkedFromId);
      }
      for (const node of removable) delete this.tree.nodes[node.id];
    });
    return removable.map(cloneJson);
  }

  /** Explicitly remove a non-current exploration branch and its private nodes. */
  async removeBranch(branchName: string): Promise<CheckpointNode[]> {
    if (branchName === this.tree.currentBranch) throw new Error('Cannot prune the current branch.');
    if (!this.tree.branches[branchName]) return [];
    const protectedAncestors = new Set(this.getLineage(this.tree.currentCheckpointId ?? '').map(node => node.id));
    const removed = Object.values(this.tree.nodes).filter(node => node.branch === branchName && !protectedAncestors.has(node.id));
    await this.commitMutation(() => {
      delete this.tree.branches[branchName];
      for (const node of removed) delete this.tree.nodes[node.id];
    });
    return removed.map(cloneJson);
  }

  /**
   * 回滚当前指针到指定历史节点（保持在当前分支）
   */
  async rewindTo(checkpointId: string): Promise<CheckpointNode> {
    const target = this.getNode(checkpointId);
    if (!target) {
      throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    }

    await this.commitMutation(() => {
      this.tree.currentCheckpointId = checkpointId;
      this.tree.currentBranch = target.branch;
      this.tree.branches[target.branch].headId = checkpointId;
    });
    return cloneJson(target);
  }

  /**
   * 核心功能：从任意历史节点 Fork 出一个新的平行探索分支
   */
  async forkBranch(checkpointId: string, newBranchName: string, description?: string): Promise<CheckpointNode> {
    const baseNode = this.validateFork(checkpointId, newBranchName);

    await this.commitMutation(() => {
      this.tree.branches[newBranchName] = {
        name: newBranchName,
        headId: checkpointId,
        forkedFromId: checkpointId,
        createdAt: Date.now(),
        description: description || `Forked from ${checkpointId} (${baseNode.branch})`,
      };
      this.tree.currentBranch = newBranchName;
      this.tree.currentCheckpointId = checkpointId;
    });
    // The checkpoint remains owned by its original branch, but callers need a
    // branch-local view for session restart/UI responses.
    return cloneJson({ ...baseNode, branch: newBranchName });
  }

  validateFork(checkpointId: string, newBranchName: string): CheckpointNode {
    const baseNode = this.getNode(checkpointId);
    if (!baseNode) throw new Error(`Cannot fork from non-existent checkpoint: ${checkpointId}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(newBranchName) || newBranchName.includes('..')) {
      throw new Error(`Branch '${newBranchName}' is not a safe branch name.`);
    }
    if (this.tree.branches[newBranchName]) {
      throw new Error(`Branch '${newBranchName}' already exists. Choose another name.`);
    }
    return baseNode;
  }

  /**
   * 切换当前活动分支
   */
  async switchBranch(branchName: string): Promise<CheckpointNode> {
    const branchMeta = this.tree.branches[branchName];
    if (!branchMeta) {
      throw new Error(`Branch '${branchName}' does not exist.`);
    }

    const headNode = this.getNode(branchMeta.headId);
    if (!headNode) {
      throw new Error(`Head node of branch '${branchName}' is missing.`);
    }

    await this.commitMutation(() => {
      this.tree.currentBranch = branchName;
      this.tree.currentCheckpointId = headNode.id;
    });
    return cloneJson(headNode);
  }

  /**
   * 获取从根节点到指定节点的分支线性链路
   */
  getLineage(checkpointId: string): CheckpointNode[] {
    const pathNodes: CheckpointNode[] = [];
    let currId: string | null = checkpointId;

    while (currId) {
      const node: CheckpointNode | undefined = this.tree.nodes[currId];
      if (!node) break;
      pathNodes.unshift(node);
      currId = node.parentId;
    }

    return pathNodes;
  }

  /**
   * 获取在指定分叉点后，其他分支中失败或被放弃的节点（供反思分析）
   */
  getAbandonedSubtrees(forkPointId: string, currentActiveBranch: string): CheckpointNode[] {
    const abandoned: CheckpointNode[] = [];
    for (const node of Object.values(this.tree.nodes)) {
      if (node.branch !== currentActiveBranch && node.parentId === forkPointId) {
        // 收集该子树下的所有节点
        this.collectSubtree(node.id, abandoned);
      }
    }
    return abandoned;
  }

  private collectSubtree(rootId: string, acc: CheckpointNode[]): void {
    const node = this.tree.nodes[rootId];
    if (!node) return;
    acc.push(node);
    for (const child of Object.values(this.tree.nodes)) {
      if (child.parentId === rootId) {
        this.collectSubtree(child.id, acc);
      }
    }
  }

  /**
   * 渲染用于终端 `/tree` 命令展示的彩色 ASCII/Unicode 拓扑图
   */
  renderAsciiTree(): string {
    const lines: string[] = [];
    lines.push(pc.bold(pc.cyan(`\n═════════════ DSH Time Machine DAG Tree ═════════════`)));
    lines.push(pc.dim(`Session: ${this.tree.sessionId} | Active Branch: `) + pc.green(pc.bold(this.tree.currentBranch)));
    lines.push('');

    const nodesList = Object.values(this.tree.nodes).sort((a, b) => a.timestamp - b.timestamp);
    if (nodesList.length === 0) {
      lines.push(pc.yellow('  (No checkpoints recorded yet. Run a prompt to generate the first checkpoint)'));
      return lines.join('\n');
    }

    for (const node of nodesList) {
      const isHead = this.tree.currentCheckpointId === node.id;
      const isBranchHead = Object.values(this.tree.branches).some(b => b.headId === node.id);

      const marker = isHead
        ? pc.red(pc.bold('● [HEAD]'))
        : isBranchHead
        ? pc.yellow('◆')
        : pc.blue('○');

      const timeStr = new Date(node.timestamp).toLocaleTimeString();
      const branchBadge = pc.magenta(`[${node.branch}]`);
      const idStr = pc.bold(node.id);
      const promptSnippet = node.prompt.length > 35 ? `${node.prompt.slice(0, 32)}...` : node.prompt;
      const filesCount = node.changedFiles.length;
      const statusBadge = node.status === 'failed' ? pc.red('✖ FAILED') : pc.green('✔ OK');

      lines.push(`  ${marker} ${idStr} ${branchBadge} ${pc.dim(timeStr)} - ${pc.white(promptSnippet)} (${pc.cyan(`${filesCount} files`)}) ${statusBadge}`);
      if (node.summary) {
        lines.push(`     ${pc.dim('└─')} ${pc.italic(pc.gray(node.summary))}`);
      }
    }

    lines.push(pc.bold(pc.cyan(`══════════════════════════════════════════════════════\n`)));
    return lines.join('\n');
  }

  private assertTree(tree: DAGTree): void {
    if (tree.formatVersion !== DAG_FORMAT_VERSION) {
      throw new Error(`Unsupported DAG storage format ${String(tree.formatVersion)}; expected ${DAG_FORMAT_VERSION}.`);
    }
    if (!tree || tree.sessionId !== this.tree.sessionId || typeof tree.nodes !== 'object' || typeof tree.branches !== 'object') {
      throw new Error(`Invalid or foreign DAG state in '${this.storageFile}'.`);
    }
    if (!tree.branches[tree.currentBranch]) throw new Error(`DAG active branch '${tree.currentBranch}' is missing.`);
    if (tree.currentCheckpointId && !tree.nodes[tree.currentCheckpointId]) {
      throw new Error(`DAG current checkpoint '${tree.currentCheckpointId}' is missing.`);
    }
    for (const [id, node] of Object.entries(tree.nodes)) {
      if (!node || node.id !== id || node.sessionState?.sessionId !== tree.sessionId) {
        throw new Error(`DAG checkpoint '${id}' is malformed or belongs to another session.`);
      }
      if (!Array.isArray(node.sessionState.messages) || !Array.isArray(node.changedFiles)) {
        throw new Error(`DAG checkpoint '${id}' has invalid session or file state.`);
      }
      if (node.assistantMessageId !== undefined && (typeof node.assistantMessageId !== 'string' || !node.assistantMessageId.trim())) {
        throw new Error(`DAG checkpoint '${id}' has an invalid assistant message id.`);
      }
      if (node.userMessageId !== undefined && (typeof node.userMessageId !== 'string' || !node.userMessageId.trim())) {
        throw new Error(`DAG checkpoint '${id}' has an invalid user message id.`);
      }
      if (node.assistantMessageIds !== undefined && (!Array.isArray(node.assistantMessageIds) || node.assistantMessageIds.some(messageId => typeof messageId !== 'string' || !messageId.trim()))) {
        throw new Error(`DAG checkpoint '${id}' has invalid assistant message ids.`);
      }
      if (node.toolMutations !== undefined && (!Array.isArray(node.toolMutations) || node.toolMutations.some(item => !item || typeof item.toolName !== 'string' || !item.toolName.trim() || !['success', 'error'].includes(item.status) || !Array.isArray(item.changedFiles) || !Number.isFinite(item.recordedAt) || (item.error !== undefined && (typeof item.error !== 'string' || item.error.length > 300))))) {
        throw new Error(`DAG checkpoint '${id}' has invalid tool mutation evidence.`);
      }
      if (node.parentId !== null && !tree.nodes[node.parentId]) {
        throw new Error(`DAG checkpoint '${id}' references missing parent '${node.parentId}'.`);
      }
      if (!tree.branches[node.branch]) {
        throw new Error(`DAG checkpoint '${id}' references missing branch '${node.branch}'.`);
      }
    }
  }

  private migrateTree(tree: DAGTree): { tree: DAGTree; migrated: boolean } {
    if (!tree || typeof tree !== 'object') {
      throw new Error(`Invalid or foreign DAG state in '${this.storageFile}'.`);
    }
    if (tree.formatVersion === undefined) {
      return { tree: { ...tree, formatVersion: DAG_FORMAT_VERSION }, migrated: true };
    }
    if (tree.formatVersion !== DAG_FORMAT_VERSION) {
      throw new Error(`Unsupported DAG storage format ${String(tree.formatVersion)}; expected ${DAG_FORMAT_VERSION}.`);
    }
    return { tree, migrated: false };
  }

  private encode(tree: DAGTree): string {
    const plaintext = Buffer.from(JSON.stringify(tree, null, 2), 'utf8');
    if (!this.encryptionKey) return `${plaintext.toString('utf8')}\n`;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = {
      kind: 'dsh-time-machine-dag',
      version: DAG_ENVELOPE_VERSION,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
    return `${JSON.stringify(envelope, null, 2)}\n`;
  }

  private decode(content: string): { tree: DAGTree; usedPreviousKey: boolean } {
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new Error(`Invalid DAG state JSON in '${this.storageFile}'.`); }
    if (isDagEnvelope(parsed)) {
      if (!this.encryptionKey) throw new DAGStateKeyError('Encrypted DAG state requires the configured key.');
      if (parsed.version !== DAG_ENVELOPE_VERSION) throw new DAGStateKeyError('Encrypted DAG state format is unsupported.');
      const keys = [{ key: this.encryptionKey, previous: false }, ...(this.previousEncryptionKey ? [{ key: this.previousEncryptionKey, previous: true }] : [])];
      for (const candidate of keys) {
        try {
          const decipher = createDecipheriv('aes-256-gcm', candidate.key, Buffer.from(parsed.nonce, 'base64url'));
          decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
          const plaintext = Buffer.concat([
            decipher.update(Buffer.from(parsed.ciphertext, 'base64url')),
            decipher.final(),
          ]);
          return { tree: JSON.parse(plaintext.toString('utf8')) as DAGTree, usedPreviousKey: candidate.previous };
        } catch { /* try the explicitly configured previous key, then fail closed */ }
      }
      throw new DAGStateKeyError('Encrypted DAG state cannot be authenticated with the configured key.');
    }
    return { tree: parsed as DAGTree, usedPreviousKey: false };
  }

  private isPlaintext(content: string): boolean {
    try { return !isDagEnvelope(JSON.parse(content)); } catch { return false; }
  }

  private async commitMutation(mutate: () => void): Promise<void> {
    const previous = cloneJson(this.tree);
    try {
      mutate();
      await this.persist();
    } catch (error) {
      this.tree = previous;
      throw error;
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDagEnvelope(value: unknown): value is {
  kind: 'dsh-time-machine-dag';
  version: number;
  nonce: string;
  ciphertext: string;
  tag: string;
} {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.kind === 'dsh-time-machine-dag'
    && typeof item.version === 'number'
    && typeof item.nonce === 'string'
    && typeof item.ciphertext === 'string'
    && typeof item.tag === 'string';
}
