# DevMesh CRDT 技术全解

## 1. CRDT 基础理论

### 1.1 什么是 CRDT

**CRDT**（Conflict-free Replicated Data Type，无冲突复制数据类型）是一种分布式数据结构，允许多个副本独立更新，在无需协调的情况下自动合并，最终达到强一致状态。

核心特性：

- **本地优先（Local-first）**：每个节点可离线工作，即时写入，无需等待网络
- **自动合并（Automatic Merge）**：来自不同副本的并发写入自动合并，不会产生冲突分支
- **最终一致（Eventual Consistency）**：所有副本在交换变更后收敛到相同状态

### 1.2 为什么需要 CRDT

| 场景 | 传统方案痛点 | CRDT 方案 |
|---|---|---|
| 多人协作文档 | OT 算法需要中心服务器做仲裁 | 纯去中心化，离线写入即时生效 |
| 知识库同步 | Git merge 需要人工解决冲突 | 自动合并无冲突，知识共享即写即见 |
| 离线 App | 需要自己实现冲突解决 | Automerge 内置 CRDT 合并策略 |

### 1.3 关键概念

| 术语 | 说明 |
|---|---|
| **Actor** | 执行变更的节点标识，通常是 UUID |
| **Change** | 一次原子变更，包含操作集合和依赖信息 |
| **Heads** | 文档当前分支头部的哈希集合，类似 Git 的 HEAD |
| **DAG** | 变更之间的因果依赖有向无环图 |
| **Lamport Clock** | 每个 Actor 维护的顺序号（seq） |

---

## 2. Automerge 引擎

### 2.1 简介

