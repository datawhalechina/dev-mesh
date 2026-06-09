---
id: knowledge-capture
title: 自动沉淀
---

# 自动沉淀

当前实现里的“自动沉淀”主要由 MCP 工具调用触发。它不是一个默认后台扫描整个项目的守护进程，而是让 AI 客户端在合适的时机调用 DevMesh 工具，把重要上下文写入项目。

## 三条路径

### MCP 工具驱动

这是当前最稳的路径。AI 客户端连接本地 MCP proxy 后，可以调用：

- `mesh_capture_knowledge`：沉淀架构决策、约定、术语、经验。
- `mesh_capture_task`：沉淀任务进展和交付记录。
- `mesh_search_context`：按关键词检索项目上下文。
- `mesh_scan_project_knowledge`：让 AI 客户端读取项目扫描信号后自行总结并沉淀。

检索命中会写入 `.dev-mesh/knowledge/usage/`，作为轻量 adoption 信号；inbox 接受会写入更强的 `review.accepted` usage 信号。usage 不会作为普通知识被检索，只用于质量分和后续排序反馈。

### CLI 手动验证

开发和调试阶段建议先用 `dmx capture` 写入一条知识，再用 `dmx search` 检查结果。这个流程能排除 AI 客户端配置问题。

```powershell
pnpm --filter devmesh dev -- capture --root $project --name local --title "API boundary decision" --summary "The local proxy owns MCP-facing tool contracts." --type decision --layer canonical --tag architecture
pnpm --filter devmesh dev -- search --root $project --query "local proxy"
```

### 审查队列

对于需要人工确认的知识，可以进入 `.dev-mesh/queue`，再由 inbox 命令接受或拒绝：

```powershell
pnpm --filter devmesh dev -- inbox --root $project
```

## 建议提示词

在 Codex、Claude Code 或 opencode 中接入 proxy 后，可以直接要求：

```text
请把这次实现里的长期项目知识沉淀到 DevMesh，包括关键决策、约定和后续注意事项。
```

或者更具体一些：

```text
请调用 DevMesh，把“服务端 env 配置优先级为 CLI > process env > env file”记录为 canonical decision。
```

## 验证位置

写入成功后，目标项目通常会出现或更新：

```text
.dev-mesh/
  knowledge/
    usage/
  events/
  queue/
```

再执行：

```powershell
pnpm --filter devmesh dev -- search --root $project --query "canonical"
pnpm --filter devmesh dev -- status --root $project
```
