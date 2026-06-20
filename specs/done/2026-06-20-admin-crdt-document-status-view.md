# Admin CRDT document status view

## Meta

- status: done
- source: user-prompt

## 用户原始描述

继续 CRDT knowledge branch 管理开发：增加 Admin 可见的 CRDT document status 能力，让管理员能直接查看 Hub 当前持久化的 crdtDocuments，包括 server-global/admin-operations 文档和 group/project CRDT 文档的 heads/change log 摘要。
要求：
- 后端提供只读 Admin API，列出 state.crdtDocuments 的文档摘要。
- 摘要至少包含 key、document ref、kind、groupKey、projectKey、namespace、schemaVersion、updatedAt、heads、changeCount、snapshotPresent、latestChange。
- latestChange 至少包含 id、receivedAt、clientId、groupKey、actorId、createdAt、summary。
- API 支持按 kind、groupKey、projectKey 过滤；server-global 文档没有 groupKey 时不应被 groupKey 过滤结果误包含。
- Web Admin 增加 CRDT Documents/Status 入口，展示文档 scope、heads 数、change count、更新时间和最新 change 摘要。
- 不暴露 CRDT change bytes 或 snapshot 内容，避免 UI/接口返回巨大 payload。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，说明 Admin 已能查看 CRDT document heads/change log 摘要，完整 schema 分片仍待后续。
- 补充集成测试覆盖：server-global/admin-operations 文档能通过 Admin API 看见；groupKey 过滤不会包含 server-global；普通 project CRDT 文档可按 group/project 过滤看见。
- 当前环境可能没有 node/npm/pnpm；无法运行 typecheck/test 时至少执行 git diff --check 并记录阻塞。

## TODO

- [x] 继续 CRDT knowledge branch 管理开发：增加 Admin 可见的 CRDT document status 能力，让管理员能直接查看 Hub 当前持久化的 crdtDocuments，包括 server-global/admin-operations 文档和 group/project CRDT 文档的 heads/change log 摘要。
- [x] 要求：
- [x] 后端提供只读 Admin API，列出 state.crdtDocuments 的文档摘要。
- [x] 摘要至少包含 key、document ref、kind、groupKey、projectKey、namespace、schemaVersion、updatedAt、heads、changeCount、snapshotPresent、latestChange。
- [x] latestChange 至少包含 id、receivedAt、clientId、groupKey、actorId、createdAt、summary。
- [x] API 支持按 kind、groupKey、projectKey 过滤；server-global 文档没有 groupKey 时不应被 groupKey 过滤结果误包含。
- [x] Web Admin 增加 CRDT Documents/Status 入口，展示文档 scope、heads 数、change count、更新时间和最新 change 摘要。
- [x] 不暴露 CRDT change bytes 或 snapshot 内容，避免 UI/接口返回巨大 payload。
- [x] 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，说明 Admin 已能查看 CRDT document heads/change log 摘要，完整 schema 分片仍待后续。
- [x] 补充集成测试覆盖：server-global/admin-operations 文档能通过 Admin API 看见；groupKey 过滤不会包含 server-global；普通 project CRDT 文档可按 group/project 过滤看见。
- [x] 当前环境可能没有 node/npm/pnpm；无法运行 typecheck/test 时至少执行 git diff --check 并记录阻塞。

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

- at: 2026-06-20T14:57:29.375Z
- summary: 完成 Admin CRDT document status 能力：后端新增只读 /api/v1/admin/crdt-documents，并按 kind/groupKey/projectKey 返回 metadata-only 文档摘要；Web Admin 新增 CRDT Docs 视图和过滤；测试覆盖普通 project CRDT 文档、server-global/admin-operations 文档、group 过滤不包含 server-global，以及前端 client/结构 smoke。

### Summary

- 完成 Admin CRDT document status 能力：后端新增只读 /api/v1/admin/crdt-documents，并按 kind/groupKey/projectKey 返回 metadata-only 文档摘要；Web Admin 新增 CRDT Docs 视图和过滤；测试覆盖普通 project CRDT 文档、server-global/admin-operations 文档、group 过滤不包含 server-global，以及前端 client/结构 smoke。

### Completed TODOs

