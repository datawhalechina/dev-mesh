# DevMesh CRDT 知识同步设计

状态：Proposed  
日期：2026-06-15

## 背景

当前同步模型基于本地 JSONL 事件、push/pull 游标，以及服务端把同步事件重放到 Admin 可见的知识仓库。这个模型适合增量传输，但游标只能说明客户端已经读到或推送到事件流里的某个位置，不能证明客户端、本地投影和 Hub 上最终物化出来的知识状态完全一致。

如果 DevMesh 要成为稳定可用的 local-first 产品，知识写入、更新、删除、关联和评分必须能在多个离线客户端之间可靠收敛。新版设计把 CRDT 文档作为唯一可同步事实源，把本地索引、Admin 视图、JSONL 导出和图谱文件都视为可重建的 projections。

## 目标

- 在离线编辑、重复推送、乱序传输和重试场景下保持知识状态可靠收敛。
- 使用 CRDT 状态作为唯一权威的同步数据模型。
- 简化 `.dev-mesh/`，只保留少量持久事实源和可重建缓存。
- 让知识图谱里的实体和关系成为一等模型，而不是只作为派生 metadata。
- 让 daemon 自动同步 CRDT changes，并自动生成 projections。
- 允许重写 MCP tools、CLI、HTTP API、存储和同步协议，以 v2 架构正确性优先。

## 非目标

- 不替代 Git、Issue、PR 或外部文档系统。
- 不要求用户在正常使用中手动执行同步或 projection rebuild。
- 不把 SQLite、JSONL、Admin API 表当成权威状态。
- 第一阶段不以实时多人富文本编辑为目标。

## 核心原则

```text
CRDT document = 写模型和同步事实源
projections   = 面向搜索、图谱、Admin、MCP 查询的可重建读模型
audit logs    = 可选历史记录，用于解释和审计，不用于证明状态正确
```

### 总体架构图

```text
Codex / Claude / opencode
        |
        | MCP tools
        v
Local MCP Runtime
  - context.build
  - knowledge.*
  - graph.*
  - entity.*
  - quality.signal
        |
        | writes
        v
Local CRDT Store
  .dev-mesh/crdt/project.automerge
        |
        | materialize
        v
Local Projections
  - knowledge.sqlite
  - graph.sqlite
  - search.sqlite
        ^
        |
        | sync exchange
        v
Daemon
  - watches CRDT changes
  - syncs with Hub
  - rebuilds projections
        |
        | CRDT sync messages
        v
Hub Server
  - global CRDT namespace
  - group/member ACL
  - global graph materializer
        |
        | materialize
        v
Server Projections
  - global-knowledge
  - global-graph
  - global-search
  - global-quality
  - global-conflicts
        |
        v
Admin / Global Graph / Remote MCP
```

### 核心数据流

建议把整个系统的数据流固定为下面这条链路，避免实现时在 JSONL、CRDT、projection 之间来回打架：

```text
MCP/API 写入
  -> CRDT change
  -> daemon / Hub apply
  -> projection materialize
  -> search / graph / Admin query
```

反向同步和展示也遵循同样的分层：

```text
Hub CRDT
  -> sync exchange
  -> local CRDT apply
  -> local projection materialize
  -> 本地搜索 / 图谱 / CLI / MCP 查询
```

任何不在这条链路里的中间状态，都应视为临时实现细节，而不是产品语义的一部分。

所有知识操作都写入 CRDT：

```text
captureKnowledge
updateKnowledge
deleteKnowledge
linkKnowledge
rateKnowledge
resolveEntity
mergeEntity
```

同步服务端本质上也是写入 CRDT：

```text
client CRDT changes
  -> Hub 校验身份和权限
  -> Hub apply changes 到服务端 CRDT document
  -> CRDT merge 让状态收敛
  -> Hub materialize projections
  -> Admin/API 从 projections 读取
```

## 推荐 CRDT

默认选择 Automerge。

DevMesh 的知识库更像结构化的 local-first 数据，而不是共享富文本编辑器。Automerge 提供 document changes、heads、merge 语义、二进制保存和 sync state，更贴合第一阶段需求。

Yjs 仍然适合后续富文本、白板或实时协同编辑界面，但不作为知识库 v2 同步的首选事实源。

## 本地 Store 结构

v2 的 `.dev-mesh/` 应该尽量小：

```text
.dev-mesh/
  config.toml
  state/
    identity.json
    daemon.json
  crdt/
    project.automerge
    sync/
      peers.json
      heads.json
  projections/
    knowledge.sqlite
    graph.sqlite
    search.sqlite
  exports/
    knowledge.jsonl
  logs/
    audit.jsonl
```

目录职责：

| 路径 | 职责 | 是否权威 |
| --- | --- | --- |
| `config.toml` | 项目配置和隐私策略。 | 是 |
| `state/` | 本地 daemon 和身份状态。 | 仅本地权威 |
| `crdt/project.automerge` | 项目知识 CRDT 文档。 | 是 |
| `crdt/sync/` | peer 同步状态、已知 heads、重试元数据。 | 传输状态 |
| `projections/` | 可重建读模型。 | 否 |
| `exports/` | 人类可读的备份和导出文件。 | 否 |
| `logs/` | 本地审计日志。 | 否 |

现有 `knowledge/raw`、`knowledge/extract`、`knowledge/canonical`、`events` 和 `sync/cursors.json` 在 v2 中只作为一次性数据导入来源，不再作为运行期格式或兼容目标。

## 领域模型

CRDT 文档直接表达知识、实体、关系和声明：

```ts
interface ProjectDoc {
  schemaVersion: 2;
  project: ProjectMeta;
  groupKey: string;
  knowledge: Record<KnowledgeId, KnowledgeNode>;
  entities: Record<EntityId, EntityNode>;
  relations: Record<RelationId, RelationEdge>;
  claims: Record<ClaimId, ClaimNode>;
}
```

### KnowledgeNode

```ts
interface KnowledgeNode {
  id: string;
  layer: 'raw' | 'extract' | 'canonical';
  type: string;
  typeProfile?: {
    volatility: 'stable' | 'evolving' | 'volatile';
    retention: 'durable' | 'review' | 'ephemeral';
    defaultTtlDays?: number;
  };
  title: string;
  summary: string;
  content?: string;
  tags: string[];
  para: {
    category: 'projects' | 'areas' | 'resources' | 'archives';
    key: string;
  };
  status: 'active' | 'superseded' | 'tombstone';
  quality: QualitySignals;
  source: KnowledgeSource;
  createdBy: MemberIdentity;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
```

### 知识类型画像和沉淀策略

`KnowledgeNode.type` 不能只是 UI 上的分类，还要影响自动沉淀、上下文召回和过期治理。v2 内置类型画像：

