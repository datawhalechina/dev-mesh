---
id: mcp
title: MCP 工具
---

# MCP 工具

DevMesh MCP server 通过 `dmx serve --mcp` 启动，也可以通过本地 `dmx proxy` 或 Hub Server 的 `/mcp` 暴露为 streamable HTTP MCP。工具返回值默认会组装成简短纯文本，减少 AI 客户端 token 消耗。

## 工具总览

| Tool | 用途 |
| --- | --- |
| `mesh_get_status` | 查看运行版本、模式、项目 store、daemon、自动化开关和知识计数。 |
| `mesh_search_context` | 在开始或继续非平凡项目工作前检索已有决策、约定、踩坑和交接。 |
| `mesh_get_knowledge` | 按 ID 获取一条知识的完整当前记录。 |
| `mesh_list_knowledge` | 按 layer、type、PARA、tag、作者、时间等过滤知识。 |
| `mesh_capture_knowledge` | 沉淀持久项目知识，例如决策、约定、命令、架构、踩坑、发布记录。 |
| `mesh_update_knowledge` | 更新已有知识条目。 |
| `mesh_delete_knowledge` | tombstone 一条知识，保留审计和同步历史。 |
| `mesh_capture_task` | 记录任务状态、阻塞、验证情况和后续动作。 |
| `mesh_rate_knowledge` | 对知识应用显式评分、采纳度、置信度或权重反馈。 |
| `mesh_link_knowledge` | 建立 `supersedes`、`duplicates`、`contradicts` 语义关系。 |
| `mesh_search_member_experience` | 按成员身份搜索经验。 |
| `mesh_resolve_term` | 查询项目词汇表，避免误解本地术语。 |
| `mesh_scan_project_knowledge` | 按需扫描项目高信号上下文，并提示模型选择值得沉淀的结论。 |
| `mesh_explore_knowledge_graph` | 探索知识图谱中的知识、PARA、tag、作者、来源和语义边。 |

## Assistant-led capture

DevMesh 的默认思路是让 Codex、Claude Code、opencode 自己判断什么时候沉淀知识。MCP tool descriptions 会强提示模型：

| 场景 | 推荐工具 |
| --- | --- |
| 开始非平凡项目工作 | `mesh_search_context` |
| 需要确认运行版本或配置 | `mesh_get_status` |
| 完成有价值的开发、调试、部署、文档或发布工作 | `mesh_capture_knowledge` 或 `mesh_capture_task` |
| 发现旧知识过期或错误 | `mesh_update_knowledge`、`mesh_delete_knowledge` 或 `mesh_rate_knowledge` |
| 发现重复、替代或冲突知识 | `mesh_link_knowledge` |

不要沉淀密钥、凭证、原始私密对话、大段源码、噪声日志，或代码里已经显而易见的事实。

## 输入参数

### `mesh_get_status`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `project` | `string` | `auto` | 项目 key 或自动识别。 |

### `mesh_search_context`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `query` | `string` | 必填 | 搜索词。 |
| `project` | `string` | `auto` | 项目 key。 |
| `authorName` | `string \| null` |  | 作者过滤。 |
| `para` | `{ category?, key? } \| null` |  | PARA 过滤。 |
| `layers` | `array` | `["canonical", "extract"]` | `raw`、`extract`、`canonical`。 |
| `types` | `string[]` |  | 类型过滤。 |
| `limit` | `number` | `8` | 1 到 20。 |
| `recencyDays` | `number` |  | 最近 n 天。 |
| `includeSuperseded` | `boolean` | `false` | 是否包含 superseded/tombstone。 |

### `mesh_get_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 知识 ID。 |

### `mesh_list_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `layers` | `array` |  | layer 过滤。 |
| `types` | `string[]` |  | type 过滤。 |
| `para` | `{ category?, key? } \| null` |  | PARA 过滤。 |
| `authorName` | `string \| null` |  | 作者过滤。 |
| `tags` | `string[]` |  | tag 过滤。 |
| `includeSuperseded` | `boolean` | `false` | 是否包含 superseded/tombstone。 |
| `recencyDays` | `number` |  | 最近 n 天。 |
| `limit` | `number` | `20` | 1 到 50。 |

