# DSH 宿主验证报告

本报告记录 2026-09-30 在本地 `E:\desktop\dsh\deepseek-harness` 源码宿主上的验证结果。测试使用临时 `DSH_HOME`、临时 profile 和临时 workspace；没有把 API key 写入仓库或日志。

## 已通过：无模型 Bundle smoke

```powershell
$env:TM_DSH_SOURCE = 'E:\desktop\dsh\deepseek-harness'
pnpm smoke:dsh:source
```

结果：

```text
Source DSH plugin smoke passed.
```

这证明源码 CLI 能够创建 profile、安装当前仓库、解析 `dsh.bundle.patch`，在 dump-config 中激活 time-machine 配置，并挂载 DSH 原生文件工具包 `@deepseek-ai/dsh-tool-fs`。

## 尚未通过：真实模型 native write 链路

测试命令使用本地 OpenAI-compatible gateway：

```powershell
$env:TM_DSH_SOURCE = 'E:\desktop\dsh\deepseek-harness'
$env:TM_GEMINI_BASE_URL = 'http://127.0.0.1:8081/v1'
$env:TM_GEMINI_MODEL = 'gemini-3.8-flash'
$env:TM_DSH_LIVE = '1'
pnpm smoke:dsh:source
```

第一次运行因当前环境中的旧 API key 被 gateway 返回 `401 invalid api key`，没有进入模型断言。更换为用户提供的本地 gateway 凭据标识后，认证阶段通过，但模型没有调用测试要求的 native `write` 工具，因此预期的 `hello.txt` 没有生成，测试在文件断言处停止。为避免把“进程退出码为 0”误当成成功，smoke 脚本现在会在文件缺失时保留模型输出摘要；本次摘要是：`Sure. First, I'll need your permission to turn on the Linear app.`

另行对同一 gateway 的 OpenAI-compatible 接口做了只读能力探针：`GET /v1/models` 能列出 `gemini-3.8-flash`，带一个最小函数 schema 的 `chat/completions` 请求返回了标准 `tool_calls`。因此目前可以确认 gateway 具备通用函数调用能力，但尚不能确认它会把 DSH 的 `write(file_path, content)` 工具暴露给并驱动当前 DSH agent loop。

## 解释和边界

这不是插件功能通过的证据，也不是插件功能失败的证据。它说明：

- DSH 源码宿主和 Bundle 装载已经通过；
- 本地 gateway 可以被访问并完成认证；
- gateway 的通用 OpenAI-compatible 函数调用探针通过；
- 当前模型/gateway 组合没有稳定执行测试要求的 native tool call；
- 当前一次真实 DSH 响应还出现了与文件任务无关的外部 app 授权请求，说明路由/模型配置仍需隔离和确认；
- 在获得真实模型工具调用证据前，不能宣称“真实 DSH 模型端到端已通过”。

下一次真实模型验证应先确认 gateway 的 OpenAI-compatible tool-calling 支持、模型名称、实际路由（确保不是外部 app/连接器模型）和 DSH 工具选择策略，再重复 `test/smoke-dsh-source.mjs`。不要为了让测试变绿而删除 native-write 断言或把模型文本回复当作工具执行。

完整的服务层演示见 [DEMO_REPORT.md](DEMO_REPORT.md)，它与本报告不同：服务层演示不启动 DSH 模型宿主。
