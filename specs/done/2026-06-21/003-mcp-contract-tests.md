# MCP contract tests

## Meta

- status: done
- source: user-prompt

## 用户原始描述

1. 为 MCP tools v2 补 contract tests，覆盖 capability gating、ACL、group-aware context 和 Admin-only 权限。
2. 明确现有 public / power / admin 工具的注册与可见性契约。
3. 运行相关测试与类型检查，记录实际行为和边界。

## TODO

- [x] 1. 为 MCP tools v2 补 contract tests，覆盖 capability gating、ACL、group-aware context 和 Admin-only 权限。
- [x] 2. 明确现有 public / power / admin 工具的注册与可见性契约。
- [x] 3. 运行相关测试与类型检查，记录实际行为和边界。

## 实际行为记录

- 记录来源：只能记录已阅读代码、已修改代码、测试结果或用户确认的事实。
- 分支条件：完成后补充实际存在的正常、失败、边界、权限和状态分支。
- 默认参数行为：完成后补充源码里的默认值、配置来源和覆盖规则。
- 边界处理结果：完成后补充异常、空值、权限、状态等处理结果。
- 验证结果：完成后记录验证命令、结果和关联文件。
- 禁止事项：不要把猜测、常识或“看起来合理”的行为写成事实。

## Done

- doneAt: 2026-06-21T09:58:26.759Z
- note: Archived after verification and version bump to 0.1.5.

## 最终行为契约

1. Default MCP registration
  - 条件：registerMeshTools is called without capability options
  - 结果：Only core tools are registered; mesh_graph_path is omitted; admin tools remain unregistered.
  - 默认行为：Core tools are visible by default.
  - 边界处理：Power tools are not exposed unless the caller explicitly opts in.
  - 验证：Contract test asserts registered tool names equal the core tool list and do not contain mesh_graph_path.
  - 关联文件：
    - `packages/mcp-contracts/src/index.ts`
    - `packages/mcp-contracts/tests/index.contract.test.ts`

2. Power-enabled MCP registration
  - 条件：registerMeshTools is called with capabilities.power=true
  - 结果：mesh_graph_path is registered alongside the core tools.
  - 默认行为：Power capability extends the visible tool set.
  - 边界处理：Tool order matches registration order; graph_path appears before mesh_explore_knowledge_graph in the registered list.
  - 验证：Contract test asserts the power-enabled registration includes mesh_graph_path in the expected order.
  - 关联文件：
    - `packages/mcp-contracts/src/index.ts`
    - `packages/mcp-contracts/tests/index.contract.test.ts`

3. Server and local proxy MCP exposure
  - 条件：Hub server and local MCP proxy create their MCP servers
  - 结果：Both pass capabilities.power=true to registerMeshTools so graph_path is exposed in their tool list.
  - 默认行为：Server and local proxy share the same capability model.
  - 边界处理：Admin tools are still not registered yet.
  - 验证：Integration tests passed after adding mesh_graph_path to the expected tool lists.
  - 关联文件：
    - `packages/server/src/mcp.ts`
    - `packages/client/src/local-mcp-server.ts`
    - `packages/server/tests/index.integration.test.ts`
    - `packages/client/tests/local-proxy.integration.test.ts`
