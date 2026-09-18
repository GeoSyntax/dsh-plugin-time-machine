import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pc from 'picocolors';
import type { CheckpointNode, DAGTree } from '../types.js';

export interface DAGManagerOptions {
  sessionId: string;
  storageDir: string;
  initialBranch?: string;
}

export class DAGStateManager {
  public tree: DAGTree;
  private readonly storageFile: string;

  constructor(options: DAGManagerOptions) {
    const branch = options.initialBranch || 'main';
    this.tree = {
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
      const loadedTree = JSON.parse(content) as DAGTree;
      this.assertTree(loadedTree);
      this.tree = loadedTree;
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
      await fs.writeFile(temporary, `${JSON.stringify(this.tree, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });
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

  async updateNode(checkpointId: string, patch: Partial<Pick<CheckpointNode, 'status' | 'errorMessage' | 'failedTools' | 'summary' | 'settledGitTreeOid' | 'settledIgnoredPaths' | 'ignoredBackupKey'>>): Promise<CheckpointNode> {
    const node = this.getNode(checkpointId);
    if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    const updated = { ...node, ...cloneJson(patch) };
    await this.commitMutation(() => { this.tree.nodes[checkpointId] = updated; });
    return cloneJson(updated);
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
    return cloneJson(baseNode);
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
    if (!tree || tree.sessionId !== this.tree.sessionId || typeof tree.nodes !== 'object' || typeof tree.branches !== 'object') {
      throw new Error(`Invalid or foreign DAG state in '${this.storageFile}'.`);
    }
    if (!tree.branches[tree.currentBranch]) throw new Error(`DAG active branch '${tree.currentBranch}' is missing.`);
    if (tree.currentCheckpointId && !tree.nodes[tree.currentCheckpointId]) {
      throw new Error(`DAG current checkpoint '${tree.currentCheckpointId}' is missing.`);
    }
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