| type | 用途 | 默认稳定性 | 默认沉淀策略 |
| --- | --- | --- | --- |
| `project_fact` | 当前项目事实，例如临时分支、当前依赖版本、一次性环境状态。 | volatile | 默认不自动捕获，30 天 TTL，默认上下文排除。 |
| `macro_experience` | 跨项目可复用的宏观经验。 | stable | 允许自动捕获，长期进入默认上下文。 |
| `design_principle` | 架构、产品或代码设计原则。 | stable | 允许自动捕获，长期进入默认上下文。 |
| `pitfall_record` | 踩坑、故障、调试教训。 | evolving | 允许自动捕获，长期进入默认上下文。 |
| `decision` / `convention` / `command` / `runbook` / `adr` / `glossary` | 现有长期项目知识。 | stable/evolving | 允许自动捕获，默认上下文可见。 |

项目配置需要提供知识策略：

```toml
[knowledge]
auto_capture_types = ["decision", "convention", "task", "pitfall", "pitfall_record", "command", "glossary", "runbook", "adr", "note", "macro_experience", "design_principle"]
include_volatile_in_context = false
```

策略语义：

- 自动沉淀入口必须检查 `auto_capture_types`。未允许的类型进入 review queue，而不是直接写入长期 CRDT 知识。
- `project_fact` 默认视为易过期事实，除显式开启或显式按 type 查询外，不进入默认 context pack。
- projection 负责根据类型画像、TTL、质量信号和人工反馈计算 `freshness` 与上下文可见性；CRDT 只保存事实、类型和必要的类型画像快照。
- `KnowledgeTypePlugin` 可以扩展类型、校验字段、TTL 和默认召回策略，但不能绕过 redaction、ACL、review 和 CRDT 写入审计。

### EntityNode

```ts
interface EntityNode {
  id: string;
  kind:
    | 'project'
    | 'repo'
    | 'package'
    | 'api'
    | 'person'
    | 'service'
    | 'concept'
    | 'file'
    | 'command';
  name: string;
  aliases: string[];
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

### RelationEdge

```ts
interface RelationEdge {
  id: string;
  from: string;
  to: string;
  kind:
    | 'mentions'
    | 'about'
    | 'depends_on'
    | 'implemented_by'
    | 'supersedes'
    | 'duplicates'
    | 'contradicts'
    | 'supports'
    | 'owned_by'
    | 'uses';
  evidenceKnowledgeIds: string[];
  confidence: number;
  createdBy: MemberIdentity;
  createdAt: string;
}
```

### ClaimNode

Claim 用来表达可能被支持、反驳或取代的声明：

```ts
interface ClaimNode {
  id: string;
  text: string;
  subjectEntityId?: string;
  objectEntityId?: string;
  evidenceKnowledgeIds: string[];
  confidence: number;
  status: 'active' | 'disputed' | 'superseded' | 'tombstone';
  createdAt: string;
  updatedAt: string;
}
```

## Projections

Projections 的作用是把 CRDT 状态转换成适合读取、搜索和展示的数据形态。

推荐默认 projections：

```text
projections/
  knowledge.sqlite  # 知识列表、过滤、排序、分页
  graph.sqlite      # 实体、知识和关系遍历
  search.sqlite     # 关键词/FTS 和可选 embedding 元数据
```

本地默认推荐 SQLite，因为它是单文件、零服务、支持索引和 FTS，坏了可以直接从 CRDT 重建。但 SQLite 不是强制要求。服务端生产环境可以把 projections 放到 PostgreSQL、pgvector、Redis 或其他后端。

projection metadata 需要记录来源 CRDT heads：

```json
{
  "schemaVersion": 2,
  "source": "crdt/project.automerge",
  "lastHeads": ["..."],
  "rebuiltAt": "2026-06-15T00:00:00.000Z"
}
```

如果 projection schema、文件或 `lastHeads` 与当前 CRDT 状态不匹配，daemon 自动增量更新或全量重建。

## Knowledge Branch 和 Group 知识空间

为了避免易过期项目事实污染长期记忆，同时又支持多个项目共享同一套设计经验，v2 对用户暴露 knowledge branch，对实现保留 group 作为知识共享边界。项目和 group 不再是两套并行管理模型，而是同一个知识空间的两种视角：默认所有项目 checkout 到 `main`，需要隔离或主题化时再显式切换知识分支。

项目不直接决定远端服务器连接地址，只声明当前 active knowledge branch。多个项目切到同一个 branch 时，它们共享同一个知识空间；一个项目切到专用 branch 时，它就拥有独立的知识上下文。项目本地可以记录多个可见 branch，但日常读写保持一个 active branch，再加一个可选 base branch。

### Git for knowledge：知识分支

DevMesh 面向开发者，因此用户层应该直接使用开发者熟悉的 Git 心智。产品语言使用 **knowledge branch**，底层实现仍使用 group 作为同步和权限边界：

```text
knowledge branch = 用户理解和操作的知识分支
group            = 服务端同步、ACL 和 CRDT namespace 边界
```

对外 API、Web Admin、CLI/MCP branch 工具和文档统一使用 `branchKey` 表达知识分支。过渡期服务端存储、ACL、同步授权和部分旧接口仍保留 `groupKey` 作为内部 namespace / 兼容字段；新请求优先传 `branchKey`，旧 `groupKey` 输入继续兼容，响应在知识边界相关 summary 中提供 `branchKey`，必要时保留 `groupKey` 便于旧客户端平滑迁移。

映射关系：

| Git 概念 | DevMesh 用户概念 | 底层实现 |
| --- | --- | --- |
| branch | knowledge branch | group / CRDT namespace |
| checkout | 切换当前知识分支 | 设置项目 active branch / group |
| commit | capture 一条知识 | CRDT change 写入 active branch |
| merge | 把一个知识分支的内容提升到另一个分支 | review 后写入目标 branch / group |
| cherry-pick | 选一条知识发布到另一个分支 | 单条 knowledge 复制或链接到目标 branch |
| log | 知识时间线和审计记录 | audit / CRDT change history |
| status | 当前分支、同步、review 和 projection 状态 | daemon status + projection health |
| ignore | 不沉淀哪些内容 | redaction + capture policy + type profile |

这个类比只用于产品和 API 心智，不要求复制 Git 的对象库、文本 patch 或 ref 实现。Git 的 append-only commit DAG 和 merge 工作流有 CRDT-like 的收敛直觉，但 DevMesh 的权威写模型仍然是 Automerge/CRDT，读取模型仍然是 projections；checkout 只是切换后续读写 namespace，不像 Git checkout 那样把工作树文件整体替换成另一个 commit。

默认交互规则：

- 默认 active branch 是 `main`，也就是所有项目的默认知识群组。
- 一个项目同一时间只有一个 active knowledge branch。
- 项目可以记录多个可见 branch，但写入入口只有 active branch。
- `capture` 默认只写入 active branch，不做多分支自动写入。
- `context.build` 默认读取 active branch，可选再读取一个 base branch。
- `context.build`、`knowledge.search/list` 和 `graph.explore` 可以显式传 `branch`，临时读取某个知识分支，但不改变当前 checkout。
- 每个 branch 可以配置自己的知识沉淀策略，例如 `balanced`、`durable_only`、`frontend_design`、`backend_design`。
- `project_fact` 默认像工作区临时状态，不自动 commit；宏观经验、设计原则、踩坑记录更适合进入长期 branch。
- 早期避免暴露 rebase、force push、多目标自动写入等复杂能力。

1.x 过渡实现可以先把 branch 写入 `KnowledgeItem.source.metadata.branch`，旧条目缺省视为 `main`。本地 JSONL repository、SQLite search 和 graph explore 按 active/base branch 过滤；Hub 同步投影优先在对外 metadata / summary 暴露 `branchKey`，同时保留 `source.metadata.groupKey` 作为旧数据和内部 namespace 兼容。Admin/MCP 查询按 branch 裁剪，并兼容旧 group 参数。Admin 的 branch create/update、project checkout、knowledge branch publish 和 bulk publish 成功项同时写入 `server-global/admin-operations` Automerge 操作日志，作为管理面 CRDT 化的过渡事实源。v2 CRDT 正式实现再把这些字段替换为稳定 CRDT namespace projection，并把管理面拆入稳定 server/global schema 分片。

策略第一版只暴露少量预设，避免把配置做成规则引擎：

| Preset | 适用场景 | 自动沉淀类型 |
| --- | --- | --- |
| `balanced` | 默认 `main`，适合日常开发知识。 | `decision`、`convention`、`task`、`command`、`runbook`、`adr`、`note`、`macro_experience`、`design_principle`、`pitfall_record` 等。 |
| `durable_only` | 公共原则、长期经验、跨项目共享。 | `decision`、`adr`、`macro_experience`、`design_principle`、`pitfall_record`。 |
| `frontend_design` | 前端设计方案、组件规范、交互踩坑。 | 前端相关 `decision`、`convention`、`design_principle`、`macro_experience`、`pitfall_record`、`note`。 |
| `backend_design` | 后端架构、接口、数据库和运维方案。 | 后端相关 `decision`、`convention`、`design_principle`、`macro_experience`、`pitfall_record`、`runbook`、`note`。 |

`project_fact` 不进入任何默认预设。需要保留短期事实时，用户应显式捕获或从 review queue 接受，并依赖 TTL / freshness projection 控制召回。

推荐项目配置：

```toml
[knowledge_branch]
active = "main"
base = "shared"
branches = ["main", "frontend", "backend", "principles", "shared"]

