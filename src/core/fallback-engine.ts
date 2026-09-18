import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { FileChange } from '../types.js';

export interface FallbackOptions {
  workDir: string;
  storageDir: string;
  preservePaths?: string[];
}

interface SnapshotEntry {
  path: string;
  type: 'directory' | 'file' | 'symlink';
  mode: number;
  linkTarget?: string;
}

interface SnapshotManifest {
  version: 1;
  entries: SnapshotEntry[];
  treeOid: string;
}

/** Exact-copy fallback for ordinary directories, including deletions and symlinks. */
export class FallbackSnapshotEngine {
  public readonly workDir: string;
  public readonly storageDir: string;
  private readonly preservePaths: string[];

  constructor(options: FallbackOptions) {
    this.workDir = path.resolve(options.workDir);
    this.storageDir = path.resolve(options.storageDir);
    this.preservePaths = [this.storageDir, ...(options.preservePaths ?? []).map(item => path.resolve(this.workDir, item))];
  }

  private getCheckpointDir(sessionId: string, checkpointId: string): string {
    const sessionKey = Buffer.from(sessionId, 'utf8').toString('base64url') || '_';
    const checkpointKey = Buffer.from(checkpointId, 'utf8').toString('base64url') || '_';
    return path.join(this.storageDir, sessionKey, checkpointKey);
  }

