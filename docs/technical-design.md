# DevMesh 技术设计文档

状态：Draft v0.1  
日期：2026-06-06  
项目名：`devmesh`
当前 npm CLI 包名：`devmesh`

## 1. 背景与目标

`DevMesh` 的目标是为多人协作开发中的 AI 编程工具建立一个分布式知识共享层。团队成员使用 Codex、Claude Code、opencode 等工具时，经常会产生以下上下文：

- 某个模块为什么这样设计
- 某个 Bug 是怎么定位和修复的
- 当前任务做到哪里，下一步是什么
- 团队约定的技术语言、命名、架构边界
- 某个命令、测试、部署流程的正确使用方式
- 某个开发工具踩坑经验

这些上下文通常散落在聊天记录、终端输出、PR、个人笔记、Issue、Git 提交中。`DevMesh` 通过 MCP 将这些上下文变成开发代理可检索、可引用、可沉淀、可同步的团队知识。

核心目标：

- 提供 MCP 服务端，让 Codex、Claude Code、opencode 等 MCP Host 能检索和写入项目知识。
- 提供 npm 安装的 `dmx` CLI，让成员一键安装、本机初始化，并按需加入指定服务器 IP / 域名和群组。
- `dmx init --global` 自动扫描本机已安装的 Codex、Claude Code、opencode 等编程工具，并通过 TUI 选择要注册的 MCP Host。
- 客户端默认自动为项目创建 `.dev-mesh/`，自动引用本地相关知识，自动沉淀项目经验；加入服务器群组后再自动同步到 DevMesh Server。
- 支持通过用户名称标识知识来源，例如“小云的前端样式设计经验”可以被精确检索和引用。
- 支持未加入服务器时的 local-only 模式，把 DevMesh 作为本地项目知识库使用。
- 支持分布式同步，先实现团队 Hub 模式，后续扩展为多节点 Mesh 联邦。
- 支持项目级权限、脱敏、审计和可追溯来源，避免把密钥、个人隐私、未确认结论错误扩散。
- 所有自动行为默认开启，但都可以在全局或项目级配置中关闭。

非目标：

- 不替代 Git、Issue、Wiki、PR 系统。
- 不默认上传原始对话全文。
- 不把所有本地文件自动索引到服务端。
- 不要求每个开发工具都支持相同的 Hook 能力。
- 不把 LLM 生成内容直接当作事实，必须记录来源、置信度和时间。

## 2. 核心概念

| 概念 | 说明 |
| --- | --- |
| Mesh Server | 团队共享服务端，提供 MCP、同步 API、检索、存储、权限和管理能力。 |
| Server Group | 服务端内的隔离空间，用于区分团队、部门、客户、项目集或实验环境；一个 Server 可承载多个 Group。 |
| Mesh Client | 安装在开发者机器上的本地客户端，负责工具接入、事件采集、脱敏、缓存和同步。 |
| Local MCP Proxy | 客户端在 `127.0.0.1` 暴露的本地 MCP 入口，Codex、Claude Code 等优先连接它。 |
| Local-only Mode | 未执行 `dmx join` 或未连接远端时的默认模式，只使用本机全局配置和项目 `.dev-mesh/` 进行知识沉淀、检索和自动引用。 |
| Project DevMesh Store | 项目根目录下的 `.dev-mesh/` 本地知识库，参考 CodeGraph 的项目级隐藏索引思路，用来沉淀项目知识、事件日志、检索索引和同步游标。 |
| Project Space | 一个仓库或工作区的知识空间，由 Git remote、repo root、可选 project key 共同识别。 |
| Member Identity | 人的身份，例如“小云”。用于标记知识作者、经验来源和检索过滤。 |
| Client Identity | 设备或客户端身份，例如小云的 Windows 笔记本。用于认证、同步和审计。 |
| Knowledge Garden | 数字花园式知识库，用 `raw / extract / canonical` 表达知识成熟度。 |
| PARA Index | 用 `projects / areas / resources / archives` 组织任务、领域、资源和归档知识。 |
| Canonical Entry | 稳定知识条目，例如 `areas/frontend/styles` 下的样式规范，由 extract 提炼、验证或聚合而来，可被 Agent 默认引用。 |
| Knowledge Item | 最小知识单元，例如技术决策、任务进度、坑点、命令、术语、约定。 |
| Knowledge Quality Signals | 知识质量信号，包括 `confidence`、`weight`、`rating`、`adoptionScore` 和派生的 `qualityScore`，用于表达可靠性、先进性、团队认可度、真实采纳情况和检索优先级。 |
| Context Pack | 检索返回给 Agent 的上下文包，包含摘要、来源、质量信号和引用链接。 |
| Adapter | 针对 Codex、Claude Code、opencode 等工具的配置写入和事件接入模块。 |
| Sync Cursor | 客户端和服务端之间的增量同步游标。 |

## 3. 总体架构

产品采用“项目本地 `.dev-mesh/` + 本地客户端 + 可选团队 Hub 服务端”的 local-first 模式。开发工具不直接写入远端服务，而是先连接本地客户端的 MCP Proxy。本地客户端把项目知识沉淀到当前仓库的 `.dev-mesh/`，未加入服务器时只做本地检索和沉淀；加入服务器群组后再按策略与服务端同步。

```text
Codex / Claude Code / opencode
        |
        | Streamable HTTP MCP
        v
Mesh Client on developer machine
  - Local MCP Proxy: http://127.0.0.1:8722/mcp
  - Tool adapters
  - Project scan providers
  - Redaction helpers
  - Project store manager
        |
        v
Project repository
  - .dev-mesh/
    - config.toml
    - knowledge/
    - events/
    - index/
    - sync/
        |
        | HTTPS sync API
        v
Mesh Server
  - Server groups for isolation
  - Remote MCP endpoint: /mcp
  - Knowledge ingestion
  - Hybrid search
  - Project registry
  - ACL and audit
  - Admin API
        |
        v
Storage
  - PostgreSQL + pgvector
  - Redis cache
  - Optional object storage
```

保留直接远程 MCP 模式：

```text
Codex / Claude Code / opencode -> https://devmesh.company.com/mcp
```

直接远程模式适合只检索、不需要本地自动沉淀的场景。需要自动沉淀时推荐安装 Mesh Client，并运行 `dmx init --global` 注册本机 MCP Host；项目级 `.dev-mesh/` 可由 Codex、Claude Code、opencode 打开项目时自动创建。

## 4. 技术栈建议

仓库建议采用 TypeScript monorepo：

```text
devmesh/
  apps/
    dmx/                    # CLI 可执行入口，依赖 @devmesh/client
    mesh-server/            # 服务端可执行入口，依赖 @devmesh/server
    web-admin/              # Vue 管理后台，依赖 server admin API
  packages/
    core/                   # @devmesh/core：纯领域模型和核心服务
    agent/                  # @devmesh/agent：Agent 上下文编排、引用策略、沉淀流程
    client/                 # @devmesh/client：daemon、local MCP proxy、CLI runtime
    server/                 # @devmesh/server：Hub server、sync/admin API、remote MCP
    extension-api/          # @devmesh/extension-api：稳定扩展接口
    registry/               # @devmesh/registry：扩展注册和能力发现
    mcp-contracts/          # @devmesh/mcp-contracts：MCP tool/resource/prompt schema
    protocol/               # @devmesh/protocol：Sync API types
    graph/                  # @devmesh/graph：知识条目派生关系图谱
    adapters/               # @devmesh/adapters：codex / claude / opencode adapters
    providers/              # @devmesh/providers：git / filesystem project scan providers
    redaction/              # @devmesh/redaction：内置脱敏
    quality/                # @devmesh/quality：confidence / weight / rating scorer
    search/                 # @devmesh/search：hybrid search, ranking, backend adapters
    local-store/            # @devmesh/local-store：.dev-mesh schema, migrations, indexer
    storage/                # @devmesh/storage：DB schema and repositories
    shared/                 # @devmesh/shared：logger, config, errors
  docs/
```

推荐技术：

| 层 | 技术 |
| --- | --- |
| 语言 | TypeScript |
| MCP SDK | 官方 MCP TypeScript SDK：`@modelcontextprotocol/sdk` |
| Server HTTP | Koa2 |
| 管理后台 | Vue 3 + Element Plus（或同级成熟 UI 组件库） |
| Client CLI | Node.js + Commander 或 Clipanion |
| Client daemon | Node.js detached child process，按项目由 stdio launcher 按需启动 |
| 项目本地知识库 | 项目根目录 `.dev-mesh/`，SQLite + JSONL event log + 可重建检索索引 |
| 客户端全局状态 | `~/.dev-mesh/`，保存设备身份、工具配置状态和跨项目缓存 |
| 服务端主存储 | PostgreSQL |
| 向量检索 | pgvector |
| 关键词检索 | PostgreSQL FTS 或 Tantivy 后续扩展 |
| 缓存 | Redis |
| 包管理 | pnpm workspace |
| 构建发布 | tsup / pkg / node SEA，后续提供平台二进制 |

实现约束：

- 服务端、客户端、共享包统一使用 TypeScript 开发。
- MCP Server、MCP Client / Proxy、tools、resources、prompts、transport 适配必须基于官方 MCP TypeScript SDK：`@modelcontextprotocol/sdk`。
- 不手写 JSON-RPC / MCP 协议实现，只在官方 SDK 之上封装项目级 contracts 和 adapters。
- Server HTTP 层使用 Koa2；Hub 业务、MCP tool 映射和权限规则必须放在 `packages/server` 的框架无关模块中，避免路由层承载业务规则。
- 核心流程只依赖 `packages/extension-api` 定义的接口，不直接依赖具体工具、模型、存储或检索实现。
- 新增开发工具、采集来源、知识类型、评分策略、检索后端时，应通过 registry 注册扩展，不修改核心编排服务。

日常开发规范见 [development-guide.md](./development-guide.md)。新增包、跨包依赖、public API、持久化 schema 或复杂注释策略时，应优先对照该指南，确保代码组织清晰、依赖不过度耦合、抽象不过早膨胀。

### 4.1 Library-first 分层包设计

`devmesh` 可以学习 `pi-core` / `pi-agent` 这类分层方式：产品入口是 `dmx`，但能力边界首先按可复用库设计。这样团队内部可以直接用 CLI，一些平台型开发者也可以把 DevMesh 嵌进自己的 Agent、IDE 插件、CI 工具或知识平台。

核心包职责：

| 包 | npm 包名 | 职责 | 不应该做什么 |
| --- | --- | --- | --- |
| `packages/core` | `@devmesh/core` | 纯领域模型、知识条目生命周期、PARA 索引、质量信号、repository/service 接口。 | 不依赖 MCP Host、CLI、daemon、HTTP Server 或具体开发工具。 |
| `packages/agent` | `@devmesh/agent` | 面向 AI Agent 的上下文包构建、自动引用策略、自动沉淀流程、工具调用策略、prompt helper。 | 不直接写 Codex/Claude/opencode 配置，不持有远端服务状态。 |
| `packages/client` | `@devmesh/client` | 本地 daemon、local MCP proxy、`dmx` runtime、全局/项目配置、join 状态、本地自动化调度。 | 不实现团队 Hub 业务，不把核心知识规则写死在 CLI 中。 |
| `packages/server` | `@devmesh/server` | Hub Server、远程 MCP endpoint、group/ACL、同步 API、审计和管理接口。 | 不承担本机工具扫描、项目文件监听、开发工具配置。 |
| `packages/extension-api` | `@devmesh/extension-api` | 对外稳定接口：Adapter、Provider、Redactor、Scorer、SearchBackend、StorageBackend、SyncBackend。 | 不依赖内置扩展实现，不泄漏内部服务细节。 |
| `packages/registry` | `@devmesh/registry` | 扩展注册、能力发现、优先级排序、配置 schema 校验。 | 不包含具体扫描、脱敏、检索算法。 |
| `packages/graph` | `@devmesh/graph` | 从 Knowledge Item 派生节点和边，支持关系探索和可重建 graph index。 | 不作为事实源，不直接写入 capture 事件。 |
| `packages/adapters` | `@devmesh/adapters` | 内置 Codex、Claude Code、opencode 等工具适配。 | 不定义通用扩展协议。 |
| `packages/providers` | `@devmesh/providers` | 内置 Git、文件系统等按需项目扫描来源。 | 不决定 canonical 团队事实。 |
| `packages/search` | `@devmesh/search` | 混合检索、排序、向量/关键词 backend adapter。 | 不直接读取项目文件或写入知识事件。 |
| `packages/quality` | `@devmesh/quality` | 置信度、权重、评分、引用后反馈、时效性等 scorer。 | 不直接删除或覆盖知识条目。 |

依赖方向必须保持单向：

```text
extension-api
  <- core
  <- agent
  <- client

extension-api
  <- registry
  <- adapters / providers / redaction / quality / search / storage

core <- graph
core <- server
core <- local-store
core <- storage

agent <- client
mcp-contracts <- client / server
protocol <- client / server
```

约束规则：

- `core` 是最稳定的领域层，只能依赖 `extension-api`、`shared` 和少量纯类型包。
- `agent` 依赖 `core`，负责把知识变成 Agent 可消费的 context pack，但不关心当前 Host 是 Codex 还是 Claude。
- `client` 依赖 `agent` 和 `core`，负责本机运行时、配置、自动化、local MCP proxy 和 `dmx` 命令。
- `server` 依赖 `core`，负责团队协作、同步、权限和远程 MCP；服务端不是客户端逻辑的超集。
- 具体扩展包只依赖 `extension-api`，必要时依赖 `shared` 类型，不能反向依赖 `client` 或 `server`。
- `apps/*` 只做启动、参数解析、依赖组装和进程生命周期，不承载核心业务。

开发者二次开发示例：

```ts
import { createDevMeshCore } from '@devmesh/core';
import { createAgentContextService } from '@devmesh/agent';

const core = createDevMeshCore({ projectRoot: process.cwd() });
const agent = createAgentContextService({ core });

const contextPack = await agent.buildContextPack({
  query: '前端样式设计经验',
  para: { category: 'areas', key: 'frontend/styles' },
  layers: ['canonical', 'extract']
});
```

自定义 scorer 示例：

```ts
import type { DevMeshExtension, ExtensionRegistry } from '@devmesh/extension-api';

export const domainFreshnessExtension: DevMeshExtension = {
  id: 'company.quality.domain-freshness',
  version: '0.1.0',
  kind: 'quality-scorer',
  capabilities: ['quality.score.freshness'],
  register(registry: ExtensionRegistry) {
    registry.registerScorer({
      id: 'company.domain-freshness-scorer',
      kind: 'quality-scorer',
      supports: item => item.para.category === 'areas',
      async score({ item }) {
        return {
          confidenceDelta: item.updatedAt < '2026-01-01' ? -0.1 : 0,
          reasons: ['domain freshness policy']
        };
      }
    });
  }
};
```

