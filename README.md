# MCP Dev Mesh

`MCP Dev Mesh` 是一个面向多人协作开发的 local-first 知识共享层。它通过 MCP 为 Codex、Claude Code、opencode 等 AI 编程工具提供项目知识检索、经验沉淀、本地缓存和可选团队同步能力。

当前仓库处于产品骨架阶段：已搭建 TypeScript monorepo、核心领域模型、`.dev-mesh/` 本地项目知识库、基础 CLI、Hub Server skeleton、MCP tool contract 和分层测试框架。

## 核心目标

- 让 AI 编程工具可以检索项目决策、约定、任务进度、命令经验和踩坑记录。
- 默认使用本地 `.dev-mesh/`，未加入服务端时也能作为 local-only 项目知识库使用。
- 加入团队 Server Group 后，再按策略同步脱敏后的知识和事件。
- 使用成员身份标记知识来源，例如检索“小云的前端样式设计经验”。
- 通过 `confidence`、`weight`、`rating`、`adoptionScore`、`qualityScore` 管理知识可靠性和排序。

## 当前能力

- `pnpm` workspace monorepo
- `apps/dmx`：`dmx` CLI，本地 init/capture/search/status/rate/inbox/index/doctor/proxy、全局 init 工具选择和远端 group join
- `apps/mesh-server`：Koa2 Hub Server 启动入口
- `apps/web-admin`：Vue 3 + Element Plus 管理后台
- `packages/core`：知识条目、PARA、质量信号、搜索和评分
- `packages/agent`：Context Pack 构建
- `packages/client`：本地 runtime、local-only 组合和 Koa2 + 官方 MCP SDK 本地 proxy
- `packages/server`：Koa2 Hub HTTP API、官方 MCP SDK Streamable HTTP `/mcp` 和工具调用映射
- `packages/local-store`：`.dev-mesh/` bootstrap、JSONL 本地存储、事件日志、review queue、ratings 和 SQLite FTS 索引
- `packages/mcp-contracts`：MCP tools schema 和注册函数
- `packages/extension-api`、`packages/registry`：扩展接口和注册解析
- 分层测试脚本：unit、integration、contract、security、e2e

## 项目结构

```text
apps/
  dmx/
    src/                  # CLI 可执行入口和 commands/*
    tests/                # CLI 集成测试
  mesh-server/
    src/                  # Hub Server 可执行入口
    tests/                # E2E smoke 测试
  web-admin/              # Vue + Element Plus 管理后台
packages/
  */src/                  # 生产代码
  */tests/                # 单元、集成、契约、安全测试
  core/                   # 纯领域模型和核心服务
  agent/                  # Agent context pack 编排
  client/                 # 本地 runtime、全局初始化和项目 store 组合
  server/                 # Hub Server、HTTP API、MCP endpoint
  extension-api/          # Adapter / Provider / Extractor / Scorer 等接口
  registry/               # 扩展注册和 capability resolve
  mcp-contracts/          # MCP tool schema 和注册
  protocol/               # Sync / join / well-known API 类型
  local-store/            # .dev-mesh 本地知识库
  adapters/               # 内置 Codex / Claude Code / opencode 工具适配器
  providers/              # 内置采集源 skeleton
  extractor/              # 提取器 skeleton
  quality/                # 质量评分器 skeleton
  search/                 # 搜索 backend skeleton
  storage/                # 存储 backend skeleton
docs/
  README.md              # 文档索引
  technical-design.md     # 技术设计文档
  TODO.md                 # 阶段任务清单
  adr/                    # ADR 模板和记录
examples/                 # 二次开发示例
```

## 环境要求

- Node.js 22+
- pnpm 10.6.2+

安装依赖：

```bash
pnpm install
```

## 常用命令

```bash
pnpm typecheck
pnpm typecheck:examples
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:security
pnpm test:e2e
pnpm build
```

启动开发期 Hub Server：

