import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { FileChange, DiffResult } from '../types.js';

const execFileAsync = promisify(execFile);

export interface GitPlumbingOptions {
  workDir: string;
  refPrefix?: string;
  preservePaths?: string[];
  quarantineDir?: string;
}

export interface GitSnapshot {
  treeOid: string;
  commitOid: string;
  changedFiles: FileChange[];
  ignoredPaths: string[];
}

export interface GitRestoreOptions {
  expectedCurrentTreeOid?: string;
  expectedCurrentIgnoredPaths?: string[];
  targetIgnoredPaths?: string[];
  mode?: 'safe' | 'force';
  deleteNewIgnoredPaths?: boolean;
  ignoredBackupKey?: string;
}

export interface GitSelectiveRestoreOptions {
  expectedCurrentTreeOid?: string;
  mode?: 'safe' | 'force';
}

export class WorkspaceDriftError extends Error {
  readonly code = 'WORKSPACE_DRIFT';

  constructor(public readonly details: string[]) {
    super(`Workspace changed after the latest checkpoint: ${details.slice(0, 8).join(', ')}`);
    this.name = 'WorkspaceDriftError';
  }
}

export class WorkspaceRestoreConflictError extends Error {
  readonly code = 'RESTORE_CONFLICT';

  constructor(public readonly paths: string[]) {
    super(`Ignored files block restore: ${paths.slice(0, 8).join(', ')}`);
    this.name = 'WorkspaceRestoreConflictError';
  }
}

export class GitPlumbingEngine {
  public readonly workDir: string;
  public readonly refPrefix: string;
  private readonly preservePaths: string[];
  private readonly quarantineDir?: string;
  private isRepoCached: boolean | null = null;
  private repoRootCached: string | null = null;
  private gitDirCached: string | null = null;

  constructor(options: GitPlumbingOptions) {
    this.workDir = path.resolve(options.workDir);
    this.refPrefix = options.refPrefix || 'refs/dsh-tm';
    this.preservePaths = (options.preservePaths ?? []).map(item => path.resolve(this.workDir, item));
    this.quarantineDir = options.quarantineDir ? path.resolve(options.quarantineDir) : undefined;
  }

  async isGitRepo(): Promise<boolean> {
    if (this.isRepoCached !== null) return this.isRepoCached;
    try {
      const { stdout } = await this.runGit(['rev-parse', '--is-inside-work-tree']);
      this.isRepoCached = stdout.trim() === 'true';
    } catch {
      this.isRepoCached = false;
    }
    return this.isRepoCached;
  }

  async getRepoRoot(): Promise<string> {
    if (this.repoRootCached) return this.repoRootCached;
    const { stdout } = await this.runGit(['rev-parse', '--show-toplevel']);
    this.repoRootCached = path.resolve(stdout.trim());
    return this.repoRootCached;
  }

  async getGitDir(): Promise<string> {
    if (this.gitDirCached) return this.gitDirCached;
    const { stdout } = await this.runGit(['rev-parse', '--absolute-git-dir']);
    this.gitDirCached = path.resolve(stdout.trim());
    return this.gitDirCached;
  }

