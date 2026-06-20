# Unify branchKey terminology for knowledge branch APIs

## Meta

- status: done
- source: user-prompt

## 用户原始描述

继续 CRDT knowledge branch 管理开发：把对外 API、Web Admin、CLI/MCP 输出和文档里的 groupKey 语言统一为 branchKey / knowledge branch。要求：
- 对外类型和响应优先暴露 branchKey；服务端底层仍可保留 groupKey 作为兼容字段和内部 namespace。
- 现有输入中的 groupKey 保持向后兼容，但新增/更新 API query/body 应支持 branchKey，并在响应中提供 branchKey。
- Web Admin 表格、筛选、表单和类型使用 Branch/branchKey 文案，不再向用户展示 Group/groupKey 作为知识边界。
- CLI/MCP branch 相关输出使用 branchKey/branch 语言；旧 group 相关认证语义不强行重构。
- Admin CRDT document status 支持 branchKey 过滤，同时兼容 groupKey；server-global 文档不应被 branchKey/groupKey 过滤误包含。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 groupKey 只是过渡期内部 namespace，对外统一叫 branchKey。
- 补充或调整测试覆盖 branchKey 查询/响应，以及旧 groupKey 兼容。
- 当前环境可以运行 bun/node 相关验证时，至少跑 server integration、web-admin tests/vue-tsc、相关 package typecheck 和 git diff --check。

## TODO

- [x] 继续 CRDT knowledge branch 管理开发：把对外 API、Web Admin、CLI/MCP 输出和文档里的 groupKey 语言统一为 branchKey / knowledge branch。要求：
- [x] 对外类型和响应优先暴露 branchKey；服务端底层仍可保留 groupKey 作为兼容字段和内部 namespace。
- [x] 现有输入中的 groupKey 保持向后兼容，但新增/更新 API query/body 应支持 branchKey，并在响应中提供 branchKey。
- [x] Web Admin 表格、筛选、表单和类型使用 Branch/branchKey 文案，不再向用户展示 Group/groupKey 作为知识边界。
- [x] CLI/MCP branch 相关输出使用 branchKey/branch 语言；旧 group 相关认证语义不强行重构。
- [x] Admin CRDT document status 支持 branchKey 过滤，同时兼容 groupKey；server-global 文档不应被 branchKey/groupKey 过滤误包含。
- [x] 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 groupKey 只是过渡期内部 namespace，对外统一叫 branchKey。
- [x] 补充或调整测试覆盖 branchKey 查询/响应，以及旧 groupKey 兼容。
- [x] 当前环境可以运行 bun/node 相关验证时，至少跑 server integration、web-admin tests/vue-tsc、相关 package typecheck 和 git diff --check。

## 执行要求

- 开始前必须先调用 `spec_context`，确认当前 TODO 上下文和工程约束。
- AI 必须按未勾选 TODO 从上到下执行。
- 完成任务后把对应项改成 `[x]`。
- 无法完成的任务保持 `[ ]`，并在任务下方写明阻塞原因。
- 完成后必须记录实际行为：业务分支条件、默认参数行为、边界处理结果和验证结果。

## 实际行为记录

- 分支条件：完成后补充已实现行为。
- 默认参数行为：完成后补充默认值和覆盖规则。
- 边界处理结果：完成后补充异常、空值、权限、状态等处理结果。
- 验证结果：完成后记录验证命令和结果。

## 工程质量约束

这些规则是强制约束，不是建议。

### Hard Rules

- Fail Fast：尽早校验输入、依赖、前置条件和无效状态。
- 风险先确认：不明确、高影响或高风险决策先问用户。
- 文件注释：新建或重写文件保留顶部注释；复杂边界写为什么，不写废话。
- 禁止在一个文件里混合 UI、业务、数据访问逻辑；禁止在领域层引用 Web / DB 框架。
- 禁止为了模式而模式：不要无故引入接口、工厂、泛型、抽象层。
- 性能与资源：避免不必要高复杂度，不阻塞主线程，不泄露连接、内存或文件句柄。

### Recommended Practices