- 继续 CRDT knowledge branch 管理开发：增加 Admin 可见的 CRDT document status 能力，让管理员能直接查看 Hub 当前持久化的 crdtDocuments，包括 server-global/admin-operations 文档和 group/project CRDT 文档的 heads/change log 摘要。
- 要求：
- 后端提供只读 Admin API，列出 state.crdtDocuments 的文档摘要。
- 摘要至少包含 key、document ref、kind、groupKey、projectKey、namespace、schemaVersion、updatedAt、heads、changeCount、snapshotPresent、latestChange。
- latestChange 至少包含 id、receivedAt、clientId、groupKey、actorId、createdAt、summary。
- API 支持按 kind、groupKey、projectKey 过滤；server-global 文档没有 groupKey 时不应被 groupKey 过滤结果误包含。
- Web Admin 增加 CRDT Documents/Status 入口，展示文档 scope、heads 数、change count、更新时间和最新 change 摘要。
- 不暴露 CRDT change bytes 或 snapshot 内容，避免 UI/接口返回巨大 payload。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，说明 Admin 已能查看 CRDT document heads/change log 摘要，完整 schema 分片仍待后续。
- 补充集成测试覆盖：server-global/admin-operations 文档能通过 Admin API 看见；groupKey 过滤不会包含 server-global；普通 project CRDT 文档可按 group/project 过滤看见。
- 当前环境可能没有 node/npm/pnpm；无法运行 typecheck/test 时至少执行 git diff --check 并记录阻塞。

### Changed Files

- `packages/server/src/hub-admin.ts`
- `packages/server/src/hub-server.ts`
- `apps/web-admin/src/types.ts`
- `apps/web-admin/src/api.ts`
- `apps/web-admin/src/App.vue`
- `apps/web-admin/tests/api.test.ts`
- `apps/web-admin/tests/app.test.ts`
- `packages/server/tests/index.integration.test.ts`
- `docs/TODO.md`
- `docs/crdt-knowledge-sync-design.md`
- `specs/todo/2026-06-20-admin-crdt-document-status-view.md`

### Verification

- passed `git diff --check -- packages/server/src/hub-admin.ts packages/server/src/hub-server.ts apps/web-admin/src/types.ts apps/web-admin/src/api.ts apps/web-admin/src/App.vue apps/web-admin/tests/api.test.ts apps/web-admin/tests/app.test.ts packages/server/tests/index.integration.test.ts docs/TODO.md docs/crdt-knowledge-sync-design.md specs/todo/2026-06-20-admin-crdt-document-status-view.md`：仅有 Git LF/CRLF 提示，无 whitespace error。
- passed `rg -n "[ \\t]+$" packages/server/src/hub-admin.ts packages/server/src/hub-server.ts apps/web-admin/src/types.ts apps/web-admin/src/api.ts apps/web-admin/src/App.vue apps/web-admin/tests/api.test.ts apps/web-admin/tests/app.test.ts packages/server/tests/index.integration.test.ts docs/TODO.md docs/crdt-knowledge-sync-design.md specs/todo/2026-06-20-admin-crdt-document-status-view.md`：仅命中 docs/crdt-knowledge-sync-design.md:3 既有 Markdown 硬换行尾随空格，未改动。
- passed `bun node_modules/vitest/vitest.mjs run apps/web-admin/tests/api.test.ts apps/web-admin/tests/app.test.ts`：2 files / 11 tests passed；Bun 结束时打印 EPERM 读取 C:\Users\34834\ 的环境噪声，但退出码为 0。
- passed `bun node_modules/.pnpm/vue-tsc@3.3.3_typescript@6.0.3/node_modules/vue-tsc/bin/vue-tsc.js -p apps/web-admin/tsconfig.json --noEmit`：前端类型检查通过。
- failed `bun node_modules/typescript/bin/tsc -p packages/server/tsconfig.json --noEmit`：当前只剩 packages/local-store/src/graph-indexer.ts:132 的既有 string | undefined -> string 类型错误；本次触碰的 hub-admin exactOptionalPropertyTypes 报错已修复。
- failed `bun node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts packages/server/tests/index.integration.test.ts`：测试导入阶段失败：packages/mcp-contracts/src/index.ts 中 z.object 为 undefined，未进入测试体；bun x 路径还会因缺少 node 失败。

