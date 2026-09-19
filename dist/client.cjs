"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  TimeMachineClient: () => TimeMachineClient,
  TimeMachineClientError: () => TimeMachineClientError,
  buildCompanionTimeline: () => buildCompanionTimeline
});
module.exports = __toCommonJS(client_exports);
var TimeMachineClientError = class extends Error {
  status;
  code;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "TimeMachineClientError";
    this.status = status;
    this.body = body;
    this.code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : body && typeof body === "object" && "error" in body && typeof body.error === "object" && body.error && "code" in body.error && typeof body.error.code === "string" ? body.error.code : void 0;
  }
};
var TimeMachineClient = class {
  baseUrl;
  http;
  constructor(options) {
    if (!options.baseUrl.trim()) throw new Error("TimeMachineClient requires a non-empty baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.http = options.fetch ?? globalThis.fetch;
    if (typeof this.http !== "function") throw new Error("TimeMachineClient requires fetch in this runtime.");
  }
  async capabilities() {
    return this.get("/api/capabilities").then((body) => objectField(body, "capabilities"));
  }
  async status() {
    return this.get("/api/status");
  }
  async storage(sessionId) {
    return this.get(`/api/storage${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`);
  }
  async dag(sessionId) {
    return this.get(`/api/dag?sessionId=${encodeURIComponent(sessionId)}`);
  }
  async sessions() {
    const body = await this.get("/api/sessions");
    return objectField(body, "sessions");
  }
  /** Resolve the checkpoint anchored to a finalized assistant message. */
  async checkpointForMessage(sessionId, messageId) {
    if (!sessionId.trim() || !messageId.trim()) throw new Error("checkpointForMessage requires sessionId and messageId.");
    const body = await this.get(`/api/checkpoint-for-message?sessionId=${encodeURIComponent(sessionId)}&messageId=${encodeURIComponent(messageId)}`);
    return objectField(body, "checkpoint");
  }
  /** Build a bounded, newest-first timeline without coupling consumers to React or DSH slots. */
  async timeline(sessionId, limit = 50) {
    if (!sessionId.trim()) throw new Error("timeline requires a non-empty sessionId.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("timeline limit must be an integer between 1 and 500.");
    return buildCompanionTimeline(await this.dag(sessionId), limit);
  }
  async preview(sessionId, checkpointId, options = {}) {
    const preserve = options.preserveVerifiedHandEdits === void 0 ? "" : `&preserveHandEdits=${String(options.preserveVerifiedHandEdits)}`;
    const body = await this.get(`/api/preview?sessionId=${encodeURIComponent(sessionId)}&checkpoint=${encodeURIComponent(checkpointId)}${preserve}`);
    const preview = objectField(body, "preview");
    if (preview.sessionId !== sessionId || preview.checkpointId !== checkpointId || typeof preview.restorePlanId !== "string" || !preview.restorePlanId) {
      throw new Error("Time Machine returned an invalid restore preview binding.");
    }
    return { sessionId, checkpointId, restorePlanId: preview.restorePlanId, preview };
  }
  async rewind(action, options = {}) {
    this.assertBinding(action);
    return this.post("/api/rewind", { ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, restorePlanId: action.restorePlanId });
  }
  /** Direct relative-turn undo for CLI-like companions; preview-first UIs may use timeline()+preview()+rewind(). */
  async undo(request) {
    if (!request.sessionId) throw new Error("undo requires sessionId.");
    const count = request.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("undo count must be an integer between 1 and 500.");
    return this.post("/api/undo", { ...request, count });
  }
  async fork(action, branchName, options = {}) {
    this.assertBinding(action);
    if (!branchName.trim()) throw new Error("branchName must be non-empty.");
    return this.post("/api/fork", { ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, restorePlanId: action.restorePlanId, branchName });
  }
  async restoreFiles(request) {
    if (!request.sessionId || !request.checkpointId || request.paths.length === 0) throw new Error("restoreFiles requires sessionId, checkpointId, and paths.");
    return this.post("/api/restore-files", request);
  }
  async restoreFilesFromPreview(action, paths, options = {}) {
    this.assertBinding(action);
    return this.restoreFiles({ ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, paths, restorePlanId: action.restorePlanId });
  }
  async restoreWorkspace(request) {
    if (!request.sessionId || !request.checkpointId) throw new Error("restoreWorkspace requires sessionId and checkpointId.");
    return this.post("/api/restore-workspace", request);
  }
  async restoreWorkspaceFromPreview(action, options = {}) {
    this.assertBinding(action);
    return this.restoreWorkspace({ ...options, sessionId: action.sessionId, checkpointId: action.checkpointId, restorePlanId: action.restorePlanId });
  }
  async recordExternalEffect(request) {
    if (!request.sessionId || !request.checkpointId || !request.adapter || !request.operation || !request.failureSemantics) {
      throw new Error("recordExternalEffect requires sessionId, checkpointId, adapter, operation, and failureSemantics.");
    }
    return this.post("/api/external-effects", request);
  }
  async compensateExternalEffect(request) {
    if (!request.sessionId || !request.checkpointId || !request.effectId) {
      throw new Error("compensateExternalEffect requires sessionId, checkpointId, and effectId.");
    }
    return this.post("/api/external-effects/compensate", request);
  }
  async diff(sessionId, baseCheckpointId, targetCheckpointId) {
    return this.get(`/api/diff?sessionId=${encodeURIComponent(sessionId)}&base=${encodeURIComponent(baseCheckpointId)}&target=${encodeURIComponent(targetCheckpointId)}`);
  }
  async agentWrites(sessionId, checkpointId) {
    return this.get(`/api/agent-writes?sessionId=${encodeURIComponent(sessionId)}&checkpoint=${encodeURIComponent(checkpointId)}`);
  }
  async unattributedChanges(sessionId, checkpointId) {
    return this.get(`/api/unattributed-changes?sessionId=${encodeURIComponent(sessionId)}&checkpoint=${encodeURIComponent(checkpointId)}`);
  }
  assertBinding(action) {
    if (!action || action.preview.sessionId !== action.sessionId || action.preview.checkpointId !== action.checkpointId || action.preview.restorePlanId !== action.restorePlanId) {
      throw new Error("Restore action is not bound to its preview session/checkpoint.");
    }
  }
  async get(pathname) {
    return this.request(pathname, { method: "GET" });
  }
  async post(pathname, body) {
    return this.request(pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async request(pathname, init) {
    const response = await this.http(`${this.baseUrl}${pathname}`, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new TimeMachineClientError(`Time Machine request failed (${response.status}).`, response.status, body);
    return body;
  }
};
function objectField(value, field) {
  if (!value || typeof value !== "object" || !(field in value)) throw new Error(`Time Machine response is missing '${field}'.`);
  return value[field];
}
function buildCompanionTimeline(dag, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("timeline limit must be an integer between 1 and 500.");
  const currentId = dag.currentCheckpointId;
  const lineage = currentId ? lineageFor(dag, currentId) : [];
  const relativeById = /* @__PURE__ */ new Map();
  const seenTurns = /* @__PURE__ */ new Set();
  let relativeUndo = 0;
  for (const node of [...lineage].reverse()) {
    if (!isUserVisible(node) || seenTurns.has(node.turnIndex)) continue;
    seenTurns.add(node.turnIndex);
    relativeById.set(node.id, relativeUndo);
    relativeUndo += 1;
  }
  return Object.values(dag.nodes).sort((left, right) => right.timestamp - left.timestamp).slice(0, limit).map((checkpoint) => {
    const userVisible = isUserVisible(checkpoint);
    const warnings = [];
    if (checkpoint.status === "running") warnings.push("turn is still running");
    if (checkpoint.omittedPaths?.length) warnings.push(`${checkpoint.omittedPaths.length} path(s) omitted`);
    if (checkpoint.unattributedChanges?.length) warnings.push(`${checkpoint.unattributedChanges.length} unattributed change(s)`);
    if (checkpoint.externalEffects?.some((effect) => effect.status !== "compensated")) warnings.push("external effects require review");
    const relative = relativeById.get(checkpoint.id);
    return {
      checkpoint,
      relativeUndo: relative ?? null,
      isCurrent: checkpoint.id === currentId,
      userVisible,
      canUndo: userVisible && checkpoint.status !== "running" && relative !== void 0 && relative > 0,
      warnings
    };
  });
}
function isUserVisible(node) {
  return node.status !== "running" && !node.tags?.includes("pre-command") && !node.tags?.includes("rescue") && !node.tags?.includes("selective-restore");
}
function lineageFor(dag, checkpointId) {
  const result = [];
  let cursor = checkpointId;
  while (cursor) {
    const node = dag.nodes[cursor];
    if (!node) break;
    result.unshift(node);
    cursor = node.parentId;
  }
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TimeMachineClient,
  TimeMachineClientError,
  buildCompanionTimeline
});
//# sourceMappingURL=client.cjs.map