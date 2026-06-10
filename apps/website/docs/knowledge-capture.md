---
id: knowledge-capture
title: 自动沉淀
---

# 自动沉淀

当前实现里的“自动沉淀”主要由 MCP 工具调用触发。它不是一个默认后台扫描整个项目的守护进程，而是通过 MCP server instructions 和工具描述双层提示，让 AI 客户端在合适的时机调用 DevMesh 工具，把重要上下文写入项目。

## 三条路径

### MCP 工具驱动

这是当前最稳的路径。AI 客户端连接本地 MCP proxy 后，会先看到 DevMesh 的全局 instructions：在有意义的编码、调试、评审、设计、部署、发布或文档工作结束前，主动判断是否需要沉淀知识；再通过各个工具的 description 获得更具体的 capture checklist。可调用工具包括：

这些 MCP 工具返回给 AI 客户端的是精简纯文本摘要，而不是完整 JSON 对象；这样 Codex、Claude Code 或 opencode 可以直接阅读状态、id、摘要、质量信号和事件结果，不会因为结构化对象过大浪费上下文。

- `mesh_get_status`：检查当前 DevMesh MCP 版本、运行模式、项目根、知识数量，以及 stdio launcher 背后的共享 daemon 状态。
- `mesh_get_knowledge` / `mesh_list_knowledge`：按 id 或过滤条件查看已有知识条目，适合编辑、删除、链接前确认目标。
- `mesh_capture_knowledge`：沉淀架构决策、约定、术语、经验。
- `mesh_update_knowledge`：更新已有知识条目，写入同 id 的新版 JSONL 和 `knowledge.updated` 事件。
- `mesh_delete_knowledge`：把已有知识条目标记为 tombstone，默认检索不再返回，但保留审计和同步历史。
- `mesh_capture_task`：沉淀任务进展和交付记录。
- `mesh_link_knowledge`：把明确的替代、重复、冲突关系写入知识图谱。
- `mesh_search_context`：按关键词检索项目上下文。
- `mesh_scan_project_knowledge`：让 AI 客户端读取项目扫描发现项后自行总结并沉淀。
- `mesh_explore_knowledge_graph`：围绕条目、PARA、tag、作者、来源、类型，以及 `supersedes`、`duplicates`、`contradicts` 语义边探索关系子图。

检索命中会写入 `.dev-mesh/knowledge/usage/`，作为轻量 adoption 信号；inbox 接受会写入更强的 `review.accepted` usage 信号。usage 不会作为普通知识被检索，只用于质量分和后续排序反馈。

### CLI 手动验证

开发和调试阶段建议先用 `dmx capture` 写入一条知识，再用 `dmx search` 检查结果。这个流程能排除 AI 客户端配置问题。

```powershell
dmx capture --title "API boundary decision" --summary "The local proxy owns MCP-facing tool contracts." --type decision --layer canonical --tag architecture
dmx search "local proxy"
```

### 审查队列

对于需要人工确认的知识，可以进入 `.dev-mesh/queue`，再由 inbox 命令接受或拒绝：

```powershell
dmx inbox
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
dmx search "canonical"
dmx status
```
