import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceDir = process.env.TM_DSH_SOURCE;
if (!sourceDir) {
  throw new Error('Set TM_DSH_SOURCE to the local deepseek-harness source directory.');
}

const repository = process.cwd();
const dshBin = path.join(path.resolve(sourceDir), 'apps', 'cli', 'lib', 'bin.js');
const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-time-machine-source-home-'));
const workspace = await mkdtemp(path.join(os.tmpdir(), 'dsh-time-machine-source-workspace-'));
const profile = 'time-machine-source-smoke';
const patchFile = path.join(home, 'gemini.patch.yml');
const live = process.env.TM_DSH_LIVE === '1';

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [dshBin, ...args], {
    cwd: options.cwd ?? workspace,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_MODE: 'DISABLED',
      DSH_PERMISSION_MODE: 'danger-full-access',
      ...(options.env ?? {}),
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`dsh ${args.join(' ')} exited with ${result.status}`, result.stdout, result.stderr]
      .filter(Boolean).join('\n'));
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

try {
  run(['--profile', profile, '--from-default-profile', 'headless', '--dump-config']);
  run(['plugin', '--profile', profile, 'add', repository]);

  await writeFile(patchFile, `- id: llm-pi-ai
  config:
    providers:
      gemini-local:
        apiKeyEnv: TM_GEMINI_API_KEY
        api: openai-completions
        baseURL: ${process.env.TM_GEMINI_BASE_URL ?? 'http://127.0.0.1:8081/v1'}
        models:
          - id: ${process.env.TM_GEMINI_MODEL ?? 'gemini-3.8-flash'}
            contextWindow: 128000

- id: agent-default-model
  config:
    provider: gemini-local
    model: ${process.env.TM_GEMINI_MODEL ?? 'gemini-3.8-flash'}

- id: agent-loop
  config:
    agents:
      - id: main
        provider: gemini-local
        model: ${process.env.TM_GEMINI_MODEL ?? 'gemini-3.8-flash'}
        cwd: !!js process.cwd()
`, 'utf8');

  const config = run(['--profile', profile, '--patch', patchFile, '--dump-config']);
  if (!config.includes('dsh-plugin-time-machine') || !config.includes('gemini-local')) {
    throw new Error('Source DSH profile did not activate the plugin and Gemini overlay.');
  }

  if (live) {
    if (!process.env.TM_GEMINI_API_KEY) throw new Error('TM_DSH_LIVE=1 requires TM_GEMINI_API_KEY.');
    run([
      '--profile', profile,
      '--patch', patchFile,
      'Create hello.txt with exactly the text DSH-TM-SOURCE-OK, then confirm briefly.',
    ], { timeout: 180_000 });
    const content = await readFile(path.join(workspace, 'hello.txt'), 'utf8');
    if (content.trim() !== 'DSH-TM-SOURCE-OK') throw new Error('Live DSH did not create the expected file.');
    console.log('Source DSH live model turn passed.');
  }

  console.log(`Source DSH plugin smoke passed${live ? ' with live model turn' : ''}.`);
} finally {
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
