# TODO 清单

本清单基于 [technical-design.md](./technical-design.md) 的路线图维护，用于跟踪从当前骨架到可用产品的后续工作。

## 当前优先级

- [x] 完成 MCP `/mcp` 的真实工具调用集成，覆盖 `tools/list` 和 `tools/call`。
- [x] 为 local-store 增加 schema version 校验、migration 和索引重建入口。
- [x] 补齐 redaction pipeline，确保 secret、credential、`.env`、`*.pem`、`*.key` 默认阻断或脱敏。
- [x] 实现 review queue：高风险候选进入 `.dev-mesh/queue/pending.jsonl`，支持接受和拒绝。
- [x] 引入 SQLite 本地索引，支持可重建关键词检索。
- [x] 引入可重建知识图谱索引，支持 MCP 关系探索。
- [x] 增加安全测试和端到端 smoke 测试用例。

## 阶段 0：产品骨架

- [x] TypeScript monorepo。
- [x] `apps/dmx` 和 `apps/mesh-server` 薄启动入口。
- [x] `packages/core`、`agent`、`client`、`server`、`extension-api`、`registry` 基础包。
- [x] MCP contracts skeleton。
- [x] `.dev-mesh/` bootstrap 模板。
- [x] 分层测试脚本：unit、integration、contract、security、e2e。
- [x] README 和 ADR 模板。
- [x] 增加开发指南，明确代码组织、依赖方向、抽象边界和注释规范。
- [x] 为 public API 增加更完整的 typed examples。
- [x] 增加依赖方向检查，防止核心包反向依赖 app/client/server 实现。

## 阶段 1：核心 Server 能力

- [x] 实现 Streamable HTTP MCP `/mcp` 的会话和工具调用回归测试。
- [x] 完成 `mesh_search_context` 的 Context Pack 输出格式。
- [x] 完成 `mesh_capture_knowledge` 的本地/服务端写入路径。
- [x] 完成知识条目 `get/list/update/delete` MCP tools。
- [x] 完成 `mesh_capture_task` 的任务进度沉淀。
- [x] 完成 `mesh_rate_knowledge` 的显式反馈落库。
- [x] 实现 invite join API 的 token 校验。
- [x] 实现 groups API 和 group-scoped ACL。
- [x] 增加 SQLite local-store repository integration test。
- [x] 增加 PostgreSQL repository integration test（通过 `DEV_MESH_POSTGRES_URL` 连接真实测试库）。
- [x] 增加 HTTP join/groups/projects integration test。
- [x] 将 Server HTTP 层切换为 Koa2，MCP `/mcp` 保持使用官方 MCP TypeScript SDK Streamable HTTP transport。
- [x] 移除旧 Fastify 兼容实现和依赖。
- [x] 增加 Koa Server integration test，覆盖 `/healthz`、`/.well-known/devmesh`、groups、join、projects、admin API 和 `/mcp` Streamable HTTP。

## 阶段 2：Mesh Client

- [x] 完成 `dmx init --global` 的工具选择器首版：支持 `--tool`、`--tools`、`--yes` / CI 默认和非 CI 终端输入，并写入全局 config / identity。
- [x] 增强 `dmx init --global` 为完整 TUI：展示 detected/configured 状态、scope 切换和键盘 toggle。
- [x] 完成 `dmx join <server> --group <groupKey> --name <displayName>`：支持 well-known discovery、invite join、全局 `[[servers]]` / `[[groups]]` 写入和 join 后 `auto_sync` 开启。
- [x] 增加 `dmx join` client 单元测试和 CLI 集成测试，覆盖 token 不写入 TOML、identity 记录、真实 Hub Server join flow。
- [x] 实现本地 MCP Proxy：`http://127.0.0.1:8722/mcp`。
- [x] 增加 `dmx knowledge get/list/update/delete` 本地知识条目维护命令。
- [x] Codex 打开项目时自动 `ensureProjectStore`。
- [x] 实现 `dmx doctor` 的 adapter、store、sync、privacy 检查。
- [x] Codex Adapter：detect、configure、remove、doctor。
- [x] Claude Code Adapter：detect、configure、remove、doctor。
- [x] opencode Adapter：detect、configure、remove、doctor。
- [x] adapter configure/remove/doctor 使用临时 HOME 的集成测试。

## 阶段 3：自动沉淀

- [x] Git provider：采集 diff、commit、branch、测试结果摘要。
- [x] 文件事件 provider：按 `.meshignore` 和隐私策略过滤。
- [x] Redactor：secret scan、PII scan、URL token、Authorization、cookie 脱敏。
- [x] Quality scorer：confidence、rating、adoption、freshness、source trust。
- [x] assistant-led capture：由 MCP 工具强提示模型总结当前上下文后主动写入知识。
- [x] member-specific experience search。
- [x] hybrid search with embeddings。
- [x] assistant-led capture integration test。
- [x] redaction pipeline security test。