[knowledge_branch.policies.main]
preset = "balanced"

[knowledge_branch.policies.frontend]
preset = "frontend_design"

[knowledge_branch.policies.backend]
preset = "backend_design"

[knowledge_branch.policies.principles]
preset = "durable_only"
```

推荐 CLI 语言：

```bash
dmx branch list
dmx branch switch frontend
dmx branch create backend --policy backend_design
dmx branch policy durable_only
dmx search "auth session" --branch frontend
dmx knowledge list --branch shared
dmx graph explore --branch backend --query "database"
dmx capture
dmx log
dmx status
dmx merge frontend main
dmx cherry-pick <knowledge-id> --to main
```

日常体验应该像 Git：

```text
切到 frontend 分支
  -> 自动沉淀前端相关设计方案和踩坑记录
  -> 查询 frontend + shared

切到 backend 分支
  -> 自动沉淀后端接口、数据库、服务设计经验
  -> 查询 backend + shared

切到 principles 分支
  -> 只沉淀宏观经验和设计原则
  -> 默认不接受项目事实
```

```text
server
  group: main               # 默认：所有项目 checkout 到同一个知识分支
    shared durable knowledge
  group: frontend-platform  # 显式切换：多项目共享前端知识分支
    ui-app knowledge
    component-lib knowledge
    design-system knowledge
  group: project-a-private  # 显式切换：需要隔离时创建专用知识分支
    project-a scoped knowledge
```

### 默认规则

- 全局配置只保存服务器连接地址。
- 项目配置保存当前 active/base knowledge branch；实现上解析为一个或多个 `group_key`。
- 默认创建项目时，active branch 是 `main`，也就是默认所有项目在同一个知识群组里。
- 多个项目切到相同 knowledge branch / `group_key` 时，共享同一个知识空间；切到专用 branch 时才隔离。
- 查询和同步默认只发生在当前 active branch 对应的 group 内。
- 项目和 group 的差异只体现在入口和归属上，不再体现在两套不同的知识模型里。

### 隔离机制

| 机制 | 作用 |
| --- | --- |
| Branch 绑定 | 项目配置声明 active knowledge branch，决定默认读写哪个知识空间。 |
| Group ACL | 服务端按 branch 对应的 group 过滤成员、项目和知识。 |
| 默认 `main` group | 没有显式切换时，所有项目共享同一套长期知识。 |
| 显式 branch | 切到同一个 branch 表示共享；切到专用 branch 表示隔离。 |
| 来源标注 | projection 返回结果必须标注来源项目和 group。 |
| Admin 管理 | Admin 页面管理 branch/group、项目加入关系和成员权限。 |

### 推荐使用方式

```text
隔离项目
  -> active branch = project-a
  -> 只读写 project-a branch

共享知识的项目集
  -> active branch = frontend-platform
  -> ui-app / component-lib / design-system 都读写同一 branch
