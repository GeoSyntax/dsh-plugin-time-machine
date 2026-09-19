import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceRoute } from '../types.js';

/** Validate and return a host route only when it names an existing canonical cwd. */
export async function validateWorkspaceRoute(route: WorkspaceRoute): Promise<WorkspaceRoute> {
  if (!route || typeof route.workspaceId !== 'string' || !route.workspaceId.trim() || /[\0\r\n]/.test(route.workspaceId)) {
    throw Object.assign(new Error('Workspace route workspaceId is invalid.'), { code: 'BAD_REQUEST' });
  }
  if (typeof route.cwd !== 'string' || !path.isAbsolute(route.cwd) || /[\0\r\n]/.test(route.cwd)) {
    throw Object.assign(new Error('Workspace route cwd must be an absolute path.'), { code: 'BAD_REQUEST' });
  }
  try {
    const canonical = await fs.realpath(route.cwd);
    const canonicalPath = path.resolve(canonical);
    const requestedPath = path.resolve(route.cwd);
    const samePath = process.platform === 'win32'
      ? canonicalPath.toLowerCase() === requestedPath.toLowerCase()
      : canonicalPath === requestedPath;
    if (!samePath) throw Object.assign(new Error('Workspace route cwd must be a canonical real path.'), { code: 'BAD_REQUEST' });
  } catch (error: any) {
    if (error?.code === 'BAD_REQUEST') throw error;
    throw Object.assign(new Error('Workspace route cwd does not exist.'), { code: 'BAD_REQUEST' });
  }
  if (!['shared-lock', 'isolated-worktree', 'isolated-container'].includes(route.isolation)) {
    throw Object.assign(new Error('Workspace route isolation is invalid.'), { code: 'BAD_REQUEST' });
  }
  return route;
}
