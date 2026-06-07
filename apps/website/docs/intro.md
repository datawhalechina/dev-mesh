---
id: intro
title: 项目概览
slug: /intro
---

# MCP Dev Mesh

MCP Dev Mesh 是一个面向 AI 协作开发的上下文网络。它把项目里的任务、决策、术语、架构知识和成员经验沉淀到本地 `.dev-mesh` 目录，并通过 MCP 工具暴露给 Codex、Claude Code、opencode 等客户端。

## 解决什么问题

AI 编程助手通常擅长完成当前对话里的任务，但项目经验容易散落在聊天记录、临时笔记和个人记忆里。MCP Dev Mesh 的目标是让这些经验变成项目资产：

- 项目知识跟随仓库保存，而不是只留在某个工具里。
- 关键决策可以审查、评分、搜索和同步。
- 新成员和新会话可以快速拿到项目当前语境。
- 团队可以在 Hub Server 上共享项目、成员和知识状态。

## 当前能力

- `dmx` CLI 初始化项目级 `.dev-mesh` 知识库。
- 本地 MCP proxy 暴露 `mesh_capture_knowledge`、`mesh_capture_task`、`mesh_search_context` 等工具。
- 本地知识以文件形式保存，支持事件、索引、审查队列和搜索。
- Hub Server 提供项目、成员、邀请、同步、管理后台和持久化能力。
- 服务端支持 env file、JSON Hub 状态持久化和 PostgreSQL 存储。

## 推荐阅读

先从 [快速开始](./getting-started.md) 跑通最小链路，再阅读 [自动沉淀](./knowledge-capture.md) 理解工具调用边界。需要部署服务端时，参考 [部署指南](./deployment.md)。