## 阶段 4：团队化

- [x] 新增 `apps/web-admin` 管理后台，使用 Vue 3 + Element Plus 等成熟 UI 组件库。
- [x] Web dashboard：查看 server health、groups、members、projects、knowledge items、sync 状态和 review queue。
- [x] 管理后台支持 group / project 的查看、筛选和创建，支持 member 查看。
- [x] 管理后台支持 member 禁用和 invite 管理。
- [x] 更完整 project ACL 操作。
- [x] project ACL 管理。
- [x] audit log 写入和查询。
- [x] glossary 管理。
- [x] supersede / duplicate / contradict edge。
- [x] quality review dashboard。
- [x] task digest。
- [x] 管理后台 API integration test、前端 API 单元测试和页面结构 smoke test。
- [x] glossary management integration test。
- [x] conflict edge 检索和默认 active 项测试。

## 阶段 5：分布式 Mesh

- [x] group-scoped sync event log 和 cursor 增量拉取基础。
- [x] signed sync event HMAC 校验和拒绝审计基础。
- [x] 库级 server-to-server federation 增量复制和 cursor 基础。
- [x] tombstone sync 事件校验和审计基础。
- [x] signed event log 链式摘要 metadata 基础。
- [x] server-to-server federation。
- [x] signed event log。
- [x] tombstone sync。
- [x] offline-first conflict replay。
- [x] org-level knowledge sharing。
- [x] federation sync integration test。
- [x] signed event verification test。

## 阶段 6：生产化准备

- [x] access token rotation 和 audit。
- [x] 短期 invite 默认策略。
- [x] 开发期 JSON file Hub 状态和 audit log persistence adapter。
- [x] PostgreSQL-backed Hub state store。
- [x] 更完整 ACL 和 token rotation 管理界面。

## 阶段 7：CRDT v2 重写基础

- [x] 新增 `@devmesh/crdt-store`，定义 CRDT backend 接口和 Automerge 默认实现。
- [x] 定义 v2 `ProjectDoc`、`ServerGlobalDoc`、`KnowledgeNode`、`EntityNode`、`RelationEdge`、`ClaimNode`、`QualitySignal` 和 `ConflictNode` schema。
- [x] 定义知识类型画像和捕获策略：区分 `project_fact`、`macro_experience`、`design_principle`、`pitfall_record` 等类型，默认不自动沉淀易过期项目事实。
- [x] 定义 Git for knowledge 产品心智：用户层使用 knowledge branch / checkout / capture / merge，底层 group 负责同步和 ACL。
- [x] 设计 knowledge branch / group 知识空间模型：默认 checkout 到 `main` 知识分支，主题化共享或项目隔离通过显式切换 branch 完成。
- [x] 实现 1.0 JSONL 到 v2 CRDT 的一次性 import，覆盖知识、edges、ratings、usage、tombstone 和 audit/task signals。（已覆盖知识、edges、ratings、usage、tombstone、review/quality audit hints 和 task progress hints。）
- [ ] 重写 repository，使写入路径直接写 CRDT，读取路径只读 projections。
- [x] 新增按需 JSONL export，用于备份、调试和人工审阅。（从 CRDT 源状态导出 `.dev-mesh/exports/knowledge.jsonl`，默认保留 tombstone，可按需过滤。）
- [x] 增加 CRDT load/save、重复 change 幂等、乱序 apply 收敛和 import round-trip 测试。（已覆盖 load/save、重复 change 幂等、并发不同字段 merge、乱序 Automerge change apply 收敛和 import round-trip。）

## 阶段 8：Projections 和 Daemon v2

