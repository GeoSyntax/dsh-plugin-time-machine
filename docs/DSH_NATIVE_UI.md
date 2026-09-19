# DSH 原生消息操作集成边界

Time Machine 当前的可移植交互是 CLI、独立 Web Dashboard 和 REST API。DSH
Web 客户端源码已经提供了适合原生按钮的扩展点：
`conversation.chat.assistant-actions`。该 slot 的 owner 是当前 finalized
assistant 的 `messageId`，并且按 session 注入；它不是一个可以从服务端插件
直接注册的 Cordis host service。

## 当前状态

- 已支持：`GET /api/capabilities`、`/api/preview`、
  `/api/rewind`、`/api/external-effects/compensate`。
- 已支持：CLI `/tm-preview`、`/tm-rewind`、`/tm-fork`。
- 未承诺：在 DSH transcript 的 assistant action strip 中自动出现按钮。
- 兼容回退：用户可以从 DSH 打开独立 Dashboard，或执行 CLI 命令。
- 已提供：无 React/浏览器依赖的 `TimeMachineClient` companion contract（npm 子路径
  `dsh-plugin-time-machine/client`）；它封装
  status、capabilities、storage、DAG、diff、preview、rewind、fork、完整/选择性恢复、外部副作用记录/补偿和审计读取，并在客户端
  强制校验一次性 restore-plan 绑定。它不是原生 slot UI，也不会自动注入按钮。
- 已提供：`client.timeline(sessionId)` 和 `buildCompanionTimeline()` 纯数据投影；
  统一处理活动 lineage、相对 undo 编号、running/internal 节点和风险警告，供
  React slot 或独立 Dashboard 复用。
- 已提供：`GET /api/sessions` 与 `TimeMachineClient.sessions()`，用于原生 companion
  在多个真实 DSH session 之间发现和切换；Dashboard 也不再隐式创建 `default` DAG。
- 已提供：`webAllowedOrigins` 精确 Origin allowlist 和 CORS 响应头；默认仍拒绝跨源请求，
  只有部署者明确列出可信的本地 DSH client origin 后，companion 才能跨端口调用 REST API。

## 推荐的 client companion 设计

原生 client companion 应作为单独的 DSH Web client package 发布，并通过
`ctx.slots.inject('conversation.chat.assistant-actions', ...)` 注册，而不是把
React/DSH client 依赖塞进当前服务包。每个 action 必须：

1. 读取当前 session 的 checkpoint 列表和能力发现结果。
2. 在真正修改前调用 `/api/preview`，保存一次性、session-bound 的
   `restorePlanId`。
3. 展示 drift、冲突路径、partial checkpoint 的 `omittedPaths` 和外部副作用
   警告。
4. 只有用户明确选择后，才调用 `/api/rewind` 或 `/api/fork`，并携带该 plan。
5. 成功后显示新的 DSH session id；失败时保留 HTTP 状态和 rescue checkpoint
   信息，不自行猜测恢复成功。

## 为什么暂不内置

当前插件 manifest 只承诺 `web` profile 的服务能力，仓库没有 React、DSH
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