```bash
pnpm dev:server
```

启动管理后台：

```bash
pnpm dev:admin
```

启动本地 MCP Proxy：

```bash
pnpm dev:client -- proxy --root . --port 8722
```

默认地址：

```text
Hub Server: http://127.0.0.1:8721
MCP endpoint: http://127.0.0.1:8721/mcp
Local MCP Proxy: http://127.0.0.1:8722/mcp
Web Admin: http://127.0.0.1:5173
```

## CLI 示例

当前 CLI 通过 workspace dev script 运行：

初始化全局配置，并选择要注册的 MCP Host 工具：

```bash
pnpm --filter mcp-dev-mesh dev -- init --global --yes --tool codex --tool opencode
```

也可以用逗号列表：

```bash
pnpm --filter mcp-dev-mesh dev -- init --global --tools codex,claude,opencode --mcp-url http://127.0.0.1:8722/mcp --yes
```

该命令会写入 `~/.dev-mesh/config.toml` 和 `~/.dev-mesh/identity.json`。在交互终端中会展示 detected/configured 状态，支持键盘 toggle 和 scope 切换；选择 Codex、Claude Code 或 opencode 时会同时写入对应 scope 的 `dev-mesh` MCP server 配置。

加入开发期 Hub Server 的 group：

```bash
pnpm --filter mcp-dev-mesh dev -- join http://127.0.0.1:8721 \
  --group default \
  --name Xiaoyun \
  --token devmesh-local-invite \
  --yes
```

`dmx join` 会先读取 `/.well-known/dev-mesh`，再调用 `/api/v1/join`。成功后会在全局 `config.toml` 写入 `[[servers]]` 和 `[[groups]]`，并把 access token 保存在本机 `identity.json`，不会写入可检查或可分享的 TOML 配置。

启动当前项目的本地 MCP Proxy：

```bash
pnpm --filter mcp-dev-mesh dev -- proxy --root . --name local --port 8722
```

`dmx proxy` 默认监听 `http://127.0.0.1:8722/mcp`。它使用 Koa2 和官方 MCP TypeScript SDK Streamable HTTP transport，暴露与 Hub Server 一致的核心 MCP tools，并把 capture/search/rate 写入当前项目 `.dev-mesh/`。

初始化项目本地知识库：

```bash
pnpm --filter mcp-dev-mesh dev -- init --root . --name local
```

写入一条本地知识：

```bash
pnpm --filter mcp-dev-mesh dev -- capture \
  --root . \
  --name local \
  --title "Run focused tests" \
  --summary "Use pnpm test:unit before pushing." \
  --type command \
  --para resources:test-commands
```

将高风险候选放入 review queue：

```bash
pnpm --filter mcp-dev-mesh dev -- capture \
  --root . \
  --name local \
  --review \
  --reason "High-risk automatic extraction" \
  --title "Review before publishing" \
  --summary "This candidate should be accepted before it becomes project knowledge." \
  --type decision
```

查看、接受或拒绝 inbox 候选：

```bash
pnpm --filter mcp-dev-mesh dev -- inbox --root .
pnpm --filter mcp-dev-mesh dev -- inbox accept <queue-id> --root .
pnpm --filter mcp-dev-mesh dev -- inbox reject <queue-id> --root . --reason "Not durable enough"
```

检索本地知识：

```bash
pnpm --filter mcp-dev-mesh dev -- search "focused tests" --root .
```

查看本地状态：

```bash
pnpm --filter mcp-dev-mesh dev -- status --root .
```

提交显式反馈：

```bash
pnpm --filter mcp-dev-mesh dev -- rate <knowledge-id> \
  --root . \
  --name local \
  --rating 1 \
  --reason "Useful local command"
```

重建本地索引 manifest：

```bash
pnpm --filter mcp-dev-mesh dev -- index rebuild --root .
```

