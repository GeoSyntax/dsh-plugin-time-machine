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
    const driftPreview = await service.previewRestore(sessionId, first.id);
    expect(driftPreview.conflictingPaths).toContain('manual.txt');
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

    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'post-rescue\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId, turnIndex: 3, prompt: 'post rescue', sessionState: { sessionId, messages: [] },
    });
    const prune = await service.prune(sessionId, { keepLatest: 1, compactHistory: true });
    expect(prune.quarantineReclaimedBytes).toBeGreaterThan(0);
    expect(await fs.readdir(path.join(tmpDir, '.dsh-tm', 'ignored-quarantine')).catch(() => [])).toHaveLength(0);
  });

  it('previews rewind impact without mutating files or DAG state', async () => {
    const sessionId = 'preview-session';
    const file = path.join(tmpDir, 'preview.txt');
    await fs.writeFile(file, 'v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'initial', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(file, 'v2\n', 'utf8');
    const second = await service.createTurnCheckpoint({
      sessionId, turnIndex: 2, prompt: 'changed', sessionState: { sessionId, messages: [] },
    });
    const before = await fs.readFile(file, 'utf8');
    const preview = await service.previewRestore(sessionId, first.id);
    expect(preview.currentCheckpointId).toBe(second.id);
    expect(preview.checkpointId).toBe(first.id);
    expect(preview.diffs.some(diff => diff.file === 'preview.txt')).toBe(true);
    expect(preview.conflictingPaths).toEqual([]);
    expect(preview.requiresForce).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect((await service.getDAGManager(sessionId)).tree.currentCheckpointId).toBe(second.id);
  });

  it('binds a preview plan to the reviewed workspace and consumes it once', async () => {
    const sessionId = 'preview-plan-session';
    const file = path.join(tmpDir, 'plan.txt');
    await fs.writeFile(file, 'v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'initial', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'v2\n', 'utf8');
    await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'changed', sessionState: { sessionId, messages: [] } });

    const preview = await service.previewRestore(sessionId, first.id);
    expect(preview.restorePlanId).toMatch(/^plan_/);
    await service.rewindToCheckpoint(sessionId, first.id, { restorePlanId: preview.restorePlanId });
    expect(await fs.readFile(file, 'utf8')).toBe('v1\n');
    await expect(service.rewindToCheckpoint(sessionId, first.id, { restorePlanId: preview.restorePlanId }))
      .rejects.toMatchObject({ code: 'RESTORE_PLAN_INVALID' });
  });

  it('rejects a preview plan after workspace drift', async () => {
    const sessionId = 'stale-preview-plan';
    const file = path.join(tmpDir, 'stale-plan.txt');
    await fs.writeFile(file, 'v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'initial', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'v2\n', 'utf8');
    await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'changed', sessionState: { sessionId, messages: [] } });
    const preview = await service.previewRestore(sessionId, first.id);
    await fs.writeFile(file, 'changed after preview\n', 'utf8');
    await expect(service.rewindToCheckpoint(sessionId, first.id, { restorePlanId: preview.restorePlanId }))
      .rejects.toMatchObject({ code: 'RESTORE_PLAN_INVALID' });
    expect(await fs.readFile(file, 'utf8')).toBe('changed after preview\n');
  });

  it('expires preview plans according to restorePlanTtlMs', async () => {
    const expiring = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.expiring-plans'),
      config: { restorePlanTtlMs: 1 },
    });
    const sessionId = 'expiring-preview-plan';
    const file = path.join(tmpDir, 'expiring-plan.txt');
    await fs.writeFile(file, 'v1\n', 'utf8');
    const first = await expiring.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'initial', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'v2\n', 'utf8');
    await expiring.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'changed', sessionState: { sessionId, messages: [] } });
    const preview = await expiring.previewRestore(sessionId, first.id);
    await new Promise(resolve => setTimeout(resolve, 10));
    await expect(expiring.rewindToCheckpoint(sessionId, first.id, { restorePlanId: preview.restorePlanId }))
      .rejects.toMatchObject({ code: 'RESTORE_PLAN_INVALID' });
  });

  it('rejects a reviewed plan when the Git branch changes', async () => {
    const sessionId = 'branch-drift-plan';
    const file = path.join(tmpDir, 'branch-plan.txt');
    await fs.writeFile(file, 'v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'initial', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'v2\n', 'utf8');
    await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'changed', sessionState: { sessionId, messages: [] } });
    const preview = await service.previewRestore(sessionId, first.id);
    await execAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/time-machine-plan-test'], { cwd: tmpDir });
    await expect(service.rewindToCheckpoint(sessionId, first.id, { restorePlanId: preview.restorePlanId }))
      .rejects.toMatchObject({ code: 'RESTORE_PLAN_INVALID' });
    expect(await fs.readFile(file, 'utf8')).toBe('v2\n');
  });

  it('rejects ignored deletion when the quarantine hard limit would be exceeded', async () => {
    const limited = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.quarantine-limit'),
      config: { maxQuarantineBytes: 4 },
    });
    const sessionId = 'quarantine-limit';
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'limited.secret\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'limited.txt'), 'v1\n', 'utf8');
    const first = await limited.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'initial', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(path.join(tmpDir, 'limited.txt'), 'v2\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'limited.secret'), 'secret payload\n', 'utf8');
    await limited.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'secret', sessionState: { sessionId, messages: [] } });
    await expect(limited.rewindToCheckpoint(sessionId, first.id, { deleteNewIgnoredPaths: true }))
      .rejects.toMatchObject({ code: 'QUARANTINE_QUOTA_EXCEEDED' });
    expect(await fs.readFile(path.join(tmpDir, 'limited.secret'), 'utf8')).toBe('secret payload\n');
  });

  it('restores selected paths while preserving other workspace files and conversation state', async () => {
    const sessionId = 'selective-session';
    const left = path.join(tmpDir, 'left.txt');
    const right = path.join(tmpDir, 'right.txt');
    await fs.writeFile(left, 'left-v1\n', 'utf8');
    await fs.writeFile(right, 'right-v1\n', 'utf8');
    const first = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'initial', sessionState: { sessionId, messages: [{ role: 'user', content: 'keep me' }] },
    });
    await fs.writeFile(left, 'left-v2\n', 'utf8');
    await fs.writeFile(right, 'right-v2\n', 'utf8');
    await service.createTurnCheckpoint({
      sessionId, turnIndex: 2, prompt: 'change both', sessionState: { sessionId, messages: [{ role: 'user', content: 'current' }] },
    });

    const result = await service.restoreSelectedPaths(sessionId, first.id, ['left.txt']);
    expect(result.restoredPaths).toEqual(['left.txt']);
    expect(await fs.readFile(left, 'utf8')).toBe('left-v1\n');
    expect(await fs.readFile(right, 'utf8')).toBe('right-v2\n');
    const dag = await service.getDAGManager(sessionId);
    expect(dag.getCurrentNode()?.tags).toContain('selective-restore');
    expect(dag.getCurrentNode()?.sessionState.messages[0]?.content).toBe('current');
  });

  it('prunes an abandoned branch only when explicitly requested and keeps shared ancestors', async () => {
    const sessionId = 'prune-session';
    await fs.writeFile(path.join(tmpDir, 'history.txt'), 'one\n', 'utf8');
    const first = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'one', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(path.join(tmpDir, 'history.txt'), 'two\n', 'utf8');
    const second = await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'two', sessionState: { sessionId, messages: [] } });
    await service.forkNewBranch({ sessionId, fromCheckpointId: first.id, newBranchName: 'experiment' });
    await fs.writeFile(path.join(tmpDir, 'history.txt'), 'three\n', 'utf8');
    const third = await service.createTurnCheckpoint({ sessionId, turnIndex: 3, prompt: 'three', sessionState: { sessionId, messages: [] } });

    const status = await service.getStorageStatus(sessionId);
    expect(status.checkpoints).toBeGreaterThanOrEqual(4); // fork creates a rescue checkpoint
    const result = await service.prune(sessionId, { keepLatest: 0, abandonedBranches: true });
    expect(result.removedCheckpointIds).toContain(second.id);
    const dag = await service.getDAGManager(sessionId);
    expect(dag.getNode(first.id)).not.toBeNull();
    expect(dag.getNode(second.id)).toBeNull();
    expect(dag.getNode(third.id)).not.toBeNull();
  });

  it('supports explicit age-based pruning without touching the current checkpoint', async () => {
    const sessionId = 'age-prune-session';
    const file = path.join(tmpDir, 'age.txt');
    await fs.writeFile(file, 'one\n', 'utf8');
    const first = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'one', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'two\n', 'utf8');
    const second = await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'two', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'three\n', 'utf8');
    const current = await service.createTurnCheckpoint({ sessionId, turnIndex: 3, prompt: 'three', sessionState: { sessionId, messages: [] } });
    await new Promise(resolve => setTimeout(resolve, 5));
    const result = await service.prune(sessionId, { keepLatest: 0, olderThanMs: 1, compactHistory: true });
    expect(result.removedCheckpointIds).toContain(first.id);
    expect(result.removedCheckpointIds).toContain(second.id);
    expect(result.removedCheckpointIds).not.toContain(current.id);
    expect((await service.getDAGManager(sessionId)).getNode(current.id)).toBeTruthy();
  });

  it('recovers an interrupted restore journal on the next service startup', async () => {
    const sessionId = 'journal-recovery';
    const file = path.join(tmpDir, 'journal.txt');
    await fs.writeFile(file, 'safe-state\n', 'utf8');
    const rescue = await service.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'safe boundary', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(file, 'corrupted-state\n', 'utf8');
    const target = await service.createTurnCheckpoint({
      sessionId, turnIndex: 2, prompt: 'corrupted turn', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(file, 'partially-restored-state\n', 'utf8');
    const journalDir = path.join(tmpDir, '.dsh-tm', 'restore-journals');
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(path.join(journalDir, 'restore_crash.json'), JSON.stringify({
      version: 1, id: 'restore_crash', sessionId, rescueCheckpointId: target.id,
      targetCheckpointId: rescue.id, kind: 'rewind', phase: 'workspace-restored', createdAt: Date.now(),
    }), 'utf8');

    const restarted = new TimeMachineService({ workDir: tmpDir, storageDir: path.join(tmpDir, '.dsh-tm') });
    const dag = await restarted.getDAGManager(sessionId);
    expect(await fs.readFile(file, 'utf8')).toBe('corrupted-state\n');
    expect(dag.tree.currentCheckpointId).toBe(target.id);
    await expect(fs.access(path.join(journalDir, 'restore_crash.json'))).rejects.toThrow();
  });

  it('enforces opt-in snapshot quotas without deleting history', async () => {
    const quotaService = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.quota-tm'),
      config: { maxSnapshots: 1 },
    });
    const sessionId = 'quota-session';
    await fs.writeFile(path.join(tmpDir, 'quota.txt'), 'one\n', 'utf8');
    const first = await quotaService.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'first', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(path.join(tmpDir, 'quota.txt'), 'two\n', 'utf8');
    await expect(quotaService.createTurnCheckpoint({
      sessionId, turnIndex: 2, prompt: 'blocked', sessionState: { sessionId, messages: [] },
    })).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
    await expect(quotaService.rewindToCheckpoint(sessionId, first.id, { mode: 'force' })).resolves.toMatchObject({
      targetNode: { id: first.id },
    });
    expect((await quotaService.getDAGManager(sessionId)).getNode(first.id)).not.toBeNull();
  });

  it('supports the opt-in shadow object store through the service', async () => {
    const shadowService = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.shadow-service'),
      config: { shadowStore: true },
    });
    const sessionId = 'shadow-service';
    const file = path.join(tmpDir, 'shadow-service.txt');
    await fs.writeFile(file, 'before\n', 'utf8');
    const checkpoint = await shadowService.createTurnCheckpoint({
      sessionId, turnIndex: 1, prompt: 'shadow boundary', sessionState: { sessionId, messages: [] },
    });
    await fs.writeFile(file, 'after\n', 'utf8');
    await shadowService.createTurnCheckpoint({
      sessionId, turnIndex: 2, prompt: 'shadow second boundary', sessionState: { sessionId, messages: [] },
    });
    await shadowService.rewindToCheckpoint(sessionId, checkpoint.id, { mode: 'force' });
    expect(await fs.readFile(file, 'utf8')).toBe('before\n');
    expect((await shadowService.getStorageStatus(sessionId)).gitObjectsShared).toBe(false);
    expect((await fs.readdir(path.join(tmpDir, '.shadow-service', 'git-shadow', 'objects'), { withFileTypes: true })).some(entry => entry.isDirectory())).toBe(true);
    const prune = await shadowService.prune(sessionId, { keepLatest: 0, compactHistory: true, repackShadowObjects: true });
    expect(prune.shadowObjectsReclaimedBytes).toBeDefined();
  });

  it('compacts old linear checkpoints only when explicitly requested', async () => {
    const sessionId = 'compact-session';
    const file = path.join(tmpDir, 'compact.txt');
    await fs.writeFile(file, 'one\n', 'utf8');
    const first = await service.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'one', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'two\n', 'utf8');
    const second = await service.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'two', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'three\n', 'utf8');
    const third = await service.createTurnCheckpoint({ sessionId, turnIndex: 3, prompt: 'three', sessionState: { sessionId, messages: [] } });
    const result = await service.prune(sessionId, { keepLatest: 1, compactHistory: true });
    expect(result.removedCheckpointIds).toEqual(expect.arrayContaining([first.id, second.id]));
    const dag = await service.getDAGManager(sessionId);
    expect(dag.getNode(first.id)).toBeNull();
    expect(dag.getNode(second.id)).toBeNull();
    expect(dag.getNode(third.id)?.parentId).toBeNull();
    expect((await service.getStorageStatus(sessionId)).checkpoints).toBe(1);
  });

  it('can auto-compact quota history only when explicitly enabled', async () => {
    const auto = new TimeMachineService({
      workDir: tmpDir,
      storageDir: path.join(tmpDir, '.auto-prune-tm'),
      config: { maxSnapshots: 2, autoPrune: true },
    });
    const sessionId = 'auto-prune-session';
    const file = path.join(tmpDir, 'auto-prune.txt');
    await fs.writeFile(file, 'one\n', 'utf8');
    const first = await auto.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'one', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'two\n', 'utf8');
    const second = await auto.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'two', sessionState: { sessionId, messages: [] } });
    await fs.writeFile(file, 'three\n', 'utf8');
    const third = await auto.createTurnCheckpoint({ sessionId, turnIndex: 3, prompt: 'three', sessionState: { sessionId, messages: [] } });
    const dag = await auto.getDAGManager(sessionId);
    expect(dag.getNode(first.id)).toBeNull();
    expect(dag.getNode(second.id)).not.toBeNull();
    expect(dag.getNode(third.id)?.parentId).toBe(second.id);
  });

  it('automatically compacts checkpoints older than the configured retention age', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-retention-age-'));
    await execAsync('git', ['init'], { cwd: root });
    await execAsync('git', ['config', 'user.name', 'TestBot'], { cwd: root });
    await execAsync('git', ['config', 'user.email', 'bot@test.com'], { cwd: root });
    const auto = new TimeMachineService({
      workDir: root,
      storageDir: path.join(root, '.dsh-tm'),
      config: { retentionMaxAgeMs: 1 },
    });
    try {
      const sessionId = 'retention-age';
      const file = path.join(root, 'retention.txt');
      await fs.writeFile(file, 'one\n', 'utf8');
      const first = await auto.createTurnCheckpoint({ sessionId, turnIndex: 1, prompt: 'one', sessionState: { sessionId, messages: [] } });
      await fs.writeFile(file, 'two\n', 'utf8');
      const second = await auto.createTurnCheckpoint({ sessionId, turnIndex: 2, prompt: 'two', sessionState: { sessionId, messages: [] } });
      await new Promise(resolve => setTimeout(resolve, 5));
      await fs.writeFile(file, 'three\n', 'utf8');
      const third = await auto.createTurnCheckpoint({ sessionId, turnIndex: 3, prompt: 'three', sessionState: { sessionId, messages: [] } });
      const dag = await auto.getDAGManager(sessionId);
      expect(dag.getNode(first.id)).toBeNull();
      expect(dag.getNode(second.id)).toBeTruthy();
      expect(dag.getNode(third.id)).toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
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

  it('includes failures recorded on the fork point in the reflection advisory', async () => {
    const sessionId = 'failed-fork-point';
    const file = path.join(tmpDir, 'failed-fork-point.txt');
    await fs.writeFile(file, 'failed-at-boundary\n', 'utf8');
    const checkpoint = await service.createTurnCheckpoint({
      sessionId,
      turnIndex: 1,
      prompt: 'run the risky command',
      sessionState: { sessionId, messages: [] },
      status: 'success',
      failedTools: [{ toolName: 'shell', input: { command: 'exit 7' }, error: 'exit code 7' }],
    });

    const result = await service.forkNewBranch({
      sessionId,
      fromCheckpointId: checkpoint.id,
      newBranchName: 'failed-point-retry',
    });

    expect(result.reflectionAdvisory.hasPastFailures).toBe(true);
    expect(result.reflectionAdvisory.suggestedPromptPrefix).toContain('Failed tool [shell]');
  });

  it('verifies the restored workspace digest for the fallback engine', async () => {
    const fallbackRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fallback-service-'));
    try {
      const fallback = new TimeMachineService({
        workDir: fallbackRoot,
        storageDir: path.join(fallbackRoot, '.dsh-tm'),
      });
      const file = path.join(fallbackRoot, 'state.txt');
      await fs.writeFile(file, 'v1\n', 'utf8');
      const checkpoint = await fallback.createTurnCheckpoint({
        sessionId: 'fallback-session',
        turnIndex: 1,
        prompt: 'fallback boundary',
        sessionState: { sessionId: 'fallback-session', messages: [] },
      });
      await fs.writeFile(file, 'v2\n', 'utf8');
      await fallback.rewindToCheckpoint('fallback-session', checkpoint.id, { mode: 'force' });
      expect(await fs.readFile(file, 'utf8')).toBe('v1\n');

      await fs.writeFile(file, 'v3\n', 'utf8');
      const untouched = path.join(fallbackRoot, 'untouched.txt');
      await fs.writeFile(untouched, 'keep\n', 'utf8');
      const selective = await fallback.restoreSelectedPaths('fallback-session', checkpoint.id, ['state.txt']);
      expect(selective.restoredPaths).toEqual(['state.txt']);
      expect(await fs.readFile(file, 'utf8')).toBe('v1\n');
      expect(await fs.readFile(untouched, 'utf8')).toBe('keep\n');
    } finally {
      await fs.rm(fallbackRoot, { recursive: true, force: true });
    }
  });
});
