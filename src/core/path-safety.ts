import fs from 'node:fs/promises';
import path from 'node:path';

/** Raised before restore when a path would traverse an unsafe ancestor. */
export class WorkspacePathSafetyError extends Error {
  readonly code = 'UNSUPPORTED_WORKSPACE_STATE';

  constructor(public readonly paths: string[]) {
    super(`Workspace restore paths traverse symbolic-link or non-directory ancestors: ${paths.join(', ')}`);
    this.name = 'WorkspacePathSafetyError';
  }
}

/** Fail closed before any mutation if a restore path leaves the workspace through an ancestor. */
export async function assertNoSymlinkAncestors(root: string, relativePaths: readonly string[]): Promise<void> {
  const unsafe = new Set<string>();
  for (const relative of relativePaths) {
    const normalized = relative.replaceAll('\\', '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    let cursor = path.resolve(root);
    const traversed: string[] = [];
    for (const part of parts.slice(0, -1)) {
      traversed.push(part);
      cursor = path.join(cursor, part);
      const stat = await fs.lstat(cursor).catch(() => undefined);
      if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) {
        unsafe.add(traversed.join('/'));
        break;
      }
    }
  }
  if (unsafe.size) throw new WorkspacePathSafetyError([...unsafe].sort());
}
