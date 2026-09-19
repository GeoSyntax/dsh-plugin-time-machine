import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceRoute } from '../types.js';

/** Validate and return a host route only when it names an existing cwd.
 *
 * `realpath` is authoritative here. On macOS, for example, the system may
 * expose the same directory through `/var` and `/private/var`; rejecting the
 * spelling supplied by the host would make an otherwise valid route fail.
 */
export async function validateWorkspaceRoute(route: WorkspaceRoute): Promise<WorkspaceRoute> {
  if (!route || typeof route.workspaceId !== 'string' || !route.workspaceId.trim() || /[\0\r\n]/.test(route.workspaceId)) {
    throw Object.assign(new Error('Workspace route workspaceId is invalid.'), { code: 'BAD_REQUEST' });
  }
  if (typeof route.cwd !== 'string' || !path.isAbsolute(route.cwd) || /[\0\r\n]/.test(route.cwd)) {
    throw Object.assign(new Error('Workspace route cwd must be an absolute path.'), { code: 'BAD_REQUEST' });
  }
  let canonicalPath: string;
  try {
    canonicalPath = path.resolve(await fs.realpath(route.cwd));
  } catch (error: any) {
    throw Object.assign(new Error('Workspace route cwd does not exist.'), { code: 'BAD_REQUEST' });
  }
  if (!['shared-lock', 'isolated-worktree', 'isolated-container'].includes(route.isolation)) {
    throw Object.assign(new Error('Workspace route isolation is invalid.'), { code: 'BAD_REQUEST' });
  }
  return { ...route, cwd: canonicalPath };
}
