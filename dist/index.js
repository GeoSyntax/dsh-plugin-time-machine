var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// node_modules/.pnpm/tsup@8.5.1_postcss@8.5.28_tsx@4.23.13_typescript@5.9.3/node_modules/tsup/assets/esm_shims.js
import path from "path";
import { fileURLToPath } from "url";
var init_esm_shims = __esm({
  "node_modules/.pnpm/tsup@8.5.1_postcss@8.5.28_tsx@4.23.13_typescript@5.9.3/node_modules/tsup/assets/esm_shims.js"() {
    "use strict";
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
import { execFile, spawn } from "child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { promisify } from "util";
import path2 from "path";
import fs from "fs/promises";
import zlib from "zlib";
async function sumFileSizes(files) {
  let total = 0;
  for (const file of files) total += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
  return total;
}
async function directoryBytes(root) {
  const rootStat = await fs.stat(root).catch(() => void 0);
  if (rootStat?.isFile()) return rootStat.size;
  let total = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const absolute = path2.join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(absolute);
    else total += (await fs.stat(absolute).catch(() => ({ size: 0 }))).size;
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
var execFileAsync, WorkspaceDriftError, UnsupportedWorkspaceStateError, WorkspaceRestoreConflictError, WorkspaceMergeConflictError, QuarantineQuotaError, QuarantineKeyError, SnapshotSizeError, GitPlumbingEngine;
var init_git_plumbing = __esm({
  "src/core/git-plumbing.ts"() {
    "use strict";
    init_esm_shims();
    execFileAsync = promisify(execFile);
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
      allowPartialSnapshots;
      quarantineKey;
      shadowReady;
      /** Last complete managed tree and the Git status signature that produced it. */
      workspaceTreeCache;
      constructor(options) {
        this.workDir = path2.resolve(options.workDir);
        this.refPrefix = options.refPrefix || "refs/dsh-tm";
        this.preservePaths = (options.preservePaths ?? []).map((item) => path2.resolve(this.workDir, item));
        this.quarantineDir = options.quarantineDir ? path2.resolve(options.quarantineDir) : void 0;
        this.shadowObjectDir = options.shadowObjectDir ? path2.resolve(options.shadowObjectDir) : void 0;
        this.maxQuarantineBytes = Math.max(0, Math.floor(options.maxQuarantineBytes ?? 0));
        this.maxSnapshotFileBytes = Math.max(0, Math.floor(options.maxSnapshotFileBytes ?? 0));
        this.maxSnapshotBytes = Math.max(0, Math.floor(options.maxSnapshotBytes ?? 0));
        this.allowPartialSnapshots = options.allowPartialSnapshots === true;
        this.quarantineKey = options.quarantineEncryptionKey ? createHash("sha256").update(options.quarantineEncryptionKey).digest() : void 0;
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
        this.repoRootCached = await fs.realpath(path2.resolve(stdout.trim())).catch(() => path2.resolve(stdout.trim()));
        this.preservePaths = await Promise.all(this.preservePaths.map(async (absolute) => await fs.realpath(absolute).catch(() => absolute)));
        return this.repoRootCached;
      }
      async getGitDir() {
        if (this.gitDirCached) return this.gitDirCached;
        const { stdout } = await this.runGit(["rev-parse", "--absolute-git-dir"]);
        this.gitDirCached = path2.resolve(stdout.trim());
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
        const root = await this.getRepoRoot();
        const status = await this.workspaceStatusSignature(root);
        const cached = status.cacheable && this.workspaceTreeCache?.signature === status.signature ? this.workspaceTreeCache.treeOid : void 0;
        const incrementalBase = !cached && !enforceSnapshotLimits && this.workspaceTreeCache?.treeOid && this.workspaceTreeCache.controlSignature === status.controlSignature && status.changedPaths.length > 0 ? this.workspaceTreeCache.treeOid : void 0;
        const treeResult = cached ? { treeOid: cached, indexFile: void 0, omittedPaths: [] } : await this.writeWorkspaceTree(enforceSnapshotLimits, [], incrementalBase, incrementalBase ? status.changedPaths : []);
        const { treeOid, indexFile } = treeResult;
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
          if (!cached) {
            const nextStatus = await this.workspaceStatusSignature(root);
            this.workspaceTreeCache = nextStatus.cacheable ? { treeOid, signature: nextStatus.signature, controlSignature: nextStatus.controlSignature } : void 0;
          }
          const changedFiles = (params.parentCommitOid ? await this.computeChangedFiles(params.parentCommitOid, commitOid) : await this.listTreeFiles(treeOid)).filter((change) => !treeResult.omittedPaths.includes(change.path));
          return {
            treeOid,
            commitOid,
            changedFiles,
            ignoredPaths: await this.listIgnoredPaths(),
            omittedPaths: treeResult.omittedPaths
          };
        } finally {
          if (indexFile) await fs.rm(indexFile, { force: true }).catch(() => void 0);
        }
      }
      /** Compute the current managed tree without publishing a commit or ref. */
      async inspectWorkspace(options = {}) {
        const { treeOid, indexFile } = await this.writeWorkspaceTree(false, options.omitPaths ?? []);
        try {
          return { treeOid, ignoredPaths: await this.listIgnoredPaths() };
        } finally {
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
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
          if (await fs.access(path2.join(gitDir, file)).then(() => true).catch(() => false)) return { headOid, branch, operation };
        }
        const rebaseDirs = [["rebase-merge", "rebase"], ["rebase-apply", "rebase"]];
        for (const [directory, operation] of rebaseDirs) {
          if (await fs.access(path2.join(gitDir, directory)).then(() => true).catch(() => false)) return { headOid, branch, operation };
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
        const sparseFile = await fs.access(path2.join(gitDir, "info", "sparse-checkout")).then(() => true).catch(() => false);
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
        const preservePaths = [...new Set((options.preservePaths ?? []).map(normalizeGitPath).filter(Boolean))];
        if (mode === "safe" && options.expectedCurrentTreeOid && current.treeOid !== options.expectedCurrentTreeOid) {
          const details = (await this.diffNameOnly(options.expectedCurrentTreeOid, current.treeOid)).filter((item) => !preservePaths.some((path9) => item === path9 || item.startsWith(`${path9}/`)));
          if (details.length) throw new WorkspaceDriftError(details);
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
            await fs.rm(absolute, { recursive: true, force: true });
            deletedIgnoredPaths.push(relative);
          }
        }
        const preserved = [.../* @__PURE__ */ new Set([...options.omittedPaths ?? [], ...preservePaths])];
        const omittedStash = preserved.length ? await this.stashWorkspacePaths(preserved) : void 0;
        const root = await this.getRepoRoot();
        const { indexFile } = await this.writeWorkspaceTree();
        try {
          const restoreArgs = this.shadowObjectDir ? ["read-tree", "--reset", restoreTree] : ["read-tree", "--reset", "-u", restoreTree];
          await this.runGit(restoreArgs, { GIT_INDEX_FILE: indexFile }, root);
          if (this.shadowObjectDir) {
            const currentFiles = await this.listTreeFileNames(current.treeOid);
            for (const entry of targetEntries) {
              const destination = await this.safeWorkspacePath(entry.path);
              await fs.mkdir(path2.dirname(destination), { recursive: true });
              await fs.rm(destination, { recursive: true, force: true });
              const content = await this.readShadowBlob(entry.oid, root);
              if (entry.mode === "120000") {
                await fs.symlink(content.toString("utf8"), destination);
              } else {
                await fs.writeFile(destination, content);
                await fs.chmod(destination, Number.parseInt(entry.mode, 8) & 511).catch(() => void 0);
              }
            }
            for (const relative of currentFiles.filter((file) => !targetFiles.has(file)).sort(longestFirst)) {
              await fs.rm(await this.safeWorkspacePath(relative), { recursive: true, force: true });
            }
          }
          if (omittedStash) await this.restoreStashedWorkspacePaths(omittedStash);
        } finally {
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
          if (omittedStash) await fs.rm(omittedStash.root, { recursive: true, force: true }).catch(() => void 0);
        }
        this.workspaceTreeCache = void 0;
        return { deletedIgnoredPaths, restoredTreeOid: restoreTree };
      }
      async stashWorkspacePaths(paths) {
        const root = path2.join(await this.getGitDir(), `dsh-tm-omitted-${randomUUID()}`);
        const entries = [];
        try {
          for (const relative of [...new Set(paths.map(normalizeGitPath).filter(Boolean))]) {
            const source = await this.safeWorkspacePath(relative);
            const stat = await fs.lstat(source).catch(() => void 0);
            if (!stat) continue;
            const destination = path2.join(root, ...relative.split("/"));
            await fs.mkdir(path2.dirname(destination), { recursive: true });
            await fs.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
            entries.push(relative);
          }
          return { root, entries };
        } catch (error) {
          await fs.rm(root, { recursive: true, force: true }).catch(() => void 0);
          throw error;
        }
      }
      async restoreStashedWorkspacePaths(stash) {
        for (const relative of stash.entries) {
          const source = path2.join(stash.root, ...relative.split("/"));
          const destination = await this.safeWorkspacePath(relative);
          await fs.mkdir(path2.dirname(destination), { recursive: true });
          await fs.rm(destination, { recursive: true, force: true });
          await fs.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
        }
      }
      async mergeWorkspaceTree(baseTree, targetTree, currentTree) {
        if (!baseTree) throw new Error("Merge restore requires the active checkpoint tree.");
        const indexFile = path2.join(await this.getGitDir(), `dsh-tm-merge-index-${randomUUID()}`);
        try {
          await this.runGit(["read-tree", "-m", baseTree, targetTree, currentTree], { GIT_INDEX_FILE: indexFile });
          const { stdout: conflicts } = await this.runGit(["ls-files", "-u", "-z"], { GIT_INDEX_FILE: indexFile });
          const paths = [...new Set(conflicts.split("\0").filter(Boolean).map((entry) => normalizeGitPath(entry.slice(entry.indexOf("	") + 1))))];
          if (paths.length) throw new WorkspaceMergeConflictError(paths);
          const { stdout } = await this.runGit(["write-tree"], { GIT_INDEX_FILE: indexFile });
          return stdout.trim();
        } finally {
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
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
        const ignoredSelection = current.ignoredPaths.filter((file) => normalized.some((path9) => file === path9 || file.startsWith(`${path9}/`)));
        if (ignoredSelection.length) throw new WorkspaceRestoreConflictError(ignoredSelection);
        if (mode === "safe" && options.expectedCurrentTreeOid && current.treeOid !== options.expectedCurrentTreeOid) {
          const changed = await this.diffNameOnly(options.expectedCurrentTreeOid, current.treeOid);
          const selectedDrift = changed.filter((file) => normalized.some((path9) => file === path9 || file.startsWith(`${path9}/`)));
          if (selectedDrift.length) throw new WorkspaceDriftError(selectedDrift);
        }
        const { stdout: treeStdout } = await this.runGit(["rev-parse", `${commitOrTreeOid}^{tree}`]);
        const targetTree = treeStdout.trim();
        const targetFiles = await this.listTreeFileNames(targetTree);
        const currentFiles = await this.listTreeFileNames(current.treeOid);
        const selectedTargetFiles = targetFiles.filter((file) => normalized.some((path9) => file === path9 || file.startsWith(`${path9}/`)));
        const selectedCurrentFiles = currentFiles.filter((file) => normalized.some((path9) => file === path9 || file.startsWith(`${path9}/`)));
        if (selectedTargetFiles.length === 0 && selectedCurrentFiles.length === 0) {
          throw new Error(`None of the selected paths exist in the current or target snapshot: ${normalized.join(", ")}`);
        }
        const exportDir = path2.join(await fs.mkdtemp(path2.join(await fs.mkdtemp(path2.join(this.workDir, ".dsh-tm-export-")), "snapshot-")));
        const indexFile = path2.join(await this.getGitDir(), `dsh-tm-index-${randomUUID()}`);
        try {
          await fs.mkdir(exportDir, { recursive: true });
          await this.runGit(["read-tree", targetTree], { GIT_INDEX_FILE: indexFile });
          await this.runGit(["checkout-index", "--all", `--prefix=${exportDir}${path2.sep}`], { GIT_INDEX_FILE: indexFile });
          const targetSet = new Set(selectedTargetFiles);
          for (const relative of selectedCurrentFiles) {
            if (targetSet.has(relative)) continue;
            await fs.rm(await this.safeWorkspacePath(relative), { recursive: true, force: true });
          }
          for (const relative of selectedTargetFiles) {
            const source = path2.join(exportDir, ...relative.split("/"));
            const destination = await this.safeWorkspacePath(relative);
            await fs.mkdir(path2.dirname(destination), { recursive: true });
            await fs.rm(destination, { recursive: true, force: true });
            await fs.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
          }
          this.workspaceTreeCache = void 0;
          return normalized;
        } finally {
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
          await fs.rm(path2.dirname(exportDir), { recursive: true, force: true }).catch(() => void 0);
        }
      }
      /** Restore quarantined ignored content without ever writing it into Git objects. */
      async restoreIgnoredBackup(key) {
        if (!this.quarantineDir) return;
        const backupRoot = path2.join(this.quarantineDir, encodeRefPart(key));
        const encryptedManifest = await fs.readFile(path2.join(backupRoot, ".manifest.json"), "utf8").then((raw) => JSON.parse(raw)).catch((error) => {
          if (error?.code === "ENOENT") return void 0;
          throw new QuarantineKeyError(`Encrypted quarantine manifest is invalid: ${error?.message ?? "unknown error"}`);
        });
        if (encryptedManifest) {
          if (!this.quarantineKey) throw new QuarantineKeyError("Encrypted quarantine requires the configured key.");
          if (encryptedManifest.version !== 1 || !Array.isArray(encryptedManifest.entries)) throw new QuarantineKeyError("Encrypted quarantine manifest version is unsupported.");
          const directories = encryptedManifest.entries.filter((entry) => entry.type === "directory").sort((a, b) => a.path.localeCompare(b.path));
          for (const entry of directories) {
            const destination = await this.safeWorkspacePath(entry.path);
            await fs.mkdir(destination, { recursive: true, mode: entry.mode });
          }
          for (const entry of encryptedManifest.entries.filter((item) => item.type !== "directory")) {
            const destination = await this.safeWorkspacePath(entry.path);
            await fs.mkdir(path2.dirname(destination), { recursive: true });
            await fs.rm(destination, { recursive: true, force: true });
            if (entry.type === "symlink") {
              await fs.symlink(entry.linkTarget, destination);
              continue;
            }
            if (!entry.payload || !entry.nonce) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is incomplete.`);
            const encrypted = await fs.readFile(path2.join(backupRoot, entry.payload));
            if (encrypted.length < 16) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is corrupt.`);
            let plaintext;
            try {
              const decipher = createDecipheriv("aes-256-gcm", this.quarantineKey, Buffer.from(entry.nonce, "base64url"));
              decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
              plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
            } catch {
              throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' failed authentication.`);
            }
            await fs.writeFile(destination, plaintext);
            await fs.chmod(destination, entry.mode).catch(() => void 0);
          }
          return;
        }
        if (this.quarantineKey) {
          const plaintextEntries = await fs.readdir(backupRoot).catch((error) => {
            if (error?.code === "ENOENT") return [];
            throw error;
          });
          if (plaintextEntries.length) {
            throw new QuarantineKeyError("Plaintext quarantine exists; explicit encryption migration is required.");
          }
        }
        const root = await this.getRepoRoot();
        const entries = await fs.readdir(backupRoot, { withFileTypes: true }).catch((error) => {
          if (error?.code === "ENOENT") return [];
          throw error;
        });
        for (const entry of entries) {
          const source = path2.join(backupRoot, entry.name);
          const destination = path2.join(root, entry.name);
          await fs.cp(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
        }
      }
      /** Validate encrypted quarantine content before a restore mutates the workspace. */
      async validateIgnoredBackup(key) {
        if (!this.quarantineDir) return;
        const backupRoot = path2.join(this.quarantineDir, encodeRefPart(key));
        const manifest = await fs.readFile(path2.join(backupRoot, ".manifest.json"), "utf8").then((raw) => JSON.parse(raw)).catch((error) => {
          if (error?.code === "ENOENT") return void 0;
          throw new QuarantineKeyError(`Encrypted quarantine manifest is invalid: ${error?.message ?? "unknown error"}`);
        });
        if (!manifest) {
          if (this.quarantineKey) {
            const plaintextEntries = await fs.readdir(backupRoot).catch((error) => {
              if (error?.code === "ENOENT") return [];
              throw error;
            });
            if (plaintextEntries.length) {
              throw new QuarantineKeyError("Plaintext quarantine exists; explicit encryption migration is required.");
            }
          }
          return;
        }
        if (!this.quarantineKey) throw new QuarantineKeyError("Encrypted quarantine requires the configured key.");
        if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new QuarantineKeyError("Encrypted quarantine manifest version is unsupported.");
        for (const entry of manifest.entries.filter((item) => item.type === "file")) {
          if (!entry.payload || !entry.nonce) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is incomplete.`);
          const encrypted = await fs.readFile(path2.join(backupRoot, entry.payload));
          if (encrypted.length < 16) throw new QuarantineKeyError(`Encrypted quarantine entry '${entry.path}' is corrupt.`);
          try {
            const decipher = createDecipheriv("aes-256-gcm", this.quarantineKey, Buffer.from(entry.nonce, "base64url"));
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
        const backupRoot = path2.join(this.quarantineDir, encodeRefPart(key));
        const reclaimed = await directoryBytes(backupRoot);
        await fs.rm(backupRoot, { recursive: true, force: true });
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
          const child = spawn("git", args, { cwd, env: this.gitEnv(extraEnv), windowsHide: true });
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
          const loose = path2.join(this.shadowObjectDir, oid.slice(0, 2), oid.slice(2));
          const compressed = await fs.readFile(loose).catch(() => void 0);
          if (compressed) {
            try {
              const inflated = zlib.inflateSync(compressed);
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
          const primaryObjects = path2.join(this.gitDirCached ?? path2.join(this.workDir, ".git"), "objects");
          env.GIT_ALTERNATE_OBJECT_DIRECTORIES = [primaryObjects, env.GIT_ALTERNATE_OBJECT_DIRECTORIES].filter(Boolean).map((item) => item.replace(/\\/g, "/")).join(path2.delimiter);
        }
        return env;
      }
      async writeWorkspaceTree(enforceSnapshotLimits = false, extraOmittedPaths = [], baseTreeOid, changedPaths = []) {
        const root = await this.getRepoRoot();
        const indexFile = path2.join(await this.getGitDir(), `dsh-tm-index-${randomUUID()}`);
        const env = { GIT_INDEX_FILE: indexFile };
        try {
          try {
            await this.runGit(["read-tree", baseTreeOid ?? "HEAD"], env, root);
          } catch {
            await this.runGit(["read-tree", "--empty"], env, root);
          }
          const protectedPaths = this.protectedRepoPaths(root);
          let omittedPaths = [...new Set(extraOmittedPaths.map(normalizeGitPath).filter(Boolean))];
          for (const relative of omittedPaths) await this.safeWorkspacePath(relative);
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
            omittedPaths = await this.assertSnapshotSize(root, candidateFiles);
            const filesToIndex = candidateFiles.filter((file) => !omittedPaths.includes(file));
            for (let offset = 0; offset < filesToIndex.length; offset += 128) {
              await this.runGit(["add", "-A", "--", ...filesToIndex.slice(offset, offset + 128)], env, root);
            }
          } else if (changedPaths.length > 0) {
            const paths = changedPaths.map(normalizeGitPath).filter(Boolean).filter((file) => !protectedPaths.some(
              (protectedPath) => file === protectedPath || file.startsWith(`${protectedPath}/`)
            ));
            for (let offset = 0; offset < paths.length; offset += 128) {
              await this.runGit(["add", "-A", "--", ...paths.slice(offset, offset + 128)], env, root);
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
          for (let offset = 0; offset < omittedPaths.length; offset += 128) {
            await this.runGit(["update-index", "--force-remove", "--", ...omittedPaths.slice(offset, offset + 128)], env, root);
          }
          const { stdout } = await this.runGit(["write-tree"], env, root);
          return { treeOid: stdout.trim(), indexFile, omittedPaths };
        } catch (error) {
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
          throw error;
        }
      }
      /**
       * Cheap-enough complete workspace identity used to skip a redundant tree
       * write only for a fully clean worktree. Porcelain-v2 includes staged,
       * unstaged, untracked and branch-head state, but an untracked path entry does
       * not contain its content hash; therefore any file entry disables reuse.
       * Ignored paths are intentionally handled separately by listIgnoredPaths().
       */
      async workspaceStatusSignature(root) {
        const { stdout } = await this.runGit([
          "status",
          "--porcelain=v2",
          "--branch",
          "--untracked-files=all",
          "-z"
        ], {}, root);
        const allEntries = stdout.split("\0").filter(Boolean);
        const controlSignature = allEntries.filter((item) => item.startsWith("# branch.")).join("\0");
        const entries = allEntries.filter((item) => !item.startsWith("# "));
        const changedPaths = entries.flatMap((item) => {
          const tab = item.indexOf("	");
          let raw;
          if (tab >= 0) raw = item.slice(tab + 1);
          else if (item.startsWith("? ")) raw = item.slice(2);
          else if (item.startsWith("1 ")) raw = item.split(" ").slice(8).join(" ");
          else if (item.startsWith("2 ")) raw = item.split(" ").slice(9).join(" ");
          else if (item.startsWith("u ")) raw = item.split(" ").slice(10).join(" ");
          else raw = item.slice(2).trimStart();
          const pathPart = raw.split("\0", 1)[0]?.trim();
          return pathPart ? [normalizeGitPath(pathPart)] : [];
        });
        return { signature: stdout, controlSignature, cacheable: entries.length === 0, changedPaths };
      }
      async assertSnapshotSize(root, files) {
        if (this.maxSnapshotFileBytes <= 0 && this.maxSnapshotBytes <= 0) return [];
        let totalBytes = 0;
        const omitted = [];
        for (const relative of files) {
          const stat = await fs.lstat(path2.join(root, ...relative.split("/"))).catch(() => void 0);
          if (!stat?.isFile()) continue;
          if (this.maxSnapshotFileBytes > 0 && stat.size > this.maxSnapshotFileBytes) {
            if (this.allowPartialSnapshots) {
              omitted.push(relative);
              continue;
            }
            throw new SnapshotSizeError({ file: relative, fileBytes: stat.size, limitBytes: this.maxSnapshotFileBytes });
          }
          if (this.maxSnapshotBytes > 0 && totalBytes + stat.size > this.maxSnapshotBytes) {
            if (this.allowPartialSnapshots) {
              omitted.push(relative);
              continue;
            }
            throw new SnapshotSizeError({ totalBytes, limitBytes: this.maxSnapshotBytes });
          }
          totalBytes += stat.size;
        }
        return omitted;
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
          const relative = normalizeGitPath(path2.relative(repoRoot, absolute));
          return relative && relative !== ".." && !relative.startsWith("../") ? [relative] : [];
        });
      }
      isPreservedRelative(relative) {
        const normalized = normalizeGitPath(relative);
        const repoRoot = this.repoRootCached ?? this.workDir;
        return this.preservePaths.some((absolute) => {
          const candidate = normalizeGitPath(path2.relative(repoRoot, absolute));
          return candidate === normalized || normalized.startsWith(`${candidate}/`);
        });
      }
      async safeWorkspacePath(relative) {
        const root = await this.getRepoRoot();
        const absolute = path2.resolve(root, relative);
        const relation = path2.relative(root, absolute);
        if (!relation || relation === ".." || relation.startsWith(`..${path2.sep}`) || path2.isAbsolute(relation)) {
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
        const destination = path2.join(this.quarantineDir, encodeRefPart(key), ...relative.split("/"));
        if (this.maxQuarantineBytes > 0) {
          const currentBytes = await directoryBytes(this.quarantineDir);
          const incomingBytes = await directoryBytes(absolute);
          const existingBytes = await directoryBytes(path2.dirname(destination));
          const requiredBytes = currentBytes - existingBytes + incomingBytes;
          if (requiredBytes > this.maxQuarantineBytes) throw new QuarantineQuotaError(this.maxQuarantineBytes, requiredBytes);
        }
        await fs.mkdir(path2.dirname(destination), { recursive: true });
        await fs.cp(absolute, destination, { recursive: true, force: true, verbatimSymlinks: true });
      }
      async backupIgnoredPathEncrypted(key, relative, absolute) {
        const root = path2.join(this.quarantineDir, encodeRefPart(key));
        const manifestPath = path2.join(root, ".manifest.json");
        const existing = await fs.readFile(manifestPath, "utf8").then((raw) => JSON.parse(raw)).catch(async (error) => {
          if (error?.code === "ENOENT") {
            const entries = await fs.readdir(root).catch(() => []);
            if (entries.length) throw new QuarantineKeyError("Plaintext quarantine exists; refusing to mix it with encrypted backups.");
            return { version: 1, entries: [] };
          }
          throw new QuarantineKeyError(`Encrypted quarantine manifest is invalid: ${error?.message ?? "unknown error"}`);
        });
        if (existing.version !== 1 || !Array.isArray(existing.entries)) throw new QuarantineKeyError("Encrypted quarantine manifest version is unsupported.");
        const staging = path2.join(root, `.staging-${randomUUID()}`);
        const payloadDir = path2.join(staging, "payload");
        await fs.mkdir(payloadDir, { recursive: true });
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
          await fs.mkdir(path2.join(root, "payload"), { recursive: true });
          for (const entry of added) {
            const source = path2.join(payloadDir, entry.payload);
            const destination = path2.join(root, "payload", entry.payload);
            await fs.rename(source, destination);
            entry.payload = path2.posix.join("payload", entry.payload);
          }
          await fs.rm(staging, { recursive: true, force: true });
          const next = { version: 1, entries: [...existing.entries, ...added] };
          const temporaryManifest = `${manifestPath}.${randomUUID()}.tmp`;
          await fs.writeFile(temporaryManifest, `${JSON.stringify(next, null, 2)}
`, "utf8");
          await fs.rename(temporaryManifest, manifestPath);
        } catch (error) {
          await fs.rm(staging, { recursive: true, force: true }).catch(() => void 0);
          throw error;
        }
      }
      /** Explicitly convert one legacy plaintext quarantine into encrypted form. */
      async migrateIgnoredBackup(key) {
        if (!this.quarantineDir) throw new Error("Ignored-path migration requires a quarantineDir.");
        if (!this.quarantineKey) throw new QuarantineKeyError("Encrypted quarantine migration requires the configured key.");
        const root = path2.join(this.quarantineDir, encodeRefPart(key));
        const manifestPath = path2.join(root, ".manifest.json");
        const existingManifest = await fs.readFile(manifestPath, "utf8").then((raw) => JSON.parse(raw)).catch((error) => {
          if (error?.code === "ENOENT") return void 0;
          throw new QuarantineKeyError(`Encrypted quarantine manifest is invalid: ${error?.message ?? "unknown error"}`);
        });
        if (existingManifest) {
          if (existingManifest.version !== 1 || !Array.isArray(existingManifest.entries)) {
            throw new QuarantineKeyError("Encrypted quarantine manifest version is unsupported.");
          }
          return { migrated: false, bytesRewritten: 0, entryCount: existingManifest.entries.length };
        }
        const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
          if (error?.code === "ENOENT") return [];
          throw error;
        });
        if (entries.length === 0) return { migrated: false, bytesRewritten: 0, entryCount: 0 };
        const legacyRoot = `${root}.legacy-${randomUUID()}`;
        const stagingRoot = path2.join(path2.dirname(root), `.migration-${randomUUID()}`);
        const payloadDir = path2.join(stagingRoot, "payload");
        await fs.rename(root, legacyRoot);
        try {
          await fs.mkdir(payloadDir, { recursive: true });
          const encryptedEntries = [];
          for (const entry of entries) {
            await this.collectEncryptedQuarantineEntries(path2.join(legacyRoot, entry.name), entry.name, payloadDir, encryptedEntries);
          }
          const manifest = { version: 1, entries: encryptedEntries };
          const manifestBytes = Buffer.byteLength(JSON.stringify(manifest));
          const stagedBytes = await directoryBytes(stagingRoot);
          const legacyBytes = await directoryBytes(legacyRoot);
          const currentBytes = await directoryBytes(this.quarantineDir);
          const requiredBytes = currentBytes - legacyBytes + stagedBytes + manifestBytes;
          if (this.maxQuarantineBytes > 0 && requiredBytes > this.maxQuarantineBytes) {
            throw new QuarantineQuotaError(this.maxQuarantineBytes, requiredBytes);
          }
          await fs.mkdir(path2.join(root, "payload"), { recursive: true });
          for (const entry of encryptedEntries) {
            const source = path2.join(payloadDir, entry.payload);
            const destination = path2.join(root, "payload", entry.payload);
            await fs.rename(source, destination);
            entry.payload = path2.posix.join("payload", entry.payload);
          }
          await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
          const rewrittenBytes = await directoryBytes(root);
          await fs.rm(stagingRoot, { recursive: true, force: true });
          await fs.rm(legacyRoot, { recursive: true, force: true });
          return { migrated: true, bytesRewritten: rewrittenBytes, entryCount: encryptedEntries.length };
        } catch (error) {
          await fs.rm(root, { recursive: true, force: true }).catch(() => void 0);
          await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => void 0);
          await fs.rename(legacyRoot, root).catch(() => void 0);
          throw error;
        }
      }
      async collectEncryptedQuarantineEntries(source, relative, payloadDir, output) {
        const stat = await fs.lstat(source);
        if (stat.isDirectory()) {
          output.push({ path: normalizeGitPath(relative), type: "directory", mode: stat.mode & 511 });
          for (const child of await fs.readdir(source)) {
            await this.collectEncryptedQuarantineEntries(path2.join(source, child), path2.posix.join(relative, child), payloadDir, output);
          }
          return;
        }
        if (stat.isSymbolicLink()) {
          output.push({ path: normalizeGitPath(relative), type: "symlink", mode: stat.mode & 511, linkTarget: await fs.readlink(source) });
          return;
        }
        if (!stat.isFile()) throw new QuarantineKeyError(`Unsupported ignored backup entry: ${relative}`);
        const plaintext = await fs.readFile(source);
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.quarantineKey, nonce);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        const payload = randomUUID();
        await fs.writeFile(path2.join(payloadDir, payload), Buffer.concat([ciphertext, tag]));
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
        const entries = await fs.readdir(this.shadowObjectDir, { withFileTypes: true }).catch(() => []);
        let packedObjectsSkipped = false;
        for (const entry of entries) {
          if (entry.name === "pack" && entry.isDirectory()) {
            packedObjectsSkipped = (await fs.readdir(path2.join(this.shadowObjectDir, entry.name)).catch(() => [])).length > 0;
            continue;
          }
          if (!entry.isDirectory() || !/^[0-9a-f]{2}$/.test(entry.name)) continue;
          const directory = path2.join(this.shadowObjectDir, entry.name);
          for (const object of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
            if (!object.isFile() || !/^[0-9a-f]{38}$/.test(object.name)) continue;
            const oid = `${entry.name}${object.name}`;
            if (reachable.has(oid)) continue;
            const file = path2.join(directory, object.name);
            reclaimedBytes += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
            await fs.rm(file, { force: true });
            removedObjects += 1;
          }
          await fs.rmdir(directory).catch(() => void 0);
        }
        return { removedObjects, reclaimedBytes, packedObjectsSkipped };
      }
      /** Rebuild only the opt-in shadow pack from the plugin's private refs. */
      async repackShadowObjects() {
        if (!this.shadowObjectDir) return { repacked: false, removedPackFiles: 0, reclaimedBytes: 0, reachableRefs: 0 };
        const { stdout: refsOutput } = await this.runGit(["for-each-ref", "--format=%(objectname)", this.refPrefix]).catch(() => ({ stdout: "", stderr: "" }));
        const refs = refsOutput.split("\n").map((item) => item.trim()).filter((item) => /^[0-9a-f]{40}$/.test(item));
        const packDir = path2.join(this.shadowObjectDir, "pack");
        const existing = await fs.readdir(packDir, { withFileTypes: true }).catch(() => []);
        const existingPackFiles = existing.filter((entry) => entry.isFile() && /^pack-[0-9a-f]{40}\.(pack|idx|bitmap|rev|mtimes)$/.test(entry.name));
        const lockedPack = existing.some((entry) => entry.isFile() && /^pack-[0-9a-f]{40}\.keep$/.test(entry.name));
        if (lockedPack) return { repacked: false, removedPackFiles: 0, reclaimedBytes: 0, reachableRefs: refs.length, skippedReason: "shadow pack contains a .keep file" };
        const existingBytes = await sumFileSizes(existingPackFiles.map((entry) => path2.join(packDir, entry.name)));
        const tempDir = path2.join(this.shadowObjectDir, `.repack-${randomUUID()}`);
        await fs.mkdir(tempDir, { recursive: true });
        let generatedFiles = [];
        try {
          if (refs.length) {
            const prefix = path2.join(tempDir, "pack");
            await this.runGitInput(["pack-objects", "--revs", "--no-reuse-object", "--delta-base-offset", prefix], `${refs.join("\n")}
`);
            generatedFiles = (await fs.readdir(tempDir, { withFileTypes: true })).filter((entry) => entry.isFile() && /^(pack-[0-9a-f]{40})\.(pack|idx)$/.test(entry.name)).map((entry) => entry.name);
          }
          await fs.mkdir(packDir, { recursive: true });
          for (const file of generatedFiles) {
            const destination = path2.join(packDir, file);
            const source = path2.join(tempDir, file);
            const alreadyPresent = await fs.access(destination).then(() => true).catch(() => false);
            if (alreadyPresent) await fs.rm(source, { force: true });
            else await fs.rename(source, destination);
          }
          const keep = new Set(generatedFiles);
          let removedPackFiles = 0;
          let reclaimedBytes = 0;
          for (const entry of existingPackFiles) {
            if (keep.has(entry.name)) continue;
            const file = path2.join(packDir, entry.name);
            reclaimedBytes += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
            await fs.rm(file, { force: true });
            removedPackFiles += 1;
          }
          await fs.rm(path2.join(this.shadowObjectDir, "info", "packs"), { force: true }).catch(() => void 0);
          return {
            repacked: refs.length > 0 && generatedFiles.length > 0,
            removedPackFiles,
            reclaimedBytes: Math.max(reclaimedBytes, existingBytes - await sumFileSizes(generatedFiles.map((file) => path2.join(packDir, file)))),
            reachableRefs: refs.length
          };
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => void 0);
        }
      }
      async ensureShadowStore() {
        if (!this.shadowObjectDir) return;
        this.shadowReady ??= fs.mkdir(this.shadowObjectDir, { recursive: true }).then(() => void 0);
        await this.shadowReady;
      }
      async runGitInput(args, input, cwd = this.workDir) {
        await this.ensureShadowStore();
        const env = this.gitEnv({});
        return await new Promise((resolve, reject) => {
          const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
init_esm_shims();
import path8 from "path";
import Schema from "@deepseek-ai/schemastery";
import pc2 from "picocolors";

// src/service.ts
init_esm_shims();
init_git_plumbing();
import path6 from "path";
import fs5 from "fs/promises";
import { createHash as createHash3, randomUUID as randomUUID5 } from "crypto";

// src/core/fallback-engine.ts
init_esm_shims();
init_git_plumbing();
import { createHash as createHash2, randomUUID as randomUUID2 } from "crypto";
import path3 from "path";
import fs2 from "fs/promises";
var FallbackSnapshotEngine = class {
  workDir;
  storageDir;
  preservePaths;
  maxSnapshotFileBytes;
  maxSnapshotBytes;
  constructor(options) {
    this.workDir = path3.resolve(options.workDir);
    this.storageDir = path3.resolve(options.storageDir);
    this.preservePaths = [this.storageDir, ...(options.preservePaths ?? []).map((item) => path3.resolve(this.workDir, item))];
    this.maxSnapshotFileBytes = Math.max(0, Math.floor(options.maxSnapshotFileBytes ?? 0));
    this.maxSnapshotBytes = Math.max(0, Math.floor(options.maxSnapshotBytes ?? 0));
  }
  getCheckpointDir(sessionId, checkpointId) {
    const sessionKey = Buffer.from(sessionId, "utf8").toString("base64url") || "_";
    const checkpointKey2 = Buffer.from(checkpointId, "utf8").toString("base64url") || "_";
    return path3.join(this.storageDir, sessionKey, checkpointKey2);
  }
  async createSnapshot(params) {
    const targetDir = this.getCheckpointDir(params.sessionId, params.checkpointId);
    const temporary = `${targetDir}.${randomUUID2()}.tmp`;
    const filesDir = path3.join(temporary, "files");
    await fs2.mkdir(filesDir, { recursive: true });
    try {
      const plannedEntries = await this.scanTree(this.workDir);
      await this.assertSnapshotSize(plannedEntries);
      const entries = await this.captureTree(this.workDir, filesDir, plannedEntries);
      const treeOid = await hashSnapshot(filesDir, entries);
      const manifest = { version: 1, entries, treeOid };
      await fs2.writeFile(path3.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}
`, "utf8");
      await fs2.mkdir(path3.dirname(targetDir), { recursive: true });
      await fs2.rename(temporary, targetDir);
      return {
        treeOid: `fallback_${treeOid}`,
        commitOid: `fallback_${treeOid}`,
        changedFiles: entries.filter((entry) => entry.type !== "directory").map((entry) => ({ path: entry.path, status: "modified" }))
      };
    } catch (error) {
      await fs2.rm(temporary, { recursive: true, force: true }).catch(() => void 0);
      throw error;
    }
  }
  async inspectWorkspace() {
    const entries = await this.scanTree(this.workDir);
    return `fallback_${await hashSnapshot(this.workDir, entries)}`;
  }
  async restoreSnapshot(sessionId, checkpointId) {
    const snapshotDir = this.getCheckpointDir(sessionId, checkpointId);
    const raw = await fs2.readFile(path3.join(snapshotDir, "manifest.json"), "utf8").catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`Fallback snapshot '${checkpointId}' is missing or uses an unsupported legacy format.`);
      throw error;
    });
    const manifest = parseManifest(raw);
    const filesDir = path3.join(snapshotDir, "files");
    const targetPaths = new Set(manifest.entries.map((entry) => entry.path));
    const currentEntries = await this.scanTree(this.workDir);
    for (const entry of currentEntries.sort(deepestFirst)) {
      if (targetPaths.has(entry.path)) continue;
      await fs2.rm(this.resolveSafe(entry.path), { recursive: true, force: true });
    }
    for (const entry of manifest.entries.filter((item) => item.type === "directory").sort(shallowestFirst)) {
      const destination = this.resolveSafe(entry.path);
      const stat = await fs2.lstat(destination).catch(() => void 0);
      if (stat && !stat.isDirectory()) await fs2.rm(destination, { recursive: true, force: true });
      await fs2.mkdir(destination, { recursive: true, mode: entry.mode });
    }
    for (const entry of manifest.entries.filter((item) => item.type !== "directory")) {
      const destination = this.resolveSafe(entry.path);
      await fs2.mkdir(path3.dirname(destination), { recursive: true });
      await fs2.rm(destination, { recursive: true, force: true });
      if (entry.type === "file") {
        await fs2.copyFile(path3.join(filesDir, ...entry.path.split("/")), destination);
        await fs2.chmod(destination, entry.mode).catch(() => void 0);
      } else {
        await fs2.symlink(entry.linkTarget, destination);
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
    const raw = await fs2.readFile(path3.join(snapshotDir, "manifest.json"), "utf8");
    const manifest = parseManifest(raw);
    const filesDir = path3.join(snapshotDir, "files");
    const selected = (entry) => normalized.some((item) => entry.path === item || entry.path.startsWith(`${item}/`));
    const currentEntries = (await this.scanTree(this.workDir)).filter(selected).sort(deepestFirst);
    const targetEntries = manifest.entries.filter(selected);
    if (currentEntries.length === 0 && targetEntries.length === 0) {
      throw new Error(`None of the selected paths exist in the current or target snapshot: ${normalized.join(", ")}`);
    }
    const targetPaths = new Set(targetEntries.map((entry) => entry.path));
    for (const entry of currentEntries) {
      if (!targetPaths.has(entry.path)) await fs2.rm(this.resolveSafe(entry.path), { recursive: true, force: true });
    }
    for (const entry of targetEntries.filter((item) => item.type === "directory").sort(shallowestFirst)) {
      const destination = this.resolveSafe(entry.path);
      await fs2.mkdir(destination, { recursive: true, mode: entry.mode });
    }
    for (const entry of targetEntries.filter((item) => item.type !== "directory")) {
      const destination = this.resolveSafe(entry.path);
      await fs2.mkdir(path3.dirname(destination), { recursive: true });
      await fs2.rm(destination, { recursive: true, force: true });
      if (entry.type === "file") {
        await fs2.copyFile(path3.join(filesDir, ...entry.path.split("/")), destination);
        await fs2.chmod(destination, entry.mode).catch(() => void 0);
      } else {
        await fs2.symlink(entry.linkTarget, destination);
      }
    }
    return normalized;
  }
  async removeSnapshot(sessionId, checkpointId) {
    const target = this.getCheckpointDir(sessionId, checkpointId);
    const before = await directorySize(target);
    await fs2.rm(target, { recursive: true, force: true });
    return before;
  }
  async captureTree(sourceRoot, destinationRoot, plannedEntries) {
    const entries = plannedEntries ?? await this.scanTree(sourceRoot);
    for (const entry of entries) {
      const source = path3.join(sourceRoot, ...entry.path.split("/"));
      const destination = path3.join(destinationRoot, ...entry.path.split("/"));
      if (entry.type === "directory") {
        await fs2.mkdir(destination, { recursive: true, mode: entry.mode });
      } else if (entry.type === "file") {
        await fs2.mkdir(path3.dirname(destination), { recursive: true });
        await fs2.copyFile(source, destination);
      }
    }
    return entries;
  }
  async assertSnapshotSize(entries) {
    if (this.maxSnapshotFileBytes <= 0 && this.maxSnapshotBytes <= 0) return;
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.type !== "file") continue;
      const stat = await fs2.stat(path3.join(this.workDir, ...entry.path.split("/")));
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
      for (const dirent of await fs2.readdir(directory, { withFileTypes: true })) {
        const absolute = path3.join(directory, dirent.name);
        if (this.isPreserved(absolute)) continue;
        const childRelative = relative ? `${relative}/${dirent.name}` : dirent.name;
        validateRelativePath(childRelative);
        const stat = await fs2.lstat(absolute);
        const mode = stat.mode & 511;
        if (stat.isSymbolicLink()) {
          entries.push({ path: childRelative, type: "symlink", mode, linkTarget: await fs2.readlink(absolute) });
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
    const resolved = path3.resolve(absolute);
    return this.preservePaths.some((base) => resolved === base || resolved.startsWith(`${base}${path3.sep}`));
  }
  resolveSafe(relative) {
    validateRelativePath(relative);
    const absolute = path3.resolve(this.workDir, ...relative.split("/"));
    const relation = path3.relative(this.workDir, absolute);
    if (!relation || relation === ".." || relation.startsWith(`..${path3.sep}`) || path3.isAbsolute(relation)) {
      throw new Error(`Unsafe snapshot path '${relative}'.`);
    }
    if (this.isPreserved(absolute)) throw new Error(`Snapshot path overlaps protected storage: '${relative}'.`);
    return absolute;
  }
};
async function hashSnapshot(root, entries) {
  const hash = createHash2("sha256");
  for (const entry of entries) {
    hash.update(`${entry.type}\0${entry.path}\0${entry.mode}\0${entry.linkTarget ?? ""}\0`);
    if (entry.type === "file") hash.update(await fs2.readFile(path3.join(root, ...entry.path.split("/"))));
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
  if (!value || value.includes("\0") || value.includes("\\") || path3.posix.isAbsolute(value) || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
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
    for (const entry of await fs2.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path3.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += (await fs2.stat(absolute).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}

// src/core/dag-manager.ts
init_esm_shims();
import path4 from "path";
import fs3 from "fs/promises";
import { randomUUID as randomUUID3 } from "crypto";
import pc from "picocolors";
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
    this.storageFile = path4.join(options.storageDir, `dag_${safeSessionKey}.json`);
  }
  /**
   * 初始化并尝试从本地恢复树结构
   */
  async init() {
    try {
      const content = await fs3.readFile(this.storageFile, "utf-8");
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
    await fs3.mkdir(path4.dirname(this.storageFile), { recursive: true });
    const temporary = `${this.storageFile}.${randomUUID3()}.tmp`;
    try {
      await fs3.writeFile(temporary, `${JSON.stringify(this.tree, null, 2)}
`, { encoding: "utf-8", flag: "wx" });
      await fs3.rename(temporary, this.storageFile);
    } finally {
      await fs3.rm(temporary, { force: true }).catch(() => void 0);
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
    lines.push(pc.bold(pc.cyan(`
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 DSH Time Machine DAG Tree \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)));
    lines.push(pc.dim(`Session: ${this.tree.sessionId} | Active Branch: `) + pc.green(pc.bold(this.tree.currentBranch)));
    lines.push("");
    const nodesList = Object.values(this.tree.nodes).sort((a, b) => a.timestamp - b.timestamp);
    if (nodesList.length === 0) {
      lines.push(pc.yellow("  (No checkpoints recorded yet. Run a prompt to generate the first checkpoint)"));
      return lines.join("\n");
    }
    for (const node of nodesList) {
      const isHead = this.tree.currentCheckpointId === node.id;
      const isBranchHead = Object.values(this.tree.branches).some((b) => b.headId === node.id);
      const marker = isHead ? pc.red(pc.bold("\u25CF [HEAD]")) : isBranchHead ? pc.yellow("\u25C6") : pc.blue("\u25CB");
      const timeStr = new Date(node.timestamp).toLocaleTimeString();
      const branchBadge = pc.magenta(`[${node.branch}]`);
      const idStr = pc.bold(node.id);
      const promptSnippet = node.prompt.length > 35 ? `${node.prompt.slice(0, 32)}...` : node.prompt;
      const filesCount = node.changedFiles.length;
      const statusBadge = node.status === "failed" ? pc.red("\u2716 FAILED") : pc.green("\u2714 OK");
      lines.push(`  ${marker} ${idStr} ${branchBadge} ${pc.dim(timeStr)} - ${pc.white(promptSnippet)} (${pc.cyan(`${filesCount} files`)}) ${statusBadge}`);
      if (node.summary) {
        lines.push(`     ${pc.dim("\u2514\u2500")} ${pc.italic(pc.gray(node.summary))}`);
      }
    }
    lines.push(pc.bold(pc.cyan(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
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
init_esm_shims();
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
        suggestedPromptPrefix: "",
        hasExternalEffects: false,
        externalEffectCount: 0
      };
    }
    const failureIncidents = [];
    const externalEffects = abandonedNodes.flatMap((node) => node.externalEffects ?? []);
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
      const hasEffects = externalEffects.length > 0;
      return {
        hasPastFailures: false,
        failedNodeCount: 0,
        summaryNote: hasEffects ? `Previous branches declared ${externalEffects.length} external side effect(s); workspace restore does not compensate them.` : "Previous branches explored alternative solutions without logged runtime errors.",
        suggestedPromptPrefix: hasEffects ? externalEffectAdvisory(externalEffects) : "",
        hasExternalEffects: hasEffects,
        externalEffectCount: externalEffects.length
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
    if (externalEffects.length > 0) {
      lines.push(`External side effects were declared in abandoned branch(es); filesystem restore does not undo them:`);
      externalEffects.slice(0, 5).forEach((effect) => {
        lines.push(`  - [${effect.adapter}] ${effect.operation}: ${effect.reversible ? "adapter-declared reversible" : "not declared reversible"}; ${effect.failureSemantics.slice(0, 140)}`);
        if (effect.compensation) lines.push(`    Explicit compensation: ${effect.compensation.slice(0, 160)}`);
      });
      lines.push(`WARNING: verify external state or run the adapter's explicit compensation before relying on this branch.`);
    }
    lines.push(
      `CRITICAL INSTRUCTION: Do NOT repeat the exact approaches or failed commands above. Choose a cleaner, alternative architectural or implementation strategy.`
    );
    const summaryText = lines.join("\n");
    return {
      hasPastFailures: true,
      failedNodeCount: failureIncidents.length,
      summaryNote: `Detected ${failureIncidents.length} failed attempts in alternative branches.`,
      suggestedPromptPrefix: summaryText,
      hasExternalEffects: externalEffects.length > 0,
      externalEffectCount: externalEffects.length
    };
  }
};
function externalEffectAdvisory(effects) {
  const lines = [
    `[TIME-MACHINE EXTERNAL EFFECT WARNING]`,
    `Filesystem/session restore does not automatically undo external database, network, process, or cloud mutations.`,
    `Verify the following declared effects before continuing:`
  ];
  for (const effect of effects.slice(0, 5)) {
    lines.push(`  - [${effect.adapter}] ${effect.operation}: ${effect.failureSemantics.slice(0, 140)}`);
    if (effect.compensation) lines.push(`    Explicit compensation: ${effect.compensation.slice(0, 160)}`);
  }
  return lines.join("\n");
}

// src/core/operation-lock.ts
init_esm_shims();
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
init_esm_shims();
import fs4 from "fs/promises";
import path5 from "path";
import os from "os";
import { randomUUID as randomUUID4 } from "crypto";
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
    this.lockPath = path5.resolve(lockPath);
    this.timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 3e4));
    this.retryMs = Math.max(5, Math.floor(options.retryMs ?? 25));
    this.staleMs = Math.max(this.retryMs, Math.floor(options.staleMs ?? 12e4));
  }
  async run(operation) {
    const token = randomUUID4();
    const handle = await this.acquire(token);
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => void 0);
      await this.release(token);
    }
  }
  async acquire(token) {
    await fs4.mkdir(path5.dirname(this.lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await fs4.open(this.lockPath, "wx");
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: os.hostname(), createdAt: Date.now() }), "utf8");
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
    const stat = await fs4.stat(this.lockPath).catch(() => void 0);
    if (!stat) return;
    const owner = await fs4.readFile(this.lockPath, "utf8").then((value) => JSON.parse(value)).catch(() => ({}));
    const age = Date.now() - (owner.createdAt ?? stat.mtimeMs);
    if (owner.pid && owner.pid !== process.pid) {
      try {
        process.kill(owner.pid, 0);
        return;
      } catch {
        await fs4.rm(this.lockPath, { force: true }).catch(() => void 0);
        return;
      }
    }
    if (age > this.staleMs) await fs4.rm(this.lockPath, { force: true }).catch(() => void 0);
  }
  async release(token) {
    const owner = await fs4.readFile(this.lockPath, "utf8").then((value) => JSON.parse(value)).catch(() => void 0);
    if (owner?.token === token) await fs4.rm(this.lockPath, { force: true }).catch(() => void 0);
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
  externalEffectAdapters = /* @__PURE__ */ new Map();
  constructor(options) {
    this.workDir = path6.resolve(options.workDir);
    this.storageDir = options.storageDir ? path6.resolve(options.storageDir) : path6.join(this.workDir, ".dsh", "time-machine");
    this.journalDir = path6.join(this.storageDir, "restore-journals");
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
      maxSnapshotBytes: Math.max(0, Math.floor(options.config?.maxSnapshotBytes ?? 0)),
      allowPartialSnapshots: options.config?.allowPartialSnapshots ?? false,
      enableAgentWriteLedger: options.config?.enableAgentWriteLedger ?? false
    };
    this.gitEngine = new GitPlumbingEngine({
      workDir: this.workDir,
      refPrefix: this.config.refPrefix,
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      quarantineDir: path6.join(this.storageDir, "ignored-quarantine"),
      shadowObjectDir: this.config.shadowStore ? path6.join(this.storageDir, "git-shadow", "objects") : void 0,
      maxQuarantineBytes: this.config.maxQuarantineBytes,
      quarantineEncryptionKey: this.config.quarantineEncryptionKeyEnv ? process.env[this.config.quarantineEncryptionKeyEnv] : void 0,
      maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
      maxSnapshotBytes: this.config.maxSnapshotBytes,
      allowPartialSnapshots: this.config.allowPartialSnapshots
    });
    this.fallbackEngine = new FallbackSnapshotEngine({
      workDir: this.workDir,
      storageDir: path6.join(this.storageDir, "fallback_backups"),
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
      maxSnapshotBytes: this.config.maxSnapshotBytes
    });
    this.workspaceLock = new WorkspaceFileLock(path6.join(this.storageDir, ".workspace.lock"), {
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
    const checkpointId = `chk_t${params.turnIndex}_${randomUUID5().replace(/-/g, "").slice(0, 12)}`;
    const currentNode = dag.getCurrentNode();
    const parentCommitOid = currentNode ? currentNode.gitCommitOid : null;
    let treeOid = "";
    let commitOid = "";
    let changedFiles = [];
    let ignoredPaths = [];
    let omittedPaths = [];
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
      omittedPaths = snap.omittedPaths;
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
      ignoredPaths,
      omittedPaths
    };
    await dag.addNode(node);
    return cloneJson2(node);
  }
  async finalizeTurnCheckpoint(params) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const settled = await this.gitEngine.isGitRepo() ? await this.gitEngine.inspectWorkspace({ omitPaths: dag.getNode(params.checkpointId)?.omittedPaths ?? [] }) : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
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
   * Record a successful Agent write. This is deliberately an integration API:
   * the core never guesses authorship from a tool name or file timestamp.
   */
  async recordAgentWrite(sessionId, checkpointId, write) {
    return this.runWorkspaceOperation(async () => {
      if (!this.config.enableAgentWriteLedger) throw new Error("Agent-write ledger is disabled; set enableAgentWriteLedger: true.");
      const normalized = normalizeRelativePath(write.path);
      if (!normalized) throw new Error("Agent write path must be workspace-relative.");
      const sha256 = write.sha256 ?? await this.hashWorkspacePath(normalized);
      if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("Agent write sha256 must be a 64-character hexadecimal digest.");
      const dag = await this.getDAGManager(sessionId);
      const node = dag.getNode(checkpointId);
      if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const record = {
        path: normalized,
        sha256: sha256.toLowerCase(),
        recordedAt: Date.now(),
        ...write.operation ? { operation: write.operation } : {}
      };
      const previous = (node.agentWrites ?? []).filter((item) => item.path !== normalized);
      return dag.updateNode(checkpointId, { agentWrites: [...previous, record] });
    });
  }
  async getAgentWriteLedger(sessionId, checkpointId) {
    const dag = await this.getDAGManager(sessionId);
    const node = dag.getNode(checkpointId);
    if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
    return cloneJson2(node.agentWrites ?? []);
  }
  /**
   * Record an external mutation against a checkpoint. The core deliberately
   * does not execute compensation; an adapter can later use this declaration
   * to perform an explicit, user-approved reversal.
   */
  async recordExternalEffect(sessionId, checkpointId, effect) {
    return this.runWorkspaceOperation(async () => {
      if (!effect.adapter.trim() || !effect.operation.trim() || !effect.failureSemantics.trim()) {
        throw new Error("External effect adapter, operation, and failureSemantics are required.");
      }
      if (typeof effect.reversible !== "boolean") {
        throw new Error("External effect reversible must be a boolean.");
      }
      if (!["unresolved", "compensated", "unknown"].includes(effect.status)) {
        throw new Error("External effect status must be unresolved, compensated, or unknown.");
      }
      if (effect.id !== void 0 && (!effect.id.trim() || /\s/.test(effect.id))) {
        throw new Error("External effect id must be non-empty and contain no whitespace.");
      }
      const dag = await this.getDAGManager(sessionId);
      const node = dag.getNode(checkpointId);
      if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const record = {
        adapter: effect.adapter.trim(),
        operation: effect.operation.trim(),
        reversible: effect.reversible,
        ...effect.compensation?.trim() ? { compensation: effect.compensation.trim() } : {},
        failureSemantics: effect.failureSemantics.trim(),
        status: effect.status,
        id: effect.id?.trim() || randomUUID5(),
        recordedAt: Date.now()
      };
      return dag.updateNode(checkpointId, {
        externalEffects: [...node.externalEffects ?? [], record]
      });
    });
  }
  /**
   * Register an explicit compensation adapter. Adapters own authentication,
   * remote API semantics, and idempotency; the core only coordinates the
   * durable declaration and requires an explicit execute request.
   */
  registerExternalEffectAdapter(adapter) {
    if (!adapter || !adapter.name.trim() || /\s/.test(adapter.name) || typeof adapter.compensate !== "function") {
      throw new Error("External effect adapter requires a non-empty name and compensate function.");
    }
    if (this.externalEffectAdapters.has(adapter.name)) {
      throw new Error(`External effect adapter '${adapter.name}' is already registered.`);
    }
    this.externalEffectAdapters.set(adapter.name, adapter);
    return () => {
      if (this.externalEffectAdapters.get(adapter.name) === adapter) this.externalEffectAdapters.delete(adapter.name);
    };
  }
  listExternalEffectAdapters() {
    return [...this.externalEffectAdapters.keys()].sort();
  }
  /**
   * Perform one adapter compensation only when the caller explicitly opts in.
   * A deterministic idempotency key is used when none is supplied, and a
   * different key cannot be used after an attempt has been recorded.
   */
  async compensateExternalEffect(sessionId, checkpointId, effectId, options = {}) {
    return this.runWorkspaceOperation(async () => {
      const dag = await this.getDAGManager(sessionId);
      const node = dag.getNode(checkpointId);
      if (!node) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const effect = node.externalEffects?.find((item) => item.id === effectId);
      if (!effect) throw new Error(`External effect '${effectId}' does not exist on checkpoint '${checkpointId}'.`);
      const adapter = this.externalEffectAdapters.get(effect.adapter);
      const idempotencyKey = options.idempotencyKey?.trim() || `dsh-tm:${sessionId}:${checkpointId}:${effectId}`;
      if (!idempotencyKey || idempotencyKey.length > 256 || /\s/.test(idempotencyKey)) {
        throw new Error("External compensation idempotencyKey must be non-empty, <=256 characters, and contain no whitespace.");
      }
      if (options.execute !== true) {
        return {
          sessionId,
          checkpointId,
          effect: cloneJson2(effect),
          adapter: effect.adapter,
          adapterAvailable: adapter !== void 0,
          dryRun: true,
          idempotencyKey,
          replayed: false,
          note: !adapter ? `No external effect adapter '${effect.adapter}' is registered; dry-run only.` : effect.status === "compensated" ? "Effect is already marked compensated." : "Dry run; no external mutation was requested."
        };
      }
      if (!adapter) {
        throw Object.assign(new Error(`No external effect adapter '${effect.adapter}' is registered.`), {
          code: "EXTERNAL_ADAPTER_UNAVAILABLE"
        });
      }
      if (!effect.reversible) throw new Error(`External effect '${effectId}' is declared irreversible.`);
      if (effect.compensationIdempotencyKey && effect.compensationIdempotencyKey !== idempotencyKey) {
        throw new Error(`External effect '${effectId}' already has a different compensation idempotency key.`);
      }
      if (effect.status === "compensated" && effect.compensationIdempotencyKey === idempotencyKey) {
        return { sessionId, checkpointId, effect: cloneJson2(effect), adapter: adapter.name, adapterAvailable: true, dryRun: false, idempotencyKey, replayed: true };
      }
      const attemptedAt = Date.now();
      const mark = (patch) => dag.updateNode(checkpointId, {
        externalEffects: (node.externalEffects ?? []).map((item) => item.id === effectId ? { ...item, ...patch, compensationIdempotencyKey: idempotencyKey, compensationAttemptedAt: attemptedAt } : item)
      });
      await mark({ status: "unknown" });
      try {
        const outcome = await adapter.compensate({ sessionId, checkpointId, effect: cloneJson2({ ...effect, status: "unknown", compensationIdempotencyKey: idempotencyKey, compensationAttemptedAt: attemptedAt }), idempotencyKey });
        if (!outcome || !["compensated", "unknown"].includes(outcome.status)) throw new Error("Adapter returned an invalid compensation status.");
        const updated = await mark({ status: outcome.status, ...outcome.note ? { compensation: outcome.note } : {} });
        const finalEffect = updated.externalEffects.find((item) => item.id === effectId);
        return { sessionId, checkpointId, effect: cloneJson2(finalEffect), adapter: adapter.name, adapterAvailable: true, dryRun: false, idempotencyKey, replayed: false, note: outcome.note };
      } catch (error) {
        await mark({ status: "unknown" });
        throw Object.assign(new Error(`External compensation '${effectId}' is unknown after adapter failure: ${error instanceof Error ? error.message : String(error)}`), { code: "EXTERNAL_COMPENSATION_UNKNOWN" });
      }
    });
  }
  /** Explicitly migrate a legacy plaintext ignored-file quarantine to AES-GCM. */
  async migrateIgnoredBackup(key) {
    return this.runWorkspaceOperation(async () => {
      if (!await this.gitEngine.isGitRepo()) {
        throw new Error("Ignored quarantine migration requires a Git-backed workspace.");
      }
      return this.gitEngine.migrateIgnoredBackup(key);
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
        restoreJournalId: restored.journalId,
        preservedHandEditPaths: restored.preservedHandEditPaths
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
      const currentState = isGit ? await this.gitEngine.inspectWorkspace({ omitPaths: current?.omittedPaths ?? [] }) : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
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
      const planId = `plan_${randomUUID5().replace(/-/g, "")}`;
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
        targetOmittedPaths: target.omittedPaths ?? [],
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
    const actual = await this.inspectWorkspaceSignature(current?.omittedPaths ?? []);
    if (actual.treeOid !== plan.currentTreeOid || !sameStrings(actual.ignoredPaths, plan.currentIgnoredPaths)) {
      throw new RestorePlanError("Workspace changed after preview; run preview again before restoring.");
    }
    const controlPlane = await this.inspectControlPlane();
    if (controlPlane.headOid !== plan.headOid || controlPlane.branch !== plan.branch || controlPlane.operation !== plan.operation) {
      throw new RestorePlanError("Git HEAD, branch, or in-progress operation changed after preview; run preview again.");
    }
  }
  async inspectWorkspaceSignature(omitPaths = []) {
    return await this.gitEngine.isGitRepo() ? await this.gitEngine.inspectWorkspace({ omitPaths }) : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
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
      gitObjectsShared: await this.gitEngine.isGitRepo() && !this.config.shadowStore,
      gitObjectsEncrypted: false,
      quarantineEncrypted: Boolean(this.config.quarantineEncryptionKeyEnv && process.env[this.config.quarantineEncryptionKeyEnv])
    };
  }
  /** Report runtime capabilities so Web/CLI integrations can fail early. */
  async getCapabilities() {
    const git = await this.gitEngine.isGitRepo();
    const workspace = git ? await this.gitEngine.inspectWorkspaceCapabilities() : { sparseCheckout: false, submodulePaths: [], inProgressOperation: null };
    const usable = git && !workspace.sparseCheckout && workspace.submodulePaths.length === 0 && !workspace.inProgressOperation;
    return {
      version: 1,
      git,
      fallback: !git,
      mergeRestore: usable,
      selectiveRestore: usable || !git,
      shadowStore: git && this.config.shadowStore,
      shadowStoreEncryption: false,
      quarantineEncryption: Boolean(this.config.quarantineEncryptionKeyEnv && process.env[this.config.quarantineEncryptionKeyEnv]),
      quarantineMigration: git && Boolean(this.config.quarantineEncryptionKeyEnv),
      partialSnapshots: git && this.config.allowPartialSnapshots && (this.config.maxSnapshotFileBytes > 0 || this.config.maxSnapshotBytes > 0),
      incrementalCapture: usable && this.config.maxSnapshotFileBytes === 0 && this.config.maxSnapshotBytes === 0,
      handEditPolicy: this.config.enableAgentWriteLedger ? "ledger-opt-in" : "reject-drift",
      agentWriteLedger: this.config.enableAgentWriteLedger,
      externalEffectLedger: true,
      externalEffectAdapters: this.listExternalEffectAdapters(),
      workspaceIsolation: "shared-lock",
      workspace,
      policies: {
        restoreMode: this.config.restoreMode,
        maxSnapshots: this.config.maxSnapshots,
        maxStorageBytes: this.config.maxStorageBytes,
        retentionMaxAgeMs: this.config.retentionMaxAgeMs,
        maxSnapshotFileBytes: this.config.maxSnapshotFileBytes,
        maxSnapshotBytes: this.config.maxSnapshotBytes,
        allowPartialSnapshots: this.config.allowPartialSnapshots,
        enableAgentWriteLedger: this.config.enableAgentWriteLedger,
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
    for (const entry of await fs5.readdir(this.storageDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.startsWith("dag_") || !entry.name.endsWith(".json")) continue;
      const raw = await fs5.readFile(path6.join(this.storageDir, entry.name), "utf8").then((value) => JSON.parse(value)).catch(() => void 0);
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
    const entries = await fs5.readdir(this.storageDir, { withFileTypes: true }).catch(() => []);
    const sessions = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("dag_") || !entry.name.endsWith(".json")) continue;
      try {
        const tree = JSON.parse(await fs5.readFile(path6.join(this.storageDir, entry.name), "utf8"));
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
    const preserveHandEdits = options.preserveVerifiedHandEdits === true;
    const preservedPaths = preserveHandEdits && current ? await this.findVerifiedHandEdits(current) : [];
    if (await this.gitEngine.isGitRepo()) await this.gitEngine.assertSupportedWorkspace();
    if (mode === "safe" && current) {
      const actual = await this.gitEngine.isGitRepo() ? await this.gitEngine.inspectWorkspace({ omitPaths: current.omittedPaths ?? [] }) : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const expectedTree = current.settledGitTreeOid ?? current.gitTreeOid;
      const expectedIgnored = current.settledIgnoredPaths ?? current.ignoredPaths ?? [];
      if (actual.treeOid !== expectedTree || !sameStrings(actual.ignoredPaths, expectedIgnored)) {
        const { WorkspaceDriftError: WorkspaceDriftError2 } = await Promise.resolve().then(() => (init_git_plumbing(), git_plumbing_exports));
        const changed = actual.treeOid === expectedTree ? [] : (await this.gitEngine.getDiffBetween(expectedTree, actual.treeOid)).map((item) => item.file).filter((file) => !preservedPaths.some((path9) => file === path9 || file.startsWith(`${path9}/`)));
        const ignoredDrift = !sameStrings(actual.ignoredPaths, expectedIgnored);
        if (changed.length || ignoredDrift) {
          const details = actual.treeOid === expectedTree ? ["workspace no longer matches the active checkpoint"] : [`managed tree changed (expected ${expectedTree}, observed ${actual.treeOid})${changed.length ? `: ${changed.join(", ")}` : ""}`];
          if (ignoredDrift) details.push("ignored path set changed");
          throw new WorkspaceDriftError2(details);
        }
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
        ignoredBackupKey: rescue?.ignoredBackupKey,
        preservePaths: preservedPaths
      });
      await this.updateRestoreJournal(journalId, "workspace-restored");
      return { rescue, deletedIgnoredPaths: result.deletedIgnoredPaths, journalId, preservedHandEditPaths: preservedPaths };
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
        ignoredBackupKey: options.ignoredBackupKey,
        omittedPaths: target.omittedPaths ?? [],
        preservePaths: options.preservePaths ?? []
      });
      if (target.ignoredBackupKey) await this.gitEngine.restoreIgnoredBackup(target.ignoredBackupKey);
      const preservePaths = options.preservePaths ?? [];
      const verified2 = await this.gitEngine.inspectWorkspace({ omitPaths: [...target.omittedPaths ?? [], ...preservePaths] });
      const expectedTree = options.mode === "merge" ? result.restoredTreeOid : target.gitTreeOid;
      const treeMismatch = verified2.treeOid !== expectedTree;
      const allowedMismatch = treeMismatch && preservePaths.length ? (await this.gitEngine.getDiffBetween(expectedTree, verified2.treeOid)).every((item) => preservePaths.some((path9) => item.file === path9 || item.file.startsWith(`${path9}/`))) : false;
      if (treeMismatch && !allowedMismatch || !sameStrings(verified2.ignoredPaths, target.ignoredPaths ?? [])) {
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
  async findVerifiedHandEdits(current) {
    const records = current.agentWrites ?? [];
    const preserved = [];
    for (const record of records) {
      if (!normalizeRelativePath(record.path) || !/^[a-f0-9]{64}$/i.test(record.sha256)) {
        throw new Error(`AGENT_WRITE_LEDGER_INVALID: checkpoint '${current.id}' contains invalid write evidence.`);
      }
      const actual = await this.hashWorkspacePath(record.path).catch(() => void 0);
      if (actual && actual !== record.sha256) preserved.push(record.path);
    }
    return preserved;
  }
  async hashWorkspacePath(relative) {
    const absolute = path6.resolve(this.workDir, relative);
    if (!absolute.startsWith(`${path6.resolve(this.workDir)}${path6.sep}`)) throw new Error("Path escapes workspace.");
    const stat = await fs5.lstat(absolute);
    const hash = createHash3("sha256");
    if (stat.isSymbolicLink()) hash.update(`symlink:${await fs5.readlink(absolute)}`);
    else if (stat.isFile()) hash.update(await fs5.readFile(absolute));
    else throw new Error(`Agent write path '${relative}' is not a regular file or symlink.`);
    return hash.digest("hex");
  }
  async completeRestoreJournal(journalId) {
    if (!journalId) return;
    await fs5.rm(path6.join(this.journalDir, `${journalId}.json`), { force: true }).catch(() => void 0);
  }
  async createRestoreJournal(params) {
    const id = `restore_${randomUUID5().replace(/-/g, "")}`;
    const journal = { version: 1, id, phase: "prepared", createdAt: Date.now(), ...params };
    await fs5.mkdir(this.journalDir, { recursive: true });
    const file = path6.join(this.journalDir, `${id}.json`);
    const temporary = `${file}.${randomUUID5()}.tmp`;
    try {
      await fs5.writeFile(temporary, `${JSON.stringify(journal, null, 2)}
`, { encoding: "utf8", flag: "wx" });
      await fs5.rename(temporary, file);
    } finally {
      await fs5.rm(temporary, { force: true }).catch(() => void 0);
    }
    return id;
  }
  async updateRestoreJournal(journalId, phase) {
    if (!journalId) return;
    const file = path6.join(this.journalDir, `${journalId}.json`);
    const raw = await fs5.readFile(file, "utf8").catch(() => void 0);
    if (!raw) return;
    const journal = JSON.parse(raw);
    journal.phase = phase;
    await fs5.writeFile(file, `${JSON.stringify(journal, null, 2)}
`, "utf8");
  }
  async recoverInterruptedRestores(sessionId, dag) {
    const entries = await fs5.readdir(this.journalDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path6.join(this.journalDir, entry.name);
      let journal;
      try {
        journal = JSON.parse(await fs5.readFile(file, "utf8"));
      } catch {
        continue;
      }
      if (journal.version !== 1 || journal.sessionId !== sessionId) continue;
      const rescue = dag.getNode(journal.rescueCheckpointId);
      if (!rescue) {
        await fs5.rm(file, { force: true });
        continue;
      }
      await this.restoreNode(rescue, void 0, { mode: "force", createRescuePoint: false });
      await dag.rewindTo(rescue.id);
      await fs5.rm(file, { force: true });
    }
  }
};
function cloneJson2(value) {
  return JSON.parse(JSON.stringify(value));
}
function normalizeRelativePath(value) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("\0") || normalized.split("/").includes("..")) {
    throw new Error(`Invalid workspace-relative path '${value}'.`);
  }
  return normalized;
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
    for (const entry of await fs5.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path6.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += (await fs5.stat(absolute).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}
async function countFiles(root) {
  let total = 0;
  const visit = async (directory) => {
    for (const entry of await fs5.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path6.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += 1;
    }
  };
  await visit(root);
  return total;
}

// src/web/server.ts
init_esm_shims();
import http from "http";
import path7 from "path";
import fs6 from "fs/promises";
import { URL } from "url";
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
      this.server = http.createServer(async (req, res) => {
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
          const parsedUrl = new URL(req.url || "/", `http://localhost:${this.port}`);
          const pathname = parsedUrl.pathname;
          if (pathname.startsWith("/api/")) {
            await this.handleApi(req, res, pathname, parsedUrl.searchParams);
            return;
          }
          await this.handleStatic(res, pathname);
        } catch (err) {
          const status = err?.code === "BAD_REQUEST" ? 400 : err?.code === "RESTORE_PLAN_INVALID" || err?.code === "RESTORE_MERGE_CONFLICT" || err?.code === "QUARANTINE_KEY_INVALID" || err?.code === "EXTERNAL_COMPENSATION_UNKNOWN" || err?.code === "EXTERNAL_ADAPTER_UNAVAILABLE" ? 409 : err?.code === "UNSUPPORTED_WORKSPACE_STATE" ? 422 : err?.code === "SNAPSHOT_SIZE_LIMIT" ? 413 : 500;
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
        preserveVerifiedHandEdits: body.preserveVerifiedHandEdits === true,
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
    if (pathname === "/api/quarantine-migrate" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      if (typeof body.backupKey !== "string" || !body.backupKey.trim() || /\s/.test(body.backupKey)) {
        throw Object.assign(new Error("backupKey is required and must not contain whitespace"), { code: "BAD_REQUEST" });
      }
      const result = await this.service.migrateIgnoredBackup(body.backupKey);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }
    if (pathname === "/api/external-effects/compensate" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      if (typeof body.sessionId !== "string" || typeof body.checkpointId !== "string" || typeof body.effectId !== "string") {
        throw Object.assign(new Error("sessionId, checkpointId, and effectId are required"), { code: "BAD_REQUEST" });
      }
      if (body.idempotencyKey !== void 0 && typeof body.idempotencyKey !== "string") {
        throw Object.assign(new Error("idempotencyKey must be a string"), { code: "BAD_REQUEST" });
      }
      const result = await this.service.compensateExternalEffect(body.sessionId, body.checkpointId, body.effectId, {
        execute: body.execute === true,
        idempotencyKey: body.idempotencyKey
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
    const currentFileDir = path7.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const candidateDirs = [
      path7.join(currentFileDir, "client"),
      path7.join(currentFileDir, "../src/web/client"),
      path7.join(currentFileDir, "web/client"),
      path7.join(process.cwd(), "src/web/client"),
      path7.join(process.cwd(), "dist/client")
    ];
    let fullPath = "";
    for (const dir of candidateDirs) {
      const candidate = path7.resolve(dir, filePath);
      const relative = path7.relative(path7.resolve(dir), candidate);
      if (relative.startsWith("..") || path7.isAbsolute(relative)) continue;
      try {
        await fs6.access(candidate);
        fullPath = candidate;
        break;
      } catch {
      }
    }
    try {
      if (!fullPath) throw new Error("Asset not found");
      const content = await fs6.readFile(fullPath);
      const ext = path7.extname(fullPath);
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
      return allowed.has(new URL(origin).hostname);
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
init_esm_shims();
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
      name: "tm-quarantine-migrate",
      description: "Encrypt one legacy plaintext ignored-file quarantine backup",
      input: { hint: "<backup-key>" },
      handler: async ({ rawInput }) => {
        const key = rawInput.trim();
        if (!key || /\s/.test(key)) return { kind: "error", text: "Usage: /tm-quarantine-migrate <backup-key>" };
        const result = await service.migrateIgnoredBackup(key);
        return {
          kind: "success",
          text: result.migrated ? `Encrypted quarantine backup ${key}: ${result.entryCount} ${result.entryCount === 1 ? "entry" : "entries"} rewritten (${formatBytes(result.bytesRewritten)}).` : `Quarantine backup ${key} is already encrypted or empty.`
        };
      }
    });
    scope.commands.register({
      name: "tm-external-compensate",
      description: "Preview or explicitly execute an external-effect compensation",
      input: { hint: "<checkpoint> <effect-id> [--execute] [--key=<idempotency-key>]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter((arg) => !arg.startsWith("--"));
        if (positionals.length < 2) return { kind: "error", text: "Usage: /tm-external-compensate <checkpoint> <effect-id> [--execute] [--key=<idempotency-key>]" };
        const result = await service.compensateExternalEffect(agent.session.id, positionals[0], positionals[1], {
          execute: args.includes("--execute"),
          idempotencyKey: optionValue(args, "--key")
        });
        return {
          kind: "success",
          text: result.dryRun ? `Dry run: adapter '${result.adapter}' is available for effect ${positionals[1]}; no external mutation was executed. Use --execute with key ${result.idempotencyKey}.` : `${result.replayed ? "Replayed" : "Executed"} compensation for ${positionals[1]} via '${result.adapter}' with key ${result.idempotencyKey}; status=${result.effect.status}.`
        };
      }
    });
    scope.commands.register({
      name: "tm-rewind",
      description: "Restore workspace and fork conversation at a checkpoint",
      input: { hint: "<checkpoint> [--merge|--force] [--preserve-hand-edits] [--delete-new-ignored] [--plan=<id>]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const checkpointId = args.find((arg) => !arg.startsWith("--"));
        if (!checkpointId) return { kind: "error", text: "Usage: /tm-rewind <checkpoint> [--merge|--force] [--delete-new-ignored]" };
        const controller = scope.get("sessionController");
        if (!controller) return { kind: "error", text: "This DSH profile has no sessionController; dual-track rewind is unavailable." };
        const sessionId = agent.session.id;
        const result = await service.rewindToCheckpoint(sessionId, checkpointId, {
          mode: args.includes("--force") ? "force" : args.includes("--merge") ? "merge" : void 0,
          preserveVerifiedHandEdits: args.includes("--preserve-hand-edits"),
          deleteNewIgnoredPaths: args.includes("--delete-new-ignored"),
          restorePlanId: optionValue(args, "--plan")
        });
        try {
          const created = await restartConversation(controller, sessionId, result.targetNode, service.workDir);
          await service.completeRestoreJournal(result.restoreJournalId);
          return {
            kind: "success",
            text: `Restored ${checkpointId}. Continue in forked session ${created.sessionId}. Rescue point: ${result.rescueCheckpointId ?? "none"}.${result.preservedHandEditPaths?.length ? ` Preserved hand-edited paths: ${result.preservedHandEditPaths.join(", ")}.` : ""}`
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
        const omitted = preview.targetOmittedPaths?.length ? ` INCOMPLETE checkpoint: omitted paths preserved live: ${preview.targetOmittedPaths.join(", ")}.` : "";
        const conflicts = preview.conflictingPaths.length ? ` Conflicting paths: ${preview.conflictingPaths.join(", ")}.` : "";
        const plan = ` Restore plan: ${preview.restorePlanId}${preview.restorePlanExpiresAt ? ` (expires ${new Date(preview.restorePlanExpiresAt).toISOString()})` : " (no expiry)"}.`;
        return { kind: "success", text: `Preview ${checkpointId}: ${drift}. Changes: ${files}.${ignored}${omitted}${conflicts}${plan}` };
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
init_esm_shims();

// src/index.ts
init_git_plumbing();
var name = "dsh-plugin-time-machine";
var Config = Schema.object({
  autoSnapshot: Schema.boolean().default(true),
  enableReflectionAdvisor: Schema.boolean().default(true),
  refPrefix: Schema.string().default("refs/dsh-tm"),
  storageDir: Schema.string(),
  webPort: Schema.number().default(3088),
  enableWebUI: Schema.boolean().default(true),
  restoreMode: Schema.union(["safe", "merge", "force"]).default("safe"),
  preservePaths: Schema.array(Schema.string()).default(["node_modules"]),
  webHost: Schema.string().default("127.0.0.1"),
  maxSnapshots: Schema.number().default(0),
  maxStorageBytes: Schema.number().default(0),
  shadowStore: Schema.boolean().default(false),
  autoPrune: Schema.boolean().default(false),
  retentionMaxAgeMs: Schema.number().default(0),
  workspaceLockTimeoutMs: Schema.number().default(3e4),
  maxQuarantineBytes: Schema.number().default(0),
  quarantineEncryptionKeyEnv: Schema.string().default(""),
  restorePlanTtlMs: Schema.number().default(9e5),
  maxSnapshotFileBytes: Schema.number().default(0),
  maxSnapshotBytes: Schema.number().default(0),
  allowPartialSnapshots: Schema.boolean().default(false),
  enableAgentWriteLedger: Schema.boolean().default(false)
});
function apply(ctx, config = {}) {
  const workDir = path8.resolve(process.cwd());
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
      const cwd = session.header.cwd ? path8.resolve(session.header.cwd) : workDir;
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
  ctx.logger.info(pc2.green(`[${name}] active; restore mode=${service.config.restoreMode}`));
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
export {
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
  index_default as default,
  name
};
//# sourceMappingURL=index.js.map