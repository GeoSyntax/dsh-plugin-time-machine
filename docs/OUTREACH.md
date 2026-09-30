# 社区推广与反馈手册

这份手册帮助维护者把 DSH Time Machine 从“已发布的第三方插件”推进到“有真实用户和可验证反馈的社区项目”。项目始终是非官方插件；社区投票、目录收录和第三方文章都不代表 DeepSeek 官方审核或背书。

## 官方 DSH 社区

- [Show Your Plugins Discussion #7191](https://github.com/deepseek-ai/deepseek-harness/discussions/7191)：项目展示、截图、安装命令和架构反馈。
- 发帖时保留 `DSH | Project Name | one-line description` 标题格式，并明确写出 `Unofficial community plugin`。
- 不要重复发帖刷屏；有新版本时编辑原帖或回复原帖，附上变更和兼容性证据。
- 维护者反馈应转化为具体 Issue、兼容性测试或设计提案，而不是只请求 Star。

## 独立目录

- [DSH Plugin Directory submission #247](https://github.com/alexchenzl/dsh-plugin-directory/issues/247)：提交根目录 Bundle、分类、单行描述和版本固定安装命令。
- 提交表单要求公开仓库、`package.json`、`dsh.bundle.patch` 和 patch 文件；它不是安全审计或官方认证。
- 目录仓库当前公开的 Actions 主要负责给提交打 `plugin-submission` 标签；不要把标签、Issue 保持打开或一次 CI 运行当作收录证明。
- 只有目录维护者在 Issue 中明确回复并提供目录条目链接，才记录为“已收录”；在此之前状态应写成“已提交，等待维护者处理”。
- 如果安装方式或版本改变，更新原提交，并保留提交时间和证据链接。

## 招募测试用户

优先招募 Windows、macOS、Linux 各至少一名用户。请让每位用户按固定流程测试：

1. 安装 `v0.2.0`；
2. 让 Agent 修改一个可丢弃的测试文件；
3. 运行 `/tm-list`、`/tm-preview` 和 `/tm-rewind`；
4. 新建一个文件后测试完整恢复是否清理孤儿文件；
5. 从旧 checkpoint 执行 `/tm-fork`；
6. 填写 DSH 版本、操作系统、安装结果、恢复结果和最困惑的步骤。

反馈中不要上传私有代码、密钥、真实 token 或业务数据。可以只提供最小复现仓库、脱敏日志和版本号。用户可以直接使用仓库的 [Community installation and rewind feedback 模板](../.github/ISSUE_TEMPLATE/community-feedback.yml) 提交结构化结果。

## 发布内容

每次公开推广都应包含：

- [v0.2.0 Release](https://github.com/GeoSyntax/dsh-plugin-time-machine/releases/tag/v0.2.0)；
- 版本固定的安装命令；
- 真实 Dashboard 截图或 60 秒内的 rewind/fork 视频；
- DSH、Node.js 和操作系统兼容范围；
- 明确的限制：共享 workspace、无法撤销外部副作用、npm 尚未发布；
- 反馈入口：[Issues](https://github.com/GeoSyntax/dsh-plugin-time-machine/issues) 和 [DSH Discussion #7191](https://github.com/deepseek-ai/deepseek-harness/discussions/7191)。

## 维护者检查表

- [ ] 新版本有 changelog 和 Release notes；
- [ ] README 的安装命令与 Release tag 一致；
- [ ] CI 通过后再宣传；
- [ ] 真实截图没有私密数据；
- [ ] 新用户反馈被归类为 bug、兼容性、文档或功能请求；
- [ ] 不把 Star、目录收录或社区 Upvote 描述成官方背书。