```

### Branch / Project 统一管理

Admin 页面负责配置 knowledge branch / group 和项目加入关系，但项目在这里主要表现为 branch 的本地入口和别名，不再需要单独维护一套和 group 并列的知识边界：

- 创建 knowledge branch。
- 设置 branch 名称、描述和默认沉淀策略。
- 把项目加入、移出或切换到 branch。
- 设置 branch/group 成员权限。
- 查看 branch 内项目、知识、实体和冲突。
- 合并两个 branch 或把项目拆到新 branch。
- 维护项目别名、默认显示名和本地入口状态。

真正的跨项目共享通过“切到同一个 knowledge branch”实现；底层表现为加入同一个 group，不再需要 project -> global 的晋升流程作为默认机制。

当前过渡实现中，Admin 的 project checkout 会把项目记录从原 group key 移到目标 branch/group key，并写入 `project.branch.checked_out` 审计日志。这个动作只改变项目后续默认读写的 knowledge branch，不会自动搬迁原 branch 下已经同步的 CRDT document；历史知识迁移、branch merge 或 split 必须走后续独立的 review/merge 流程。

Admin 还可以先提供单条知识的 publish/cherry-pick 过渡能力：从 source branch 读取一条知识，在 target branch 生成一条新的 knowledge item，并写入 `publishedFromId`、`publishedFromBranch` 和 `knowledge.branch.published` 审计记录。这个动作适合 review 后把成熟经验提升到共享 branch；它不是完整 branch merge，也不会复制整条 CRDT change history 或自动处理语义冲突。

在真正执行跨 branch merge 前，Admin 应先提供只读 merge preview。Preview 对比 source branch 和 target branch 的投影知识，将候选项分成三类：`publishable` 表示目标 branch 没有匹配知识；`already_published` 表示目标 branch 已存在带 `publishedFromId` 的发布副本；`possible_conflict` 表示目标 branch 已有相同 `entryKey` 或标题的知识，需要人工 review。Preview 不写 CRDT、不写 audit，只帮助维护者决定后续 cherry-pick、merge 或人工处理。

批量 publish 只能消费 preview 中明确选择的 `publishable` 项。服务端必须重新计算 preview 状态，不能信任前端传入的候选状态；`already_published`、`possible_conflict`、不存在或不属于 source branch 的 id 必须进入 rejected 列表。批量 publish 仍然是多条显式 cherry-pick，不是自动 branch merge。

### 项目 / Branch / Group 合并模型

在产品设计上，项目和 group 默认可以看成一个知识空间：

- **项目** 是本地开发单元，强调代码仓库、任务和当前工作上下文。
- **Knowledge branch** 是用户操作的知识分支，强调当前读写哪套知识。
- **Group** 是服务端内部共享、ACL 和 CRDT namespace 单元；对用户和 Admin 界面默认不再作为知识边界语言出现。
- 默认情况下，项目 checkout 到 `main` group，项目名只作为知识来源和本地入口。
- 只有明确需要主题化或隔离时，项目才会切到 `frontend-platform`、`backend-platform`、`project-a-private` 这类 branch。
- 用户在日常使用中通常只感知“当前 checkout 到哪个知识分支”，不需要同时维护两套边界概念。

## 连接地址配置

DevMesh v2 的连接地址采用全局配置，项目只配置当前 active knowledge branch。实现上 active branch 会解析为内部 `group_key`，作为共享边界、ACL 和 CRDT namespace；对外配置和管理 API 使用 `branchKey`。

- 全局连接地址：这台机器默认连接哪个 Hub。
- 项目 active branch：当前项目 checkout 到哪个知识空间。

### 配置层级

建议明确以下优先级：

```text
CLI flags
  > project .dev-mesh/config.toml
  > global ~/.dev-mesh/config.toml
  > built-in defaults
```

### 全局连接地址

全局配置保存设备默认服务器连接信息，适合写在 `~/.dev-mesh/config.toml` 和 `~/.dev-mesh/identity.json`。

建议字段：

```toml
[connection]
default_server_url = "https://devmesh.company.com"
```

作用：

- 作为未指定项目连接时的默认 Hub。
- 作为 `dmx init --global` 之后的设备默认连接。
- 作为 `sync.now`、`doctor` 的默认远端来源。

### 项目 Knowledge Branch 配置

项目配置保存当前 active knowledge branch，适合写在 `<project>/.dev-mesh/config.toml`。

建议字段：

```toml
[knowledge_branch]
active = "frontend-team"
base = "shared"
```

作用：

- 指定当前项目读写哪个 knowledge branch。
- 允许同一台机器上的不同项目 checkout 到不同 branch。
- 默认所有项目 checkout 到 `main`；多个项目 checkout 到同一个非默认 branch 时共享该主题知识。
- `base` 是可选公共知识分支，读取时参与 context，写入仍只写 active branch。
- 当项目没有显式设置 active branch 时，默认使用 `main`。

### 连接解析规则

```text
global server connection
  + project active knowledge branch
  -> resolve target server/group for sync and MCP
```

解析规则建议如下：

| 场景 | 优先使用 |
| --- | --- |
| 当前项目同步 | 全局 server + active branch 对应 group |
| 当前项目查询 | active branch，可选叠加 base branch |
| 未绑定项目时的默认连接 | 全局 server |
| 手动切换服务器 | CLI flag 显式指定 server |
| 手动切换知识分支 | CLI flag 或 `dmx branch switch` 显式指定 branch |

### 行为约束

- 项目配置不保存服务器地址，只保存 active/base knowledge branch。
- 全局连接地址不决定项目知识是否混合，knowledge branch / group 才决定共享边界。
- `dmx join` 写入全局身份记录；项目通过 `dmx branch switch <branch>` 或 Admin 配置切换 branch。
- 离线或 local-only 项目可以不配置任何远端地址。
- 同一台机器可以有多个项目 checkout 到不同 branch，互不污染。
- daemon 同步写路径只对 active branch 对应的 `group_key` 上传本地 CRDT changes；base branch 作为 read-only remote 拉入独立 branch cache/projection，不能把 base 远端 changes apply 到 active 项目 CRDT 后再反推。

### 推荐体验

```text
第一次安装
  -> 用户设置全局连接地址

打开具体项目
  -> 默认 checkout main

多个项目需要共享知识
  -> 继续使用 main，或 Admin / CLI 把这些项目切到同一个主题 branch

某个项目需要隔离
  -> Admin 或 CLI 为它 checkout 专用 branch
```

这样可以同时满足两类需求：

- 开发者只需要配置一次全局服务器连接。
- 项目知识是否混合由 knowledge branch 决定，默认共享 `main`，显式切到主题或专用 branch 后再分流。

### 默认分支模型

在默认产品体验里，项目、knowledge branch 和 group 不再强行同名：

- **项目** 是本地开发单元，强调代码仓库、任务和当前工作上下文。
- **Knowledge branch** 是用户 checkout 的知识空间，强调当前读写哪套知识。
- **Group** 是服务端共享单元，强调知识可以被哪些项目一起读取和写入。

默认情况下：

```text
knowledge_branch.active === "main"
group_key === "main"
project.key 只标注知识来源，不决定默认知识空间
```

也就是说，一个新项目默认进入公共 `main` 知识分支。只有在明确需要按主题沉淀、按团队共享或按项目隔离时，才创建并 checkout 到新的 branch。

这意味着：

- 没有必要再把“项目”“知识分支”和“群组”拆成三套几乎重复的管理模型。
- 项目只是 active branch 的本地入口和配置壳。
- branch 是用户心智边界，group 是底层同步和 ACL 边界。

### 动态评分投影

知识动态评分也遵循同一个原则：CRDT 保存评分信号，projections 计算当前分数。

不要把最终排序分数当成 CRDT 事实源同步。最终分数会受到当前时间、团队策略、搜索场景和算法版本影响，应该在 materializer 中重新计算。CRDT 中只保存稳定、可合并、可追溯的信号。

推荐 CRDT 信号模型：

```ts
interface QualitySignal {
  id: string;
  knowledgeId: string;
  kind:
    | 'confirm'
    | 'dispute'
  | 'use'
  | 'rate'
  | 'demote'
  | 'stale'
  | 'refresh';
  actorId: string;
  value?: number;
  reason?: string;
  createdAt: string;
}
```

推荐 projection 聚合模型：

```ts
interface ProjectedKnowledgeQuality {
  reliability: number;
  usefulness: number;
  freshness: number;
  priority: number;
  score: number;
}
```

字段含义：

| 字段 | 含义 | 主要来源 |
| --- | --- | --- |
| `reliability` | 这条知识是否可靠。 | 来源可信度、证据、人工确认、争议和冲突。 |
| `usefulness` | 这条知识是否有用。 | 被引用、被采纳、人工评分、复用频率。 |
| `freshness` | 这条知识是否仍然新鲜。 | 更新时间、领域时效、`stale` 和 `refresh` 信号。 |
| `priority` | 团队是否希望它更常被引用。 | 人工置顶/降权、类型策略、项目范围适配。 |
| `score` | 最终排序分。 | 上面四个维度的加权结果。 |

旧模型可以迁移为：

```text
confidence + sourceTrust + evidence -> reliability
rating + adoptionScore              -> usefulness
freshness                           -> freshness
weight                              -> priority
qualityScore                        -> score
```

默认聚合公式可以从简单版本开始：

```text
score = reliability * 0.35
      + usefulness  * 0.30
      + freshness   * 0.20
      + priority    * 0.15