- [x] 定义 projection backend 接口，支持 `schemaVersion`、`sourceHeads()`、`rebuild()`、`applyIncrementalChange()`、`healthCheck()` 和 `dropAndRebuild()`；已提供 `LocalProjectionBackend` 过渡实现。
- [x] 实现本地默认 projections：`knowledge.sqlite`、`graph.sqlite`、`search.sqlite`。（保留 `manifest.json` 作为调试清单，并额外生成 `quality.json` 动态评分 projection。）
- [x] 实现动态评分 projection：从 `QualitySignal` 聚合 `reliability`、`usefulness`、`freshness`、`priority` 和 `score`。
- [x] 实现基于类型画像和 TTL 的 projection 召回策略，默认排除过期或易变 `project_fact`，支持显式 `includeVolatile`。
- [x] 实现 local-store 过渡版 branch-aware 查询：capture 标注 `source.metadata.branch`，list/search/context/graph 默认只读 active/base branch，支持显式 `branch` 单次查询，旧知识回退到 `main`。
- [x] 实现 Hub 过渡版 branch-aware 查询策略：同步快照重放兼容写入 `source.metadata.groupKey`，Admin/API/Web 对外优先使用 `branchKey` 并兼容旧 `groupKey` 查询，CRDT v2 正式版再替换为 namespace projection。
- [x] 重写 daemon：监听 CRDT changes、自动 sync、自动 materialize projections、写入 v2 status。（本地 daemon 进程状态已写入 `.dev-mesh/state/daemon.json` / `.dev-mesh/state/daemon.pid`，sync status 写入 `.dev-mesh/state/sync.json`，并暴露 CRDT heads、projection materialized 状态和 projection 文件健康摘要；daemon 已通过 `/api/v2/sync/exchange` 交换 Automerge changes，peer heads 状态写入 `.dev-mesh/crdt/sync/peers.json`，诊断 heads 写入 `.dev-mesh/crdt/sync/heads.json`，并在拉取后自动重建 projections；worker 已监听 `.dev-mesh/crdt/project.automerge` 并 debounce 触发同步和 projection rebuild。）
- [x] 实现 projection dirty 标记、版本不匹配/损坏/缺失文件诊断和 daemon 自动 rebuild。（增量更新当前仍由 backend 降级为全量 rebuild。）
- [x] 增加 projection 删除后从 CRDT 全量重建一致性的测试。

## 阶段 9：CRDT Sync 和全局 Hub

- [x] 设计 v2 client-to-Hub CRDT sync protocol，替代 cursor-only knowledge sync。（已新增 `/api/v2/sync/exchange`，daemon 使用 document heads 和 base64 Automerge changes 交换 CRDT 变更，并记录 remote heads peer state；本地 bootstrap 不再生成 `.dev-mesh/sync/cursors.json`，daemon 运行路径已移除 v1 cursor event sync。）
- [ ] 服务端保存逻辑全局 CRDT，并支持物理分片：server、groups、projects、members、knowledge、entities、relations、claims、conflicts、signals。（Hub 已持久化 group/project 维度 CRDT document snapshot、heads 和 change log；Admin branch/project/publish 管理操作已追加到 `server-global/admin-operations` Automerge 过渡日志，并随 `crdtDocuments` 保存 snapshot、heads 和 change log；Admin 已提供 CRDT document status 只读 API/页面查看 document ref、heads、change count 和 latest change 摘要且不暴露 bytes/snapshot；完整全局 schema 分片待补。）
- [x] 实现服务端全局 projections：`global-knowledge`、`global-graph`、`global-search`、`global-quality`、`global-conflicts`。（已实现 Hub 内存/JSON 持久化的 v2 global projection 摘要，跟踪 CRDT document heads、group/project scope、knowledge、relations、quality signals 和 conflicts；knowledge 仍兼容投影到现有 repository，专用生产 backend 待后续替换。）
- [ ] 实现全局服务器连接地址和项目 active knowledge branch 配置，active/base branch 映射到底层 `group_key`。（daemon 已按项目 active knowledge branch 选择 joined server/group 执行 v2 CRDT exchange，并兼容 `main` -> `default`；base branch 已作为 read-only remote 拉入独立 `.dev-mesh/crdt/branches/<group>.automerge` cache 且不会上传本地 changes，本地 repository/search/projection/graph explore 已叠加 base cache；daemon status/heads、runtime/MCP status 已暴露 base cache path、heads 和 change count，doctor 已汇总 base cache，Admin 已展示 Hub 侧 CRDT document heads/change log 摘要；更细健康检查待补。）
- [ ] 统一 project/branch/group 入口模型：默认 `main` 共享知识分支，主题化共享或项目隔离由显式 checkout 决定。（本地 branch 配置、CLI/MCP branch 控制和 daemon active-branch group 映射已落地；Hub/Admin 已新增 branch summary API，将内部 group 作为 knowledge branch 聚合 members/projects/CRDT projection counts；Admin API/Web 对知识边界优先使用 `branchKey`，旧 `groupKey` 作为内部 namespace 和兼容输入保留；Admin 前端已新增 Branches 视图展示共享边界和 CRDT counts，并支持创建 knowledge branch；Admin 已支持将项目 checkout 到目标 branch，改变项目后续默认读写空间并写入 audit；Admin 已支持将单条知识 publish/cherry-pick 到目标 branch，生成新 knowledge 并保留来源 metadata/audit；Admin 已支持只读 branch merge preview，将候选知识区分为 publishable、already_published 和 possible_conflict；Admin 已支持从 preview 中批量 publish 选中的 publishable 项，冲突/已发布/缺失项会被 rejected；branch create/update、project checkout、单条和批量 publish 成功项已写入 server-global CRDT 管理操作日志；完整 branch merge、project split 和历史 CRDT 文档迁移待补。）
- [x] 实现 group ACL 过滤和 projection 输出裁剪。（Admin global projection 支持 group/project 过滤；成员级 `/api/v2/projections/global` 使用 Bearer token 按认证 group 强制裁剪。）
- [x] 移除 daemon knowledge snapshot replay 运行路径。
- [ ] 增加 Hub apply CRDT changes 后 Admin 可见、跨 group 隔离、同 group 共享、重复同步幂等和离线恢复测试。（已覆盖 v2 exchange 后 Admin 可见、global projection 更新、projection ACL 裁剪、daemon 本地/远端 Automerge change 交换、同 group 拉取、跨 group 隔离、重复提交幂等和 CRDT apply 收敛；离线恢复待补。）