  async createSnapshot(params: {
    sessionId: string;
    checkpointId: string;
  }): Promise<{ treeOid: string; commitOid: string; changedFiles: FileChange[] }> {
    const targetDir = this.getCheckpointDir(params.sessionId, params.checkpointId);
    const temporary = `${targetDir}.${randomUUID()}.tmp`;
    const filesDir = path.join(temporary, 'files');
    await fs.mkdir(filesDir, { recursive: true });

    try {
      const entries = await this.captureTree(this.workDir, filesDir);
      const treeOid = await hashSnapshot(filesDir, entries);
      const manifest: SnapshotManifest = { version: 1, entries, treeOid };
      await fs.writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.rename(temporary, targetDir);
      return {
        treeOid: `fallback_${treeOid}`,
        commitOid: `fallback_${treeOid}`,
        changedFiles: entries.filter(entry => entry.type !== 'directory').map(entry => ({ path: entry.path, status: 'modified' })),
      };
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async inspectWorkspace(): Promise<string> {
    const entries = await this.scanTree(this.workDir);
    return `fallback_${await hashSnapshot(this.workDir, entries)}`;
  }

  async restoreSnapshot(sessionId: string, checkpointId: string): Promise<void> {
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    const raw = await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8').catch((error: any) => {
      if (error?.code === 'ENOENT') throw new Error(`Fallback snapshot '${checkpointId}' is missing or uses an unsupported legacy format.`);
      throw error;
    });
    const manifest = parseManifest(raw);
    const filesDir = path.join(snapshotDir, 'files');
    const targetPaths = new Set(manifest.entries.map(entry => entry.path));
    const currentEntries = await this.scanTree(this.workDir);

    for (const entry of currentEntries.sort(deepestFirst)) {
      if (targetPaths.has(entry.path)) continue;
      await fs.rm(this.resolveSafe(entry.path), { recursive: true, force: true });
    }

    for (const entry of manifest.entries.filter(item => item.type === 'directory').sort(shallowestFirst)) {
      const destination = this.resolveSafe(entry.path);
      const stat = await fs.lstat(destination).catch(() => undefined);
      if (stat && !stat.isDirectory()) await fs.rm(destination, { recursive: true, force: true });
      await fs.mkdir(destination, { recursive: true, mode: entry.mode });
    }

    for (const entry of manifest.entries.filter(item => item.type !== 'directory')) {
      const destination = this.resolveSafe(entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rm(destination, { recursive: true, force: true });
      if (entry.type === 'file') {
        await fs.copyFile(path.join(filesDir, ...entry.path.split('/')), destination);
        await fs.chmod(destination, entry.mode).catch(() => undefined);
      } else {
        await fs.symlink(entry.linkTarget!, destination);
      }
    }
  }

  async restoreSelectedPaths(
    sessionId: string,
    checkpointId: string,
    paths: string[],
    options: { expectedCurrentTreeOid?: string; mode?: 'safe' | 'force' } = {},
  ): Promise<string[]> {
    const normalized = [...new Set(paths.map(normalizeFallbackPath).filter(Boolean))];
    if (normalized.length === 0) throw new Error('At least one workspace path is required.');
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    if ((options.mode ?? 'safe') === 'safe' && options.expectedCurrentTreeOid) {
      const currentTree = await this.inspectWorkspace();
      if (currentTree !== options.expectedCurrentTreeOid) {
        throw new Error(`Workspace changed after the latest checkpoint: expected ${options.expectedCurrentTreeOid}, observed ${currentTree}`);
      }
    }
    const raw = await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8');
    const manifest = parseManifest(raw);
    const filesDir = path.join(snapshotDir, 'files');
    const selected = (entry: SnapshotEntry) => normalized.some(item => entry.path === item || entry.path.startsWith(`${item}/`));
    const currentEntries = (await this.scanTree(this.workDir)).filter(selected).sort(deepestFirst);
    const targetEntries = manifest.entries.filter(selected);
    if (currentEntries.length === 0 && targetEntries.length === 0) {
      throw new Error(`None of the selected paths exist in the current or target snapshot: ${normalized.join(', ')}`);
    }
    const targetPaths = new Set(targetEntries.map(entry => entry.path));
    for (const entry of currentEntries) {
      if (!targetPaths.has(entry.path)) await fs.rm(this.resolveSafe(entry.path), { recursive: true, force: true });
    }
    for (const entry of targetEntries.filter(item => item.type === 'directory').sort(shallowestFirst)) {
      const destination = this.resolveSafe(entry.path);
      await fs.mkdir(destination, { recursive: true, mode: entry.mode });
    }
    for (const entry of targetEntries.filter(item => item.type !== 'directory')) {
      const destination = this.resolveSafe(entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rm(destination, { recursive: true, force: true });
      if (entry.type === 'file') {
        await fs.copyFile(path.join(filesDir, ...entry.path.split('/')), destination);
        await fs.chmod(destination, entry.mode).catch(() => undefined);
      } else {
        await fs.symlink(entry.linkTarget!, destination);
      }
    }
    return normalized;
  }

  private async captureTree(sourceRoot: string, destinationRoot: string): Promise<SnapshotEntry[]> {
    const entries = await this.scanTree(sourceRoot);
    for (const entry of entries) {
      const source = path.join(sourceRoot, ...entry.path.split('/'));
      const destination = path.join(destinationRoot, ...entry.path.split('/'));
      if (entry.type === 'directory') {
        await fs.mkdir(destination, { recursive: true, mode: entry.mode });
      } else if (entry.type === 'file') {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
      }
    }
    return entries;
  }

  private async scanTree(root: string): Promise<SnapshotEntry[]> {
    const entries: SnapshotEntry[] = [];
    const visit = async (directory: string, relative = ''): Promise<void> => {
      for (const dirent of await fs.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, dirent.name);
        if (this.isPreserved(absolute)) continue;
        const childRelative = relative ? `${relative}/${dirent.name}` : dirent.name;
        validateRelativePath(childRelative);
        const stat = await fs.lstat(absolute);
        const mode = stat.mode & 0o777;
        if (stat.isSymbolicLink()) {
          entries.push({ path: childRelative, type: 'symlink', mode, linkTarget: await fs.readlink(absolute) });
        } else if (stat.isDirectory()) {
          entries.push({ path: childRelative, type: 'directory', mode });
          await visit(absolute, childRelative);
        } else if (stat.isFile()) {
          entries.push({ path: childRelative, type: 'file', mode });
        }
      }
    };
    await visit(root);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  private isPreserved(absolute: string): boolean {
    const resolved = path.resolve(absolute);
    return this.preservePaths.some(base => resolved === base || resolved.startsWith(`${base}${path.sep}`));
  }

  private resolveSafe(relative: string): string {
    validateRelativePath(relative);
    const absolute = path.resolve(this.workDir, ...relative.split('/'));
    const relation = path.relative(this.workDir, absolute);
    if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new Error(`Unsafe snapshot path '${relative}'.`);
    }
    if (this.isPreserved(absolute)) throw new Error(`Snapshot path overlaps protected storage: '${relative}'.`);
    return absolute;
  }
}

async function hashSnapshot(root: string, entries: SnapshotEntry[]): Promise<string> {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(`${entry.type}\0${entry.path}\0${entry.mode}\0${entry.linkTarget ?? ''}\0`);
    if (entry.type === 'file') hash.update(await fs.readFile(path.join(root, ...entry.path.split('/'))));
  }
  return hash.digest('hex');
}

function parseManifest(raw: string): SnapshotManifest {
  const parsed = JSON.parse(raw) as SnapshotManifest;
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || typeof parsed.treeOid !== 'string') {
    throw new Error('Fallback snapshot manifest is corrupt.');
  }
  for (const entry of parsed.entries) {
    validateRelativePath(entry.path);
    if (!['directory', 'file', 'symlink'].includes(entry.type)) throw new Error(`Invalid snapshot entry type for '${entry.path}'.`);
    if (entry.type === 'symlink' && typeof entry.linkTarget !== 'string') throw new Error(`Invalid symlink target for '${entry.path}'.`);
  }
  return parsed;
}

function validateRelativePath(value: string): void {
  if (!value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value) || value.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe relative path '${value}'.`);
  }
}

function normalizeFallbackPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  validateRelativePath(normalized);
  return normalized;
}

function deepestFirst(left: SnapshotEntry, right: SnapshotEntry): number {
  return right.path.split('/').length - left.path.split('/').length || right.path.localeCompare(left.path);
}

function shallowestFirst(left: SnapshotEntry, right: SnapshotEntry): number {
  return left.path.split('/').length - right.path.split('/').length || left.path.localeCompare(right.path);
}