```

这个公式只属于 projection 层。后续如果 ranking 算法变化，只需要重建 projections，不需要迁移 CRDT 事实源。

## Daemon 职责

daemon 负责自动同步和 projection materialization：

```text
daemon
  1. 监听本地 CRDT 变化。
  2. 把本地 CRDT changes 推送到已加入的 Hub。
  3. 从 Hub 拉取远端 CRDT changes。
  4. 把远端 changes 应用到本地 CRDT。
  5. 标记 projections dirty。
  6. 增量更新 projections，必要时全量重建。
  7. 写入 status，供 CLI、MCP 和 Admin 诊断。
```

正常用户不应该手动执行同步或重建。下面命令只作为诊断和兜底：

```bash
dmx status
dmx sync now
dmx projections rebuild
dmx doctor
```

## 服务端职责

Hub 保存服务端全局 CRDT 状态，并 materialize 服务端读模型。全局 CRDT 是服务端侧的权威协作状态，覆盖 server、group、project、member、knowledge、entity、relation、claim 和 conflict 等对象。

```text
Hub
  - 认证 member 和 client。
  - 校验 project/group 权限。
  - 应用客户端推来的 CRDT changes 到服务端全局 CRDT。
  - 持久化服务端全局 CRDT documents。
  - materialize Admin/search/graph projections。
  - 记录 audit events。
  - 从 projections 暴露 MCP 和 Admin APIs。
```

v2 sync 启用后，Hub 不应该再把客户端推来的 `KnowledgeItem` 快照当成权威状态。

### 服务端全局 CRDT

服务端需要维护一个逻辑上的全局 CRDT。它可以物理上按 group/project 分片保存，但对产品和查询层表现为一个统一命名空间。

推荐模型：

```ts
interface ServerGlobalDoc {
  schemaVersion: 2;
  server: ServerMeta;
  groups: Record<GroupId, GroupNode>;
  projects: Record<ProjectId, ProjectNode>;
  members: Record<MemberId, MemberNode>;
  clients: Record<ClientId, ClientNode>;
  knowledge: Record<KnowledgeId, KnowledgeNode>;
  entities: Record<EntityId, EntityNode>;
  relations: Record<RelationId, RelationEdge>;
  claims: Record<ClaimId, ClaimNode>;
  conflicts: Record<ConflictId, ConflictNode>;
  qualitySignals: Record<QualitySignalId, QualitySignal>;
  extensions?: Record<string, ExtensionState>;
}
```

作用：

- 作为服务端全局事实源，承载所有已同步的团队知识和图谱关系。
- 支持同一 group 内多个项目的实体归并、重复识别、冲突发现和检索。
- 支持项目知识、group 知识和成员经验在同一个图谱空间里关联。
- 支持服务端 federation 时交换 CRDT changes，而不是交换 cursor event log。

### 全局 CRDT 分片建议

全局 CRDT 不一定要物理存成一个超级大文件。更稳妥的方式是逻辑全局、物理分片：

```text
server-global/
  server meta
  groups/{groupId}
  projects/{projectId}
  members/{memberId}
  knowledge/{knowledgeId}
  entities/{entityId}
  relations/{relationId}
  claims/{claimId}
  conflicts/{conflictId}
  signals/{signalId}
```

分片原则：

- `server`、`groups`、`projects`、`members` 作为管理面分片。
- `knowledge`、`entities`、`relations`、`claims`、`signals` 作为知识面分片。
- `conflicts` 作为审查面分片。
- project/group 级查询优先读局部分片，全局图谱和管理视图读聚合 projection。

当前 Hub 过渡实现已经把 Admin 管理事实追加到一个 `server-global` CRDT document：

```text
document.kind      = server-global
document.namespace = admin-operations
schemaVersion      = 2
```

该文档随现有 `state.crdtDocuments` 持久化 `snapshot`、`heads` 和 `changes`，并在 global projection 中暴露 source heads。每条 operation 至少包含 `id`、`action`、`actor`、`targetType`、`targetId`、`createdAt`、内部 `groupKey` 和 `payload`；Admin summary 对外补充 `branchKey`。它覆盖 branch create/update、project checkout、单条 publish 和 bulk publish 成功项，但仍是过渡日志，不替代后续 `server`、`groups`、`projects`、`knowledge` 等正式分片。

Admin 过渡期还提供只读 CRDT document status：按 `kind`、`branchKey`、`projectKey` 过滤 `state.crdtDocuments`，并兼容旧 `groupKey` query；响应返回 document ref、heads、change count、snapshot 是否存在和 latest change metadata，并在 document/change summary 中提供 `branchKey`。该接口和页面不会返回 Automerge `bytes` 或 `snapshot` 内容，避免把大型二进制 change log 暴露给管理 UI。`server-global` 文档没有 document-level `branchKey` / `groupKey`，因此按 branch/group 过滤时不会被误归入某个 branch；每条 change 里的内部 `groupKey` 只表示该 change 作用的管理对象或同步 namespace。

这样做的好处是：

- 逻辑上仍然是统一全局图谱。
- 物理上可以按访问热度、团队规模和权限边界拆开。
- 后续 federation 只需要交换分片 changes，而不是整个全局 doc。

权限不通过拆散事实源实现，而是在 projection 查询和 API 输出阶段过滤：

```text
server global CRDT
  -> materialize server projections
  -> apply ACL/filter by group/project/member
  -> return Admin/MCP/API result
```

### 全局知识图谱可视化

服务端必须支持全局知识图谱可视化。可视化不直接扫描 CRDT，而是读取 server graph projection。

推荐服务端 projections：

```text
server projections/
  global-knowledge.sqlite
  global-graph.sqlite
  global-search.sqlite
  global-quality.sqlite
  global-conflicts.sqlite