  async runGit(
    args: string[],
    extraEnv: Record<string, string> = {},
    cwd = this.workDir,
  ): Promise<{ stdout: string; stderr: string }> {
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      ...extraEnv,
    };
    try {
      return await execFileAsync('git', args, {
        cwd,
        env,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
      });
    } catch (err: any) {
      const errorMsg = err.stderr || err.stdout || err.message;
      throw new Error(`Git plumbing command failed: git ${args.join(' ')}\nReason: ${errorMsg}`);
    }
  }

  async createSnapshot(params: {
    sessionId: string;
    checkpointId: string;
    parentCommitOid?: string | null;
    message?: string;
  }): Promise<GitSnapshot> {
    if (!(await this.isGitRepo())) {
      throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
    }

    const { treeOid, indexFile } = await this.writeWorkspaceTree();
    try {
      const commitMsg = params.message || `DSH Checkpoint [${params.sessionId}:${params.checkpointId}]`;
      const commitArgs = ['commit-tree', treeOid, '-m', commitMsg];
      if (params.parentCommitOid) {
        await this.runGit(['cat-file', '-e', `${params.parentCommitOid}^{commit}`]);
        commitArgs.push('-p', params.parentCommitOid);
      }

      const identityEnv = {
        GIT_AUTHOR_NAME: 'DSH Time Machine',
        GIT_AUTHOR_EMAIL: 'time-machine@localhost',
        GIT_COMMITTER_NAME: 'DSH Time Machine',
        GIT_COMMITTER_EMAIL: 'time-machine@localhost',
      };
      const { stdout: commitStdout } = await this.runGit(commitArgs, identityEnv);
      const commitOid = commitStdout.trim();
      const checkpointRef = `${this.refPrefix}/${encodeRefPart(params.sessionId)}/nodes/${encodeRefPart(params.checkpointId)}`;
      await this.runGit(['update-ref', checkpointRef, commitOid]);

      const changedFiles = params.parentCommitOid
        ? await this.computeChangedFiles(params.parentCommitOid, commitOid)
        : await this.listTreeFiles(treeOid);

      return {
        treeOid,
        commitOid,
        changedFiles,
        ignoredPaths: await this.listIgnoredPaths(),
      };
    } finally {
      await fs.rm(indexFile, { force: true }).catch(() => undefined);
    }
  }

  /** Compute the current managed tree without publishing a commit or ref. */
  async inspectWorkspace(): Promise<{ treeOid: string; ignoredPaths: string[] }> {
    const { treeOid, indexFile } = await this.writeWorkspaceTree();
    try {
      return { treeOid, ignoredPaths: await this.listIgnoredPaths() };
    } finally {
      await fs.rm(indexFile, { force: true }).catch(() => undefined);
    }
  }

  /** Restore with an isolated index so the user's staged changes are never rewritten. */
  async restoreSnapshot(commitOrTreeOid: string, options: GitRestoreOptions = {}): Promise<{ deletedIgnoredPaths: string[] }> {
    if (!(await this.isGitRepo())) {
      throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
    }

    const mode = options.mode ?? 'safe';
    const current = await this.inspectWorkspace();
    if (mode === 'safe' && options.expectedCurrentTreeOid && current.treeOid !== options.expectedCurrentTreeOid) {
      const details = await this.diffNameOnly(options.expectedCurrentTreeOid, current.treeOid);
      throw new WorkspaceDriftError(details.length ? details : ['managed files']);
    }
    if (mode === 'safe' && options.expectedCurrentIgnoredPaths) {
      const expected = new Set(options.expectedCurrentIgnoredPaths);
      const drift = symmetricDifference(expected, new Set(current.ignoredPaths));
      if (drift.length) throw new WorkspaceDriftError(drift.map(item => `(ignored) ${item}`));
    }

    const { stdout: treeStdout } = await this.runGit(['rev-parse', `${commitOrTreeOid}^{tree}`]);
    const targetTree = treeStdout.trim();
    const targetIgnored = new Set(options.targetIgnoredPaths ?? []);
    const ignoredToDelete = current.ignoredPaths.filter(item => !targetIgnored.has(item));
    const targetFiles = new Set(await this.listTreeFileNames(targetTree));
    const collisions = current.ignoredPaths.filter(item => targetFiles.has(item));
    if (collisions.length && !options.deleteNewIgnoredPaths) {
      throw new WorkspaceRestoreConflictError(collisions);
    }

    const deletedIgnoredPaths: string[] = [];
    if (options.deleteNewIgnoredPaths) {
      for (const relative of [...new Set([...ignoredToDelete, ...collisions])].sort(longestFirst)) {
        if (this.isPreservedRelative(relative)) continue;
        const absolute = await this.safeWorkspacePath(relative);
        if (options.ignoredBackupKey) await this.backupIgnoredPath(options.ignoredBackupKey, relative, absolute);
        await fs.rm(absolute, { recursive: true, force: true });
        deletedIgnoredPaths.push(relative);
      }
    }

    const root = await this.getRepoRoot();
    const { indexFile } = await this.writeWorkspaceTree();
    try {
      await this.runGit(['read-tree', '--reset', '-u', targetTree], { GIT_INDEX_FILE: indexFile }, root);
    } finally {
      await fs.rm(indexFile, { force: true }).catch(() => undefined);
    }
    return { deletedIgnoredPaths };
  }

  /** Restore only selected tracked workspace paths using a disposable index. */
  async restoreSelectedPaths(
    commitOrTreeOid: string,
    paths: string[],
    options: GitSelectiveRestoreOptions = {},
  ): Promise<string[]> {
    if (!(await this.isGitRepo())) throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
    const normalized = [...new Set(paths.map(normalizeGitPath).filter(Boolean))];
    if (normalized.length === 0) throw new Error('At least one workspace path is required.');
    for (const relative of normalized) await this.safeWorkspacePath(relative);

    const mode = options.mode ?? 'safe';
    const current = await this.inspectWorkspace();
    const ignoredSelection = current.ignoredPaths.filter(file => normalized.some(path => file === path || file.startsWith(`${path}/`)));
    if (ignoredSelection.length) throw new WorkspaceRestoreConflictError(ignoredSelection);
    if (mode === 'safe' && options.expectedCurrentTreeOid && current.treeOid !== options.expectedCurrentTreeOid) {
      const changed = await this.diffNameOnly(options.expectedCurrentTreeOid, current.treeOid);
      const selectedDrift = changed.filter(file => normalized.some(path => file === path || file.startsWith(`${path}/`)));
      if (selectedDrift.length) throw new WorkspaceDriftError(selectedDrift);
    }

    const { stdout: treeStdout } = await this.runGit(['rev-parse', `${commitOrTreeOid}^{tree}`]);
    const targetTree = treeStdout.trim();
    const targetFiles = await this.listTreeFileNames(targetTree);
    const currentFiles = await this.listTreeFileNames(current.treeOid);
    const selectedTargetFiles = targetFiles.filter(file => normalized.some(path => file === path || file.startsWith(`${path}/`)));
    const selectedCurrentFiles = currentFiles.filter(file => normalized.some(path => file === path || file.startsWith(`${path}/`)));
    if (selectedTargetFiles.length === 0 && selectedCurrentFiles.length === 0) {
      throw new Error(`None of the selected paths exist in the current or target snapshot: ${normalized.join(', ')}`);
    }
    const exportDir = path.join(await fs.mkdtemp(path.join(await fs.mkdtemp(path.join(this.workDir, '.dsh-tm-export-')), 'snapshot-')));
    const indexFile = path.join(await this.getGitDir(), `dsh-tm-index-${randomUUID()}`);
    try {
      await fs.mkdir(exportDir, { recursive: true });
      await this.runGit(['read-tree', targetTree], { GIT_INDEX_FILE: indexFile });
      await this.runGit(['checkout-index', '--all', `--prefix=${exportDir}${path.sep}`], { GIT_INDEX_FILE: indexFile });
      const targetSet = new Set(selectedTargetFiles);
      for (const relative of selectedCurrentFiles) {
        if (targetSet.has(relative)) continue;
        await fs.rm(await this.safeWorkspacePath(relative), { recursive: true, force: true });
      }
      for (const relative of selectedTargetFiles) {
        const source = path.join(exportDir, ...relative.split('/'));
        const destination = await this.safeWorkspacePath(relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rm(destination, { recursive: true, force: true });
        await fs.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
      }
      return normalized;
    } finally {
      await fs.rm(indexFile, { force: true }).catch(() => undefined);
      await fs.rm(path.dirname(exportDir), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Restore quarantined ignored content without ever writing it into Git objects. */
  async restoreIgnoredBackup(key: string): Promise<void> {
    if (!this.quarantineDir) return;
    const backupRoot = path.join(this.quarantineDir, encodeRefPart(key));
    const root = await this.getRepoRoot();
    const entries = await fs.readdir(backupRoot, { withFileTypes: true }).catch((error: any) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const source = path.join(backupRoot, entry.name);
      const destination = path.join(root, entry.name);
      await fs.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
    }
  }

  async getDiffBetween(baseOid: string, targetOid: string): Promise<DiffResult[]> {
    try {
      // Git accepts both commit-ish and tree-ish objects here. Keeping the
      // caller's object type matters for previews, where the live workspace is
      // represented by an unpublished tree object.
      const { stdout } = await this.runGit(['diff', '--no-ext-diff', baseOid, targetOid]);
      return this.parseUnifiedDiff(stdout);
    } catch {
      return [];
    }
  }

  private async writeWorkspaceTree(): Promise<{ treeOid: string; indexFile: string }> {
    const root = await this.getRepoRoot();
    const indexFile = path.join(await this.getGitDir(), `dsh-tm-index-${randomUUID()}`);
    const env = { GIT_INDEX_FILE: indexFile };
    try {
      try {
        await this.runGit(['read-tree', 'HEAD'], env, root);
      } catch {
        await this.runGit(['read-tree', '--empty'], env, root);
      }
      const protectedPaths = this.protectedRepoPaths(root);
      const { stdout: candidates } = await this.runGit([
        'ls-files', '-z', '--cached', '--modified', '--deleted', '--others', '--exclude-standard',
      ], {}, root);
      const candidateFiles = candidates.split('\0').filter(Boolean).map(normalizeGitPath).filter(file => !protectedPaths.some(
        relative => file === relative || file.startsWith(`${relative}/`),
      ));
      for (let offset = 0; offset < candidateFiles.length; offset += 128) {
        await this.runGit(['add', '-A', '--', ...candidateFiles.slice(offset, offset + 128)], env, root);
      }
      const { stdout: indexedFiles } = await this.runGit(['ls-files', '-z'], env, root);
      const indexedEntries = indexedFiles.split('\0').filter(Boolean);
      const protectedEntries = indexedEntries.filter(file => protectedPaths.some(
        relative => file === relative || file.startsWith(`${relative}/`),
      ));
      for (let offset = 0; offset < protectedEntries.length; offset += 128) {
        await this.runGit(
          ['update-index', '--force-remove', '--', ...protectedEntries.slice(offset, offset + 128)],
          env,
          root,
        );
      }
      const { stdout } = await this.runGit(['write-tree'], env, root);
      return { treeOid: stdout.trim(), indexFile };
    } catch (error) {
      await fs.rm(indexFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async listIgnoredPaths(): Promise<string[]> {
    const root = await this.getRepoRoot();
    const { stdout } = await this.runGit(['ls-files', '-z', '--others', '--ignored', '--exclude-standard'], {}, root);
    return stdout.split('\0').filter(Boolean).map(normalizeGitPath).filter(item => !this.isPreservedRelative(item)).sort();
  }

  private async listTreeFiles(treeOid: string): Promise<FileChange[]> {
    return (await this.listTreeFileNames(treeOid)).map(file => ({ path: file, status: 'added' }));
  }

  private async listTreeFileNames(treeOid: string): Promise<string[]> {
    const { stdout } = await this.runGit(['ls-tree', '-r', '-z', '--name-only', treeOid]);
    return stdout.split('\0').filter(Boolean).map(normalizeGitPath);
  }

  private async computeChangedFiles(parentCommitOid: string, currentCommitOid: string): Promise<FileChange[]> {
    try {
      const { stdout } = await this.runGit([
        'diff-tree', '-r', '--no-commit-id', '--name-status', '-z', parentCommitOid, currentCommitOid,
      ]);
      const fields = stdout.split('\0').filter(Boolean);
      const changes: FileChange[] = [];
      for (let index = 0; index + 1 < fields.length; index += 2) {
        const statusCode = fields[index].toUpperCase();
        const filePath = normalizeGitPath(fields[index + 1]);
        const status = statusCode.startsWith('A') ? 'added' : statusCode.startsWith('D') ? 'deleted' : 'modified';
        changes.push({ path: filePath, status });
      }
      return changes;
    } catch {
      return [];
    }
  }

  private async diffNameOnly(baseTree: string, targetTree: string): Promise<string[]> {
    try {
      const { stdout } = await this.runGit(['diff', '--name-only', '-z', baseTree, targetTree]);
      return stdout.split('\0').filter(Boolean).map(normalizeGitPath);
    } catch {
      return [];
    }
  }

  private protectedRepoPaths(repoRoot: string): string[] {
    return this.preservePaths.flatMap(absolute => {
      const relative = normalizeGitPath(path.relative(repoRoot, absolute));
      return relative && relative !== '..' && !relative.startsWith('../') ? [relative] : [];
    });
  }

  private isPreservedRelative(relative: string): boolean {
    const normalized = normalizeGitPath(relative);
    const repoRoot = this.repoRootCached ?? this.workDir;
    return this.preservePaths.some(absolute => {
      const candidate = normalizeGitPath(path.relative(repoRoot, absolute));
      return candidate === normalized || normalized.startsWith(`${candidate}/`);
    });
  }

  private async safeWorkspacePath(relative: string): Promise<string> {
    const root = await this.getRepoRoot();
    const absolute = path.resolve(root, relative);
    const relation = path.relative(root, absolute);
    if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new Error(`Unsafe workspace path: ${relative}`);
    }
    return absolute;
  }

  private async backupIgnoredPath(key: string, relative: string, absolute: string): Promise<void> {
    if (!this.quarantineDir) throw new Error('Ignored-path deletion requires a quarantineDir.');
    const destination = path.join(this.quarantineDir, encodeRefPart(key), ...relative.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(absolute, destination, { recursive: true, force: true, verbatimSymlinks: true });
  }

  private parseUnifiedDiff(rawDiff: string): DiffResult[] {
    const results: DiffResult[] = [];
    if (!rawDiff.trim()) return results;
    for (const chunk of rawDiff.split('diff --git ')) {
      if (!chunk.trim()) continue;
      const firstLine = chunk.split('\n', 1)[0];
      const match = firstLine.match(/a\/(.+?)\s+b\/(.+)/);
      const status = chunk.includes('new file mode') ? 'added' : chunk.includes('deleted file mode') ? 'deleted' : 'modified';
      results.push({ file: match ? match[2] : 'unknown', status, diffText: `diff --git ${chunk}` });
    }
    return results;
  }

  async cleanupSession(sessionId: string): Promise<void> {
    const namespace = `${this.refPrefix}/${encodeRefPart(sessionId)}`;
    const { stdout } = await this.runGit(['for-each-ref', '--format=%(refname)', namespace]).catch(() => ({ stdout: '', stderr: '' }));
    for (const ref of stdout.split('\n').filter(Boolean)) {
      await this.runGit(['update-ref', '-d', ref.trim()]);
    }
  }

  async deleteCheckpointRef(sessionId: string, checkpointId: string): Promise<boolean> {
    const ref = `${this.refPrefix}/${encodeRefPart(sessionId)}/nodes/${encodeRefPart(checkpointId)}`;
    const exists = await this.runGit(['show-ref', '--verify', '--quiet', ref]).then(() => true).catch(() => false);
    if (!exists) return false;
    await this.runGit(['update-ref', '-d', ref]);
    return true;
  }
}

function encodeRefPart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url') || '_';
}

function normalizeGitPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function symmetricDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter(item => !right.has(item)).concat([...right].filter(item => !left.has(item))).sort();
}

function longestFirst(left: string, right: string): number {
  return right.split('/').length - left.split('/').length || right.localeCompare(left);
}
