# Admin MCP tools

## Meta

- status: done
- source: user-prompt

## 用户原始描述

1. 为 Admin MCP tools 补一个独立任务，沿用 docs/crdt-knowledge-sync-design.md 和 docs/TODO.md 里的 Admin tool 语义，先梳理现有 Hub admin HTTP 能力与 MCP 缺口。
2. 在 MCP contracts/server/local proxy 中补充 admin.graph_overview、admin.member_activity、admin.quality_review、admin.conflict_queue、admin.entity_merge、admin.policy_update 的注册骨架与契约测试，确保默认不向普通客户端暴露。
3. 运行相关测试与类型检查，记录实际行为、边界和剩余缺口。

## TODO

- [x] 1. 为 Admin MCP tools 补一个独立任务，沿用 docs/crdt-knowledge-sync-design.md 和 docs/TODO.md 里的 Admin tool 语义，先梳理现有 Hub admin HTTP 能力与 MCP 缺口。
- [x] 2. 在 MCP contracts/server/local proxy 中补充 admin.graph_overview、admin.member_activity、admin.quality_review、admin.conflict_queue、admin.entity_merge、admin.policy_update 的注册骨架与契约测试，确保默认不向普通客户端暴露。
- [x] 3. 运行相关测试与类型检查，记录实际行为、边界和剩余缺口。

## 实际行为记录

- 记录来源：只能记录已阅读代码、已修改代码、测试结果或用户确认的事实。
- 分支条件：完成后补充实际存在的正常、失败、边界、权限和状态分支。
- 默认参数行为：完成后补充源码里的默认值、配置来源和覆盖规则。
- 边界处理结果：完成后补充异常、空值、权限、状态等处理结果。
- 验证结果：完成后记录验证命令、结果和关联文件。
- 禁止事项：不要把猜测、常识或“看起来合理”的行为写成事实。

## Done

- doneAt: 2026-06-21T10:24:12.950Z
- note: verified by user/Codex

## 最终行为契约

1. Public MCP endpoint visibility
  - 条件：Client connects to /mcp without admin capability
  - 结果：Only core/power tools are listed; admin tools are absent.
  - 默认行为：Ordinary MCP clients keep the smaller public tool surface.
  - 边界处理：graph.path remains power-gated and only appears when power capability is enabled.
  - 验证：Integration test asserts public tool names do not contain any admin tool names.
  - 关联文件：
    - `packages/server/src/hub-server.ts`
    - `packages/mcp-contracts/src/index.ts`
    - `packages/server/tests/index.integration.test.ts`

2. Admin MCP endpoint visibility
  - 条件：Client connects to /api/v1/admin/mcp
  - 结果：Admin tools are listed on the admin endpoint through a separate MCP session.
  - 默认行为：Admin tools are only reachable through the controlled admin endpoint.
  - 边界处理：entity_merge and policy_update remain explicit placeholders rather than real write handlers.
  - 验证：Integration test asserts admin tool names are present on the admin endpoint and absent on the public endpoint.
  - 关联文件：
    - `packages/server/src/hub-server.ts`
    - `packages/server/src/mcp.ts`
    - `packages/server/tests/index.integration.test.ts`

3. Cleanup after admin MCP test
  - 条件：Admin and public MCP clients are opened against a temp hub-state directory
  - 结果：Closing both clients before deleting the temp project root avoids ENOTEMPTY during teardown.
  - 默认行为：Test teardown closes the admin client, public client, and app before removing the temp directory.
  - 边界处理：If the admin client is left open, rm(projectRoot, { recursive: true, force: true }) can fail while files remain in use.
  - 验证：The failing integration test passed after adding an explicit adminClient close in finally.
  - 关联文件：
    - `packages/server/tests/index.integration.test.ts`
