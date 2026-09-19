import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const sourceDir = process.env.TM_DSH_SOURCE;
if (!sourceDir) throw new Error('Set TM_DSH_SOURCE to the local deepseek-harness source directory.');
if (!process.env.TM_GEMINI_API_KEY) throw new Error('Set TM_GEMINI_API_KEY for the real web-host smoke.');

const repository = process.cwd();
const dshBin = path.join(path.resolve(sourceDir), 'apps', 'cli', 'lib', 'bin.js');
const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-time-machine-web-home-'));
const workspace = await mkdtemp(path.join(os.tmpdir(), 'dsh-time-machine-web-workspace-'));
const profile = 'time-machine-web-smoke';
const patchFile = path.join(home, 'gemini.patch.yml');
const dshPort = 3198;
const pluginPort = 3088;
let child;
let dshToken = '';
let dshCookie = '';

function run(args) {
  const result = spawnSync(process.execPath, [dshBin, ...args], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', DSH_PERMISSION_MODE: 'danger-full-access' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error([`dsh ${args.join(' ')} exited with ${result.status}`, result.stdout, result.stderr].filter(Boolean).join('\n'));
}

async function waitFor(url, timeout = 30_000, diagnostic = () => '') {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}${diagnostic()}`);
}

async function rpc(method, payload) {
  const response = await fetch(`http://127.0.0.1:${dshPort}/api/${method}?token=${encodeURIComponent(dshToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: `127.0.0.1:${dshPort}`, cookie: dshCookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `tm-${Date.now()}-${Math.random()}`, method, payload: { args: { request: payload } } }),
  });
  const body = await response.json();
  if (!response.ok || body?.result?.ok !== true) throw new Error(`RPC ${method} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body.result.value;
}

async function dagFiles() {
  const result = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.name.startsWith('dag_') && entry.name.endsWith('.json')) result.push(absolute);
    }
  }
  await visit(workspace);
  return result;
}

try {
  run(['--profile', profile, '--from-default-profile', 'web', '--dump-config']);
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

- id: dsh-plugin-time-machine
  config:
    webPort: ${pluginPort}
    webHost: 127.0.0.1
`, 'utf8');

  const config = spawnSync(process.execPath, [dshBin, '--profile', profile, '--patch', patchFile, '--dump-config'], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', DSH_PERMISSION_MODE: 'danger-full-access' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (config.status !== 0 || !config.stdout.includes('dsh-plugin-time-machine')) {
    throw new Error(`Web smoke profile did not activate the plugin.\n${config.stdout}\n${config.stderr}`);
  }

  child = spawn(process.execPath, [dshBin, '--profile', profile, '--patch', patchFile, '--port', String(dshPort), '--no-open'], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', DSH_PERMISSION_MODE: 'danger-full-access' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  await waitFor(`http://127.0.0.1:${dshPort}/`, 30_000, () => `\nHost logs:\n${logs}`);
  const tokenStarted = Date.now();
  while (Date.now() - tokenStarted < 30_000 && !dshToken) {
    dshToken = logs.match(/token=([^\s]+)/)?.[1] ?? '';
    if (!dshToken) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!dshToken) throw new Error(`DSH web did not publish an API token.\n${logs}`);
  const tokenExchange = await fetch(`http://127.0.0.1:${dshPort}/?token=${encodeURIComponent(dshToken)}`, { redirect: 'manual' });
  dshCookie = tokenExchange.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  if (!dshCookie) throw new Error(`DSH web token exchange did not return a cookie (HTTP ${tokenExchange.status}).`);
  const status = await waitFor(`http://127.0.0.1:${pluginPort}/api/status`, 30_000, () => `\nHost logs:\n${logs}`);
  if ((await status.json()).status !== 'online') throw new Error('Time-machine web status was not online.');

  const created = await rpc('session/create', { cwd: workspace });
  const sessionId = created.sessionId;
  await rpc('session/prompt', {
    requestId: `tm-prompt-${Date.now()}`,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'Use the native file-write tool (not shell or a code block) to create web-smoke.txt with exactly the text WEB-SMOKE-OK, then confirm briefly.' }],
  });

  const started = Date.now();
  let files = [];
  let dag;
  while (Date.now() - started < 90_000) {
    files = await dagFiles();
    if (files.length > 0) {
      dag = JSON.parse(await readFile(files[0], 'utf8'));
      const nodes = Object.values(dag.nodes ?? {});
      const finalized = nodes.some((node) => ['success', 'failed', 'aborted'].includes(node.status));
      let created = false;
      try { created = (await readFile(path.join(workspace, 'web-smoke.txt'), 'utf8')).trim() === 'WEB-SMOKE-OK'; } catch {}
      if (finalized && created) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (files.length === 0) throw new Error(`No real-host DAG was persisted. Logs:\n${logs}`);
  dag ??= JSON.parse(await readFile(files[0], 'utf8'));
  const nodes = Object.values(dag.nodes ?? {});
  const checkpoint = nodes.at(-1);
  if (!checkpoint || !['success', 'failed', 'aborted'].includes(checkpoint.status)) {
    throw new Error(`Real-host turn did not finalize. Logs:\n${logs}`);
  }
  if (typeof checkpoint.assistantMessageId !== 'string' || !checkpoint.assistantMessageId) {
    throw new Error('Real-host checkpoint did not capture the finalized assistant message id.');
  }
  const messageCheckpoint = await fetch(`http://127.0.0.1:${pluginPort}/api/checkpoint-for-message?sessionId=${encodeURIComponent(sessionId)}&messageId=${encodeURIComponent(checkpoint.assistantMessageId)}`);
  const messageCheckpointBody = await messageCheckpoint.json();
  if (!messageCheckpoint.ok || messageCheckpointBody.checkpoint?.id !== checkpoint.id) {
    throw new Error(`Message action checkpoint mapping failed: ${messageCheckpoint.status} ${JSON.stringify(messageCheckpointBody)}`);
  }

  const file = path.join(workspace, 'web-smoke.txt');
  let fileContent;
  try {
    fileContent = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Real web host finalized without creating web-smoke.txt (checkpoint=${checkpoint.status}, error=${checkpoint.errorMessage ?? 'none'}). Logs:\n${logs}`, { cause: error });
  }
  if (fileContent.trim() !== 'WEB-SMOKE-OK') {
    throw new Error(`Real web host created unexpected web-smoke.txt content: ${JSON.stringify(fileContent)}`);
  }

  await rpc('session/prompt', {
    requestId: `tm-failure-prompt-${Date.now()}`,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'Use the shell tool to run exactly `node -e "process.exit(7)"`. Do not skip the command; after it fails, briefly report the failure.' }],
  });
  const failureStarted = Date.now();
  let failureNode;
  while (Date.now() - failureStarted < 90_000) {
    const currentFiles = await dagFiles();
    for (const currentFile of currentFiles) {
      const state = JSON.parse(await readFile(currentFile, 'utf8'));
      failureNode = Object.values(state.nodes ?? {}).find((node) => (node.failedTools?.length ?? 0) > 0);
      if (failureNode) break;
    }
    if (failureNode) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!failureNode) throw new Error('Real web host did not persist failedTools evidence for the failed command.');

  const fork = await fetch(`http://127.0.0.1:${pluginPort}/api/fork`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, checkpointId: checkpoint.id, branchName: 'web-smoke-alt' }),
  });
  const forkBody = await fork.json();
  if (!fork.ok || typeof forkBody.conversation?.sessionId !== 'string') {
    throw new Error(`Real-host fork failed: ${fork.status} ${JSON.stringify(forkBody)}`);
  }
  if (forkBody.result?.reflectionAdvisory?.hasPastFailures !== true
    || !String(forkBody.result?.reflectionAdvisory?.suggestedPromptPrefix ?? '').includes('Failed tool')) {
    throw new Error(`Real-host fork did not expose failed-tool reflection: ${JSON.stringify(forkBody.result?.reflectionAdvisory)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  try { await readFile(file, 'utf8'); throw new Error('Fork left the generated file behind.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }

  // After fork the host has moved to a new conversation while the workspace is
  // already at the historical checkpoint. Use force explicitly to test the
  // destructive recovery path rather than hiding the session-identity boundary.
  const rewind = await fetch(`http://127.0.0.1:${pluginPort}/api/rewind`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, checkpointId: checkpoint.id, force: true }),
  });
  const rewindBody = await rewind.json();
  if (!rewind.ok || typeof rewindBody.conversation?.sessionId !== 'string') {
    throw new Error(`Real-host rewind failed: ${rewind.status} ${JSON.stringify(rewindBody)}`);
  }

  // Exercise the real DSH SessionController failure path without modifying the
  // host: a persisted plugin checkpoint whose session does not exist in DSH
  // makes the host fork reject after the plugin has already restored files.
  // The Web server must then restore its rescue checkpoint and report both
  // the host error and the compensated workspace state.
  const { TimeMachineService } = await import(pathToFileURL(path.join(repository, 'dist', 'index.js')).href);
  const failedSessionId = 'web-smoke-missing-host-session';
  const failureFile = path.join(workspace, 'host-fork-failure.txt');
  await writeFile(failureFile, 'before-host-fork\n', 'utf8');
  const syntheticService = new TimeMachineService({
    workDir: workspace,
    storageDir: path.join(workspace, '.dsh', 'time-machine'),
  });
  const failureBase = await syntheticService.createTurnCheckpoint({
    sessionId: failedSessionId,
    turnIndex: 1,
    prompt: 'synthetic host-fork failure boundary',
    sessionState: { sessionId: failedSessionId, messages: [], boundarySeq: 0 },
  });
  await writeFile(failureFile, 'during-host-fork\n', 'utf8');
  await syntheticService.createTurnCheckpoint({
    sessionId: failedSessionId,
    turnIndex: 2,
    prompt: 'synthetic host-fork failure active state',
    sessionState: { sessionId: failedSessionId, messages: [], boundarySeq: 1 },
  });

  const failedFork = await fetch(`http://127.0.0.1:${pluginPort}/api/fork`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: failedSessionId, checkpointId: failureBase.id, branchName: 'host-fork-failure' }),
  });
  const failedForkBody = await failedFork.json();
  if (failedFork.ok || !String(failedForkBody.error ?? '').toLowerCase().includes('session')) {
    throw new Error(`Real SessionController failure was not surfaced: ${failedFork.status} ${JSON.stringify(failedForkBody)}`);
  }
  if ((await readFile(failureFile, 'utf8')) !== 'during-host-fork\n') {
    throw new Error('Host fork failure compensation did not restore the pre-call workspace.');
  }
  console.log('Real DSH SessionController fork failure compensation passed.');
  console.log('Real DSH web host session, finalized checkpoint, fork, and rewind passed.');
} finally {
  if (child && !child.killed) child.kill();
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