```

全局图谱节点：

```text
knowledge
entity
claim
project
group
member
client
type
tag
source
conflict
```

全局图谱边：

```text
about
mentions
supports
contradicts
supersedes
duplicates
depends_on
implemented_by
owned_by
authored_by
belongs_to_project
belongs_to_group
tagged_with
sourced_from
used_by
reviewed_by
```

Admin 可视化能力：

- 按 server、group、project、member、entity、tag、type 过滤全局图谱。
- 查看某个实体关联的知识、项目、成员、claim 和冲突。
- 查看某个项目的知识结构、依赖关系、活跃成员经验和风险点。
- 查看 `duplicates`、`contradicts`、`supersedes` 等语义关系。
- 查看质量评分热区：高价值知识、过期知识、低可靠知识、高复用知识。
- 查看冲突层：same-field edit、delete/update、duplicate entity、contradictory claim。
- 支持只读分享视图，但必须经过 ACL 裁剪。

全局图谱 projection 仍然是读模型。任何可视化编辑，例如合并实体、确认冲突、提升知识优先级，都必须写回 CRDT：

```text
Admin graph action
  -> CRDT change
  -> daemon/server materializer updates projections
  -> graph visualization refreshes
```

### 术语约束

为了避免后续实现里概念漂移，建议固定以下术语：

| 术语 | 含义 |
| --- | --- |
| CRDT | 唯一同步事实源。 |
| Projection | 从 CRDT 派生出的可重建读模型。 |
| Knowledge Branch | 面向开发者的用户概念，表示当前 checkout 的知识空间。 |
| Group | Knowledge Branch 的底层同步、ACL 和 CRDT namespace 边界。 |
| Entity | 可归并的现实对象或抽象概念。 |
| Relation | 实体、知识、claim 之间的显式语义边。 |
| Claim | 可被证据支持、反驳或取代的结构化断言。 |
| Signal | 动态评分、质量、使用、确认、争议等可聚合信号。 |
| Conflict | CRDT 合并后需要产品层处理的语义冲突。 |
| Graph | 由 entity、knowledge、claim、relation 投影出的全局可视化结构。 |

这组术语建议在代码类型、API、文档和 Admin 界面里保持一致。

## 冲突处理

CRDT merge 可以解决结构层面的并发写入，但产品语义上的冲突仍然需要显式 review。

示例：

| 场景 | 期望行为 |
| --- | --- |
| A 改 `summary`，B 改 `tags` | 自动合并。 |
| A 添加一条关系，B 添加另一条关系 | 自动合并。 |
| A 和 B 同时改 `title` | 保留并发值；projection 标记 `same_field_edit`。 |
| A 删除知识，B 同时更新知识 | 标记 `delete_update_conflict`，进入 review。 |
| 两个实体代表同一个概念 | 标记 `duplicate_entity`，提供 merge 操作。 |
| 两条声明互相矛盾 | 保留两者；添加 `contradicts` 关系或 review item。 |

冲突 review 是产品流程，不是同步失败。

## MCP 和 API 行为

v2 可以重新设计 MCP tools 和 HTTP API。接口按写入、读取、同步、审计四类能力组织，不要求兼容 1.0 名称和返回结构：

```text
knowledge.capture       -> CRDT change
knowledge.update        -> CRDT change
knowledge.delete        -> CRDT tombstone change
graph.link              -> CRDT relation change
entity.resolve          -> CRDT entity/alias change
quality.signal          -> CRDT quality signal
knowledge.search        -> projection query
graph.explore           -> projection query
sync.exchange           -> CRDT sync message exchange
```

API 边界要明确区分写入和读取：

```text
writes -> CRDT document
reads  -> projections
sync   -> CRDT changes/sync messages
audit  -> append-only logs
```

### 端到端流程示例

#### 写入项目知识

```text
Agent calls knowledge.capture
  -> runtime resolves current project and active knowledge branch
  -> redaction pipeline checks content
  -> capture policy checks type volatility and auto_capture_types
  -> CRDT change writes KnowledgeNode
  -> CRDT change writes optional Entity/Relation hints
  -> daemon marks projections dirty
  -> materializer updates knowledge/search/graph projections
  -> daemon schedules sync.exchange when remote connection is available
```

关键约束：

- 默认写入当前 active branch 对应的 group，未显式切换时就是 `main`。
- redaction 必须发生在 CRDT 写入之前。
- `project_fact` 和其他未被 `auto_capture_types` 允许的类型默认进入 review queue；只有人工确认或显式策略开启后才发布到 CRDT。
- Agent 应优先沉淀 `macro_experience`、`design_principle` 和 `pitfall_record` 这类长期知识，避免把短期项目事实当作长期记忆。
- projection 更新失败不能回滚 CRDT 写入；projection 应可重建。
- sync 失败不能影响本地写入；daemon 后续重试。

#### 构建任务上下文

```text
Agent calls context.build
  -> runtime reads current project config
  -> resolves global server connection and active/base knowledge branch, or explicit one-shot branch
  -> queries local projections first
  -> queries active branch projections
  -> optionally queries base branch projections
  -> expands graph paths for high-confidence hits
  -> ranks by quality projection and recency
  -> trims to token budget
  -> returns context pack with sources and graph paths
```

关键约束：

- 项目模式默认只读取当前 active branch。
- 显式传 `branch` 时，只读取指定 knowledge branch，不修改项目 active branch；这适合临时查看其他知识空间，类似 Git 里不 checkout 也能查看另一个 branch 的历史。
- 过渡期本地实现以 `source.metadata.branch` 过滤；缺少该字段的旧知识按 `main` 处理。
- 多个项目 checkout 到同一个 knowledge branch 时共享知识；默认 `main` 就是公共分支。
- 默认 context pack 排除过期或易变 `project_fact`；显式 `includeVolatile` 或按 `types=["project_fact"]` 查询时才返回。
- 返回结果必须带 source project、group、quality 和 relation path，方便 Agent 判断可信度。

#### 多项目共享知识

```text
Admin creates or selects branch/group frontend-platform
  -> project ui-app switches active branch to frontend-platform
  -> project component-lib switches active branch to frontend-platform
  -> daemon syncs both projects to the same group CRDT space
  -> materializer exposes shared group projections
  -> context.build can use knowledge from both projects
