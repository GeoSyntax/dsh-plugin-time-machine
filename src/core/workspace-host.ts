import fs from 'node:fs/promises';
import path from 'node:path';
import type { TimeMachineWorkspaceHost } from '../types.js';
import { validateWorkspaceRoute } from './workspace-route.js';

/**
 * Route a fork through the optional host adapter while preserving the current
 * single-root service invariant. This is intentionally independent of the Web
 * server so host integrations can test it without starting HTTP.
 */
export async function forkThroughWorkspaceHost(
  host: TimeMachineWorkspaceHost,
  sourceSessionId: string,
  atSeq: number | undefined,
  configuredRoot: string,
): Promise<{ sessionId: string }> {
  const route = await validateWorkspaceRoute(await host.resolveSessionWorkspace(sourceSessionId));
  const configured = path.resolve(await fs.realpath(configuredRoot).catch(() => configuredRoot));
  let routed: string;
  try {
    // Resolve again immediately before the host call. This closes the
    // symlink/junction replacement window between route validation and fork.
    routed = path.resolve(await fs.realpath(route.cwd));
  } catch {
    throw Object.assign(new Error(`Workspace route '${route.workspaceId}' changed before fork.`), { code: 'WORKSPACE_ROUTE_CHANGED' });
  }
  const sameRoot = process.platform === 'win32'
    ? configured.toLowerCase() === routed.toLowerCase()
    : configured === routed;
  if (!sameRoot) {
    throw Object.assign(new Error(`Workspace route '${route.workspaceId}' resolves outside the configured single-root service.`), { code: 'WORKSPACE_ROUTE_MISMATCH' });
  }
  const result = await host.forkSession({
    sourceSessionId,
    ...(atSeq !== undefined ? { atSeq } : {}),
    workspaceId: route.workspaceId,
    cwd: routed,
  });
  if (!result || typeof result.sessionId !== 'string' || !result.sessionId.trim()) {
    throw Object.assign(new Error('Workspace host returned an invalid child session id.'), { code: 'WORKSPACE_HOST_INVALID_RESULT' });
  }
  return { sessionId: result.sessionId };
}