该命令会同时重建 `.dev-mesh/index/manifest.json` 和 `.dev-mesh/index/mesh.sqlite`，后者包含可重建的本地关键词 FTS 索引。

运行 doctor：

```bash
pnpm --filter mcp-dev-mesh dev -- doctor --root .
```

`dmx doctor` 会检查本地 store、privacy 配置、sync 身份和内置 adapter 状态，并在风险项上给出 `fixHint`。

## `.dev-mesh/` 本地知识库

执行 `dmx init` 或 runtime 初始化后，项目目录下会生成 `.dev-mesh/`：

```text
.dev-mesh/
  config.toml
  .gitignore
  knowledge/
    raw/
    extract/
    canonical/
    ratings/
    usage/
    para/
  events/
  index/
  queue/
  sync/
  secrets/
```

约定：

- `knowledge/*.jsonl` 保存本地知识视图。
- `events/*.jsonl` 是 append-only 事件日志。
- `knowledge/ratings/*.jsonl` 保存显式反馈事件，不会被当作普通知识检索。
- `index/manifest.json` 和 `index/mesh.sqlite` 是可重建本地索引。
- `queue/pending.jsonl` 保存待 review 候选，接受后写入 knowledge 和 events，拒绝后进入 `queue/rejected.jsonl`。
- `secrets/` 永远不应该同步或提交。

## 本地 MCP Proxy

本地 proxy 由 `packages/client` 提供，可作为库嵌入，也可通过 `dmx proxy` 启动：

```text
GET  /healthz
GET  /mcp
POST /mcp
```

MCP tools 与 Hub Server 核心工具保持一致：

```text
mesh_search_context
mesh_capture_knowledge
mesh_capture_task
mesh_rate_knowledge
mesh_search_member_experience
mesh_resolve_term
```

集成测试覆盖 SDK client 调用 `tools/list`、`mesh_capture_knowledge`、`mesh_search_context`，并验证默认写入当前项目 store。

## HTTP API Skeleton

开发期 Hub Server 使用 Koa2 提供以下基础端点，MCP `/mcp` 使用官方 MCP TypeScript SDK：

```text
GET  /healthz
GET  /.well-known/dev-mesh
GET  /api/v1/groups
POST /api/v1/join
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
GET  /mcp
POST /mcp
```

MCP `/mcp` 已使用 SDK Streamable HTTP transport 接入，集成测试覆盖 `tools/list` 和 `tools/call`。MCP tool contract 目前包含：

```text
mesh_search_context
mesh_capture_knowledge
mesh_capture_task
mesh_rate_knowledge
mesh_search_member_experience
mesh_resolve_term
```

其中 `mesh_search_context` 返回稳定的 Context Pack：包含 `query`、`generatedAt` 和带来源、PARA、质量信号的 `items`。当 MCP Server 使用 `JsonlKnowledgeRepository` 时，`mesh_capture_knowledge`、`mesh_capture_task` 和 `mesh_rate_knowledge` 会同时写入本地 `.dev-mesh/` 的知识视图、事件日志和 ratings 反馈文件。

开发期 Hub Server 目前使用内存状态管理 groups、invite token、members、access token、projects、knowledge edges 和 audit logs：