- KISS + YAGNI：优先最简单可用方案，不预埋未确认复杂度。
- Clean Code：业务意图命名，短函数，低嵌套，DRY，显式行为。
- Human Readable：按线性故事写代码，复杂逻辑拆成有语义的小步骤。
- Clean Architecture + DDD：按业务能力分层，领域规则不依赖框架、DB 或 Web。
- SOLID + SoC：职责单一，关注点分离，组合优于继承，依赖抽象。
- 测试优先：核心逻辑可单测，验证命令和结果必须记录。
- 向后兼容：小步修改，不破坏已有 API、数据和行为契约。
- 成熟库优先：已有成熟方案不手搓；新增依赖先确认必要性。
- 项目结构：按业务语义拆分目录和文件，避免单文件堆砌和目录平铺。
- UI/交互：符合直觉，状态完整，文案简洁，布局清楚。
- Boy Scout Rule：局部顺手清理，不做无关大重构。
- AI + Human：结构清晰、边界明确，便于 AI 修改和人类维护。

## 业务不确定性强制确认

这些规则是硬性约束，不是建议。

- 业务不确定性强制确认：金额、费率、结算、退款、折扣、税费、状态机、并发、幂等、重试、回滚、规则来源不明或角色差异，必须先问清楚。
- 禁止猜业务：不要用常识补规则，不要自行假设边界。
- 澄清格式：说明不清楚之处，给出 2 到 3 种可能解释，等待用户确认。
- 金钱与合规：涉及钱、合规、审计的实现必须有明确来源或产品确认注释。

## Checkpoint

- at: 2026-06-20T16:22:33.851Z
- summary: 统一 Admin/API/Web Admin 的知识分支公开语言为 branchKey：服务端 query/body 接受 branchKey 并兼容 groupKey，CRDT/audit/edge/invite/project summary 增加 branchKey 别名；Web Admin 知识边界筛选、表单和表格改用 Branch/branchKey；测试和文档同步更新。

### Summary

- 统一 Admin/API/Web Admin 的知识分支公开语言为 branchKey：服务端 query/body 接受 branchKey 并兼容 groupKey，CRDT/audit/edge/invite/project summary 增加 branchKey 别名；Web Admin 知识边界筛选、表单和表格改用 Branch/branchKey；测试和文档同步更新。

### Completed TODOs

- 继续 CRDT knowledge branch 管理开发：把对外 API、Web Admin、CLI/MCP 输出和文档里的 groupKey 语言统一为 branchKey / knowledge branch。要求：
- 对外类型和响应优先暴露 branchKey；服务端底层仍可保留 groupKey 作为兼容字段和内部 namespace。
- 现有输入中的 groupKey 保持向后兼容，但新增/更新 API query/body 应支持 branchKey，并在响应中提供 branchKey。
- Web Admin 表格、筛选、表单和类型使用 Branch/branchKey 文案，不再向用户展示 Group/groupKey 作为知识边界。
- CLI/MCP branch 相关输出使用 branchKey/branch 语言；旧 group 相关认证语义不强行重构。
- Admin CRDT document status 支持 branchKey 过滤，同时兼容 groupKey；server-global 文档不应被 branchKey/groupKey 过滤误包含。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 groupKey 只是过渡期内部 namespace，对外统一叫 branchKey。
- 补充或调整测试覆盖 branchKey 查询/响应，以及旧 groupKey 兼容。
- 当前环境可以运行 bun/node 相关验证时，至少跑 server integration、web-admin tests/vue-tsc、相关 package typecheck 和 git diff --check。

### Changed Files

- `packages/server/src/hub-admin.ts`
- `packages/server/src/hub-server.ts`
- `apps/web-admin/src/types.ts`
- `apps/web-admin/src/api.ts`
- `apps/web-admin/src/App.vue`
- `apps/web-admin/tests/api.test.ts`
- `packages/server/tests/index.integration.test.ts`
- `docs/TODO.md`
- `docs/crdt-knowledge-sync-design.md`

### Verification