```

关键约束：

- 默认 `main` 已经是共享 branch；主题化共享或项目隔离必须通过 Admin 或 CLI 显式 checkout。
- 写入仍然标注来源项目，方便追踪。
- 从 group 移出项目后，后续查询不再读取该 group，历史数据按服务端策略保留或迁移。
- Admin checkout 项目时不会自动复制旧 branch 的 CRDT changes；它只改变项目后续使用哪个 group/CRDT namespace。

### MCP Tools 分层

v2 MCP tools 按少而强的原则设计。默认暴露核心工具，高级治理和管理工具通过 capability、权限和运行模式显式开启，避免工具列表过大影响 Agent 决策质量。

#### Core Tools

默认开启，服务于日常 Agent 工作流：

```text
devmesh.status
branch.list
branch.switch
branch.create
branch.policy
context.build
knowledge.capture
knowledge.update
knowledge.delete
knowledge.get
knowledge.search
task.capture
task.update
graph.explore
graph.link
entity.search
entity.resolve
quality.signal
sync.status
sync.now
```

核心工具职责：

| Tool | 作用 |
| --- | --- |
| `devmesh.status` | 查看本地 store、daemon、sync、projection 和服务器连接状态。 |
| `branch.list` | 列出当前项目可见的 knowledge branches。 |
| `branch.switch` | 切换当前项目的 active knowledge branch，类似 Git checkout。 |
| `branch.create` | 创建新的 knowledge branch，并选择默认沉淀策略。 |
| `branch.policy` | 查看或更新当前 branch 的 capture policy。 |
| `context.build` | 为当前任务构建上下文包，统一处理检索、图谱关系、质量评分和裁剪。 |
| `knowledge.capture` | 写入新知识到 CRDT。 |
| `knowledge.update` | 更新已有知识，写入 CRDT change。 |
| `knowledge.delete` | tombstone 知识，不做物理删除。 |
| `knowledge.get` | 按 id 获取知识 projection。 |
| `knowledge.search` | 基于 projection 搜索知识。 |
| `task.capture` | 捕获任务状态、进展和交接信息。 |
| `task.update` | 更新任务状态。 |
| `graph.explore` | 探索知识、实体、claim、项目、成员之间的局部关系。 |
| `graph.link` | 创建知识、实体或 claim 之间的关系。 |
| `entity.search` | 搜索实体。 |
| `entity.resolve` | 把术语、文件、API、服务、包名等解析为统一实体。 |
| `quality.signal` | 写入评分信号，例如 `use`、`confirm`、`dispute`、`stale`。 |
| `sync.status` | 查看同步状态。 |
| `sync.now` | 手动触发一次同步，主要用于诊断。 |

Branch tools 是面向开发者的主入口。实现上它们更新项目 active branch 和对应 group 绑定，但用户无需直接操作 `group_key`。早期只支持单 active branch 写入；读取可以叠加一个 base branch，也可以通过工具参数临时读取某个 branch。`branch.switch` 改变默认读写空间；`context.build(branch=...)`、`knowledge.search/list(branch=...)`、`graph.explore(branch=...)` 只影响单次查询。

#### Power Tools

面向项目维护、知识治理和复杂调试，默认可不暴露给普通 Agent：

```text
project.brief
project.scan
graph.path
claim.create
claim.verify
conflict.list
conflict.resolve
memory.summarize
projection.status
projection.rebuild
```

重点工具：

| Tool | 作用 |
| --- | --- |
| `project.brief` | 生成项目级简报，聚合项目结构、关键实体、近期任务、风险和高价值知识。 |
| `project.scan` | 触发项目扫描 provider，把扫描结果写入 Knowledge/Entity/Relation。 |
| `graph.path` | 解释两个节点之间的关系路径，例如当前任务为什么关联某条历史决策。 |
| `claim.create` | 创建结构化 claim。 |
| `claim.verify` | 根据证据、冲突和质量信号验证 claim。 |
| `conflict.list` | 列出 CRDT merge 后产生的产品语义冲突。 |
| `conflict.resolve` | 写入冲突处理结果，例如确认一方、保留两者、创建 supersedes/contradicts。 |
| `memory.summarize` | 将一组知识、任务或图谱路径总结为更高层知识。 |
| `projection.status` | 查看 projections schema、source heads、健康状态和延迟。 |
| `projection.rebuild` | 手动重建 projections，主要用于诊断和修复。 |

`graph.path` 是 v2 的关键解释性工具。它返回知识相关性的路径，而不是只返回文本命中：

```text
current task
  -> package entity
  -> API entity
  -> historical pitfall
  -> canonical decision
```

这能让 Agent 解释“为什么这条知识与当前任务相关”。

#### Admin Tools

仅在管理员、服务端管理后台或受控维护会话中开启：

```text
admin.graph_overview
admin.member_activity
admin.quality_review
admin.conflict_queue
admin.entity_merge
admin.policy_update
```

Admin tools 读取 server projections，写操作必须回写 CRDT，并经过 ACL、审计和策略校验。

## 横向扩展能力

v2 设计必须保证后续可以横向扩展，而不是把 CRDT、图谱、评分和 projections 写死成单一实现。核心原则是：事实源 schema 要稳定，能力通过 extension registry 和 backend adapter 扩展。

### 扩展边界

| 扩展点 | 用途 | 示例 |
| --- | --- | --- |
| `CrdtBackend` | 替换或适配 CRDT 引擎。 | Automerge、后续 Yjs rich-text document。 |
| `ProjectionBackend` | 替换 projection 存储和索引实现。 | SQLite、PostgreSQL、pgvector、Kuzu、DuckDB。 |
| `Materializer` | 从 CRDT 生成不同读模型。 | knowledge list、graph traversal、search index、Admin overview。 |
| `EntityResolver` | 识别、归并和消歧实体。 | package/file/API/person/concept 识别。 |
| `RelationExtractor` | 从知识内容或项目扫描中提取关系。 | `uses`、`depends_on`、`implemented_by`。 |
| `QualityScorer` | 聚合动态评分信号。 | 团队评分、引用采纳、领域时效、人工策略。 |
| `ConflictPolicy` | 定义产品语义冲突处理方式。 | same-field edit、delete/update、duplicate entity。 |
| `SyncTransport` | 扩展同步传输层。 | Hub HTTP、WebSocket、server federation、object storage。 |
| `KnowledgeTypePlugin` | 扩展知识类型和字段校验。 | ADR、incident、runbook、style-guide。 |

### 扩展注册

扩展通过 registry 注册能力，不直接修改 core 写入流程：

```ts
interface DevMeshExtension {
  id: string;
  version: string;
  capabilities: string[];
  register(registry: ExtensionRegistry): void | Promise<void>;
}
```

示例能力命名：

```text
crdt.backend.automerge
projection.backend.sqlite
projection.materializer.knowledge
projection.materializer.graph
entity.resolver.typescript
relation.extractor.package-dependency
quality.scorer.default
conflict.policy.default
sync.transport.hub-http
knowledge.type.adr
```

### Schema 扩展策略

CRDT 顶层 schema 需要稳定，但允许 extension metadata：

```ts
interface ProjectDoc {
  schemaVersion: 2;
  project: ProjectMeta;
  knowledge: Record<KnowledgeId, KnowledgeNode>;
  entities: Record<EntityId, EntityNode>;
  relations: Record<RelationId, RelationEdge>;
  claims: Record<ClaimId, ClaimNode>;
  extensions?: Record<string, ExtensionState>;
}
```

扩展字段规则：

- 核心字段只表达跨团队稳定语义。
- 扩展私有状态放到 `extensions[extensionId]`。
- `EntityNode.kind`、`RelationEdge.kind` 和 knowledge `type` 支持 extension-defined 值。
- 扩展值必须带 namespace，避免不同插件抢同一个语义名称。
- materializer 遇到未知 extension 字段必须保留，不得丢弃。
- MCP/API 默认只暴露稳定字段；扩展字段通过显式 capability 暴露。

### Projection 扩展策略

projection 是读模型，不是事实源，所以可以按场景横向增加：

```text
projections/
  knowledge.sqlite
  graph.sqlite
  search.sqlite
  vector.sqlite
  entity.sqlite
  custom/
    company-policy.sqlite
