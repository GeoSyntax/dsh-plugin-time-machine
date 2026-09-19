const API_BASE = window.location.origin;

let currentSessionId = new URLSearchParams(window.location.search).get('sessionId');
let dagData = null;
let selectedNodeId = null;

const timelineFlow = document.getElementById('timeline-flow');
const nodeCountBadge = document.getElementById('node-count');
const currentBranchBadge = document.getElementById('current-branch-badge');
const sessionBadge = document.getElementById('session-badge');
const sessionSelector = document.getElementById('session-selector');
const inspectorContent = document.getElementById('inspector-content');
const inspectorStatusBadge = document.getElementById('inspector-status-badge');
const btnRefresh = document.getElementById('btn-refresh');
const btnUndoLatest = document.getElementById('btn-undo-latest');
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
  if (!response.ok || body.error) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    if (body.code) error.code = body.code;
    if (body.details) error.details = body.details;
    if (body.capabilities) error.capabilities = body.capabilities;
    throw error;
  }
  return body;
}

async function loadDag() {
  if (!currentSessionId) {
    dagData = null;
    sessionBadge.textContent = 'none';
    showEmpty(timelineFlow, 'No persisted DSH sessions yet. Run a prompt to create the first checkpoint.');
    return;
  }
  try {
    dagData = await requestJson(`${API_BASE}/api/dag?sessionId=${encodeURIComponent(currentSessionId)}`);
    renderTimeline();
  } catch (error) {
    showEmpty(timelineFlow, `Failed to connect to Time Machine server: ${error.message}`, true);
  }
}

function syncSessionUrl() {
  const url = new URL(window.location.href);
  if (currentSessionId) url.searchParams.set('sessionId', currentSessionId);
  else url.searchParams.delete('sessionId');
  window.history.replaceState({}, '', url);
}

function renderSessionSelector(sessions) {
  sessionSelector.replaceChildren();
  for (const session of sessions) {
    const option = document.createElement('option');
    option.value = String(session.sessionId);
    option.textContent = `${session.sessionId} · ${session.checkpointCount} checkpoint(s)`;
    sessionSelector.append(option);
  }
  sessionSelector.disabled = sessions.length === 0;
  btnUndoLatest.disabled = sessions.length === 0;
  if (currentSessionId && sessions.some(item => item.sessionId === currentSessionId)) {
    sessionSelector.value = currentSessionId;
  }
}

async function loadSessions() {
  try {
    const body = await requestJson(`${API_BASE}/api/sessions`);
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    const requested = currentSessionId;
    if (!sessions.some(item => item.sessionId === requested)) currentSessionId = sessions[0]?.sessionId ?? null;
    renderSessionSelector(sessions);
    syncSessionUrl();
    await loadDag();
  } catch (error) {
    showEmpty(timelineFlow, `Failed to discover DSH sessions: ${error.message}`, true);
  }
}

sessionSelector.addEventListener('change', async () => {
  currentSessionId = sessionSelector.value || null;
  selectedNodeId = null;
  syncSessionUrl();
  await loadDag();
});