### 4.2 开发横向扩展设计

这里的横向扩展指“开发能力扩展”，不是服务端分布式扩容。目标是后续可以低成本增加新的开发工具、项目扫描来源、知识模型、评分算法、检索后端和同步目标。

核心原则：

- Core 不认识具体工具，只认识接口和 capability。
- Adapter 只负责工具接入，不写业务知识逻辑。
- Provider 只负责按需读取项目扫描上下文，不直接写 canonical。
- Scorer 只负责计算质量信号，不直接删除知识。
- SearchBackend 只负责召回，最终排序由统一 RankingService 完成。
- StorageBackend 只负责持久化，业务层通过 repository 接口访问。
- 所有扩展必须声明 `id`、`version`、`capabilities`、`priority` 和 `configSchema`。

建议扩展点：

| 扩展点 | 用途 | 示例 |
| --- | --- | --- |
| `ToolAdapter` | 接入新的 MCP Host 或开发工具。 | Codex、Claude Code、opencode、Cursor、VS Code 插件。 |
| `ProjectScanProvider` | 增加新的按需项目扫描来源。 | Git、文件系统、CI 摘要、Issue、PR。 |
| `Redactor` | 增加新的脱敏规则。 | Secret scan、PII scan、企业自定义客户数据规则。 |
| `QualityScorer` | 增加新的质量评分策略。 | adoption scorer、rating scorer、freshness scorer、domain expert scorer。 |
| `SearchBackend` | 增加新的检索实现。 | PostgreSQL FTS、pgvector、Tantivy、LanceDB、Elastic。 |
| `SyncBackend` | 增加新的同步目标。 | Hub server、Git-backed sync、object storage、未来 federation。 |
| `KnowledgeTypePlugin` | 增加新的知识类型和 schema。 | ADR、runbook、incident、style-guide、domain-model。 |

扩展加载方式：

```text
dmx starts
  -> load built-in extensions
  -> load workspace extensions from .dev-mesh/extensions
  -> load global extensions from ~/.dev-mesh/extensions
  -> validate extension manifest and configSchema
  -> register capabilities into ExtensionRegistry
  -> core services resolve implementations by capability and priority
```

扩展包可以是 monorepo 内置包，也可以是后续发布的 npm 包。内置 registry 是正式产品基础能力；第三方动态加载可以按安全策略逐步开放，但接口从一开始就按可外部化设计。

扩展示例 manifest：

```json
{
  "id": "devmesh.adapter.cursor",
  "version": "0.1.0",
  "kind": "tool-adapter",
  "entry": "./dist/index.js",
  "capabilities": ["tool.detect", "mcp.configure", "session.observe"],
  "priority": 50,
  "configSchema": {
    "type": "object",
    "properties": {
      "scope": { "type": "string", "enum": ["user", "project"] }
    }
  }
}
```

## 5. MCP 服务端设计

### 5.1 Transport

服务端必须支持 Streamable HTTP：

```text
POST /mcp
GET  /mcp
```

开发期可额外支持 stdio，方便本地调试：

```bash
dmx-server mcp-stdio
```

兼容策略：

- 新客户端默认使用 Streamable HTTP。
- 可选兼容旧 HTTP+SSE；正式产品以 Streamable HTTP 为默认兼容目标。
- 所有 MCP 请求都要绑定 team、project、member、client identity。

### 5.2 HTTP API

MCP 用于 Agent 交互，普通 HTTP API 用于安装、加入、同步、管理。

```text
GET  /healthz
GET  /.well-known/devmesh
GET  /api/v1/install
GET  /api/v1/groups
POST /api/v1/join
POST /api/v1/auth/rotate
POST /api/v1/sync/push
GET  /api/v1/sync/pull
GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/:id/brief
GET  /api/v1/admin/overview
GET  /api/v1/admin/groups
POST /api/v1/admin/groups
GET  /api/v1/admin/members
POST /api/v1/admin/members/:memberId/disable
GET  /api/v1/admin/invites
POST /api/v1/admin/invites
DELETE /api/v1/admin/invites/:token
GET  /api/v1/admin/projects
POST /api/v1/admin/projects
PUT  /api/v1/admin/projects/:groupKey/:id/acl
GET  /api/v1/admin/glossary
POST /api/v1/admin/glossary
PUT  /api/v1/admin/glossary/:id
GET  /api/v1/admin/knowledge
GET  /api/v1/admin/knowledge-edges
POST /api/v1/admin/knowledge-edges
GET  /api/v1/admin/quality-review
GET  /api/v1/admin/task-digest
GET  /api/v1/admin/review-queue
GET  /api/v1/admin/audit
```

`/.well-known/devmesh` 示例：

```json
{
  "serverName": "DevMesh",
  "serverId": "mesh_01J...",
  "baseUrl": "https://devmesh.company.com",
  "mcpUrl": "https://devmesh.company.com/mcp",
  "groups": {
    "required": true,
    "defaultJoinMode": "invite"
  },
  "install": {
    "npmPackage": "devmesh",
    "command": "npm install -g devmesh"
  },
  "minClientVersion": "0.1.0",
  "publicKeyFingerprint": "sha256:..."
}
```

`/api/v1/join` 请求示例：

```json
{
  "inviteToken": "inv_...",
  "groupKey": "frontend-team",
  "displayName": "小云",
  "handle": "xiaoyun",
  "clientLabel": "小云的 Windows 笔记本",
  "hostname": "DESKTOP-001",
  "tools": ["codex", "claude", "opencode"],
  "automation": {
    "autoInit": true,
    "autoReference": true,
    "autoSync": true
  }
}
```

`groupKey` 用于服务端群组隔离。同一个 Mesh Server 可以同时服务多个团队或项目集，例如 `frontend-team`、`backend-platform`、`customer-a`。客户端只同步已加入群组内授权项目的知识；未指定 `groupKey` 时，服务端可以根据 invite token 自动解析默认群组。

当前开发期 Hub Server 使用内存状态实现 invite、member、access token、group、project registry、knowledge edges 和 audit log：

- `/api/v1/join` 要求 `inviteToken`，token 绑定一个 group；请求里的 `groupKey` 必须与 invite 绑定的 group 一致。
- join 成功后返回 group-scoped Bearer token；后续 sync 和 projects API 必须携带 `Authorization: Bearer <token>`。`/api/v1/auth/rotate` 可用当前 Bearer token 换取新的 access token，并立即撤销旧 token；`/api/v1/admin/members/:memberId/rotate-token` 可由管理后台按 member 轮换 token；sync signing secret 保持稳定，避免破坏既有 signed event log 复验，rotation audit 不记录 token 明文。
- `/api/v1/sync/push` 和 `/api/v1/sync/pull` 已支持开发期内存 event log：事件按 group 隔离，cursor 使用 `cur_<groupKey>_<offset>`，重复 event id 幂等跳过，pull 只返回当前 group 的增量事件；服务端为接受的事件附加 `log.sequence`、`log.hash` 和可选 `log.previousHash`，并通过 `verifyHubSyncEventLog` 复验 append-only log 链、HMAC 签名和 verification failure audit；`knowledge.deleted` 事件必须携带 `{ knowledgeId, tombstone: true }` 并写入 tombstone audit，`replayHubSyncTombstones` 会把已存在的目标 knowledge 标记为 `tombstone` 并写入 replay audit；`knowledge.updated` 可携带 `{ knowledgeId, revisionId, conflict: true, reason? }` 表示离线分支，`replayHubSyncConflicts` 会为同一 base knowledge 的不同 revision 创建幂等 `contradicts` edge 并写入 replay audit；join 签发开发期 `syncSigningSecret`，带 `hmac-sha256` 签名的 sync event 会被校验，篡改或无效签名会被拒绝并写入 audit；`packages/server` 暴露 `federateHubSyncEvents` 和 `federateHubSyncEventsFromHttpPeer`，可在 HubState 之间或通过 `/api/v1/federation/sync-events` HTTP peer endpoint 按 peer/group cursor 增量复制事件并写入 federation / tombstone audit。
- `/api/v1/projects` 和 `/api/v1/projects/:id/brief` 只返回当前 token 所属 group 且 ACL 允许访问的项目；访问其他 group 或未授权项目返回 404，避免泄露 project id。project brief 会过滤其他 group 的非 org knowledge，但允许 `visibility: "org"` 的 canonical knowledge 作为组织级共享上下文进入已授权项目 brief。
- Admin API 支持创建或撤销 invite、禁用 member、按 member 轮换 access token、创建 group/project、配置 project ACL、管理 canonical glossary term、创建 supersede / duplicate / contradict edge、查询 quality review dashboard 和 task digest，并把这些写操作追加到 audit log；admin 创建 invite 未显式提供 `expiresAt` 时默认 24 小时后过期，显式 `expiresAt` / `maxUses` 仍会写入 audit；被禁用 member 的既有 Bearer token 会被拒绝。
- `MeshServerOptions.hubStatePath` 可把开发期 HubState 持久化到 JSON 文件；`MeshServerOptions.hubStateStore` 可接入自定义持久化 store。`packages/storage` 提供 `migratePostgresHubStateStore` 和 `createPostgresHubStateStore`，使用 PostgreSQL JSONB snapshot 跨重启恢复 groups、invites、members、tokens、projects、sync cursor 和 audit log。
- 内存 / JSON file 状态适合开发和 smoke test；PostgreSQL Hub state store 适合生产化部署边界，后续可继续演进为更细粒度的 normalized repository。
- `apps/mesh-server` 启动入口支持 CLI 参数、进程环境变量和 `--env-file`。CLI 参数优先于 `DEV_MESH_*` 环境变量，环境变量优先于 env file；配置 `DEV_MESH_POSTGRES_URL` 时会自动迁移 PostgreSQL knowledge repository，并在未配置 `DEV_MESH_HUB_STATE_PATH` 时接入 PostgreSQL Hub state store。

#### Server HTTP 框架选择

当前实现已经切换为 Koa2，并验证了 Hub API 与 MCP Streamable HTTP 的行为边界。服务端必须保持以下边界：

- Koa 只负责 request/response、路由、中间件、错误映射和生命周期，不承载 group、ACL、sync、MCP tool 映射等业务规则。
- `packages/server` 应保留框架无关的 Hub service / handler，Koa route 只调用这些业务函数。
- `/mcp` 仍必须基于官方 MCP TypeScript SDK 的 Streamable HTTP transport，不能手写 JSON-RPC。
- Koa 实现必须通过 integration test，覆盖 health、well-known、groups、join、projects、admin API、sync 和 MCP tools。

#### 管理后台和 Admin API

团队管理后台放在 `apps/web-admin`，建议使用 Vue 3 + Element Plus。它通过 server admin API 管理和查看团队数据，不直接访问数据库或本地 `.dev-mesh/` 文件。

首版页面范围：

- 概览：server health、版本、MCP endpoint、同步状态和最近错误。
- Groups / Members / Invites：查看 group、成员、client identity、token 过期时间、禁用状态和 invite 生命周期，并支持禁用 member、撤销 invite 和轮换 member token。
- Projects：查看 project、group 归属、ACL、project brief 状态，并支持 group/restricted visibility 与成员角色配置。
- Glossary：查看、筛选、创建和编辑 canonical glossary term，供 `mesh_resolve_term` 检索使用。
- Knowledge：查看 knowledge item、layer、PARA、来源成员、质量信号和 supersede/conflict 状态。
- Review Queue：查看待确认候选，支持接受、拒绝和填写原因。
- Audit Log：按 actor、group、project、action 和时间筛选审计记录。

前端验收要求：

- 所有列表必须有加载、空状态、错误状态和分页或虚拟滚动策略。
- 所有管理写操作必须有确认、失败提示和审计日志。
- UI 组件优先使用成熟组件库，不为常见表格、表单、弹窗、分页、筛选器重复造轮子。
- 前端测试至少覆盖路由 smoke、关键列表渲染、API 错误提示和基础权限失败状态。

### 5.3 MCP Tools

服务端和本地客户端都暴露同一套 MCP tools。客户端本地代理会把只读查询转发给服务端，把写入类请求先脱敏、排队、再同步。

当请求经过 Mesh Client 时，写入类 tool 的默认落点是当前项目的 `.dev-mesh/`。服务端同步是后续动作，不阻塞 Agent 的本地工作流。

MCP tool handler 内部可以返回结构化对象，但对 AI 客户端暴露的 `content` 统一由 `packages/mcp-contracts` 格式化为精简纯文本，避免把完整 JSON 对象塞进上下文。CLI 调试命令仍可按各自需要输出 JSON。

#### `mesh_get_status`

检查当前 DevMesh MCP 连接的版本、运行模式和项目知识库状态。通过 stdio launcher 连接时，返回体还会附加前台 proxy 和共享 daemon 的运行状态。AI 客户端可以在怀疑 MCP 配置、项目根、daemon 或版本不一致时先调用这个 tool。

```json
{
  "project": "auto"
}
```

返回示例：

```text
DevMesh status
service: devmesh
version: 0.1.2
mode: local-only
projectRoot: /repo/app
storeRoot: /repo/app/.dev-mesh
knowledgeItems: 12
autoInit: true
autoReference: true
autoSync: true
mcp: entrypoint=stdio-proxy
daemon: running=true, version=0.1.2, mcpUrl=http://127.0.0.1:8722/mcp
```

#### `mesh_search_context`

搜索项目上下文。

```json
{
  "query": "用户登录模块的鉴权约定是什么？",
  "project": "auto",
  "authorName": null,
  "para": {
    "category": "areas",
    "key": "backend/auth"
  },
  "layers": ["canonical", "extract"],
  "types": ["decision", "convention", "task", "pitfall"],
  "limit": 8,
  "recencyDays": 90,
  "includeSuperseded": false
}
```

返回：

```text
DevMesh context results
query: 用户登录模块的鉴权约定是什么？
generatedAt: 2026-06-06T09:30:00.000Z
items: 1
1. id=ki_01J... | 登录态统一通过 AuthSession 读取
   type=decision | layer=canonical | para=areas/backend/auth | qualityScore=0.82, confidence=0.86, rating=0.5
   summary: 后端和前端都避免直接解析 token，统一通过 AuthSession 抽象访问用户态。
```

#### `mesh_get_knowledge`

按 id 读取一条知识，适合在修改、删除、链接或引用前确认当前版本。

```json
{
  "id": "can_01J..."
}
```

#### `mesh_list_knowledge`

列出已有知识条目，可按 layer、type、PARA、tag、作者和更新时间过滤。默认只返回 active 条目；设置 `includeSuperseded: true` 时会包含 superseded 和 tombstone。

```json
{
  "layers": ["canonical"],
  "types": ["decision", "convention"],
  "para": {
    "category": "areas",
    "key": "backend/auth"
  },
  "tags": ["auth"],
  "authorName": "xiaoyun",
  "recencyDays": 90,
  "includeSuperseded": false,
  "limit": 20
}
```

