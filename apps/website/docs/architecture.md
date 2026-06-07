---
id: architecture
title: 架构
---

# 架构

MCP Dev Mesh 采用 library-first 的 monorepo 结构。CLI、服务端、管理后台和本地运行时都复用底层包，避免把核心逻辑锁死在某一个入口里。

## 总体分层

```text
apps/
  dmx              CLI 客户端
  mesh-server      Hub Server 启动入口
  web-admin        管理后台
  website          VitePress 官网

packages/
  client           本地项目运行时、proxy、doctor、join
  server           Hub Server 核心能力
  local-store      .dev-mesh 文件知识库
  storage          PostgreSQL 存储适配
  mcp-contracts    MCP 工具契约
  extractor        知识抽取和脱敏
  search           本地检索
  adapters         Codex、Claude Code、opencode 配置适配
```

## 本地优先

项目知识先落到 `.dev-mesh`，因此它可以跟随仓库被检查、迁移和同步。本地 proxy 负责把 AI 客户端的 MCP 调用转换为项目级运行时操作。

## Hub Server

Hub Server 提供团队化能力：

- 项目和成员注册。
- 邀请 token 和 group 加入流程。
- 同步状态管理。
- Hub 状态持久化。
- 管理 API 和管理后台。
- JSON 文件或 PostgreSQL 存储。

## 数据流

```text
AI 客户端
  -> 本地 MCP proxy
  -> packages/client runtime
  -> .dev-mesh 本地知识库
  -> Hub Server 同步和团队检索
```

这个路径让离线开发、个人项目和团队协作共用一套知识模型。
