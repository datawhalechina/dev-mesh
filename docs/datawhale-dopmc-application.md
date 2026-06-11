# DevMesh Datawhale DOPMC 立项 Issue 草稿

以下内容按当前 Datawhale DOPMC 常见立项 Issue 结构整理，提交前建议补齐真实团队名单，以及确认你是否已经完成 Datawhale 联系方式登记。

---

# DevMesh - DOPMC 立项申请

### 你是否已经阅读并同意《Datawhale开源项目指南》？

- 我已阅读并同意《Datawhale开源项目指南》

### 你是否已经阅读并同意《Datawhale开源项目行为准则》？

- 我已阅读并同意《Datawhale开源项目行为准则》

### 项目简介

DevMesh 是一个面向 Codex、Claude Code、opencode 等 AI 编程工具的本地优先项目知识层。它通过 MCP 把稳定的开发经验、架构决策、任务进展、命令习惯和踩坑记录沉淀到项目里的 `.dev-mesh/`，让同一个仓库中的后续 AI 会话能够继续检索和复用这些上下文。

默认模式完全本地优先，不要求先部署服务端，也不上传原始对话；当团队需要共享知识时，再通过可选的 Hub Server 做同步。

项目仓库：

- 当前仓库：<https://github.com/xy200303/dev-mesh>
- 当前仓库名已调整为符合 Datawhale 规范的小写形式：`dev-mesh`

项目文档：

- 官网与文档：<https://devmesh.xyun.dev/>
- npm CLI：<https://www.npmjs.com/package/devmesh>

### 立项理由

1. AI 编程助手已经广泛进入日常开发流程，但项目级长期记忆仍然缺失。很多上下文只存在于单次会话里，无法稳定沉淀到仓库。

2. 现有 AI 编程工具更擅长即时问答和临时生成，对“项目决策如何长期保留、复用、共享”支持不足。DevMesh 试图把这一层补成标准化的 MCP 能力和本地知识存储。

3. 本项目强调本地优先和知识跟随仓库，这一点对于个人开发者和小团队都非常重要。用户不需要先搭服务，也不需要先把对话上传出去，就能开始积累项目记忆。

4. DevMesh 同时兼顾个人工作流和团队协作。单人使用时可作为本地项目知识库，多人协作时可通过 Hub Server 做可选同步，适合逐步推广。

5. 本项目具备较强的开放扩展价值。它不仅是一个 CLI 工具，还覆盖 MCP tools、本地知识目录结构、图谱关系、同步机制和部署文档，适合在 Datawhale 社区持续共建。

### 项目受众

- 使用 Codex、Claude Code、opencode 等 AI 编程工具的个人开发者
- 希望把项目知识沉淀为仓库资产的小团队
- 对 MCP、AI 工作流、项目记忆、知识图谱方向感兴趣的学习者和工程师

### 项目亮点

1. 本地优先：默认不依赖远端服务，不上传原始对话，先把项目知识沉淀到本地 `.dev-mesh/`
2. MCP 原生：直接以 MCP tools 的形式接入 AI 编程工具，而不是独立做一套旁路系统
3. 知识跟随仓库：可共享的知识条目可以随仓库进入版本管理，新同事或新设备 clone 后即可加载
4. 按需 daemon：使用前台 launcher 拉起后台共享 daemon 的方式，不要求用户手动维护常驻服务
5. 可选团队同步：需要共享时再连接 Hub Server，兼顾个人模式和团队模式
6. 图谱化表达：不仅能保存知识条目，还支持语义边和本地图谱可视化
7. 已有可运行产品形态：CLI 已发布到 npm，官网与文档已上线，仓库不是纯概念阶段

### 已完成内容

- 已发布 npm CLI：`devmesh`
- 已上线官网与文档：<https://devmesh.xyun.dev/>
- 已完成 `dmx init`、`dmx serve --mcp`、`dmx doctor`、`dmx status`、`dmx capture`、`dmx search`、`dmx knowledge`、`dmx graph`、`dmx visualize` 等核心 CLI 能力
- 已完成本地 `.dev-mesh/` 知识存储、知识条目 CRUD、评分、图谱关系和本地可视化
- 已完成面向 Codex、Claude Code、opencode 的 MCP host 接入与配置流程
- 已完成项目级 launcher + daemon 模型，支持按项目复用后台共享进程
- 已完成基础 Hub Server、Web Admin 和部署文档
- 已完成 README / README-EN / CONTRIBUTING / PR 模板 / MIT License / Code of Conduct 等仓库材料整理
- 当前完成度已超过计划的 50%，满足 DOPMC 指南中的立项时机要求

### 项目规划

1. 继续优化安装与初始化体验，降低首次接入门槛
2. 稳定 Hub Server 的部署、同步和运维体验
3. 完善面向用户和贡献者的文档结构
4. 在立项通过后推进 Alpha 内测，收集真实使用反馈
5. 根据内测结果继续打磨产品体验，再准备进入 Beta 公测

### 项目负责人

- 项目负责人：`@xy200303`
- GitHub 主页：<https://github.com/xy200303>

如立项通过，后续会继续补充稳定维护者和贡献者名单。

### 补充说明

- 本项目 GitHub 仓库已调整为符合 Datawhale 规范的小写形式：`dev-mesh`
- 当前代码采用 MIT License；如 Datawhale 对软件仓库协议形式有额外建议，可按官方建议调整

### 注意事项

请在正式提交前自行确认是否需要按照 DOPMC 当前 Issue 模板要求，额外完成微信或其他联系方式登记。如果模板页面有新增必填项，请以模板最新要求为准。