#### `mesh_update_knowledge`

更新一条已有知识。JSONL 本地实现不会原地改写历史行，而是追加同 id 的新版知识，并写入 `knowledge.updated` 事件；读取时按 `updatedAt` 选择最新版。

```json
{
  "id": "can_01J...",
  "summary": "新的知识摘要。",
  "tags": ["auth", "session"],
  "confidence": 0.9,
  "reason": "旧摘要缺少 session 边界说明。"
}
```

#### `mesh_delete_knowledge`

删除使用 tombstone 语义：追加同 id、`status: "tombstone"` 的新版知识，并写入 `knowledge.deleted` 事件。默认搜索不返回 tombstone，审计、同步和历史回放仍可追溯。

```json
{
  "id": "can_01J...",
  "reason": "该约定已被后续决策替代。"
}
```

#### `mesh_capture_knowledge`

沉淀技术经验、决策、术语或踩坑。

```json
{
  "type": "pitfall",
  "layer": "extract",
  "para": {
    "category": "resources",
    "key": "platform/windows"
  },
  "entryKey": "resources/platform/windows/literalpath-safety",
  "title": "Windows 下路径需要使用 LiteralPath",
  "content": "递归移动或删除文件时必须先校验解析后的绝对路径，并使用 PowerShell 原生命令。",
  "project": "auto",
  "tags": ["windows", "filesystem", "safety"],
  "createdByName": "小云",
  "evidence": [
    {
      "kind": "conversation_summary",
      "ref": "local-session:..."
    }
  ],
  "visibility": "team",
  "confidence": 0.74,
  "weight": 1.0
}
```

#### `mesh_rate_knowledge`

对知识条目提交使用反馈。反馈不会直接覆盖知识内容，只会形成 rating event，并可能触发降权、复审或 supersede 建议。

```json
{
  "project": "auto",
  "knowledgeId": "can_01J...",
  "rating": "outdated",
  "score": -1,
  "reason": "这个约定只适用于旧版样式系统，新组件已经迁移到 design token v2。",
  "evidence": [
    {
      "kind": "file",
      "ref": "src/styles/tokens-v2.ts"
    }
  ]
}
```

#### `mesh_link_knowledge`

对已有知识条目创建明确的语义关系。当前支持 `supersedes`、`duplicates`、`contradicts`，本地实现写入 `.dev-mesh/knowledge/edges.jsonl`，Hub 实现写入 knowledge edges；`supersedes` 会把被替代条目标记为 superseded。

```json
{
  "project": "auto",
  "kind": "supersedes",
  "fromId": "ki_new",
  "toId": "ki_old",
  "reason": "新约定替代旧约定。"
}
```

#### `mesh_capture_task`

记录任务进度和交接信息。

```json
{
  "project": "auto",
  "taskKey": "AUTH-123",
  "status": "in_progress",
  "summary": "已完成服务端 token 校验，前端登录态刷新还未接入。",
  "nextSteps": ["补充前端 refresh 流程", "增加过期态测试"],
  "blockers": [],
  "changedFiles": ["src/auth/session.ts"]
}
```

#### `mesh_get_project_brief`

获取项目概要，适合 Agent 开始任务时调用。

返回内容包括：

- canonical 项目概要条目
- PARA projects 中的当前任务
- PARA areas 中的相关领域经验
- PARA resources 中的常用命令和团队术语
- 最近技术决策、易踩坑清单
- 最近活跃成员和交接摘要

#### `mesh_resolve_term`

解析团队统一技术语言。

示例：

```json
{
  "term": "session",
  "project": "auto"
}
```

> 当前实现中，下面早期规划的读取/改写类能力主要由 `mesh_get_knowledge`、`mesh_list_knowledge`、`mesh_update_knowledge` 和 `mesh_delete_knowledge` 承载；`mesh_get_para_index`、`mesh_get_canonical_entry`、`mesh_upsert_canonical_entry` 等名称保留为设计语义参考，不是现行 public MCP tool 名称。

#### `mesh_list_decisions`

按模块列出仍然有效的架构决策。

#### `mesh_get_para_index`

获取 PARA 索引，适合 Agent 了解任务、领域、资源和归档知识的组织方式。

```json
{
  "project": "auto",
  "category": "areas",
  "key": "frontend",
  "includeStats": true
}
```

#### `mesh_get_canonical_entry`

读取稳定知识条目。

```json
{
  "project": "auto",
  "para": {
    "category": "areas",
    "key": "frontend/styles"
  },
  "id": "can_01J...",
  "includeExtracts": true,
  "includeRawRefs": false
}
```

#### `mesh_upsert_canonical_entry`

创建或更新 canonical 稳定知识条目。低风险自动更新，高风险进入 review queue。

```json
{
  "project": "auto",
  "para": {
    "category": "areas",
    "key": "frontend/styles"
  },
  "title": "前端样式设计经验",
  "summary": "本项目样式优先使用设计 token 和组件级 class，避免局部深层覆盖。",
  "mergeMode": "append_or_summarize",
  "sourceExtractIds": ["ex_01J..."]
}
```

#### `mesh_report_progress`

生成面向人的任务进度摘要，可用于日报、周会、交接。

#### `mesh_search_member_experience`

按成员检索经验沉淀，适合类似“获取小云的前端样式设计经验”的请求。

```json
{
  "memberName": "小云",
  "query": "前端样式设计经验",
  "project": "auto",
  "types": ["convention", "pitfall", "decision", "bugfix"],
  "limit": 8
}
```

该 tool 内部等价于带 `authorName` 过滤的 `mesh_search_context`，但返回时会优先解释该成员的经验来源、适用范围和最近更新时间。

### 5.4 MCP Resources

建议资源 URI：

```text
mesh://project/{projectId}/brief
mesh://project/{projectId}/para/{category}/{key}
mesh://project/{projectId}/canonical/{id}
mesh://project/{projectId}/decisions
mesh://project/{projectId}/glossary
mesh://project/{projectId}/tasks/active
mesh://knowledge/{knowledgeId}
mesh://member/{memberId}/handoff
```

Resources 用于稳定、可订阅、可复用的上下文。Tools 用于搜索、写入和动态计算。

### 5.5 MCP Prompts

建议提供以下 Prompt templates：

| Prompt | 用途 |
| --- | --- |
| `mesh_start_task` | Agent 开始开发前检索项目背景、约定、相关任务。 |
| `mesh_handoff` | 生成交接说明并沉淀当前进度。 |
| `mesh_code_review_context` | Review 前检索相关决策、历史坑点和模块规范。 |
| `mesh_capture_decision` | 把一次讨论整理成结构化决策。 |
| `mesh_project_glossary` | 帮助统一项目术语。 |
| `mesh_canonical_entry` | 根据 PARA 归属生成或维护 canonical 稳定知识条目。 |
| `mesh_rate_knowledge` | 对知识条目的有用性、正确性或过时状态提交团队反馈。 |

### 5.6 Server Instructions

MCP 服务端应在 server instructions 中告诉 Agent 何时使用工具：

```text
Before starting non-trivial implementation, automatically call mesh_get_project_brief or mesh_search_context.
If the user asks for a named teammate's experience, call mesh_search_member_experience with memberName.
When you learn a durable project convention, decision, pitfall, command, or task handoff, automatically call mesh_capture_knowledge or mesh_capture_task.
After each meaningful interaction, code edit, command, review, or debugging step, decide whether the current context contains durable knowledge worth preserving; call capture tools only for concise, high-signal summaries.
When a project-wide sweep would help, call mesh_scan_project_knowledge on demand, inspect the returned highlights and relevant files, then capture only durable conclusions.
Classify durable knowledge into raw, extract, and canonical layers; attach it to the right PARA index.
When the user says a knowledge item is wrong, outdated, not advanced, or less useful, call mesh_rate_knowledge instead of silently ignoring it.
Do not store secrets, raw credentials, personal private data, or large source files.
Prefer concise summaries with provenance, confidence, weight, rating, and links to evidence.
```

这层设计让不同 MCP Host 在没有专用 Hook 时，也能通过模型自主工具调用实现默认自动引用和自动沉淀。

## 6. MCP 客户端设计

### 6.1 客户端职责

Mesh Client 是安装在每个开发者机器上的本地代理：

- 暴露 stdio MCP launcher：`dmx serve --mcp`
- launcher 按项目复用或拉起共享 daemon，daemon 内部提供本地 Streamable HTTP MCP endpoint
- `dmx init --global` 完成本机初始化、工具扫描和 stdio MCP 注册
- 一键加入指定 IP 或域名的 Mesh Server，并通过 group 隔离团队或项目集
- 通过 `--name` 绑定成员显示名称，作为知识作者和经验来源
- 未 join 时作为 local-only 本地知识库使用，仍可自动检索和沉淀本地 `.dev-mesh/`
- 后台 daemon 由前台 MCP launcher 按需 detached spawn，空闲后自动退出
- 自动扫描并配置 Codex、Claude Code、opencode
- Codex 打开项目时自动初始化或复用 `.dev-mesh/` 本地知识库
- 默认自动引用相关知识、自动沉淀经验、自动启动同步
- 采集 Git、任务、命令、Agent 会话摘要等事件
- 本地脱敏、去重、分类、生成候选知识
- 离线缓存和增量同步
- 提供 `dmx doctor` 检查配置是否正确

### 6.2 CLI 命令

NPM 包名：`devmesh`
安装后提供二进制命令：`dmx`

```bash
npm install -g devmesh
dmx init --global
dmx init --global --tools codex,claude,opencode --yes
dmx join 192.168.1.10:8721 --group frontend-team --name 小云 --token <invite-token>
dmx join https://devmesh.company.com --group frontend-team --name 小云 --handle xiaoyun --token <invite-token>
dmx init .
dmx serve --mcp --root .
dmx proxy --root . --port 8722
dmx configure codex --scope user
dmx configure claude --scope project
dmx configure opencode --scope project
dmx status
dmx doctor
dmx sync
dmx sync --project .
dmx index .
dmx capture --type decision --title "..."
dmx inbox
dmx config set automation.auto_sync false --project .
dmx config set reference.mode manual --project .
dmx logout
```

组合命令：

```bash
dmx init --global \
  --tools codex,claude,opencode \
  --auto-init \
  --auto-reference \
  --yes

dmx join 192.168.1.10:8721 \
  --group frontend-team \
  --name 小云 \
  --handle xiaoyun \
  --token <invite-token> \
  --auto-sync \
  --yes
```

也支持不预先全局安装的一次性 npm 执行：

```bash
npx -y devmesh@latest init --global --yes

npx -y devmesh@latest join 192.168.1.10:8721 \
  --group frontend-team \
  --name 小云 \
  --handle xiaoyun \
  --token <invite-token> \
  --yes
```

关闭默认自动化：

```bash
dmx config set automation.auto_init false --project .
dmx config set automation.auto_reference false --project .
dmx config set automation.auto_sync false --project .
```

### 6.3 NPM 一键安装、全局初始化和加入群组

推荐安装方式是 NPM。`npm install -g devmesh` 安装 `dmx` 命令；`dmx init --global` 完成本机初始化、扫描已安装编程工具，并把 MCP host 配置为启动 `dmx serve --mcp`；`dmx join` 只负责加入远端服务器的指定 group。未执行 `dmx join` 时，DevMesh 仍然以 local-only 模式运行，作为本地项目知识库使用。

Windows PowerShell：

```powershell
npm install -g devmesh
dmx init --global
dmx join 192.168.1.10:8721 --group frontend-team --name 小云 --handle xiaoyun --token <invite-token> --yes
```

macOS / Linux：

```bash
npm install -g devmesh
dmx init --global
dmx join 192.168.1.10:8721 --group frontend-team --name 小云 --handle xiaoyun --token <invite-token> --yes
```

生产环境可使用 npm 一行命令：

```bash
npm install -g devmesh && dmx init --global --yes && dmx join https://devmesh.company.com --group frontend-team --name 小云 --handle xiaoyun --token <invite-token> --yes
```

全局初始化流程：

```text
1. 用户运行 dmx init --global。
2. 客户端创建或迁移 ~/.dev-mesh/config.toml。
3. 客户端准备 stdio MCP launcher 命令：语义等同于 `dmx serve --mcp --name <name>`，生产安装场景优先写入当前 Node 可执行文件和解析后的 CLI 入口以避开 npm shell shim；由 MCP host 的当前工作目录决定项目根，只有显式传 `--root <project>` 时才固定项目根。
4. 客户端扫描本机已安装的编程工具：Codex、Claude Code、opencode。
5. 客户端打开基于 Clack prompts 的 TUI 选择页面，展示 detected / not found / already configured 状态。
6. 用户选择要注册 MCP 的工具和 scope，默认选中已安装且未配置的工具。
7. 客户端调用各工具 adapter，把 DevMesh MCP 写成 stdio command/args。
8. 客户端开启 auto_init、auto_reference；auto_sync 在未 join 时保持待机；助手自主沉淀由 MCP 工具强提示直接驱动。
9. 客户端执行 dmx doctor，验证 stdio launcher / daemon 状态和各工具配置。
10. 用户此时即使不 join，也可以在项目中自动创建 .dev-mesh/、沉淀本地知识并自动引用本地知识。
```

TUI 选择页面建议：

```text
DevMesh Global Init

Detected tools:
  [x] Codex        installed, not configured      scope: user
  [x] Claude Code  installed, already configured  scope: user
  [ ] opencode     not found

Automation: auto_init, auto_reference, and auto_sync are enabled by default.
MCP hosts run dmx serve --mcp; the launcher starts or reuses the project daemon on demand.

Keys: ↑/↓ move, Space toggle, s scope, Enter apply, q cancel.
```

当前实现进度：

- `dmx init --global` 已支持 `--tool codex --tool opencode`、`--tools codex,claude,opencode`、`--yes` / CI 默认全选，以及非 CI 终端下的 TUI 选择器。
- `packages/client` 负责工具别名归一化、默认选择、内置 adapter 检查和全局配置写入；`apps/dmx` 只做 CLI 参数收集。
- `~/.dev-mesh/config.toml` 已写入 `[tools]` 的 Codex / Claude Code / opencode 选择状态，`identity.json` 已记录 `selectedTools`、`localProxyUrl` 和每个 adapter 的 detected/configured/message/targetPath。
- `dmx join <server> --group <groupKey> --name <displayName>` 已支持 well-known discovery、invite token join、全局 `[[servers]]` / `[[groups]]` 写入和 join 后 `auto_sync` 开启；access token 只写入本机 `identity.json`，不写入 TOML。
- `dmx doctor` 已提供 store、privacy、sync、proxy/daemon、adapter 五类诊断，输出结构化 `checks`、`summary` 和可执行 `fixHint`；诊断逻辑位于 `packages/client`，CLI 只负责参数映射和输出。
- join 相关实现已按职责拆分：CLI 命令在 `apps/dmx/src/commands/join.ts`，client 编排在 `packages/client/src/join.ts`，HTTP discovery/join 在 `packages/client/src/join-http.ts`，全局配置落盘在 `packages/client/src/join-config.ts`，共享类型在 `packages/client/src/join-types.ts`。
- Codex、Claude Code 和 opencode adapter 已支持 detect、user/project scope configure、remove 和 doctor，并在测试中通过临时 HOME / config 目录隔离真实用户配置。TUI 已支持 detected/configured 状态展示、键盘 toggle、scope 切换和取消。