[Automerge](https://automerge.org/) 是 DevMesh 使用的 JSON-like CRDT 库，Rust 编写核心 + JS 绑定。

**核心设计**：
- 整个文档是一棵 JSON 树，每个字段可独立并发修改
- 并发写入同一字段：**LWW（Last-Writer-Wins）**，按 Lamport 时钟排序
- 并发插入列表：**RGA（Replicated Growable Array）** 算法保证插入位置一致
- 变更以压缩的二进制格式存储，便于网络传输

### 2.2 关键 API

```typescript
// 初始化
const doc = Automerge.init<MyDoc>(actorId);

// 本地变更
const next = Automerge.change(doc, { message: "add" }, (draft) => {
  draft.items.push({ id: "a" });
});

// 获取二进制变更（用于同步）
const changes = Automerge.getAllChanges(doc);
const delta = Automerge.getChangesSince(doc, knownHeads);

// 远程应用变更
const [merged] = Automerge.applyChanges(Automerge.init(), changes);

// 保存与加载
const binary = Automerge.save(doc);
const loaded = Automerge.load<MyDoc>(binary, actorId);
```

---

## 3. DevMesh CRDT 架构总览

### 3.1 包结构

```
packages/
  crdt-store/        # CRDT 核心层（Automerge 封装）
  local-store/       # 投影层（搜索索引 / 图索引 / 文件读写）
  core/              # 知识项领域类型
  graph/             # 知识图谱算法
  client/            # 守护进程 / 同步编排
  server/            # Hub 服务器 / CRDT 交换
  storage/           # PostgreSQL 持久化
```

### 3.2 数据流全景

```
Codex Agent -> Client (Daemon) -> CRDT Store (Automerge)
                     |                    |
                Sync Exchange        Rebuild Projection
                     |                    |
                Hub Server (Koa)     Projection (Index)
                     |                    |
                PostgreSQL            Search / Graph API
```

### 3.3 两层设计：CRDT + 投影

| 层 | 职责 | 技术 |
|---|---|---|
| **CRDT 层** (crdt-store) | Automerge 文档的创建、变更、保存、合并 | @automerge/automerge |
| **投影层** (local-store) | 从 CRDT 文档重建搜索索引、图索引、JSONL 导出 | FlexSearch + 自建图索引 |

**投影的动机**：Automerge 文档是 CRDT 优化的存储格式，不适合直接做全量搜索或图遍历。投影层将 CRDT 数据的"物化视图"建为高性能索引。

---

## 4. 数据模型

### 4.1 两种 CRDT 文档

#### ProjectDoc -- 项目级文档

每个项目一个 `.automerge` 文件。

```typescript
interface ProjectDoc {
  schemaVersion: 2;
  project: ProjectMeta;
  branch: string;
  knowledge: Record<string, KnowledgeNode>;       // 知识项
  entities: Record<string, EntityNode>;           // 领域实体
  relations: Record<string, RelationEdge>;        // 实体关系
  qualitySignals: Record<string, QualitySignal>;  // 质量信号
  conflicts: Record<string, ConflictNode>;        // 冲突追踪
}
```

#### ServerGlobalDoc -- 服务器级文档

管理成员、客户端、项目注册等全局状态。

```typescript
interface ServerGlobalDoc {
  schemaVersion: 2;
  server: ServerMeta;
  groups: Record<string, BranchNode>;       // 知识分支
  projects: Record<string, ProjectNode>;    // 注册的项目
  members: Record<string, MemberNode>;      // 成员
  clients: Record<string, ClientNode>;      // 连接的客户端
  knowledge: Record<string, KnowledgeNode>; // 共享知识
  // ...
}
```

### 4.2 KnowledgeNode（知识节点）

```typescript
interface KnowledgeNode {
  id: string;               // 唯一的确定性 ID
  branch: string;           // 所属分支
  layer: KnowledgeLayer;    // raw | extract | canonical
  entryKey: string;         // 稳定的查找键
  type: KnowledgeType;      // fact | concept | command | pattern | pit
  title: string;
  summary: string;
  content?: string;
  tags: string[];
  para: ParaRef;            // PARA 分类
  status: KnowledgeStatus;  // active | superseded | tombstone
  source: KnowledgeSource;  // 来源信息（含 commit/storageRef）
  createdBy: MemberIdentity;
  visibility: KnowledgeVisibility; // private | project | team | org
  quality: QualitySignals;  // 聚合质量分数
}
```

### 4.3 QualitySignal（质量信号）

```typescript
type QualitySignalKind = "confirm" | "dispute" | "use" | "rate" | "demote" | "stale" | "refresh";

interface QualitySignal {
  id: string;
  knowledgeId: string;      // 关联的知识项
  kind: QualitySignalKind;
  actorId: string;          // 发出信号的成员
  value?: number;           // 数值（评级 1-5 等）
  reason?: string;          // 文字理由
  createdAt: string;
}
```

### 4.4 RelationEdge（关系边）

```typescript
interface RelationEdge {
  id: string;
  from: string;             // 源实体 ID
  to: string;               // 目标实体 ID
  kind: RelationKind;       // mentions | depends_on | supersedes | ...
  evidenceKnowledgeIds: string[];  // 支撑此关系的知识项
  confidence: number;       // 置信度 0-1
  createdBy: MemberIdentity;
}
```

### 4.5 BranchScope（分支范围）

每个知识项、关系、质量信号都属于一个 BranchScope：

```typescript
interface BranchScope {
  branch: string;           // 分支标识
  branchId?: string;
  sourceProjectId?: string; // 共享时的源项目
}
```

---

## 5. 变更操作

### 5.1 CrdtBackend 接口

所有 CRDT 后端都实现这个抽象接口：

```typescript
interface CrdtBackend<TDoc> {
  load(): Promise<TDoc>;
  save(doc: TDoc): Promise<void>;
  getHeads(): Promise<string[]>;
  change(input: CrdtChangeInput<TDoc>): Promise<CrdtChangeResult<TDoc>>;
  apply(change: CrdtChange<TDoc>): Promise<CrdtChangeResult<TDoc>>;
}
```

### 5.2 AutomergeFileCrdtBackend

DevMesh 的核心后端实现。关键操作流程：

**创建变更** (`change`)：
1. 加载当前 Automerge 文档
2. 记录 `headsBefore`
3. 调用 `Automerge.change()` 创建不可变变更
4. 提取 `binaryChanges`（二进制增量）
5. 持久化新文档到磁盘

**应用远程变更** (`apply`)：
1. 如果 `change.binaryChanges` 存在（Automerge 变更）：通过 `applyAutomergeChanges` 合并
2. 如果是内存变更（测试用）：直接替换文档

**Automerge 变更合并** (`applyAutomergeChanges`)：
1. 加载文档（对于 incoming changes，空文档用 `Automerge.init` 初始化）
2. 按依赖拓扑排序变更（`orderAutomergeChangesByDependencies`）
3. 调用 `Automerge.applyChanges()` 自动合并
4. 持久化

### 5.3 确定性创世文档

为确保所有副本初始状态一致，使用固定参数：

```typescript
const AUTOMERGE_GENESIS_ACTOR_ID = "00000000000000000000000000000000";
const AUTOMERGE_GENESIS_MESSAGE = "DevMesh deterministic genesis";

function createSeededAutomergeDoc<TDoc>(doc, actorId) {
  const seeded = Automerge.change(
    Automerge.init<TDoc>(AUTOMERGE_GENESIS_ACTOR_ID),
    { message: AUTOMERGE_GENESIS_MESSAGE, time: 0 },
    (draft) => { replaceDocumentContents(draft, doc); }
  );
  return Automerge.load<TDoc>(Automerge.save(seeded), actorId);
}
```

### 5.4 变更拓扑排序

`orderAutomergeChangesByDependencies` 按依赖关系拓扑排序传入的变更：

```
变更依赖图（DAG）：
  A -> B -> D
  A -> C ----^

拓扑排序结果：A -> B -> C -> D
```

---

## 6. 同步协议

### 6.1 客户端-Hub 同步

基于 **Heads 跟踪**，只交换增量变更：

```
Client                                Hub
  |                                    |
  +-- getHeads() -------------------->|-- loadHeads()
  |   (当前本地 heads)                   |   (Hub 当前 heads)
  |<----------- getChangesSince() -----|
  |   (Hub 比 Client 多的变更)            |
  |                                    |
  +-- applyChanges(hubChanges) ---     |
  |   (应用 Hub 的新变更)                |
  |                                    |
  +-- getChangesSince(hubHeads) ------>|
  |   (Client 比 Hub 多的变更)            |
  |                                    +-- applyChanges(clientChanges)
  |<----------- OK --------------------|
  |                                    |
  +-- Rebuild Projection ---          |
```

### 6.2 核心同步函数

```typescript
// 读取本地 CRDT 同步状态
readProjectCrdtSyncState(projectRoot, options)
  -> { path, initialized, heads, changeCount }

// 读取对方比我多的增量变更
readProjectCrdtChangesSince(projectRoot, knownHeads, options)
  -> { changes: Uint8Array[], heads, sinceHeads }

// 应用远程变更到本地
applyProjectCrdtChanges(projectRoot, changes, options)
  -> { doc, heads, headsBefore, headsAfter, applied }
```

### 6.3 Hub 端 CRDT 交换

Hub 服务器通过 HTTP 端点交换 CRDT 变更：

```typescript
// packages/server/src/hub-crdt-sync.ts
exchangeHubCrdtChanges(input: {
  core, clientHeads, clientChanges
}) -> { serverHeads, serverChanges }
```

### 6.4 联邦同步

多个 Hub 服务器之间通过 `federateHubSyncEvents` P2P 同步。

### 6.5 投影脱头重建

当 Heads 无法合并时（如文档被强制重置），退回到全量重建：

```
rebuildProjectionFromDetachedHeads(projectRoot)
  -> 删除旧索引 -> 从 CRDT 文档全量重建搜索索引和图索引
```

---

## 7. 投影系统

### 7.1 为什么需要投影

Automerge 文档是 CRDT 优化的存储格式，直接遍历所有操作来搜索极慢。

| 需求 | CRDT 文档 | 投影层 |
|---|---|---|
| 全文搜索 | 需反序列化所有操作 | FlexSearch 索引，毫秒级 |
| 图遍历 | 无图结构 | 自建邻接表 + BFS/DFS |
| 状态查询 | 需还原完整文档 | 直接读索引元数据 |

### 7.2 投影状态机

```
missing_crdt -> dirty -> building -> ready
                  ^                      |
                  +---(CRDT heads 变化)---+
```

| 状态 | 含义 |
|---|---|
| `missing_crdt` | CRDT 文档尚未初始化 |
| `dirty` | CRDT 有新变更，投影需要重建 |
| `building` | 正在重建投影索引 |
| `ready` | 投影与 CRDT 同步 |

### 7.3 搜索索引

使用 **FlexSearch** 对知识项建立全文索引：
- 索引字段：`title`, `summary`, `content`, `tags`
- 过滤器：`layer`, `type`, `status`, `branch`, `tags`, `para`

### 7.4 图索引

自建图索引支持知识图谱探索：
- **节点**：KnowledgeNode + EntityNode
- **语义边**：`supersedes`, `duplicates`, `contradicts`, `supports`
- **操作**：BFS 广度优先、路径查找、关系图生成

---

## 8. 分支模型

### 8.1 分支概念

知识分支（Branch，原 Group）管理知识的协作边界：
- `main` -- 主分支，项目的权威知识
- `design` -- 设计分支，UI/UX 相关讨论
- `backend` -- 后端分支，架构决策和 API 设计

### 8.2 分支配置

```typescript
interface ProjectConfig {
  knowledgeBranch: {
    active: string;          // 当前活动分支
    base?: string;           // 基础分支（merge 来源）
    branches: Record<string, KnowledgeBranchDefinition>;
  };
}
```

### 8.3 分支策略预设

| 策略 | 用途 |
|---|---|
| `balanced` | 通用知识管理 |
| `durable_only` | 仅捕获持久化知识 |
| `frontend_design` | 前端设计决策 |
| `backend_design` | 后端架构决策 |

### 8.4 分支 CRDT 存储

每个分支独立存储为一个 Automerge 文档：

```
.dev-mesh/crdt/
  project.automerge               # 主分支
  branches/
    design.automerge              # design 分支
    backend.automerge             # backend 分支
```

### 8.5 分支合并投影

重建投影时，主分支和基础分支的知识被合并，按 `updatedAt` 降序保留最新同名项。

---

## 9. 文件存储结构

### 9.1 `.dev-mesh` 目录布局

```
.dev-mesh/
  config.json                      # 项目配置
  crdt/
    project.automerge              # Automerge 主文档（二进制）
    branches/
      design.automerge             # 分支文档
  index/
    search/                        # FlexSearch 索引
    graph/                         # 图索引
    metadata.json                  # 投影元数据
  knowledge/
    canonical/                     # canonical 层 JSONL 文件
    extract/                       # extract 层 JSONL 文件
    raw/                           # raw 层 JSONL 文件
  exports/
    knowledge.jsonl                # CRDT 知识导出
  events/                          # 事件日志
  queue/                           # 同步队列
  secrets/                         # 密钥
```

### 9.2 Automerge 文件格式

`project.automerge` 是 Automerge `save()` 输出的压缩二进制格式：
- **文档头**：magic bytes + 格式版本
- **变更日志**：所有历史 Change 的压缩表示
- **Actor ID**：创建文档的 actor
- **Heads**：当前最新状态的哈希集合

### 9.3 投影元数据

```json
{
  "schemaVersion": 3,
  "crdtPath": ".dev-mesh/crdt/project.automerge",
  "sourceHeads": ["abc123def456..."],
  "rebuilt": true,
  "rebuiltAt": "2026-06-25T12:00:00.000Z",
  "documentCount": 142,
  "state": "ready"
}
```

---

## 10. 实战最佳实践

### 10.1 增量同步 vs 全量同步

- **推荐增量同步**：使用 `getHeads()` + `getChangesSince()` 只传输变更
- **回退全量同步**：当 heads 断开（detached）时，用 `getAllChanges()` 全量拉取

### 10.2 Actor ID 管理

- 每个客户端/Agent 使用唯一 UUID 作为 Actor ID
- 同一用户在不同设备上用不同 Actor ID
- Actor ID 不支持更换，更换相当于新节点

### 10.3 性能建议

1. **控制文档大小**：单文档 < 100MB，大项目建议分分支
2. **定期清理墓碑**：`tombstone` 的知识项不会被物理删除（CRDT 特性）
3. **投影重建频率**：变更后立即触发投影重建
4. **二进制变更缓存**：`getChangesSince()` 的结果可缓存

### 10.4 调试命令

```bash
dmx crdt status              # 检查 CRDT 文档状态
dmx crdt export              # 导出 CRDT 知识到 JSONL
dmx crdt projection-status   # 检查投影健康状态
dmx crdt rebuild             # 手动重建投影
dmx crdt heads               # 查看 Automerge heads
dmx crdt import --overwrite  # 从 JSONL 重新导入
```

### 10.5 常见问题 FAQ

**Q：CRDT 与 Git 的区别？**  
Git 是基于状态的版本控制（snapshot-based），需要手动 merge 冲突。CRDT 是自动合并的，不会有 merge conflict 概念。

**Q：为什么不全用 CRDT，还要 JSONL？**  
JSONL 是人类可读的纯文本，便于手动编辑、Git diff、备份恢复。CRDT 是二进制格式，不可直接阅读，但支持自动合并。两者互补。

**Q：可以删除 CRDT 文档重建吗？**  
可以。删除 `project.automerge` 后，下次操作会从 JSONL 重新导入。但会丢失高质量的变更历史和头哈希同步。

**Q：多个分支的 CRDT 文档会冲突吗？**  
不会。每个分支有独立的 `.automerge` 文件，各自维护独立的变更历史。投影重建时才合并视图。

---

*文档基于 DevMesh v0.1.9 源码编写，最后更新于 2026-06-25*
