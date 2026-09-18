# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)；pre-1.0 版本可能包含存储格式调整。

## [Unreleased]

### Added

- GitHub 社区协作、CI、安全报告与贡献文档。
- 可选 shadow object store、loose-object 回收、配额治理、历史压缩和 durable restore journal。
- 显式 `--repack-shadow` 私有 pack 重建，避免 shadow packed objects 长期残留。
- prune 时清理已不再被 DAG 引用的 ignored quarantine，避免 rescue 备份孤儿残留。
- 跨进程工作区锁，避免多个 DSH 实例并发覆盖同一工作区。

## [0.2.0] - 2026-09-18

### Added

- DSH `agent/pre-step` / `session/event` 生命周期接入与官方 Session fork 协调。
- Git plumbing 与普通目录双后端、DAG 分支、Reflection Advisor 和 loopback Web UI。
- Safe restore、rescue compensation、ignored quarantine、FIFO mutation lock 与原子 DAG 发布。

### Changed

- 命令统一使用 `/tm-*` 前缀。
- 文档修正 DSH、Hermes v2 与现有社区插件的真实能力边界。

### Security

- 隔离真实 Git index，校验 Host/Origin，限制 CSP，并避免动态 `innerHTML`。

## [0.1.0] - 2026-09-17

### Added

- 初始概念验证。

[Unreleased]: https://github.com/GeoSyntax/dsh-plugin-time-machine/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/GeoSyntax/dsh-plugin-time-machine/releases/tag/v0.2.0