加入群组流程：

```text
1. 用户输入 IP、域名或 invite link，并指定 --group 或由 invite token 自动解析 group。
2. 客户端请求 /.well-known/devmesh。
3. 客户端展示 serverName、fingerprint、baseUrl 和目标 group。
4. 用户确认或 --yes 自动确认。
5. 客户端用 invite token、groupKey 和 --name 调用 /api/v1/join。
6. 服务端在指定 group 内创建或绑定 Member Identity，例如 displayName=小云。
7. 服务端签发 group-scoped clientId、device key、access token。
8. 客户端写入 ~/.dev-mesh/config.toml 的 [[servers]] / [[groups]] 配置。
9. 客户端开启 auto_sync，并按 group ACL 拉取授权项目知识。
10. 客户端执行 dmx doctor，验证远端连接、group 权限和同步状态。
```

### 6.4 配置文件分层

DevMesh 有两层配置：

- 全局配置：`~/.dev-mesh/config.toml`，由 `dmx init --global` 自动创建，描述本机 daemon、工具注册状态、默认自动化策略，以及可选的服务器和群组连接。
- 项目配置：`<project>/.dev-mesh/config.toml`，由 Codex 打开项目或 `dmx init .` 自动创建，描述当前项目身份和项目级覆盖策略。

配置优先级：

```text
CLI flags > project .dev-mesh/config.toml > global ~/.dev-mesh/config.toml > built-in defaults
```

#### 全局配置：`~/.dev-mesh/config.toml`

全局配置不提交到项目仓库，负责记录“这台设备怎么工作、哪些工具已注册、是否加入远端群组”。未 join 时，`servers` 和 `groups` 可以为空。

```toml
local_mcp_url = "http://127.0.0.1:8722/mcp"
client_label = "小云的 Windows 笔记本"
local_identity_id = "local_01J..."

[automation]
auto_init = true
auto_reference = true
auto_sync = true

[redaction]
enabled = true
secret_scan = true
pii_scan = true

[tools]
codex = true
claude = true
opencode = true

[[servers]]
server_id = "mesh_01J..."
server_url = "https://devmesh.company.com"
client_id = "client_01J..."

[[groups]]
server_id = "mesh_01J..."
group_id = "group_01J..."
group_key = "frontend-team"
member_id = "member_01J..."
display_name = "小云"
handle = "xiaoyun"
auto_sync = true
```

#### 项目配置：`.dev-mesh/config.toml`

项目配置可以提交，但不能包含密钥、token、个人私有信息。`root` 是自动生成字段，用于让 `dmx` 定位项目根目录，用户通常不需要手动填写。

```toml
schema_version = 1
project_id = "project_01J..."
project_key = "org/repo"
root = "C:\\Users\\alice\\work\\repo"
git_remote = "git@example.com:org/repo.git"
store_dir = ".dev-mesh"

[automation]
auto_init = true       # Codex/Claude/opencode 打开项目时自动创建 .dev-mesh/
auto_reference = true  # Agent 开始任务和编辑前自动引用相关知识
auto_sync = true       # 已 join 时本地知识变化后自动同步到对应 Server Group；未 join 时待机

[capture]
mode = "auto" # off | reviewed | auto
include_transcripts = false
include_git_diff_summary = true
max_evidence_chars = 4000

[reference]
mode = "auto" # off | manual | auto
local_first = true
remote_fallback = true
max_items = 8

[sync]
enabled = true
mode = "auto" # manual | interval | auto
debounce_seconds = 10
interval_seconds = 60
```

项目配置中的 `auto_sync = true` 表示“允许同步”。实际是否推送由全局配置中的 joined groups、项目 ACL 和远端连接状态共同决定；未 join 时不会上传任何知识。

### 6.5 项目级 `.dev-mesh/` 本地知识库

`.dev-mesh/` 是本项目最重要的本地状态目录，定位类似 CodeGraph 在每个项目内维护的隐藏索引目录：它让项目知识先在当前仓库附近沉淀，再通过 MCP Client 与团队服务端同步。

建议目录结构：

```text
.dev-mesh/
  config.toml              # 可提交：项目级连接和策略，不含密钥
  manifest.json            # 可提交：store schema、project identity、兼容版本
  knowledge/
    raw/
      2026-06.jsonl         # 不提交：原始事件、命令摘要、会话摘要、Git 摘要
    extract/
      decisions.jsonl       # 可选提交：从 raw 提炼出的决策片段
      conventions.jsonl     # 可选提交：从 raw 提炼出的规范片段
      pitfalls.jsonl        # 可选提交：从 raw 提炼出的踩坑片段
      tasks.jsonl           # 可选提交：已审查的任务过程片段
      local.jsonl           # 不提交：个人本地提炼
    canonical/
      entries.jsonl         # 可选提交：团队稳定知识条目，协作中心
      views/
        areas/
          frontend/
            styles.md       # 可选提交：从 entries 导出的阅读视图，不作为事实源
        resources/
          glossary.md       # 可选提交：从 entries 导出的术语视图
    ratings/
      2026-06.jsonl         # 不提交：知识评分和过时/错误反馈事件
    usage/
      2026-06.jsonl         # 不提交：知识被引用后的采纳、修改、回滚和对话纠正信号
    para/
      projects.json         # 可选提交：任务/项目索引
      areas.json            # 可选提交：长期领域索引
      resources.json        # 可选提交：资料/主题索引
      archives.json         # 可选提交：归档索引
  queue/
    pending.jsonl           # 不提交：待 review / 待同步项目
  index/
    mesh.sqlite             # 不提交：本地检索、去重、embedding metadata
    graph.json              # 不提交：从知识条目派生的本地关系图谱索引
    fts/                    # 不提交：可重建关键词索引
    vector/                 # 不提交：可重建向量索引
  sync/
    cursors.json            # 不提交：服务端同步游标
    remotes.json            # 不提交：远端节点状态
  secrets/
    device.key              # 不提交：设备密钥或本地 token 引用
```

推荐 `.gitignore`：

```gitignore
.dev-mesh/daemon.json
.dev-mesh/daemon.pid
.dev-mesh/events/
.dev-mesh/queue/
.dev-mesh/index/
.dev-mesh/sync/
.dev-mesh/secrets/
.dev-mesh/knowledge/raw/
.dev-mesh/knowledge/ratings/
.dev-mesh/knowledge/usage/
.dev-mesh/knowledge/extract/local.jsonl
```

可以提交的文件必须满足两个条件：

- 不含密钥、token、个人私有对话、客户数据。
- 是项目级公共知识，例如 canonical 稳定条目、PARA 索引、精选 extract、术语表、开发规范或 bootstrap 配置。

`dmx init .` 负责创建 `.dev-mesh/`，`dmx index .` 负责从 JSONL 重建本地 SQLite / FTS / vector 索引，`dmx sync --project .` 负责与服务端增量同步。

本地 store 的写入原则：

- 所有 Knowledge Item 使用 ULID，便于跨端合并。
- `raw/` 保存低加工原始材料，默认不提交、不直接喂给 Agent。
- `extract/` 保存从 raw 中提炼出的片段，带作者、证据、置信度和 PARA 归属。
- `canonical/` 保存稳定知识条目，是 Agent 默认引用的主知识层；Markdown 只作为可读视图，不是协作事实源。
- `ratings/` 保存知识反馈事件，用于计算 rating 和 qualityScore；团队可以选择只同步不提交到 Git。
- `usage/` 保存知识引用后的隐式反馈事件，用于计算 adoptionScore；默认不提交到 Git，只同步脱敏摘要。
- `para/` 保存 Projects、Areas、Resources、Archives 四类索引，负责把任务和领域串起来。
- `index/` 永远可重建，不作为事实来源。
- `queue/` 是用户 review 和网络失败重试的缓冲区。
- `config.toml` 只放项目级策略，个人身份放在 `~/.dev-mesh/` 或系统凭据库。

### 6.6 Local-only 模式

用户只执行 `npm install -g devmesh` 和 `dmx init --global`，但没有执行 `dmx join` 时，DevMesh 进入 local-only 模式：

- Codex、Claude Code、opencode 仍然连接本地 MCP Proxy。
- 打开项目时仍然自动创建或复用 `.dev-mesh/`。
- 自动引用只检索本项目 `.dev-mesh/index`、`.dev-mesh/knowledge` 和本机全局缓存。
- 自动沉淀仍然写入本地 raw / extract / canonical entries。
- `auto_sync` 默认待机，不推送到任何远端服务器。
- 后续执行 `dmx join` 后，已沉淀的本地知识可以按策略进入 review 或同步队列。

local-only 适合个人项目、离线开发、尚未获得服务器 invite token 的新成员，以及不希望共享到团队的实验性知识库。

### 6.7 默认自动化运行机制

`dmx init --global` 完成后，默认进入本地自动模式。用户使用 Codex、Claude Code 或 opencode 打开任意项目时，不需要手动执行 `dmx init .`。执行 `dmx join` 加入服务器群组后，`auto_sync` 才会把已确认知识同步到远端。

自动初始化流程：

```text
Codex opens project
  -> Codex initializes DevMesh MCP server
  -> Local MCP Proxy resolves project root
  -> ensureProjectStore(projectRoot)
  -> create or migrate .dev-mesh/
  -> start project watchers
  -> pull remote knowledge when joined
  -> rebuild local index
  -> expose project brief and relevant context
```

项目根目录识别顺序：

1. MCP Host 提供的 roots / workspace 信息。
2. MCP tool 参数中的 `project: "auto"`。
3. 当前进程工作目录和最近活跃 Git 仓库。
4. `.dev-mesh/manifest.json` 或 Git remote 匹配。

默认自动项：

| 自动项 | 默认 | 行为 |
| --- | --- | --- |
| `auto_init` | 开启 | Codex、Claude Code、opencode 打开项目时自动创建或迁移 `.dev-mesh/`。 |
| `auto_reference` | 开启 | Agent 开始任务、进入编辑或提出技术问题时，优先引用本地 `.dev-mesh/index`；已 join 时可 fallback 到远端知识。 |
| `auto_sync` | 未 join 时待机，join 后开启 | 本地知识 committed 后自动 debounce 推送到已加入的 Server Group，并定期拉取同组成员经验。 |

自动引用路径：

```text
Agent starts task
  -> mesh_get_project_brief(project=auto)
  -> mesh_search_context(query, project=auto)
  -> local index first
  -> remote fallback when joined
  -> merge member-specific experience
  -> return compact Context Pack
```

自动沉淀路径：

```text
Assistant handles task context
  -> mesh_search_context when prior knowledge may help
  -> optional mesh_scan_project_knowledge for an on-demand project sweep
  -> assistant summarizes durable knowledge itself
  -> mesh_capture_knowledge / mesh_capture_task
  -> Redaction
  -> local .dev-mesh knowledge and event log
  -> Sync manager pushes committed events when joined
```

关闭自动化可以使用 CLI 或直接修改配置：

```bash
dmx config set automation.auto_init false --project .
dmx config set automation.auto_reference false --project .
dmx config set automation.auto_sync false --project .
```

### 6.8 Codex Adapter

客户端优先通过 Codex CLI 添加远程 MCP：

```bash
codex mcp add devmesh --url http://127.0.0.1:8722/mcp
```

如果服务端要求 bearer token：

```bash
codex mcp add devmesh \
  --url http://127.0.0.1:8722/mcp \
  --bearer-token-env-var DEV_MESH_MCP_TOKEN
```

Adapter 职责：

- 检测 `codex` 是否存在。
- 运行 `codex mcp list` 判断是否已配置。
- `dmx init --global` 的 TUI 选择 Codex 后，默认使用 user scope 配置 Codex 的 `devmesh` MCP server。
- 使用 `codex mcp add` 或 `codex mcp remove && codex mcp add` 更新配置。
- Codex 初始化 MCP 会话时，Local MCP Proxy 根据 roots / project auto 参数自动调用 `ensureProjectStore(projectRoot)`。
- Codex 打开新项目后自动启动 watcher、索引和同步，不要求用户手动执行 `dmx init .`。
- 不直接覆盖用户现有 MCP 配置。
- 可选写入项目 `.codex/config.toml`；产品默认优先通过 Codex CLI 用户级配置完成 MCP 注册。
- 可选向项目 `AGENTS.md` 追加受控区块，强化 Agent 使用 DevMesh；默认自动引用不依赖该文件。

`AGENTS.md` 可选受控区块：

```md
<!-- devmesh:start -->
Before non-trivial work, automatically query DevMesh for project decisions, conventions, teammate experience, and active task context.
When a durable project decision, pitfall, command, or handoff is discovered, automatically capture it with DevMesh.
Do not capture secrets or raw private conversation.
<!-- devmesh:end -->
```

### 6.9 Claude Code Adapter

Claude Code 支持通过 CLI 添加 HTTP MCP，并支持 project scope。项目级配置会写入项目根目录 `.mcp.json`。

```bash
claude mcp add \
  --transport http \
  --scope project \
  devmesh \
  http://127.0.0.1:8722/mcp
```

也可以使用 user scope：

```bash
claude mcp add \
  --transport http \
  --scope user \
  devmesh \
  http://127.0.0.1:8722/mcp
```

项目级 `.mcp.json` 示例：

```json
{
  "mcpServers": {
    "devmesh": {
      "type": "http",
      "url": "http://127.0.0.1:8722/mcp"
    }
  }
}
```

Adapter 职责：

- 检测 `claude` 是否存在。
- 优先通过 `claude mcp add` 写配置。
- 如果用户选择 project scope，确保 `.mcp.json` 是可提交但不含密钥。
- Token 通过环境变量或本地安全存储注入，不写入仓库。
- 调用 `claude mcp list` 做验证。

### 6.10 opencode Adapter

