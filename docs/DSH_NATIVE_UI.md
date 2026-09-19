# DSH 原生消息操作集成边界

Time Machine 当前的可移植交互是 CLI、独立 Web Dashboard 和 REST API。DSH
Web 客户端源码已经提供了适合原生按钮的扩展点：
`conversation.chat.assistant-actions`。该 slot 的 owner 是当前 finalized
assistant 的 `messageId`，并且按 session 注入；它不是一个可以从服务端插件
直接注册的 Cordis host service。

## 当前状态

- 已支持：`GET /api/capabilities`、`/api/checkpoint-for-message`、`/api/preview`、
  `/api/rewind`、`/api/external-effects/compensate`。
- 已支持：CLI `/tm-preview`、`/tm-rewind`、`/tm-fork`。
- 可选 companion 同时贡献 `conversation.session.header.actions` 和
  `conversation.chat.assistant-actions`：后者只在服务端能把 finalized assistant
  message（包括同一 turn 的工具循环中间消息）映射到 checkpoint 时出现，旧消息/内部消息会自动隐藏。
- 兼容回退：用户可以从 DSH 打开独立 Dashboard，或执行 CLI 命令。
- 已提供：无 React/浏览器依赖的 `TimeMachineClient` companion contract（npm 子路径
  `dsh-plugin-time-machine/client`）；它封装
  status、capabilities、storage、DAG、diff、preview、rewind、fork、完整/选择性恢复、外部副作用记录/补偿和审计读取，并在客户端
  强制校验一次性 restore-plan 绑定。它不是原生 slot UI，也不会自动注入按钮。
- 已提供：`client.timeline(sessionId)` 和 `buildCompanionTimeline()` 纯数据投影；
  统一处理活动 lineage、相对 undo 编号、running/internal 节点和风险警告，供
  React slot 或独立 Dashboard 复用。
- 已提供：`POST /api/undo` 与 `TimeMachineClient.undo()` 的相对 turn contract；
  它适合 CLI-like 快捷操作，面向确认型 UI 仍应先读取 timeline、调用 preview，
  再提交 session-bound restore plan 到 `/api/rewind`。
- 已提供：`GET /api/sessions` 与 `TimeMachineClient.sessions()`，用于原生 companion
  在多个真实 DSH session 之间发现和切换；Dashboard 也不再隐式创建 `default` DAG。
- 能力发现会返回 `rewindSessionMode: fork` 与 `workspaceIsolation: shared-lock`，让 UI
  明确提示“回滚会打开新会话，工作区仍由共享锁保护”，避免误解成 Hermes/Claude
  Code 式原地上下文回退或独立 worktree。
- `handEditPolicy: ledger-default` 表示服务端已启用
  `preserveVerifiedHandEditsByDefault`；companion 应在确认前提示已验证的人工修改会
  默认保留，并允许用户显式选择 `preserveVerifiedHandEdits: false` 的全量覆盖语义。
- 如果宿主额外提供 `sessionController.rewind({ sessionId, atSeq })`，插件会使用它并将
  `rewindSessionMode` 报告为 `in-place`；当前公开 DSH alpha 只提供 `fork`，因此默认仍是
  新 session，不会伪造原地上下文回退。
- 已提供：`webAllowedOrigins` 精确 Origin allowlist 和 CORS 响应头；默认仍拒绝跨源请求，
  只有部署者明确列出可信的本地 DSH client origin 后，companion 才能跨端口调用 REST API。
- 已加入：`client-companion/` 独立 React/slot 包源码，使用 `TimeMachineClient`
  timeline、消息级 preview、确认后的相对 undo 和 `uiWorkspace.openSession()` 导航；它只声明 DSH
  client peer dependencies，不会被主服务包加载。当前已用 DSH `0.1.6-alpha.2`
  依赖完成 typecheck、构建和 pack dry-run，且已在 `0.1.6-alpha.1` 临时隔离安装中
  通过双 slot smoke；仓库已配置 npm 发布流程与跨版本 slot CI，仍需首次 GitHub
  runner 执行并完成 npm 发布。

## Client companion 设计与当前实现

原生 client companion 作为单独的 DSH Web client package 发布，并通过
`ctx.slots.inject('conversation.session.header.actions', ...)` 注册，而不是把
React/DSH client 依赖塞进当前服务包。每个 action 必须：

1. 读取当前 session 的 checkpoint 列表和能力发现结果。
2. 在真正修改前调用 `/api/preview`，保存一次性、session-bound 的
   `restorePlanId`。
3. 展示 drift、冲突路径、partial checkpoint 的 `omittedPaths` 和外部副作用
   警告。
4. 只有用户明确选择后，才调用 `/api/rewind` 或 `/api/fork`，并携带该 plan。
5. 成功后显示新的 DSH session id；失败时保留 HTTP 状态和 rescue checkpoint
   信息，不自行猜测恢复成功。

## 为什么不内置到主服务包

当前插件 manifest 只承诺 `web` profile 的服务能力，主服务包没有 React、DSH
client SlotRegistry 或 UI locale 的运行时依赖。直接把按钮代码放入服务包会让
非 Web profile 在加载时失败，也会把“共享工作区加锁”误报成客户端级隔离。

## 验收标准

基于 `TimeMachineClient` 的 companion 可以独立发布后，至少需要覆盖：

- assistant action 在无 checkpoint、fallback 和 unsupported Git 状态下正确隐藏或禁用；
- 预览后工作区漂移会阻止提交并要求重新预览；
- merge/force 选择在 UI 中明确区分；
- partial checkpoint 的遗漏路径在确认前可见；
- fork 成功后 UI 导航到新的 session，而不是继续操作旧 session；
- DSH source smoke、Web client slot tests 和服务端全量 CI 同时通过。