### 实际行为记录

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| 正常查询 | Admin 调用 GET /api/v1/admin/crdt-documents 且不带过滤条件 | 返回 state.crdtDocuments 的摘要列表，按 updatedAt 倒序、kind/key 稳定排序；每项包含 key、document ref、kind、updatedAt、heads、changeCount、snapshotPresent 和 latestChange metadata。 | 未记录 | 未记录 | 前端 API 测试通过；server integration 断言已补充但当前环境未能执行。 | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-server.ts` |
| 过滤查询 | 请求携带 kind、groupKey 或 projectKey | 只匹配 document-level ref 上对应字段；server-global 文档没有 document.groupKey，因此 groupKey 过滤结果不会误包含 server-global/admin-operations。 | 不传过滤参数时列出所有 CRDT document 摘要。 | groupKey 仅看 document.groupKey，不使用 latestChange.groupKey 参与 document 归属判断。 | 集成测试断言已覆盖 groupKey=research/frontend-team 不包含 server-global。 | `packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| 敏感/大 payload 保护 | Admin status API 和 Web Admin CRDT Docs 页面展示文档状态 | 接口和 UI 只暴露 heads、changeCount、snapshotPresent 与 latestChange 摘要，不返回 Automerge change bytes 或 snapshot 内容。 | 未记录 | snapshot 只以 boolean snapshotPresent 暴露。 | 集成测试断言 JSON 不包含 "bytes" 或精确 "snapshot" key；源码检索仅出现 snapshotPresent。 | `packages/server/src/hub-admin.ts`<br>`apps/web-admin/src/App.vue`<br>`apps/web-admin/src/types.ts` |
| Web Admin 展示 | 管理员打开 CRDT Docs 视图 | 页面提供 kind/group/project 过滤，展示 key、scope、schema、heads 数、change count、snapshot 状态、latest change、actor、received/updated 时间。 | 未记录 | 未记录 | web-admin API/app smoke tests 通过；vue-tsc 通过。 | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/api.ts`<br>`apps/web-admin/src/types.ts` |

### Risks

- 集成测试断言已补充但因当前 Bun/zod/Node 环境无法实际跑完整 server integration，需要在具备 Node 的标准开发环境复跑。

### Blockers

- 当前环境没有 node/npm/pnpm，只有 bun；bun x vitest 依赖 node shim 会失败。
- server package typecheck 仍被 packages/local-store/src/graph-indexer.ts:132 的既有类型错误阻塞。
- integration test 直接 bun 路径在 zod 导入时出现 z.object undefined，未能执行目标集成测试体。

## Done

- doneAt: 2026-06-20T15:06:00.484Z
- note: 已补齐验证阻塞：server integration 目标测试通过，server/mcp-contracts/local-store/frontend 类型与前端测试通过。

## 最终行为契约

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| CRDT 文档状态查询 | Admin 调用 GET /api/v1/admin/crdt-documents，未传过滤参数 | 返回 HubState.crdtDocuments 的 metadata-only 摘要列表，包含 key、document ref、kind、heads、changeCount、snapshotPresent、updatedAt 和 latestChange metadata。 | 未传 kind/groupKey/projectKey 时返回所有 CRDT document 摘要。 | 不会返回 Automerge bytes 或 snapshot 原始内容，只返回 snapshotPresent 布尔值。 | bun node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts packages/server/tests/index.integration.test.ts：26 tests passed。 | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-server.ts`<br>`packages/server/tests/index.integration.test.ts` |
| CRDT 文档过滤 | 请求携带 kind、groupKey 或 projectKey | 按 document-level ref 精确过滤；server-global/admin-operations 没有 document.groupKey，因此 groupKey 过滤不会误包含它。 | filter 字段为空字符串时不会发送查询参数，后端视为未过滤。 | latestChange.groupKey 只表示 change 作用对象，不参与 document 归属过滤。 | integration 覆盖 project CRDT doc 可按 group/project 查询，server-global 可按 kind 查询，groupKey=research/frontend-team 不包含 server-global。 | `apps/web-admin/src/api.ts`<br>`packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| Web Admin CRDT Docs 页面 | 管理员打开 CRDT Docs 视图 | 页面提供 kind/group/project 过滤，展示 scope、schema、heads 数、change count、snapshot 状态、latest change、actor、received/updated 时间。 | 未记录 | 未记录 | bun node_modules/vitest/vitest.mjs run apps/web-admin/tests/api.test.ts apps/web-admin/tests/app.test.ts：11 tests passed；vue-tsc --noEmit 通过。 | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/types.ts`<br>`apps/web-admin/tests/api.test.ts`<br>`apps/web-admin/tests/app.test.ts` |
