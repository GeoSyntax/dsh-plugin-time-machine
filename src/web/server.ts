import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { URL } from 'node:url';
import type { TimeMachineService } from '../service.js';
import type { CheckpointNode } from '../types.js';

export interface TimeMachineWebHooks {
  restartConversation?: (sourceSessionId: string, checkpoint: CheckpointNode) => Promise<{ sessionId: string }>;
}

export class TimeMachineWebServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private service: TimeMachineService;
  private hooks: TimeMachineWebHooks;

  constructor(service: TimeMachineService, port = 3088, host = '127.0.0.1', hooks: TimeMachineWebHooks = {}) {
    this.service = service;
    this.port = port;
    this.host = host;
    this.hooks = hooks;
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
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
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
      const sessionId = query.get('sessionId') || 'default';
      const dag = await this.service.getDAGManager(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dag.tree));
      return;
    }

    if (pathname === '/api/diff' && req.method === 'GET') {
      const sessionId = query.get('sessionId') || 'default';
      const baseId = query.get('base') || '';
      const targetId = query.get('target') || '';
      const diffs = await this.service.getDiff(sessionId, baseId, targetId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ diffs }));
      return;
    }

    if (pathname === '/api/rewind' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const { sessionId, checkpointId } = body;
      if (!this.hooks.restartConversation) throw new Error('Conversation restart capability is unavailable; refusing workspace-only rewind.');
      const sourceSessionId = sessionId || 'default';
      const result = await this.service.rewindToCheckpoint(sourceSessionId, checkpointId, {
        mode: body.force === true ? 'force' : undefined,
        deleteNewIgnoredPaths: body.deleteNewIgnoredPaths === true,
      });
      let conversation: { sessionId: string };
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.targetNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        throw error;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result, conversation }));
      return;
    }

    if (pathname === '/api/fork' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const { sessionId, checkpointId, branchName, description } = body;
      if (!this.hooks.restartConversation) throw new Error('Conversation restart capability is unavailable; refusing workspace-only fork.');
      const sourceSessionId = sessionId || 'default';
      const result = await this.service.forkNewBranch({
        sessionId: sourceSessionId,
        fromCheckpointId: checkpointId,
        newBranchName: branchName,
        description,
        restore: { mode: body.force === true ? 'force' : undefined },
      });
      let conversation: { sessionId: string };
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.forkedNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        throw error;
      }
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
          reject(new Error('JSON payload exceeds 64 KiB'));
          req.destroy();
          return;
        }
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
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
    try {
      return allowed.has(new URL(origin).hostname);
    } catch {
      return false;
    }
  }

  private async compensate(sessionId: string, rescueCheckpointId?: string): Promise<void> {
    if (!rescueCheckpointId) return;
    await this.service.rewindToCheckpoint(sessionId, rescueCheckpointId, {
      mode: 'force',
      createRescuePoint: false,
    });
  }
}
