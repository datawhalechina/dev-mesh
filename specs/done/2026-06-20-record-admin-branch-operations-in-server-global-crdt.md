# Record Admin branch operations in server-global CRDT

## Meta

- status: done
- source: user-prompt

## 用户原始描述

继续 CRDT knowledge branch 管理开发：把 Admin branch/project/publish 管理动作写入服务端 server-global CRDT operation log，作为过渡期的 CRDT 化管理事实源。
要求：
- 在 Hub server 侧复用现有 crdtDocuments 持久化结构，新增 server-global CRDT document 记录 Admin 管理操作。
- 记录 branch 创建/更新、project checkout branch、单条 knowledge publish、批量 knowledge publish 成功项等管理动作。
- 每条 operation 至少包含 id、action、actor、targetType、targetId、createdAt、groupKey、payload。
- Admin 操作原有返回、audit 和行为不能破坏；server-global CRDT 记录失败不应静默吞掉明显编程错误。
- Admin/global projection 或 status 至少能在现有 crdtDocuments 中看到 server-global 文档和 heads/change log。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，说明这是管理操作 CRDT 化的过渡日志，完整 schema 分片仍待后续。
- 补充测试或扩展已有集成测试断言：Admin 操作后持久化状态中存在 server-global CRDT document，且 snapshot/change log 包含对应操作。
- 当前环境可能没有 node/npm/pnpm；无法运行 typecheck/test 时至少执行 git diff --check 并记录阻塞。

## TODO

- [x] 继续 CRDT knowledge branch 管理开发：把 Admin branch/project/publish 管理动作写入服务端 server-global CRDT operation log，作为过渡期的 CRDT 化管理事实源。
- [x] 要求：
- [x] 在 Hub server 侧复用现有 crdtDocuments 持久化结构，新增 server-global CRDT document 记录 Admin 管理操作。
- [x] 记录 branch 创建/更新、project checkout branch、单条 knowledge publish、批量 knowledge publish 成功项等管理动作。
- [x] 每条 operation 至少包含 id、action、actor、targetType、targetId、createdAt、groupKey、payload。
- [x] Admin 操作原有返回、audit 和行为不能破坏；server-global CRDT 记录失败不应静默吞掉明显编程错误。
- [x] Admin/global projection 或 status 至少能在现有 crdtDocuments 中看到 server-global 文档和 heads/change log。
- [x] 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，说明这是管理操作 CRDT 化的过渡日志，完整 schema 分片仍待后续。
- [x] 补充测试或扩展已有集成测试断言：Admin 操作后持久化状态中存在 server-global CRDT document，且 snapshot/change log 包含对应操作。
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

- at: 2026-06-20T04:59:07.673Z
- summary: 实现 Admin 管理操作写入 server-global/admin-operations Automerge 过渡 CRDT 日志，并把该文档登记到现有 crdtDocuments/globalProjection 中；Admin branch create/update、project checkout、单条 publish 和 bulk publish 成功项会追加包含 id/action/actor/targetType/targetId/createdAt/groupKey/payload 的 operation。
- note: server-global/admin-operations 是管理面 CRDT 化的过渡日志，不替代后续 server/groups/projects/knowledge 等完整 schema 分片。

### Summary

- 实现 Admin 管理操作写入 server-global/admin-operations Automerge 过渡 CRDT 日志，并把该文档登记到现有 crdtDocuments/globalProjection 中；Admin branch create/update、project checkout、单条 publish 和 bulk publish 成功项会追加包含 id/action/actor/targetType/targetId/createdAt/groupKey/payload 的 operation。

### Completed TODOs

- 继续 CRDT knowledge branch 管理开发：把 Admin branch/project/publish 管理动作写入服务端 server-global CRDT operation log，作为过渡期的 CRDT 化管理事实源。
- 要求：
- 在 Hub server 侧复用现有 crdtDocuments 持久化结构，新增 server-global CRDT document 记录 Admin 管理操作。
- 记录 branch 创建/更新、project checkout branch、单条 knowledge publish、批量 knowledge publish 成功项等管理动作。
- 每条 operation 至少包含 id、action、actor、targetType、targetId、createdAt、groupKey、payload。
- Admin 操作原有返回、audit 和行为不能破坏；server-global CRDT 记录失败不应静默吞掉明显编程错误。
- Admin/global projection 或 status 至少能在现有 crdtDocuments 中看到 server-global 文档和 heads/change log。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，说明这是管理操作 CRDT 化的过渡日志，完整 schema 分片仍待后续。
- 补充测试或扩展已有集成测试断言：Admin 操作后持久化状态中存在 server-global CRDT document，且 snapshot/change log 包含对应操作。
- 当前环境可能没有 node/npm/pnpm；无法运行 typecheck/test 时至少执行 git diff --check 并记录阻塞。

### Changed Files

- `packages/server/src/hub-global-crdt.ts`
- `packages/server/src/hub-admin.ts`
- `packages/server/tests/index.integration.test.ts`
- `docs/TODO.md`
- `docs/crdt-knowledge-sync-design.md`

### Verification

