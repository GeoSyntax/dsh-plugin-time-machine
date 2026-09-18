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
  WorkspaceDriftError: () => WorkspaceDriftError,
  WorkspaceRestoreConflictError: () => WorkspaceRestoreConflictError
});
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
var import_node_child_process, import_node_crypto, import_node_util, import_node_path, import_promises, execFileAsync, WorkspaceDriftError, WorkspaceRestoreConflictError, GitPlumbingEngine;
var init_git_plumbing = __esm({
  "src/core/git-plumbing.ts"() {
    "use strict";
    init_cjs_shims();
    import_node_child_process = require("child_process");
    import_node_crypto = require("crypto");
    import_node_util = require("util");
    import_node_path = __toESM(require("path"), 1);
    import_promises = __toESM(require("fs/promises"), 1);
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
    WorkspaceRestoreConflictError = class extends Error {
      constructor(paths) {
        super(`Ignored files block restore: ${paths.slice(0, 8).join(", ")}`);
        this.paths = paths;
        this.name = "WorkspaceRestoreConflictError";
      }
      paths;
      code = "RESTORE_CONFLICT";
    };
    GitPlumbingEngine = class {
      workDir;
      refPrefix;
      preservePaths;
      quarantineDir;
      isRepoCached = null;
      repoRootCached = null;
      gitDirCached = null;
      constructor(options) {
        this.workDir = import_node_path.default.resolve(options.workDir);
        this.refPrefix = options.refPrefix || "refs/dsh-tm";
        this.preservePaths = (options.preservePaths ?? []).map((item) => import_node_path.default.resolve(this.workDir, item));
        this.quarantineDir = options.quarantineDir ? import_node_path.default.resolve(options.quarantineDir) : void 0;
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
        this.repoRootCached = import_node_path.default.resolve(stdout.trim());
        return this.repoRootCached;
      }
      async getGitDir() {
        if (this.gitDirCached) return this.gitDirCached;
        const { stdout } = await this.runGit(["rev-parse", "--absolute-git-dir"]);
        this.gitDirCached = import_node_path.default.resolve(stdout.trim());
        return this.gitDirCached;
      }
      async runGit(args, extraEnv = {}, cwd = this.workDir) {
        const env = {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          ...extraEnv
        };
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
        const { treeOid, indexFile } = await this.writeWorkspaceTree();
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
      /** Restore with an isolated index so the user's staged changes are never rewritten. */
      async restoreSnapshot(commitOrTreeOid, options = {}) {
        if (!await this.isGitRepo()) {
          throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
        }
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
        const targetIgnored = new Set(options.targetIgnoredPaths ?? []);
        const ignoredToDelete = current.ignoredPaths.filter((item) => !targetIgnored.has(item));
        const targetFiles = new Set(await this.listTreeFileNames(targetTree));
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
          await this.runGit(["read-tree", "--reset", "-u", targetTree], { GIT_INDEX_FILE: indexFile }, root);
        } finally {
          await import_promises.default.rm(indexFile, { force: true }).catch(() => void 0);
        }
        return { deletedIgnoredPaths };
      }
      /** Restore quarantined ignored content without ever writing it into Git objects. */
      async restoreIgnoredBackup(key) {
        if (!this.quarantineDir) return;
        const backupRoot = import_node_path.default.join(this.quarantineDir, encodeRefPart(key));
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
      async getDiffBetween(baseOid, targetOid) {
        try {
          const { stdout } = await this.runGit(["diff", "--no-ext-diff", `${baseOid}^{tree}`, `${targetOid}^{tree}`]);
          return this.parseUnifiedDiff(stdout);
        } catch {
          return [];
        }
      }
      async writeWorkspaceTree() {
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
          for (let offset = 0; offset < candidateFiles.length; offset += 128) {
            await this.runGit(["add", "-A", "--", ...candidateFiles.slice(offset, offset + 128)], env, root);
          }
          const { stdout: indexedFiles } = await this.runGit(["ls-files", "-z"], env, root);
          const indexedEntries = indexedFiles.split("\0").filter(Boolean);
          const protectedEntries = indexedEntries.filter((file) => protectedPaths.some(
            (relative) => file === relative || file.startsWith(`${relative}/`)
          ));
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
        const destination = import_node_path.default.join(this.quarantineDir, encodeRefPart(key), ...relative.split("/"));
        await import_promises.default.mkdir(import_node_path.default.dirname(destination), { recursive: true });
        await import_promises.default.cp(absolute, destination, { recursive: true, force: true, verbatimSymlinks: true });
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
  ReflectionAdvisor: () => ReflectionAdvisor,
  TimeMachinePlugin: () => TimeMachinePlugin,
  TimeMachineService: () => TimeMachineService,
  WorkspaceDriftError: () => WorkspaceDriftError,
  WorkspaceRestoreConflictError: () => WorkspaceRestoreConflictError,
  apply: () => apply,
  collectFailedTools: () => collectFailedTools,
  default: () => index_default,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
init_cjs_shims();
var import_node_path6 = __toESM(require("path"), 1);
var import_schemastery = __toESM(require("@deepseek-ai/schemastery"), 1);
var import_picocolors2 = __toESM(require("picocolors"), 1);

// src/service.ts
init_cjs_shims();
var import_node_path4 = __toESM(require("path"), 1);
var import_node_crypto4 = require("crypto");
init_git_plumbing();

// src/core/fallback-engine.ts
init_cjs_shims();
var import_node_crypto2 = require("crypto");
var import_node_path2 = __toESM(require("path"), 1);
var import_promises2 = __toESM(require("fs/promises"), 1);
var FallbackSnapshotEngine = class {
  workDir;
  storageDir;
  preservePaths;
  constructor(options) {
    this.workDir = import_node_path2.default.resolve(options.workDir);
    this.storageDir = import_node_path2.default.resolve(options.storageDir);
    this.preservePaths = [this.storageDir, ...(options.preservePaths ?? []).map((item) => import_node_path2.default.resolve(this.workDir, item))];
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
      const entries = await this.captureTree(this.workDir, filesDir);
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
  async captureTree(sourceRoot, destinationRoot) {
    const entries = await this.scanTree(sourceRoot);
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
function deepestFirst(left, right) {
  return right.path.split("/").length - left.path.split("/").length || right.path.localeCompare(left.path);
}
function shallowestFirst(left, right) {
  return left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path);
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

// src/service.ts
var TimeMachineService = class {
  workDir;
  storageDir;
  config;
  gitEngine;
  fallbackEngine;
  dagManagers = /* @__PURE__ */ new Map();
  advisor = new ReflectionAdvisor();
  operations = new KeyedOperationLock();
  constructor(options) {
    this.workDir = import_node_path4.default.resolve(options.workDir);
    this.storageDir = options.storageDir ? import_node_path4.default.resolve(options.storageDir) : import_node_path4.default.join(this.workDir, ".dsh", "time-machine");
    this.config = {
      autoSnapshot: options.config?.autoSnapshot ?? true,
      enableReflectionAdvisor: options.config?.enableReflectionAdvisor ?? true,
      refPrefix: options.config?.refPrefix || "refs/dsh-tm",
      storageDir: this.storageDir,
      webPort: options.config?.webPort || 3088,
      enableWebUI: options.config?.enableWebUI ?? true,
      restoreMode: options.config?.restoreMode ?? "safe",
      preservePaths: options.config?.preservePaths ?? ["node_modules"],
      webHost: options.config?.webHost ?? "127.0.0.1"
    };
    this.gitEngine = new GitPlumbingEngine({
      workDir: this.workDir,
      refPrefix: this.config.refPrefix,
      preservePaths: [this.storageDir, ...this.config.preservePaths],
      quarantineDir: import_node_path4.default.join(this.storageDir, "ignored-quarantine")
    });
    this.fallbackEngine = new FallbackSnapshotEngine({
      workDir: this.workDir,
      storageDir: import_node_path4.default.join(this.storageDir, "fallback_backups"),
      preservePaths: [this.storageDir, ...this.config.preservePaths]
    });
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
    return mgr;
  }
  /**
   * 核心：创建原子双轨快照（状态轨 + 工作区轨）
   */
  async createTurnCheckpoint(params) {
    return this.operations.run(this.workDir, () => this.createTurnCheckpointUnlocked(params));
  }
  async createTurnCheckpointUnlocked(params) {
    const dag = await this.getDAGManager(params.sessionId);
    const checkpointId = `chk_t${params.turnIndex}_${(0, import_node_crypto4.randomUUID)().replace(/-/g, "").slice(0, 12)}`;
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
    return this.operations.run(this.workDir, async () => {
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
    return this.operations.run(this.workDir, async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
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
      return {
        targetNode: cloneJson2(target),
        restoredSessionState: cloneJson2(target.sessionState),
        rescueCheckpointId: restored.rescue?.id,
        deletedIgnoredPaths: restored.deletedIgnoredPaths
      };
    });
  }
  /**
   * 核心：从历史任意快照点 Fork 开辟新的平行探索分支
   */
  async forkNewBranch(params) {
    return this.operations.run(this.workDir, async () => {
      const dag = await this.getDAGManager(params.sessionId);
      const baseNode = dag.validateFork(params.fromCheckpointId, params.newBranchName);
      const restored = await this.restoreWithRescue(dag, baseNode, params.restore ?? {});
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
        rescueCheckpointId: restored.rescue?.id
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
   * 打印终端彩色 ASCII 拓扑树
   */
  async renderTree(sessionId) {
    const dag = await this.getDAGManager(sessionId);
    return dag.renderAsciiTree();
  }
  async restoreWithRescue(dag, target, options) {
    const current = dag.getCurrentNode() ?? void 0;
    const mode = options.mode ?? this.config.restoreMode;
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
    }
    const expected = rescue ?? current;
    if (rescue && options.deleteNewIgnoredPaths) {
      rescue = await dag.updateNode(rescue.id, { ignoredBackupKey: rescue.id });
    }
    try {
      const result = await this.restoreNode(target, expected, {
        ...options,
        mode,
        ignoredBackupKey: rescue?.ignoredBackupKey
      });
      return { rescue, deletedIgnoredPaths: result.deletedIgnoredPaths };
    } catch (error) {
      if (rescue) {
        try {
          await this.restoreNode(rescue, void 0, { mode: "force", createRescuePoint: false });
          await dag.rewindTo(rescue.id);
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
      if (verified2.treeOid !== target.gitTreeOid || !sameStrings(verified2.ignoredPaths, target.ignoredPaths ?? [])) {
        throw new Error(`Workspace integrity check failed after restoring checkpoint '${target.id}'.`);
      }
      return result;
    }
    await this.fallbackEngine.restoreSnapshot(target.sessionState.sessionId, target.id);
    const verified = await this.fallbackEngine.inspectWorkspace();
    if (verified !== target.gitTreeOid) {
      throw new Error(`Fallback workspace integrity check failed after restoring checkpoint '${target.id}'.`);
    }
    return { deletedIgnoredPaths: [] };
  }
};
function cloneJson2(value) {
  return JSON.parse(JSON.stringify(value));
}
function sameStrings(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

// src/web/server.ts
init_cjs_shims();
var import_node_http = __toESM(require("http"), 1);
var import_node_path5 = __toESM(require("path"), 1);
var import_promises4 = __toESM(require("fs/promises"), 1);
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
          const status = err?.code === "BAD_REQUEST" ? 400 : 500;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Internal Server Error" }));
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
    if (pathname === "/api/diff" && req.method === "GET") {
      const sessionId = query.get("sessionId") || "default";
      const baseId = query.get("base") || "";
      const targetId = query.get("target") || "";
      const diffs = await this.service.getDiff(sessionId, baseId, targetId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ diffs }));
      return;
    }
    if (pathname === "/api/rewind" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const { sessionId, checkpointId } = body;
      if (!this.hooks.restartConversation) throw new Error("Conversation restart capability is unavailable; refusing workspace-only rewind.");
      const sourceSessionId = sessionId || "default";
      const result = await this.service.rewindToCheckpoint(sourceSessionId, checkpointId, {
        mode: body.force === true ? "force" : void 0,
        deleteNewIgnoredPaths: body.deleteNewIgnoredPaths === true
      });
      let conversation;
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.targetNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        throw error;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result, conversation }));
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
        restore: { mode: body.force === true ? "force" : void 0 }
      });
      let conversation;
      try {
        conversation = await this.hooks.restartConversation(sourceSessionId, result.forkedNode);
      } catch (error) {
        await this.compensate(sourceSessionId, result.rescueCheckpointId);
        throw error;
      }
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
    const currentFileDir = import_node_path5.default.dirname(new import_node_url.URL(importMetaUrl).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const candidateDirs = [
      import_node_path5.default.join(currentFileDir, "client"),
      import_node_path5.default.join(currentFileDir, "../src/web/client"),
      import_node_path5.default.join(currentFileDir, "web/client"),
      import_node_path5.default.join(process.cwd(), "src/web/client"),
      import_node_path5.default.join(process.cwd(), "dist/client")
    ];
    let fullPath = "";
    for (const dir of candidateDirs) {
      const candidate = import_node_path5.default.resolve(dir, filePath);
      const relative = import_node_path5.default.relative(import_node_path5.default.resolve(dir), candidate);
      if (relative.startsWith("..") || import_node_path5.default.isAbsolute(relative)) continue;
      try {
        await import_promises4.default.access(candidate);
        fullPath = candidate;
        break;
      } catch {
      }
    }
    try {
      if (!fullPath) throw new Error("Asset not found");
      const content = await import_promises4.default.readFile(fullPath);
      const ext = import_node_path5.default.extname(fullPath);
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
      name: "tm-rewind",
      description: "Restore workspace and fork conversation at a checkpoint",
      input: { hint: "<checkpoint> [--force] [--delete-new-ignored]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const checkpointId = args.find((arg) => !arg.startsWith("--"));
        if (!checkpointId) return { kind: "error", text: "Usage: /tm-rewind <checkpoint> [--force] [--delete-new-ignored]" };
        const controller = scope.get("sessionController");
        if (!controller) return { kind: "error", text: "This DSH profile has no sessionController; dual-track rewind is unavailable." };
        const sessionId = agent.session.id;
        const result = await service.rewindToCheckpoint(sessionId, checkpointId, {
          mode: args.includes("--force") ? "force" : void 0,
          deleteNewIgnoredPaths: args.includes("--delete-new-ignored")
        });
        try {
          const created = await restartConversation(controller, sessionId, result.targetNode, service.workDir);
          return {
            kind: "success",
            text: `Restored ${checkpointId}. Continue in forked session ${created.sessionId}. Rescue point: ${result.rescueCheckpointId ?? "none"}.`
          };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          throw error;
        }
      }
    });
    scope.commands.register({
      name: "tm-fork",
      description: "Create a named exploration branch from a checkpoint",
      input: { hint: "<checkpoint> <branch> [--force]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter((arg) => !arg.startsWith("--"));
        if (positionals.length < 2) return { kind: "error", text: "Usage: /tm-fork <checkpoint> <branch> [--force]" };
        const controller = scope.get("sessionController");
        if (!controller) return { kind: "error", text: "This DSH profile has no sessionController; dual-track fork is unavailable." };
        const sessionId = agent.session.id;
        const result = await service.forkNewBranch({
          sessionId,
          fromCheckpointId: positionals[0],
          newBranchName: positionals[1],
          restore: { mode: args.includes("--force") ? "force" : void 0 }
        });
        try {
          const created = await restartConversation(controller, sessionId, result.forkedNode, service.workDir);
          const reflection = result.reflectionAdvisory.hasPastFailures ? `

${result.reflectionAdvisory.suggestedPromptPrefix}` : "";
          return { kind: "success", text: `Forked ${positionals[1]} into DSH session ${created.sessionId}.${reflection}` };
        } catch (error) {
          await compensate(service, sessionId, result.rescueCheckpointId);
          throw error;
        }
      }
    });
  });
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
  restoreMode: import_schemastery.default.union(["safe", "force"]).default("safe"),
  preservePaths: import_schemastery.default.array(import_schemastery.default.string()).default(["node_modules"]),
  webHost: import_schemastery.default.string().default("127.0.0.1")
});
function apply(ctx, config = {}) {
  const workDir = import_node_path6.default.resolve(process.cwd());
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
      const cwd = session.header.cwd ? import_node_path6.default.resolve(session.header.cwd) : workDir;
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
  ReflectionAdvisor,
  TimeMachinePlugin,
  TimeMachineService,
  WorkspaceDriftError,
  WorkspaceRestoreConflictError,
  apply,
  collectFailedTools,
  name
});
//# sourceMappingURL=index.cjs.map