## 阶段 10：知识图谱、冲突和 Admin v2

- [ ] 实现 EntityResolver、RelationExtractor、QualityScorer、ConflictPolicy 和 Materializer 扩展点。
- [ ] 实现全局知识图谱可视化 API，支持按 server、group、project、member、entity、tag、type 过滤。
- [ ] 实现 Admin 图谱视图：实体关系、项目知识结构、质量热区和冲突层。
- [ ] 实现 Admin group 管理流程：创建 group、项目加入/移出 group、合并/拆分 group，并支持 project 作为 group 入口别名展示。
- [ ] 实现语义冲突 review：same-field edit、delete/update、duplicate entity、contradictory claim。
- [ ] 实现图谱编辑写回 CRDT：entity merge、conflict resolve、priority change、group membership change。
- [ ] 增加 group membership 审计、冲突处理、图谱编辑写回 CRDT 和 projection 刷新的测试。

## 阶段 11：MCP Tools v2 和扩展生态

- [ ] 重写 MCP tools 为 Core / Power / Admin 三层 capability。
- [ ] 实现 Core tools：`devmesh.status`、`branch.*`、`context.build`、`knowledge.*`、`task.*`、`graph.explore`、`graph.link`、`entity.*`、`quality.signal`、`sync.*`。
- [x] 实现 `dmx branch list/switch/create/policy`，让开发者用 Git-like 命令切换知识分支和配置沉淀策略。
- [ ] 实现 Power tools：`project.brief`、`project.scan`、`graph.path`、`claim.*`、`conflict.*`、`memory.summarize`、`projection.*`。
- [ ] 实现 Admin tools：`admin.graph_overview`、`admin.member_activity`、`admin.quality_review`、`admin.conflict_queue`、`admin.entity_merge`、`admin.policy_update`。
- [ ] 实现 `graph.path`，返回知识相关性路径而不是仅返回文本命中。
- [ ] 实现 extension registry 的 v2 capabilities：CRDT backend、projection backend、materializer、entity resolver、relation extractor、quality scorer、conflict policy、sync transport、knowledge type plugin。
- [ ] 增加 MCP tool contract tests，覆盖 capability gating、ACL、group-aware context 和 Admin-only 权限。

## 阶段验收标准

### 阶段 0 验收标准

- monorepo 能在干净环境执行 `pnpm install`、`pnpm typecheck`、`pnpm test:unit` 和 `pnpm build`。
- `apps/*` 只保留薄入口，核心业务位于 `packages/*`，依赖方向检查通过。
- 所有测试文件位于独立 `tests/` 目录，`src/` 只包含生产代码。
- README、技术设计、开发指南和 ADR 模板能说明项目目标、目录结构、测试分层和代码组织原则。

### 阶段 1 验收标准

- MCP `/mcp` 基于官方 TypeScript SDK 的 Streamable HTTP transport，`tools/list` 和 `tools/call` 集成测试通过。
- Hub HTTP API 覆盖 health、well-known、groups、join、sync、projects、project brief，并有集成测试。
- join、project、sync API 必须使用 group-scoped token 验证，跨 group 项目不可见。
- 服务端 HTTP 层使用 Koa2；业务规则保持在框架无关模块中，Koa route 只做 request/response 映射。
- local-store 能完成 schema 校验、migration、JSONL 写入、事件日志、ratings、review queue 和 SQLite FTS 重建。

### 阶段 2 验收标准

