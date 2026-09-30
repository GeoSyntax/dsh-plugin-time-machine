# v0.2.0 本地综合演示报告

本报告记录 `test/live-demo.ts` 在 2026-09-30 的一次本地运行结果。它使用临时 Git 仓库和临时存储目录，不读取用户项目，也不连接真实 Redis、数据库或云服务。

## 运行方式

```bash
pnpm exec tsx test/live-demo.ts
```

运行环境：Windows 本地工作区、Node.js 当前项目运行时、临时 Git workspace。演示生成的 `DSH_HOME`、workspace 和 storage 在进程结束后清理。

## 结果

一次运行中 6 个步骤全部通过：

1. 创建 Turn 1 基线 checkpoint；
2. 记录 Redis 方案失败、stderr 摘要和临时文件；
3. 从 Turn 1 fork 到 `experiment/jwt-auth`，恢复基线并删除 `redis.config.ts` 和 `temp-logs/`；
4. 验证会话消息切片和 Reflection Advisor 的失败反思提示；
5. 创建 JWT 分支 checkpoint，并验证 Web `/api/status`、`/api/dag`、`/api/diff` 返回结果；
6. 输出包含失败节点、自动 rescue checkpoint 和新分支 HEAD 的 DAG tree。

演示输出的关键断言：

```text
✔ 完美回滚至 Turn 1
✔ 已被彻底原子清理抹除
✔ 精准切片回 Turn 1 (2条消息)
✔ 捕获到 1 处失败
✔ HTTP 200 OK (online)
✔ 拓扑树完整 (4个节点含救援点, 2个分支)
✔ 成功生成文件 Diff (user.service.ts)
```

## 证据边界

这是一条可重复的插件服务层和 Web REST 演示，不是完整 DSH 模型宿主验收。它证明 checkpoint、restore、fork、DAG、reflection 和 Web contract 在隔离临时 workspace 中协同工作；它不证明：

- 真实模型一定会选择正确的工具或命令；
- 数据库、网络请求、进程或云端副作用可以被文件恢复撤销；
- fork 会话具有独立 worktree 或容器隔离；
- 某个未来 DSH 版本保持相同的生命周期接口。

完整的 DSH source host、Bundle smoke、Web host 和失败注入验证见 [TEST_PLAN.md](TEST_PLAN.md)。对外分享时应同时给出这些限制，不要把本地演示描述为官方认证。