- passed `git diff --check -- packages/server/src/hub-global-crdt.ts packages/server/src/hub-admin.ts packages/server/tests/index.integration.test.ts docs/TODO.md docs/crdt-knowledge-sync-design.md specs/todo/2026-06-20-record-admin-branch-operations-in-server-global-crdt.md`：通过；仅出现工作区 LF 将被 Git 转为 CRLF 的提示。
- failed `Get-Command node,npm,pnpm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name`：当前 PATH 未找到 node/npm/pnpm，因此无法运行 vitest/typecheck。
- passed `rg -n "[ \\t]+$" packages/server/src/hub-global-crdt.ts packages/server/src/hub-admin.ts packages/server/tests/index.integration.test.ts docs/TODO.md docs/crdt-knowledge-sync-design.md specs/todo/2026-06-20-record-admin-branch-operations-in-server-global-crdt.md`：仅发现 docs/crdt-knowledge-sync-design.md 顶部既有 Markdown 换行空格，未改动。

### 实际行为记录

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| Admin branch create/update | POST /api/v1/admin/branches 成功创建或更新 branch/group | 除原有 group audit 和返回 AdminBranchSummary 外，追加 server-global/admin-operations CRDT operation；新建记录 action=branch.created，已有 branch 记录 action=branch.updated。 | actor 默认为 admin；operation groupKey 使用 branch/group key；payload 包含 branchKey、displayName、joinMode 和可选 description。 | 未记录 | 集成测试扩展 dashboard Admin 流程断言 branch.created 出现在 CRDT snapshot/change log。 | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-global-crdt.ts` |
| Admin project checkout branch | PUT /api/v1/admin/projects/:groupKey/:id/branch 成功跨 branch 移动项目 | 保留原有项目移动、restricted ACL reset 和 audit 行为，同时追加 action=project.branch.checked_out 的 server-global CRDT operation。 | 同 branch checkout 仍直接返回原项目，不追加新 audit 或 CRDT operation；跨 branch operation groupKey 使用目标 branch。 | 目标 branch 缺失、项目缺失或目标 branch 已有同 id 项目仍按原错误返回，未写入 CRDT operation。 | 集成测试断言 persisted crdtDocuments 中有 server-global document，snapshot 包含 checkout operation。 | `packages/server/src/hub-admin.ts` |
| Knowledge branch publish | 单条 publish 或 bulk publish 中某个 publishable item 成功写入目标 branch | 保留原有新 knowledge 生成、metadata 来源标记和 audit；追加 action=knowledge.branch.published 的 server-global CRDT operation。 | payload 包含 sourceId/sourceBranch/targetBranch/mode，可选 reason；mode 区分 single 和 bulk。 | same-branch 单条 publish、bulk 中 already_published/possible_conflict/missing source 仍 rejected，不为失败项写 operation。 | 集成测试扩展 branch scope 流程断言单条和批量成功项都进入 server-global CRDT snapshot/change log。 | `packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| Server-global CRDT document projection | 首次 Admin 管理 operation 追加时 | 创建 kind=server-global、namespace=admin-operations、schemaVersion=2 的 HubCrdtDocument，保存 Automerge snapshot、heads 和 changes，并写入 globalProjection.documents。 | projection 不设置 groupKey，避免计入某个 branch 的 crdtDocuments 统计；counts.documents 包含该全局文档，counts.groups 不增加。 | snapshot/change base64 损坏时 helper 抛错，不静默吞掉明显编程错误。 | dashboard 集成测试断言 /api/v1/admin/global-projection 能看到 server-global 文档 sourceHeads。 | `packages/server/src/hub-global-crdt.ts` |

### Risks

- 当前环境缺少 node/npm/pnpm，无法执行 TypeScript 编译和 Vitest；已用 diff/静态检查补充验证。
- 工作区已有大量未提交改动，本次只针对目标文件增量修改，未回滚其他变更。

### Blockers

- 无

## Done

- doneAt: 2026-06-20T15:06:44.721Z
- note: 已补齐完整验证：server integration 目标测试通过，server/local-store/mcp-contracts typecheck 通过。server-global/admin-operations 仍是过渡事实日志。

## 最终行为契约

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| 记录 Admin 管理操作 | branch create/update、project checkout branch、单条 publish、bulk publish 成功项执行成功 | 追加 server-global/admin-operations Automerge operation，字段包含 id/action/actor/targetType/targetId/createdAt/groupKey/payload；原有返回和 audit 行为保持。 | actor 默认为 admin；同 branch checkout 等无实际变更路径不追加 operation。 | 失败或 rejected 项不写入成功 operation。 | server integration 26/26 passed，持久化状态 snapshot/change log 包含对应 operation。 | `packages/server/src/hub-global-crdt.ts`<br>`packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| server-global CRDT 文档持久化 | 首次 Admin 管理 operation 追加 | 创建 kind=server-global、namespace=admin-operations、schemaVersion=2 的 HubCrdtDocument，保存 snapshot、heads、changes，并出现在 globalProjection/sourceHeads 中。 | 未记录 | 该文档没有 document.groupKey，不计入某个 branch 的 group 过滤结果。 | server integration 覆盖 global projection 和 /api/v1/admin/crdt-documents 中的 server-global 文档。 | `packages/server/src/hub-global-crdt.ts`<br>`packages/server/src/hub-admin.ts` |
| 过渡日志定位 | 当前完整 CRDT schema 分片尚未落地 | server-global/admin-operations 作为管理面 CRDT 化的过渡事实源，不替代后续 server/groups/projects/knowledge 等正式 schema 分片。 | 未记录 | 未记录 | docs/TODO.md 和 docs/crdt-knowledge-sync-design.md 已记录该定位。 | `docs/TODO.md`<br>`docs/crdt-knowledge-sync-design.md` |
