import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import type { FileChange, DiffResult } from '../types.js';

const execFileAsync = promisify(execFile);

export interface GitPlumbingOptions {
  workDir: string;
  refPrefix?: string;
  preservePaths?: string[];
  quarantineDir?: string;
  /** Optional object directory for plugin-created objects. */
  shadowObjectDir?: string;
  /** Hard limit for ignored-file quarantine bytes; 0 disables the guard. */
  maxQuarantineBytes?: number;
}

export interface GitSnapshot {
  treeOid: string;
  commitOid: string;
  changedFiles: FileChange[];
  ignoredPaths: string[];
}

export interface ShadowGcResult {
  removedObjects: number;
  reclaimedBytes: number;
  packedObjectsSkipped: boolean;
}

export interface ShadowRepackResult {
  repacked: boolean;
  removedPackFiles: number;
  reclaimedBytes: number;
  reachableRefs: number;
  skippedReason?: string;
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

export class QuarantineQuotaError extends Error {
  readonly code = 'QUARANTINE_QUOTA_EXCEEDED';

  constructor(public readonly limitBytes: number, public readonly requiredBytes: number) {
    super(`Ignored-file quarantine limit exceeded: ${requiredBytes} > ${limitBytes} bytes.`);
    this.name = 'QuarantineQuotaError';
  }
}

export class GitPlumbingEngine {
  public readonly workDir: string;
  public readonly refPrefix: string;
  private preservePaths: string[];
  private readonly quarantineDir?: string;
  private isRepoCached: boolean | null = null;
  private repoRootCached: string | null = null;
  private gitDirCached: string | null = null;
  private readonly shadowObjectDir?: string;
  private readonly maxQuarantineBytes: number;
  private shadowReady?: Promise<void>;

  constructor(options: GitPlumbingOptions) {
    this.workDir = path.resolve(options.workDir);
    this.refPrefix = options.refPrefix || 'refs/dsh-tm';
    this.preservePaths = (options.preservePaths ?? []).map(item => path.resolve(this.workDir, item));
    this.quarantineDir = options.quarantineDir ? path.resolve(options.quarantineDir) : undefined;
    this.shadowObjectDir = options.shadowObjectDir ? path.resolve(options.shadowObjectDir) : undefined;
    this.maxQuarantineBytes = Math.max(0, Math.floor(options.maxQuarantineBytes ?? 0));
  }

