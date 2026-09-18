import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TimeMachineService } from '../src/service.js';

const execAsync = promisify(execFile);

describe('TimeMachineService (Dual-Track E2E)', () => {
  let tmpDir: string;
  let service: TimeMachineService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-service-test-'));
    await execAsync('git', ['init'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.name', 'TestBot'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.email', 'bot@test.com'], { cwd: tmpDir });

    service = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.dsh-tm'),
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('should manage full turn lifecycle, rewind, and fork with reflection', async () => {
    const sessionId = 'session_e2e_1';

    // Turn 1: 创建 app.ts
    const appFile = path.join(tmpDir, 'app.ts');
    await fs.writeFile(appFile, 'export const version = "1.0";\n', 'utf-8');

    const cp1 = await service.createTurnCheckpoint({
      sessionId,
      turnIndex: 1,
      prompt: 'Setup app version',
      sessionState: {
        sessionId,
        messages: [{ role: 'user', content: 'Setup app version' }],
      },
    });

    expect(cp1.turnIndex).toBe(1);
    expect(cp1.gitTreeOid).toHaveLength(40);

    // Turn 2: 修改 app.ts 并引入一个错误
    await fs.writeFile(appFile, 'export const version = "2.0-broken";\nthrow new Error("Fatal Bug");\n', 'utf-8');

    const cp2 = await service.createTurnCheckpoint({
      sessionId,
      turnIndex: 2,
      prompt: 'Upgrade version',
      status: 'failed',
      errorMessage: 'Fatal Bug encountered in app.ts',
      sessionState: {
        sessionId,
        messages: [
          { role: 'user', content: 'Setup app version' },
          { role: 'assistant', content: 'Version set to 1.0' },
          { role: 'user', content: 'Upgrade version' },
        ],
      },
    });

    // 验证此时文件是 broken 的
    let contentNow = await fs.readFile(appFile, 'utf-8');
    expect(contentNow).toContain('Fatal Bug');

    // 核心动作 1：Fork 一个新分支尝试 alternative 方案
    const forkResult = await service.forkNewBranch({
      sessionId,
      fromCheckpointId: cp1.id,
      newBranchName: 'hotfix/clean-upgrade',
    });

    // 验证物理文件是否已经回滚到 Turn 1
    contentNow = await fs.readFile(appFile, 'utf-8');
    expect(contentNow.replace(/\r\n/g, '\n')).toBe('export const version = "1.0";\n');

    // 验证记忆状态是否回滚到 Turn 1（只有 1 条消息）
    expect(forkResult.restoredSessionState.messages.length).toBe(1);

    // 验证反思引擎提取到了刚刚 cp2 的失败
    expect(forkResult.reflectionAdvisory.hasPastFailures).toBe(true);
    expect(forkResult.reflectionAdvisory.suggestedPromptPrefix).toContain('Fatal Bug');

    // 终端 ASCII 渲染不报错
    const treeAscii = await service.renderTree(sessionId);
    expect(treeAscii).toContain('DSH Time Machine DAG Tree');
    expect(treeAscii).toContain('hotfix/clean-upgrade');
  });

  it('refuses post-checkpoint drift by default and can remove newly-created ignored files explicitly', async () => {
    const sessionId = 'safe_restore';
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'secret.env\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId,
      turnIndex: 1,
      prompt: 'initial',
      sessionState: { sessionId, messages: [] },
    });

    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'v2\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'secret.env'), 'token=do-not-persist\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId,
      turnIndex: 2,
      prompt: 'agent change',
      sessionState: { sessionId, messages: [] },
    });

    await fs.writeFile(path.join(tmpDir, 'manual.txt'), 'user edit\n', 'utf8');
    await expect(service.rewindToCheckpoint(sessionId, first.id)).rejects.toMatchObject({ code: 'WORKSPACE_DRIFT' });
    await fs.rm(path.join(tmpDir, 'manual.txt'));

    const result = await service.rewindToCheckpoint(sessionId, first.id, { deleteNewIgnoredPaths: true });
    await expect(fs.access(path.join(tmpDir, 'secret.env'))).rejects.toThrow();
    expect(result.deletedIgnoredPaths).toContain('secret.env');
    expect(result.rescueCheckpointId).toBeTruthy();

    await service.rewindToCheckpoint(sessionId, result.rescueCheckpointId!, {
      mode: 'force',
      createRescuePoint: false,
    });
    expect(await fs.readFile(path.join(tmpDir, 'secret.env'), 'utf8')).toBe('token=do-not-persist\n');
  });

  it('finalizes a turn and reloads its DAG state after a service restart', async () => {
    const sessionId = 'restart-session';
    const file = path.join(tmpDir, 'restart.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const checkpoint = await service.createTurnCheckpoint({
      sessionId,
      turnIndex: 1,
      prompt: 'restart boundary',
      sessionState: { sessionId, messages: [{ role: 'user', content: 'restart boundary' }] },
      status: 'running',
    });

    await fs.writeFile(file, 'after\n', 'utf8');
    const finalized = await service.finalizeTurnCheckpoint({
      sessionId,
      checkpointId: checkpoint.id,
      status: 'failed',
      errorMessage: 'simulated turn failure',
      failedTools: [{ toolName: 'write', input: { file }, error: 'simulated turn failure' }],
    });

    expect(finalized.status).toBe('failed');
    expect(finalized.errorMessage).toBe('simulated turn failure');
    expect(finalized.settledGitTreeOid).toHaveLength(40);

    const restarted = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.dsh-tm'),
    });
    const dag = await restarted.getDAGManager(sessionId);
    const loaded = dag.getNode(checkpoint.id);
    expect(loaded?.status).toBe('failed');
    expect(loaded?.sessionState.messages).toHaveLength(1);
    expect(loaded?.failedTools?.[0]?.toolName).toBe('write');
  });
});
