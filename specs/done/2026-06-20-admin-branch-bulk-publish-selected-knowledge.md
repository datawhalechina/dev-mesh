# Admin branch bulk publish selected knowledge

## Meta

- status: done
- source: user-prompt

## 用户原始描述

继续 CRDT knowledge branch 管理开发：在已有 Admin branch merge preview 和单条 branch publish 的基础上，实现批量发布选中的 publishable 知识项。
要求：
- 后端提供 Admin API，接收 sourceBranchKey、targetBranchKey、sourceIds、reason，可批量将 source branch 中指定知识发布到 target branch。
- 批量发布必须只处理 preview 判定为 publishable 的 sourceIds；already_published、possible_conflict、不存在、非 source branch 的 id 要返回 rejected，不应写入。
- 每个成功发布项应复用现有单条 publish 语义：生成新 knowledge item，写入 admin-branch-publish source metadata 和 knowledge.branch.published audit。
- 响应返回 published 列表和 rejected 列表，rejected 包含 sourceId 和 reason/code。
- Web Admin merge preview 弹窗允许选择 publishable 项并执行批量发布；发布后刷新 preview。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 bulk publish 仍是受 preview 限制的显式 cherry-pick，不是自动 branch merge。
- 补充集成测试覆盖：批量发布 publishable 成功、冲突/已发布项被拒绝、preview 刷新后状态变为 already_published。
- 当前环境可能没有 node/npm/pnpm；无法运行 typecheck/test 时至少执行 git diff --check 并记录阻塞。

## TODO

- [x] 继续 CRDT knowledge branch 管理开发：在已有 Admin branch merge preview 和单条 branch publish 的基础上，实现批量发布选中的 publishable 知识项。
- [x] 要求：
- [x] 后端提供 Admin API，接收 sourceBranchKey、targetBranchKey、sourceIds、reason，可批量将 source branch 中指定知识发布到 target branch。
- [x] 批量发布必须只处理 preview 判定为 publishable 的 sourceIds；already_published、possible_conflict、不存在、非 source branch 的 id 要返回 rejected，不应写入。
- [x] 每个成功发布项应复用现有单条 publish 语义：生成新 knowledge item，写入 admin-branch-publish source metadata 和 knowledge.branch.published audit。
- [x] 响应返回 published 列表和 rejected 列表，rejected 包含 sourceId 和 reason/code。
- [x] Web Admin merge preview 弹窗允许选择 publishable 项并执行批量发布；发布后刷新 preview。
- [x] 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 bulk publish 仍是受 preview 限制的显式 cherry-pick，不是自动 branch merge。
- [x] 补充集成测试覆盖：批量发布 publishable 成功、冲突/已发布项被拒绝、preview 刷新后状态变为 already_published。
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

- at: 2026-06-20T04:48:00.485Z
- summary: 实现 Admin branch bulk publish：后端新增批量发布 API，仅允许 preview 判定为 publishable 的 sourceIds 写入，其余返回 rejected；Web Admin merge preview 弹窗支持选择 publishable 项并批量发布，发布后刷新 preview。

### Summary

- 实现 Admin branch bulk publish：后端新增批量发布 API，仅允许 preview 判定为 publishable 的 sourceIds 写入，其余返回 rejected；Web Admin merge preview 弹窗支持选择 publishable 项并批量发布，发布后刷新 preview。

### Completed TODOs

- 继续 CRDT knowledge branch 管理开发：在已有 Admin branch merge preview 和单条 branch publish 的基础上，实现批量发布选中的 publishable 知识项。
- 要求：
- 后端提供 Admin API，接收 sourceBranchKey、targetBranchKey、sourceIds、reason，可批量将 source branch 中指定知识发布到 target branch。
- 批量发布必须只处理 preview 判定为 publishable 的 sourceIds；already_published、possible_conflict、不存在、非 source branch 的 id 要返回 rejected，不应写入。
- 每个成功发布项应复用现有单条 publish 语义：生成新 knowledge item，写入 admin-branch-publish source metadata 和 knowledge.branch.published audit。
- 响应返回 published 列表和 rejected 列表，rejected 包含 sourceId 和 reason/code。
- Web Admin merge preview 弹窗允许选择 publishable 项并执行批量发布；发布后刷新 preview。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 bulk publish 仍是受 preview 限制的显式 cherry-pick，不是自动 branch merge。
- 补充集成测试覆盖：批量发布 publishable 成功、冲突/已发布项被拒绝、preview 刷新后状态变为 already_published。
- 当前环境可能没有 node/npm/pnpm；无法运行 typecheck/test 时至少执行 git diff --check 并记录阻塞。