  get usesShadowStore(): boolean {
    return Boolean(this.shadowObjectDir);
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
    this.repoRootCached = await fs.realpath(path.resolve(stdout.trim())).catch(() => path.resolve(stdout.trim()));
    this.preservePaths = await Promise.all(this.preservePaths.map(async absolute => (
      await fs.realpath(absolute).catch(() => absolute)
    )));
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
    await this.ensureShadowStore();
    const env = this.gitEnv(extraEnv);
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
    const targetEntries = this.shadowObjectDir ? await this.listTreeEntries(targetTree) : [];
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
      const restoreArgs = this.shadowObjectDir
        ? ['read-tree', '--reset', targetTree]
        : ['read-tree', '--reset', '-u', targetTree];
      await this.runGit(restoreArgs, { GIT_INDEX_FILE: indexFile }, root);
      if (this.shadowObjectDir) {
        const currentFiles = await this.listTreeFileNames(current.treeOid);
        for (const entry of targetEntries) {
          const destination = await this.safeWorkspacePath(entry.path);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.rm(destination, { recursive: true, force: true });
          const content = await this.readShadowBlob(entry.oid, root);
          if (entry.mode === '120000') {
            await fs.symlink(content.toString('utf8'), destination);
          } else {
            await fs.writeFile(destination, content);
            await fs.chmod(destination, Number.parseInt(entry.mode, 8) & 0o777).catch(() => undefined);
          }
        }
        for (const relative of currentFiles.filter(file => !targetFiles.has(file)).sort(longestFirst)) {
          await fs.rm(await this.safeWorkspacePath(relative), { recursive: true, force: true });
        }
      }
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

  /** Remove a quarantine backup only after the DAG no longer references its key. */
  async removeIgnoredBackup(key: string): Promise<number> {
    if (!this.quarantineDir) return 0;
    const backupRoot = path.join(this.quarantineDir, encodeRefPart(key));
    const reclaimed = await directoryBytes(backupRoot);
    await fs.rm(backupRoot, { recursive: true, force: true });
    return reclaimed;
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

  private async runGitBuffer(args: string[], extraEnv: Record<string, string> = {}, cwd = this.workDir): Promise<Buffer> {
    await this.ensureShadowStore();
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, env: this.gitEnv(extraEnv), windowsHide: true });
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];
      child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
      child.stderr.on('data', chunk => errors.push(Buffer.from(chunk)));
      child.once('error', reject);
      child.once('close', code => {
        if (code === 0) return resolve(Buffer.concat(chunks));
        reject(new Error(`Git plumbing command failed: git ${args.join(' ')}\nReason: ${Buffer.concat(errors).toString('utf8')}`));
      });
    });
  }

  private async readShadowBlob(oid: string, cwd: string): Promise<Buffer> {
    if (this.shadowObjectDir) {
      const loose = path.join(this.shadowObjectDir, oid.slice(0, 2), oid.slice(2));
      const compressed = await fs.readFile(loose).catch(() => undefined);
      if (compressed) {
        try {
          const inflated = zlib.inflateSync(compressed);
          const separator = inflated.indexOf(0);
          if (separator >= 0) return inflated.subarray(separator + 1);
        } catch {
          // Fall back to Git for packed or unusual object formats.
        }
      }
    }
    return this.runGitBuffer(['cat-file', 'blob', oid], {}, cwd);
  }

  private gitEnv(extraEnv: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      ...extraEnv,
    };
    if (this.shadowObjectDir) {
      env.GIT_OBJECT_DIRECTORY = this.shadowObjectDir;
      const primaryObjects = path.join(this.gitDirCached ?? path.join(this.workDir, '.git'), 'objects');
      env.GIT_ALTERNATE_OBJECT_DIRECTORIES = [primaryObjects, env.GIT_ALTERNATE_OBJECT_DIRECTORIES]
        .filter(Boolean).map(item => item!.replace(/\\/g, '/')).join(path.delimiter);
    }
    return env;
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

  private async listTreeEntries(treeOid: string): Promise<Array<{ mode: string; oid: string; path: string }>> {
    const { stdout } = await this.runGit(['ls-tree', '-r', '-z', treeOid]);
    return stdout.split('\0').filter(Boolean).map(record => {
      const tab = record.indexOf('\t');
      const [mode, _type, oid] = record.slice(0, tab).split(' ');
      return { mode, oid, path: normalizeGitPath(record.slice(tab + 1)) };
    });
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
    if (this.maxQuarantineBytes > 0) {
      const currentBytes = await directoryBytes(this.quarantineDir);
      const incomingBytes = await directoryBytes(absolute);
      const existingBytes = await directoryBytes(path.dirname(destination));
      const requiredBytes = currentBytes - existingBytes + incomingBytes;
      if (requiredBytes > this.maxQuarantineBytes) throw new QuarantineQuotaError(this.maxQuarantineBytes, requiredBytes);
    }
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

  /** Remove unreachable loose objects from the opt-in shadow store only. */
  async pruneShadowObjects(): Promise<ShadowGcResult> {
    if (!this.shadowObjectDir) return { removedObjects: 0, reclaimedBytes: 0, packedObjectsSkipped: false };
    const { stdout: refs } = await this.runGit(['for-each-ref', '--format=%(refname)', this.refPrefix]).catch(() => ({ stdout: '', stderr: '' }));
    const refNames = refs.split('\n').map(item => item.trim()).filter(Boolean);
    const reachable = new Set<string>();
    if (refNames.length) {
      const { stdout } = await this.runGit(['rev-list', '--objects', ...refNames]);
      for (const line of stdout.split('\n')) {
        const oid = line.trim().split(/\s+/, 1)[0];
        if (/^[0-9a-f]{40}$/.test(oid)) reachable.add(oid);
      }
    }
    let removedObjects = 0;
    let reclaimedBytes = 0;
    const entries = await fs.readdir(this.shadowObjectDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
    let packedObjectsSkipped = false;
    for (const entry of entries) {
      if (entry.name === 'pack' && entry.isDirectory()) {
        packedObjectsSkipped = (await fs.readdir(path.join(this.shadowObjectDir, entry.name)).catch(() => [])).length > 0;
        continue;
      }
      if (!entry.isDirectory() || !/^[0-9a-f]{2}$/.test(entry.name)) continue;
      const directory = path.join(this.shadowObjectDir, entry.name);
      for (const object of await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
        if (!object.isFile() || !/^[0-9a-f]{38}$/.test(object.name)) continue;
        const oid = `${entry.name}${object.name}`;
        if (reachable.has(oid)) continue;
        const file = path.join(directory, object.name);
        reclaimedBytes += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
        await fs.rm(file, { force: true });
        removedObjects += 1;
      }
      await fs.rmdir(directory).catch(() => undefined);
    }
    return { removedObjects, reclaimedBytes, packedObjectsSkipped };
  }

  /** Rebuild only the opt-in shadow pack from the plugin's private refs. */
  async repackShadowObjects(): Promise<ShadowRepackResult> {
    if (!this.shadowObjectDir) return { repacked: false, removedPackFiles: 0, reclaimedBytes: 0, reachableRefs: 0 };
    const { stdout: refsOutput } = await this.runGit(['for-each-ref', '--format=%(objectname)', this.refPrefix]).catch(() => ({ stdout: '', stderr: '' }));
    const refs = refsOutput.split('\n').map(item => item.trim()).filter(item => /^[0-9a-f]{40}$/.test(item));
    const packDir = path.join(this.shadowObjectDir, 'pack');
    const existing = await fs.readdir(packDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
    const existingPackFiles = existing.filter(entry => entry.isFile() && /^pack-[0-9a-f]{40}\.(pack|idx|bitmap|rev|mtimes)$/.test(entry.name));
    const lockedPack = existing.some(entry => entry.isFile() && /^pack-[0-9a-f]{40}\.keep$/.test(entry.name));
    if (lockedPack) return { repacked: false, removedPackFiles: 0, reclaimedBytes: 0, reachableRefs: refs.length, skippedReason: 'shadow pack contains a .keep file' };
    const existingBytes = await sumFileSizes(existingPackFiles.map(entry => path.join(packDir, entry.name)));
    const tempDir = path.join(this.shadowObjectDir, `.repack-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });
    let generatedFiles: string[] = [];
    try {
      if (refs.length) {
        const prefix = path.join(tempDir, 'pack');
        await this.runGitInput(['pack-objects', '--revs', '--no-reuse-object', '--delta-base-offset', prefix], `${refs.join('\n')}\n`);
        generatedFiles = (await fs.readdir(tempDir, { withFileTypes: true }))
          .filter(entry => entry.isFile() && /^(pack-[0-9a-f]{40})\.(pack|idx)$/.test(entry.name))
          .map(entry => entry.name);
      }
      await fs.mkdir(packDir, { recursive: true });
      for (const file of generatedFiles) {
        const destination = path.join(packDir, file);
        const source = path.join(tempDir, file);
        const alreadyPresent = await fs.access(destination).then(() => true).catch(() => false);
        if (alreadyPresent) await fs.rm(source, { force: true });
        else await fs.rename(source, destination);
      }
      const keep = new Set(generatedFiles);
      let removedPackFiles = 0;
      let reclaimedBytes = 0;
      for (const entry of existingPackFiles) {
        if (keep.has(entry.name)) continue;
        const file = path.join(packDir, entry.name);
        reclaimedBytes += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
        await fs.rm(file, { force: true });
        removedPackFiles += 1;
      }
      await fs.rm(path.join(this.shadowObjectDir, 'info', 'packs'), { force: true }).catch(() => undefined);
      return {
        repacked: refs.length > 0 && generatedFiles.length > 0,
        removedPackFiles,
        reclaimedBytes: Math.max(reclaimedBytes, existingBytes - await sumFileSizes(generatedFiles.map(file => path.join(packDir, file)))),
        reachableRefs: refs.length,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async ensureShadowStore(): Promise<void> {
    if (!this.shadowObjectDir) return;
    this.shadowReady ??= fs.mkdir(this.shadowObjectDir, { recursive: true }).then(() => undefined);
    await this.shadowReady;
  }

  private async runGitInput(args: string[], input: string, cwd = this.workDir): Promise<{ stdout: string; stderr: string }> {
    await this.ensureShadowStore();
    const env = this.gitEnv({});
    return await new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
      child.once('error', reject);
      child.once('close', code => {
        const out = Buffer.concat(stdout).toString('utf8');
        const err = Buffer.concat(stderr).toString('utf8');
        if (code === 0) resolve({ stdout: out, stderr: err });
        else reject(new Error(`Git plumbing command failed: git ${args.join(' ')}\nReason: ${err || out || `exit ${code}`}`));
      });
      child.stdin.end(input, 'utf8');
    });
  }
}

async function sumFileSizes(files: string[]): Promise<number> {
  let total = 0;
  for (const file of files) total += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
  return total;
}

async function directoryBytes(root: string): Promise<number> {
  const rootStat = await fs.stat(root).catch(() => undefined);
  if (rootStat?.isFile()) return rootStat.size;
  let total = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(absolute);
    else total += (await fs.stat(absolute).catch(() => ({ size: 0 }))).size;
  }
  return total;
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
