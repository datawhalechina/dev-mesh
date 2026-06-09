# 开发指南

本指南用于约束 DevMesh 后续开发方式。目标不是把代码写得“看起来架构很大”，而是让每个包的职责清楚、依赖方向稳定、实现足够直接，并且在复杂处留下能帮助后来者理解的注释。

## 1. 基本原则

- 优先写清晰、直白、可测试的代码。能用一个函数表达清楚的逻辑，不先拆成多层 class、manager、factory。
- 先遵守现有包边界，再考虑新增抽象。抽象应该来自重复出现的真实复杂度，而不是来自预想的未来需求。
- 每个模块只承担一个层级的责任：领域规则、Agent 编排、本地 runtime、Hub Server、存储、协议 schema 不混在一起。
- 对外 API 保持稳定、类型明确；内部实现保持朴素，允许随着需求演进再提炼。
- 算法、协议、解析、状态管理、UI 组件和复杂工程流程优先采用成熟、维护活跃的工具或库；只有在现有工具无法满足边界、许可证、体积、安全或可控性要求时，才自行实现。
- 文档、测试和代码一起更新。新增 HTTP API、MCP tool、`.dev-mesh/` schema、事件格式或包边界时，必须同步补文档和回归测试。

## 1.1 成熟工具优先

不要为了“可控”或“看起来简单”手搓成熟领域里的复杂能力。优先使用已有工具，是为了减少隐藏 bug、降低维护成本，并让实现更容易被后来者理解和替换。

优先采用成熟工具的场景：

- MCP、HTTP、JSON-RPC、认证、加密、签名、数据库迁移、全文检索、向量检索、TOML/JSON/YAML 解析等协议和基础设施。
- diff、AST、schema validation、secret scan、PII scan、日志、队列、缓存、锁、重试、任务调度等工程能力。
- 前端 UI 组件、表格、表单、弹窗、分页、虚拟列表、路由、状态管理和可访问性能力。
- 测试、mock server、浏览器自动化、fixture 管理和覆盖率等验证工具。

允许自行实现的情况：

- 领域规则足够小且稳定，例如质量分计算、PARA 默认推断、group-scoped ACL 判定。
- 现有库引入成本明显高于收益，例如只需要一个十几行的纯函数。
- 需要隔离未来替换成本时，可以先用小接口包住成熟工具，而不是直接把工具细节扩散到业务层。

选择工具前要检查：维护活跃度、TypeScript 类型质量、安全记录、许可证、包体积、跨平台支持、测试可控性和与现有依赖的兼容性。选择结果如果影响架构边界或长期维护成本，应写入 README、技术设计或 ADR。

## 2. 代码组织

仓库采用 library-first monorepo。应用入口在 `apps/*`，可复用能力在 `packages/*`。

| 目录 | 责任 |
| --- | --- |
| `apps/dmx` | CLI 参数解析、命令组合、进程入口。不要承载核心业务规则。 |
| `apps/mesh-server` | 服务端启动、端口/env 读取、依赖组装。不要实现 HTTP/MCP 业务。 |
| `apps/web-admin` | Vue 管理后台，负责查看和管理 Hub 状态。不要直接访问数据库或本地 `.dev-mesh/` 文件。 |
| `packages/core` | 纯领域模型、知识条目、质量信号、repository 接口和核心服务。 |
| `packages/agent` | 把知识组织成 Agent 可消费的 Context Pack 和引用策略。 |
| `packages/client` | 本地 runtime、项目 store 组合、CLI 支撑、脱敏后写入。 |
| `packages/server` | Hub Server、HTTP API、MCP endpoint、group/ACL/sync orchestration。 |
| `packages/local-store` | `.dev-mesh/` bootstrap、JSONL、事件日志、ratings、SQLite 本地索引。 |
| `packages/mcp-contracts` | MCP tool 输入 schema、注册函数和 contract 测试。 |
| `packages/protocol` | 普通 HTTP / sync / join payload 类型。 |
| `packages/extension-api` | 稳定扩展接口，不依赖具体扩展实现。 |
| `packages/registry` | 扩展注册、去重、priority resolve。 |
| `packages/*` 扩展包 | adapter、provider、extractor、quality、search、storage 等具体能力。 |

文件组织建议：

- 一个文件先服务一个清晰主题。文件超过可读范围时，按业务边界拆分，而不是按“utils/types/constants”机械拆分。
- `index.ts` 可以作为 public API 出口，但内部复杂逻辑应逐步移动到命名清楚的模块。
- 测试文件放在每个 package 或 app 的独立 `tests/` 目录，例如 `packages/client/tests/index.test.ts`、`apps/dmx/tests/index.integration.test.ts`。`src/` 只放生产代码。
- 示例代码放在 `examples/`，用于说明 public API 的真实用法，不能依赖测试私有 helper。

## 3. 依赖方向

依赖必须尽量单向，避免低层包反向依赖高层实现。

```text
extension-api
  <- core
  <- agent
  <- client

core <- server
core <- local-store
core <- storage

mcp-contracts <- client / server
protocol <- client / server
```

约束：

- `core` 不能依赖 `agent`、`client`、`server`、`local-store`、`mcp-contracts` 或具体扩展包。
- `agent` 不关心当前 Host 是 Codex、Claude Code 还是 opencode。
- `client` 负责本机环境和 local-first 工作流，不实现团队 Hub 的 group/ACL 规则。
- `server` 负责团队协作 API，不扫描或修改用户本机工具配置。
- `extension-api` 只能定义接口和类型，不 import 内置实现。
- app 层只做组合。发现 app 层开始出现业务分支时，应把逻辑移动到对应 package。

