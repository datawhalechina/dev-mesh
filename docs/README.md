# 文档索引

这里收集 MCP Dev Mesh 的设计、路线图和决策记录。

## 主要文档

- [技术设计文档](./technical-design.md)：项目背景、架构、包分层、MCP tools、同步、安全、测试策略和路线图。
- [开发指南](./development-guide.md)：代码组织、依赖方向、抽象边界、注释规范、测试和文档同步约定。
- [TODO 清单](./TODO.md)：从当前骨架到可用产品的阶段任务、阶段验收标准和发布前检查项。

## ADR

- [ADR 模板](./adr/template.md)
- [0001 Library-First Architecture](./adr/0001-library-first-architecture.md)

## 维护约定

- 新增架构决策时，在 `docs/adr/` 下添加 ADR。
- 新增阶段任务或完成状态变更时，更新 `docs/TODO.md`。
- 设计约束、接口边界或路线图发生变化时，同步更新 `docs/technical-design.md`。
- 新增包、跨包依赖、公共 API 或持久化 schema 时，同步检查 `docs/development-guide.md`。
