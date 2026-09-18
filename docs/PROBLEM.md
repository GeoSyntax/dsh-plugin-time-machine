# Problem statement

## 一句话定义

DSH 的会话状态是 append-only 事件历史，Agent 的工作区却是可变文件系统。一次可信的“回到过去”必须同时定位并协调这两个状态域，而不是只复制文件或只截断聊天记录。

可以把第 `n` 个 checkpoint 表示为：

```text
Cₙ = (Eₙ, Wₙ)

Eₙ: 可由 DSH fork 的稳定 Session 事件边界
Wₙ: 同一边界前捕获的工作区状态
```

回退成功不是把旧 Session 改写掉，而是创建 `fork(Eₙ)`，并让新会话看到恢复后的 `Wₙ`。任何一侧失败，都不能假装整个操作成功。

## 为什么普通 undo 不够

### 1. 会话和文件会产生 split-brain

只恢复文件时，模型上下文仍包含目标 checkpoint 之后的工具输出、错误推理和代码结构；只 fork 会话时，磁盘又保留了“未来”的新增、删除和重命名。两种做法都会让下一步推理建立在互相矛盾的事实之上。

### 2. “恢复旧文件”不等于“恢复旧目录”

完整恢复必须处理四类变化：已有文件修改、文件删除、文件新增，以及目录/符号链接变化。只备份修改前内容会遗漏新增文件，造成 orphan files。Ignored 文件更危险：它们可能是缓存，也可能是 `.env`、私钥或本地数据，既不能默认写入 Git object database，也不能被无提示删除。

### 3. 线性 rewind 会销毁探索信息

Agent 工作更接近搜索树，而非单向编辑历史。失败分支中的报错、工具输出和尝试路径仍然有价值。把第 3–5 步直接覆写掉，会同时丢失可恢复性和“为什么这条路不通”的证据。

### 4. 用户手改和 staging 不能成为附带损失

Checkpoint 后可能发生人类编辑，真实 Git index 中也可能有精心组织的 staged hunks。社区插件不能把 `git reset --hard` 或 `git clean -fd` 当成默认恢复协议；安全模式应该先检测漂移，再要求用户显式决定是否覆盖。

### 5. 两个持久化域不存在天然原子事务

工作区恢复和 Session fork 是两个独立操作。进程崩溃、会话 API 失败或并发请求都可能让它们停在不同状态。现实可行的语义是：操作串行化、回退前创建 rescue checkpoint、后半段失败时补偿恢复，并为将来的崩溃恢复日志预留格式。

## 生态边界

- [DSH Sessions](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md) 定义 append-only 历史，并提供稳定边界上的 Session fork；它不是工作区快照系统。
- [DSH Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) 明确鼓励通过 bundle/plugin 扩展能力，因此工作区协调适合作为第三方插件，而不是修改核心日志语义。
- [Hermes checkpoints and rollback](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/checkpoints-and-rollback.md) 已在 Hermes v2 提供 shadow Git checkpoints 和 `/rollback`。这证明需求真实，也意味着本项目不应宣称整个行业“官方都没有回滚”。
- [@anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) 等社区项目已覆盖大量恢复安全细节。本项目的价值应建立在可验证的差异上，而不是贬低已有实现。

## 本项目的社区定位

`dsh-plugin-time-machine` 是 DSH 的可选协调层：

1. 在 `agent/pre-step` 捕获工作区状态；
2. 保存可 fork 的稳定 Session 边界；
3. 以显式 DAG 保留平行探索；
4. 在回退前创建 rescue checkpoint，并在 Session fork 失败时补偿恢复；
5. 从被放弃的失败子树提取 reflection，减少重复踩坑。

它明确不做以下承诺：

- 不改写或删除 DSH 的 append-only Session 事件；
- 不替代正常 Git commit、远程备份或灾难恢复；
- 不把跨 Session/文件系统操作宣传为严格 ACID；
- 不默认删除 ignored 文件，也不默认覆盖 checkpoint 后的人类编辑；
- 不声称比 Hermes 或其他社区插件在所有场景更优。

## 成功标准

一个可面向社区发布的版本至少应满足：

- Session fork 与工作区恢复要么共同成功，要么可回到 rescue 状态；
- 已跟踪、未跟踪、删除、重命名和 symlink 行为有自动化测试；
- 真实 Git staging 在快照和恢复前后保持不变；
- ignored 文件删除必须显式选择，且先进入本地 quarantine；
- 并发 mutation 被串行化，持久化文件使用原子发布；
- 文档准确区分“已经实现”“计划实现”和“宿主能力限制”。