- `GET /api/v1/groups` 返回可加入的 group 摘要。
- `POST /api/v1/join` 需要有效 `inviteToken`，成功后签发 group-scoped Bearer access token。
- `POST /api/v1/sync/push`、`GET /api/v1/sync/pull`、`GET /api/v1/projects`、`POST /api/v1/projects` 和 `GET /api/v1/projects/:id/brief` 都需要 `Authorization: Bearer <token>`。
- sync push/pull 目前使用开发期内存 event log：事件按 group 隔离，cursor 使用 `cur_<groupKey>_<offset>`，重复 event id 不会重复追加，pull 只返回当前 group 的增量事件。
- `knowledge.deleted` sync event 需要携带 `{ knowledgeId, tombstone: true }`，有效 tombstone 会按 knowledge id 写入 admin audit，并在 replay 时把目标 knowledge 标记为 `tombstone`；缺少 tombstone 语义的删除事件会被拒绝。
- 服务端接受的 sync event 会附加 `log.sequence` / `log.hash` / `log.previousHash` 元数据，用于开发期 append-only event log 的 tamper-evident 链式校验基础。
- join 会签发开发期 `syncSigningSecret` 并只保存在本机 `identity.json`；带 `hmac-sha256` 签名的 sync event 会被校验，篡改或无效签名会被拒绝并写入 admin audit。
- `packages/server` 暴露 `federateHubSyncEvents` 和 `federateHubSyncEventsFromHttpPeer`：可在两个 HubState 之间或通过 HTTP peer event-log endpoint 按 peer/group cursor 增量复制 sync event，重复复制幂等跳过，并写入 federation audit。
- project list 和 project brief 默认只返回当前 token 所属 group 内且 ACL 允许的项目；跨 group 或未授权项目返回 404，避免泄露 project id。
- 禁用 member 后，该 member 已签发的 Bearer token 会被服务端拒绝。
- 本地开发默认 seed 一个 `default` group 和 `devmesh-local-invite` invite token。生产部署前需要替换为持久化 invite、短期 token、持久化审计和更完整 ACL。
- `apps/web-admin` 通过 `/api/v1/admin/*` 查看 server health、groups、members、invites、projects、glossary、knowledge、knowledge edges、quality review、task digest、review queue 和 audit log，并支持创建 group / project、创建或撤销 invite、禁用 member、配置 project ACL、创建和编辑 glossary term，以及创建 supersede / duplicate / contradict edge。

## 测试策略

本仓库按测试类型拆分 Vitest 配置：

| 命令 | 范围 |
| --- | --- |
| `pnpm test:unit` | 纯领域逻辑、local-store、registry、依赖方向检查等单元测试 |
| `pnpm test:integration` | CLI local-only flow、Hub Server HTTP flow 等集成测试 |
| `pnpm test:contract` | MCP tool schema 和 contract 测试 |
| `pnpm test:security` | redaction pipeline 和敏感内容写入安全测试 |
| `pnpm test:e2e` | 启动真实 `dmx-server` 的 Streamable HTTP MCP smoke 测试 |
| `pnpm test` | 运行全部已发现测试 |

PostgreSQL repository 集成测试默认跳过；如需运行真实数据库测试，先提供专用测试库连接：

```bash
DEV_MESH_POSTGRES_URL=postgres://devmesh:devmesh@127.0.0.1:5432/devmesh_test pnpm exec vitest run packages/storage/tests/postgres.integration.test.ts
```

## 开发规范

后续开发遵循 [docs/development-guide.md](./docs/development-guide.md)：代码组织以包职责和依赖方向为核心，避免过度耦合和过早抽象；实现保持简洁清晰，复杂边界、持久化格式、安全策略和跨包例外需要写清楚注释。

## 二次开发示例

Agent context pack：

```ts
import { createAgentContextService } from '@mcp-dev-mesh/agent';
import { createDevMeshCore } from '@mcp-dev-mesh/core';

const core = createDevMeshCore({ projectRoot: process.cwd() });
const agent = createAgentContextService({ core });

const contextPack = await agent.buildContextPack({
  query: 'login state',
  para: {
    category: 'areas',
    key: 'backend/auth'
  },
  layers: ['canonical', 'extract']
});
```

更多 typed examples 见 [examples](./examples)：

```text
custom-agent.ts        # 组合 core 和 agent 构建 Context Pack
custom-scorer.ts       # 注册自定义 QualityScorer extension
client-runtime.ts      # 嵌入 client runtime、review queue、索引和检索
local-store-index.ts   # JSONL store + SQLite FTS 本地索引
embedded-server.ts     # 作为库启动 Hub server 和 MCP endpoint
```

