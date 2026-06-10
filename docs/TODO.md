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
