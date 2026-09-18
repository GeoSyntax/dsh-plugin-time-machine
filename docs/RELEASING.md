# Release process

项目尚未发布到 npm。首次公开 release 与后续版本使用同一检查流程。

1. 从干净的 `main` 开始，确认 Node.js 与 pnpm 版本符合 `package.json`。
2. 更新 `package.json` 版本、`CHANGELOG.md`、兼容范围和必要的存储迁移说明。
3. 运行统一发布门禁：

   ```bash
   pnpm install --frozen-lockfile
   pnpm test:release
   ```

   `test:release` 会依次执行完整行为测试（测试数量随版本变化）、构建、打包清单、生产依赖审计和 `git diff --check`。

4. 确认 `pnpm build` 后 `dist/` 已同步，并审查 `pnpm pack --dry-run` 文件清单。
5. 在临时 DSH home/profile 中安装生成的 tarball，执行 `--dump-config`、创建 checkpoint、safe rewind、卸载 smoke test。
   仓库提供 `pnpm smoke:dsh` 作为 bundle/宿主加载的最小入口；它要求 PATH 中有 `dsh`，并使用临时 `DSH_HOME`，不会修改默认 profile。CI 会用声明的 DSH 版本执行这一步。
6. 在具备真实模型/无头 fixture 的环境中，再执行完整 turn lifecycle、Session fork、safe rewind 和 compensation 测试；bundle smoke 通过不等于恢复语义已被宿主端到端证明。
7. 提交 release 变更，创建 `vX.Y.Z` tag 与 GitHub Release；附上 tarball checksum 和已验证的 DSH/OS 矩阵。
8. 推送 `vX.Y.Z` tag 会触发 `.github/workflows/release.yml`：它会再次执行
   `pnpm test:release`、校验 tag 与 package version 一致，然后使用 npm
   provenance 发布。首次启用前，在仓库环境中配置 `NPM_TOKEN`，并确认 npm
   trusted publishing/2FA 策略；发布后从空 profile 重做一次 registry 安装验证。

如果任何恢复测试失败，不发布；不要仅通过改文档隐藏不兼容行为。