示例类型检查：

```bash
pnpm typecheck:examples
```

## 开发状态

当前重点已推进到阶段 5 分布式 Mesh：

- 已完成 `dmx init --global` TUI、`dmx join` join flow、`dmx proxy` 本地 MCP Proxy、Codex/Claude Code/opencode adapter detect/configure/remove/doctor，以及 MCP session 自动初始化项目 store。
- 已完成 Git snapshot provider、filesystem snapshot provider 和 MCP tool call provider，能采集 branch/commit/diff stat/test 摘要、文件元数据、TODO/FIXME 计数、工具调用成功/失败信号，并按 `.meshignore`、`.env`、`*.pem`、`*.key`、secrets 路径等隐私策略过滤。
- 已完成 rule-based extractor，能把 provider raw event 生成带 risk 和 evidence metadata 的 `task_progress`、`command`、`pitfall` 等 extract proposal。
- 已完成内置 redactor 的 secret、PII、URL token、Authorization、cookie、private key 和 sensitive path 脱敏。
- 已完成内置 quality scorers，覆盖 confidence、rating、adoption、freshness 和 source trust patch。
- 已完成 client runtime 的 raw event capture pipeline：provider raw event 写入本地 event log，extract proposal 低风险自动发布，高/中风险进入 `dmx inbox`。
- 已完成 member-specific experience search 和内置 hybrid search backend，支持 keyword、deterministic embedding mock、recency、quality 和 adoption ranking。
- 已完成 web-admin 的 member 禁用、invite 创建/撤销，以及 Hub admin audit log 写入和查询。
- 已完成 project ACL 管理：支持 group/restricted visibility、成员角色配置、项目列表和 brief ACL 过滤。
- 已完成 glossary 管理：支持 admin API 和 web-admin 创建、查询、编辑 canonical glossary term，并复用 `mesh_resolve_term` 检索。
- 已完成 knowledge edge 管理：支持 supersede / duplicate / contradict edge，supersede 后默认检索仅返回 active 项，可通过 `includeSuperseded=true` 查看旧项。
- 已完成 quality review dashboard：按 qualityScore、confidence、rating、adoption、stale 和非 active 状态汇总待复审知识。
- 已完成 task digest：按任务 key 聚合 task knowledge，展示最新状态、owner、标签、历史片段和状态汇总。
- 已完成 group-scoped sync event log 基础：支持 push/pull cursor、重复 push 幂等和跨 group 隔离。
- 已完成 signed sync event 校验基础：支持开发期 HMAC 签名验证、篡改事件拒绝和 audit 记录。
- 已完成 server-to-server federation：支持 HubState 之间和 HTTP peer event-log endpoint 的 group/cursor 增量复制、重复复制幂等、tombstone event 传播和 audit 记录。
- 已完成 tombstone sync：`knowledge.deleted` 必须指向 knowledge id，push / federation merge 会写入 tombstone audit，并可 replay 到 repository 的 `tombstone` 状态。
- 已完成 signed event log 验证基础：服务端为 group sync log 生成 sequence、hash 和 previousHash，并可复验 hash chain、HMAC 签名和写入 verification failure audit。
- 下一步推进更完整的分布式同步能力。
- 扩展自动沉淀的质量评分和低风险自动发布策略。
- 引入 PostgreSQL repository、持久化 Hub 状态和同步测试。

后续任务清单见 [docs/TODO.md](./docs/TODO.md)。

详细设计见 [docs/technical-design.md](./docs/technical-design.md)。

## 安全说明

- 默认不上传原始对话全文。
- 默认启用脱敏策略，后续高风险内容应进入 review queue。
- `.dev-mesh/secrets/`、credential 文件、`.env`、`*.pem`、`*.key` 不应同步或提交。
- 当前实现仍是开发骨架，生产部署前需要补齐认证、持久化 ACL、持久化审计、redaction 和同步安全测试。