### `mesh_capture_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `type` | `string` | 必填 | 知识类型，如 `decision`、`pitfall`、`release`。 |
| `title` | `string` | 必填 | 标题。 |
| `summary` | `string` | 必填 | 短摘要。 |
| `content` | `string` |  | 正文。 |
| `layer` | `raw \| extract \| canonical` | `extract` | 知识层级。 |
| `para` | `{ category, key }` |  | PARA 位置。 |
| `tags` | `string[]` | `[]` | 标签。 |
| `visibility` | `private \| project \| team \| org` | `project` | 可见性。 |
| `confidence` | `number` |  | 0 到 1。 |
| `weight` | `number` | `1` | 排名权重。 |
| `source` | `object` |  | 来源信息。 |
| `createdBy` | `object` |  | 成员身份。 |

### `mesh_update_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 知识 ID。 |
| `layer` | `raw \| extract \| canonical` |  | 新 layer。 |
| `entryKey` | `string` |  | 新 entry key。 |
| `type` | `string` |  | 新类型。 |
| `title` | `string` |  | 新标题。 |
| `summary` | `string` |  | 新摘要。 |
| `content` | `string \| null` |  | 新正文，`null` 表示清空。 |
| `para` | `{ category, key }` |  | 新 PARA。 |
| `tags` | `string[]` |  | 新标签列表。 |
| `source` | `object` |  | 新来源信息。 |
| `visibility` | `private \| project \| team \| org` |  | 新可见性。 |
| `status` | `active \| superseded \| tombstone` |  | 新状态。 |
| `confidence` | `number` |  | 0 到 1。 |
| `weight` | `number` |  | 权重。 |
| `reason` | `string` |  | 更新原因。 |

除 `id` 和 `reason` 外，至少要提供一个要更新的字段。

### `mesh_delete_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 知识 ID。 |
| `reason` | `string` |  | tombstone 原因。 |

### `mesh_capture_task`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 必填 | 任务标题。 |
| `summary` | `string` | 必填 | 状态摘要。 |
| `status` | `pending \| in-progress \| blocked \| done` | `in-progress` | 任务状态。 |
| `content` | `string` |  | 详细内容。 |
| `tags` | `string[]` | `[]` | 标签。 |
| `para` | `{ category, key }` |  | PARA 位置。 |

### `mesh_rate_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 知识 ID。 |
| `rating` | `number` |  | 0 到 1。 |
| `adoptionDelta` | `number` |  | -1 到 1。 |
| `confidenceDelta` | `number` |  | -1 到 1。 |
| `weightDelta` | `number` |  | -10 到 10。 |

### `mesh_link_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `kind` | `supersedes \| duplicates \| contradicts` | 必填 | 关系类型。 |
| `fromId` | `string` | 必填 | source 知识 ID。 |
| `toId` | `string` | 必填 | target 知识 ID。 |
| `reason` | `string` |  | 关系说明。 |
| `project` | `string` | `auto` | 项目 key。 |

### `mesh_search_member_experience`

继承 `mesh_search_context` 的所有字段，并额外要求：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `memberName` | `string` | 必填 | 成员显示名、handle 或身份线索。 |

### `mesh_resolve_term`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `term` | `string` | 必填 | 要解析的项目术语。 |
| `project` | `string` | `auto` | 项目 key。 |
| `limit` | `number` | `5` | 1 到 10。 |

### `mesh_scan_project_knowledge`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `limit` | `number` | `50` | 1 到 200。 |

### `mesh_explore_knowledge_graph`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `query` | `string` |  | 搜索并选择种子节点。 |
| `ids` | `string[]` |  | 知识 ID 种子。 |
| `depth` | `number` | `2` | 0 到 4。 |
| `limit` | `number` | `40` | 1 到 200。 |
| `nodeKinds` | `array` |  | `knowledge`、`para`、`type`、`tag`、`member`、`source`。 |
| `edgeKinds` | `array` |  | `authored_by`、`belongs_to_para`、`has_type`、`parent_para`、`sourced_from`、`tagged_with`、`supersedes`、`duplicates`、`contradicts`。 |