```

每个 projection backend 都必须提供：

- `schemaVersion`
- `sourceHeads`
- `rebuild()`
- `applyIncrementalChange()`
- `healthCheck()`
- `dropAndRebuild()` 诊断入口

这样可以保证 projection 损坏、升级或算法变更时，daemon 能从 CRDT 重新生成。

### 稳定性约束

- 写入路径只依赖核心 CRDT schema 和扩展 registry，不依赖某个具体 projection。
- 搜索、图谱、Admin 只能读取 projection，不能反向修改 projection 当作事实源。
- 扩展可以新增实体类型、关系类型、评分策略和 projection，但不能绕过权限、脱敏、审计和 CRDT 写入。
- 所有扩展都必须声明版本，schema 变更必须提供 migration 或 rebuild 策略。
- 默认实现必须可替换，但产品开箱体验要有内置实现：Automerge + SQLite projections + default materializers。

## 1.0 能力吸收

v2 是一次完整重写，不需要保持 1.0 的存储、接口或同步兼容。1.0 只作为产品能力清单和历史数据导入来源；v2 可以重新设计 CLI、MCP tools、HTTP API、daemon 任务、Admin API 和本地目录结构。

### 吸收的产品能力

| 1.0 能力 | v2 设计方式 |
| --- | --- |
| MCP tools：capture/search/update/delete/task/rate/link/graph/status | 重新命名和分组；写操作统一写 CRDT，读操作统一查 projection。 |
| local-only 项目知识库 | 作为 v2 基础模式；本地 `.dev-mesh/crdt/project.automerge` 不依赖 Hub 即可工作。 |
| 加入 Hub | 重新设计 join 和 identity 流程；加入后 daemon 自动交换 CRDT sync messages。 |
| daemon 自动同步 | 升级为自动同步 CRDT、自动 materialize projections、自动写 status。 |
| raw / extract / canonical 分层 | 作为 `KnowledgeNode.layer`，不再拆成多个 JSONL 事实源文件。 |
| PARA 组织 | 作为 `KnowledgeNode.para`，并投影到 graph/search 读模型。 |
| glossary / resolve term | 作为 knowledge type 和 `EntityNode(kind='concept')` 共同表达。 |
| task capture / task digest | 作为 knowledge type、task projection 或独立 task view。 |
| quality review / review queue | review 结果写成 CRDT signal，review 列表由 projection 生成。 |
| supersedes / duplicates / contradicts edges | 升级为 `RelationEdge` 一等关系。 |
| member experience search | 作者、成员、client identity 投影为 member/entity 索引。 |
| project scan providers | 扫描结果通过 Knowledge/Entity/Relation 写入 CRDT。 |
| redaction pipeline | 前置到 CRDT 写入前；任何 sync transport 都不能绕过脱敏策略。 |
| audit log | 用于审计和解释，不作为知识状态正确性的来源。 |
| Admin overview / knowledge / graph / review pages | 重新设计为 projection-driven Admin。 |
| server federation foundation | 重写为 CRDT document federation，不沿用 event-log federation。 |

### 1.0 存储到 v2 模型映射

| 1.0 存储/模型 | v2 模型 |
| --- | --- |
| `.dev-mesh/knowledge/*/entries.jsonl` | `ProjectDoc.knowledge` |
| `.dev-mesh/knowledge/edges.jsonl` | `ProjectDoc.relations` |
| `.dev-mesh/knowledge/ratings/*.jsonl` | `QualitySignal(kind='rate' | 'confirm' | 'dispute')` |
| `.dev-mesh/knowledge/usage/*.jsonl` | `QualitySignal(kind='use')` |
| `.dev-mesh/events/*.jsonl` | 一次性导入为 audit/quality/task signals，导入后不再沿用 |
| `.dev-mesh/sync/cursors.json` | `crdt/sync/peers.json` 和 `crdt/sync/heads.json` |
| `.dev-mesh/index/*` | `projections/*` |
| Hub sync event log | 一次性导入或归档；v2 correctness 依赖 CRDT convergence |
| Hub admin repository | server projections |

### 重写策略

- v2 直接定义新 schema、新 CLI、新 MCP tools、新 HTTP API 和新 sync protocol。
- 1.0 数据只通过 migration/import 进入 v2 CRDT，不保留运行期双写或旧协议同步。
- 旧 cursor sync 不进入 v2 运行路径；cursor 概念只保留给 audit paging 或 transport diagnostics。
- Admin 和 MCP 返回结构按 v2 知识图谱、实体、关系、claim、conflict 模型重新设计。
- JSONL export 仅作为按需导出功能，方便备份、调试和人工审阅。
- 1.0 的测试场景可以改写为 v2 产品能力回归测试，但不要求接口兼容。

## 重写实施计划

### Phase 1: 引入 CRDT Store

- 新增 `@devmesh/crdt-store`。
- 定义 `ProjectDoc` schema。
- 实现 `crdt/project.automerge` 的 load/save。
- 实现 1.0 JSONL 到 CRDT 的一次性 import。
- 重写 repository，使其直接读写 CRDT 和 projections。

### Phase 2: 写入路径切到 CRDT

- 将 `capture/update/delete/rate/link` 改成写 CRDT。
- 写入后生成 projections。
- 提供按需 JSONL export，方便备份和调试。

### Phase 3: CRDT Sync

- 新增 client-to-Hub CRDT sync protocol。
- Hub 保存 group/project CRDT documents。
- Hub sync 后 materialize 服务端 projections。
- 不保留 cursor-only knowledge sync。

### Phase 4: 图谱模型升级

- 把 entities、relations、claims 提升为 CRDT 一等字段。
- 增加 entity resolution 和 entity merge 流程。
- 扩展 Admin conflict/review UI。

### Phase 5: 移除 1.0 同步模型

- cursor 仅保留给 audit paging 和 transport diagnostics。
- 知识状态正确性来自 CRDT convergence 和 projection checkpoints。
- 移除服务端 knowledge snapshot replay。

## 测试策略

必须覆盖：

- CRDT load/save round trip。
- 并发修改不同字段可以自动合并。
- 并发修改同一字段能保留 conflict 信息。
- delete/update conflict 会投影到 review queue。
- 重复 CRDT changes 幂等。
- 乱序 sync messages 最终收敛。
- 删除 projection 文件后，从 CRDT rebuild 能得到相同读模型。
- Hub apply 客户端 CRDT changes 后，Admin 能看到 materialized knowledge。
- 1.0 JSONL import 能保留 knowledge items、edges、ratings、usage 和 tombstones。

## 待确认问题

- 一个 project 使用一个 Automerge document，还是每条知识一个 document 并由 Automerge Repo 管理？
- Hub 第一版生产 projection backend 用 PostgreSQL，还是 PostgreSQL + pgvector？
- MCP tools 默认暴露多少 conflict 细节？
- JSONL exports 是持续生成，还是按需导出？
- 哪些 entity kinds 应该成为 v2 稳定字段，哪些继续由 extension 定义？
