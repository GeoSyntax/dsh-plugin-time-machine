const API_BASE = window.location.origin;

let currentSessionId = 'default';
let dagData = null;
let selectedNodeId = null;

const timelineFlow = document.getElementById('timeline-flow');
const nodeCountBadge = document.getElementById('node-count');
const currentBranchBadge = document.getElementById('current-branch-badge');
const sessionBadge = document.getElementById('session-badge');
const inspectorContent = document.getElementById('inspector-content');
const inspectorStatusBadge = document.getElementById('inspector-status-badge');
const btnRefresh = document.getElementById('btn-refresh');
const forkModal = document.getElementById('fork-modal');
const modalForkFrom = document.getElementById('modal-fork-from');
const forkBranchInput = document.getElementById('fork-branch-input');
const forkDescInput = document.getElementById('fork-desc-input');
const modalCancelFork = document.getElementById('modal-cancel-fork');
const modalConfirmFork = document.getElementById('modal-confirm-fork');
const diffModal = document.getElementById('diff-modal');
const diffTitle = document.getElementById('diff-title');
const diffContent = document.getElementById('diff-content');
const diffModalClose = document.getElementById('diff-modal-close');

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function loadDag() {
  try {
    dagData = await requestJson(`${API_BASE}/api/dag?sessionId=${encodeURIComponent(currentSessionId)}`);
    renderTimeline();
  } catch (error) {
    showEmpty(timelineFlow, `Failed to connect to Time Machine server: ${error.message}`, true);
  }
}

function renderTimeline() {
  if (!dagData || !dagData.nodes) return;
  currentBranchBadge.textContent = String(dagData.currentBranch);
  sessionBadge.textContent = String(dagData.sessionId);

  const nodes = Object.values(dagData.nodes).sort((left, right) => left.timestamp - right.timestamp);
  nodeCountBadge.textContent = `${nodes.length} checkpoints`;
  timelineFlow.replaceChildren();
  if (nodes.length === 0) {
    showEmpty(timelineFlow, 'No checkpoints recorded yet. Run a prompt to generate the first checkpoint.');
    return;
  }

  for (const node of nodes) timelineFlow.append(createTimelineCard(node));
  if (!selectedNodeId && dagData.currentCheckpointId) selectedNodeId = dagData.currentCheckpointId;
  if (selectedNodeId) selectNode(selectedNodeId);
}

function createTimelineCard(node) {
  const isCurrent = node.id === dagData.currentCheckpointId;
  const card = element('div', `timeline-card ${isCurrent ? 'active' : ''}`);
  card.addEventListener('click', () => selectNode(node.id));

  const top = element('div', 'card-top');
  const title = element('span', 'card-title', `${isCurrent ? '⚡' : '📍'} Turn #${node.turnIndex} `);
  title.append(element('span', 'card-branch', String(node.branch)));
  const status = statusPresentation(node.status);
  top.append(title, element('span', `badge ${status.className}`, status.text));

  const files = Array.isArray(node.changedFiles) ? node.changedFiles : [];
  const meta = element('div', 'card-meta');
  meta.append(
    element('span', '', `🕒 ${new Date(node.timestamp).toLocaleTimeString()}`),
    element('span', '', `📁 ${files.length} file(s) changed`),
  );
  card.append(top, element('div', 'card-prompt', String(node.prompt || '')), meta);
  return card;
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  const node = dagData.nodes[nodeId];
  if (!node) return;
  inspectorStatusBadge.textContent = `Viewing Turn #${node.turnIndex}`;
  inspectorStatusBadge.className = 'badge badge-success';
  inspectorContent.className = 'inspector-body';
  inspectorContent.replaceChildren();

  const actions = element('div', 'action-bar');
  const forkButton = element('button', 'btn btn-primary', '🌿 Fork Exploration Branch');
  forkButton.addEventListener('click', () => openForkModal(node.id, node.turnIndex));
  const rewindButton = element('button', 'btn btn-danger', '⚡ Rewind to This Turn');
  rewindButton.addEventListener('click', () => triggerRewind(node.id, node.turnIndex));
  actions.append(forkButton, rewindButton);

  inspectorContent.append(
    actions,
    infoGroup('Turn Instruction', String(node.prompt || '')),
    metadataGroup(node),
  );
  if (node.summary) inspectorContent.append(infoGroup('Execution Summary', String(node.summary)));
  inspectorContent.append(fileChangesGroup(node));
}