btnUndoLatest.addEventListener('click', async () => {
  if (!currentSessionId) return;
  const confirmed = confirm('Undo the latest completed turn and continue in a new DSH session? A rescue point will be created first.');
  if (!confirmed) return;
  btnUndoLatest.disabled = true;
  try {
    const result = await requestJson(`${API_BASE}/api/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, count: 1 }),
    });
    adoptConversation(result);
    await loadSessions();
    alert(`✔ Undid the latest turn. Continue in DSH session: ${result.conversation.sessionId}`);
  } catch (error) {
    alert(`Undo failed: ${error.message}`);
  } finally {
    btnUndoLatest.disabled = !currentSessionId;
  }
});

function adoptConversation(result) {
  const nextSessionId = result?.conversation?.sessionId;
  if (typeof nextSessionId !== 'string' || nextSessionId.length === 0) return false;
  currentSessionId = nextSessionId;
  selectedNodeId = null;
  sessionBadge.textContent = currentSessionId;
  syncSessionUrl();
  return true;
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
  const omitted = Array.isArray(node.omittedPaths) ? node.omittedPaths : [];
  const agentWrites = Array.isArray(node.agentWrites) ? node.agentWrites : [];
  const unattributed = Array.isArray(node.unattributedChanges) ? node.unattributedChanges : [];
  const toolMutations = Array.isArray(node.toolMutations) ? node.toolMutations : [];
  const meta = element('div', 'card-meta');
  meta.append(
    element('span', '', `🕒 ${new Date(node.timestamp).toLocaleTimeString()}`),
    element('span', '', `📁 ${files.length} file(s) changed`),
    ...(agentWrites.length ? [element('span', 'badge badge-success', `✎ ${agentWrites.length} Agent write(s)`)] : []),
    ...(unattributed.length ? [element('span', 'badge badge-warning', `? ${unattributed.length} unattributed`)] : []),
    ...(toolMutations.length ? [element('span', 'badge badge-info', `⚙ ${toolMutations.length} tool mutation(s)`)] : []),
    ...(omitted.length ? [element('span', 'badge badge-warning', `⚠ ${omitted.length} omitted`)] : []),
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
  inspectorContent.append(agentWritesGroup(node));
  inspectorContent.append(unattributedChangesGroup(node));
  inspectorContent.append(toolMutationsGroup(node));
  inspectorContent.append(fileChangesGroup(node));
}

function agentWritesGroup(node) {
  const writes = Array.isArray(node.agentWrites) ? node.agentWrites : [];
  if (writes.length === 0) {
    const empty = element('p', '', 'No verified Agent writes recorded for this checkpoint.');
    empty.style.color = 'var(--text-muted)';
    empty.style.fontSize = '0.8rem';
    return group('Agent Write Ledger (0)', empty);
  }
  const list = element('ul', 'file-list');
  for (const write of writes) {
    const item = element('li', 'file-item');
    const operation = String(write.operation || 'modify').toUpperCase();
    const digest = String(write.sha256 || '');
    item.append(
      element('span', '', `✎ ${String(write.path)}`),
      element('span', 'badge badge-success', operation),
      element('code', '', digest ? `${digest.slice(0, 12)}…` : 'hash unavailable'),
    );
    item.title = digest ? `SHA-256: ${digest}` : 'SHA-256 unavailable';
    list.append(item);
  }
  return group(`Agent Write Ledger (${writes.length})`, list);
}

function unattributedChangesGroup(node) {
  const changes = Array.isArray(node.unattributedChanges) ? node.unattributedChanges : [];
  if (changes.length === 0) return group('Unattributed Turn Changes (0)', element('p', '', 'No workspace changes lack Agent-write evidence.'));
  const body = element('div');
  body.append(element('div', 'info-box', 'These paths changed during the turn but were not attributed to a native Agent write event. Review before preserving hand edits.'));
  const list = element('ul', 'file-list');
  for (const change of changes) {
    const item = element('li', 'file-item');
    item.append(element('span', '', `? ${String(change.path)}`), element('span', 'badge badge-warning', String(change.status).toUpperCase()));
    list.append(item);
  }
  body.append(list);
  return group(`Unattributed Turn Changes (${changes.length})`, body);
}

function toolMutationsGroup(node) {
  const records = Array.isArray(node.toolMutations) ? node.toolMutations : [];
  if (records.length === 0) return group('Tool Mutation Ledger (0)', element('p', '', 'No pre-command tool mutation evidence recorded.'));
  const list = element('ul', 'file-list');
  for (const record of records) {
    const item = element('li', 'file-item');
    const files = Array.isArray(record.changedFiles) ? record.changedFiles : [];
    item.append(element('span', '', `⚙ ${String(record.toolName)}`), element('span', `badge ${record.status === 'error' ? 'badge-warning' : 'badge-success'}`, String(record.status).toUpperCase()), element('code', '', files.map(file => `${file.status} ${file.path}`).join(', ') || 'no workspace delta'));
    list.append(item);
  }
  return group(`Tool Mutation Ledger (${records.length})`, list);
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
    ...(Array.isArray(node.omittedPaths) && node.omittedPaths.length
      ? [['Omitted Paths', node.omittedPaths.join(', ')]]
      : []),
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
  const selectors = [];
  for (const file of files) {
    const item = element('li', 'file-item');
    item.tabIndex = 0;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(file.path);
    checkbox.title = 'Select this path for selective restore';
    checkbox.addEventListener('click', event => event.stopPropagation());
    selectors.push(checkbox);
    item.append(
      checkbox,
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
  const body = document.createElement('div');
  const omitted = Array.isArray(node.omittedPaths) ? node.omittedPaths : [];
  if (omitted.length) {
    const warning = element('div', 'info-box', `⚠ Partial checkpoint: ${omitted.length} path(s) were not captured. Rewind preserves their live content.`);
    body.append(warning);
  }
  body.append(list);
  const restore = element('button', 'btn btn-secondary', '↶ Restore selected files');
  restore.addEventListener('click', async event => {
    event.stopPropagation();
    const paths = selectors.filter(input => input.checked).map(input => input.value);
    if (paths.length === 0) return alert('Select at least one file first');
    if (!confirm(`Restore ${paths.length} selected path(s) from Turn #${node.turnIndex}?`)) return;
    try {
      const result = await requestJson(`${API_BASE}/api/restore-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, checkpointId: node.id, paths }),
      });
      await loadDag();
      alert(`✔ Restored ${result.result.restoredPaths.join(', ')}. Conversation unchanged.`);
    } catch (error) {
      alert(`Selective restore failed: ${error.message}`);
    }
  });
  body.append(restore);
  return group(`Workspace File Changes (${files.length})`, body);
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
    adoptConversation(result);
    await loadSessions();
    alert(`✔ Branch ${branchName} restored. Continue in DSH session: ${result.conversation.sessionId}`);
  } catch (error) {
    alert(`Fork failed: ${error.message}`);
  }
});

async function triggerRewind(nodeId, turnIndex) {
  let preview;
  try {
    const params = new URLSearchParams({ sessionId: currentSessionId, checkpoint: nodeId });
    preview = (await requestJson(`${API_BASE}/api/preview?${params}`)).preview;
  } catch (error) {
    alert(`Could not preview rewind: ${error.message}`);
    return;
  }
  const files = (preview.diffs || []).slice(0, 12).map(diff => `${diff.status} ${diff.file}`).join('\n');
  const more = (preview.diffs || []).length > 12 ? `\n…and ${(preview.diffs || []).length - 12} more` : '';
  const conflicts = (preview.conflictingPaths || []).slice(0, 12).join('\n');
  const conflictMore = (preview.conflictingPaths || []).length > 12 ? `\n…and ${(preview.conflictingPaths || []).length - 12} more` : '';
  const omitted = (preview.targetOmittedPaths || []).length
    ? `\n\n⚠ This is a partial checkpoint. Omitted paths will be preserved live:\n${preview.targetOmittedPaths.join('\n')}`
    : '';
  const preserved = (preview.preservedHandEditPaths || []).length
    ? `\n\n✓ Verified hand-edits will be preserved:\n${preview.preservedHandEditPaths.join('\n')}`
    : '';
  const externalEffects = (preview.externalEffects || []).length
    ? `\n\n⚠ External effects are not undone by file restore:\n${preview.externalEffects.map(effect => `${effect.status} ${effect.adapter}:${effect.operation}`).join('\n')}`
    : '';
  const warning = preview.requiresForce
    ? `\n\n⚠ Workspace drift detected; safe restore will refuse to overwrite it.\nConflicts:\n${conflicts || '(unavailable)'}${conflictMore}`
    : '';
  let merge = false;
  if (preview.requiresForce) {
    merge = confirm('Workspace drift was detected. OK will attempt a Git three-way merge and preserve non-conflicting local edits; Cancel aborts the rewind.');
    if (!merge) return;
  }
  const confirmed = confirm(
    `Rewind to Turn #${turnIndex}${merge ? ' with three-way merge' : ''}?\n\nPlanned file changes:\n${files || '(none)'}${more}${warning}${omitted}${preserved}${externalEffects}\n\nA rescue point is created first.`,
  );
  if (!confirmed) return;
  try {
    const result = await requestJson(`${API_BASE}/api/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, checkpointId: nodeId, restorePlanId: preview.restorePlanId, ...(merge ? { merge: true } : {}) }),
    });
    adoptConversation(result);
    await loadSessions();
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

void loadSessions();
