import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { URL } from 'node:url';
import type { TimeMachineService } from '../service.js';
import type { CheckpointNode } from '../types.js';

export interface TimeMachineWebHooks {
  restartConversation?: (sourceSessionId: string, checkpoint: CheckpointNode) => Promise<{ sessionId: string }>;
  /** Optional host-side session authority (for profiles exposing inspect()). */
  sessionExists?: (sessionId: string) => Promise<boolean>;
}

export class TimeMachineWebServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private service: TimeMachineService;
  private hooks: TimeMachineWebHooks;
  private allowedOrigins: Set<string>;

  constructor(service: TimeMachineService, port = 3088, host = '127.0.0.1', hooks: TimeMachineWebHooks = {}, allowedOrigins: readonly string[] = []) {
    this.service = service;
    this.port = port;
    this.host = host;
    this.hooks = hooks;
    this.allowedOrigins = new Set(allowedOrigins.map(normalizeOrigin).filter((origin): origin is string => origin !== undefined));
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");

        if (!this.isLocalRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cross-origin or non-loopback request rejected' }));
          return;
        }
        this.applyCorsHeaders(req, res);

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        try {
          const parsedUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
          const pathname = parsedUrl.pathname;

          // REST API 路由
          if (pathname.startsWith('/api/')) {
            await this.handleApi(req, res, pathname, parsedUrl.searchParams);
            return;
          }

          // 静态资源处理
          await this.handleStatic(res, pathname);
        } catch (err: any) {
          const status = err?.code === 'BAD_REQUEST' ? 400 : err?.code === 'SESSION_NOT_FOUND' ? 404 : err?.code === 'RESTORE_PLAN_INVALID' || err?.code === 'RESTORE_MERGE_CONFLICT' || err?.code === 'QUARANTINE_KEY_INVALID' || err?.code === 'EXTERNAL_COMPENSATION_UNKNOWN' || err?.code === 'EXTERNAL_ADAPTER_UNAVAILABLE' || err?.code === 'EXTERNAL_EFFECT_DUPLICATE' ? 409 : err?.code === 'UNSUPPORTED_WORKSPACE_STATE' ? 422 : err?.code === 'SNAPSHOT_SIZE_LIMIT' ? 413 : 500;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: err.message || 'Internal Server Error',
            ...(typeof err.code === 'string' ? { code: err.code } : {}),
            ...(err.details && typeof err.details === 'object' ? { details: err.details } : {}),
            ...(Array.isArray(err.paths) ? { paths: err.paths } : {}),
            ...(err.capabilities && typeof err.capabilities === 'object' ? { capabilities: err.capabilities } : {}),
          }));
        }
      });

      this.server.listen(this.port, this.host, () => {
        const host = this.host.includes(':') ? `[${this.host}]` : this.host;
        const url = `http://${host}:${this.port}`;
        resolve(url);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server?.close(() => resolve());
      });
    }
  }

  private async handleApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, query: URLSearchParams) {
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        workDir: this.service.workDir,
        version: '0.2.0',
      }));
      return;
    }

    if (pathname === '/api/dag' && req.method === 'GET') {
      const sessionId = query.get('sessionId');
      if (!sessionId?.trim()) throw Object.assign(new Error('sessionId is required'), { code: 'BAD_REQUEST' });
      await this.requirePersistedSession(sessionId);
      const dag = await this.service.getDAGManager(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dag.tree));
      return;
    }

    if (pathname === '/api/sessions' && req.method === 'GET') {
      const sessions = await this.listAvailableSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    if (pathname === '/api/storage' && req.method === 'GET') {
      const sessionId = query.get('sessionId') || undefined;
      const status = await this.service.getStorageStatus(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status }));
      return;
    }

    if (pathname === '/api/capabilities' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ capabilities: await this.service.getCapabilities() }));
      return;
    }

    if (pathname === '/api/agent-writes' && req.method === 'GET') {
      const sessionId = this.requireSessionId(query.get('sessionId'));
      const checkpointId = query.get('checkpoint') || '';
      if (!checkpointId) throw Object.assign(new Error('Missing checkpoint query parameter'), { code: 'BAD_REQUEST' });
      await this.requirePersistedSession(sessionId);
      const writes = await this.service.getAgentWriteLedger(sessionId, checkpointId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId, checkpointId, enabled: this.service.config.enableAgentWriteLedger === true, writes }));
      return;
    }

    if (pathname === '/api/unattributed-changes' && req.method === 'GET') {
      const sessionId = this.requireSessionId(query.get('sessionId'));
      const checkpointId = query.get('checkpoint') || '';
      if (!checkpointId) throw Object.assign(new Error('Missing checkpoint query parameter'), { code: 'BAD_REQUEST' });
      await this.requirePersistedSession(sessionId);
      const changes = await this.service.getUnattributedChanges(sessionId, checkpointId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId, checkpointId, changes }));
      return;
    }

    if (pathname === '/api/diff' && req.method === 'GET') {
      const sessionId = this.requireSessionId(query.get('sessionId'));
      const baseId = query.get('base') || '';
      const targetId = query.get('target') || '';
      await this.requirePersistedSession(sessionId);
      const diffs = await this.service.getDiff(sessionId, baseId, targetId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ diffs }));
      return;
    }

    if (pathname === '/api/preview' && req.method === 'GET') {
      const sessionId = this.requireSessionId(query.get('sessionId'));
      const checkpointId = query.get('checkpoint') || '';
      if (!checkpointId) throw Object.assign(new Error('Missing checkpoint query parameter'), { code: 'BAD_REQUEST' });
      await this.requirePersistedSession(sessionId);
      const preview = await this.service.previewRestore(sessionId, checkpointId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ preview }));
      return;
    }

    if (pathname === '/api/rewind' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const { sessionId, checkpointId } = body;
      if (typeof checkpointId !== 'string' || !checkpointId.trim()) {
        throw Object.assign(new Error('checkpointId is required'), { code: 'BAD_REQUEST' });
      }
      if (!this.hooks.restartConversation) throw new Error('Conversation restart capability is unavailable; refusing workspace-only rewind.');
      const sourceSessionId = this.requireSessionId(sessionId);
      await this.requirePersistedSession(sourceSessionId);
      const result = await this.service.rewindToCheckpoint(sourceSessionId, checkpointId, {
        mode: body.force === true ? 'force' : body.merge === true ? 'merge' : undefined,
        preserveVerifiedHandEdits: body.preserveVerifiedHandEdits === true,
        deleteNewIgnoredPaths: body.deleteNewIgnoredPaths === true,
        restorePlanId: typeof body.restorePlanId === 'string' ? body.restorePlanId : undefined,
      });
      let conversation: { sessionId: string };
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.targetNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        await this.service.completeRestoreJournal(result.restoreJournalId);
        throw error;
      }
      await this.service.completeRestoreJournal(result.restoreJournalId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result, conversation }));
      return;
    }

    if (pathname === '/api/restore-workspace' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const sessionId = this.requireSessionId(body.sessionId);
      if (typeof body.checkpointId !== 'string' || !body.checkpointId.trim()) {
        throw Object.assign(new Error('checkpointId is required'), { code: 'BAD_REQUEST' });
      }
      await this.requirePersistedSession(sessionId);
      const result = await this.service.restoreWorkspaceToCheckpoint(sessionId, body.checkpointId, {
        mode: body.force === true ? 'force' : body.merge === true ? 'merge' : undefined,
        preserveVerifiedHandEdits: body.preserveVerifiedHandEdits === true,
        deleteNewIgnoredPaths: body.deleteNewIgnoredPaths === true,
        restorePlanId: typeof body.restorePlanId === 'string' ? body.restorePlanId : undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }

    if (pathname === '/api/restore-files' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const sessionId = this.requireSessionId(body.sessionId);
      const paths = Array.isArray(body.paths) ? body.paths.filter((item: unknown): item is string => typeof item === 'string') : [];
      if (!body.checkpointId || paths.length === 0) throw Object.assign(new Error('checkpointId and non-empty paths are required'), { code: 'BAD_REQUEST' });
      await this.requirePersistedSession(sessionId);
      const result = await this.service.restoreSelectedPaths(sessionId, body.checkpointId, paths, {
        mode: body.force === true ? 'force' : body.merge === true ? 'merge' : undefined,
        restorePlanId: typeof body.restorePlanId === 'string' ? body.restorePlanId : undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }

    if (pathname === '/api/quarantine-migrate' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      if (typeof body.backupKey !== 'string' || !body.backupKey.trim() || /\s/.test(body.backupKey)) {
        throw Object.assign(new Error('backupKey is required and must not contain whitespace'), { code: 'BAD_REQUEST' });
      }
      const result = await this.service.migrateIgnoredBackup(body.backupKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }

    if (pathname === '/api/external-effects' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      if (typeof body.sessionId !== 'string' || typeof body.checkpointId !== 'string') {
        throw Object.assign(new Error('sessionId and checkpointId are required'), { code: 'BAD_REQUEST' });
      }
      if (typeof body.adapter !== 'string' || typeof body.operation !== 'string' || typeof body.failureSemantics !== 'string') {
        throw Object.assign(new Error('adapter, operation, and failureSemantics are required'), { code: 'BAD_REQUEST' });
      }
      if (typeof body.reversible !== 'boolean') {
        throw Object.assign(new Error('reversible must be a boolean'), { code: 'BAD_REQUEST' });
      }
      if (body.status !== undefined && !['unresolved', 'compensated', 'unknown'].includes(body.status)) {
        throw Object.assign(new Error('status must be unresolved, compensated, or unknown'), { code: 'BAD_REQUEST' });
      }
      if (body.id !== undefined && (typeof body.id !== 'string' || !body.id.trim() || /\s/.test(body.id))) {
        throw Object.assign(new Error('id must be a non-empty string without whitespace'), { code: 'BAD_REQUEST' });
      }
      const result = await this.service.recordExternalEffect(body.sessionId, body.checkpointId, {
        adapter: body.adapter,
        operation: body.operation,
        reversible: body.reversible,
        compensation: typeof body.compensation === 'string' ? body.compensation : undefined,
        failureSemantics: body.failureSemantics,
        status: body.status === undefined ? 'unresolved' : body.status,
        id: typeof body.id === 'string' ? body.id : undefined,
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, checkpoint: result }));
      return;
    }

    if (pathname === '/api/external-effects/compensate' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      if (typeof body.sessionId !== 'string' || typeof body.checkpointId !== 'string' || typeof body.effectId !== 'string') {
        throw Object.assign(new Error('sessionId, checkpointId, and effectId are required'), { code: 'BAD_REQUEST' });
      }
      if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== 'string') {
        throw Object.assign(new Error('idempotencyKey must be a string'), { code: 'BAD_REQUEST' });
      }
      const result = await this.service.compensateExternalEffect(body.sessionId, body.checkpointId, body.effectId, {
        execute: body.execute === true,
        idempotencyKey: body.idempotencyKey,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }

    if (pathname === '/api/prune' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const sessionId = this.requireSessionId(body.sessionId);
      await this.requirePersistedSession(sessionId);
      const keepLatest = body.keepLatest === undefined ? undefined : Number(body.keepLatest);
      const olderThanMs = body.olderThanMs === undefined ? undefined : Number(body.olderThanMs);
      if (keepLatest !== undefined && (!Number.isInteger(keepLatest) || keepLatest < 0)) {
        throw Object.assign(new Error('keepLatest must be a non-negative integer'), { code: 'BAD_REQUEST' });
      }
      if (olderThanMs !== undefined && (!Number.isSafeInteger(olderThanMs) || olderThanMs <= 0)) {
        throw Object.assign(new Error('olderThanMs must be a positive integer'), { code: 'BAD_REQUEST' });
      }
      const result = await this.service.prune(sessionId, {
        keepLatest,
        olderThanMs,
        abandonedBranches: body.abandonedBranches === true,
        compactHistory: body.compactHistory === true,
        repackShadowObjects: body.repackShadowObjects === true,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }

    if (pathname === '/api/fork' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const { sessionId, checkpointId, branchName, description } = body;
      if (typeof checkpointId !== 'string' || !checkpointId.trim() || typeof branchName !== 'string' || !branchName.trim()) {
        throw Object.assign(new Error('checkpointId and branchName are required'), { code: 'BAD_REQUEST' });
      }
      if (!this.hooks.restartConversation) throw new Error('Conversation restart capability is unavailable; refusing workspace-only fork.');
      const sourceSessionId = this.requireSessionId(sessionId);
      await this.requirePersistedSession(sourceSessionId);
      const result = await this.service.forkNewBranch({
        sessionId: sourceSessionId,
        fromCheckpointId: checkpointId,
        newBranchName: branchName,
        description,
        restore: {
          mode: body.force === true ? 'force' : body.merge === true ? 'merge' : undefined,
          restorePlanId: typeof body.restorePlanId === 'string' ? body.restorePlanId : undefined,
        },
      });
      let conversation: { sessionId: string };
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.forkedNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        await this.service.completeRestoreJournal(result.restoreJournalId);
        throw error;
      }
      await this.service.completeRestoreJournal(result.restoreJournalId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result, conversation }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = '';
      let size = 0;
      req.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 64 * 1024) {
          const error = Object.assign(new Error('JSON payload exceeds 64 KiB'), { code: 'BAD_REQUEST' });
          reject(error);
          req.destroy();
          return;
        }
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(Object.assign(new Error('Invalid JSON payload'), { code: 'BAD_REQUEST' }));
        }
      });
      req.on('error', reject);
    });
  }

  private async listAvailableSessions() {
    const sessions = await this.service.listSessions();
    if (!this.hooks.sessionExists) return sessions;
    const checks = await Promise.all(sessions.map(async session => ({
      session,
      exists: await this.hooks.sessionExists!(session.sessionId).catch(() => false),
    })));
    return checks.filter(item => item.exists).map(item => item.session);
  }

  private requireSessionId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw Object.assign(new Error('sessionId is required'), { code: 'BAD_REQUEST' });
    }
    return value.trim();
  }

  private async requirePersistedSession(sessionId: string): Promise<void> {
    if (!(await this.service.listSessions()).some(item => item.sessionId === sessionId)) {
      throw Object.assign(new Error(`Session '${sessionId}' does not exist.`), { code: 'SESSION_NOT_FOUND' });
    }
    if (this.hooks.sessionExists && !(await this.hooks.sessionExists(sessionId).catch(() => false))) {
      throw Object.assign(new Error(`Host session '${sessionId}' does not exist.`), { code: 'SESSION_NOT_FOUND' });
    }
  }

  private async handleStatic(res: http.ServerResponse, pathname: string) {
    const filePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    if (!['index.html', 'app.js', 'style.css'].includes(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    // 多路径智能嗅探：开发环境与打包发布环境均兼容
    const currentFileDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const candidateDirs = [
      path.join(currentFileDir, 'client'),
      path.join(currentFileDir, '../src/web/client'),
      path.join(currentFileDir, 'web/client'),
      path.join(process.cwd(), 'src/web/client'),
      path.join(process.cwd(), 'dist/client'),
    ];

    let fullPath = '';
    for (const dir of candidateDirs) {
      const candidate = path.resolve(dir, filePath);
      const relative = path.relative(path.resolve(dir), candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      try {
        await fs.access(candidate);
        fullPath = candidate;
        break;
      } catch {}
    }

    try {
      if (!fullPath) throw new Error('Asset not found');
      const content = await fs.readFile(fullPath);
      const ext = path.extname(fullPath);
      const contentTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
      };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(content);
    } catch {
      // 找不到文件时返回内置的基本备选 UI
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.getFallbackHtml());
    }
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><title>DSH Time Machine</title></head>
<body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc;">
  <h2>DSH Time Machine Server Active</h2>
  <p>Port: ${this.port} | Web UI Client Loaded</p>
</body>
</html>`;
  }

  private isLocalRequest(req: http.IncomingMessage): boolean {
    const hostHeader = req.headers.host ?? '';
    const hostname = hostHeader.startsWith('[')
      ? hostHeader.slice(1, hostHeader.indexOf(']'))
      : hostHeader.split(':', 1)[0];
    const allowed = new Set([this.host, '127.0.0.1', 'localhost', '::1']);
    if (!allowed.has(hostname)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    const normalizedOrigin = normalizeOrigin(origin);
    if (normalizedOrigin && this.allowedOrigins.has(normalizedOrigin)) return true;
    try {
      const parsedOrigin = new URL(origin);
      if (!allowed.has(parsedOrigin.hostname)) return false;
      return effectivePort(req.headers.host ?? '', parsedOrigin.protocol) === effectivePort(parsedOrigin.host, parsedOrigin.protocol);
    } catch {
      return false;
    }
  }

  private applyCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    const normalized = typeof origin === 'string' ? normalizeOrigin(origin) : undefined;
    if (!normalized || !this.allowedOrigins.has(normalized)) return;
    res.setHeader('Access-Control-Allow-Origin', origin!);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Vary', 'Origin');
  }

  private async compensate(sessionId: string, rescueCheckpointId?: string): Promise<void> {
    if (!rescueCheckpointId) return;
    await this.service.rewindToCheckpoint(sessionId, rescueCheckpointId, {
      mode: 'force',
      createRescuePoint: false,
    });
  }
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function effectivePort(hostHeader: string, protocol: string): string {
  const explicit = hostHeader.startsWith('[')
    ? hostHeader.slice(hostHeader.indexOf(']') + 2)
    : hostHeader.split(':').slice(1).join(':');
  if (explicit) return explicit;
  return protocol === 'https:' ? '443' : '80';
}