opencode 可在配置的 `mcp` 字段中定义本地或远程 MCP。项目级配置建议写入 `opencode.json` 或 `opencode.jsonc`。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "devmesh": {
      "type": "remote",
      "url": "http://127.0.0.1:8722/mcp",
      "enabled": true
    }
  },
  "permission": {
    "devmesh_*": "ask"
  }
}
```

Adapter 职责：

- 检测项目是否已有 `opencode.json` 或 `opencode.jsonc`。
- 使用 JSONC parser 修改配置，保留注释。
- 只修改 `mcp.devmesh` 和可选 `permission.devmesh_*`。
- 不覆盖其他 MCP server。

## 7. 自动沉淀项目知识

自动沉淀不是把所有聊天和代码全量上传，而是由 Agent 结合当前上下文主动写入结构化知识，DevMesh 负责本地落库、脱敏、去重、检索和同步。

### 7.1 三层沉淀机制

#### 第一层：MCP 工具驱动

Agent 在工作过程中主动调用：

- `mesh_get_status`
- `mesh_search_context`
- `mesh_search_member_experience`
- `mesh_get_knowledge`
- `mesh_list_knowledge`
- `mesh_capture_knowledge`
- `mesh_update_knowledge`
- `mesh_delete_knowledge`
- `mesh_capture_task`
- `mesh_rate_knowledge`
- `mesh_link_knowledge`
- `mesh_resolve_term`
- `mesh_scan_project_knowledge`
- `mesh_explore_knowledge_graph`

这层跨工具最稳定，因为 Codex、Claude Code、opencode 都能通过 MCP tools 与服务端交互。

#### 第二层：工具 Adapter 和 Hook 驱动

当具体工具支持生命周期 Hook、配置指令、插件或本地事件时，Adapter 注入：

- session start：自动查询 project brief
- pre edit：查询模块相关约定
- post edit：记录改动摘要
- command result：记录失败命令和修复经验
- session end：生成 handoff 候选

由于不同工具 Hook 能力不同，Adapter 必须是能力检测式设计：

```text
supportsMcp = true
supportsHooks = detected
supportsProjectConfig = detected
supportsSessionExport = opt-in only
```

#### 第三层：Git 和文件事件驱动

客户端独立观察项目工作区：

- Git branch、commit、diff stat
- changed files
- package manager scripts
- test command result
- issue key from branch or commit
- TODO / FIXME changes
- docs and config changes

客户端不会根据这些事件自动生成候选摘要。`mesh_scan_project_knowledge` 只在 AI 客户端主动调用时返回结构化发现项，例如：

```text
发现 src/auth/session.ts 和 tests/auth/session.test.ts 被修改；
分支名包含 AUTH-123；
测试命令 pnpm test auth 通过；
AI 客户端判断是否值得沉淀；
需要沉淀时调用 mesh_capture_knowledge 或 mesh_capture_task。
```

当前内置 Git provider 已输出结构化 `git.snapshot`，包含 branch、HEAD commit、HEAD subject、changed files、diff stat、issue keys 和可选测试摘要，但不包含完整 diff 内容。当前内置 filesystem provider 已输出结构化 `filesystem.snapshot`，只包含相对路径、mtime、大小、文件类别、TODO/FIXME 计数和过滤统计，并默认按 `.meshignore`、`.env`、credential 文件和 secrets 路径阻断敏感内容。

### 7.2 助手主导沉淀流水线

```text
AI client handles task context
  -> Search existing context when useful
  -> Optional mesh_scan_project_knowledge
  -> Assistant summarizes durable knowledge
  -> mesh_capture_knowledge / mesh_capture_task
  -> Secret and PII Redaction
  -> Local knowledge/event log
  -> Sync to Server
```

当前内置 redactor 已覆盖 Authorization、Cookie、URL token、环境变量 secret、private key、sensitive path、email 和 phone 规则，输出统一的 `[REDACTED:*]` 标记，并在 scan 结果中保留 finding label、kind 和 severity。

当前内置 quality scorers 已覆盖 confidence、rating、adoption、freshness 和 source trust 五类 patch。`QualityScorePatch` 支持 `confidenceDelta`、`weightDelta`、`ratingDelta`、`adoptionScoreDelta`、`freshnessDelta` 和 `sourceTrustDelta`，最终 `qualityScore` 仍由 core 按统一公式派生。

当前内置 search backend 已支持 member-specific experience filters（`authorName` / `memberName`）和 hybrid ranking。Hybrid backend 使用可替换 `EmbeddingProvider`，默认提供 deterministic embedding mock，并组合 keyword、vector similarity、recency、qualityScore、adoptionScore 和 weight。`JsonlKnowledgeRepository` 在 SQLite FTS 命中后也会叠加 core ranking，避免本地索引绕开质量排序。

知识类型：

| 类型 | 示例 |
| --- | --- |
| `decision` | “统一使用 AuthSession 读取登录态”。 |
| `convention` | “React Query key 使用 feature-first 命名”。 |
| `task_progress` | “AUTH-123 后端已完成，前端 refresh 未接入”。 |
| `pitfall` | “Windows 删除目录必须校验 resolved path”。 |
| `command` | “本项目后端测试命令是 pnpm test:api”。 |
| `bugfix` | “某版本 SDK 在 Node 20 下需要额外 polyfill”。 |
| `glossary` | “Mesh Client 指本地代理，不是 MCP Client”。 |
| `handoff` | “当前分支剩余事项和阻塞点”。 |

### 7.3 知识质量信号

每条 Knowledge Item 都必须携带质量信号，因为成员经验不天然等于团队最佳实践，旧经验也可能随着技术栈演进变得不再先进。

| 字段 | 含义 | 来源 | 用途 |
| --- | --- | --- | --- |
| `confidence` | 对“这条知识是否可靠”的置信度，范围 `0..1`。 | LLM 提取、证据数量、人工确认、测试/PR/commit 佐证。 | 决定是否自动发布、是否允许升级为 canonical。 |
| `weight` | 检索和自动引用时的优先权重，范围建议 `0..2`，默认 `1`。 | 维护者标注、领域归属、是否 canonical、是否过期、团队策略。 | 排序加权；低权重知识仍可检索，但不轻易默认注入上下文。 |
| `rating` | 团队成员对这条知识的使用反馈，范围建议 `-1..1` 或聚合后的 `0..5`。 | `helpful` / `outdated` / `wrong` / `needs_review` 等反馈事件。 | 影响排序、review 队列和 supersede 建议。 |
| `adoptionScore` | 引用后采纳质量，范围 `0..1`。 | 知识被 Agent 引用后，开发者是否保留、修改、反驳、回滚或再次询问。 | 衡量经验在真实开发中的摩擦，而不是只看人工评分。 |
| `qualityScore` | 派生综合分，不直接手写。 | `confidence`、`weight`、`rating`、`adoptionScore`、来源可信度、时效性、引用次数。 | 统一用于检索 ranking、自动引用阈值和维护看板。 |

默认解释：

- `confidence` 高表示证据充分，不代表一定先进。
- `weight` 高表示在当前项目里优先引用，不代表永远正确。
- `rating` 反映团队使用后的评价，可以把“个人经验”逐步校正为“团队共识”。
- `adoptionScore` 反映知识被引用之后是否真的帮助开发者减少修改和反复沟通。
- `canonical` 条目的默认 `weight` 高于 `extract`，但如果评分持续下降或被标记过时，应该降权或进入 review。
- 成员身份可以影响来源可信度，但不能直接决定正确性；专家经验应有更高初始信任，也必须接受团队反馈和时效衰减。

质量信号更新规则：

- LLM ingest 只能给出初始 `confidence` 和建议 `weight`，不能直接给高 `rating`。
- 人工 review、PR merge、测试通过、多人重复引用可以提高 `confidence`。
- Maintainer 可以手动调整 `weight`，例如把旧框架经验降权，把当前架构规范升权。
- 用户反馈 `helpful` 提升 `rating`，`wrong` / `outdated` 降低 `rating` 并触发 review。
- 知识被引用后，如果开发者频繁修改 Agent 依据该知识生成的实现、在对话中反复纠正、回滚相关 patch，系统应降低 `adoptionScore` 和 `weight`。
- 知识被引用后，如果实现被开发者保留、测试通过、PR 合并、后续同类任务继续采用，系统应提高 `adoptionScore`。
- 长时间未命中或依赖的技术栈版本过期时，系统应做 time decay，降低 `qualityScore` 或提示复审。
- 当低评分知识仍被频繁检索命中时，应建议创建 superseding entry，而不是直接删除旧条目。

引用后反馈闭环：

```text
Knowledge selected into Context Pack
  -> Agent cites or applies it during coding
  -> Developer continues conversation, edits patch, accepts patch, rejects patch, or asks for a different approach
  -> Client observes diff churn, edit distance, revert signal, test result, and conversation correction
  -> Create knowledge usage event
  -> Update adoptionScore / rating / weight / qualityScore
  -> Promote better competing entries or propose superseding canonical entry