- passed `bun node_modules/typescript/bin/tsc -p packages/server/tsconfig.json --noEmit`
- passed `bun node_modules/typescript/bin/tsc -p packages/local-store/tsconfig.json --noEmit`
- passed `bun node_modules/typescript/bin/tsc -p packages/mcp-contracts/tsconfig.json --noEmit`
- passed `bun node_modules/.pnpm/vue-tsc@3.3.3_typescript@6.0.3/node_modules/vue-tsc/bin/vue-tsc.js -p apps/web-admin/tsconfig.json --noEmit`
- passed `bun node_modules/vitest/vitest.mjs run apps/web-admin/tests/api.test.ts apps/web-admin/tests/app.test.ts`：2 files, 11 tests passed.
- passed `bun node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts packages/server/tests/index.integration.test.ts`：1 file, 26 tests passed.
- passed `git diff --check -- packages/server/src/hub-admin.ts packages/server/src/hub-server.ts apps/web-admin/src/types.ts apps/web-admin/src/api.ts apps/web-admin/src/App.vue apps/web-admin/tests/api.test.ts packages/server/tests/index.integration.test.ts docs/TODO.md docs/crdt-knowledge-sync-design.md specs/todo/2026-06-20-unify-branchkey-terminology-for-knowledge-branch-apis.md`：Only Git LF-to-CRLF warnings on Windows; no whitespace errors.

### 实际行为记录

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| branchKey 优先查询 | Admin knowledge、knowledge edges、global projection、CRDT documents、glossary、quality review、task digest、audit 使用 branchKey query | 服务端读取 branchKey 优先，按内部 group namespace 过滤并返回对应 branch 数据。 | 如果 branchKey 未提供，则接受 legacy groupKey；两者都未提供时不按 branch 过滤。 | Admin CRDT document status 只按 document-level branch/group 过滤，server-global 因无 document-level branchKey/groupKey 不会被 branch/group 过滤误包含。 | server integration passed | `packages/server/src/hub-server.ts`<br>`packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| 公开响应 branchKey 别名 | Admin CRDT document/change、audit log、knowledge edge、invite、project summary 涉及知识边界 | 响应提供 branchKey，同时保留 groupKey 兼容旧调用方。 | branchKey 从内部 groupKey 派生；旧数据缺少 branchKey metadata 时回退读取 groupKey 或默认 default。 | 未记录 | server/web-admin typecheck and tests passed | `packages/server/src/hub-admin.ts`<br>`apps/web-admin/src/types.ts` |
| Web Admin 知识边界语言 | CRDT、Branches、Projects、Glossary、Knowledge、Edges、Audit 等知识边界视图和表单 | 筛选、列、表单使用 Branch/branchKey 文案和请求参数；Members/ACL 中仍保留 Group 作为认证/权限语义。 | 未记录 | 前端类型仍允许 legacy groupKey 输入，避免旧调用编译断裂。 | vue-tsc and web-admin tests passed | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/api.ts`<br>`apps/web-admin/src/types.ts`<br>`apps/web-admin/tests/api.test.ts` |

### Risks

- 无

### Blockers

- 无

## Done

- doneAt: 2026-06-20T16:22:53.200Z
- note: 完成 branchKey 对外术语统一：Admin/API/Web Admin 使用 branchKey，内部 groupKey 保持兼容 namespace。

## 最终行为契约

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| branchKey 优先查询 | Admin API 收到 branchKey query/body | 服务端优先使用 branchKey 过滤知识分支；旧 groupKey query/body 继续兼容。 | 不传 branchKey/groupKey 时不按分支过滤；新知识 metadata 写入 branchKey 与 groupKey 双字段。 | server-global CRDT document 没有 document-level branchKey/groupKey，按 branch/group 过滤不会误包含。 | server integration 26 tests passed | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-server.ts` |
| Web Admin 公开语言 | 知识边界相关视图、筛选、表单、API client | Web Admin 对 CRDT、Projects、Glossary、Knowledge、Edges、Audit 等知识边界显示 Branch 并发送 branchKey。 | Members/ACL 保留 Group 作为认证/权限语义；前端类型保留 legacy groupKey 兼容。 | 未记录 | vue-tsc passed; web-admin 11 tests passed | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/api.ts`<br>`apps/web-admin/src/types.ts` |
| 文档约定 | 设计文档和 TODO 描述 branch/group 关系 | 文档明确 branchKey 是对外字段，groupKey 是过渡期内部 namespace/ACL/sync 边界和兼容字段。 | 未记录 | 未记录 | git diff --check passed with only Windows line-ending warnings | `docs/crdt-knowledge-sync-design.md`<br>`docs/TODO.md` |
