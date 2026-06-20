# mcp-context-mesh Specs

本目录用于 spec coding：先写清楚规格，再让 AI 按规格修改代码和测试。

## 前置要求

任何代码或文档变更之前，必须先调用 `spec_context` 并读取输出。
如果当前没有 `spec_context` 结果，就不要直接开始实现。

## 工作流

1. 先调用 `spec_context`，确认当前任务的 spec、TODO 和工程约束。
2. 没有 spec 的旧系统，先用 MCP 从源码反推 `review/` specs。
3. 用户审查 `review/*.md`，把源码事实改成真实业务规格。
4. 要开发时，把 spec 放到 `active/`，或直接让 MCP 读取指定 spec。
5. Codex 按 spec 修改代码和测试。
6. 验证通过后，把 spec 移到 `done/`。

## 状态

- `source-derived/current-code`：从现有源码反推，表示当前代码大概率已有对应实现，待用户审查。
- `draft`：用户正在描述需求，尚未实现。
- `active`：准备实现或正在实现。
- `todo`：轻量任务清单，AI 应按未勾选项顺序执行。
- `done`：代码和测试已按该 spec 完成。

## 目录

- `review/`：从源码反推的待审查 specs。
- `active/`：当前要实现的 specs。
- `todo/`：可执行 TODO 清单，适合拆分小任务或补充实现步骤。
- `done/`：已经完成的 specs。
- `templates/`：新建 feature、bugfix、removal spec 的模板。