```

隐式反馈信号：

| 信号 | 说明 | 质量影响 |
| --- | --- | --- |
| `accepted_without_change` | Agent 基于该知识产出的修改基本被保留。 | 提升 `adoptionScore`。 |
| `minor_adjustment` | 开发者只做小范围命名、格式或边界调整。 | 小幅提升或保持。 |
| `heavy_rewrite` | 开发者大幅重写相关代码或反复让 Agent 改方案。 | 降低 `adoptionScore`，可能降权。 |
| `explicit_correction` | 开发者在对话中说“这条经验不对/过时/不适合”。 | 生成 rating event，进入 review。 |
| `revert_or_test_fail` | 引用该知识后的实现被回滚或测试持续失败。 | 明显降权，触发 competing entries 检索。 |
| `merged_and_reused` | 修改被合并，并在后续任务继续采用。 | 提升 `confidence` 和 `adoptionScore`。 |

贪心收敛策略：

- 每次自动引用时优先选择当前 `qualityScore * weight` 最高、且与任务最相关的知识，这是团队协作的一步贪心选择。
- 每次交互结束后，用真实开发反馈更新质量信号，让下一次选择更接近团队当前最优经验。
- 当多个候选经验竞争同一 PARA key 时，系统保留候选池，优先使用当前最优项，同时持续收集其他候选的命中和反馈。
- 为避免过早收敛到局部最优，低比例保留探索流量：对低风险任务可以偶尔引用高相关但低曝光的新经验，并明确标注为候选经验。
- 团队最终趋于一致性不是因为强制统一，而是因为低摩擦、高采纳、高评分的知识会被持续升权，反复被修改或反驳的知识会自然降权、归档或被 supersede。

### 7.4 数字花园三层 + PARA

知识沉淀采用数字花园三层模型：`raw -> extract -> canonical`。三层表达知识成熟度，PARA 表达知识索引方式。协作中心是“条目化团队知识”，不是 wiki 页面；Markdown 文件最多是由条目生成的只读阅读视图。

| 层 | 名称 | 说明 | 默认用途 |
| --- | --- | --- | --- |
| `raw` | 原始材料 | 低加工事件，例如会话摘要、命令摘要、Git 摘要、工具调用、任务过程。 | 追溯来源，不直接喂给 Agent。 |
| `extract` | 提炼片段 | 从 raw 中提炼出的可复用经验，保留作者、证据、置信度和上下文。 | 自动检索补充，进入 review 或自动升级。 |
| `canonical` | 稳定知识 | 被团队确认、反复使用或自动聚合后的稳定条目。 | Agent 默认引用的主知识层。 |

PARA 负责建立任务和领域索引：

| PARA | 用途 | 示例 |
| --- | --- | --- |
| `projects` | 有明确目标和完成状态的任务/项目。 | `AUTH-123-login-refresh`、`checkout-redesign`。 |
| `areas` | 长期维护的职责领域。 | `frontend/styles`、`backend/auth`、`infra/deploy`。 |
| `resources` | 可复用资料、术语、命令、参考。 | `glossary`、`test-commands`、`windows-filesystem`。 |
| `archives` | 已结束或失效但需要保留的内容。 | `legacy-auth-v1`、`old-webpack-build`。 |

PARA 的使用规则：

- 正在做的任务、需求、Bug 修复进入 `projects`，例如 PARA key `projects/AUTH-123-login-refresh`。
- 长期有效的职责边界、模块经验和团队约定进入 `areas`，例如 PARA key `areas/frontend/styles`。
- 命令、术语、外部资料、环境说明进入 `resources`，例如 PARA key `resources/test-commands`。
- 完成、废弃或被替代的知识进入 `archives`，保留来源但默认不参与自动引用。
- 同一条 extract 可以同时链接一个 project 和一个 area，例如“小云在 AUTH-123 中总结的样式经验”既关联 `projects/AUTH-123`，也关联 `areas/frontend/styles`。

LLM ingest 可以借鉴 LLM Wiki 的 `raw -> wiki` 思想，但 DevMesh 的输出不是 wiki 页面，而是结构化 extract 条目：

```text
Assistant summary
  -> mesh_capture_knowledge / mesh_capture_task
  -> knowledge/extract/*.jsonl or knowledge/canonical/entries.jsonl
  -> PARA index points to related extract/canonical records
```

LLM ingest 边界：

- LLM 可以从对话、diff、命令结果、任务交接中提炼 extract。
- LLM 生成的 extract 必须带作者、时间、置信度和 PARA 归属。
- LLM 不能直接把不确定内容提升为 canonical，除非满足高置信度、已有相似条目或用户/团队策略允许。
- canonical 是团队协作对象，必须条目化、可 diff、可 supersede、可引用。
- Markdown 视图可以由 canonical entries 生成，但不作为事实源。

条目化约束：

- `entryKey` 是面向人和 Agent 的稳定语义键，例如 `areas/frontend/styles/design-token-first`。
- `id` 是跨端同步和冲突合并的稳定主键，使用 ULID。
- `storageRef` 只描述本地或远端的物理落点，例如 `knowledge/canonical/entries.jsonl#can_01J...`。
- MCP tool、同步 API、审计和 supersede 关系都以 `id` / `entryKey` 为中心，不以 Markdown 文件路径为中心。
- Markdown 或 HTML 视图只能由 entries 生成，视图上的编辑需要转成 entry patch 或 canonical proposal。

升级规则：

- `raw` 是事实来源，不做长期结论。
- `extract` 是经验片段，可以很多、可以带个人视角，例如“小云在前端样式里的经验”。
- `canonical` 是团队稳定共识条目，必须可追溯到 extract/raw。
- 多个相似 extract 被反复命中、被多人确认或被 Agent 多次引用后，才自动建议升级为 canonical。
- 与当前任务强相关的 extract 可以直接参与回答，但要带作者和置信度。
- canonical 发生变化时，只 patch 条目或创建 superseding entry，不删除原始 raw/extract。
- 评分持续下降、被多人标记 `wrong` 或 `outdated` 的 canonical 应自动降权并进入 review。
- 新技术栈或新版本引入后，旧经验不能直接删除，但应通过 `weight`、`qualityScore` 和 supersede 关系表达“现在不优先用”。

自动引用策略：

```text
Start task
  -> read PARA projects for active task
  -> read PARA areas from affected modules
  -> read PARA resources for commands, glossary, external references
  -> ignore archives unless explicitly requested
  -> read matching canonical entries
  -> retrieve top extract entries, including member-specific experience
  -> filter or down-rank low qualityScore / low rating items
  -> record selected knowledge ids in session context
  -> include raw only when debugging, auditing, or user asks for source
```

自动沉淀策略：

```text
Assistant summarizes durable context
  -> capture reusable entry
  -> attach PARA category/key
  -> update canonical entry if confidence is high
  -> otherwise queue canonical proposal for review
  -> sync extract/canonical entries and PARA indexes
```

引用后学习策略：

```text
After Agent response or patch
  -> correlate referenced knowledge ids with generated edits and conversation turns
  -> observe developer edits, rejection, correction, test failures, merge, or reuse
  -> write knowledge/usage/*.jsonl event
  -> recompute adoptionScore and qualityScore
  -> greedily prefer better-performing knowledge next time
```

### 7.5 发布策略

`capture.mode`：

| 模式 | 行为 |
| --- | --- |
| `off` | 不自动沉淀，只允许手动 capture。 |
| `reviewed` | 生成候选，用户通过 `dmx inbox` 确认后发布。 |
| `auto` | 默认模式。低风险类型自动发布，高风险内容进入 review queue。 |

高风险内容包括：

- 包含疑似密钥、token、cookie、私有 URL
- 包含用户原始对话大段内容
- 包含未提交源码大段片段
- 涉及安全漏洞、生产事故、客户信息
- 置信度低于阈值
- 初始 `qualityScore` 低于团队阈值，或同类知识存在高权重 canonical 冲突

### 7.6 去重和纠错

Knowledge Item 默认不可变。纠错不覆盖原内容，而是创建新 Item 并建立关系：

```text
ki_new --supersedes--> ki_old
ki_a   --duplicates--> ki_b
ki_x   --contradicts--> ki_y
ki_t   --relates_to--> task_123
```

检索默认隐藏被 supersede 的旧知识，但仍可审计。

### 7.7 `.dev-mesh/` 写入路径

自动沉淀的默认写入路径：

```text
Agent MCP tool call
  -> Local MCP Proxy
  -> Redaction
  -> Knowledge candidate
  -> classify layer and PARA category/key
  -> .dev-mesh/queue/pending.jsonl
  -> reviewed or auto policy
  -> .dev-mesh/knowledge/raw/*.jsonl
  -> .dev-mesh/knowledge/extract/*.jsonl
  -> .dev-mesh/knowledge/canonical/entries.jsonl
  -> .dev-mesh/knowledge/para/*.json
  -> .dev-mesh/index/mesh.sqlite
  -> sync push to joined Server Group when available
```

检索的默认读取路径：

```text
mesh_search_context
  -> local .dev-mesh/knowledge/para/*.json
  -> matching canonical entries
  -> local .dev-mesh/index extracts
  -> joined Server Group if local result is insufficient or stale
  -> merge, rank, deduplicate
  -> return Context Pack
```

这样设计后，即使团队服务端暂时不可用，Codex、Claude Code、opencode 仍然可以读取当前项目已经沉淀的知识，并继续把新知识写入本地队列。

## 8. 数据模型

### 8.1 核心表

```sql
create table teams (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table server_groups (
  id text primary key,
  team_id text not null references teams(id),
  key text not null,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique(team_id, key)
);

create table projects (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  key text not null,
  name text not null,
  git_remote text,
  created_at timestamptz not null default now(),
  unique(group_id, key)
);

create table members (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  display_name text not null,
  handle text,
  aliases text[] not null default '{}',
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique(group_id, handle)
);

create table clients (
  id text primary key,
  member_id text not null references members(id),
  client_label text,
  hostname text,
  public_key text not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table para_indexes (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  project_id text not null references projects(id),
  category text not null, -- projects | areas | resources | archives
  key text not null,
  title text not null,
  summary text not null default '',
  status text not null default 'active',
  related_item_ids text[] not null default '{}',
  canonical_item_ids text[] not null default '{}',
  extract_item_ids text[] not null default '{}',
  updated_by text references members(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(project_id, category, key)
);

create table knowledge_items (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  project_id text not null references projects(id),
  layer text not null, -- raw | extract | canonical
  para_category text, -- projects | areas | resources | archives
  para_key text,
  entry_key text,
  storage_ref text,
  type text not null,
  title text not null,
  summary text not null,
  content text not null,
  tags text[] not null default '{}',
  visibility text not null default 'team',
  confidence numeric not null default 0.5,
  weight numeric not null default 1.0,
  rating_score numeric not null default 0,
  rating_count integer not null default 0,
  adoption_score numeric not null default 0.5,
  quality_score numeric not null default 0.5,
  quality_signals jsonb not null default '{}',
  source_item_ids text[] not null default '{}',
  status text not null default 'active',
  supersedes_id text references knowledge_items(id),
  source jsonb not null default '{}',
  created_by text references members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index knowledge_items_entry_key_unique
  on knowledge_items(group_id, project_id, layer, entry_key)
  where entry_key is not null;

create table knowledge_edges (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  from_id text not null references knowledge_items(id),
  to_id text not null references knowledge_items(id),
  relation text not null,
  created_at timestamptz not null default now()
);

create table knowledge_ratings (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  project_id text not null references projects(id),
  knowledge_id text not null references knowledge_items(id),
  rating text not null, -- helpful | not_helpful | wrong | outdated | needs_review
  score integer not null, -- -1 | 0 | 1
  reason text not null default '',
  evidence jsonb not null default '[]',
  created_by text references members(id),
  created_at timestamptz not null default now()
);

create table knowledge_usage_events (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  project_id text not null references projects(id),
  knowledge_id text not null references knowledge_items(id),
  session_id text,
  event_type text not null, -- cited | applied | accepted_without_change | minor_adjustment | heavy_rewrite | explicit_correction | revert_or_test_fail | merged_and_reused
  adoption_delta numeric not null default 0,
  diff_churn_ratio numeric,
  conversation_signal text,
  evidence jsonb not null default '{}',
  created_by text references members(id),
  created_at timestamptz not null default now()
);

create table task_events (
  id text primary key,
  team_id text not null references teams(id),
  group_id text not null references server_groups(id),
  project_id text not null references projects(id),
  task_key text,
  status text not null,
  summary text not null,
  next_steps jsonb not null default '[]',
  blockers jsonb not null default '[]',
  source jsonb not null default '{}',
  created_by text references members(id),
  created_at timestamptz not null default now()
);

create table audit_logs (
  id text primary key,
  team_id text not null references teams(id),
  group_id text references server_groups(id),
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

### 8.2 Embedding 表

```sql
create table knowledge_embeddings (
  knowledge_id text primary key references knowledge_items(id),
  embedding_model text not null,
  embedding vector(1536) not null,
  embedded_at timestamptz not null default now()
);
```

Embedding provider 需要可插拔：

- OpenAI embedding
- 本地 embedding 服务
- 企业内部模型
- 仅关键词检索模式

### 8.3 `.dev-mesh/` 本地记录格式

本地 JSONL 采用和服务端接近的事件格式，便于同步和调试。

`knowledge/para/areas.json` 示例：

```json
{
  "schemaVersion": 1,
  "areas": [
    {
      "key": "frontend/styles",
      "title": "前端样式设计",
      "summary": "前端样式、设计 token、组件 class 和视觉一致性经验。",
      "relatedItemIds": ["can_01J...", "ex_01J..."],
      "canonicalItemIds": ["can_01J..."],
      "extractItemIds": ["ex_01J..."],
      "updatedAt": "2026-06-06T09:30:00Z"
    }
  ]
}
```

`knowledge/canonical/entries.jsonl` 示例：

```json
{"id":"can_01J...","layer":"canonical","entryKey":"areas/frontend/styles/design-token-first","storageRef":"knowledge/canonical/entries.jsonl#can_01J...","para":{"category":"areas","key":"frontend/styles"},"type":"convention","title":"前端样式优先使用设计 token","summary":"本项目按钮颜色、间距、圆角优先使用设计 token 和组件级 class，避免局部 hardcode。","tags":["frontend","style","design-token"],"visibility":"project","confidence":0.92,"weight":1.4,"rating":{"score":4.3,"count":7},"adoptionScore":0.81,"qualityScore":0.88,"sourceItemIds":["ex_01J..."],"status":"active","updatedAt":"2026-06-06T09:40:00Z"}
```

`knowledge/canonical/views/areas/frontend/styles.md` 只读派生视图示例：

```md
# 前端样式设计

## 当前结论

- 样式优先使用设计 token 和组件级 class。
- 局部深层覆盖只允许作为临时兼容方案。

## 相关知识条目

- can_01J...
- ex_01J...
```

`knowledge/extract/decisions.jsonl` 示例：

```json
{"id":"ex_01J...","layer":"extract","entryKey":"areas/frontend/styles/xiaoyun-button-token-experience","storageRef":"knowledge/extract/decisions.jsonl#ex_01J...","para":{"category":"areas","key":"frontend/styles"},"type":"decision","title":"按钮样式必须走 design token","summary":"小云总结：按钮颜色、间距和圆角优先使用设计 token，避免局部 hardcode。","tags":["frontend","style","design-token"],"visibility":"project","confidence":0.86,"weight":1.0,"rating":{"score":0,"count":0},"adoptionScore":0.5,"qualityScore":0.72,"createdBy":{"memberId":"member_01J...","displayName":"小云"},"sourceItemIds":["raw_01J..."],"status":"active","createdAt":"2026-06-06T09:30:00Z"}
```

`knowledge/ratings/2026-06.jsonl` 示例：

```json
{"id":"rate_01J...","knowledgeId":"can_01J...","rating":"outdated","score":-1,"reason":"旧组件适用，新组件已迁移到 design token v2。","createdBy":{"memberId":"member_02J...","displayName":"阿远"},"createdAt":"2026-06-06T10:10:00Z"}
```

`knowledge/usage/2026-06.jsonl` 示例：

```json
{"id":"use_01J...","knowledgeId":"can_01J...","sessionId":"session_01J...","eventType":"heavy_rewrite","adoptionDelta":-0.18,"diffChurnRatio":0.72,"conversationSignal":"developer_changed_agent_style_approach","evidence":{"changedFiles":["src/components/Button.tsx"],"testResult":"passed_after_rewrite"},"createdBy":{"memberId":"member_02J...","displayName":"阿远"},"createdAt":"2026-06-06T10:20:00Z"}
```

`knowledge/raw/2026-06.jsonl` 示例：

```json
{"id":"raw_01J...","layer":"raw","entryKey":"raw/2026-06/git-diff-abc123","storageRef":"knowledge/raw/2026-06.jsonl#raw_01J...","kind":"git_diff_summary","summary":"修改 Button 组件样式 token 映射，移除局部 hardcode 色值。","source":{"kind":"git","commit":"abc123"},"createdBy":{"memberId":"member_01J...","displayName":"小云"},"createdAt":"2026-06-06T09:20:00Z"}
```

`events/2026-06.jsonl` 示例：

```json
{"id":"evt_01J...","kind":"knowledge.extract.created","projectKey":"org/repo","knowledgeId":"ex_01J...","actor":{"memberId":"member_01J...","displayName":"小云"},"createdAt":"2026-06-06T09:31:00Z","payload":{"entryKey":"areas/frontend/styles/xiaoyun-button-token-experience","storageRef":"knowledge/extract/decisions.jsonl#ex_01J..."}}
```

`sync/cursors.json` 示例：

```json
{
  "remotes": {
    "https://devmesh.company.com": {
      "lastPulledCursor": "cur_01J...",
      "lastPushedEventId": "evt_01J...",
      "lastSyncedAt": "2026-06-06T09:32:00Z"
    }
  }
}
```

本地 SQLite 只保存可重建索引：

- `documents`
- `terms`
- `embeddings`
- `edges`
- `source_refs`
- `dedupe_hashes`

## 9. 检索与排序

检索采用 hybrid ranking：

```text
base_relevance = vector_score * 0.40
               + bm25_score * 0.25
               + recency_score * 0.10

quality_score = confidence_score * 0.28
              + rating_score * 0.20
              + adoption_score * 0.22
              + source_trust_score * 0.12
              + evidence_score * 0.10
              + freshness_score * 0.08

final_score = base_relevance * 0.70
            + quality_score * 0.20
            + usage_feedback_score * 0.10

rank_score = final_score * knowledge_weight
```

其中 `knowledge_weight` 来自条目的 `weight` 字段。`weight < 1` 的知识会被降权，`weight > 1` 的知识会更容易进入 Context Pack，但仍受 query relevance、confidence、rating、adoptionScore 和时效性约束。

过滤条件：

- team
- project
- layer
- PARA category/key
- entry key / storage ref / source ref
- visibility
- type
- tags
- active / superseded
- branch / module / task key

返回给 Agent 的 Context Pack 必须控制 token：

- 优先包含 canonical 稳定知识条目摘要。
- 再补充最相关的 extract 经验片段。
- 默认不返回 raw 原始材料，只返回证据引用。
- 默认最多 8 条
- 每条包含 title、summary、source、confidence、weight、rating、adoptionScore、qualityScore
- content 按需展开
- 大段内容通过 resource link 延迟读取

## 10. 安全与隐私

### 10.1 身份认证

加入流程使用 invite token 绑定 member identity 并换取 device identity：

```text
invite token + displayName/handle -> /api/v1/join -> memberId + clientId + device key + access token
```

建议：

- invite token 短期有效
- client 生成本地密钥对
- sync 请求使用 bearer token + request signature
- 生产环境强制 HTTPS
- 可选企业 SSO

### 10.2 权限模型

| 级别 | 说明 |
| --- | --- |
| `private` | 只在本机保存，不同步。 |
| `project` | 项目成员可见。 |
| `team` | 团队可见。 |
| `org` | 组织可见，需要管理员允许。 |

角色：

- owner
- admin
- maintainer
- member
- readonly

### 10.3 脱敏策略

默认启用：

- Secret regex 扫描
- `.env`、`*.pem`、`*.key`、credential 文件拒绝采集
- `.dev-mesh/secrets/` 永远不允许同步或提交
- URL token query 参数脱敏
- Cookie、Authorization header 脱敏
- 大段源码默认不上传，只上传摘要和文件路径
- 原始会话 transcript 默认不上传
- 引用后反馈只上传脱敏后的 usage signal，例如 `heavy_rewrite`、`explicit_correction`、`diffChurnRatio`，不上传完整开发者对话。

项目可定义 `.meshignore`：

```gitignore
.env*
secrets/**
.dev-mesh/secrets/
customer-data/**
*.pem
*.key
```

### 10.4 审计

所有写入、删除、supersede、权限变更都写入 `audit_logs`。

## 11. 同步与分布式设计

产品默认协作拓扑是 Hub 模式：

```text
Client A -> Server <- Client B
```

后续扩展 Mesh 联邦：

```text
Team Server A <-> Team Server B
      ^                 ^
      |                 |
  Client A          Client B
```

### 11.1 Local-first 同步原则

- Knowledge Item 使用 ULID，天然按时间排序。
- Item 不可变，纠错通过 edge 表达。
- `.dev-mesh/events/*.jsonl` 是本地 append-only 事件源。
- `.dev-mesh/knowledge/*.jsonl` 是本地已确认知识视图。
- `.dev-mesh/index/` 只是派生索引，可以随时删除并重建。
- 客户端使用 `.dev-mesh/sync/cursors.json` 增量拉取。
- 写入冲突通过 append-only event log 解决。
- 删除默认是 tombstone，保留审计。
- 已加入 Server Group 返回的远程知识先进入本地 event log，再重建本地索引。
- 同步只上传脱敏后的事件和知识，不上传本地 index、queue、secrets。

Sync API：

```http
POST /api/v1/sync/push
Content-Type: application/json

{
  "clientId": "client_01J...",
  "events": [
    {
      "id": "evt_01J...",
      "kind": "knowledge.created",
      "payload": {}
    }
  ]
}
```

```http
GET /api/v1/sync/pull?cursor=cur_01J...
```

### 11.2 同步状态机

```text
pending -> reviewed -> committed-local -> pushed -> acknowledged
                     -> push-failed -> retrying -> pushed
                     -> rejected -> superseded
```

状态落点：

| 状态 | 本地位置 | 说明 |
| --- | --- | --- |
| `pending` | `.dev-mesh/queue/pending.jsonl` | 自动提取但尚未确认。 |
| `reviewed` | `.dev-mesh/queue/pending.jsonl` | 用户已确认，等待写入事件日志。 |
| `committed-local` | `.dev-mesh/events/*.jsonl` | 已成为本地事实，可被本地 MCP 检索。 |
| `pushed` | `.dev-mesh/sync/cursors.json` | 已推送到对应 Server Group，等待确认游标。 |
| `acknowledged` | `.dev-mesh/sync/cursors.json` | 服务端 group 确认，其他同组成员可拉取。 |
| `rejected` | `.dev-mesh/queue/rejected.jsonl` | 用户或策略拒绝同步。 |

## 12. 开发工具集成细节

### 12.1 为什么使用本地 MCP Proxy

使用本地 Proxy 的原因：

- 不把远端 token 写进项目仓库。
- 可以在上传前脱敏。
- 可以离线缓存。
- 可以把项目知识稳定沉淀到 `.dev-mesh/`，让知识跟着项目走。
- 可以统一 Codex、Claude Code、opencode 的差异。
- 可以采集 Git 和文件事件，这是远程 MCP 服务端无法直接做到的。

当前实现状态：

- `@devmesh/client` 已提供 stdio launcher、项目级 daemon 和 Koa2 + 官方 MCP TypeScript SDK Streamable HTTP transport 的本地 proxy。
- `dmx serve --mcp` 会作为 MCP host 的前台 stdio 入口，默认使用 host 当前工作目录作为项目根；`--root .` 可用于手动调试或显式固定项目根。launcher 会按需复用或 detached spawn 项目 daemon，并在 daemon 冷启动或不可用时降级为本进程执行。
- daemon 通过 `.dev-mesh/daemon.pid` 做项目级锁，并把运行状态写入 `.dev-mesh/daemon.json`；空闲超过阈值后自动退出。
- daemon 负责远端共享同步：当项目 `auto_sync = true` 且本机 `identity.json` 存在 joined server 时，daemon 会把 `.dev-mesh/events/*.jsonl` 事件签名后增量 push 到 Hub，并按 pull cursor 拉取同 group 事件。可回放的 `knowledge` snapshot 会 upsert 到本地 `.dev-mesh/knowledge/`，让同组成员沉淀的知识进入本地搜索；replay 不追加新的本地 event，避免同步回环。
- 客户端同步游标写入 `.dev-mesh/sync/cursors.json`，最近一次 daemon sync 状态写入 `.dev-mesh/sync/status.json`，`dmx doctor` 会读取该状态报告远端错误和本地待推送事件数量。
- `dmx proxy --root . --port 8722` 仍可直接启动 `http://127.0.0.1:8722/mcp`，用于调试或嵌入。
- 本地 proxy 注册与远端一致的核心 MCP tools：`mesh_get_status`、`mesh_search_context`、`mesh_get_knowledge`、`mesh_list_knowledge`、`mesh_capture_knowledge`、`mesh_update_knowledge`、`mesh_delete_knowledge`、`mesh_capture_task`、`mesh_rate_knowledge`、`mesh_link_knowledge`、`mesh_search_member_experience`、`mesh_resolve_term`、`mesh_scan_project_knowledge`、`mesh_explore_knowledge_graph`。
- 本地 proxy 不依赖 `packages/server`，只通过 `packages/mcp-contracts` 共享 tool schema，避免 client/server 反向耦合。

### 12.2 Adapter 接口

```ts
export interface ToolAdapter {
  id: string;
  kind: 'tool-adapter';
  capabilities: ToolCapability[];
  detect(): Promise<DetectResult>;
  isConfigured(projectRoot: string): Promise<boolean>;
  configure(input: ConfigureInput): Promise<ConfigureResult>;
  remove(input: RemoveInput): Promise<void>;
  doctor(projectRoot: string): Promise<DoctorCheck[]>;
}
```

### 12.3 Capture Provider 接口

```ts
export interface ProjectScanProvider {
  id: string;
  kind: 'project-scan-provider';
  capabilities: ProjectScanCapability[];
  detect(projectRoot: string): Promise<boolean>;
  collect(ctx: ProjectScanContext): AsyncIterable<ProjectScanRecord>;
}
```

内置 Provider：

- `git-provider`
- `filesystem-provider`
- `command-provider`
- `mcp-tool-provider`
- `codex-provider`
- `claude-provider`
- `opencode-provider`

Codex、Claude、opencode provider 的基础能力以配置 MCP 和可选 hook 为主，不依赖未公开的内部会话格式。

### 12.4 Redactor / Scorer 接口

```ts
export interface Redactor {
  id: string;
  kind: 'redactor';
  scan(input: RedactionInput): Promise<RedactionFinding[]>;
  redact(input: RedactionInput): Promise<RedactionResult>;
}

export interface QualityScorer {
  id: string;
  kind: 'quality-scorer';
  supports(item: KnowledgeItem): boolean;
  score(input: QualityScoreInput): Promise<QualityScorePatch>;
}
```

内置 Scorer：

- `confidence-scorer`
- `rating-scorer`
- `adoption-scorer`
- `freshness-scorer`
- `source-trust-scorer`
- `maintainer-override-scorer`

### 12.5 Search / Storage / Sync 接口

```ts
export interface SearchBackend {
  id: string;
  kind: 'search-backend';
  index(input: IndexInput): Promise<void>;
  remove(input: RemoveIndexInput): Promise<void>;
  search(input: SearchInput): Promise<SearchCandidate[]>;
}

export interface StorageBackend {
  id: string;
  kind: 'storage-backend';
  knowledgeItems: KnowledgeItemRepository;
  events: EventRepository;
  cursors: CursorRepository;
}

export interface SyncBackend {
  id: string;
  kind: 'sync-backend';
  push(input: SyncPushInput): Promise<SyncPushResult>;
  pull(input: SyncPullInput): AsyncIterable<SyncEvent>;
}
```

内置实现：

- `local-jsonl-storage`
- `local-sqlite-index`
- `postgres-storage`
- `postgres-fts-search`
- `pgvector-search`
- `hub-sync-backend`

### 12.6 Extension Registry

```ts
export interface DevMeshExtension {
  id: string;
  version: string;
  kind: ExtensionKind;
  capabilities: string[];
  priority?: number;
  configSchema?: JsonSchema;
  register(registry: ExtensionRegistry): void | Promise<void>;
}

export interface ExtensionRegistry {
  registerAdapter(adapter: ToolAdapter): void;
  registerProjectScanProvider(provider: ProjectScanProvider): void;
  registerRedactor(redactor: Redactor): void;
  registerScorer(scorer: QualityScorer): void;
  registerSearchBackend(search: SearchBackend): void;
  registerStorageBackend(storage: StorageBackend): void;
  registerSyncBackend(sync: SyncBackend): void;
  resolve<T>(kind: ExtensionKind, capability: string): T[];
}
```

Registry 规则：

- 同一 capability 可以有多个实现，按 `priority`、配置开关和运行时 detect 结果排序。
- Core service 只能通过 registry resolve 扩展，不能直接 import 具体实现。
- 扩展失败不能拖垮主流程；失败状态进入 `dmx doctor` 和 observability。
- workspace extension 优先级可以高于内置扩展，但必须通过安全校验。

## 13. 典型工作流

### 13.1 新同事加入项目

```text
1. 管理员创建 invite link。
2. 新同事运行 `npm install -g devmesh`。
3. 新同事运行 `dmx init --global`，在 TUI 中选择 Codex、Claude Code、opencode 注册 MCP。
4. 客户端开启 daemon，本机进入 local-only 自动模式。
5. 新同事运行 `dmx join <server> --group frontend-team --name 小云 --token <invite-token>`。
6. 服务端把小云加入指定 group，并返回 group-scoped 凭据。
7. 新同事用 Codex 打开项目。
8. DevMesh 自动识别项目根目录，创建或复用 `.dev-mesh/`。
9. DevMesh 先检索本地知识，再拉取同 group 授权项目知识并重建本地索引。
10. Codex 自动引用 project brief、相关决策、历史坑点和成员经验。
11. Codex 开发过程中自动沉淀任务进度、命令经验和技术决策。
12. DevMesh 自动同步到指定 group，其他同组同事后续可检索“小云”的经验。
```

### 13.2 未加入服务器的本地知识库

```text
1. 用户运行 `npm install -g devmesh`。
2. 用户运行 `dmx init --global`，选择要注册 MCP 的编程工具。
3. 用户用 Codex 或 Claude Code 打开任意项目。
4. DevMesh 自动创建 `.dev-mesh/`，建立本地 raw / extract / canonical / PARA 知识库。
5. Agent 开发时自动检索本地 `.dev-mesh/index` 和本地知识条目。
6. Agent 发现长期有效经验时自动沉淀到本地 `.dev-mesh/knowledge`。
7. 用户后续加入服务器 group 后，可以选择同步哪些本地知识。
```

### 13.3 技术决策沉淀

```text
1. Agent 或用户发现一个长期有效的技术决策。
2. Agent 自动调用 mesh_capture_knowledge(type=decision)。
3. 客户端本地脱敏和去重。
4. 内容写入 .dev-mesh/events 与 .dev-mesh/knowledge。
5. 需要人工确认的内容可由 dmx inbox 流程 review。
6. 未 join 时留在本地知识库；已 join 时 Sync manager 自动推送到指定 Server Group。
7. 其他同组同事拉取后写入自己的 .dev-mesh/，Agent 可本地检索到该决策。
```

### 13.4 按成员检索经验

```text
1. 用户对 Codex 说：“获取小云的前端样式设计经验”。
2. Codex 调用 mesh_search_member_experience(memberName=小云, query=前端样式设计经验)。
3. DevMesh 先检索本地 .dev-mesh/index，再 fallback 到已加入的 Server Group。
4. 返回小云沉淀过的样式规范、组件设计坑点、历史决策和适用项目。
5. Codex 在当前任务中引用这些经验，并在产生新经验后继续以当前成员身份沉淀。
```

### 13.5 统一技术语言

```text
1. 团队定义 glossary 类型知识。
2. Agent 遇到歧义术语时调用 mesh_resolve_term。
3. 如果出现冲突，创建 contradicts edge。
4. Maintainer 确认新的标准术语并 supersede 旧解释。
```

## 14. 部署方案

### 14.1 本地开发

```bash
pnpm install
pnpm dev:server
pnpm dev:client -- proxy --root . --port 8722
```

本地默认端口：

```text
Mesh Server: http://127.0.0.1:8721
Mesh Server MCP: http://127.0.0.1:8721/mcp
Mesh Client MCP: http://127.0.0.1:8722/mcp
```

### 14.2 Docker Compose

```yaml
services:
  devmesh-server:
    image: ghcr.io/devmesh/devmesh-server:latest
    ports:
      - "8721:8721"
    environment:
      DATABASE_URL: postgres://devmesh:devmesh@postgres:5432/devmesh
      REDIS_URL: redis://redis:6379
      PUBLIC_BASE_URL: https://devmesh.company.com
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: devmesh
      POSTGRES_PASSWORD: devmesh
      POSTGRES_DB: devmesh
  redis:
    image: redis:7
```

### 14.3 企业部署

- HTTPS ingress
- SSO / OIDC
- PostgreSQL managed instance
- Backup and restore
- Audit log export
- Admin dashboard
- Workspace policy
- Allowlist projects and tools

## 15. 可观测性与诊断

客户端：

```bash
dmx status
dmx doctor
dmx logs
dmx mcp ping
dmx adapters doctor
```

服务端：

- `/healthz`
- `/metrics`
- structured logs
- MCP request trace
- sync lag
- ingestion failure queue
- redaction hit count
- search latency

MCP 调试建议使用 MCP Inspector 验证：

- tools/list
- tools/call
- resources/list
- prompts/list
- Streamable HTTP 连接

### 15.1 测试策略

测试目标：

- 确保 `core`、`agent`、`client`、`server` 和扩展接口的依赖边界不被破坏。
- 确保 local-only 模式在没有远端服务时也能完成项目初始化、知识写入、检索和质量反馈。
- 确保加入 Server Group 后的同步、权限、脱敏和审计行为可回归。
- 确保 MCP tools、HTTP API、CLI 和本地 `.dev-mesh/` store 的端到端契约稳定。
- 确保安全策略失败时默认阻断上传或进入 review queue，而不是静默同步。

测试分层：

| 层级 | 运行命令 | 范围 | 触发时机 |
| --- | --- | --- | --- |
| 单元测试 | `pnpm test:unit` | 纯函数、repository、ranking、schema、registry、redactor、scorer。 | 每次提交和 PR。 |
| 集成测试 | `pnpm test:integration` | CLI、本地 store、MCP server、HTTP API、sync backend、adapter 配置。 | PR、merge 前和 nightly。 |
| 契约测试 | `pnpm test:contract` | MCP tools schema、Sync API payload、extension manifest schema。 | API 或 schema 变更时必跑。 |
| 安全测试 | `pnpm test:security` | secret scan、`.meshignore`、权限过滤、脱敏输出。 | PR、release 前。 |
| 端到端 smoke | `pnpm test:e2e` | `dmx init` -> capture -> search -> sync push/pull。 | release candidate 和 Docker 镜像构建。 |

单元测试矩阵：

| 包 | 必测内容 |
| --- | --- |
| `packages/core` | `KnowledgeItem` 创建默认值、PARA 推断、质量分计算、`weight` 降权、`rating/adoptionScore` 更新、superseded 过滤、authorName 精确/模糊匹配、recency 过滤、ranking 排序稳定性。 |
| `packages/agent` | Context Pack token/字符截断、canonical 优先、extract 补充、raw 默认不展开、source/quality 引用字段完整性、空结果行为。 |
| `packages/extension-api` | extension manifest schema、capability 命名、接口类型兼容性、未知 kind 拒绝。 |
| `packages/registry` | 注册去重、priority 排序、同 capability 多实现 resolve、扩展注册失败隔离、workspace extension 覆盖优先级。 |
| `packages/local-store` | `.dev-mesh/` bootstrap、目录和默认配置生成、JSONL append/read、重复 id 去重、损坏 JSONL 报错、index/queue/secrets 不进入同步清单。 |
| `packages/mcp-contracts` | 每个 MCP tool 的输入 schema、默认值、非法 enum 拒绝、返回 content 格式。 |
| `packages/server` | `/healthz`、`/.well-known/devmesh`、join 参数校验、groupKey 解析、project brief 查询、MCP handler 到 core service 的参数映射。 |
| `packages/client` | `dmx init --global` 配置生成、local-only status、`ensureProjectStore` 幂等、capture/search runtime 组合、join 后配置更新。 |
| `packages/adapters` | Codex、Claude Code、opencode detect/configure/remove/doctor、重复配置幂等和临时 HOME / config 目录测试隔离。 |
| `packages/providers` | Git diff 摘要扫描、文件事件过滤、provider detect false 时不采集。 |
| `packages/redaction` | secret、PII、credential redactor。 |
| `packages/quality` | confidence、rating、adoption、freshness、source trust scorer 的加权计算、过期降权、人工 override 优先级。 |
| `packages/search` | BM25/关键词召回、向量召回 mock、hybrid ranking、filter 组合、limit、includeSuperseded、member experience 查询。 |
| `packages/storage` | repository CRUD、tombstone、edge 查询、事务回滚、PostgreSQL schema migration dry-run。 |

集成测试矩阵：

| 场景 | 验证内容 |
| --- | --- |
| CLI local-only flow | 在临时目录运行 `dmx init`、`dmx capture`、`dmx search`、`dmx status`，验证 `.dev-mesh/` 结构、JSONL 内容和 Context Pack。 |
| Global init flow | 运行 `dmx init --global --yes`，验证 `~/.dev-mesh/config.toml`、设备身份、MCP Host 选择结果和重复执行幂等。 |
| Local MCP proxy flow | 启动本地 proxy，使用 MCP Inspector 或 SDK client 调用 `tools/list`、`mesh_get_status`、`mesh_get_knowledge`、`mesh_list_knowledge`、`mesh_capture_knowledge`、`mesh_update_knowledge`、`mesh_delete_knowledge`、`mesh_search_context`、`mesh_explore_knowledge_graph`，验证写入默认落到当前项目 store。 |
| Hub server HTTP flow | 使用真实端口或 HTTP adapter 注入验证 `/healthz`、`/.well-known/devmesh`、`/api/v1/groups`、`/api/v1/join`、`/api/v1/projects/:id/brief`；Koa 实现需要跑同一组 parity 测试。 |
| Sync push/pull flow | Client A capture 后 push，Client B pull，同 group 可见；不同 group 或无权限不可见；cursor 可增量推进。 |
| Review queue flow | 高风险提取进入 `.dev-mesh/queue/pending.jsonl`，用户确认后写入 events，拒绝后进入 rejected，不同步。 |
| Redaction flow | 输入包含 token、Authorization、cookie、`.env` 路径、pem/key 文件，验证输出脱敏并阻断 raw transcript 上传。 |
| Adapter configure flow | 对 Codex、Claude Code、opencode 使用临时 HOME 和配置目录，验证 configure/remove/doctor 不污染真实用户配置。 |
| Search ranking flow | 构造 canonical/extract/raw、多作者、多质量分、多时间戳数据，验证 canonical 优先、质量分和 adoptionScore 影响排序。 |
| Conflict resolution flow | 两个客户端创建相同 entry、duplicate/supersedes/contradicts edge 后，检索默认返回 active 最新有效项。 |
| Server storage flow | 使用 PostgreSQL test container 或 ephemeral database 跑 migrations、CRUD、FTS 查询、audit log 写入和事务回滚。 |
| Docker compose smoke | 启动 server、PostgreSQL、Redis，执行 join、capture、sync、search，验证容器健康检查和日志。 |

测试数据原则：

- 所有集成测试使用临时目录、临时 HOME、临时端口和临时数据库，测试结束必须清理。
- PostgreSQL repository integration test 必须使用显式 `DEV_MESH_POSTGRES_URL` 指向专用测试库，不能默认读取生产 `DATABASE_URL`。
- 测试 fixture 不包含真实密钥、真实客户数据或真实对话全文。
- 安全相关 fixture 使用明显假的 token，例如 `sk_test_redacted_example`。
- JSONL fixture 一行一个对象，覆盖空文件、重复 id、损坏行、未知字段和旧 schema version。
- 时间相关测试固定 clock，避免 recency、freshness 和 ULID 排序抖动。

CI 门禁：

- PR 必须通过 `pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration` 和 `pnpm build`。
- 修改 MCP tool schema、Sync API、`.dev-mesh/` schema、extension manifest schema 时必须补契约测试。
- 修改 redaction、sync、ACL、audit 时必须补安全测试。
- 修复 bug 时必须先补一个失败测试，再提交修复。
- 集成测试中禁止访问真实用户 HOME、真实 MCP Host 配置和真实远端服务器。

## 16. 产品路线图

### 阶段 0：产品骨架

- TypeScript monorepo
- 基础 lint/test/build
- 单元测试框架和集成测试框架
- `core`、`local-store`、`registry`、`mcp-contracts` 的首批单元测试
- CLI local-only smoke test
- Server HTTP health 和 well-known integration test
- `apps/dmx` 和 `apps/mesh-server` 作为薄启动入口
- `packages/core` / `@devmesh/core`
- `packages/agent` / `@devmesh/agent`
- `packages/client` / `@devmesh/client`
- `packages/server` / `@devmesh/server`
- `packages/extension-api` / `@devmesh/extension-api`
- `packages/registry` / `@devmesh/registry`
- 明确 `core -> agent -> client`、`core -> server`、`extension-api -> extensions` 的依赖方向
- MCP contracts
- `.dev-mesh/` schema 和 bootstrap 模板
- raw/extract/canonical schema
- PARA index schema
- knowledge quality signals schema
- built-in extension manifest schema
- 包级 public API skeleton
- 二次开发 examples 目录
- 文档和 ADR 模板

### 阶段 1：核心 Server 能力

- `@devmesh/server` 可作为库创建 Hub server
- Streamable HTTP MCP `/mcp`
- `mesh_get_status`
- `mesh_search_context`
- `mesh_get_knowledge`
- `mesh_list_knowledge`
- `mesh_capture_knowledge`
- `mesh_update_knowledge`
- `mesh_delete_knowledge`
- `mesh_capture_task`
- `mesh_rate_knowledge`
- `mesh_link_knowledge`
- `mesh_explore_knowledge_graph`
- MCP tools/list 和 tools/call contract test
- HTTP join/groups/projects integration test
- search/capture/rate server integration test
- SQLite 或 PostgreSQL 存储
- SQLite/PostgreSQL repository integration test
- 关键词检索
- invite join API
- groups API and group-scoped ACL
- group-scoped ACL integration test

### 阶段 2：Mesh Client

- NPM package `devmesh`
- `dmx` CLI
- `@devmesh/client` 提供可嵌入的 stdio launcher、local proxy 和 daemon runtime
- `@devmesh/agent` 提供 `buildContextPack`、自动引用策略和沉淀 orchestration API
- `dmx init --global`
- tool selector for Codex / Claude Code / opencode（已支持 flags、CI 默认、TUI 状态展示、键盘 toggle 和 scope 切换）
- local-only mode
- `dmx join <ip> --group <groupKey> --name <displayName>`（已支持 well-known discovery、invite join、全局连接记录和 CLI 集成测试）
- 本地 MCP 入口（已支持 `dmx serve --mcp` stdio launcher、按需 daemon、`dmx proxy`、Koa2、官方 MCP SDK Streamable HTTP transport 和 local-store capture/search）
- `.dev-mesh/` local store manager
- Codex 打开项目时自动 `ensureProjectStore`
- 默认 `auto_init`、`auto_reference`，join 后开启 `auto_sync`；助手自主沉淀由 MCP 工具强提示直接驱动
- Codex Adapter
- Claude Code Adapter
- opencode Adapter
- built-in extension registry
- adapter/provider/scorer/search backend capability detection
- `dmx doctor`
- 本地 SQLite 缓存
- `dmx init --global`、`dmx join`、`dmx doctor` integration test
- local MCP proxy capture/search integration test（已覆盖 stdio launcher 拉起 daemon、client 嵌入式 proxy 和 `dmx proxy` 启动）
- adapter configure/remove/doctor integration test with temporary HOME
- custom Agent 二次开发示例

### 阶段 3：自动沉淀

- Git provider（已支持结构化 snapshot，不采集完整 diff）
- 文件事件 provider（已支持 `.meshignore` / 隐私过滤和路径级元数据采集）
- redaction pipeline（已支持 secret / PII / credential 脱敏）
- redactor / quality scorer extension interfaces（redactor 已支持 secret / PII / credential 脱敏，quality scorer 已覆盖 confidence / rating / adoption / freshness / source trust）
- assistant-led capture（已通过 MCP 工具强提示模型总结当前上下文后主动写入知识）
- `.dev-mesh/events` append-only event log（已支持 capture、rating、usage、sync event 写入）
- `.dev-mesh/index` rebuildable local search
- `.dev-mesh/knowledge/raw` 原始材料
- `.dev-mesh/knowledge/extract` 提炼片段
- `.dev-mesh/knowledge/canonical` 稳定知识
- `.dev-mesh/knowledge/ratings` 知识反馈事件
- `.dev-mesh/knowledge/usage` 引用后隐式反馈事件
- `.dev-mesh/knowledge/para` PARA 索引
- member-specific experience search（已支持 author/member filters）
- hybrid search with embeddings（已支持 deterministic embedding mock 和 hybrid ranking）
- confidence / weight / rating / adoptionScore / qualityScore ranking
- pluggable search backend interface
- redaction pipeline security test
- review queue integration test
- project scan provider integration test
- hybrid search ranking integration test
- 自定义 `QualityScorer`、`SearchBackend` 插件示例
- package API docs：core store、agent context、extension registry

### 阶段 4：团队化

- `apps/web-admin` Vue 3 + Element Plus 管理后台
- dashboard overview：server health、MCP endpoint、sync 状态、最近错误
- group / member / invite / project 管理页面（已支持 group/project 创建、invite 创建/撤销、member 禁用）
- project ACL（已支持 group/restricted visibility、成员角色配置和项目接口过滤）
- audit log（已支持内存写入、查询和 admin table）
- glossary 管理（已支持 admin API、web-admin 创建/编辑和 `mesh_resolve_term` 复用）
- supersede / duplicate / contradict edges（已支持 admin API、web-admin 创建和默认 active 检索测试）
- quality review dashboard（已支持 admin API、web-admin summary/table 和集成测试）
- task digest（已支持 admin API、web-admin summary/table 和集成测试）
- review queue 管理页面
- ACL/audit/glossary management integration test
- supersede / duplicate / contradict edge conflict test
- Web admin API contract test
- Web admin smoke / component test
- 企业内部二次开发指南：自定义工具适配器、自定义评分策略、自定义知识类型

### 阶段 5：分布式 Mesh

- server-to-server federation（已支持库级 HubState -> HubState 和 HTTP peer event-log endpoint 的 group/cursor 增量复制、重复复制幂等和 audit 记录）
- group-scoped sync event log / cursor foundation（已支持 push/pull cursor、重复 push 幂等和跨 group 隔离）
- signed sync event verification foundation（已支持开发期 HMAC 校验、拒绝篡改事件和 audit 记录）
- tombstone sync（已支持 `knowledge.deleted` 结构校验、push / federation merge 审计和 repository tombstone replay）
- signed event log verification（已支持服务端 sequence/hash/previousHash 元数据、hash chain 复验、HMAC 复验和 failure audit）
- offline-first conflict handling（已支持 `knowledge.updated` 离线 revision 冲突 replay 为 `contradicts` edge 和 audit）
- org-level knowledge sharing（已支持 org-visible canonical knowledge 跨 group 进入已授权 project brief，同时过滤其他 group 的非 org knowledge）
- federation sync integration test
- signed event verification test
- offline conflict replay test（已覆盖 helper cursor replay 和 HTTP push replay）

## 17. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 自动沉淀泄露密钥 | 默认 auto 模式但高风险内容进入 review queue，启用 secret scan、`.meshignore`，不上传原始 transcript。 |
| Agent 写入低质量知识 | `confidence`、`weight`、`rating`、`adoptionScore`、`qualityScore`、来源证据、人工 review、supersede 和过时降权机制。 |
| 贪心策略陷入局部最优 | 保留候选池和少量探索流量，低风险任务可试用高相关新经验，并用 adoptionScore 反馈校正。 |
| 把个人偏好误判为知识错误 | 只把单人修改作为弱信号，多人重复修改、明确反驳、测试失败或回滚才触发明显降权。 |
| MCP 工具过多挤占上下文 | 工具数量控制，默认只暴露核心 tools，资源延迟读取。 |
| 不同开发工具配置差异大 | Adapter 能力检测，优先 CLI 配置，失败时给出手动修复提示。 |
| 横向扩展导致核心复杂度失控 | Core 只依赖 `extension-api`，扩展通过 registry 注册；新增工具、Provider、Scorer、SearchBackend 不允许绕过接口直接改核心流程。 |
| 远程服务不可用 | 本地缓存、离线 capture、恢复后 sync。 |
| `.dev-mesh/` 污染 Git 仓库 | 明确可提交和不可提交目录，生成 `.gitignore` 建议，`dmx doctor` 检查敏感文件。 |
| 本地 JSONL 发生合并冲突 | 默认不提交事件和索引；精选公共知识采用一行一个 Item，冲突通过 ULID 和 supersede 解决。 |
| 团队知识互相矛盾 | `contradicts` edge、maintainer 确认、默认返回最新有效项。 |
| 分布式冲突复杂 | append-only event log，Item 不可变，纠错通过新事件表达。 |

## 18. 参考依据

- MCP Architecture: https://modelcontextprotocol.io/specification/2025-06-18/architecture
- MCP Transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP Tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- OpenCode MCP servers: https://dev.opencode.ai/docs/mcp-servers/
- OpenAI Docs MCP and Codex MCP add example: https://platform.openai.com/docs/docs-mcp
