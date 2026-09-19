import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { DiffResult, FileChange } from '../types.js';
import { SnapshotSizeError } from './git-plumbing.js';
import { assertNoSymlinkAncestors } from './path-safety.js';

export interface FallbackOptions {
  workDir: string;
  storageDir: string;
  preservePaths?: string[];
  maxSnapshotFileBytes?: number;
  maxSnapshotBytes?: number;
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
  private readonly maxSnapshotFileBytes: number;
  private readonly maxSnapshotBytes: number;

  constructor(options: FallbackOptions) {
    this.workDir = path.resolve(options.workDir);
    this.storageDir = path.resolve(options.storageDir);
    this.preservePaths = [this.storageDir, ...(options.preservePaths ?? []).map(item => path.resolve(this.workDir, item))];
    this.maxSnapshotFileBytes = Math.max(0, Math.floor(options.maxSnapshotFileBytes ?? 0));
    this.maxSnapshotBytes = Math.max(0, Math.floor(options.maxSnapshotBytes ?? 0));
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
      const plannedEntries = await this.scanTree(this.workDir);
      await this.assertSnapshotSize(plannedEntries);
      const entries = await this.captureTree(this.workDir, filesDir, plannedEntries);
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

  async inspectWorkspace(options: { omitPaths?: string[] } = {}): Promise<string> {
    const entries = await this.scanTree(this.workDir, options.omitPaths ?? []);
    return `fallback_${await hashSnapshot(this.workDir, entries)}`;
  }

  async snapshotTreeOid(sessionId: string, checkpointId: string, omitPaths: string[] = []): Promise<string> {
    const snapshot = await this.readSnapshot(sessionId, checkpointId);
    const entries = snapshot.manifest.entries.filter(entry => !isPathOmitted(entry.path, omitPaths));
    return `fallback_${await hashSnapshot(snapshot.filesDir, entries)}`;
  }

  /** Compare a persisted fallback manifest with the current workspace. */
  async getChangedFiles(sessionId: string, checkpointId: string): Promise<FileChange[]> {
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    const raw = await fs.readFile(path.join(snapshotDir, 'manifest.json'));
    const manifest = parseManifest(raw.toString('utf8'));
    const filesDir = path.join(snapshotDir, 'files');
    const current = await this.scanTree(this.workDir);
    const targetByPath = new Map(manifest.entries.filter(entry => entry.type !== 'directory').map(entry => [entry.path, entry]));
    const currentByPath = new Map(current.filter(entry => entry.type !== 'directory').map(entry => [entry.path, entry]));
    const paths = new Set([...targetByPath.keys(), ...currentByPath.keys()]);
    const changes: FileChange[] = [];
    for (const entryPath of [...paths].sort()) {
      const target = targetByPath.get(entryPath);
      const live = currentByPath.get(entryPath);
      if (!target && live) {
        changes.push({ path: entryPath, status: 'added' });
        continue;
      }
      if (target && !live) {
        changes.push({ path: entryPath, status: 'deleted' });
        continue;
      }
      if (target && live && !(await this.entriesEqual(target, live, filesDir))) {
        changes.push({ path: entryPath, status: 'modified' });
      }
    }
    return changes;
  }

  /** Produce reviewable text diffs between two persisted fallback snapshots. */
  async getDiffBetween(sessionId: string, baseCheckpointId: string, targetCheckpointId: string): Promise<DiffResult[]> {
    const base = await this.readSnapshot(sessionId, baseCheckpointId);
    const target = await this.readSnapshot(sessionId, targetCheckpointId);
    const baseByPath = new Map(base.manifest.entries.filter(entry => entry.type !== 'directory').map(entry => [entry.path, entry]));
    const targetByPath = new Map(target.manifest.entries.filter(entry => entry.type !== 'directory').map(entry => [entry.path, entry]));
    const paths = [...new Set([...baseByPath.keys(), ...targetByPath.keys()])].sort();
    const results: DiffResult[] = [];
    for (const file of paths) {
      const before = baseByPath.get(file);
      const after = targetByPath.get(file);
      const beforeContent = before ? await this.entryContent(before, base.filesDir) : undefined;
      const afterContent = after ? await this.entryContent(after, target.filesDir) : undefined;
      if (before && after && beforeContent !== undefined && afterContent !== undefined && beforeContent.equals(afterContent)) continue;
      const status: FileChange['status'] = !before ? 'added' : !after ? 'deleted' : 'modified';
      results.push({ file, status, diffText: renderFallbackDiff(file, beforeContent, afterContent) });
    }
    return results;
  }

  async restoreSnapshot(sessionId: string, checkpointId: string, options: { preservePaths?: string[] } = {}): Promise<void> {
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    const raw = await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8').catch((error: any) => {
      if (error?.code === 'ENOENT') throw new Error(`Fallback snapshot '${checkpointId}' is missing or uses an unsupported legacy format.`);
      throw error;
    });
    const manifest = parseManifest(raw);
    const filesDir = path.join(snapshotDir, 'files');
    const preservePaths = options.preservePaths ?? [];
    const targetPaths = new Set(manifest.entries.filter(entry => !isPathOmitted(entry.path, preservePaths)).map(entry => entry.path));
    const currentEntries = await this.scanTree(this.workDir);
    await assertNoSymlinkAncestors(this.workDir, [
      ...currentEntries.map(entry => entry.path),
      ...manifest.entries.map(entry => entry.path),
    ]);

