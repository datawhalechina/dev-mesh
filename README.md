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
- `apps/dmx`：`dmx` CLI skeleton
- `apps/mesh-server`：Hub Server 启动入口
- `packages/core`：知识条目、PARA、质量信号、搜索和评分
- `packages/agent`：Context Pack 构建
- `packages/client`：本地 runtime 和 local-only 组合
- `packages/server`：Fastify HTTP API 和 MCP `/mcp` skeleton
- `packages/local-store`：`.dev-mesh/` bootstrap 和 JSONL 本地存储
- `packages/mcp-contracts`：MCP tools schema 和注册函数
- `packages/extension-api`、`packages/registry`：扩展接口和注册解析
- 分层测试脚本：unit、integration、contract、security、e2e

## 项目结构

```text
apps/
  dmx/                    # CLI 可执行入口
  mesh-server/            # Hub Server 可执行入口
packages/
  core/                   # 纯领域模型和核心服务
  agent/                  # Agent context pack 编排
  client/                 # 本地 runtime、CLI 支撑和项目 store 组合
  server/                 # Hub Server、HTTP API、MCP endpoint
  extension-api/          # Adapter / Provider / Extractor / Scorer 等接口
  registry/               # 扩展注册和 capability resolve
  mcp-contracts/          # MCP tool schema 和注册
  protocol/               # Sync / join / well-known API 类型
  local-store/            # .dev-mesh 本地知识库
  adapters/               # 内置工具适配器 skeleton
  providers/              # 内置采集源 skeleton
  extractor/              # 提取器 skeleton
  quality/                # 质量评分器 skeleton
  search/                 # 搜索 backend skeleton
  storage/                # 存储 backend skeleton
docs/
  technical-design.md     # 技术设计文档
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

默认地址：

```text
Hub Server: http://127.0.0.1:8721
MCP endpoint: http://127.0.0.1:8721/mcp
```

## CLI 示例

当前 CLI 通过 workspace dev script 运行：

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

检索本地知识：

```bash
pnpm --filter mcp-dev-mesh dev -- search "focused tests" --root .
```

查看本地状态：

```bash
pnpm --filter mcp-dev-mesh dev -- status --root .
```

运行 doctor：

```bash
pnpm --filter mcp-dev-mesh dev -- doctor --root .
```

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
- `index/` 是可重建索引。
- `queue/` 保存待 review 或拒绝的候选。
- `secrets/` 永远不应该同步或提交。

## HTTP API Skeleton

开发期 Hub Server 已提供以下基础端点：

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
GET  /api/v1/admin/audit
GET  /mcp
POST /mcp
```

MCP tool contract 目前包含：

```text
mesh_search_context
mesh_capture_knowledge
mesh_capture_task
mesh_rate_knowledge
mesh_search_member_experience
mesh_resolve_term
```

## 测试策略

本仓库按测试类型拆分 Vitest 配置：

| 命令 | 范围 |
| --- | --- |
| `pnpm test:unit` | 纯领域逻辑、local-store、registry 等单元测试 |
| `pnpm test:integration` | CLI local-only flow、Hub Server HTTP flow 等集成测试 |
| `pnpm test:contract` | MCP tool schema 和 contract 测试 |
| `pnpm test:security` | 安全测试入口，当前预留 |
| `pnpm test:e2e` | E2E smoke 入口，当前预留 |
| `pnpm test` | 运行全部已发现测试 |

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

更多示例见 [examples](./examples)。

## 开发状态

当前重点是阶段 0 到阶段 1：

- 完善 MCP `/mcp` 的真实工具调用集成。
- 扩展 local-store schema、migration 和索引能力。
- 补充 redaction、安全测试和 review queue。
- 接入真实 Codex、Claude Code、opencode adapter 配置流程。
- 引入 SQLite/PostgreSQL repository 和同步测试。

详细设计见 [docs/technical-design.md](./docs/technical-design.md)。

## 安全说明

- 默认不上传原始对话全文。
- 默认启用脱敏策略，后续高风险内容应进入 review queue。
- `.dev-mesh/secrets/`、credential 文件、`.env`、`*.pem`、`*.key` 不应同步或提交。
- 当前实现仍是开发骨架，生产部署前需要补齐认证、ACL、审计、redaction 和同步安全测试。