### Changed Files

- `packages/server/src/hub-admin.ts`
- `packages/server/src/hub-server.ts`
- `packages/server/tests/index.integration.test.ts`
- `apps/web-admin/src/types.ts`
- `apps/web-admin/src/api.ts`
- `apps/web-admin/src/App.vue`
- `docs/TODO.md`
- `docs/crdt-knowledge-sync-design.md`
- `specs/todo/2026-06-20-admin-branch-bulk-publish-selected-knowledge.md`

### Verification

- passed `git diff --check -- packages/server/src/hub-admin.ts packages/server/src/hub-server.ts packages/server/tests/index.integration.test.ts apps/web-admin/src/App.vue apps/web-admin/src/api.ts apps/web-admin/src/types.ts docs/TODO.md docs/crdt-knowledge-sync-design.md specs/todo/2026-06-20-admin-branch-bulk-publish-selected-knowledge.md`：通过；仅有 LF 将被 CRLF 替换的 Git 换行提示。
- failed `Get-Command node,npm,pnpm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name`：当前 PATH 无 node/npm/pnpm 输出，无法运行 typecheck/vitest。

### 实际行为记录

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| 批量发布成功 | sourceIds 中的知识属于 source branch 且 preview 状态为 publishable | 生成新的 target branch knowledge item，保留 publishedFromId/publishedFromBranch metadata，并写入 knowledge.branch.published audit。 | 未记录 | 未记录 | 未记录 | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-server.ts`<br>`packages/server/tests/index.integration.test.ts` |
| 批量拒绝 | sourceIds 包含 already_published、possible_conflict、不存在或不在 preview 内的 id | 这些 id 进入 rejected，返回 sourceId、code、reason，不写入新 knowledge。 | 未记录 | 未记录 | 未记录 | `packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| 前端批量发布 | Admin 打开 Branch Merge Preview 弹窗 | publishable 项默认选中，用户可取消选择；点击 Publish Selected 后调用 bulk publish 并刷新 preview。 | 未记录 | 未记录 | 未记录 | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/api.ts`<br>`apps/web-admin/src/types.ts` |
| 边界限制 | sourceIds 为空或超过 500 | 返回 400 错误，避免空发布或 preview 截断造成误判。 | 未记录 | 未记录 | 未记录 | `packages/server/src/hub-admin.ts` |

### Risks

- 当前环境缺少 Node 工具链，无法验证 TypeScript 编译、Vue 模板类型和 Vitest 运行。

### Blockers

- 无

## Done

- doneAt: 2026-06-20T15:06:15.416Z
- note: 已补齐完整验证：server integration 目标测试通过，相关 typecheck 和前端测试通过。

## 最终行为契约

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| 批量发布成功 | Admin 调用 bulk publish，sourceIds 属于 source branch 且 merge preview 判定为 publishable | 为每个成功项生成 target branch 的新 knowledge item，复用单条 publish metadata/audit 语义，并返回 published 列表。 | reason 可选；未提供时不写入 reason metadata。 | sourceIds 必须非空且不超过 500，避免空发布和预览截断误判。 | server integration 26/26 passed，覆盖批量 publishable 成功。 | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-server.ts`<br>`packages/server/tests/index.integration.test.ts` |
| 批量拒绝 | sourceIds 包含 already_published、possible_conflict、不存在或不在 source branch/preview 内的 id | 对应 id 进入 rejected，包含 sourceId、code、reason，不生成 knowledge，不写成功 audit/CRDT operation。 | 未记录 | 未记录 | server integration 覆盖冲突/已发布项 rejected，preview 刷新后已发布项变为 already_published。 | `packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| Web Admin merge preview 批量发布 | 管理员在 Branch Merge Preview 弹窗中选择 publishable 项并点击 Publish Selected | publishable 项默认选中，可取消；提交后调用 bulk publish，显示 published/rejected 结果并刷新 preview。 | 未记录 | 未记录 | web-admin API/app tests 11/11 passed；vue-tsc 通过。 | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/api.ts`<br>`apps/web-admin/src/types.ts` |