    for (const entry of currentEntries.sort(deepestFirst)) {
      if (isPathOmitted(entry.path, preservePaths)) continue;
      if (targetPaths.has(entry.path)) continue;
      await fs.rm(this.resolveSafe(entry.path), { recursive: true, force: true });
    }

    for (const entry of manifest.entries.filter(item => item.type === 'directory' && !isPathOmitted(item.path, preservePaths)).sort(shallowestFirst)) {
      const destination = this.resolveSafe(entry.path);
      const stat = await fs.lstat(destination).catch(() => undefined);
      if (stat && !stat.isDirectory()) await fs.rm(destination, { recursive: true, force: true });
      await fs.mkdir(destination, { recursive: true, mode: entry.mode });
    }

    for (const entry of manifest.entries.filter(item => item.type !== 'directory' && !isPathOmitted(item.path, preservePaths))) {
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
    await assertNoSymlinkAncestors(this.workDir, [
      ...currentEntries.map(entry => entry.path),
      ...targetEntries.map(entry => entry.path),
    ]);
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

  async removeSnapshot(sessionId: string, checkpointId: string): Promise<number> {
    const target = this.getCheckpointDir(sessionId, checkpointId);
    const before = await directorySize(target);
    await fs.rm(target, { recursive: true, force: true });
    return before;
  }

  private async captureTree(sourceRoot: string, destinationRoot: string, plannedEntries?: SnapshotEntry[]): Promise<SnapshotEntry[]> {
    const entries = plannedEntries ?? await this.scanTree(sourceRoot);
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

  private async entriesEqual(target: SnapshotEntry, live: SnapshotEntry, filesDir: string): Promise<boolean> {
    if (target.type !== live.type || target.mode !== live.mode) return false;
    if (target.type === 'symlink') return target.linkTarget === live.linkTarget;
    if (target.type !== 'file') return true;
    const expected = await fs.readFile(path.join(filesDir, ...target.path.split('/'))).catch(() => undefined);
    const actual = await fs.readFile(path.join(this.workDir, ...live.path.split('/'))).catch(() => undefined);
    return Boolean(expected && actual && expected.equals(actual));
  }

  private async readSnapshot(sessionId: string, checkpointId: string): Promise<{ manifest: SnapshotManifest; filesDir: string }> {
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    const manifest = parseManifest(await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'));
    return { manifest, filesDir: path.join(snapshotDir, 'files') };
  }

  private async entryContent(entry: SnapshotEntry, filesDir: string): Promise<Buffer> {
    if (entry.type === 'file') return fs.readFile(path.join(filesDir, ...entry.path.split('/')));
    if (entry.type === 'symlink') return Buffer.from(`symlink -> ${entry.linkTarget ?? ''}\n`, 'utf8');
    return Buffer.alloc(0);
  }

  private async assertSnapshotSize(entries: SnapshotEntry[]): Promise<void> {
    if (this.maxSnapshotFileBytes <= 0 && this.maxSnapshotBytes <= 0) return;
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.type !== 'file') continue;
      const stat = await fs.stat(path.join(this.workDir, ...entry.path.split('/')));
      if (this.maxSnapshotFileBytes > 0 && stat.size > this.maxSnapshotFileBytes) {
        throw new SnapshotSizeError({ file: entry.path, fileBytes: stat.size, limitBytes: this.maxSnapshotFileBytes });
      }
      totalBytes += stat.size;
      if (this.maxSnapshotBytes > 0 && totalBytes > this.maxSnapshotBytes) {
        throw new SnapshotSizeError({ totalBytes, limitBytes: this.maxSnapshotBytes });
      }
    }
  }

  private async scanTree(root: string, omitPaths: string[] = []): Promise<SnapshotEntry[]> {
    const entries: SnapshotEntry[] = [];
    const visit = async (directory: string, relative = ''): Promise<void> => {
      for (const dirent of await fs.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, dirent.name);
        if (this.isPreserved(absolute)) continue;
        const childRelative = relative ? `${relative}/${dirent.name}` : dirent.name;
        validateRelativePath(childRelative);
        if (isPathOmitted(childRelative, omitPaths)) continue;
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

function isPathOmitted(value: string, omitPaths: string[]): boolean {
  return omitPaths.some(item => value === item || value.startsWith(`${item}/`));
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

function renderFallbackDiff(file: string, before: Buffer | undefined, after: Buffer | undefined): string {
  if (before?.includes(0) || after?.includes(0)) return `Binary files a/${file} and b/${file} differ`;
  const oldLines = splitDiffLines(before);
  const newLines = splitDiffLines(after);
  const maxLines = 2000;
  if (oldLines.length > maxLines || newLines.length > maxLines) {
    return [`--- a/${file}`, `+++ b/${file}`, '@@', ...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`)].join('\n');
  }
  const commonPrefix = sharedPrefix(oldLines, newLines);
  const commonSuffix = sharedSuffix(oldLines, newLines, commonPrefix);
  const removed = oldLines.slice(commonPrefix, oldLines.length - commonSuffix);
  const added = newLines.slice(commonPrefix, newLines.length - commonSuffix);
  const contextBefore = oldLines.slice(Math.max(0, commonPrefix - 3), commonPrefix);
  const contextAfter = oldLines.slice(oldLines.length - commonSuffix, Math.min(oldLines.length, oldLines.length - commonSuffix + 3));
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${Math.max(1, commonPrefix - contextBefore.length + 1)},${contextBefore.length + removed.length} +${Math.max(1, commonPrefix - contextBefore.length + 1)},${contextBefore.length + added.length} @@`,
    ...contextBefore.map(line => ` ${line}`),
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
    ...contextAfter.map(line => ` ${line}`),
  ].join('\n');
}

function splitDiffLines(content: Buffer | undefined): string[] {
  if (!content) return [];
  const text = content.toString('utf8');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function sharedPrefix(left: string[], right: string[]): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function sharedSuffix(left: string[], right: string[], prefix: number): number {
  let count = 0;
  while (left.length - count > prefix && right.length - count > prefix && left[left.length - count - 1] === right[right.length - count - 1]) count += 1;
  return count;
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += (await fs.stat(absolute).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}
