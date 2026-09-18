import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

async function findFiles(root, predicate, result = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) await findFiles(absolute, predicate, result);
    else if (predicate(entry.name, absolute)) result.push(absolute);
  }
  return result;
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
    const dagFiles = await findFiles(workspace, (name) => name.startsWith('dag_') && name.endsWith('.json'));
    if (dagFiles.length === 0) throw new Error('Live DSH did not persist a time-machine DAG checkpoint.');
    const dag = JSON.parse(await readFile(dagFiles[0], 'utf8'));
    if (typeof dag.sessionId !== 'string') throw new Error('Live DSH DAG is missing its session boundary.');
    const nodes = Object.values(dag.nodes ?? {});
    if (nodes.length < 1) throw new Error('Live DSH persisted an empty time-machine DAG.');
    if (!nodes.some((node) => ['success', 'failed', 'aborted'].includes(node.status))) {
      throw new Error('Live DSH DAG has no finalized turn checkpoint.');
    }
    console.log(`Source DSH persisted ${nodes.length} finalized checkpoint(s).`);

    if (process.env.TM_DSH_LIVE_RESTART === '1') {
      run([
        '--profile', profile,
        '--patch', patchFile,
        'Read hello.txt and append a second line containing DSH-TM-RESTART-OK, then confirm briefly.',
      ], { timeout: 180_000 });
      const restartedContent = await readFile(path.join(workspace, 'hello.txt'), 'utf8');
      if (!restartedContent.includes('DSH-TM-RESTART-OK')) {
        throw new Error('Restarted DSH did not continue in the same workspace.');
      }
      const restartedDagFiles = await findFiles(workspace, (name) => name.startsWith('dag_') && name.endsWith('.json'));
      const restartedStates = await Promise.all(restartedDagFiles.map(async (file) => {
        const state = JSON.parse(await readFile(file, 'utf8'));
        for (const node of Object.values(state.nodes ?? {})) {
          if (node.sessionState?.sessionId !== state.sessionId) {
            throw new Error(`DAG node ${node.id} crossed its persisted session boundary.`);
          }
        }
        return state;
      }));
      if (!restartedStates.some((state) => state.sessionId === dag.sessionId)) {
        throw new Error('Restarted DSH lost the original session DAG.');
      }
      const restartedNodeCount = restartedStates.reduce((total, state) => total + Object.keys(state.nodes ?? {}).length, 0);
      if (restartedNodeCount < nodes.length + 1) {
        throw new Error(`Restarted DSH did not persist a new checkpoint (expected at least ${nodes.length + 1}, got ${restartedNodeCount}).`);
      }
      console.log(`Source DSH restart preserved DAG history (${restartedNodeCount} checkpoint(s)).`);
    }
    if (process.env.TM_DSH_LIVE_TOOL_FAILURE === '1') {
      run([
        '--profile', profile,
        '--patch', patchFile,
        'Use the shell tool to run exactly `node -e "process.exit(7)"`. Do not skip the command or replace it with an explanation; after it fails, briefly report the failure.',
      ], { timeout: 180_000 });
      const failureDagFiles = await findFiles(workspace, (name) => name.startsWith('dag_') && name.endsWith('.json'));
      const failureNodes = [];
      for (const file of failureDagFiles) {
        const state = JSON.parse(await readFile(file, 'utf8'));
        failureNodes.push(...Object.values(state.nodes ?? {}));
      }
      if (!failureNodes.some((node) => (node.failedTools?.length ?? 0) > 0)) {
        throw new Error('Live DSH tool-failure turn did not persist failedTools evidence.');
      }
      console.log('Source DSH live tool failure persisted failedTools evidence.');
    }
    console.log('Source DSH live model turn passed.');
  }

  console.log(`Source DSH plugin smoke passed${live ? ' with live model turn' : ''}.`);
} finally {
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
