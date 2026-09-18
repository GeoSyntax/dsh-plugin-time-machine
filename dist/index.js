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
  WorkspaceDriftError: () => WorkspaceDriftError,
  WorkspaceRestoreConflictError: () => WorkspaceRestoreConflictError
});
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import path2 from "path";
import fs from "fs/promises";
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
var execFileAsync, WorkspaceDriftError, WorkspaceRestoreConflictError, GitPlumbingEngine;
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
        this.workDir = path2.resolve(options.workDir);
        this.refPrefix = options.refPrefix || "refs/dsh-tm";
        this.preservePaths = (options.preservePaths ?? []).map((item) => path2.resolve(this.workDir, item));
        this.quarantineDir = options.quarantineDir ? path2.resolve(options.quarantineDir) : void 0;
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
        this.repoRootCached = path2.resolve(stdout.trim());
        return this.repoRootCached;
      }
      async getGitDir() {
        if (this.gitDirCached) return this.gitDirCached;
        const { stdout } = await this.runGit(["rev-parse", "--absolute-git-dir"]);
        this.gitDirCached = path2.resolve(stdout.trim());
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
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
        }
      }
      /** Compute the current managed tree without publishing a commit or ref. */
      async inspectWorkspace() {
        const { treeOid, indexFile } = await this.writeWorkspaceTree();
        try {
          return { treeOid, ignoredPaths: await this.listIgnoredPaths() };
        } finally {
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
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
            await fs.rm(absolute, { recursive: true, force: true });
            deletedIgnoredPaths.push(relative);
          }
        }
        const root = await this.getRepoRoot();
        const { indexFile } = await this.writeWorkspaceTree();
        try {
          await this.runGit(["read-tree", "--reset", "-u", targetTree], { GIT_INDEX_FILE: indexFile }, root);
        } finally {
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
        }
        return { deletedIgnoredPaths };
      }
      /** Restore only selected tracked workspace paths using a disposable index. */
      async restoreSelectedPaths(commitOrTreeOid, paths, options = {}) {
        if (!await this.isGitRepo()) throw new Error(`Working directory '${this.workDir}' is not a valid Git repository.`);
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
      async getDiffBetween(baseOid, targetOid) {
        try {
          const { stdout } = await this.runGit(["diff", "--no-ext-diff", baseOid, targetOid]);
          return this.parseUnifiedDiff(stdout);
        } catch {
          return [];
        }
      }
      async writeWorkspaceTree() {
        const root = await this.getRepoRoot();
        const indexFile = path2.join(await this.getGitDir(), `dsh-tm-index-${randomUUID()}`);
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
          await fs.rm(indexFile, { force: true }).catch(() => void 0);
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
        const destination = path2.join(this.quarantineDir, encodeRefPart(key), ...relative.split("/"));
        await fs.mkdir(path2.dirname(destination), { recursive: true });
        await fs.cp(absolute, destination, { recursive: true, force: true, verbatimSymlinks: true });
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
    };
  }
});

// src/index.ts
init_esm_shims();
import path7 from "path";
import Schema from "@deepseek-ai/schemastery";
import pc2 from "picocolors";

// src/service.ts
init_esm_shims();
init_git_plumbing();
import path5 from "path";
import fs4 from "fs/promises";
import { randomUUID as randomUUID4 } from "crypto";

