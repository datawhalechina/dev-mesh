---
id: roadmap
title: 路线图
---

# 路线图

路线图来自项目 TODO 和技术设计文档，按产品能力分阶段推进。

## 阶段 0：产品骨架

- 建立 monorepo 和 library-first 包边界。
- 提供 CLI、Server、Admin、测试配置和基础文档。
- 明确 `.dev-mesh` 本地知识库结构。

## 阶段 1：核心 Server 能力

- Hub Server 项目、成员、邀请和同步 API。
- 管理后台和 Admin API。
- Hub 状态持久化。
- PostgreSQL 存储适配。

## 阶段 2：Mesh Client

- `dmx init`、`join`、`status`、`doctor` 等命令。
- 本地 MCP proxy。
- Codex、Claude Code、opencode 全局配置适配。

## 阶段 3：自动沉淀

- MCP 工具驱动的知识和任务沉淀。
- 本地审查队列。
- 知识质量评分、脱敏和搜索。
- 后续可扩展 Git 与文件事件触发。

## 阶段 4：团队化

- 成员经验检索。
- 项目 brief、术语和 canonical entry 管理。
- 更细粒度的权限、审计和运营视图。

## 阶段 5：分布式 Mesh

- 多 Hub 联邦同步。
- 冲突处理和同步状态机增强。
- 跨团队项目知识发现。

## 阶段 6：生产化

- 部署模板。
- 可观测性和诊断工具。
- 安全默认值和发布检查。
