<div align="center">
  <img src="apps/website/docs/public/img/logo.svg" width="72" alt="DevMesh logo">
  <h1>DevMesh</h1>
  <h3>给 AI 编程助手使用的本地优先项目记忆</h3>
  <p><strong>MCP 原生</strong> · <strong>知识跟随仓库</strong> · <strong>团队同步可选</strong></p>
  <p>
    <a href="https://devmesh.xyun.dev/"><strong>Documentation & Website -></strong></a>
    ·
    <a href="./README-EN.md">English</a>
  </p>
  <p>
    <a href="https://www.npmjs.com/package/devmesh"><img alt="npm alpha version" src="https://img.shields.io/npm/v/devmesh/alpha?label=npm&color=2f7f68"></a>
    <a href="https://devmesh.xyun.dev/"><img alt="DevMesh docs" src="https://img.shields.io/badge/docs-devmesh.xyun.dev-4b5563"></a>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D22-5fa04e">
  </p>
  <p>
    <img alt="Windows supported" src="https://img.shields.io/badge/Windows-supported-3b72b9">
    <img alt="macOS supported" src="https://img.shields.io/badge/macOS-supported-3b72b9">
    <img alt="Linux supported" src="https://img.shields.io/badge/Linux-supported-3b72b9">
  </p>
  <p>
    <img alt="Codex supported" src="https://img.shields.io/badge/Codex-supported-6d3fc8">
    <img alt="Claude Code supported" src="https://img.shields.io/badge/Claude%20Code-supported-6d3fc8">
    <img alt="opencode supported" src="https://img.shields.io/badge/opencode-supported-6d3fc8">
    <img alt="MCP tools" src="https://img.shields.io/badge/MCP-tools-2b6f73">
  </p>
  <p><code>npm install -g devmesh@alpha</code></p>
</div>

## DevMesh 是什么

DevMesh 是一个面向 Codex、Claude Code、opencode 等 AI 编程工具的项目知识层。它把稳定的开发经验、架构决策、任务进展、命令习惯和踩坑记录沉淀到项目里的 `.dev-mesh/`，让同一个仓库里的后续 AI 会话可以继续检索和复用这些上下文。

默认模式完全本地优先：不需要先部署服务端，也不会上传原始对话。需要团队共享时，再通过 Hub Server 做可选同步。

## 项目受众

- 使用 Codex、Claude Code、opencode 等 AI 编程工具的个人开发者
- 希望让项目知识随仓库流动的小团队
- 想基于 MCP、项目记忆、知识图谱继续二次开发的工程师

## 在线阅读

- 官网与文档：https://devmesh.xyun.dev/
- CLI 参考：https://devmesh.xyun.dev/reference/cli
- MCP 工具：https://devmesh.xyun.dev/reference/mcp
- HTTP API：https://devmesh.xyun.dev/reference/http

## 快速开始

```bash
npm install -g devmesh@alpha
dmx init
```

`dmx init` 会扫描本机已安装的 Codex、Claude Code 和 opencode，并把它们配置为启动 DevMesh 的 stdio MCP launcher。之后你在项目里打开 AI 编程工具时，DevMesh 会按项目读取或创建 `.dev-mesh/`，并通过 MCP 工具提醒助手在合适的时候沉淀知识。

常用检查命令：

```bash
dmx status
dmx doctor
dmx search "release workflow"
```

加入团队共享 Hub：

```bash
dmx join https://your-devmesh-hub.example.com \
  --group frontend \
  --name Alice \
  --token <invite-token>
```

## 工作方式

DevMesh 使用“前台 MCP launcher 按需拉起项目 daemon”的模式：

- MCP host 只需要运行标准命令 `dmx serve --mcp`。
- launcher 会优先复用当前项目的后台 daemon；没有 daemon 时自动启动。
- 冷启动时 launcher 先响应 MCP 初始化和工具列表，避免 AI 工具等待超时。
- 知识沉淀由 AI 助手根据当前对话、代码阅读、编辑和命令结果自主判断，再调用 DevMesh MCP 工具写入。
- DevMesh 不依赖后台 Git 或文件系统轮询来强行分析项目。

## 会保存什么

适合随仓库共享的知识：

- `.dev-mesh/knowledge/extract/entries.jsonl`
- `.dev-mesh/knowledge/canonical/entries.jsonl`
- `.dev-mesh/knowledge/para/index.json`
- `.dev-mesh/knowledge/edges.jsonl`

不会进入仓库的本机运行态：

- `.dev-mesh/daemon.json`
- `.dev-mesh/daemon.pid`
- `.dev-mesh/events/`
- `.dev-mesh/index/`
- `.dev-mesh/sync/`
- `.dev-mesh/queue/`
- `.dev-mesh/secrets/`
- `.dev-mesh/knowledge/raw/`
- `.dev-mesh/knowledge/ratings/`
- `.dev-mesh/knowledge/usage/`

