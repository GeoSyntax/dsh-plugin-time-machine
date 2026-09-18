import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pc from 'picocolors';
import { GitPlumbingEngine } from '../src/core/git-plumbing.js';
import { FallbackSnapshotEngine } from '../src/core/fallback-engine.js';

const execAsync = promisify(execFile);

async function runBenchmark() {
  const jsonOutput = process.env.TM_BENCH_FORMAT?.toLowerCase() === 'json';
  if (!jsonOutput) console.log(pc.bold(pc.cyan(`\n═══════════ DSH Time Machine vs Traditional Copy Benchmark ═══════════\n`)));

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-benchmark-'));
  const repoDir = path.join(tmpRoot, 'test-repo');
  const backupStorageDir = path.join(tmpRoot, 'traditional-backups');

  await fs.mkdir(repoDir, { recursive: true });
  await fs.mkdir(backupStorageDir, { recursive: true });

  // 初始化 Git 仓库
  await execAsync('git', ['init'], { cwd: repoDir });
  await execAsync('git', ['config', 'user.name', 'BenchBot'], { cwd: repoDir });
  await execAsync('git', ['config', 'user.email', 'bot@bench.com'], { cwd: repoDir });

  // Override these for scale testing, e.g. TM_BENCH_FILE_COUNT=1000.
  const FILE_COUNT = positiveInteger(process.env.TM_BENCH_FILE_COUNT, 100);
  if (!jsonOutput) console.log(pc.white(`Creating mock project with ${FILE_COUNT} files...`));
  for (let i = 0; i < FILE_COUNT; i++) {
    const code = `// Module ${i}\nexport function compute_${i}() { return ${i} * 42; }\n`;
    await fs.writeFile(path.join(repoDir, `module_${i}.ts`), code, 'utf-8');
  }

  const gitEngine = new GitPlumbingEngine({ workDir: repoDir });
  const fallbackEngine = new FallbackSnapshotEngine({ workDir: repoDir, storageDir: backupStorageDir });

  const TURNS = positiveInteger(process.env.TM_BENCH_TURNS, 5);
  if (!jsonOutput) console.log(pc.white(`Simulating ${TURNS} agent turns of incremental file changes...\n`));

  // 1. 测试传统物理 Copy 备份方案
  const copyTimes: number[] = [];
  for (let turn = 1; turn <= TURNS; turn++) {
    // 模拟 Agent 每次修改 5 个文件
    for (let f = 0; f < 5; f++) {
      const idx = (turn * 5 + f) % FILE_COUNT;
      await fs.appendFile(path.join(repoDir, `module_${idx}.ts`), `// turn ${turn} edit\n`, 'utf-8');
    }

    const t0 = performance.now();
    await fallbackEngine.createSnapshot({ sessionId: 'bench_copy', checkpointId: `turn_${turn}` });
    const t1 = performance.now();
    copyTimes.push(t1 - t0);
  }

  // 2. 测试我们的 Git Plumbing 方案
  const gitTimes: number[] = [];
  let lastCommitOid: string | null = null;
  for (let turn = 1; turn <= TURNS; turn++) {
    // 模拟 Agent 修改文件
    for (let f = 0; f < 5; f++) {
      const idx = (turn * 5 + f) % FILE_COUNT;
      await fs.appendFile(path.join(repoDir, `module_${idx}.ts`), `// git turn ${turn} edit\n`, 'utf-8');
    }

    const t0 = performance.now();
    const snap = await gitEngine.createSnapshot({
      sessionId: 'bench_git',
      checkpointId: `turn_${turn}`,
      parentCommitOid: lastCommitOid,
    });
    const t1 = performance.now();
    lastCommitOid = snap.commitOid;
    gitTimes.push(t1 - t0);
  }

  // 计算平均耗时
  const avgCopyTime = copyTimes.reduce((a, b) => a + b, 0) / TURNS;
  const avgGitTime = gitTimes.reduce((a, b) => a + b, 0) / TURNS;

  // 测量物理目录磁盘大小
  async function getDirSize(dir: string): Promise<number> {
    let size = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const s = await fs.stat(path.join(entry.parentPath || dir, entry.name));
          size += s.size;
        }
      }
    } catch {}
    return size;
  }

  const copyDiskSize = await getDirSize(backupStorageDir);
  const gitObjectsSize = await getDirSize(path.join(repoDir, '.git', 'objects'));

  const latencyRatio = avgGitTime / avgCopyTime;
  const storageRatio = gitObjectsSize / Math.max(copyDiskSize, 1);
  const result = {
    fileCount: FILE_COUNT,
    turns: TURNS,
    traditionalCopyMs: Number(avgCopyTime.toFixed(2)),
    gitPlumbingMs: Number(avgGitTime.toFixed(2)),
    latencyRatio: Number(latencyRatio.toFixed(3)),
    traditionalCopyBytes: copyDiskSize,
    gitPlumbingBytes: gitObjectsSize,
    storageRatio: Number(storageRatio.toFixed(3)),
  };
  if (jsonOutput) {
    console.log(JSON.stringify(result));
  } else {
    console.log(pc.bold(`📊 BENCHMARK RESULTS (${FILE_COUNT} files, average of ${TURNS} turns):`));
    console.log('───────────────────────────────────────────────────────────────────');
    console.log(`⏱️  Snapshot Latency:`);
    console.log(`   Traditional Copy  : ${pc.red(avgCopyTime.toFixed(2) + ' ms')}`);
    console.log(`   Git Plumbing (Ours): ${pc.green(pc.bold(avgGitTime.toFixed(2) + ' ms'))}  -> ${pc.yellow(`${latencyRatio.toFixed(1)}x copy latency`)}`);
    console.log(pc.dim('   Note: Git plumbing trades small-workspace latency for immutable history, isolated indexes, and deduplicated storage.'));
    console.log('');
    console.log(`💾 Total Storage Footprint:`);
    console.log(`   Traditional Copy  : ${pc.red((copyDiskSize / 1024).toFixed(1) + ' KB')}`);
    console.log(`   Git Plumbing (Ours): ${pc.green(pc.bold((gitObjectsSize / 1024).toFixed(1) + ' KB'))}  -> ${pc.cyan(`${storageRatio.toFixed(1)}x copy storage`)}`);
    console.log('───────────────────────────────────────────────────────────────────\n');
  }

  // 清理临时文件
  await fs.rm(tmpRoot, { recursive: true, force: true });
}

runBenchmark().catch(console.error);

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