function metadataGroup(node) {
  const body = element('div', 'info-box');
  body.style.fontSize = '0.75rem';
  for (const [label, value] of [
    ['Node ID', node.id],
    ['Branch', node.branch],
    ['Git Commit OID', node.gitCommitOid || 'N/A'],
    ['Git Tree OID', node.gitTreeOid || 'N/A'],
    ['Timestamp', new Date(node.timestamp).toLocaleString()],
  ]) {
    const row = document.createElement('div');
    const strong = element('strong', '', `${label}: `);
    row.append(strong, document.createTextNode(String(value)));
    body.append(row);
  }
  return group('Snapshot Metadata', body);
}

function fileChangesGroup(node) {
  const files = Array.isArray(node.changedFiles) ? node.changedFiles : [];
  if (files.length === 0) {
    const empty = element('p', '', 'No files modified in this turn.');
    empty.style.color = 'var(--text-muted)';
    empty.style.fontSize = '0.8rem';
    return group('Workspace File Changes (0)', empty);
  }

  const list = element('ul', 'file-list');
  for (const file of files) {
    const item = element('li', 'file-item');
    item.tabIndex = 0;
    item.append(
      element('span', '', `📄 ${String(file.path)}`),
      element('span', `badge ${file.status === 'added' ? 'badge-success' : 'badge-idle'}`, String(file.status).toUpperCase()),
    );
    const open = () => viewDiff(node.parentId || '', node.id, String(file.path));
    item.addEventListener('click', open);
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') open();
    });
    list.append(item);
  }
  return group(`Workspace File Changes (${files.length})`, list);
}

function openForkModal(nodeId, turnIndex) {
  selectedNodeId = nodeId;
  modalForkFrom.textContent = `Turn #${turnIndex} (${nodeId})`;
  forkBranchInput.value = `branch-turn-${turnIndex}-alt`;
  forkModal.classList.remove('hidden');
}

modalCancelFork.addEventListener('click', () => forkModal.classList.add('hidden'));

modalConfirmFork.addEventListener('click', async () => {
  const branchName = forkBranchInput.value.trim();
  const description = forkDescInput.value.trim();
  if (!branchName) return alert('Branch name is required');
  try {
    const result = await requestJson(`${API_BASE}/api/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, checkpointId: selectedNodeId, branchName, description }),
    });
    forkModal.classList.add('hidden');
    await loadDag();
    alert(`✔ Branch ${branchName} restored. Continue in DSH session: ${result.conversation.sessionId}`);
  } catch (error) {
    alert(`Fork failed: ${error.message}`);
  }
});

async function triggerRewind(nodeId, turnIndex) {
  const confirmed = confirm(
    `Rewind to Turn #${turnIndex}?\n\nThe workspace will be restored and DSH will fork a new conversation at the saved event boundary. A rescue point is created first.`,
  );
  if (!confirmed) return;
  try {
    const result = await requestJson(`${API_BASE}/api/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, checkpointId: nodeId }),
    });
    await loadDag();
    alert(`✔ Restored Turn #${turnIndex}. Continue in DSH session: ${result.conversation.sessionId}`);
  } catch (error) {
    alert(`Rewind failed: ${error.message}`);
  }
}

async function viewDiff(baseId, targetId, filePath) {
  try {
    const params = new URLSearchParams({ sessionId: currentSessionId, base: baseId, target: targetId });
    const data = await requestJson(`${API_BASE}/api/diff?${params}`);
    const selected = data.diffs?.find(diff => diff.file === filePath) ?? data.diffs?.[0];
    diffTitle.textContent = `Diff: ${filePath}`;
    diffContent.textContent = selected?.diffText ?? 'No textual diff detected.';
    diffModal.classList.remove('hidden');
  } catch (error) {
    alert(`Failed to load diff: ${error.message}`);
  }
}

diffModalClose.addEventListener('click', () => diffModal.classList.add('hidden'));
btnRefresh.addEventListener('click', loadDag);

function infoGroup(title, text) {
  return group(title, element('div', 'info-box', text));
}

function group(title, body) {
  const wrapper = element('div', 'meta-group');
  wrapper.append(element('h4', '', title), body);
  return wrapper;
}

function showEmpty(container, message, isError = false) {
  const node = element('div', 'empty-state', message);
  if (isError) node.style.color = '#ef4444';
  container.replaceChildren(node);
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function statusPresentation(status) {
  if (status === 'failed') return { className: 'badge-failed', text: '✖ FAILED' };
  if (status === 'aborted') return { className: 'badge-idle', text: '■ ABORTED' };
  if (status === 'running') return { className: 'badge-idle', text: '… RUNNING' };
  return { className: 'badge-success', text: '✔ SUCCESS' };
}

void loadDag();
