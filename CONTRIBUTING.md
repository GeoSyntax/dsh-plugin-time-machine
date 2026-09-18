# Contributing

感谢你帮助完善 Time Machine。这个插件会操作真实工作区；安全性、可恢复性和诚实的文档优先于功能数量。

## 开始开发

要求 Node.js `^22.19 || >=24` 与 pnpm `10.29.1`：

```bash
pnpm install --frozen-lockfile
pnpm check
```

提交 PR 前还应运行：

```bash
pnpm audit --prod --audit-level=high
git status --short
```

仓库有意提交 `dist/`，让 DSH 通过 GitHub dependency 安装时不必执行构建脚本。修改 `src/` 或 Web client 后，请运行 `pnpm build` 并一并提交对应的 `dist/` 变更。

## 变更要求

- 修复恢复逻辑时，先加入能复现失败的测试。
- 不要在测试中对用户仓库运行 `git clean`、`reset --hard` 或修改全局 Git 配置。
- 新增 destructive option 时必须默认关闭、使用明确命名，并记录 rescue/recovery 行为。
- 修改 checkpoint 格式时，说明兼容性与迁移路径。
- 不把 roadmap 项写成已经交付的功能。
- Commit 建议使用 Conventional Commits，例如 `fix(git): preserve staged deletions`。

## Bug 报告

请说明 DSH、Node.js、Git、操作系统版本，后端类型（Git/fallback）、执行的命令、预期/实际结果，以及是否存在 checkpoint 后的手工编辑。不要上传 `.env`、私钥、Session 原文或 quarantine 内容。

涉及文件泄露、路径逃逸、任意文件删除或本地 Web 攻击的问题，请按 [SECURITY.md](SECURITY.md) 私下报告。
