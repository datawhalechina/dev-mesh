# Admin knowledge branch merge preview

## Meta

- status: done
- source: user-prompt

## 用户原始描述

继续 CRDT knowledge branch 管理开发：实现 Admin branch merge preview 能力。目标是在不写入数据的前提下预览 source branch 到 target branch 的知识合并候选，区分 publishable、already_published、possible_conflict，并在 Web Admin 中提供入口。要求：
- 后端提供只读 Admin API，可按 sourceBranchKey/targetBranchKey 生成 preview。
- Preview 基于当前过渡期 groupKey namespace：source.metadata.groupKey 表示 branch。
- 已通过 branch publish/cherry-pick 发布过的知识应识别为 already_published。
- 目标 branch 中 entryKey 或标题相同但不是同一 published source 的知识应识别为 possible_conflict。
- 其他 source 知识为 publishable。
- Web Admin Branches 视图提供 merge preview 弹窗，展示 summary 和 items。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 preview 是完整 merge 前的只读 review 步骤。
- 补充集成测试覆盖三类 preview 状态。
- 当前环境可能没有 node/npm/pnpm；如果无法运行 typecheck/test，至少执行 git diff --check 并记录阻塞。

## TODO

- [x] 继续 CRDT knowledge branch 管理开发：实现 Admin branch merge preview 能力。目标是在不写入数据的前提下预览 source branch 到 target branch 的知识合并候选，区分 publishable、already_published、possible_conflict，并在 Web Admin 中提供入口。要求：
- [x] 后端提供只读 Admin API，可按 sourceBranchKey/targetBranchKey 生成 preview。
- [x] Preview 基于当前过渡期 groupKey namespace：source.metadata.groupKey 表示 branch。
- [x] 已通过 branch publish/cherry-pick 发布过的知识应识别为 already_published。
- [x] 目标 branch 中 entryKey 或标题相同但不是同一 published source 的知识应识别为 possible_conflict。
- [x] 其他 source 知识为 publishable。
- [x] Web Admin Branches 视图提供 merge preview 弹窗，展示 summary 和 items。
- [x] 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 preview 是完整 merge 前的只读 review 步骤。
- [x] 补充集成测试覆盖三类 preview 状态。
- [x] 当前环境可能没有 node/npm/pnpm；如果无法运行 typecheck/test，至少执行 git diff --check 并记录阻塞。

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

- at: 2026-06-20T04:38:41.832Z
- summary: 实现 Admin knowledge branch merge preview：新增只读 preview API、三态分类逻辑、Web Admin Branches 视图弹窗、集成测试覆盖和文档说明。

### Summary

- 实现 Admin knowledge branch merge preview：新增只读 preview API、三态分类逻辑、Web Admin Branches 视图弹窗、集成测试覆盖和文档说明。

### Completed TODOs

- 继续 CRDT knowledge branch 管理开发：实现 Admin branch merge preview 能力。目标是在不写入数据的前提下预览 source branch 到 target branch 的知识合并候选，区分 publishable、already_published、possible_conflict，并在 Web Admin 中提供入口。要求：
- 后端提供只读 Admin API，可按 sourceBranchKey/targetBranchKey 生成 preview。
- Preview 基于当前过渡期 groupKey namespace：source.metadata.groupKey 表示 branch。
- 已通过 branch publish/cherry-pick 发布过的知识应识别为 already_published。
- 目标 branch 中 entryKey 或标题相同但不是同一 published source 的知识应识别为 possible_conflict。
- 其他 source 知识为 publishable。
- Web Admin Branches 视图提供 merge preview 弹窗，展示 summary 和 items。
- 更新 docs/TODO.md 和 docs/crdt-knowledge-sync-design.md，明确 preview 是完整 merge 前的只读 review 步骤。
- 补充集成测试覆盖三类 preview 状态。
- 当前环境可能没有 node/npm/pnpm；如果无法运行 typecheck/test，至少执行 git diff --check 并记录阻塞。

### Changed Files

