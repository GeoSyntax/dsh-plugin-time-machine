"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/.pnpm/tsup@8.5.1_postcss@8.5.28_tsx@4.23.13_typescript@5.9.3/node_modules/tsup/assets/cjs_shims.js
var getImportMetaUrl, importMetaUrl;
var init_cjs_shims = __esm({
  "node_modules/.pnpm/tsup@8.5.1_postcss@8.5.28_tsx@4.23.13_typescript@5.9.3/node_modules/tsup/assets/cjs_shims.js"() {
    "use strict";
    getImportMetaUrl = () => typeof document === "undefined" ? new URL(`file:${__filename}`).href : document.currentScript && document.currentScript.tagName.toUpperCase() === "SCRIPT" ? document.currentScript.src : new URL("main.js", document.baseURI).href;
    importMetaUrl = /* @__PURE__ */ getImportMetaUrl();
  }
});

// src/core/git-plumbing.ts
var git_plumbing_exports = {};
__export(git_plumbing_exports, {
  GitPlumbingEngine: () => GitPlumbingEngine,
  QuarantineKeyError: () => QuarantineKeyError,
  QuarantineQuotaError: () => QuarantineQuotaError,
  SnapshotSizeError: () => SnapshotSizeError,
  UnsupportedWorkspaceStateError: () => UnsupportedWorkspaceStateError,
  WorkspaceDriftError: () => WorkspaceDriftError,
  WorkspaceMergeConflictError: () => WorkspaceMergeConflictError,
  WorkspaceRestoreConflictError: () => WorkspaceRestoreConflictError
});
async function sumFileSizes(files) {
  let total = 0;
  for (const file of files) total += (await import_promises.default.stat(file).catch(() => ({ size: 0 }))).size;
  return total;
}
async function directoryBytes(root) {
  const rootStat = await import_promises.default.stat(root).catch(() => void 0);
  if (rootStat?.isFile()) return rootStat.size;
  let total = 0;
  for (const entry of await import_promises.default.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const absolute = import_node_path.default.join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(absolute);
    else total += (await import_promises.default.stat(absolute).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
function encodeRefPart(value) {
  return Buffer.from(value, "utf8").toString("base64url") || "_";
}
function normalizeGitPath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
function symmetricDifference(left, right) {
  return [...left].filter((item) => !right.has(item)).concat([...right].filter((item) => !left.has(item))).sort();
}
function longestFirst(left, right) {
  return right.split("/").length - left.split("/").length || right.localeCompare(left);
}
var import_node_child_process, import_node_crypto, import_node_util, import_node_path, import_promises, import_node_zlib, execFileAsync, WorkspaceDriftError, UnsupportedWorkspaceStateError, WorkspaceRestoreConflictError, WorkspaceMergeConflictError, QuarantineQuotaError, QuarantineKeyError, SnapshotSizeError, GitPlumbingEngine;
var init_git_plumbing = __esm({
  "src/core/git-plumbing.ts"() {
    "use strict";
    init_cjs_shims();
    import_node_child_process = require("child_process");
    import_node_crypto = require("crypto");
    import_node_util = require("util");
    import_node_path = __toESM(require("path"), 1);
    import_promises = __toESM(require("fs/promises"), 1);
    import_node_zlib = __toESM(require("zlib"), 1);
    execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
    WorkspaceDriftError = class extends Error {
      constructor(details) {
        super(`Workspace changed after the latest checkpoint: ${details.slice(0, 8).join(", ")}`);
        this.details = details;
        this.name = "WorkspaceDriftError";
      }
      details;
      code = "WORKSPACE_DRIFT";
    };
    UnsupportedWorkspaceStateError = class extends Error {
      constructor(capabilities) {
        const reasons = [
          capabilities.sparseCheckout ? "sparse checkout" : "",
          capabilities.submodulePaths.length ? `submodules: ${capabilities.submodulePaths.join(", ")}` : "",
          capabilities.inProgressOperation ? `in-progress ${capabilities.inProgressOperation}` : ""
        ].filter(Boolean);
        super(`Workspace state is not fully snapshot-safe: ${reasons.join("; ")}. Complete or disable the operation, then retry.`);
        this.capabilities = capabilities;
        this.name = "UnsupportedWorkspaceStateError";
      }
      capabilities;
      code = "UNSUPPORTED_WORKSPACE_STATE";
    };
    WorkspaceRestoreConflictError = class extends Error {
      constructor(paths) {
        super(`Ignored files block restore: ${paths.slice(0, 8).join(", ")}`);
        this.paths = paths;
        this.name = "WorkspaceRestoreConflictError";
      }
      paths;
      code = "RESTORE_CONFLICT";
    };
    WorkspaceMergeConflictError = class extends Error {
      constructor(paths) {
        super(`Merge restore conflicts require review: ${paths.slice(0, 8).join(", ")}`);
        this.paths = paths;
        this.name = "WorkspaceMergeConflictError";
      }
      paths;
      code = "RESTORE_MERGE_CONFLICT";
    };
    QuarantineQuotaError = class extends Error {
      constructor(limitBytes, requiredBytes) {
        super(`Ignored-file quarantine limit exceeded: ${requiredBytes} > ${limitBytes} bytes.`);
        this.limitBytes = limitBytes;
        this.requiredBytes = requiredBytes;
        this.name = "QuarantineQuotaError";
      }
      limitBytes;
      requiredBytes;
      code = "QUARANTINE_QUOTA_EXCEEDED";
    };
    QuarantineKeyError = class extends Error {
      code = "QUARANTINE_KEY_INVALID";
      constructor(message) {
        super(message);
        this.name = "QuarantineKeyError";
      }
    };
    SnapshotSizeError = class extends Error {
      constructor(details) {
        const message = details.file ? `Snapshot file '${details.file}' is ${details.fileBytes} bytes; limit is ${details.limitBytes} bytes.` : `Snapshot is ${details.totalBytes} bytes; limit is ${details.limitBytes} bytes.`;
        super(message);
        this.details = details;
        this.name = "SnapshotSizeError";
      }
      details;
      code = "SNAPSHOT_SIZE_LIMIT";
    };
    GitPlumbingEngine = class {
      workDir;
      refPrefix;
      preservePaths;
      quarantineDir;
      isRepoCached = null;
      repoRootCached = null;
      gitDirCached = null;
      shadowObjectDir;
      maxQuarantineBytes;
      maxSnapshotFileBytes;
      maxSnapshotBytes;
      quarantineKey;
      shadowReady;
      constructor(options) {
        this.workDir = import_node_path.default.resolve(options.workDir);
        this.refPrefix = options.refPrefix || "refs/dsh-tm";
        this.preservePaths = (options.preservePaths ?? []).map((item) => import_node_path.default.resolve(this.workDir, item));
        this.quarantineDir = options.quarantineDir ? import_node_path.default.resolve(options.quarantineDir) : void 0;
        this.shadowObjectDir = options.shadowObjectDir ? import_node_path.default.resolve(options.shadowObjectDir) : void 0;
        this.maxQuarantineBytes = Math.max(0, Math.floor(options.maxQuarantineBytes ?? 0));
        this.maxSnapshotFileBytes = Math.max(0, Math.floor(options.maxSnapshotFileBytes ?? 0));
        this.maxSnapshotBytes = Math.max(0, Math.floor(options.maxSnapshotBytes ?? 0));
        this.quarantineKey = options.quarantineEncryptionKey ? (0, import_node_crypto.createHash)("sha256").update(options.quarantineEncryptionKey).digest() : void 0;
      }
      get usesShadowStore() {
        return Boolean(this.shadowObjectDir);
      }
      async isGitRepo() {
        if (this.isRepoCached !== null) return this.isRepoCached;
        try {
          const { stdout } = await this.runGit(["rev-parse", "--is-inside-work-tree"]);
          this.isRepoCached = stdout.trim() === "true";
        } catch {
          this.isRepoCached = false;
        }
        return this.isRepoCached;
      }
      async getRepoRoot() {
        if (this.repoRootCached) return this.repoRootCached;
        const { stdout } = await this.runGit(["rev-parse", "--show-toplevel"]);
        this.repoRootCached = await import_promises.default.realpath(import_node_path.default.resolve(stdout.trim())).catch(() => import_node_path.default.resolve(stdout.trim()));
        this.preservePaths = await Promise.all(this.preservePaths.map(async (absolute) => await import_promises.default.realpath(absolute).catch(() => absolute)));
        return this.repoRootCached;
      }
      async getGitDir() {
        if (this.gitDirCached) return this.gitDirCached;
        const { stdout } = await this.runGit(["rev-parse", "--absolute-git-dir"]);
        this.gitDirCached = import_node_path.default.resolve(stdout.trim());
        return this.gitDirCached;
      }
      async runGit(args, extraEnv = {}, cwd = this.workDir) {
        await this.ensureShadowStore();
        const env = this.gitEnv(extraEnv);
        try {
          return await execFileAsync("git", args, {
            cwd,
            env,
            maxBuffer: 32 * 1024 * 1024,
            encoding: "utf8"
          });
        } catch (err) {
          const errorMsg = err.stderr || err.stdout || err.message;
          throw new Error(`Git plumbing command failed: git ${args.join(" ")}
Reason: ${errorMsg}`);
        }
      }
      async createSnapshot(params) {
        if (!await this.isGitRepo()) {
          throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
        }
        await this.assertSupportedWorkspace();
        const enforceSnapshotLimits = this.maxSnapshotFileBytes > 0 || this.maxSnapshotBytes > 0;
        const { treeOid, indexFile } = await this.writeWorkspaceTree(enforceSnapshotLimits);
        try {
          const commitMsg = params.message || `DSH Checkpoint [${params.sessionId}:${params.checkpointId}]`;
          const commitArgs = ["commit-tree", treeOid, "-m", commitMsg];
          if (params.parentCommitOid) {
            await this.runGit(["cat-file", "-e", `${params.parentCommitOid}^{commit}`]);
            commitArgs.push("-p", params.parentCommitOid);
          }
          const identityEnv = {
            GIT_AUTHOR_NAME: "DSH Time Machine",
            GIT_AUTHOR_EMAIL: "time-machine@localhost",
            GIT_COMMITTER_NAME: "DSH Time Machine",
            GIT_COMMITTER_EMAIL: "time-machine@localhost"
          };
          const { stdout: commitStdout } = await this.runGit(commitArgs, identityEnv);
          const commitOid = commitStdout.trim();
          const checkpointRef = `${this.refPrefix}/${encodeRefPart(params.sessionId)}/nodes/${encodeRefPart(params.checkpointId)}`;
          await this.runGit(["update-ref", checkpointRef, commitOid]);
          const changedFiles = params.parentCommitOid ? await this.computeChangedFiles(params.parentCommitOid, commitOid) : await this.listTreeFiles(treeOid);
          return {
            treeOid,
            commitOid,
            changedFiles,
            ignoredPaths: await this.listIgnoredPaths()
          };
        } finally {
          await import_promises.default.rm(indexFile, { force: true }).catch(() => void 0);
        }
      }
      /** Compute the current managed tree without publishing a commit or ref. */
      async inspectWorkspace() {
        const { treeOid, indexFile } = await this.writeWorkspaceTree();
        try {
          return { treeOid, ignoredPaths: await this.listIgnoredPaths() };
        } finally {
          await import_promises.default.rm(indexFile, { force: true }).catch(() => void 0);
        }
      }
      /** Read Git control-plane state without touching the user's index or refs. */
      async inspectControlPlane() {
        if (!await this.isGitRepo()) return { headOid: null, branch: "", operation: null };
        const headOid = await this.runGit(["rev-parse", "--verify", "HEAD"]).then((result) => result.stdout.trim() || null).catch(() => null);
        const branch = await this.runGit(["symbolic-ref", "--short", "-q", "HEAD"]).then((result) => result.stdout.trim()).catch(() => "");
        const gitDir = await this.getGitDir();
        const operationFiles = [
          ["MERGE_HEAD", "merge"],
          ["CHERRY_PICK_HEAD", "cherry-pick"],
          ["REVERT_HEAD", "revert"]
        ];
        for (const [file, operation] of operationFiles) {
          if (await import_promises.default.access(import_node_path.default.join(gitDir, file)).then(() => true).catch(() => false)) return { headOid, branch, operation };
        }
        const rebaseDirs = [["rebase-merge", "rebase"], ["rebase-apply", "rebase"]];
        for (const [directory, operation] of rebaseDirs) {
          if (await import_promises.default.access(import_node_path.default.join(gitDir, directory)).then(() => true).catch(() => false)) return { headOid, branch, operation };
        }
        return { headOid, branch, operation: null };
      }
      /** Detect Git modes whose contents are not fully represented by one worktree tree. */
      async inspectWorkspaceCapabilities() {
        const control = await this.inspectControlPlane();
        if (!await this.isGitRepo()) {
          return { sparseCheckout: false, submodulePaths: [], inProgressOperation: control.operation };
        }
        const sparseConfig = await this.runGit(["config", "--bool", "--get", "core.sparseCheckout"]).then((result) => result.stdout.trim() === "true").catch(() => false);
        const gitDir = await this.getGitDir();
        const sparseFile = await import_promises.default.access(import_node_path.default.join(gitDir, "info", "sparse-checkout")).then(() => true).catch(() => false);
        const { stdout } = await this.runGit(["ls-files", "--stage", "-z"]).catch(() => ({ stdout: "" }));
        const submodulePaths = stdout.split("\0").filter(Boolean).map((entry) => entry.match(/^160000\s+[0-9a-f]+\s+\d+\t(.+)$/)?.[1]).filter((item) => Boolean(item));
        return { sparseCheckout: sparseConfig || sparseFile, submodulePaths, inProgressOperation: control.operation };
      }
      async assertSupportedWorkspace() {
        const capabilities = await this.inspectWorkspaceCapabilities();
        if (capabilities.sparseCheckout || capabilities.submodulePaths.length || capabilities.inProgressOperation) {
          throw new UnsupportedWorkspaceStateError(capabilities);
        }
      }
      /** Restore with an isolated index so the user's staged changes are never rewritten. */
      async restoreSnapshot(commitOrTreeOid, options = {}) {
        if (!await this.isGitRepo()) {
          throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
        }
        await this.assertSupportedWorkspace();
        const mode = options.mode ?? "safe";
        const current = await this.inspectWorkspace();
        if (mode === "safe" && options.expectedCurrentTreeOid && current.treeOid !== options.expectedCurrentTreeOid) {
          const details = await this.diffNameOnly(options.expectedCurrentTreeOid, current.treeOid);
          throw new WorkspaceDriftError(details.length ? details : ["managed files"]);
        }
        if (mode === "safe" && options.expectedCurrentIgnoredPaths) {
          const expected = new Set(options.expectedCurrentIgnoredPaths);
          const drift = symmetricDifference(expected, new Set(current.ignoredPaths));
          if (drift.length) throw new WorkspaceDriftError(drift.map((item) => `(ignored) ${item}`));
        }
        const { stdout: treeStdout } = await this.runGit(["rev-parse", `${commitOrTreeOid}^{tree}`]);
        const targetTree = treeStdout.trim();
        const restoreTree = mode === "merge" ? await this.mergeWorkspaceTree(options.expectedCurrentTreeOid, targetTree, current.treeOid) : targetTree;
        const targetIgnored = new Set(options.targetIgnoredPaths ?? []);
        const ignoredToDelete = current.ignoredPaths.filter((item) => !targetIgnored.has(item));
        const targetFiles = new Set(await this.listTreeFileNames(restoreTree));
        const targetEntries = this.shadowObjectDir ? await this.listTreeEntries(restoreTree) : [];
        const collisions = current.ignoredPaths.filter((item) => targetFiles.has(item));
        if (collisions.length && !options.deleteNewIgnoredPaths) {
          throw new WorkspaceRestoreConflictError(collisions);
        }
        const deletedIgnoredPaths = [];
        if (options.deleteNewIgnoredPaths) {
          for (const relative of [.../* @__PURE__ */ new Set([...ignoredToDelete, ...collisions])].sort(longestFirst)) {
            if (this.isPreservedRelative(relative)) continue;
            const absolute = await this.safeWorkspacePath(relative);
            if (options.ignoredBackupKey) await this.backupIgnoredPath(options.ignoredBackupKey, relative, absolute);
            await import_promises.default.rm(absolute, { recursive: true, force: true });
            deletedIgnoredPaths.push(relative);
          }
        }
        const root = await this.getRepoRoot();
        const { indexFile } = await this.writeWorkspaceTree();
        try {
          const restoreArgs = this.shadowObjectDir ? ["read-tree", "--reset", restoreTree] : ["read-tree", "--reset", "-u", restoreTree];
          await this.runGit(restoreArgs, { GIT_INDEX_FILE: indexFile }, root);
          if (this.shadowObjectDir) {
            const currentFiles = await this.listTreeFileNames(current.treeOid);
            for (const entry of targetEntries) {
              const destination = await this.safeWorkspacePath(entry.path);
              await import_promises.default.mkdir(import_node_path.default.dirname(destination), { recursive: true });
              await import_promises.default.rm(destination, { recursive: true, force: true });
              const content = await this.readShadowBlob(entry.oid, root);
              if (entry.mode === "120000") {
                await import_promises.default.symlink(content.toString("utf8"), destination);
              } else {
                await import_promises.default.writeFile(destination, content);
                await import_promises.default.chmod(destination, Number.parseInt(entry.mode, 8) & 511).catch(() => void 0);
              }
            }
            for (const relative of currentFiles.filter((file) => !targetFiles.has(file)).sort(longestFirst)) {
              await import_promises.default.rm(await this.safeWorkspacePath(relative), { recursive: true, force: true });
            }
          }
        } finally {
          await import_promises.default.rm(indexFile, { force: true }).catch(() => void 0);
        }
        return { deletedIgnoredPaths, restoredTreeOid: restoreTree };
      }
      async mergeWorkspaceTree(baseTree, targetTree, currentTree) {
        if (!baseTree) throw new Error("Merge restore requires the active checkpoint tree.");
        const indexFile = import_node_path.default.join(await this.getGitDir(), `dsh-tm-merge-index-${(0, import_node_crypto.randomUUID)()}`);
        try {
          await this.runGit(["read-tree", "-m", baseTree, targetTree, currentTree], { GIT_INDEX_FILE: indexFile });
          const { stdout: conflicts } = await this.runGit(["ls-files", "-u", "-z"], { GIT_INDEX_FILE: indexFile });
          const paths = [...new Set(conflicts.split("\0").filter(Boolean).map((entry) => normalizeGitPath(entry.slice(entry.indexOf("	") + 1))))];
          if (paths.length) throw new WorkspaceMergeConflictError(paths);
          const { stdout } = await this.runGit(["write-tree"], { GIT_INDEX_FILE: indexFile });
          return stdout.trim();
        } finally {
          await import_promises.default.rm(indexFile, { force: true }).catch(() => void 0);
        }
      }
      /** Restore only selected tracked workspace paths using a disposable index. */
      async restoreSelectedPaths(commitOrTreeOid, paths, options = {}) {
        if (!await this.isGitRepo()) throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
        await this.assertSupportedWorkspace();
        const normalized = [...new Set(paths.map(normalizeGitPath).filter(Boolean))];
        if (normalized.length === 0) throw new Error("At least one workspace path is required.");
        for (const relative of normalized) await this.safeWorkspacePath(relative);
        const mode = options.mode ?? "safe";
        const current = await this.inspectWorkspace();
        const ignoredSelection = current.ignoredPaths.filter((file) => normalized.some((path8) => file === path8 || file.startsWith(`${path8}/`)));
        if (ignoredSelection.length) throw new WorkspaceRestoreConflictError(ignoredSelection);
        if (mode === "safe" && options.expectedCurrentTreeOid && current.treeOid !== options.expectedCurrentTreeOid) {
          const changed = await this.diffNameOnly(options.expectedCurrentTreeOid, current.treeOid);
          const selectedDrift = changed.filter((file) => normalized.some((path8) => file === path8 || file.startsWith(`${path8}/`)));
          if (selectedDrift.length) throw new WorkspaceDriftError(selectedDrift);
        }
        const { stdout: treeStdout } = await this.runGit(["rev-parse", `${commitOrTreeOid}^{tree}`]);
        const targetTree = treeStdout.trim();
        const targetFiles = await this.listTreeFileNames(targetTree);
        const currentFiles = await this.listTreeFileNames(current.treeOid);
        const selectedTargetFiles = targetFiles.filter((file) => normalized.some((path8) => file === path8 || file.startsWith(`${path8}/`)));
        const selectedCurrentFiles = currentFiles.filter((file) => normalized.some((path8) => file === path8 || file.startsWith(`${path8}/`)));
        if (selectedTargetFiles.length === 0 && selectedCurrentFiles.length === 0) {
          throw new Error(`None of the selected paths exist in the current or target snapshot: ${normalized.join(", ")}`);
        }
        const exportDir = import_node_path.default.join(await import_promises.default.mkdtemp(import_node_path.default.join(await import_promises.default.mkdtemp(import_node_path.default.join(this.workDir, ".dsh-tm-export-")), "snapshot-")));
        const indexFile = import_node_path.default.join(await this.getGitDir(), `dsh-tm-index-${(0, import_node_crypto.randomUUID)()}`);
        try {
          await import_promises.default.mkdir(exportDir, { recursive: true });
          await this.runGit(["read-tree", targetTree], { GIT_INDEX_FILE: indexFile });
          await this.runGit(["checkout-index", "--all", `--prefix=${exportDir}${import_node_path.default.sep}`], { GIT_INDEX_FILE: indexFile });
          const targetSet = new Set(selectedTargetFiles);
          for (const relative of selectedCurrentFiles) {
            if (targetSet.has(relative)) continue;
            await import_promises.default.rm(await this.safeWorkspacePath(relative), { recursive: true, force: true });
          }
          for (const relative of selectedTargetFiles) {
            const source = import_node_path.default.join(exportDir, ...relative.split("/"));
            const destination = await this.safeWorkspacePath(relative);
            await import_promises.default.mkdir(import_node_path.default.dirname(destination), { recursive: true });
            await import_promises.default.rm(destination, { recursive: true, force: true });
            await import_promises.default.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
          }
          return normalized;
        } finally {
          await import_promises.default.rm(indexFile, { force: true }).catch(() => void 0);
          await import_promises.default.rm(import_node_path.default.dirname(exportDir), { recursive: true, force: true }).catch(() => void 0);
        }
      }
      /** Restore quarantined ignored content without ever writing it into Git objects. */
      async restoreIgnoredBackup(key) {
        if (!this.quarantineDir) return;
        const backupRoot = import_node_path.default.join(this.quarantineDir, encodeRefPart(key));
        const encryptedManifest = await import_promises.default.readFile(import_node_path.default.join(backupRoot, ".manifest.json"), "utf8").then((raw) => JSON.parse(raw)).catch((error) => {
          if (error?.code === "ENOENT") return void 0;
          throw new QuarantineKeyError(`Encrypted quarantine manifest is invalid: ${error?.message ?? "unknown error"}`);
        });
        if (encryptedManifest) {
          if (!this.quarantineKey) throw new QuarantineKeyError("Encrypted quarantine requires the configured key.");
          if (encryptedManifest.version !== 1 || !Array.isArray(encryptedManifest.entries)) throw new QuarantineKeyError("Encrypted quarantine manifest version is unsupported.");
          const directories = encryptedManifest.entries.filter((entry) => entry.type === "directory").sort((a, b) => a.path.localeCompare(b.path));
          for (const entry of directories) {
            const destination = await this.safeWorkspacePath(entry.path);
            await import_promises.default.mkdir(destination, { recursive: true, mode: entry.mode });
          }
          for (const entry of encryptedManifest.entries.filter((item) => item.type !== "directory")) {
            const destination = await this.safeWorkspacePath(entry.path);
            await import_promises.default.mkdir(import_node_path.default.dirname(destination), { recursive: true });
            await import_promises.default.rm(destination, { recursive: true, force: true });
            if (entry.type === "symlink") {
              await import_promises.default.symlink(entry.linkTarget, destination);
              continue;
            }
            if (!entry.payload || !entry.nonce) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is incomplete.`);
            const encrypted = await import_promises.default.readFile(import_node_path.default.join(backupRoot, entry.payload));
            if (encrypted.length < 16) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is corrupt.`);
            let plaintext;
            try {
              const decipher = (0, import_node_crypto.createDecipheriv)("aes-256-gcm", this.quarantineKey, Buffer.from(entry.nonce, "base64url"));
              decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
              plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
            } catch {
              throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' failed authentication.`);
            }
            await import_promises.default.writeFile(destination, plaintext);
            await import_promises.default.chmod(destination, entry.mode).catch(() => void 0);
          }
          return;
        }
        const root = await this.getRepoRoot();
        const entries = await import_promises.default.readdir(backupRoot, { withFileTypes: true }).catch((error) => {
          if (error?.code === "ENOENT") return [];
          throw error;
        });
        for (const entry of entries) {
          const source = import_node_path.default.join(backupRoot, entry.name);
          const destination = import_node_path.default.join(root, entry.name);
          await import_promises.default.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
        }
      }
      /** Validate encrypted quarantine content before a restore mutates the workspace. */
      async validateIgnoredBackup(key) {
        if (!this.quarantineDir) return;
        const backupRoot = import_node_path.default.join(this.quarantineDir, encodeRefPart(key));
        const manifest = await import_promises.default.readFile(import_node_path.default.join(backupRoot, ".manifest.json"), "utf8").then((raw) => JSON.parse(raw)).catch((error) => {
          if (error?.code === "ENOENT") return void 0;
          throw new QuarantineKeyError(`Encrypted quarantine manifest is invalid: ${error?.message ?? "unknown error"}`);
        });
        if (!manifest) return;
        if (!this.quarantineKey) throw new QuarantineKeyError("Encrypted quarantine requires the configured key.");
        if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new QuarantineKeyError("Encrypted quarantine manifest version is unsupported.");
        for (const entry of manifest.entries.filter((item) => item.type === "file")) {
          if (!entry.payload || !entry.nonce) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is incomplete.`);
          const encrypted = await import_promises.default.readFile(import_node_path.default.join(backupRoot, entry.payload));
          if (encrypted.length < 16) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is corrupt.`);
          try {
            const decipher = (0, import_node_crypto.createDecipheriv)("aes-256-gcm", this.quarantineKey, Buffer.from(entry.nonce, "base64url"));
            decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
            decipher.update(encrypted.subarray(0, encrypted.length - 16));
            decipher.final();
          } catch {
            throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' failed authentication.`);
          }
        }
      }
      /** Remove a quarantine backup only after the DAG no longer references its key. */
      async removeIgnoredBackup(key) {
        if (!this.quarantineDir) return 0;
        const backupRoot = import_node_path.default.join(this.quarantineDir, encodeRefPart(key));
        const reclaimed = await directoryBytes(backupRoot);
        await import_promises.default.rm(backupRoot, { recursive: true, force: true });
        return reclaimed;
      }
      async getDiffBetween(baseOid, targetOid) {
        try {
          const { stdout } = await this.runGit(["diff", "--no-ext-diff", baseOid, targetOid]);
          return this.parseUnifiedDiff(stdout);
        } catch {
          return [];
        }
      }
      async runGitBuffer(args, extraEnv = {}, cwd = this.workDir) {
        await this.ensureShadowStore();
        return new Promise((resolve, reject) => {
          const child = (0, import_node_child_process.spawn)("git", args, { cwd, env: this.gitEnv(extraEnv), windowsHide: true });
          const chunks = [];
          const errors = [];
          child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
          child.once("error", reject);
          child.once("close", (code) => {
            if (code === 0) return resolve(Buffer.concat(chunks));
            reject(new Error(`Git plumbing command failed: git ${args.join(" ")}
Reason: ${Buffer.concat(errors).toString("utf8")}`));
          });
        });
      }
      async readShadowBlob(oid, cwd) {
        if (this.shadowObjectDir) {
          const loose = import_node_path.default.join(this.shadowObjectDir, oid.slice(0, 2), oid.slice(2));
          const compressed = await import_promises.default.readFile(loose).catch(() => void 0);
          if (compressed) {
            try {
              const inflated = import_node_zlib.default.inflateSync(compressed);
              const separator = inflated.indexOf(0);
              if (separator >= 0) return inflated.subarray(separator + 1);
            } catch {
            }
          }
        }
        return this.runGitBuffer(["cat-file", "blob", oid], {}, cwd);
      }
      gitEnv(extraEnv) {
        const env = {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          ...extraEnv
        };
        if (this.shadowObjectDir) {
          env.GIT_OBJECT_DIRECTORY = this.shadowObjectDir;
          const primaryObjects = import_node_path.default.join(this.gitDirCached ?? import_node_path.default.join(this.workDir, ".git"), "objects");
          env.GIT_ALTERNATE_OBJECT_DIRECTORIES = [primaryObjects, env.GIT_ALTERNATE_OBJECT_DIRECTORIES].filter(Boolean).map((item) => item.replace(/\\/g, "/")).join(import_node_path.default.delimiter);
        }
        return env;
      }
      async writeWorkspaceTree(enforceSnapshotLimits = false) {
        const root = await this.getRepoRoot();
        const indexFile = import_node_path.default.join(await this.getGitDir(), `dsh-tm-index-${(0, import_node_crypto.randomUUID)()}`);
        const env = { GIT_INDEX_FILE: indexFile };
        try {
          try {
            await this.runGit(["read-tree", "HEAD"], env, root);
          } catch {
            await this.runGit(["read-tree", "--empty"], env, root);
          }
          const protectedPaths = this.protectedRepoPaths(root);
          if (enforceSnapshotLimits) {
            const { stdout: candidates } = await this.runGit([
              "ls-files",
              "-z",
              "--cached",
              "--modified",
              "--deleted",
              "--others",
              "--exclude-standard"
            ], {}, root);
            const candidateFiles = candidates.split("\0").filter(Boolean).map(normalizeGitPath).filter((file) => !protectedPaths.some(
              (relative) => file === relative || file.startsWith(`${relative}/`)
            ));
            if (enforceSnapshotLimits) await this.assertSnapshotSize(root, candidateFiles);
            for (let offset = 0; offset < candidateFiles.length; offset += 128) {
              await this.runGit(["add", "-A", "--", ...candidateFiles.slice(offset, offset + 128)], env, root);
            }
          } else if (protectedPaths.length === 0) {
            await this.runGit(["add", "-A", "--", "."], env, root);
          } else {
            const excludes = protectedPaths.map((relative) => `:(exclude)${relative}`);
            await this.runGit(["add", "-A", "--", ".", ...excludes], env, root);
          }
          const { stdout: indexedFiles } = protectedPaths.length === 0 ? { stdout: "" } : await this.runGit(["ls-files", "-z", "--cached", "--", ...protectedPaths], env, root);
          const protectedEntries = indexedFiles.split("\0").filter(Boolean).map(normalizeGitPath);
          for (let offset = 0; offset < protectedEntries.length; offset += 128) {
            await this.runGit(
              ["update-index", "--force-remove", "--", ...protectedEntries.slice(offset, offset + 128)],
              env,
              root
            );
          }
          const { stdout } = await this.runGit(["write-tree"], env, root);
          return { treeOid: stdout.trim(), indexFile };
        } catch (error) {
          await import_promises.default.rm(indexFile, { force: true }).catch(() => void 0);
          throw error;
        }
      }
      async assertSnapshotSize(root, files) {
        if (this.maxSnapshotFileBytes <= 0 && this.maxSnapshotBytes <= 0) return;
        let totalBytes = 0;
        for (const relative of files) {
          const stat = await import_promises.default.lstat(import_node_path.default.join(root, ...relative.split("/"))).catch(() => void 0);
          if (!stat?.isFile()) continue;
          if (this.maxSnapshotFileBytes > 0 && stat.size > this.maxSnapshotFileBytes) {
            throw new SnapshotSizeError({ file: relative, fileBytes: stat.size, limitBytes: this.maxSnapshotFileBytes });
          }
          totalBytes += stat.size;
          if (this.maxSnapshotBytes > 0 && totalBytes > this.maxSnapshotBytes) {
            throw new SnapshotSizeError({ totalBytes, limitBytes: this.maxSnapshotBytes });
          }
        }
      }
      async listIgnoredPaths() {
        const root = await this.getRepoRoot();
        const { stdout } = await this.runGit(["ls-files", "-z", "--others", "--ignored", "--exclude-standard"], {}, root);
        return stdout.split("\0").filter(Boolean).map(normalizeGitPath).filter((item) => !this.isPreservedRelative(item)).sort();
      }
      async listTreeFiles(treeOid) {
        return (await this.listTreeFileNames(treeOid)).map((file) => ({ path: file, status: "added" }));
      }
      async listTreeFileNames(treeOid) {
        const { stdout } = await this.runGit(["ls-tree", "-r", "-z", "--name-only", treeOid]);
        return stdout.split("\0").filter(Boolean).map(normalizeGitPath);
      }
      async listTreeEntries(treeOid) {
        const { stdout } = await this.runGit(["ls-tree", "-r", "-z", treeOid]);
        return stdout.split("\0").filter(Boolean).map((record) => {
          const tab = record.indexOf("	");
          const [mode, _type, oid] = record.slice(0, tab).split(" ");
          return { mode, oid, path: normalizeGitPath(record.slice(tab + 1)) };
        });
      }
      async computeChangedFiles(parentCommitOid, currentCommitOid) {
        try {
          const { stdout } = await this.runGit([
            "diff-tree",
            "-r",
            "--no-commit-id",
            "--name-status",
            "-z",
            parentCommitOid,
            currentCommitOid
          ]);
          const fields = stdout.split("\0").filter(Boolean);
          const changes = [];
          for (let index = 0; index + 1 < fields.length; index += 2) {
            const statusCode = fields[index].toUpperCase();
            const filePath = normalizeGitPath(fields[index + 1]);
            const status = statusCode.startsWith("A") ? "added" : statusCode.startsWith("D") ? "deleted" : "modified";
            changes.push({ path: filePath, status });
          }
          return changes;
        } catch {
          return [];
        }
      }
      async diffNameOnly(baseTree, targetTree) {
        try {
          const { stdout } = await this.runGit(["diff", "--name-only", "-z", baseTree, targetTree]);
          return stdout.split("\0").filter(Boolean).map(normalizeGitPath);
        } catch {
          return [];
        }
      }
      protectedRepoPaths(repoRoot) {
        return this.preservePaths.flatMap((absolute) => {
          const relative = normalizeGitPath(import_node_path.default.relative(repoRoot, absolute));
          return relative && relative !== ".." && !relative.startsWith("../") ? [relative] : [];
        });
      }
      isPreservedRelative(relative) {
        const normalized = normalizeGitPath(relative);
        const repoRoot = this.repoRootCached ?? this.workDir;
        return this.preservePaths.some((absolute) => {
          const candidate = normalizeGitPath(import_node_path.default.relative(repoRoot, absolute));
          return candidate === normalized || normalized.startsWith(`${candidate}/`);
        });
      }
      async safeWorkspacePath(relative) {
        const root = await this.getRepoRoot();
        const absolute = import_node_path.default.resolve(root, relative);
        const relation = import_node_path.default.relative(root, absolute);
        if (!relation || relation === ".." || relation.startsWith(`..${import_node_path.default.sep}`) || import_node_path.default.isAbsolute(relation)) {
          throw new Error(`Unsafe workspace path: ${relative}`);
        }
        return absolute;
      }
      async backupIgnoredPath(key, relative, absolute) {
        if (!this.quarantineDir) throw new Error("Ignored-path deletion requires a quarantineDir.");
        if (this.quarantineKey) {
          await this.backupIgnoredPathEncrypted(key, relative, absolute);
          return;
        }
        const destination = import_node_path.default.join(this.quarantineDir, encodeRefPart(key), ...relative.split("/"));
        if (this.maxQuarantineBytes > 0) {
          const currentBytes = await directoryBytes(this.quarantineDir);
          const incomingBytes = await directoryBytes(absolute);
          const existingBytes = await directoryBytes(import_node_path.default.dirname(destination));
          const requiredBytes = currentBytes - existingBytes + incomingBytes;
          if (requiredBytes > this.maxQuarantineBytes) throw new QuarantineQuotaError(this.maxQuarantineBytes, requiredBytes);
        }
        await import_promises.default.mkdir(import_node_path.default.dirname(destination), { recursive: true });
        await import_promises.default.cp(absolute, destination, { recursive: true, force: true, verbatimSymlinks: true });
      }
      async backupIgnoredPathEncrypted(key, relative, absolute) {
        const root = import_node_path.default.join(this.quarantineDir, encodeRefPart(key));
        const manifestPath = import_node_path.default.join(root, ".manifest.json");
        const existing = await import_promises.default.readFile(manifestPath, "utf8").then((raw) => JSON.parse(raw)).catch(async (error) => {
          if (error?.code === "ENOENT") {
            const entries = await import_promises.default.readdir(root).catch(() => []);
            if (entries.length) throw new QuarantineKeyError("Plaintext quarantine exists; refusing to mix it with encrypted backups.");
            return { version: 1, entries: [] };
          }
          throw new QuarantineKeyError(`Encrypted quarantine manifest is invalid: ${error?.message ?? "unknown error"}`);
        });
        if (existing.version !== 1 || !Array.isArray(existing.entries)) throw new QuarantineKeyError("Encrypted quarantine manifest version is unsupported.");
        const staging = import_node_path.default.join(root, `.staging-${(0, import_node_crypto.randomUUID)()}`);
        const payloadDir = import_node_path.default.join(staging, "payload");
        await import_promises.default.mkdir(payloadDir, { recursive: true });
        const added = [];
        try {
          await this.collectEncryptedQuarantineEntries(absolute, relative, payloadDir, added);
          const stagedBytes = await directoryBytes(staging);
          const existingBytes = await directoryBytes(root);
          const manifestBytes = Buffer.byteLength(JSON.stringify({ version: 1, entries: [...existing.entries, ...added] }));
          const currentBytes = await directoryBytes(this.quarantineDir);
          const requiredBytes = currentBytes - existingBytes + stagedBytes + manifestBytes;
          if (this.maxQuarantineBytes > 0 && requiredBytes > this.maxQuarantineBytes) {
            throw new QuarantineQuotaError(this.maxQuarantineBytes, requiredBytes);
          }
          await import_promises.default.mkdir(import_node_path.default.join(root, "payload"), { recursive: true });
          for (const entry of added) {
            const source = import_node_path.default.join(payloadDir, entry.payload);
            const destination = import_node_path.default.join(root, "payload", entry.payload);
            await import_promises.default.rename(source, destination);
            entry.payload = import_node_path.default.posix.join("payload", entry.payload);
          }
          await import_promises.default.rm(staging, { recursive: true, force: true });
          const next = { version: 1, entries: [...existing.entries, ...added] };
          const temporaryManifest = `${manifestPath}.${(0, import_node_crypto.randomUUID)()}.tmp`;
          await import_promises.default.writeFile(temporaryManifest, `${JSON.stringify(next, null, 2)}
`, "utf8");
          await import_promises.default.rename(temporaryManifest, manifestPath);
        } catch (error) {
          await import_promises.default.rm(staging, { recursive: true, force: true }).catch(() => void 0);
          throw error;
        }
      }
      async collectEncryptedQuarantineEntries(source, relative, payloadDir, output) {
        const stat = await import_promises.default.lstat(source);
        if (stat.isDirectory()) {
          output.push({ path: normalizeGitPath(relative), type: "directory", mode: stat.mode & 511 });
          for (const child of await import_promises.default.readdir(source)) {
            await this.collectEncryptedQuarantineEntries(import_node_path.default.join(source, child), import_node_path.default.posix.join(relative, child), payloadDir, output);
          }
          return;
        }
        if (stat.isSymbolicLink()) {
          output.push({ path: normalizeGitPath(relative), type: "symlink", mode: stat.mode & 511, linkTarget: await import_promises.default.readlink(source) });
          return;
        }
        if (!stat.isFile()) throw new QuarantineKeyError(`Unsupported ignored backup entry: ${relative}`);
        const plaintext = await import_promises.default.readFile(source);
        const nonce = (0, import_node_crypto.randomBytes)(12);
        const cipher = (0, import_node_crypto.createCipheriv)("aes-256-gcm", this.quarantineKey, nonce);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        const payload = (0, import_node_crypto.randomUUID)();
        await import_promises.default.writeFile(import_node_path.default.join(payloadDir, payload), Buffer.concat([ciphertext, tag]));
        output.push({
          path: normalizeGitPath(relative),
          type: "file",
          mode: stat.mode & 511,
          payload,
          nonce: nonce.toString("base64url")
        });
      }
      parseUnifiedDiff(rawDiff) {
        const results = [];
        if (!rawDiff.trim()) return results;
        for (const chunk of rawDiff.split("diff --git ")) {
          if (!chunk.trim()) continue;
          const firstLine = chunk.split("\n", 1)[0];
          const match = firstLine.match(/a\/(.+?)\s+b\/(.+)/);
          const status = chunk.includes("new file mode") ? "added" : chunk.includes("deleted file mode") ? "deleted" : "modified";
          results.push({ file: match ? match[2] : "unknown", status, diffText: `diff --git ${chunk}` });
        }
        return results;
      }
      async cleanupSession(sessionId) {
        const namespace = `${this.refPrefix}/${encodeRefPart(sessionId)}`;
        const { stdout } = await this.runGit(["for-each-ref", "--format=%(refname)", namespace]).catch(() => ({ stdout: "", stderr: "" }));
        for (const ref of stdout.split("\n").filter(Boolean)) {
          await this.runGit(["update-ref", "-d", ref.trim()]);
        }
      }
      async deleteCheckpointRef(sessionId, checkpointId) {
        const ref = `${this.refPrefix}/${encodeRefPart(sessionId)}/nodes/${encodeRefPart(checkpointId)}`;
        const exists = await this.runGit(["show-ref", "--verify", "--quiet", ref]).then(() => true).catch(() => false);
        if (!exists) return false;
        await this.runGit(["update-ref", "-d", ref]);
        return true;
      }
      /** Remove unreachable loose objects from the opt-in shadow store only. */
      async pruneShadowObjects() {
        if (!this.shadowObjectDir) return { removedObjects: 0, reclaimedBytes: 0, packedObjectsSkipped: false };
        const { stdout: refs } = await this.runGit(["for-each-ref", "--format=%(refname)", this.refPrefix]).catch(() => ({ stdout: "", stderr: "" }));
        const refNames = refs.split("\n").map((item) => item.trim()).filter(Boolean);
        const reachable = /* @__PURE__ */ new Set();
        if (refNames.length) {
          const { stdout } = await this.runGit(["rev-list", "--objects", ...refNames]);
          for (const line of stdout.split("\n")) {
            const oid = line.trim().split(/\s+/, 1)[0];
            if (/^[0-9a-f]{40}$/.test(oid)) reachable.add(oid);
          }
        }
        let removedObjects = 0;
        let reclaimedBytes = 0;
        const entries = await import_promises.default.readdir(this.shadowObjectDir, { withFileTypes: true }).catch(() => []);
        let packedObjectsSkipped = false;
        for (const entry of entries) {
          if (entry.name === "pack" && entry.isDirectory()) {
            packedObjectsSkipped = (await import_promises.default.readdir(import_node_path.default.join(this.shadowObjectDir, entry.name)).catch(() => [])).length > 0;
            continue;
          }
          if (!entry.isDirectory() || !/^[0-9a-f]{2}$/.test(entry.name)) continue;
          const directory = import_node_path.default.join(this.shadowObjectDir, entry.name);
          for (const object of await import_promises.default.readdir(directory, { withFileTypes: true }).catch(() => [])) {
            if (!object.isFile() || !/^[0-9a-f]{38}$/.test(object.name)) continue;
            const oid = `${entry.name}${object.name}`;
            if (reachable.has(oid)) continue;
            const file = import_node_path.default.join(directory, object.name);
            reclaimedBytes += (await import_promises.default.stat(file).catch(() => ({ size: 0 }))).size;
            await import_promises.default.rm(file, { force: true });
            removedObjects += 1;
          }
          await import_promises.default.rmdir(directory).catch(() => void 0);
        }
        return { removedObjects, reclaimedBytes, packedObjectsSkipped };
      }
      /** Rebuild only the opt-in shadow pack from the plugin's private refs. */
      async repackShadowObjects() {
        if (!this.shadowObjectDir) return { repacked: false, removedPackFiles: 0, reclaimedBytes: 0, reachableRefs: 0 };
        const { stdout: refsOutput } = await this.runGit(["for-each-ref", "--format=%(objectname)", this.refPrefix]).catch(() => ({ stdout: "", stderr: "" }));
        const refs = refsOutput.split("\n").map((item) => item.trim()).filter((item) => /^[0-9a-f]{40}$/.test(item));
        const packDir = import_node_path.default.join(this.shadowObjectDir, "pack");
        const existing = await import_promises.default.readdir(packDir, { withFileTypes: true }).catch(() => []);
        const existingPackFiles = existing.filter((entry) => entry.isFile() && /^pack-[0-9a-f]{40}\.(pack|idx|bitmap|rev|mtimes)$/.test(entry.name));
        const lockedPack = existing.some((entry) => entry.isFile() && /^pack-[0-9a-f]{40}\.keep$/.test(entry.name));
        if (lockedPack) return { repacked: false, removedPackFiles: 0, reclaimedBytes: 0, reachableRefs: refs.length, skippedReason: "shadow pack contains a .keep file" };
        const existingBytes = await sumFileSizes(existingPackFiles.map((entry) => import_node_path.default.join(packDir, entry.name)));
        const tempDir = import_node_path.default.join(this.shadowObjectDir, `.repack-${(0, import_node_crypto.randomUUID)()}`);
        await import_promises.default.mkdir(tempDir, { recursive: true });
        let generatedFiles = [];
        try {
          if (refs.length) {
            const prefix = import_node_path.default.join(tempDir, "pack");
            await this.runGitInput(["pack-objects", "--revs", "--no-reuse-object", "--delta-base-offset", prefix], `${refs.join("\n")}
`);
            generatedFiles = (await import_promises.default.readdir(tempDir, { withFileTypes: true })).filter((entry) => entry.isFile() && /^(pack-[0-9a-f]{40})\.(pack|idx)$/.test(entry.name)).map((entry) => entry.name);
          }
          await import_promises.default.mkdir(packDir, { recursive: true });
          for (const file of generatedFiles) {
            const destination = import_node_path.default.join(packDir, file);
            const source = import_node_path.default.join(tempDir, file);
            const alreadyPresent = await import_promises.default.access(destination).then(() => true).catch(() => false);
            if (alreadyPresent) await import_promises.default.rm(source, { force: true });
            else await import_promises.default.rename(source, destination);
          }
          const keep = new Set(generatedFiles);
          let removedPackFiles = 0;
          let reclaimedBytes = 0;
          for (const entry of existingPackFiles) {
            if (keep.has(entry.name)) continue;
            const file = import_node_path.default.join(packDir, entry.name);
            reclaimedBytes += (await import_promises.default.stat(file).catch(() => ({ size: 0 }))).size;
            await import_promises.default.rm(file, { force: true });
            removedPackFiles += 1;
          }
          await import_promises.default.rm(import_node_path.default.join(this.shadowObjectDir, "info", "packs"), { force: true }).catch(() => void 0);
          return {
            repacked: refs.length > 0 && generatedFiles.length > 0,
            removedPackFiles,
            reclaimedBytes: Math.max(reclaimedBytes, existingBytes - await sumFileSizes(generatedFiles.map((file) => import_node_path.default.join(packDir, file)))),
            reachableRefs: refs.length
          };
        } finally {
          await import_promises.default.rm(tempDir, { recursive: true, force: true }).catch(() => void 0);
        }
      }
      async ensureShadowStore() {
        if (!this.shadowObjectDir) return;
        this.shadowReady ??= import_promises.default.mkdir(this.shadowObjectDir, { recursive: true }).then(() => void 0);
        await this.shadowReady;
      }
      async runGitInput(args, input, cwd = this.workDir) {
        await this.ensureShadowStore();
        const env = this.gitEnv({});
        return await new Promise((resolve, reject) => {
          const child = (0, import_node_child_process.spawn)("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
          const stdout = [];
          const stderr = [];
          child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
          child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
          child.once("error", reject);
          child.once("close", (code) => {
            const out = Buffer.concat(stdout).toString("utf8");
            const err = Buffer.concat(stderr).toString("utf8");
            if (code === 0) resolve({ stdout: out, stderr: err });
            else reject(new Error(`Git plumbing command failed: git ${args.join(" ")}
Reason: ${err || out || `exit ${code}`}`));
          });
          child.stdin.end(input, "utf8");
        });
      }
    };
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Config: () => Config,
  DAGStateManager: () => DAGStateManager,
  FallbackSnapshotEngine: () => FallbackSnapshotEngine,
  GitPlumbingEngine: () => GitPlumbingEngine,
  QuarantineKeyError: () => QuarantineKeyError,
  QuarantineQuotaError: () => QuarantineQuotaError,
  ReflectionAdvisor: () => ReflectionAdvisor,
  RestorePlanError: () => RestorePlanError,
  SnapshotSizeError: () => SnapshotSizeError,
  StorageQuotaError: () => StorageQuotaError,
  TimeMachinePlugin: () => TimeMachinePlugin,
  TimeMachineService: () => TimeMachineService,
  UnsupportedWorkspaceStateError: () => UnsupportedWorkspaceStateError,
  WorkspaceDriftError: () => WorkspaceDriftError,
  WorkspaceMergeConflictError: () => WorkspaceMergeConflictError,
  WorkspaceRestoreConflictError: () => WorkspaceRestoreConflictError,
  apply: () => apply,
  collectFailedTools: () => collectFailedTools,
  default: () => index_default,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
init_cjs_shims();
var import_node_path7 = __toESM(require("path"), 1);
var import_schemastery = __toESM(require("@deepseek-ai/schemastery"), 1);
var import_picocolors2 = __toESM(require("picocolors"), 1);

// src/service.ts
init_cjs_shims();
var import_node_path5 = __toESM(require("path"), 1);
var import_promises5 = __toESM(require("fs/promises"), 1);
var import_node_crypto5 = require("crypto");
init_git_plumbing();

// src/core/fallback-engine.ts
init_cjs_shims();
var import_node_crypto2 = require("crypto");
var import_node_path2 = __toESM(require("path"), 1);
var import_promises2 = __toESM(require("fs/promises"), 1);
init_git_plumbing();
var FallbackSnapshotEngine = class {
  workDir;
  storageDir;
  preservePaths;
  maxSnapshotFileBytes;
  maxSnapshotBytes;
  constructor(options) {
    this.workDir = import_node_path2.default.resolve(options.workDir);
    this.storageDir = import_node_path2.default.resolve(options.storageDir);
    this.preservePaths = [this.storageDir, ...(options.preservePaths ?? []).map((item) => import_node_path2.default.resolve(this.workDir, item))];
    this.maxSnapshotFileBytes = Math.max(0, Math.floor(options.maxSnapshotFileBytes ?? 0));
    this.maxSnapshotBytes = Math.max(0, Math.floor(options.maxSnapshotBytes ?? 0));
  }
  getCheckpointDir(sessionId, checkpointId) {
    const sessionKey = Buffer.from(sessionId, "utf8").toString("base64url") || "_";
    const checkpointKey2 = Buffer.from(checkpointId, "utf8").toString("base64url") || "_";
    return import_node_path2.default.join(this.storageDir, sessionKey, checkpointKey2);
  }
  async createSnapshot(params) {
    const targetDir = this.getCheckpointDir(params.sessionId, params.checkpointId);
    const temporary = `${targetDir}.${(0, import_node_crypto2.randomUUID)()}.tmp`;
    const filesDir = import_node_path2.default.join(temporary, "files");
    await import_promises2.default.mkdir(filesDir, { recursive: true });
    try {
      const plannedEntries = await this.scanTree(this.workDir);
      await this.assertSnapshotSize(plannedEntries);
      const entries = await this.captureTree(this.workDir, filesDir, plannedEntries);
      const treeOid = await hashSnapshot(filesDir, entries);
      const manifest = { version: 1, entries, treeOid };
      await import_promises2.default.writeFile(import_node_path2.default.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}
`, "utf8");
      await import_promises2.default.mkdir(import_node_path2.default.dirname(targetDir), { recursive: true });
      await import_promises2.default.rename(temporary, targetDir);
      return {
        treeOid: `fallback_${treeOid}`,
        commitOid: `fallback_${treeOid}`,
        changedFiles: entries.filter((entry) => entry.type !== "directory").map((entry) => ({ path: entry.path, status: "modified" }))
      };
    } catch (error) {
      await import_promises2.default.rm(temporary, { recursive: true, force: true }).catch(() => void 0);
      throw error;
    }
  }
  async inspectWorkspace() {
    const entries = await this.scanTree(this.workDir);
    return `fallback_${await hashSnapshot(this.workDir, entries)}`;
  }
  async restoreSnapshot(sessionId, checkpointId) {
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    const raw = await import_promises2.default.readFile(import_node_path2.default.join(snapshotDir, "manifest.json"), "utf8").catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`Fallback snapshot '${checkpointId}' is missing or uses an unsupported legacy format.`);
      throw error;
    });
    const manifest = parseManifest(raw);
    const filesDir = import_node_path2.default.join(snapshotDir, "files");
    const targetPaths = new Set(manifest.entries.map((entry) => entry.path));
    const currentEntries = await this.scanTree(this.workDir);
    for (const entry of currentEntries.sort(deepestFirst)) {
      if (targetPaths.has(entry.path)) continue;
      await import_promises2.default.rm(this.resolveSafe(entry.path), { recursive: true, force: true });
    }
    for (const entry of manifest.entries.filter((item) => item.type === "directory").sort(shallowestFirst)) {
      const destination = this.resolveSafe(entry.path);
      const stat = await import_promises2.default.lstat(destination).catch(() => void 0);
      if (stat && !stat.isDirectory()) await import_promises2.default.rm(destination, { recursive: true, force: true });
      await import_promises2.default.mkdir(destination, { recursive: true, mode: entry.mode });
    }
    for (const entry of manifest.entries.filter((item) => item.type !== "directory")) {
      const destination = this.resolveSafe(entry.path);
      await import_promises2.default.mkdir(import_node_path2.default.dirname(destination), { recursive: true });
      await import_promises2.default.rm(destination, { recursive: true, force: true });
      if (entry.type === "file") {
        await import_promises2.default.copyFile(import_node_path2.default.join(filesDir, ...entry.path.split("/")), destination);
        await import_promises2.default.chmod(destination, entry.mode).catch(() => void 0);
      } else {
        await import_promises2.default.symlink(entry.linkTarget, destination);
      }
    }
  }
  async restoreSelectedPaths(sessionId, checkpointId, paths, options = {}) {
    const normalized = [...new Set(paths.map(normalizeFallbackPath).filter(Boolean))];
    if (normalized.length === 0) throw new Error("At least one workspace path is required.");
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    if ((options.mode ?? "safe") === "safe" && options.expectedCurrentTreeOid) {
      const currentTree = await this.inspectWorkspace();
      if (currentTree !== options.expectedCurrentTreeOid) {
        throw new Error(`Workspace changed after the latest checkpoint: expected ${options.expectedCurrentTreeOid}, observed ${currentTree}`);
      }
    }
    const raw = await import_promises2.default.readFile(import_node_path2.default.join(snapshotDir, "manifest.json"), "utf8");
    const manifest = parseManifest(raw);
    const filesDir = import_node_path2.default.join(snapshotDir, "files");
    const selected = (entry) => normalized.some((item) => entry.path === item || entry.path.startsWith(`${item}/`));
    const currentEntries = (await this.scanTree(this.workDir)).filter(selected).sort(deepestFirst);
    const targetEntries = manifest.entries.filter(selected);
    if (currentEntries.length === 0 && targetEntries.length === 0) {
      throw new Error(`None of the selected paths exist in the current or target snapshot: ${normalized.join(", ")}`);
    }
    const targetPaths = new Set(targetEntries.map((entry) => entry.path));
    for (const entry of currentEntries) {
      if (!targetPaths.has(entry.path)) await import_promises2.default.rm(this.resolveSafe(entry.path), { recursive: true, force: true });
    }
    for (const entry of targetEntries.filter((item) => item.type === "directory").sort(shallowestFirst)) {
      const destination = this.resolveSafe(entry.path);
      await import_promises2.default.mkdir(destination, { recursive: true, mode: entry.mode });
    }
    for (const entry of targetEntries.filter((item) => item.type !== "directory")) {
      const destination = this.resolveSafe(entry.path);
      await import_promises2.default.mkdir(import_node_path2.default.dirname(destination), { recursive: true });
      await import_promises2.default.rm(destination, { recursive: true, force: true });
      if (entry.type === "file") {
        await import_promises2.default.copyFile(import_node_path2.default.join(filesDir, ...entry.path.split("/")), destination);
        await import_promises2.default.chmod(destination, entry.mode).catch(() => void 0);
      } else {
        await import_promises2.default.symlink(entry.linkTarget, destination);
      }
    }
    return normalized;
  }
  async removeSnapshot(sessionId, checkpointId) {
    const target = this.getCheckpointDir(sessionId, checkpointId);
    const before = await directorySize(target);
    await import_promises2.default.rm(target, { recursive: true, force: true });
    return before;
  }
  async captureTree(sourceRoot, destinationRoot, plannedEntries) {
    const entries = plannedEntries ?? await this.scanTree(sourceRoot);
    for (const entry of entries) {
      const source = import_node_path2.default.join(sourceRoot, ...entry.path.split("/"));
      const destination = import_node_path2.default.join(destinationRoot, ...entry.path.split("/"));
      if (entry.type === "directory") {
        await import_promises2.default.mkdir(destination, { recursive: true, mode: entry.mode });
      } else if (entry.type === "file") {
        await import_promises2.default.mkdir(import_node_path2.default.dirname(destination), { recursive: true });
        await import_promises2.default.copyFile(source, destination);
      }
    }
    return entries;
  }
  async assertSnapshotSize(entries) {
    if (this.maxSnapshotFileBytes <= 0 && this.maxSnapshotBytes <= 0) return;
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.type !== "file") continue;
      const stat = await import_promises2.default.stat(import_node_path2.default.join(this.workDir, ...entry.path.split("/")));
      if (this.maxSnapshotFileBytes > 0 && stat.size > this.maxSnapshotFileBytes) {
        throw new SnapshotSizeError({ file: entry.path, fileBytes: stat.size, limitBytes: this.maxSnapshotFileBytes });
      }
      totalBytes += stat.size;
      if (this.maxSnapshotBytes > 0 && totalBytes > this.maxSnapshotBytes) {
        throw new SnapshotSizeError({ totalBytes, limitBytes: this.maxSnapshotBytes });
      }
    }
  }
  async scanTree(root) {
    const entries = [];
    const visit = async (directory, relative = "") => {
      for (const dirent of await import_promises2.default.readdir(directory, { withFileTypes: true })) {
        const absolute = import_node_path2.default.join(directory, dirent.name);
        if (this.isPreserved(absolute)) continue;
        const childRelative = relative ? `${relative}/${dirent.name}` : dirent.name;
        validateRelativePath(childRelative);
        const stat = await import_promises2.default.lstat(absolute);
        const mode = stat.mode & 511;
        if (stat.isSymbolicLink()) {
          entries.push({ path: childRelative, type: "symlink", mode, linkTarget: await import_promises2.default.readlink(absolute) });
        } else if (stat.isDirectory()) {
          entries.push({ path: childRelative, type: "directory", mode });
          await visit(absolute, childRelative);
        } else if (stat.isFile()) {
          entries.push({ path: childRelative, type: "file", mode });
        }
      }
    };
    await visit(root);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }
  isPreserved(absolute) {
    const resolved = import_node_path2.default.resolve(absolute);
    return this.preservePaths.some((base) => resolved === base || resolved.startsWith(`${base}${import_node_path2.default.sep}`));
  }
  resolveSafe(relative) {
    validateRelativePath(relative);
    const absolute = import_node_path2.default.resolve(this.workDir, ...relative.split("/"));
    const relation = import_node_path2.default.relative(this.workDir, absolute);
    if (!relation || relation === ".." || relation.startsWith(`..${import_node_path2.default.sep}`) || import_node_path2.default.isAbsolute(relation)) {
      throw new Error(`Unsafe snapshot path '${relative}'.`);
    }
    if (this.isPreserved(absolute)) throw new Error(`Snapshot path overlaps protected storage: '${relative}'.`);
    return absolute;
  }
};
async function hashSnapshot(root, entries) {
  const hash = (0, import_node_crypto2.createHash)("sha256");
  for (const entry of entries) {
    hash.update(`${entry.type}\0${entry.path}\0${entry.mode}\0${entry.linkTarget ?? ""}\0`);
    if (entry.type === "file") hash.update(await import_promises2.default.readFile(import_node_path2.default.join(root, ...entry.path.split("/"))));
  }
  return hash.digest("hex");
}
function parseManifest(raw) {
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || typeof parsed.treeOid !== "string") {
    throw new Error("Fallback snapshot manifest is corrupt.");
  }
  for (const entry of parsed.entries) {
    validateRelativePath(entry.path);
    if (!["directory", "file", "symlink"].includes(entry.type)) throw new Error(`Invalid snapshot entry type for '${entry.path}'.`);
    if (entry.type === "symlink" && typeof entry.linkTarget !== "string") throw new Error(`Invalid symlink target for '${entry.path}'.`);
  }
  return parsed;
}
function validateRelativePath(value) {
  if (!value || value.includes("\0") || value.includes("\\") || import_node_path2.default.posix.isAbsolute(value) || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe relative path '${value}'.`);
  }
}
function normalizeFallbackPath(value) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  validateRelativePath(normalized);
  return normalized;
}
function deepestFirst(left, right) {
  return right.path.split("/").length - left.path.split("/").length || right.path.localeCompare(left.path);
}
function shallowestFirst(left, right) {
  return left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path);
}
async function directorySize(root) {
  let total = 0;
  const visit = async (directory) => {
    for (const entry of await import_promises2.default.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = import_node_path2.default.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += (await import_promises2.default.stat(absolute).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}

// src/core/dag-manager.ts
init_cjs_shims();
var import_node_path3 = __toESM(require("path"), 1);
var import_promises3 = __toESM(require("fs/promises"), 1);
var import_node_crypto3 = require("crypto");
var import_picocolors = __toESM(require("picocolors"), 1);
var DAGStateManager = class {
  tree;
  storageFile;
  constructor(options) {
    const branch = options.initialBranch || "main";
    this.tree = {
      sessionId: options.sessionId,
      currentBranch: branch,
      currentCheckpointId: null,
      nodes: {},
      branches: {
        [branch]: {
          name: branch,
          headId: "",
          forkedFromId: null,
          createdAt: Date.now(),
          description: "Primary exploration branch"
        }
      }
    };
    const safeSessionKey = Buffer.from(options.sessionId, "utf8").toString("base64url") || "_";
    this.storageFile = import_node_path3.default.join(options.storageDir, `dag_${safeSessionKey}.json`);
  }
  /**
   * 初始化并尝试从本地恢复树结构
   */
  async init() {
    try {
      const content = await import_promises3.default.readFile(this.storageFile, "utf-8");
      const loadedTree = JSON.parse(content);
      this.assertTree(loadedTree);
      this.tree = loadedTree;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  /**
   * 持久化当前 DAG 树到本地 JSON
   */
  async persist() {
    await import_promises3.default.mkdir(import_node_path3.default.dirname(this.storageFile), { recursive: true });
    const temporary = `${this.storageFile}.${(0, import_node_crypto3.randomUUID)()}.tmp`;
    try {
      await import_promises3.default.writeFile(temporary, `${JSON.stringify(this.tree, null, 2)}
`, { encoding: "utf-8", flag: "wx" });
      await import_promises3.default.rename(temporary, this.storageFile);
    } finally {
      await import_promises3.default.rm(temporary, { force: true }).catch(() => void 0);
    }
  }
  /**
   * 添加一个新快照节点并推进当前分支 HEAD
   */
  async addNode(node) {
    if (this.tree.nodes[node.id]) throw new Error(`Checkpoint '${node.id}' already exists.`);
    if (node.branch !== this.tree.currentBranch) {
      throw new Error(`Checkpoint branch '${node.branch}' is not the active branch '${this.tree.currentBranch}'.`);
    }
    if (node.parentId !== this.tree.currentCheckpointId) {
      throw new Error(`Checkpoint '${node.id}' has a stale parent.`);
    }
    await this.commitMutation(() => {
      this.tree.nodes[node.id] = cloneJson(node);
      this.tree.currentCheckpointId = node.id;
      if (!this.tree.branches[node.branch]) {
        this.tree.branches[node.branch] = {
          name: node.branch,
          headId: node.id,
          forkedFromId: node.parentId,
          createdAt: Date.now()
        };
      } else {
        this.tree.branches[node.branch].headId = node.id;
      }
    });
  }
  /**
   * 获取当前活动的快照节点
   */
  getCurrentNode() {
    if (!this.tree.currentCheckpointId) return null;
    return this.tree.nodes[this.tree.currentCheckpointId] || null;
  }
  /**
   * 获取指定 ID 的节点
   */
  getNode(checkpointId) {
    return this.tree.nodes[checkpointId] || null;
  }
  async updateNode(checkpointId, patch) {
    const node = this.getNode(checkpointId);
    if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    const updated = { ...node, ...cloneJson(patch) };
    await this.commitMutation(() => {
      this.tree.nodes[checkpointId] = updated;
    });
    return cloneJson(updated);
  }
  /** Remove only leaf checkpoints that are not current or a branch head. */
  async removeLeafNodes(checkpointIds) {
    const requested = new Set(checkpointIds);
    const protectedIds = /* @__PURE__ */ new Set([
      ...this.tree.currentCheckpointId ? [this.tree.currentCheckpointId] : [],
      ...Object.values(this.tree.branches).map((branch) => branch.headId).filter(Boolean)
    ]);
    const children = new Set(Object.values(this.tree.nodes).map((node) => node.parentId).filter((id) => Boolean(id)));
    const removable = Object.values(this.tree.nodes).filter((node) => requested.has(node.id) && !protectedIds.has(node.id) && !children.has(node.id));
    if (removable.length === 0) return [];
    await this.commitMutation(() => {
      for (const node of removable) delete this.tree.nodes[node.id];
    });
    return removable.map(cloneJson);
  }
  /** Remove historical nodes while reparenting surviving children to the nearest ancestor. */
  async compactNodes(checkpointIds) {
    const requested = new Set(checkpointIds);
    const protectedIds = /* @__PURE__ */ new Set([
      ...this.tree.currentCheckpointId ? [this.tree.currentCheckpointId] : [],
      ...Object.values(this.tree.branches).map((branch) => branch.headId).filter(Boolean)
    ]);
    const removable = Object.values(this.tree.nodes).filter((node) => requested.has(node.id) && !protectedIds.has(node.id));
    if (removable.length === 0) return [];
    const removedIds = new Set(removable.map((node) => node.id));
    const nearestSurvivor = (parentId) => {
      let cursor = parentId;
      while (cursor && removedIds.has(cursor)) cursor = this.tree.nodes[cursor]?.parentId ?? null;
      return cursor;
    };
    await this.commitMutation(() => {
      for (const node of Object.values(this.tree.nodes)) {
        if (!removedIds.has(node.id)) node.parentId = nearestSurvivor(node.parentId);
      }
      for (const branch of Object.values(this.tree.branches)) {
        branch.forkedFromId = nearestSurvivor(branch.forkedFromId);
      }
      for (const node of removable) delete this.tree.nodes[node.id];
    });
    return removable.map(cloneJson);
  }
  /** Explicitly remove a non-current exploration branch and its private nodes. */
  async removeBranch(branchName) {
    if (branchName === this.tree.currentBranch) throw new Error("Cannot prune the current branch.");
    if (!this.tree.branches[branchName]) return [];
    const protectedAncestors = new Set(this.getLineage(this.tree.currentCheckpointId ?? "").map((node) => node.id));
    const removed = Object.values(this.tree.nodes).filter((node) => node.branch === branchName && !protectedAncestors.has(node.id));
    await this.commitMutation(() => {
      delete this.tree.branches[branchName];
      for (const node of removed) delete this.tree.nodes[node.id];
    });
    return removed.map(cloneJson);
  }
  /**
   * 回滚当前指针到指定历史节点（保持在当前分支）
   */
  async rewindTo(checkpointId) {
    const target = this.getNode(checkpointId);
    if (!target) {
      throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    }
    await this.commitMutation(() => {
      this.tree.currentCheckpointId = checkpointId;
      this.tree.currentBranch = target.branch;
      this.tree.branches[target.branch].headId = checkpointId;
    });
    return cloneJson(target);
  }
  /**
   * 核心功能：从任意历史节点 Fork 出一个新的平行探索分支
   */
  async forkBranch(checkpointId, newBranchName, description) {
    const baseNode = this.validateFork(checkpointId, newBranchName);
    await this.commitMutation(() => {
      this.tree.branches[newBranchName] = {
        name: newBranchName,
        headId: checkpointId,
        forkedFromId: checkpointId,
        createdAt: Date.now(),
        description: description || `Forked from ${checkpointId} (${baseNode.branch})`
      };
      this.tree.currentBranch = newBranchName;
      this.tree.currentCheckpointId = checkpointId;
    });
    return cloneJson({ ...baseNode, branch: newBranchName });
  }
  validateFork(checkpointId, newBranchName) {
    const baseNode = this.getNode(checkpointId);
    if (!baseNode) throw new Error(`Cannot fork from non-existent checkpoint: ${checkpointId}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(newBranchName) || newBranchName.includes("..")) {
      throw new Error(`Branch '${newBranchName}' is not a safe branch name.`);
    }
    if (this.tree.branches[newBranchName]) {
      throw new Error(`Branch '${newBranchName}' already exists. Choose another name.`);
    }
    return baseNode;
  }
  /**
   * 切换当前活动分支
   */
  async switchBranch(branchName) {
    const branchMeta = this.tree.branches[branchName];
    if (!branchMeta) {
      throw new Error(`Branch '${branchName}' does not exist.`);
    }
    const headNode = this.getNode(branchMeta.headId);
    if (!headNode) {
      throw new Error(`Head node of branch '${branchName}' is missing.`);
    }
    await this.commitMutation(() => {
      this.tree.currentBranch = branchName;
      this.tree.currentCheckpointId = headNode.id;
    });
    return cloneJson(headNode);
  }
  /**
   * 获取从根节点到指定节点的分支线性链路
   */
  getLineage(checkpointId) {
    const pathNodes = [];
    let currId = checkpointId;
    while (currId) {
      const node = this.tree.nodes[currId];
      if (!node) break;
      pathNodes.unshift(node);
      currId = node.parentId;
    }
    return pathNodes;
  }
  /**
   * 获取在指定分叉点后，其他分支中失败或被放弃的节点（供反思分析）
   */
  getAbandonedSubtrees(forkPointId, currentActiveBranch) {
    const abandoned = [];
    for (const node of Object.values(this.tree.nodes)) {
      if (node.branch !== currentActiveBranch && node.parentId === forkPointId) {
        this.collectSubtree(node.id, abandoned);
      }
    }
    return abandoned;
  }
  collectSubtree(rootId, acc) {
    const node = this.tree.nodes[rootId];
    if (!node) return;
    acc.push(node);
    for (const child of Object.values(this.tree.nodes)) {
      if (child.parentId === rootId) {
        this.collectSubtree(child.id, acc);
      }
    }
  }
  /**
   * 渲染用于终端 `/tree` 命令展示的彩色 ASCII/Unicode 拓扑图
   */
  renderAsciiTree() {
    const lines = [];
    lines.push(import_picocolors.default.bold(import_picocolors.default.cyan(`
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 DSH Time Machine DAG Tree \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)));
    lines.push(import_picocolors.default.dim(`Session: ${this.tree.sessionId} | Active Branch: `) + import_picocolors.default.green(import_picocolors.default.bold(this.tree.currentBranch)));
    lines.push("");
    const nodesList = Object.values(this.tree.nodes).sort((a, b) => a.timestamp - b.timestamp);
    if (nodesList.length === 0) {
      lines.push(import_picocolors.default.yellow("  (No checkpoints recorded yet. Run a prompt to generate the first checkpoint)"));
      return lines.join("\n");
    }
    for (const node of nodesList) {
      const isHead = this.tree.currentCheckpointId === node.id;
      const isBranchHead = Object.values(this.tree.branches).some((b) => b.headId === node.id);
      const marker = isHead ? import_picocolors.default.red(import_picocolors.default.bold("\u25CF [HEAD]")) : isBranchHead ? import_picocolors.default.yellow("\u25C6") : import_picocolors.default.blue("\u25CB");
      const timeStr = new Date(node.timestamp).toLocaleTimeString();
      const branchBadge = import_picocolors.default.magenta(`[${node.branch}]`);
      const idStr = import_picocolors.default.bold(node.id);
      const promptSnippet = node.prompt.length > 35 ? `${node.prompt.slice(0, 32)}...` : node.prompt;
      const filesCount = node.changedFiles.length;
      const statusBadge = node.status === "failed" ? import_picocolors.default.red("\u2716 FAILED") : import_picocolors.default.green("\u2714 OK");
      lines.push(`  ${marker} ${idStr} ${branchBadge} ${import_picocolors.default.dim(timeStr)} - ${import_picocolors.default.white(promptSnippet)} (${import_picocolors.default.cyan(`${filesCount} files`)}) ${statusBadge}`);
      if (node.summary) {
        lines.push(`     ${import_picocolors.default.dim("\u2514\u2500")} ${import_picocolors.default.italic(import_picocolors.default.gray(node.summary))}`);
      }
    }
    lines.push(import_picocolors.default.bold(import_picocolors.default.cyan(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`)));
    return lines.join("\n");
  }
  assertTree(tree) {
    if (!tree || tree.sessionId !== this.tree.sessionId || typeof tree.nodes !== "object" || typeof tree.branches !== "object") {
      throw new Error(`Invalid or foreign DAG state in '${this.storageFile}'.`);
    }
    if (!tree.branches[tree.currentBranch]) throw new Error(`DAG active branch '${tree.currentBranch}' is missing.`);
    if (tree.currentCheckpointId && !tree.nodes[tree.currentCheckpointId]) {
      throw new Error(`DAG current checkpoint '${tree.currentCheckpointId}' is missing.`);
    }
    for (const [id, node] of Object.entries(tree.nodes)) {
      if (!node || node.id !== id || node.sessionState?.sessionId !== tree.sessionId) {
        throw new Error(`DAG checkpoint '${id}' is malformed or belongs to another session.`);
      }
      if (!Array.isArray(node.sessionState.messages) || !Array.isArray(node.changedFiles)) {
        throw new Error(`DAG checkpoint '${id}' has invalid session or file state.`);
      }
      if (node.parentId !== null && !tree.nodes[node.parentId]) {
        throw new Error(`DAG checkpoint '${id}' references missing parent '${node.parentId}'.`);
      }
      if (!tree.branches[node.branch]) {
        throw new Error(`DAG checkpoint '${id}' references missing branch '${node.branch}'.`);
      }
    }
  }
  async commitMutation(mutate) {
    const previous = cloneJson(this.tree);
    try {
      mutate();
      await this.persist();
    } catch (error) {
      this.tree = previous;
      throw error;
    }
  }
};
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// src/core/reflection-advisor.ts
init_cjs_shims();
var ReflectionAdvisor = class {
  /**
   * 分析已放弃或失败的分支节点，提炼结构化反思提示词
   */
  generateReflectionNote(abandonedNodes) {
    if (!abandonedNodes || abandonedNodes.length === 0) {
      return {
        hasPastFailures: false,
        failedNodeCount: 0,
        summaryNote: "",
        suggestedPromptPrefix: ""
      };
    }
    const failureIncidents = [];
    for (const node of abandonedNodes) {
      if (node.status === "failed" || node.errorMessage || node.failedTools && node.failedTools.length > 0) {
        failureIncidents.push({
          prompt: node.prompt,
          errorMsg: node.errorMessage,
          failedTools: node.failedTools
        });
      }
    }
    if (failureIncidents.length === 0) {
      return {
        hasPastFailures: false,
        failedNodeCount: 0,
        summaryNote: "Previous branches explored alternative solutions without logged runtime errors.",
        suggestedPromptPrefix: ""
      };
    }
    const lines = [
      `[TIME-MACHINE REFLECTION ADVISORY]`,
      `You are exploring a new branch after rewinding/forking from a previous attempt.`,
      `The following issues occurred in the prior abandoned branch(es):`
    ];
    failureIncidents.slice(0, 3).forEach((inc, idx) => {
      lines.push(`  - Attempt ${idx + 1} ("${inc.prompt}"):`);
      if (inc.errorMsg) {
        lines.push(`    Error: ${inc.errorMsg.slice(0, 180)}`);
      }
      if (inc.failedTools && inc.failedTools.length > 0) {
        inc.failedTools.forEach((t) => {
          lines.push(`    Failed tool [${t.toolName}]: ${t.error.slice(0, 120)}`);
        });
      }
    });
    lines.push(
      `CRITICAL INSTRUCTION: Do NOT repeat the exact approaches or failed commands above. Choose a cleaner, alternative architectural or implementation strategy.`
    );
    const summaryText = lines.join("\n");
    return {
      hasPastFailures: true,
      failedNodeCount: failureIncidents.length,
      summaryNote: `Detected ${failureIncidents.length} failed attempts in alternative branches.`,
      suggestedPromptPrefix: summaryText
    };
  }
};

// src/core/operation-lock.ts
init_cjs_shims();
var KeyedOperationLock = class {
  tails = /* @__PURE__ */ new Map();
  async run(key, operation) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => void 0).then(() => current);
    this.tails.set(key, tail);
    await previous.catch(() => void 0);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
};

// src/core/workspace-lock.ts
init_cjs_shims();
var import_promises4 = __toESM(require("fs/promises"), 1);
var import_node_path4 = __toESM(require("path"), 1);
var import_node_os = __toESM(require("os"), 1);
var import_node_crypto4 = require("crypto");
var WorkspaceBusyError = class extends Error {
  code = "WORKSPACE_BUSY";
  constructor(lockPath, timeoutMs) {
    super(`Workspace is busy (lock: ${lockPath}); waited ${timeoutMs}ms.`);
    this.name = "WorkspaceBusyError";
  }
};
var WorkspaceFileLock = class {
  lockPath;
  timeoutMs;
  retryMs;
  staleMs;
  constructor(lockPath, options = {}) {
    this.lockPath = import_node_path4.default.resolve(lockPath);
    this.timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 3e4));
    this.retryMs = Math.max(5, Math.floor(options.retryMs ?? 25));
    this.staleMs = Math.max(this.retryMs, Math.floor(options.staleMs ?? 12e4));
  }
  async run(operation) {
    const token = (0, import_node_crypto4.randomUUID)();
    const handle = await this.acquire(token);
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => void 0);
      await this.release(token);
    }
  }
  async acquire(token) {
    await import_promises4.default.mkdir(import_node_path4.default.dirname(this.lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await import_promises4.default.open(this.lockPath, "wx");
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: import_node_os.default.hostname(), createdAt: Date.now() }), "utf8");
        return handle;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        await this.removeDeadOwner();
        if (Date.now() - startedAt >= this.timeoutMs) throw new WorkspaceBusyError(this.lockPath, this.timeoutMs);
        await new Promise((resolve) => setTimeout(resolve, this.retryMs));
      }
    }
  }
  async removeDeadOwner() {
    const stat = await import_promises4.default.stat(this.lockPath).catch(() => void 0);
    if (!stat) return;
    const owner = await import_promises4.default.readFile(this.lockPath, "utf8").then((value) => JSON.parse(value)).catch(() => ({}));
    const age = Date.now() - (owner.createdAt ?? stat.mtimeMs);
    if (owner.pid && owner.pid !== process.pid) {
      try {
        process.kill(owner.pid, 0);
        return;
      } catch {
        await import_promises4.default.rm(this.lockPath, { force: true }).catch(() => void 0);
        return;
      }
    }
    if (age > this.staleMs) await import_promises4.default.rm(this.lockPath, { force: true }).catch(() => void 0);
  }
  async release(token) {
    const owner = await import_promises4.default.readFile(this.lockPath, "utf8").then((value) => JSON.parse(value)).catch(() => void 0);
    if (owner?.token === token) await import_promises4.default.rm(this.lockPath, { force: true }).catch(() => void 0);
  }
};

// src/service.ts
var StorageQuotaError = class extends Error {
  code = "STORAGE_QUOTA_EXCEEDED";
  constructor(message) {
    super(message);
    this.name = "StorageQuotaError";
  }
};
var RestorePlanError = class extends Error {
  code = "RESTORE_PLAN_INVALID";
  constructor(message) {
    super(message);
    this.name = "RestorePlanError";
  }
};
var TimeMachineService = class {
  workDir;
  storageDir;
  config;
  gitEngine;
  fallbackEngine;
  dagManagers = /* @__PURE__ */ new Map();
  recoveredSessions = /* @__PURE__ */ new Set();
  advisor = new ReflectionAdvisor();
  operations = new KeyedOperationLock();
  workspaceLock;
  journalDir;
  restorePlans = /* @__PURE__ */ new Map();
  constructor(options) {
    this.workDir = import_node_path5.default.resolve(options.workDir);
    this.storageDir = options.storageDir ? import_node_path5.default.resolve(options.storageDir) : import_node_path5.default.join(this.workDir, ".dsh", "time-machine");
    this.journalDir = import_node_path5.default.join(this.storageDir, "restore-journals");
    this.config = {
      autoSnapshot: options.config?.autoSnapshot ?? true,
      enableReflectionAdvisor: options.config?.enableReflectionAdvisor ?? true,
      refPrefix: options.config?.refPrefix || "refs/dsh-tm",
      storageDir: this.storageDir,
      webPort: options.config?.webPort || 3088,
      enableWebUI: options.config?.enableWebUI ?? true,
      restoreMode: options.config?.restoreMode ?? "safe",
      preservePaths: options.config?.preservePaths ?? ["node_modules"],
      webHost: options.config?.webHost ?? "127.0.0.1",
      maxSnapshots: Math.max(0, Math.floor(options.config?.maxSnapshots ?? 0)),
      maxStorageBytes: Math.max(0, Math.floor(options.config?.maxStorageBytes ?? 0)),
      shadowStore: options.config?.shadowStore ?? false,
      autoPrune: options.config?.autoPrune ?? false,
      retentionMaxAgeMs: Math.max(0, Math.floor(options.config?.retentionMaxAgeMs ?? 0)),
      workspaceLockTimeoutMs: Math.max(0, Math.floor(options.config?.workspaceLockTimeoutMs ?? 3e4)),
      maxQuarantineBytes: Math.max(0, Math.floor(options.config?.maxQuarantineBytes ?? 0)),
      quarantineEncryptionKeyEnv: options.config?.quarantineEncryptionKeyEnv ?? "",
      restorePlanTtlMs: Math.max(0, Math.floor(options.config?.restorePlanTtlMs ?? 9e5)),
      maxSnapshotFileBytes: Math.max(0, Math.floor(options.config?.maxSnapshotFileBytes ?? 0)),
      maxSnapshotBytes: Math.max(0, Math.floor(options.config?.maxSnapshotBytes ?? 0))
    };
    this.gitEngine = new GitPlumbingEngine({
      workDir: this.workDir,
      refPrefix: this.config.refPrefix,
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      quarantineDir: import_node_path5.default.join(this.storageDir, "ignored-quarantine"),
      shadowObjectDir: this.config.shadowStore ? import_node_path5.default.join(this.storageDir, "git-shadow", "objects") : void 0,
      maxQuarantineBytes: this.config.maxQuarantineBytes,
      quarantineEncryptionKey: this.config.quarantineEncryptionKeyEnv ? process.env[this.config.quarantineEncryptionKeyEnv] : void 0,
      maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
      maxSnapshotBytes: this.config.maxSnapshotBytes
    });
    this.fallbackEngine = new FallbackSnapshotEngine({
      workDir: this.workDir,
      storageDir: import_node_path5.default.join(this.storageDir, "fallback_backups"),
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
      maxSnapshotBytes: this.config.maxSnapshotBytes
    });
    this.workspaceLock = new WorkspaceFileLock(import_node_path5.default.join(this.storageDir, ".workspace.lock"), {
      timeoutMs: this.config.workspaceLockTimeoutMs
    });
  }
  runWorkspaceOperation(operation) {
    return this.operations.run(this.workDir, () => this.workspaceLock.run(operation));
  }
  /**
   * 获取或初始化指定会话的 DAG 管理器
   */
  async getDAGManager(sessionId) {
    let mgr = this.dagManagers.get(sessionId);
    if (!mgr) {
      mgr = new DAGStateManager({
        sessionId,
        storageDir: this.storageDir
      });
      await mgr.init();
      this.dagManagers.set(sessionId, mgr);
    }
    if (!this.recoveredSessions.has(sessionId)) {
      await this.recoverInterruptedRestores(sessionId, mgr);
      this.recoveredSessions.add(sessionId);
    }
    return mgr;
  }
  /**
   * 核心：创建原子双轨快照（状态轨 + 工作区轨）
   */
  async createTurnCheckpoint(params) {
    return this.runWorkspaceOperation(() => this.createTurnCheckpointUnlocked(params));
  }
  async createTurnCheckpointUnlocked(params) {
    const dag = await this.getDAGManager(params.sessionId);
    const internalSafetyCheckpoint = params.tags?.includes("rescue") || params.tags?.includes("selective-restore");
    if (!internalSafetyCheckpoint) {
      if (this.config.autoPrune) await this.autoPruneForQuota(dag);
      if (this.config.retentionMaxAgeMs > 0) await this.autoPruneForAge(dag);
      await this.enforceStorageQuota(dag);
    }
    const checkpointId = `chk_t${params.turnIndex}_${(0, import_node_crypto5.randomUUID)().replace(/-/g, "").slice(0, 12)}`;
    const currentNode = dag.getCurrentNode();
    const parentCommitOid = currentNode ? currentNode.gitCommitOid : null;
    let treeOid = "";
    let commitOid = "";
    let changedFiles = [];
    let ignoredPaths = [];
    const isGit = await this.gitEngine.isGitRepo();
    if (isGit) {
      const snap = await this.gitEngine.createSnapshot({
        sessionId: params.sessionId,
        checkpointId,
        parentCommitOid,
        message: `Turn ${params.turnIndex}: ${params.prompt.slice(0, 50)}`
      });
      treeOid = snap.treeOid;
      commitOid = snap.commitOid;
      changedFiles = snap.changedFiles;
      ignoredPaths = snap.ignoredPaths;
    } else {
      const snap = await this.fallbackEngine.createSnapshot({
        sessionId: params.sessionId,
        checkpointId
      });
      treeOid = snap.treeOid;
      commitOid = snap.commitOid;
      changedFiles = snap.changedFiles;
    }
    const node = {
      id: checkpointId,
      parentId: currentNode ? currentNode.id : null,
      branch: dag.tree.currentBranch,
      turnIndex: params.turnIndex,
      timestamp: Date.now(),
      prompt: params.prompt,
      summary: params.summary || `Executed turn ${params.turnIndex}`,
      gitTreeOid: treeOid,
      gitCommitOid: commitOid,
      sessionState: cloneJson2(params.sessionState),
      changedFiles,
      status: params.status || "success",
      errorMessage: params.errorMessage,
      failedTools: params.failedTools,
      tags: params.tags,
      ignoredPaths
    };
    await dag.addNode(node);
    return cloneJson2(node);
  }
  async finalizeTurnCheckpoint(params) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const settled = await this.gitEngine.isGitRepo() ? await this.gitEngine.inspectWorkspace() : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      return dag.updateNode(params.checkpointId, {
        status: params.status,
        errorMessage: params.errorMessage,
        failedTools: params.failedTools,
        settledGitTreeOid: settled?.treeOid,
        settledIgnoredPaths: settled?.ignoredPaths
      });
    });
  }
  /**
   * 核心：回滚物理工作区与会话状态至指定快照
   */
  async rewindToCheckpoint(sessionId, checkpointId, options = {}) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      await this.consumeRestorePlan(sessionId, checkpointId, options.restorePlanId, dag);
      const restored = await this.restoreWithRescue(dag, target, options);
      try {
        await dag.rewindTo(checkpointId);
      } catch (error) {
        if (restored.rescue) {
          try {
            await this.restoreNode(restored.rescue, void 0, { mode: "force", createRescuePoint: false });
            await dag.rewindTo(restored.rescue.id);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "DAG update failed and rescue compensation also failed");
          }
        }
        throw error;
      }
      await this.completeRestoreJournal(restored.journalId);
      return {
        targetNode: cloneJson2(target),
        restoredSessionState: cloneJson2(target.sessionState),
        rescueCheckpointId: restored.rescue?.id,
        deletedIgnoredPaths: restored.deletedIgnoredPaths,
        restoreJournalId: restored.journalId
      };
    });
  }
  /** Restore selected workspace paths without changing the DSH conversation. */
  async restoreSelectedPaths(sessionId, checkpointId, paths, options = {}) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      await this.consumeRestorePlan(sessionId, checkpointId, options.restorePlanId, dag);
      const selectiveMode = options.mode ?? this.config.restoreMode;
      if (selectiveMode === "merge") throw new Error("Merge mode is only available for full Git-backed rewind/fork operations.");
      if (await this.gitEngine.isGitRepo()) await this.gitEngine.assertSupportedWorkspace();
      const current = dag.getCurrentNode();
      let rescue;
      let journalId;
      if (current) {
        rescue = await this.createTurnCheckpointUnlocked({
          sessionId,
          turnIndex: current.turnIndex,
          prompt: "[automatic selective-restore rescue point]",
          summary: `Rescue point before selectively restoring ${checkpointId}`,
          sessionState: current.sessionState,
          status: "success",
          tags: ["rescue", "selective-restore"]
        });
        journalId = await this.createRestoreJournal({
          sessionId,
          rescueCheckpointId: rescue.id,
          targetCheckpointId: checkpointId,
          kind: "selective-restore"
        });
      }
      try {
        const isGit = await this.gitEngine.isGitRepo();
        if (isGit && !target.gitCommitOid.startsWith("fallback_")) {
          await this.gitEngine.restoreSelectedPaths(target.gitCommitOid, paths, {
            mode: selectiveMode,
            expectedCurrentTreeOid: rescue?.gitTreeOid ?? current?.gitTreeOid
          });
        } else {
          await this.fallbackEngine.restoreSelectedPaths(target.sessionState.sessionId, target.id, paths, {
            mode: selectiveMode,
            expectedCurrentTreeOid: rescue?.gitTreeOid ?? current?.gitTreeOid
          });
        }
        const resultNode = await this.createTurnCheckpointUnlocked({
          sessionId,
          turnIndex: current?.turnIndex ?? target.turnIndex,
          prompt: `[selective restore] ${checkpointId}`,
          summary: `Restored selected paths from ${checkpointId}`,
          sessionState: current?.sessionState ?? target.sessionState,
          status: "success",
          tags: ["selective-restore"]
        });
        await this.updateRestoreJournal(journalId, "workspace-restored");
        await this.completeRestoreJournal(journalId);
        return {
          checkpointId,
          restoredPaths: [...new Set(paths)],
          rescueCheckpointId: rescue?.id,
          resultCheckpointId: resultNode.id,
          restoreJournalId: journalId
        };
      } catch (error) {
        if (rescue) {
          await this.restoreNode(rescue, void 0, { mode: "force", createRescuePoint: false });
          await dag.rewindTo(rescue.id);
          await this.completeRestoreJournal(journalId);
        }
        throw error;
      }
    });
  }
  /**
   * 核心：从历史任意快照点 Fork 开辟新的平行探索分支
   */
  async forkNewBranch(params) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const baseNode = dag.validateFork(params.fromCheckpointId, params.newBranchName);
      const restored = await this.restoreWithRescue(dag, baseNode, params.restore ?? {}, "fork");
      let forkedNode;
      try {
        forkedNode = await dag.forkBranch(params.fromCheckpointId, params.newBranchName, params.description);
      } catch (error) {
        if (restored.rescue) {
          await this.restoreNode(restored.rescue, restored.rescue, { mode: "force", createRescuePoint: false });
          await dag.rewindTo(restored.rescue.id);
        }
        throw error;
      }
      let reflectionAdvisory = {
        hasPastFailures: false,
        failedNodeCount: 0,
        summaryNote: "",
        suggestedPromptPrefix: ""
      };
      if (this.config.enableReflectionAdvisor) {
        const abandonedNodes = dag.getAbandonedSubtrees(params.fromCheckpointId, params.newBranchName);
        const forkPoint = dag.getNode(params.fromCheckpointId);
        const forkPointHasFailure = forkPoint !== null && (forkPoint.status === "failed" || forkPoint.errorMessage !== void 0 || (forkPoint.failedTools?.length ?? 0) > 0);
        reflectionAdvisory = this.advisor.generateReflectionNote(
          forkPointHasFailure && forkPoint !== void 0 ? [forkPoint, ...abandonedNodes] : abandonedNodes
        );
      }
      return {
        forkedNode: cloneJson2(forkedNode),
        restoredSessionState: cloneJson2(forkedNode.sessionState),
        reflectionAdvisory,
        rescueCheckpointId: restored.rescue?.id,
        restoreJournalId: restored.journalId
      };
    });
  }
  /**
   * 获取指定快照与当前（或另一快照）的代码差异
   */
  async getDiff(sessionId, baseId, targetId) {
    const dag = await this.getDAGManager(sessionId);
    const baseNode = dag.getNode(baseId);
    const targetNode = dag.getNode(targetId);
    if (!baseNode || !targetNode) return [];
    const isGit = await this.gitEngine.isGitRepo();
    if (isGit) {
      return await this.gitEngine.getDiffBetween(baseNode.gitCommitOid, targetNode.gitCommitOid);
    }
    return [];
  }
  /**
   * Produce a read-only impact report before a rewind/fork. This deliberately
   * does not create a rescue point, mutate the DAG, or touch workspace files.
   */
  async previewRestore(sessionId, checkpointId) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const current = dag.getCurrentNode();
      const isGit = await this.gitEngine.isGitRepo();
      if (isGit) await this.gitEngine.assertSupportedWorkspace();
      const currentState = isGit ? await this.gitEngine.inspectWorkspace() : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const controlPlane = isGit ? await this.gitEngine.inspectControlPlane() : { headOid: null, branch: "", operation: null };
      const targetIgnoredPaths = target.ignoredPaths ?? [];
      const diffs = isGit ? await this.gitEngine.getDiffBetween(currentState.treeOid, target.gitCommitOid) : target.changedFiles.map((change) => ({
        file: change.path,
        status: change.status,
        diffText: "Fallback snapshot: content diff is unavailable; file is included in the target snapshot."
      }));
      const expectedTree = current?.settledGitTreeOid ?? current?.gitTreeOid;
      const expectedIgnored = current?.settledIgnoredPaths ?? current?.ignoredPaths ?? [];
      const driftDiffs = isGit && current && expectedTree && currentState.treeOid !== expectedTree ? await this.gitEngine.getDiffBetween(expectedTree, currentState.treeOid) : [];
      const conflictingPaths = [.../* @__PURE__ */ new Set([
        ...driftDiffs.map((diff) => diff.file),
        ...!isGit && current && expectedTree && currentState.treeOid !== expectedTree ? ["(fallback workspace; content diff unavailable)"] : [],
        ...symmetricDifference2(expectedIgnored, currentState.ignoredPaths).map((item) => `(ignored) ${item}`)
      ])].sort();
      const workspaceDrifted = Boolean(current && (currentState.treeOid !== expectedTree || !sameStrings(currentState.ignoredPaths, expectedIgnored)));
      this.expireRestorePlans();
      const planId = `plan_${(0, import_node_crypto5.randomUUID)().replace(/-/g, "")}`;
      const createdAt = Date.now();
      const expiresAt = this.config.restorePlanTtlMs > 0 ? createdAt + this.config.restorePlanTtlMs : null;
      this.restorePlans.set(planId, {
        id: planId,
        sessionId,
        checkpointId,
        currentCheckpointId: current?.id ?? null,
        currentTreeOid: currentState.treeOid,
        currentIgnoredPaths: [...currentState.ignoredPaths],
        headOid: controlPlane.headOid,
        branch: controlPlane.branch,
        operation: controlPlane.operation,
        createdAt,
        expiresAt
      });
      return {
        sessionId,
        checkpointId,
        currentCheckpointId: current?.id ?? null,
        currentTreeOid: currentState.treeOid,
        targetTreeOid: target.gitTreeOid,
        currentIgnoredPaths: currentState.ignoredPaths,
        targetIgnoredPaths,
        ignoredPathsToDelete: currentState.ignoredPaths.filter((item) => !targetIgnoredPaths.includes(item)),
        diffs,
        conflictingPaths,
        workspaceDrifted,
        requiresForce: workspaceDrifted,
        restorePlanId: planId,
        restorePlanExpiresAt: expiresAt
      };
    });
  }
  expireRestorePlans(now = Date.now()) {
    for (const [id, plan] of this.restorePlans) {
      if (plan.expiresAt !== null && plan.expiresAt <= now) this.restorePlans.delete(id);
    }
  }
  /** Consume a preview token and fail closed if the reviewed workspace changed. */
  async consumeRestorePlan(sessionId, checkpointId, planId, dag) {
    if (!planId) return;
    this.expireRestorePlans();
    const plan = this.restorePlans.get(planId);
    this.restorePlans.delete(planId);
    if (!plan) throw new RestorePlanError("Restore preview plan is missing or expired; run preview again.");
    if (plan.sessionId !== sessionId || plan.checkpointId !== checkpointId) {
      throw new RestorePlanError("Restore preview plan belongs to a different session or checkpoint.");
    }
    const current = dag.getCurrentNode();
    if ((current?.id ?? null) !== plan.currentCheckpointId) {
      throw new RestorePlanError("The active checkpoint changed after preview; run preview again.");
    }
    const actual = await this.inspectWorkspaceSignature();
    if (actual.treeOid !== plan.currentTreeOid || !sameStrings(actual.ignoredPaths, plan.currentIgnoredPaths)) {
      throw new RestorePlanError("Workspace changed after preview; run preview again before restoring.");
    }
    const controlPlane = await this.inspectControlPlane();
    if (controlPlane.headOid !== plan.headOid || controlPlane.branch !== plan.branch || controlPlane.operation !== plan.operation) {
      throw new RestorePlanError("Git HEAD, branch, or in-progress operation changed after preview; run preview again.");
    }
  }
  async inspectWorkspaceSignature() {
    return await this.gitEngine.isGitRepo() ? await this.gitEngine.inspectWorkspace() : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
  }
  async inspectControlPlane() {
    return await this.gitEngine.isGitRepo() ? await this.gitEngine.inspectControlPlane() : { headOid: null, branch: "", operation: null };
  }
  /**
   * 打印终端彩色 ASCII 拓扑树
   */
  async renderTree(sessionId) {
    const dag = await this.getDAGManager(sessionId);
    return dag.renderAsciiTree();
  }
  async getStorageStatus(sessionId) {
    const sessions = sessionId ? [sessionId] : await this.listStoredSessions();
    const managers = await Promise.all(sessions.map((item) => this.getDAGManager(item)));
    const checkpoints = managers.reduce((sum, manager) => sum + Object.keys(manager.tree.nodes).length, 0);
    const leaves = managers.reduce((sum, manager) => sum + this.pruneCandidates(manager).length, 0);
    const files = await countFiles(this.storageDir);
    const bytes = await directoryBytes2(this.storageDir);
    return {
      storageDir: this.storageDir,
      bytes,
      files,
      sessions: sessions.length,
      checkpoints,
      pruneCandidates: leaves,
      gitObjectsShared: await this.gitEngine.isGitRepo() && !this.config.shadowStore
    };
  }
  /** Report runtime capabilities so Web/CLI integrations can fail early. */
  async getCapabilities() {
    const git = await this.gitEngine.isGitRepo();
    const workspace = git ? await this.gitEngine.inspectWorkspaceCapabilities() : { sparseCheckout: false, submodulePaths: [], inProgressOperation: null };
    const usable = git && !workspace.sparseCheckout && workspace.submodulePaths.length === 0 && !workspace.inProgressOperation;
    return {
      git,
      fallback: !git,
      mergeRestore: usable,
      selectiveRestore: usable || !git,
      shadowStore: git && this.config.shadowStore,
      quarantineEncryption: Boolean(this.config.quarantineEncryptionKeyEnv && process.env[this.config.quarantineEncryptionKeyEnv]),
      workspaceIsolation: "shared-lock",
      workspace,
      policies: {
        restoreMode: this.config.restoreMode,
        maxSnapshots: this.config.maxSnapshots,
        maxStorageBytes: this.config.maxStorageBytes,
        retentionMaxAgeMs: this.config.retentionMaxAgeMs,
        maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
        maxSnapshotBytes: this.config.maxSnapshotBytes,
        maxQuarantineBytes: this.config.maxQuarantineBytes,
        workspaceLockTimeoutMs: this.config.workspaceLockTimeoutMs
      }
    };
  }
  async prune(sessionId, options = {}) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const keepLatest = Math.max(0, Math.floor(options.keepLatest ?? 20));
      const nodes = Object.values(dag.tree.nodes).sort((left, right) => right.timestamp - left.timestamp);
      const keep = new Set(nodes.slice(0, keepLatest).map((node) => node.id));
      const olderThanMs = options.olderThanMs !== void 0 ? Math.max(0, Math.floor(options.olderThanMs)) : void 0;
      const cutoff = olderThanMs !== void 0 && olderThanMs > 0 ? Date.now() - olderThanMs : void 0;
      let removed = [];
      if (options.abandonedBranches) {
        const abandonedBranches = Object.keys(dag.tree.branches).filter((branch) => branch !== dag.tree.currentBranch);
        for (const branch of abandonedBranches) removed.push(...await dag.removeBranch(branch));
      }
      const candidates = Object.values(dag.tree.nodes).filter((node) => !keep.has(node.id) && (cutoff === void 0 || node.timestamp < cutoff));
      if (options.compactHistory) {
        removed.push(...await dag.compactNodes(candidates.map((node) => node.id)));
      } else {
        removed.push(...await dag.removeLeafNodes(candidates.map((node) => node.id)));
      }
      const reclaimed = await this.reclaimNodes(sessionId, removed);
      const shadowRepack = options.repackShadowObjects && this.config.shadowStore ? await this.gitEngine.repackShadowObjects() : void 0;
      return {
        sessionId,
        removedCheckpointIds: removed.map((node) => node.id),
        reclaimedBytes: reclaimed.reclaimedBytes,
        gitRefsRemoved: reclaimed.gitRefsRemoved,
        quarantineReclaimedBytes: reclaimed.quarantineReclaimedBytes,
        shadowObjectsReclaimedBytes: shadowRepack?.reclaimedBytes,
        shadowRepackSkippedReason: shadowRepack?.skippedReason,
        note: reclaimed.gitRefsRemoved > 0 ? this.config.shadowStore ? "Plugin refs and shadow objects were pruned; the user repository was not garbage-collected." : "Git objects are shared; run repository maintenance only if you understand its impact." : cutoff === void 0 ? "Fallback snapshot bytes were removed from plugin storage." : `Only checkpoints older than ${olderThanMs} ms were eligible; protected DAG nodes were retained.`
      };
    });
  }
  async autoPruneForQuota(dag) {
    const nodes = Object.values(dag.tree.nodes).sort((left, right) => left.timestamp - right.timestamp);
    const protectedIds = /* @__PURE__ */ new Set([
      ...dag.tree.currentCheckpointId ? [dag.tree.currentCheckpointId] : [],
      ...Object.values(dag.tree.branches).map((branch) => branch.headId).filter(Boolean)
    ]);
    let candidates = nodes.filter((node) => !protectedIds.has(node.id));
    if (this.config.maxSnapshots > 0) {
      const removeCount = Math.max(0, nodes.length - this.config.maxSnapshots + 1);
      candidates = candidates.slice(0, removeCount);
    }
    if (this.config.maxStorageBytes > 0 && await directoryBytes2(this.storageDir) >= this.config.maxStorageBytes) {
      candidates = candidates.length ? candidates : nodes.filter((node) => !protectedIds.has(node.id));
    }
    if (candidates.length === 0) return;
    const removed = await dag.compactNodes(candidates.map((node) => node.id));
    await this.reclaimNodes(dag.tree.sessionId, removed);
  }
  async autoPruneForAge(dag) {
    const cutoff = Date.now() - this.config.retentionMaxAgeMs;
    const protectedIds = /* @__PURE__ */ new Set([
      ...dag.tree.currentCheckpointId ? [dag.tree.currentCheckpointId] : [],
      ...Object.values(dag.tree.branches).map((branch) => branch.headId).filter(Boolean)
    ]);
    const candidates = Object.values(dag.tree.nodes).filter((node) => node.timestamp < cutoff && !protectedIds.has(node.id));
    if (candidates.length === 0) return;
    const removed = await dag.compactNodes(candidates.map((node) => node.id));
    await this.reclaimNodes(dag.tree.sessionId, removed);
  }
  async reclaimNodes(sessionId, nodes) {
    let reclaimedBytes = 0;
    let gitRefsRemoved = 0;
    let quarantineReclaimedBytes = 0;
    for (const node of nodes) {
      if (node.gitCommitOid.startsWith("fallback_")) reclaimedBytes += await this.fallbackEngine.removeSnapshot(sessionId, node.id);
      else if (await this.gitEngine.isGitRepo() && await this.gitEngine.deleteCheckpointRef(sessionId, node.id)) gitRefsRemoved += 1;
    }
    const referencedBackups = await this.referencedIgnoredBackupKeys();
    for (const key of new Set(nodes.map((node) => node.ignoredBackupKey).filter((item) => Boolean(item)))) {
      if (!referencedBackups.has(key)) quarantineReclaimedBytes += await this.gitEngine.removeIgnoredBackup(key);
    }
    if (this.config.shadowStore) await this.gitEngine.pruneShadowObjects();
    return { reclaimedBytes, gitRefsRemoved, quarantineReclaimedBytes };
  }
  async referencedIgnoredBackupKeys() {
    const keys = /* @__PURE__ */ new Set();
    const collect = (raw) => {
      for (const node of Object.values(raw?.nodes ?? {})) {
        if (node.ignoredBackupKey) keys.add(node.ignoredBackupKey);
      }
    };
    for (const manager of this.dagManagers.values()) collect(manager.tree);
    for (const entry of await import_promises5.default.readdir(this.storageDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.startsWith("dag_") || !entry.name.endsWith(".json")) continue;
      const raw = await import_promises5.default.readFile(import_node_path5.default.join(this.storageDir, entry.name), "utf8").then((value) => JSON.parse(value)).catch(() => void 0);
      if (raw) collect(raw);
    }
    return keys;
  }
  pruneCandidates(dag) {
    const protectedIds = /* @__PURE__ */ new Set([
      ...dag.tree.currentCheckpointId ? [dag.tree.currentCheckpointId] : [],
      ...Object.values(dag.tree.branches).map((branch) => branch.headId).filter(Boolean)
    ]);
    const parents = new Set(Object.values(dag.tree.nodes).map((node) => node.parentId).filter((id) => Boolean(id)));
    return Object.values(dag.tree.nodes).filter((node) => !protectedIds.has(node.id) && !parents.has(node.id));
  }
  async listStoredSessions() {
    const entries = await import_promises5.default.readdir(this.storageDir, { withFileTypes: true }).catch(() => []);
    const sessions = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("dag_") || !entry.name.endsWith(".json")) continue;
      try {
        const tree = JSON.parse(await import_promises5.default.readFile(import_node_path5.default.join(this.storageDir, entry.name), "utf8"));
        if (typeof tree.sessionId === "string") sessions.add(tree.sessionId);
      } catch {
      }
    }
    return [...sessions];
  }
  async enforceStorageQuota(dag) {
    if (this.config.maxSnapshots > 0 && Object.keys(dag.tree.nodes).length >= this.config.maxSnapshots) {
      throw new StorageQuotaError(
        `Session '${dag.tree.sessionId}' reached maxSnapshots=${this.config.maxSnapshots}. Run /tm-prune or increase the limit.`
      );
    }
    if (this.config.maxStorageBytes > 0) {
      const bytes = await directoryBytes2(this.storageDir);
      if (bytes >= this.config.maxStorageBytes) {
        throw new StorageQuotaError(
          `Time Machine storage reached maxStorageBytes=${this.config.maxStorageBytes}. Run /tm-prune or increase the limit.`
        );
      }
    }
  }
  async restoreWithRescue(dag, target, options, kind = "rewind") {
    const current = dag.getCurrentNode() ?? void 0;
    const mode = options.mode ?? this.config.restoreMode;
    if (await this.gitEngine.isGitRepo()) await this.gitEngine.assertSupportedWorkspace();
    if (mode === "safe" && current) {
      const actual = await this.gitEngine.isGitRepo() ? await this.gitEngine.inspectWorkspace() : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const expectedTree = current.settledGitTreeOid ?? current.gitTreeOid;
      const expectedIgnored = current.settledIgnoredPaths ?? current.ignoredPaths ?? [];
      if (actual.treeOid !== expectedTree || !sameStrings(actual.ignoredPaths, expectedIgnored)) {
        const { WorkspaceDriftError: WorkspaceDriftError2 } = await Promise.resolve().then(() => (init_git_plumbing(), git_plumbing_exports));
        const changed = actual.treeOid === expectedTree ? [] : (await this.gitEngine.getDiffBetween(expectedTree, actual.treeOid)).map((item) => item.file);
        const details = actual.treeOid === expectedTree ? ["workspace no longer matches the active checkpoint"] : [`managed tree changed (expected ${expectedTree}, observed ${actual.treeOid})${changed.length ? `: ${changed.join(", ")}` : ""}`];
        if (!sameStrings(actual.ignoredPaths, expectedIgnored)) details.push("ignored path set changed");
        throw new WorkspaceDriftError2(details);
      }
    }
    let rescue;
    let journalId;
    if (options.createRescuePoint !== false && current) {
      rescue = await this.createTurnCheckpointUnlocked({
        sessionId: dag.tree.sessionId,
        turnIndex: current.turnIndex,
        prompt: "[automatic pre-restore rescue point]",
        summary: `Rescue point before restoring ${target.id}`,
        sessionState: current.sessionState,
        status: "success",
        tags: ["rescue"]
      });
      journalId = await this.createRestoreJournal({
        sessionId: dag.tree.sessionId,
        rescueCheckpointId: rescue.id,
        targetCheckpointId: target.id,
        kind
      });
    }
    const expected = mode === "merge" ? current : rescue ?? current;
    if (rescue && options.deleteNewIgnoredPaths) {
      rescue = await dag.updateNode(rescue.id, { ignoredBackupKey: rescue.id });
    }
    try {
      const result = await this.restoreNode(target, expected, {
        ...options,
        mode,
        ignoredBackupKey: rescue?.ignoredBackupKey
      });
      await this.updateRestoreJournal(journalId, "workspace-restored");
      return { rescue, deletedIgnoredPaths: result.deletedIgnoredPaths, journalId };
    } catch (error) {
      if (rescue) {
        try {
          await this.restoreNode(rescue, void 0, { mode: "force", createRescuePoint: false });
          await dag.rewindTo(rescue.id);
          await this.completeRestoreJournal(journalId);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Restore failed and rescue compensation also failed");
        }
      }
      throw error;
    }
  }
  async restoreNode(target, expected, options) {
    const isGit = await this.gitEngine.isGitRepo();
    if (isGit && target.gitCommitOid && !target.gitCommitOid.startsWith("fallback_")) {
      const backupKey = options.ignoredBackupKey ?? target.ignoredBackupKey;
      if (backupKey) await this.gitEngine.validateIgnoredBackup(backupKey);
      const result = await this.gitEngine.restoreSnapshot(target.gitCommitOid, {
        mode: options.mode,
        expectedCurrentTreeOid: expected?.gitTreeOid,
        expectedCurrentIgnoredPaths: expected?.ignoredPaths ?? [],
        targetIgnoredPaths: target.ignoredPaths ?? [],
        deleteNewIgnoredPaths: options.deleteNewIgnoredPaths,
        ignoredBackupKey: options.ignoredBackupKey
      });
      if (target.ignoredBackupKey) await this.gitEngine.restoreIgnoredBackup(target.ignoredBackupKey);
      const verified2 = await this.gitEngine.inspectWorkspace();
      const expectedTree = options.mode === "merge" ? result.restoredTreeOid : target.gitTreeOid;
      if (verified2.treeOid !== expectedTree || !sameStrings(verified2.ignoredPaths, target.ignoredPaths ?? [])) {
        throw new Error(`Workspace integrity check failed after restoring checkpoint '${target.id}'.`);
      }
      return result;
    }
    if (options.mode === "merge") {
      throw new Error("Merge restore is only supported for Git-backed checkpoints.");
    }
    await this.fallbackEngine.restoreSnapshot(target.sessionState.sessionId, target.id);
    const verified = await this.fallbackEngine.inspectWorkspace();
    if (verified !== target.gitTreeOid) {
      throw new Error(`Fallback workspace integrity check failed after restoring checkpoint '${target.id}'.`);
    }
    return { deletedIgnoredPaths: [] };
  }
  async completeRestoreJournal(journalId) {
    if (!journalId) return;
    await import_promises5.default.rm(import_node_path5.default.join(this.journalDir, `${journalId}.json`), { force: true }).catch(() => void 0);
  }
  async createRestoreJournal(params) {
    const id = `restore_${(0, import_node_crypto5.randomUUID)().replace(/-/g, "")}`;
    const journal = { version: 1, id, phase: "prepared", createdAt: Date.now(), ...params };
    await import_promises5.default.mkdir(this.journalDir, { recursive: true });
    const file = import_node_path5.default.join(this.journalDir, `${id}.json`);
    const temporary = `${file}.${(0, import_node_crypto5.randomUUID)()}.tmp`;
    try {
      await import_promises5.default.writeFile(temporary, `${JSON.stringify(journal, null, 2)}
`, { encoding: "utf8", flag: "wx" });
      await import_promises5.default.rename(temporary, file);
    } finally {
      await import_promises5.default.rm(temporary, { force: true }).catch(() => void 0);
    }
    return id;
  }
  async updateRestoreJournal(journalId, phase) {
    if (!journalId) return;
    const file = import_node_path5.default.join(this.journalDir, `${journalId}.json`);
    const raw = await import_promises5.default.readFile(file, "utf8").catch(() => void 0);
    if (!raw) return;
    const journal = JSON.parse(raw);
    journal.phase = phase;
    await import_promises5.default.writeFile(file, `${JSON.stringify(journal, null, 2)}
`, "utf8");
  }
  async recoverInterruptedRestores(sessionId, dag) {
    const entries = await import_promises5.default.readdir(this.journalDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = import_node_path5.default.join(this.journalDir, entry.name);
      let journal;
      try {
        journal = JSON.parse(await import_promises5.default.readFile(file, "utf8"));
      } catch {
        continue;
      }
      if (journal.version !== 1 || journal.sessionId !== sessionId) continue;
      const rescue = dag.getNode(journal.rescueCheckpointId);
      if (!rescue) {
        await import_promises5.default.rm(file, { force: true });
        continue;
      }
      await this.restoreNode(rescue, void 0, { mode: "force", createRescuePoint: false });
      await dag.rewindTo(rescue.id);
      await import_promises5.default.rm(file, { force: true });
    }
  }
};
function cloneJson2(value) {
  return JSON.parse(JSON.stringify(value));
}
function sameStrings(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
function symmetricDifference2(left, right) {
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  return [...left.filter((item) => !rightSet.has(item)), ...right.filter((item) => !leftSet.has(item))];
}
async function directoryBytes2(root) {
  let total = 0;
  const visit = async (directory) => {
    for (const entry of await import_promises5.default.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = import_node_path5.default.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += (await import_promises5.default.stat(absolute).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}
async function countFiles(root) {
  let total = 0;
  const visit = async (directory) => {
    for (const entry of await import_promises5.default.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = import_node_path5.default.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += 1;
    }
  };
  await visit(root);
  return total;
}

// src/web/server.ts
init_cjs_shims();
var import_node_http = __toESM(require("http"), 1);
var import_node_path6 = __toESM(require("path"), 1);
var import_promises6 = __toESM(require("fs/promises"), 1);
var import_node_url = require("url");
var TimeMachineWebServer = class {
  server = null;
  port;
  host;
  service;
  hooks;
  constructor(service, port = 3088, host = "127.0.0.1", hooks = {}) {
    this.service = service;
    this.port = port;
    this.host = host;
    this.hooks = hooks;
  }
  async start() {
    return new Promise((resolve, reject) => {
      this.server = import_node_http.default.createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
        if (!this.isLocalRequest(req)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Cross-origin or non-loopback request rejected" }));
          return;
        }
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        try {
          const parsedUrl = new import_node_url.URL(req.url || "/", `http://localhost:${this.port}`);
          const pathname = parsedUrl.pathname;
          if (pathname.startsWith("/api/")) {
            await this.handleApi(req, res, pathname, parsedUrl.searchParams);
            return;
          }
          await this.handleStatic(res, pathname);
        } catch (err) {
          const status = err?.code === "BAD_REQUEST" ? 400 : err?.code === "RESTORE_PLAN_INVALID" || err?.code === "RESTORE_MERGE_CONFLICT" ? 409 : err?.code === "UNSUPPORTED_WORKSPACE_STATE" ? 422 : err?.code === "SNAPSHOT_SIZE_LIMIT" ? 413 : 500;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: err.message || "Internal Server Error",
            ...typeof err.code === "string" ? { code: err.code } : {},
            ...err.details && typeof err.details === "object" ? { details: err.details } : {},
            ...Array.isArray(err.paths) ? { paths: err.paths } : {},
            ...err.capabilities && typeof err.capabilities === "object" ? { capabilities: err.capabilities } : {}
          }));
        }
      });
      this.server.listen(this.port, this.host, () => {
        const host = this.host.includes(":") ? `[${this.host}]` : this.host;
        const url = `http://${host}:${this.port}`;
        resolve(url);
      });
      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }
  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server?.close(() => resolve());
      });
    }
  }
  async handleApi(req, res, pathname, query) {
    if (pathname === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "online",
        workDir: this.service.workDir,
        version: "0.2.0"
      }));
      return;
    }
    if (pathname === "/api/dag" && req.method === "GET") {
      const sessionId = query.get("sessionId") || "default";
      const dag = await this.service.getDAGManager(sessionId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(dag.tree));
      return;
    }
    if (pathname === "/api/storage" && req.method === "GET") {
      const sessionId = query.get("sessionId") || void 0;
      const status = await this.service.getStorageStatus(sessionId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status }));
      return;
    }
    if (pathname === "/api/capabilities" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ capabilities: await this.service.getCapabilities() }));
      return;
    }
    if (pathname === "/api/diff" && req.method === "GET") {
      const sessionId = query.get("sessionId") || "default";
      const baseId = query.get("base") || "";
      const targetId = query.get("target") || "";
      const diffs = await this.service.getDiff(sessionId, baseId, targetId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ diffs }));
      return;
    }
    if (pathname === "/api/preview" && req.method === "GET") {
      const sessionId = query.get("sessionId") || "default";
      const checkpointId = query.get("checkpoint") || "";
      if (!checkpointId) throw Object.assign(new Error("Missing checkpoint query parameter"), { code: "BAD_REQUEST" });
      const preview = await this.service.previewRestore(sessionId, checkpointId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ preview }));
      return;
    }
    if (pathname === "/api/rewind" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const { sessionId, checkpointId } = body;
      if (!this.hooks.restartConversation) throw new Error("Conversation restart capability is unavailable; refusing workspace-only rewind.");
      const sourceSessionId = sessionId || "default";
      const result = await this.service.rewindToCheckpoint(sourceSessionId, checkpointId, {
        mode: body.force === true ? "force" : body.merge === true ? "merge" : void 0,
        deleteNewIgnoredPaths: body.deleteNewIgnoredPaths === true,
        restorePlanId: typeof body.restorePlanId === "string" ? body.restorePlanId : void 0
      });
      let conversation;
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.targetNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        await this.service.completeRestoreJournal(result.restoreJournalId);
        throw error;
      }
      await this.service.completeRestoreJournal(result.restoreJournalId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result, conversation }));
      return;
    }
    if (pathname === "/api/restore-files" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const sessionId = body.sessionId || "default";
      const paths = Array.isArray(body.paths) ? body.paths.filter((item) => typeof item === "string") : [];
      if (!body.checkpointId || paths.length === 0) throw Object.assign(new Error("checkpointId and non-empty paths are required"), { code: "BAD_REQUEST" });
      const result = await this.service.restoreSelectedPaths(sessionId, body.checkpointId, paths, {
        mode: body.force === true ? "force" : body.merge === true ? "merge" : void 0,
        restorePlanId: typeof body.restorePlanId === "string" ? body.restorePlanId : void 0
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }
    if (pathname === "/api/prune" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const sessionId = body.sessionId || "default";
      const keepLatest = body.keepLatest === void 0 ? void 0 : Number(body.keepLatest);
      const olderThanMs = body.olderThanMs === void 0 ? void 0 : Number(body.olderThanMs);
      if (keepLatest !== void 0 && (!Number.isInteger(keepLatest) || keepLatest < 0)) {
        throw Object.assign(new Error("keepLatest must be a non-negative integer"), { code: "BAD_REQUEST" });
      }
      if (olderThanMs !== void 0 && (!Number.isSafeInteger(olderThanMs) || olderThanMs <= 0)) {
        throw Object.assign(new Error("olderThanMs must be a positive integer"), { code: "BAD_REQUEST" });
      }
      const result = await this.service.prune(sessionId, {
        keepLatest,
        olderThanMs,
        abandonedBranches: body.abandonedBranches === true,
        compactHistory: body.compactHistory === true,
        repackShadowObjects: body.repackShadowObjects === true
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }
    if (pathname === "/api/fork" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const { sessionId, checkpointId, branchName, description } = body;
      if (!this.hooks.restartConversation) throw new Error("Conversation restart capability is unavailable; refusing workspace-only fork.");
      const sourceSessionId = sessionId || "default";
      const result = await this.service.forkNewBranch({
        sessionId: sourceSessionId,
        fromCheckpointId: checkpointId,
        newBranchName: branchName,
        description,
        restore: { mode: body.force === true ? "force" : body.merge === true ? "merge" : void 0 }
      });
      let conversation;
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.forkedNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        await this.service.completeRestoreJournal(result.restoreJournalId);
        throw error;
      }
      await this.service.completeRestoreJournal(result.restoreJournalId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result, conversation }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Endpoint not found" }));
  }
  async readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let data = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += Buffer.byteLength(chunk);
        if (size > 64 * 1024) {
          const error = Object.assign(new Error("JSON payload exceeds 64 KiB"), { code: "BAD_REQUEST" });
          reject(error);
          req.destroy();
          return;
        }
        data += chunk;
      });
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(Object.assign(new Error("Invalid JSON payload"), { code: "BAD_REQUEST" }));
        }
      });
      req.on("error", reject);
    });
  }
  async handleStatic(res, pathname) {
    const filePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    if (!["index.html", "app.js", "style.css"].includes(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const currentFileDir = import_node_path6.default.dirname(new import_node_url.URL(importMetaUrl).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const candidateDirs = [
      import_node_path6.default.join(currentFileDir, "client"),
      import_node_path6.default.join(currentFileDir, "../src/web/client"),
      import_node_path6.default.join(currentFileDir, "web/client"),
      import_node_path6.default.join(process.cwd(), "src/web/client"),
      import_node_path6.default.join(process.cwd(), "dist/client")
    ];
    let fullPath = "";
    for (const dir of candidateDirs) {
      const candidate = import_node_path6.default.resolve(dir, filePath);
      const relative = import_node_path6.default.relative(import_node_path6.default.resolve(dir), candidate);
      if (relative.startsWith("..") || import_node_path6.default.isAbsolute(relative)) continue;
      try {
        await import_promises6.default.access(candidate);
        fullPath = candidate;
        break;
      } catch {
      }
    }
    try {
      if (!fullPath) throw new Error("Asset not found");
      const content = await import_promises6.default.readFile(fullPath);
      const ext = import_node_path6.default.extname(fullPath);
      const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json"
      };
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(content);
    } catch {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(this.getFallbackHtml());
    }
  }
  getFallbackHtml() {
    return `<!DOCTYPE html>
<html>
<head><title>DSH Time Machine</title></head>
<body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc;">
  <h2>DSH Time Machine Server Active</h2>
  <p>Port: ${this.port} | Web UI Client Loaded</p>
</body>
</html>`;
  }
  isLocalRequest(req) {
    const hostHeader = req.headers.host ?? "";
    const hostname = hostHeader.startsWith("[") ? hostHeader.slice(1, hostHeader.indexOf("]")) : hostHeader.split(":", 1)[0];
    const allowed = /* @__PURE__ */ new Set([this.host, "127.0.0.1", "localhost", "::1"]);
    if (!allowed.has(hostname)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return allowed.has(new import_node_url.URL(origin).hostname);
    } catch {
      return false;
    }
  }
  async compensate(sessionId, rescueCheckpointId) {
    if (!rescueCheckpointId) return;
    await this.service.rewindToCheckpoint(sessionId, rescueCheckpointId, {
      mode: "force",
      createRescuePoint: false
    });
  }
};

// src/cli/commands.ts
init_cjs_shims();
function registerCliCommands(ctx, service) {
  ctx.inject(["commands"], (scope) => {
    scope.commands.register({
      name: "tm-tree",
      description: "Show the Time Machine checkpoint DAG",
      recordInput: false,
      handler: async ({ agent }) => ({
        kind: "success",
        text: await service.renderTree(agent.session.id)
      })
    });
    scope.commands.register({
      name: "tm-storage",
      description: "Show Time Machine snapshot storage usage",
      recordInput: false,
      handler: async ({ agent }) => {
        const status = await service.getStorageStatus(agent.session.id);
        return { kind: "success", text: `Time Machine storage: ${formatBytes(status.bytes)} in ${status.files} files; ${status.checkpoints} checkpoints; ${status.pruneCandidates} safe leaf candidate(s).` };
      }
    });
    scope.commands.register({
      name: "tm-prune",
      description: "Prune old non-head Time Machine checkpoints",
      input: { hint: "[keep-latest] [--older-than=<duration>] [--abandoned-branches] [--compact-history] [--repack-shadow]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const keepArg = args.find((arg) => !arg.startsWith("--"));
        const keepLatest = keepArg ? Number(keepArg) : 20;
        if (!Number.isInteger(keepLatest) || keepLatest < 0) return { kind: "error", text: "Usage: /tm-prune [non-negative keep-latest]" };
        const olderThanRaw = optionValue(args, "--older-than");
        const olderThanMs = olderThanRaw === void 0 ? void 0 : parseDurationMs(olderThanRaw);
        if (olderThanRaw !== void 0 && olderThanMs === void 0) return { kind: "error", text: "Usage: /tm-prune [--older-than=<7d|12h|30m|45s>]" };
        const result = await service.prune(agent.session.id, {
          keepLatest,
          olderThanMs,
          abandonedBranches: args.includes("--abandoned-branches"),
          compactHistory: args.includes("--compact-history"),
          repackShadowObjects: args.includes("--repack-shadow")
        });
        const quarantine = result.quarantineReclaimedBytes ? ` Quarantine reclaimed ${formatBytes(result.quarantineReclaimedBytes)}.` : "";
        const shadow = result.shadowObjectsReclaimedBytes ? ` Shadow packs reclaimed ${formatBytes(result.shadowObjectsReclaimedBytes)}.` : "";
        const warning = result.shadowRepackSkippedReason ? ` Shadow repack skipped: ${result.shadowRepackSkippedReason}.` : "";
        return { kind: "success", text: `Pruned ${result.removedCheckpointIds.length} checkpoint(s), reclaimed ${formatBytes(result.reclaimedBytes)}.${quarantine}${shadow}${warning} ${result.note}` };
      }
    });
    scope.commands.register({
      name: "tm-rewind",
      description: "Restore workspace and fork conversation at a checkpoint",
      input: { hint: "<checkpoint> [--merge|--force] [--delete-new-ignored] [--plan=<id>]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const checkpointId = args.find((arg) => !arg.startsWith("--"));
        if (!checkpointId) return { kind: "error", text: "Usage: /tm-rewind <checkpoint> [--merge|--force] [--delete-new-ignored]" };
        const controller = scope.get("sessionController");
        if (!controller) return { kind: "error", text: "This DSH profile has no sessionController; dual-track rewind is unavailable." };
        const sessionId = agent.session.id;
        const result = await service.rewindToCheckpoint(sessionId, checkpointId, {
          mode: args.includes("--force") ? "force" : args.includes("--merge") ? "merge" : void 0,
          deleteNewIgnoredPaths: args.includes("--delete-new-ignored"),
          restorePlanId: optionValue(args, "--plan")
        });
        try {
          const created = await restartConversation(controller, sessionId, result.targetNode, service.workDir);
          await service.completeRestoreJournal(result.restoreJournalId);
          return {
            kind: "success",
            text: `Restored ${checkpointId}. Continue in forked session ${created.sessionId}. Rescue point: ${result.rescueCheckpointId ?? "none"}.`
          };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          await service.completeRestoreJournal(result.restoreJournalId);
          throw error;
        }
      }
    });
    scope.commands.register({
      name: "tm-preview",
      description: "Preview workspace changes before a rewind or fork",
      input: { hint: "<checkpoint>" },
      handler: async ({ agent, rawInput }) => {
        const checkpointId = rawInput.trim().split(/\s+/).filter(Boolean)[0];
        if (!checkpointId) return { kind: "error", text: "Usage: /tm-preview <checkpoint>" };
        const preview = await service.previewRestore(agent.session.id, checkpointId);
        const drift = preview.requiresForce ? "workspace drift detected; --force may be required" : "workspace matches active checkpoint";
        const files = preview.diffs.length ? preview.diffs.map((item) => `${item.status} ${item.file}`).join(", ") : "no managed file changes";
        const ignored = preview.ignoredPathsToDelete.length ? ` Ignored paths to delete: ${preview.ignoredPathsToDelete.join(", ")}.` : "";
        const conflicts = preview.conflictingPaths.length ? ` Conflicting paths: ${preview.conflictingPaths.join(", ")}.` : "";
        const plan = ` Restore plan: ${preview.restorePlanId}${preview.restorePlanExpiresAt ? ` (expires ${new Date(preview.restorePlanExpiresAt).toISOString()})` : " (no expiry)"}.`;
        return { kind: "success", text: `Preview ${checkpointId}: ${drift}. Changes: ${files}.${ignored}${conflicts}${plan}` };
      }
    });
    scope.commands.register({
      name: "tm-restore-files",
      description: "Restore selected workspace paths from a checkpoint without changing conversation",
      input: { hint: "<checkpoint> <path...> [--force] [--plan=<id>]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter((arg) => !arg.startsWith("--"));
        if (positionals.length < 2) return { kind: "error", text: "Usage: /tm-restore-files <checkpoint> <path...> [--force]" };
        const result = await service.restoreSelectedPaths(agent.session.id, positionals[0], positionals.slice(1), {
          mode: args.includes("--force") ? "force" : void 0,
          restorePlanId: optionValue(args, "--plan")
        });
        return { kind: "success", text: `Restored ${result.restoredPaths.join(", ")} from ${positionals[0]}. Conversation unchanged. Result checkpoint: ${result.resultCheckpointId ?? "none"}.` };
      }
    });
    scope.commands.register({
      name: "tm-fork",
      description: "Create a named exploration branch from a checkpoint",
      input: { hint: "<checkpoint> <branch> [--merge|--force]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter((arg) => !arg.startsWith("--"));
        if (positionals.length < 2) return { kind: "error", text: "Usage: /tm-fork <checkpoint> <branch> [--merge|--force]" };
        const controller = scope.get("sessionController");
        if (!controller) return { kind: "error", text: "This DSH profile has no sessionController; dual-track fork is unavailable." };
        const sessionId = agent.session.id;
        const result = await service.forkNewBranch({
          sessionId,
          fromCheckpointId: positionals[0],
          newBranchName: positionals[1],
          restore: { mode: args.includes("--force") ? "force" : args.includes("--merge") ? "merge" : void 0 }
        });
        try {
          const created = await restartConversation(controller, sessionId, result.forkedNode, service.workDir);
          await service.completeRestoreJournal(result.restoreJournalId);
          const reflection = result.reflectionAdvisory.hasPastFailures ? `

${result.reflectionAdvisory.suggestedPromptPrefix}` : "";
          return { kind: "success", text: `Forked ${positionals[1]} into DSH session ${created.sessionId}.${reflection}` };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          await service.completeRestoreJournal(result.restoreJournalId);
          throw error;
        }
      }
    });
  });
}
function optionValue(args, name2) {
  const prefix = `${name2}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) || void 0 : void 0;
}
function parseDurationMs(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/i.exec(value.trim());
  if (!match) return void 0;
  const amount = Number(match[1]);
  const factor = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
  const result = amount * factor[match[2].toLowerCase()];
  return Number.isSafeInteger(Math.floor(result)) ? Math.floor(result) : void 0;
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
async function restartConversation(controller, sourceSessionId, checkpoint, cwd) {
  const boundary = checkpoint.sessionState.boundarySeq;
  return boundary === void 0 ? controller.create({ cwd }) : controller.fork({ sessionId: sourceSessionId, atSeq: boundary });
}
async function compensate(service, sessionId, rescueCheckpointId) {
  if (!rescueCheckpointId) return;
  await service.rewindToCheckpoint(sessionId, rescueCheckpointId, {
    mode: "force",
    createRescuePoint: false
  });
}

// src/types.ts
init_cjs_shims();

// src/index.ts
init_git_plumbing();
var name = "dsh-plugin-time-machine";
var Config = import_schemastery.default.object({
  autoSnapshot: import_schemastery.default.boolean().default(true),
  enableReflectionAdvisor: import_schemastery.default.boolean().default(true),
  refPrefix: import_schemastery.default.string().default("refs/dsh-tm"),
  storageDir: import_schemastery.default.string(),
  webPort: import_schemastery.default.number().default(3088),
  enableWebUI: import_schemastery.default.boolean().default(true),
  restoreMode: import_schemastery.default.union(["safe", "merge", "force"]).default("safe"),
  preservePaths: import_schemastery.default.array(import_schemastery.default.string()).default(["node_modules"]),
  webHost: import_schemastery.default.string().default("127.0.0.1"),
  maxSnapshots: import_schemastery.default.number().default(0),
  maxStorageBytes: import_schemastery.default.number().default(0),
  shadowStore: import_schemastery.default.boolean().default(false),
  autoPrune: import_schemastery.default.boolean().default(false),
  retentionMaxAgeMs: import_schemastery.default.number().default(0),
  workspaceLockTimeoutMs: import_schemastery.default.number().default(3e4),
  maxQuarantineBytes: import_schemastery.default.number().default(0),
  quarantineEncryptionKeyEnv: import_schemastery.default.string().default(""),
  restorePlanTtlMs: import_schemastery.default.number().default(9e5),
  maxSnapshotFileBytes: import_schemastery.default.number().default(0),
  maxSnapshotBytes: import_schemastery.default.number().default(0)
});
function apply(ctx, config = {}) {
  const workDir = import_node_path7.default.resolve(process.cwd());
  const service = new TimeMachineService({ workDir, config });
  ctx.provide("timeMachine", service);
  registerCliCommands(ctx, service);
  if (config.enableWebUI !== false) {
    const webServer = new TimeMachineWebServer(service, config.webPort ?? 3088, config.webHost ?? "127.0.0.1", {
      restartConversation: async (sourceSessionId, checkpoint) => {
        const controller = ctx.get("sessionController");
        if (!controller) throw new Error("This DSH profile has no sessionController.");
        const boundary = checkpoint.sessionState.boundarySeq;
        return boundary === void 0 ? controller.create({ cwd: service.workDir }) : controller.fork({ sessionId: sourceSessionId, atSeq: boundary });
      }
    });
    ctx.effect(() => {
      void webServer.start().then((url) => {
        ctx.logger.info(`[time-machine] dashboard listening on ${url}`);
      }).catch((error) => {
        ctx.logger.warn(`[time-machine] dashboard unavailable: ${errorMessage(error)}`);
      });
      return () => webServer.stop();
    }, "time-machine.web");
  }
  const checkpoints = /* @__PURE__ */ new Map();
  ctx.inject(["agents", "sessions"], (scope) => {
    scope.on("agent/pre-step", async ({ agent, turn, step }, next) => {
      if (!service.config.autoSnapshot || step !== 1) return next();
      const session = agent.session;
      const cwd = session.header.cwd ? import_node_path7.default.resolve(session.header.cwd) : workDir;
      if (cwd !== service.workDir) {
        scope.logger.warn(`[time-machine] skipped session ${session.id}: cwd ${cwd} differs from configured workspace ${service.workDir}`);
        return next();
      }
      const events = getEvents(session);
      const start = findLastEvent(events, (event) => event.type === "turn/start" && event.data.turn === turn);
      if (!start) {
        scope.logger.warn(`[time-machine] skipped turn ${turn}: turn/start event is unavailable`);
        return next();
      }
      try {
        const checkpoint = await service.createTurnCheckpoint({
          sessionId: session.id,
          turnIndex: turn,
          prompt: `DSH turn ${turn} (pre-execution boundary)`,
          summary: `Workspace before DSH turn ${turn}`,
          sessionState: {
            sessionId: session.id,
            messages: getMessages(session),
            ...start.seq > 0 ? { boundarySeq: start.seq - 1 } : {}
          },
          status: "running"
        });
        checkpoints.set(checkpointKey(session.id, turn), checkpoint.id);
      } catch (error) {
        scope.logger.error(`[time-machine] checkpoint for turn ${turn} failed: ${errorMessage(error)}`);
        throw error;
      }
      return next();
    }, { prepend: true });
    scope.on("session/event", (session, event) => {
      if (event.type !== "turn/end") return;
      const turn = event.data.turn;
      if (!Number.isSafeInteger(turn)) return;
      const key = checkpointKey(session.id, turn);
      const checkpointId = checkpoints.get(key);
      if (!checkpointId) return;
      checkpoints.delete(key);
      const reason = asRecord(event.data.reason);
      const kind = typeof reason?.kind === "string" ? reason.kind : "error";
      const failure = asRecord(reason?.error);
      const failedTools = collectFailedTools(getEvents(session), turn);
      void service.finalizeTurnCheckpoint({
        sessionId: session.id,
        checkpointId,
        status: kind === "completed" ? "success" : kind === "aborted" || kind === "interrupted" ? "aborted" : "failed",
        errorMessage: typeof failure?.message === "string" ? failure.message : kind === "completed" ? void 0 : `Turn ended: ${kind}`,
        failedTools: failedTools.length > 0 ? failedTools : void 0
      }).catch((error) => {
        scope.logger.error(`[time-machine] could not finalize ${checkpointId}: ${errorMessage(error)}`);
      });
    });
  });
  ctx.logger.info(import_picocolors2.default.green(`[${name}] active; restore mode=${service.config.restoreMode}`));
}
function collectFailedTools(events, turn) {
  const calls = /* @__PURE__ */ new Map();
  const failures = [];
  for (const event of events) {
    if (event.data.turn !== turn) continue;
    const data = event.data;
    if (event.type === "tool/call") {
      const callId2 = typeof data.callId === "string" ? data.callId : void 0;
      if (!callId2) continue;
      calls.set(callId2, { name: typeof data.name === "string" ? data.name : "unknown", input: parseToolArguments(data.arguments) });
      continue;
    }
    if (event.type !== "tool/result") continue;
    const message = asRecord(data.message);
    const error = asRecord(data.error);
    const content = Array.isArray(message?.content) ? asRecord(message.content[0]) : void 0;
    const isError = data.isError === true || message?.isError === true || content?.isError === true || error !== void 0;
    if (!isError) continue;
    const source = asRecord(message?.source);
    const callId = typeof message?.callId === "string" ? message.callId : typeof source?.callId === "string" ? source.callId : typeof content?.callId === "string" ? content.callId : void 0;
    const call = callId ? calls.get(callId) : void 0;
    const reason = typeof error?.reason === "string" ? error.reason : typeof error?.code === "string" ? error.code : "Tool returned an error result";
    failures.push({ toolName: call?.name ?? "unknown", input: call?.input ?? {}, error: reason });
  }
  return failures;
}
function getEvents(session) {
  return typeof session.snapshotEvents === "function" ? session.snapshotEvents() : session.events ?? [];
}
function getMessages(session) {
  if (typeof session.deriveMessages !== "function") return [];
  return session.deriveMessages().map((message) => message);
}
function findLastEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return void 0;
}
function checkpointKey(sessionId, turn) {
  return `${sessionId}\0${turn}`;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function parseToolArguments(value) {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
var TimeMachinePlugin = class {
  constructor(ctx, config = {}) {
    apply(ctx, config);
  }
};
var index_default = TimeMachinePlugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  DAGStateManager,
  FallbackSnapshotEngine,
  GitPlumbingEngine,
  QuarantineKeyError,
  QuarantineQuotaError,
  ReflectionAdvisor,
  RestorePlanError,
  SnapshotSizeError,
  StorageQuotaError,
  TimeMachinePlugin,
  TimeMachineService,
  UnsupportedWorkspaceStateError,
  WorkspaceDriftError,
  WorkspaceMergeConflictError,
  WorkspaceRestoreConflictError,
  apply,
  collectFailedTools,
  name
});
//# sourceMappingURL=index.cjs.map