这意味着别人 clone 一个带有 DevMesh 知识的项目后，本地 DevMesh 会加载项目里的共享知识；索引、daemon 状态、同步游标和敏感运行态会在对方机器上重新生成。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `dmx init` | 初始化本机 MCP host 配置，或初始化当前项目。 |
| `dmx join <server>` | 加入团队 Hub group，启用可选同步。 |
| `dmx status` | 查看版本、项目 store、daemon 和知识数量。 |
| `dmx doctor` | 检查本地 store、隐私、同步、daemon 和 MCP host 配置。 |
| `dmx capture` | 手动写入一条知识，或放入 review inbox。 |
| `dmx search <query>` | 搜索当前项目知识。 |
| `dmx knowledge get/list/update/delete` | 查看和维护知识条目。 |
| `dmx graph explore` | 探索知识图谱关系。 |
| `dmx visualize` | 生成并打开本地知识图谱页面。 |
| `dmx serve --mcp` | stdio MCP launcher，通常由 AI 工具启动。 |
| `dmx proxy` | 启动本地 Streamable HTTP MCP proxy，主要用于调试。 |

完整命令见 [CLI 参考](https://devmesh.xyun.dev/reference/cli)。

## 接口

DevMesh 暴露两类接口：

- MCP tools：供 Codex、Claude Code、opencode 等工具读取、沉淀、维护和关联项目知识。
- Hub HTTP API：供团队同步、管理后台、邀请、项目 ACL、知识图谱和审计使用。

文档入口：

- [MCP 工具](https://devmesh.xyun.dev/reference/mcp)
- [HTTP API](https://devmesh.xyun.dev/reference/http)
- [环境变量](https://devmesh.xyun.dev/reference/env)
- [部署指南](https://devmesh.xyun.dev/deployment)

## 项目进度

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 筹划 | 已完成 | 完成产品方向、技术路线和本地优先设计。 |
| 立项准备 | 进行中 | 正在整理 README、协议、行为准则和提交材料。 |
| Alpha 内测 | 进行中 | CLI 已发布到 npm，官网和核心文档已上线。 |
| Beta 公测 | 未开始 | 计划在安装体验、Hub 部署和文档稳定后推进。 |

## 项目团队

| 角色 | 成员 | 联系方式 |
| --- | --- | --- |
| 项目负责人 | `@xy200303` | GitHub: https://github.com/xy200303 |
| 项目主页 | DevMesh | Website: https://devmesh.xyun.dev/ |

如果后续有固定维护者或共创成员，建议继续在这里补充。

## 本地开发

```bash
pnpm install
pnpm typecheck
pnpm test:unit
pnpm build
```

完整发布检查：

```bash
pnpm release:check
```

开发入口：

```bash
pnpm dev:server
pnpm dev:admin
pnpm dev:website
pnpm dev:client -- --help
```

仓库结构：

```text
apps/
  dmx/          # npm CLI, installs the dmx command
  mesh-server/  # Hub Server entrypoint
  web-admin/    # Vue admin console
  website/      # VitePress website
packages/
  core/         # domain model and knowledge service
  client/       # local runtime, launcher, daemon, CLI support
  local-store/  # .dev-mesh JSONL store and indexes
  server/       # Hub HTTP API and MCP endpoint
  mcp-contracts/# MCP tool schemas and formatting
```

贡献前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。发布流程见 [docs/release.md](./docs/release.md)。

## 如何贡献

- 阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发环境、提交规范和 `.dev-mesh` 知识提交边界
- 提交 PR 前至少运行 `pnpm typecheck`、`pnpm test:unit` 和 `pnpm build`
- 涉及命令、接口、环境变量或知识目录行为的改动，请同步更新文档
- 如果本轮工作产生了稳定项目知识，建议用 DevMesh 沉淀并单独提交

## 开源协议

本项目代码采用 [MIT License](./LICENSE)。

文档、网站和社区协作规范会继续按 Datawhale 开源社区要求完善。

## 安全和隐私

- 默认不上传原始对话全文。
- 默认使用本地 `.dev-mesh/`，未执行 `dmx join` 时不连接团队 Hub。
- `.dev-mesh/secrets/`、`.env`、`*.pem`、`*.key` 和凭据文件不应提交。
- 高风险知识应进入 review inbox，确认后再发布到项目知识库。

## 当前状态

DevMesh 当前处于 alpha 阶段，CLI 已发布到 npm，网站和核心文档位于 [devmesh.xyun.dev](https://devmesh.xyun.dev/)。接口和存储格式会继续演进，生产部署前请结合自己的认证、密钥管理、备份和监控策略进行评估。

## Datawhale 计划

DevMesh 正在准备提交到 Datawhale DOPMC。当前仓库已经补齐双语 README、贡献指南、PR 模板、MIT 协议和行为准则适配文件，GitHub 仓库也已调整为符合 Datawhale 要求的小写形式 `dev-mesh`；接下来主要是按 DOPMC 的立项流程正式提交申请。