// src/core/fallback-engine.ts
init_esm_shims();
import { createHash, randomUUID as randomUUID2 } from "crypto";
import path3 from "path";
import fs2 from "fs/promises";
var FallbackSnapshotEngine = class {
  workDir;
  storageDir;
  preservePaths;
  constructor(options) {
    this.workDir = path3.resolve(options.workDir);
    this.storageDir = path3.resolve(options.storageDir);
    this.preservePaths = [this.storageDir, ...(options.preservePaths ?? []).map((item) => path3.resolve(this.workDir, item))];
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
      const entries = await this.captureTree(this.workDir, filesDir);
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
  async captureTree(sourceRoot, destinationRoot) {
    const entries = await this.scanTree(sourceRoot);
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
  const hash = createHash("sha256");
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
    this.workDir = path5.resolve(options.workDir);
    this.storageDir = options.storageDir ? path5.resolve(options.storageDir) : path5.join(this.workDir, ".dsh", "time-machine");
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
      quarantineDir: path5.join(this.storageDir, "ignored-quarantine")
    });
    this.fallbackEngine = new FallbackSnapshotEngine({
      workDir: this.workDir,
      storageDir: path5.join(this.storageDir, "fallback_backups"),
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
    const checkpointId = `chk_t${params.turnIndex}_${randomUUID4().replace(/-/g, "").slice(0, 12)}`;
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
  /** Restore selected workspace paths without changing the DSH conversation. */
  async restoreSelectedPaths(sessionId, checkpointId, paths, options = {}) {
    return this.operations.run(this.workDir, async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const current = dag.getCurrentNode();
      let rescue;
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
      }
      try {
        const isGit = await this.gitEngine.isGitRepo();
        if (isGit && !target.gitCommitOid.startsWith("fallback_")) {
          await this.gitEngine.restoreSelectedPaths(target.gitCommitOid, paths, {
            mode: options.mode ?? this.config.restoreMode,
            expectedCurrentTreeOid: rescue?.gitTreeOid ?? current?.gitTreeOid
          });
        } else {
          await this.fallbackEngine.restoreSelectedPaths(target.sessionState.sessionId, target.id, paths, {
            mode: options.mode ?? this.config.restoreMode,
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
        return {
          checkpointId,
          restoredPaths: [...new Set(paths)],
          rescueCheckpointId: rescue?.id,
          resultCheckpointId: resultNode.id
        };
      } catch (error) {
        if (rescue) {
          await this.restoreNode(rescue, void 0, { mode: "force", createRescuePoint: false });
          await dag.rewindTo(rescue.id);
        }
        throw error;
      }
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
   * Produce a read-only impact report before a rewind/fork. This deliberately
   * does not create a rescue point, mutate the DAG, or touch workspace files.
   */
  async previewRestore(sessionId, checkpointId) {
    return this.operations.run(this.workDir, async () => {
      const dag = await this.getDAGManager(sessionId);
      const target = dag.getNode(checkpointId);
      if (!target) throw new Error(`Checkpoint '${checkpointId}' does not exist in DAG.`);
      const current = dag.getCurrentNode();
      const isGit = await this.gitEngine.isGitRepo();
      const currentState = isGit ? await this.gitEngine.inspectWorkspace() : { treeOid: await this.fallbackEngine.inspectWorkspace(), ignoredPaths: [] };
      const targetIgnoredPaths = target.ignoredPaths ?? [];
      const diffs = isGit ? await this.gitEngine.getDiffBetween(currentState.treeOid, target.gitCommitOid) : target.changedFiles.map((change) => ({
        file: change.path,
        status: change.status,
        diffText: "Fallback snapshot: content diff is unavailable; file is included in the target snapshot."
      }));
      const expectedTree = current?.settledGitTreeOid ?? current?.gitTreeOid;
      const expectedIgnored = current?.settledIgnoredPaths ?? current?.ignoredPaths ?? [];
      const workspaceDrifted = Boolean(current && (currentState.treeOid !== expectedTree || !sameStrings(currentState.ignoredPaths, expectedIgnored)));
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
        workspaceDrifted,
        requiresForce: workspaceDrifted
      };
    });
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
    const bytes = await directoryBytes(this.storageDir);
    return {
      storageDir: this.storageDir,
      bytes,
      files,
      sessions: sessions.length,
      checkpoints,
      pruneCandidates: leaves,
      gitObjectsShared: await this.gitEngine.isGitRepo()
    };
  }
  async prune(sessionId, options = {}) {
    return this.operations.run(this.workDir, async () => {
      const dag = await this.getDAGManager(sessionId);
      const keepLatest = Math.max(0, Math.floor(options.keepLatest ?? 20));
      const nodes = Object.values(dag.tree.nodes).sort((left, right) => right.timestamp - left.timestamp);
      const keep = new Set(nodes.slice(0, keepLatest).map((node) => node.id));
      let removed = [];
      if (options.abandonedBranches) {
        const abandonedBranches = Object.keys(dag.tree.branches).filter((branch) => branch !== dag.tree.currentBranch);
        for (const branch of abandonedBranches) removed.push(...await dag.removeBranch(branch));
      }
      const candidates = this.pruneCandidates(dag).filter((node) => !keep.has(node.id));
      removed.push(...await dag.removeLeafNodes(candidates.map((node) => node.id)));
      let reclaimedBytes = 0;
      let gitRefsRemoved = 0;
      for (const node of removed) {
        if (node.gitCommitOid.startsWith("fallback_")) reclaimedBytes += await this.fallbackEngine.removeSnapshot(sessionId, node.id);
        else if (await this.gitEngine.isGitRepo() && await this.gitEngine.deleteCheckpointRef(sessionId, node.id)) gitRefsRemoved += 1;
      }
      return {
        sessionId,
        removedCheckpointIds: removed.map((node) => node.id),
        reclaimedBytes,
        gitRefsRemoved,
        note: gitRefsRemoved > 0 ? "Git objects are shared; run repository maintenance only if you understand its impact." : "Fallback snapshot bytes were removed from plugin storage."
      };
    });
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
    const entries = await fs4.readdir(this.storageDir, { withFileTypes: true }).catch(() => []);
    const sessions = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("dag_") || !entry.name.endsWith(".json")) continue;
      try {
        const tree = JSON.parse(await fs4.readFile(path5.join(this.storageDir, entry.name), "utf8"));
        if (typeof tree.sessionId === "string") sessions.add(tree.sessionId);
      } catch {
      }
    }
    return [...sessions];
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
async function directoryBytes(root) {
  let total = 0;
  const visit = async (directory) => {
    for (const entry of await fs4.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path5.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else total += (await fs4.stat(absolute).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}
async function countFiles(root) {
  let total = 0;
  const visit = async (directory) => {
    for (const entry of await fs4.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path5.join(directory, entry.name);
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
import path6 from "path";
import fs5 from "fs/promises";
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
    if (pathname === "/api/storage" && req.method === "GET") {
      const sessionId = query.get("sessionId") || void 0;
      const status = await this.service.getStorageStatus(sessionId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status }));
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
    if (pathname === "/api/restore-files" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const sessionId = body.sessionId || "default";
      const paths = Array.isArray(body.paths) ? body.paths.filter((item) => typeof item === "string") : [];
      if (!body.checkpointId || paths.length === 0) throw Object.assign(new Error("checkpointId and non-empty paths are required"), { code: "BAD_REQUEST" });
      const result = await this.service.restoreSelectedPaths(sessionId, body.checkpointId, paths, {
        mode: body.force === true ? "force" : void 0
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }
    if (pathname === "/api/prune" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const sessionId = body.sessionId || "default";
      const keepLatest = body.keepLatest === void 0 ? void 0 : Number(body.keepLatest);
      if (keepLatest !== void 0 && (!Number.isInteger(keepLatest) || keepLatest < 0)) {
        throw Object.assign(new Error("keepLatest must be a non-negative integer"), { code: "BAD_REQUEST" });
      }
      const result = await this.service.prune(sessionId, { keepLatest, abandonedBranches: body.abandonedBranches === true });
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
    const currentFileDir = path6.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const candidateDirs = [
      path6.join(currentFileDir, "client"),
      path6.join(currentFileDir, "../src/web/client"),
      path6.join(currentFileDir, "web/client"),
      path6.join(process.cwd(), "src/web/client"),
      path6.join(process.cwd(), "dist/client")
    ];
    let fullPath = "";
    for (const dir of candidateDirs) {
      const candidate = path6.resolve(dir, filePath);
      const relative = path6.relative(path6.resolve(dir), candidate);
      if (relative.startsWith("..") || path6.isAbsolute(relative)) continue;
      try {
        await fs5.access(candidate);
        fullPath = candidate;
        break;
      } catch {
      }
    }
    try {
      if (!fullPath) throw new Error("Asset not found");
      const content = await fs5.readFile(fullPath);
      const ext = path6.extname(fullPath);
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
      input: { hint: "[keep-latest] [--abandoned-branches]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const keepArg = args.find((arg) => !arg.startsWith("--"));
        const keepLatest = keepArg ? Number(keepArg) : 20;
        if (!Number.isInteger(keepLatest) || keepLatest < 0) return { kind: "error", text: "Usage: /tm-prune [non-negative keep-latest]" };
        const result = await service.prune(agent.session.id, { keepLatest, abandonedBranches: args.includes("--abandoned-branches") });
        return { kind: "success", text: `Pruned ${result.removedCheckpointIds.length} checkpoint(s), reclaimed ${formatBytes(result.reclaimedBytes)}. ${result.note}` };
      }
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
        return { kind: "success", text: `Preview ${checkpointId}: ${drift}. Changes: ${files}.${ignored}` };
      }
    });
    scope.commands.register({
      name: "tm-restore-files",
      description: "Restore selected workspace paths from a checkpoint without changing conversation",
      input: { hint: "<checkpoint> <path...> [--force]" },
      handler: async ({ agent, rawInput }) => {
        const args = rawInput.trim().split(/\s+/).filter(Boolean);
        const positionals = args.filter((arg) => !arg.startsWith("--"));
        if (positionals.length < 2) return { kind: "error", text: "Usage: /tm-restore-files <checkpoint> <path...> [--force]" };
        const result = await service.restoreSelectedPaths(agent.session.id, positionals[0], positionals.slice(1), {
          mode: args.includes("--force") ? "force" : void 0
        });
        return { kind: "success", text: `Restored ${result.restoredPaths.join(", ")} from ${positionals[0]}. Conversation unchanged. Result checkpoint: ${result.resultCheckpointId ?? "none"}.` };
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
  restoreMode: Schema.union(["safe", "force"]).default("safe"),
  preservePaths: Schema.array(Schema.string()).default(["node_modules"]),
  webHost: Schema.string().default("127.0.0.1")
});
function apply(ctx, config = {}) {
  const workDir = path7.resolve(process.cwd());
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
      const cwd = session.header.cwd ? path7.resolve(session.header.cwd) : workDir;
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
  ReflectionAdvisor,
  TimeMachinePlugin,
  TimeMachineService,
  WorkspaceDriftError,
  WorkspaceRestoreConflictError,
  apply,
  collectFailedTools,
  index_default as default,
  name
};
//# sourceMappingURL=index.js.map