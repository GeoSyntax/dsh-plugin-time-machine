import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceDir = process.env.TM_DSH_SOURCE;
if (!sourceDir) throw new Error('Set TM_DSH_SOURCE to the local deepseek-harness source directory.');

const repository = process.cwd();
const dshBin = path.join(path.resolve(sourceDir), 'apps', 'cli', 'lib', 'bin.js');
const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-time-machine-failure-home-'));
const workspace = await mkdtemp(path.join(os.tmpdir(), 'dsh-time-machine-failure-workspace-'));
const profile = 'time-machine-failure-smoke';
const patchFile = path.join(home, 'invalid-gemini.patch.yml');

function run(args) {
  return spawnSync(process.execPath, [dshBin, ...args], {
    cwd: workspace,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_MODE: 'DISABLED',
      DSH_PERMISSION_MODE: 'danger-full-access',
      TM_GEMINI_API_KEY: process.env.TM_GEMINI_API_KEY ?? 'failure-smoke-key',
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
}

async function findDagFiles(root, result = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) await findDagFiles(absolute, result);
    else if (entry.name.startsWith('dag_') && entry.name.endsWith('.json')) result.push(absolute);
  }
  return result;
}

try {
  let result = run(['--profile', profile, '--from-default-profile', 'headless', '--dump-config']);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Could not create the failure smoke profile.');
  result = run(['plugin', '--profile', profile, 'add', repository]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Could not install the plugin.');

  await writeFile(patchFile, `- id: llm-pi-ai
  config:
    providers:
      gemini-failure:
        apiKeyEnv: TM_GEMINI_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:1/v1
        models:
          - id: gemini-failure
            contextWindow: 128000

- id: agent-default-model
  config:
    provider: gemini-failure
    model: gemini-failure

- id: agent-loop
  config:
    agents:
      - id: main
        provider: gemini-failure
        model: gemini-failure
        cwd: !!js process.cwd()
`, 'utf8');

  result = run(['--profile', profile, '--patch', patchFile, 'This request must fail because the configured model endpoint is unreachable.']);
  if (result.status === 0) throw new Error('Failure smoke unexpectedly completed successfully.');

  const dagFiles = await findDagFiles(workspace);
  const nodes = [];
  for (const file of dagFiles) {
    const state = JSON.parse(await readFile(file, 'utf8'));
    nodes.push(...Object.values(state.nodes ?? {}));
  }
  const failed = nodes.filter(node => node.status === 'failed');
  if (failed.length === 0) throw new Error(`Expected a failed checkpoint, found ${nodes.length} node(s).`);
  if (!failed.some(node => typeof node.errorMessage === 'string' || (node.failedTools?.length ?? 0) > 0)) {
    throw new Error('Failed checkpoint did not retain an error message or failed tool evidence.');
  }
  console.log(`Real DSH failed turn persisted ${failed.length} failed checkpoint(s) with error evidence.`);
} finally {
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