允许的例外必须满足两个条件：范围小、容易删除。例外需要在代码附近注释原因，并优先通过接口或 options 收敛，避免扩散成跨包硬耦合。

## 4. 抽象边界

不要为了“以后可能会用”提前设计复杂抽象。新增接口、registry、factory 或 class 之前，先确认它解决了当前代码里的真实问题。

适合抽象的信号：

- 同一规则在多个包或多个入口重复，并且已经出现不一致风险。
- 需要稳定 public API，供 CLI、server、examples 或第三方嵌入共同使用。
- 需要替换底层实现，例如 JSONL repository、PostgreSQL repository、不同 search backend。
- 需要隔离外部系统，例如 MCP SDK、文件系统、数据库、HTTP transport。

不适合抽象的信号：

- 只有一个调用点，只是为了让函数名看起来“架构化”。
- 把简单数据映射拆成多层 adapter，反而让读者难以追踪字段。
- 用继承表达业务变化。优先使用函数、组合和小接口。
- 在没有真实实现的情况下提前建空 registry、空 provider、空 manager。

## 5. 代码风格

- 函数命名表达动作和领域对象，例如 `captureProjectKnowledge`、`rateProjectKnowledge`。
- 数据结构优先使用明确的 TypeScript interface/type。不要用 `Record<string, unknown>` 逃避领域建模；只有边界输入、metadata 或未知 payload 才使用。
- 错误要带稳定 code，例如 `project_store.unsupported_schema`，方便 CLI、server 和测试断言。
- I/O 边界要集中：文件系统操作放在 local-store，HTTP/MCP transport 放在 server/client，领域计算放在 core。
- 结构化数据使用结构化 parser/schema。避免用脆弱字符串拼接解析 JSON、TOML、MCP payload。
- 修改行为时先补测试或同步补测试，尤其是 schema、redaction、ACL、sync、MCP tool 和本地 store。

## 6. 注释规范

注释要详细解释“为什么”和“边界条件”，不要重复“代码正在做什么”。

应该写注释的地方：

- public API、导出的类型、持久化文件格式和事件 payload。
- 跨包依赖的临时例外，以及未来应如何移除。
- 安全、隐私、ACL、redaction、sync cursor、migration 等失败代价高的逻辑。
- 非显然的兼容处理，例如 SDK 行为、Node 实验性 API、Windows 路径差异。
- 复杂算法的排序权重、质量分计算、检索 fallback 和去重策略。

不需要写注释的地方：

- 变量名和函数名已经清楚表达意图的直线代码。
- “设置字段”“循环数组”“返回结果”这类重复代码字面含义的注释。
- 过期 TODO。TODO 必须说明原因、阻塞条件和归属文档或 issue。

推荐格式：

```ts
// Ratings are stored outside knowledge item files so feedback events do not
// pollute search and index rebuilds.
```

避免格式：

```ts
// Loop over files.
```

对于关键 public API，优先使用简短 JSDoc：

```ts
/**
 * Captures a durable knowledge item into the project store and appends an
 * event that can later be synchronized to a Hub server.
 */
export async function captureProjectKnowledge(...) {}
```

## 7. 测试约定

- 单元测试覆盖纯函数、repository、schema、ranking、redaction、dependency direction。
- 集成测试覆盖 CLI、HTTP API、本地 store、MCP transport、review queue、sync flow。
- 契约测试覆盖 MCP tool schema、protocol payload 和 extension manifest。
- 安全测试覆盖 secret、token、`.env`、`*.pem`、`*.key`、ACL 和 redaction。
- E2E smoke 只验证关键链路，避免变成又慢又脆的全量系统测试。

新增测试时优先使用临时目录、临时 HOME、临时端口和假 token。测试不能读取或修改真实用户配置。

## 8. 文档同步

以下变更必须更新文档：

- 新增或修改 MCP tool：更新 `docs/technical-design.md`、README 或 contract 说明。
- 新增 HTTP API：更新 `packages/protocol` 类型、README API 列表和集成测试。
- 修改 `.dev-mesh/` 目录或 JSONL schema：更新 README 的本地 store 章节。
- 修改阶段任务状态：更新 `docs/TODO.md`。
- 引入新的架构边界或长期决策：新增 ADR。

文档要写给下一个维护者，而不是只写给当前实现者。短句、具体规则、真实路径，比抽象口号更有用。

## 9. 交付与提交

- 每次完成一轮开发后，必须运行与变更范围匹配的验证命令，并进行一次 git commit。
- 提交前检查 `git status --short`、`git diff --name-status` 和 `git diff --check`，避免提交临时目录、构建产物、日志、真实密钥或无关文件。
- 只提交本轮开发相关变更；如果工作区存在无关用户改动，保留未暂存并在交付说明里说明。
- commit message 统一使用英文 Conventional Commits，格式为 `<type>(optional-scope): <description>`。
- 常用 type 包括 `feat`、`fix`、`docs`、`test`、`refactor`、`chore`、`build`、`ci`、`perf`、`style`、`revert`。
- description 使用英文祈使句或简短动词短语，保持具体、可搜索，例如 `feat: add local MCP proxy`、`docs: update development guide`。
- 不再使用中文提交信息；需要说明中文背景时放在 PR 描述、issue 或文档中，而不是 commit subject。
- 不用 `git reset --hard`、`git checkout --` 等破坏性命令清理工作区；需要移除自己生成的临时文件时，先确认路径在当前 workspace 内。
