# DevMesh Datawhale DOPMC 立项草稿

以下内容可作为提交到 Datawhale DOPMC 的立项 Issue 草稿使用，提交前建议再根据最新仓库名和团队成员信息微调。

## 项目名称

DevMesh

建议仓库名在提交前调整为符合 Datawhale 规范的小写形式，例如：

- `devmesh`
- `dev-mesh`

## 项目简介

DevMesh 是一个面向 Codex、Claude Code、opencode 等 AI 编程工具的本地优先项目知识层。它通过 MCP 把稳定的开发经验、架构决策、任务进展、命令习惯和踩坑记录沉淀到项目里的 `.dev-mesh/`，让同一个仓库中的后续 AI 会话能够继续检索和复用这些上下文。

默认模式完全本地优先，不要求先部署服务端，也不上传原始对话；当团队需要共享知识时，再通过可选的 Hub Server 做同步。

## 项目受众

- 使用 AI 编程工具进行日常开发的个人开发者
- 希望让项目知识随仓库沉淀和迁移的小团队
- 希望基于 MCP、项目记忆和知识图谱继续做二次开发的工程师

## 当前进度

当前完成度预计已经超过 50%，可用于立项申请。当前已经具备：

- 已发布 npm CLI：`devmesh`
- 已上线官网与文档：<https://devmesh.xyun.dev/>
- 已完成本地 `.dev-mesh/` 知识存储、MCP launcher、项目 daemon、知识检索与图谱基础能力
- 已完成基础 Hub Server、Web Admin 和部署文档
- 已补齐双语 README、贡献指南、PR 模板、MIT License 和行为准则适配文件

## 项目链接

- GitHub 仓库：<https://github.com/xy200303/DevMesh>
- 官网与文档：<https://devmesh.xyun.dev/>
- npm：<https://www.npmjs.com/package/devmesh>

## 项目团队

- 项目负责人：`@xy200303`
- GitHub 联系方式：<https://github.com/xy200303>

如果立项通过，后续会继续补充稳定维护者和贡献者名单。

## 开源协议

当前代码采用 MIT License。

## 计划阶段

- 当前状态：立项准备 / Alpha 内测
- 下一阶段目标：
  - 完善安装与初始化体验
  - 稳定 Hub Server 部署流程
  - 继续打磨面向用户和贡献者的文档
  - 在满足 Datawhale 要求后进入正式内测节奏

## 备注

- 在正式提交前，需要把 GitHub 仓库名调整为小写且仅包含字母和 `-`。
- 如果 Datawhale 对软件仓库的协议形式有额外要求，可再根据官方建议调整。