- `packages/server/src/hub-admin.ts`
- `packages/server/src/hub-server.ts`
- `packages/server/tests/index.integration.test.ts`
- `apps/web-admin/src/types.ts`
- `apps/web-admin/src/api.ts`
- `apps/web-admin/src/App.vue`
- `docs/TODO.md`
- `docs/crdt-knowledge-sync-design.md`
- `specs/todo/2026-06-20-admin-knowledge-branch-merge-preview.md`

### Verification

- passed `git diff --check -- packages/server/src/hub-admin.ts packages/server/src/hub-server.ts packages/server/tests/index.integration.test.ts apps/web-admin/src/App.vue apps/web-admin/src/api.ts apps/web-admin/src/types.ts docs/TODO.md docs/crdt-knowledge-sync-design.md specs/todo/2026-06-20-admin-knowledge-branch-merge-preview.md`：通过；仅有 LF 将被 CRLF 替换的 Git 换行提示。
- failed `Get-Command node,npm,pnpm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name`：当前 PATH 无 node/npm/pnpm 输出，无法运行 typecheck/vitest。

### 实际行为记录

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| 正常 preview | sourceBranchKey 和 targetBranchKey 均存在且不同 | 返回 source/target branch key、summary 计数和 items 明细；不写入 knowledge、不写 audit。 | 未记录 | 未记录 | git diff --check；集成测试源码覆盖请求 /api/v1/admin/branches/merge-preview。 | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-server.ts` |
| branch namespace | 知识项包含 source.metadata.groupKey 或缺省 groupKey | preview 严格按 metadata.groupKey/default 判断 branch，不使用 org 可见性跨 branch 混入。 | 未记录 | 未记录 | 未记录 | `packages/server/src/hub-admin.ts` |
| 三态分类 | 目标 branch 有 publishedFromId、副本 entryKey/title 冲突或无匹配 | 分别返回 already_published、possible_conflict、publishable。 | 未记录 | 未记录 | 未记录 | `packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| 前端展示 | Admin 打开 Branches 视图并点击 Preview | 弹窗展示 source/target 选择器、summary 计数和每条候选的状态/source/target/reason。 | 未记录 | 未记录 | 未记录 | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/api.ts`<br>`apps/web-admin/src/types.ts` |

### Risks

- 当前环境缺少 Node 工具链，无法验证 TypeScript 编译和 Vitest 运行。

### Blockers

- 无

## Done

- doneAt: 2026-06-20T15:06:29.286Z
- note: 已补齐完整验证：server integration 目标测试通过，前端和相关包 typecheck 通过。

## 最终行为契约

| 场景 | 条件 | 结果 | 默认行为 | 边界处理 | 验证 | 关联文件 |
|---|---|---|---|---|---|---|
| 生成 merge preview | Admin 按 sourceBranchKey/targetBranchKey 请求只读 preview | 返回 source/target、summary 和 items，不写入 knowledge/audit/CRDT operation。 | limit 默认 100，并约束在 1..500。 | source/target 为空、缺失或相同 branch 返回错误。 | server integration 26/26 passed，覆盖 source/target preview。 | `packages/server/src/hub-admin.ts`<br>`packages/server/src/hub-server.ts`<br>`packages/server/tests/index.integration.test.ts` |
| preview 状态分类 | source branch 中的知识与 target branch 比较 | 已发布来源识别为 already_published；entryKey 或标题相同但不是同一 published source 识别为 possible_conflict；其余识别为 publishable。 | 未记录 | 未记录 | server integration 覆盖 publishable、already_published、possible_conflict 三类状态。 | `packages/server/src/hub-admin.ts`<br>`packages/server/tests/index.integration.test.ts` |
| Web Admin preview 弹窗 | 管理员在 Branches 视图打开 Preview | 展示 summary 和 item 状态，并作为 bulk publish 的选择入口。 | 未记录 | 未记录 | web-admin API/app tests 11/11 passed；vue-tsc 通过。 | `apps/web-admin/src/App.vue`<br>`apps/web-admin/src/api.ts`<br>`apps/web-admin/src/types.ts` |