- `dmx init --global` 能选择 Codex、Claude Code、opencode，并写入全局 config / identity。
- `dmx join <server> --group <groupKey> --name <displayName>` 能完成 discovery、invite join、全局连接记录和 token 本地保存。
- 本地 MCP Proxy 在 `http://127.0.0.1:8722/mcp` 提供与远端一致的核心 MCP tools。
- 打开项目时能幂等创建或复用 `.dev-mesh/`，未 join 时不上传本地知识。
- `dmx doctor` 能检查 adapter、store、sync、privacy，并给出可执行修复建议。

### 阶段 3 验收标准

- Git 和文件扫描 provider 能产出按需项目扫描发现项，且遵守 `.meshignore` 和隐私策略。
- redaction pipeline 对 token、Authorization、cookie、`.env`、`*.pem`、`*.key` 默认脱敏或阻断。
- MCP 工具提示能驱动 AI 客户端自行总结当前上下文并调用 capture 工具。
- quality scorer 能结合 confidence、rating、adoption、freshness、source trust 生成稳定 `qualityScore`。
- 本地检索能结合 SQLite 关键词索引和质量排序，支持 member-specific experience search。

### 阶段 4 验收标准

- `apps/web-admin` 使用 Vue 3 + Element Plus 等成熟 UI 组件库，能通过 `pnpm dev` 或 workspace script 启动。
- 管理后台能查看 health、groups、members、projects、knowledge、review queue、audit log 和 sync 状态。
- 管理后台的列表、详情、筛选、空状态、错误状态和加载状态都有可回归测试或 smoke 测试。
- project ACL、audit log、glossary、quality review 和 conflict edge 都有 API 测试和最小管理界面。
- 管理后台不直接访问数据库，只通过 server API 读取和管理，权限失败时界面明确提示。

### 阶段 5 验收标准

- server-to-server federation 能增量同步 events、tombstone 和 cursor，重复同步幂等。
- signed event log 能验证签名、拒绝篡改事件，并保留审计原因。
- offline-first conflict replay 能在断网恢复后合并事件，冲突通过 edge 表达并写入 replay audit。
- org-level knowledge sharing 能在保持 group/project ACL 隔离的同时，把 org-visible canonical knowledge 纳入已授权 project brief。
- federation、签名验证和离线冲突都具备集成测试或可重复 smoke 测试。

### 阶段 6 验收标准

- access token rotation 会撤销旧 token、保留 client identity、避免 audit 泄露 token 明文，并有 HTTP integration test。
- invite 默认策略支持短期有效期，显式使用次数限制保留在 audit payload 中。
- Hub groups、invites、members、tokens、projects、sync cursor 和 audit log 能通过开发期 JSON file adapter 或 PostgreSQL-backed Hub state store 跨重启恢复。
- 管理后台能查看关键安全生命周期事件，支持 project ACL 和 member token rotation 管理，并保持所有写操作通过 server API。

### 阶段 7 验收标准

- CRDT schema 能表达知识、实体、关系、claim、评分信号、冲突和 group 归属。
- 所有写入路径只写 CRDT，不再直接写 JSONL 事实源。
- 1.0 JSONL import 能保留核心历史数据，并能生成等价 projections。

### 阶段 8 验收标准

- 本地 projections 可删除并从 CRDT 全量重建。
- daemon 能自动同步、自动 materialize projections，并通过 status 暴露健康状态。
- 项目模式默认只读取 active branch，可选叠加 base branch；默认 active branch 是 `main`，主题化共享或项目隔离通过显式 checkout 完成。

### 阶段 9 验收标准

- Hub 接受 CRDT changes 后能更新全局 CRDT 和全局 projections。
- 全局服务器连接地址和项目 active/base knowledge branch 能共同解析目标知识空间，并映射到底层 `group_key`。
- group ACL 能阻止未授权 group 知识出现在查询结果中。

### 阶段 10 验收标准

- Admin 能可视化全局知识图谱，并按 group、project、entity 和 member 过滤。
- 项目加入、移出、合并或拆分 group 必须写入可审计 CRDT change。
- 语义冲突能进入 review queue，并通过 Admin 写回处理结果。

### 阶段 11 验收标准

- Core tools 默认可用，Power/Admin tools 受 capability 和权限控制。
- `context.build` 能结合 group、quality、graph path 和 token budget 生成稳定上下文包。
- `graph.path` 能解释知识和当前任务的关系路径。

## 发布前检查

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm test:unit`
- [x] `pnpm test:integration`
- [x] `pnpm test:contract`
- [x] `pnpm test:security`
- [x] `pnpm test:e2e`
- [x] `pnpm build`
- [x] `git diff --check`
