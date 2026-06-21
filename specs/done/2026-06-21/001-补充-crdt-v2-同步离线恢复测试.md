# 补充 CRDT v2 同步离线恢复测试

## Meta

- status: done
- source: user-prompt

## 用户原始描述

阶段 9 仍有一项 open TODO：增加 Hub apply CRDT changes 后 Admin 可见、跨 group 隔离、同 group 共享、重复同步幂等和离线恢复测试（离线恢复待补）。本次任务只补离线恢复相关的测试与必要修正，验证 daemon/Hub 在客户端离线后重新上线时，active branch 和 base branch 的 CRDT changes 能继续收敛，且不会重复应用或污染其他 group。

## TODO

- [x] 阶段 9 仍有一项 open TODO：增加 Hub apply CRDT changes 后 Admin 可见、跨 group 隔离、同 group 共享、重复同步幂等和离线恢复测试（离线恢复待补）。本次任务只补离线恢复相关的测试与必要修正，验证 daemon/Hub 在客户端离线后重新上线时，active branch 和 base branch 的 CRDT changes 能继续收敛，且不会重复应用或污染其他 group。

## 实际行为记录

- 记录来源：只能记录已阅读代码、已修改代码、测试结果或用户确认的事实。
- 分支条件：完成后补充实际存在的正常、失败、边界、权限和状态分支。
- 默认参数行为：完成后补充源码里的默认值、配置来源和覆盖规则。
- 边界处理结果：完成后补充异常、空值、权限、状态等处理结果。
- 验证结果：完成后记录验证命令、结果和关联文件。
- 禁止事项：不要把猜测、常识或“看起来合理”的行为写成事实。

## Done

- doneAt: 2026-06-21T09:17:55.967Z
- note: 离线恢复测试已补齐并通过 release:check。

## 最终行为契约

1. 客户端离线后恢复同步
  - 条件：第一次成功同步后，客户端离线期间 active branch 和 base branch 分别新增 CRDT changes，随后重新上线再次运行 daemon sync
  - 结果：重新上线后，active branch 和 base branch 都继续收敛；再次运行 daemon sync 时 queuedLocalChanges、pushedChanges、pulledChanges 和 appliedChanges 均回到 0 或保持幂等，不重复应用相同 changes。
  - 默认行为：daemon sync 仍按当前 active branch 和 base branch 配置选择远端；离线时远端请求抛错会写入 lastError，恢复后继续按 peer.remoteHeads / lastExchangeHeads 计算增量。
  - 边界处理：base branch 需要先通过 applyBranchCrdtChanges 维护独立 branch cache，否则仅 captureProjectKnowledge 不会自动生成可同步的 base branch CRDT changes。
  - 验证：pnpm exec vitest run packages/client/tests/daemon-sync.test.ts -t "recovers offline active and base branch sync after reconnecting without duplicating changes" --reporter=verbose
  - 关联文件：
    - `packages/client/tests/daemon-sync.test.ts`
    - `packages/client/src/daemon-sync.ts`
    - `packages/local-store/src/crdt.ts`

2. 整套 daemon sync 回归
  - 条件：daemon-sync.test.ts 全量运行
  - 结果：8 个测试全部通过，离线恢复测试没有破坏已有 active/base branch、projection repair 或 legacy status normalization 行为。
  - 默认行为：默认 active branch 仍由 project config 决定，base branch 作为只读缓存读取。
  - 边界处理：离线时 fetch 失败的远端会被标记 lastError，但不会阻止后续恢复同步。
  - 验证：pnpm exec vitest run packages/client/tests/daemon-sync.test.ts --reporter=dot
  - 关联文件：
    - `packages/client/tests/daemon-sync.test.ts`

3. 发布门禁回归
  - 条件：在补充离线恢复测试后执行 release gate
  - 结果：pnpm release:check 通过，包含 version:sync、version:check、typecheck、test、build 和 npm package smoke。
  - 默认行为：release gate 使用现有版本 0.1.4，不需要再改版本号。
  - 边界处理：TypeScript build 和 e2e 仍保留对 CRDT / projection / admin flow 的完整检查。
  - 验证：pnpm release:check
  - 关联文件：
    - `packages/client/tests/daemon-sync.test.ts`
    - `package.json`
