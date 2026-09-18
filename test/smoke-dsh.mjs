import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repository = process.cwd();
const dshBin = process.env.TM_DSH_BIN || 'dsh';
const smokeHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-time-machine-smoke-'));

function run(args) {
  const result = spawnSync(dshBin, args, {
    cwd: repository,
    env: { ...process.env, DSH_HOME: smokeHome },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Could not execute '${dshBin}': ${result.error.message}\nInstall DSH or set TM_DSH_BIN to its executable.`);
  }
  if (result.status !== 0) {
    throw new Error([
      `'${dshBin} ${args.join(' ')}' exited with ${result.status}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result.stdout ?? '';
}

try {
  const profile = 'time-machine-smoke';
  run(['plugin', '--profile', profile, 'add', repository]);
  const dump = run(['--profile', profile, '--dump-config']);
  if (!/time-machine/.test(dump)) {
    throw new Error('DSH dump-config did not contain a time-machine row.');
  }
  console.log(`DSH bundle smoke test passed for profile '${profile}'.`);
} finally {
  await rm(smokeHome, { recursive: true, force: true });
}
