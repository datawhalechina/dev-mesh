---
id: cli
title: CLI 参考
---

# CLI 参考

安装发布版 CLI：

```bash
npm install -g devmesh@alpha
dmx --version
dmx --help
```

默认输出是给人看的纯文本。脚本集成时，支持 `--json` 的命令可以改为结构化 JSON。

## 命令总览

| 命令 | 用途 |
| --- | --- |
| `dmx init` | 初始化全局 MCP host 配置，或初始化当前项目的 `.dev-mesh`。 |
| `dmx join <server>` | 加入远端 Hub 团队组，写入同步身份和访问令牌。 |
| `dmx status` | 查看本地运行状态、版本、项目 store、daemon 和知识计数。 |
| `dmx doctor` | 检查 store、隐私、沉淀、同步、launcher/daemon 和 MCP host 配置。 |
| `dmx serve --mcp` | 标准 stdio MCP launcher；由 Codex、Claude Code、opencode 等 MCP host 启动。 |
| `dmx proxy` | 启动本地 streamable HTTP MCP proxy，主要用于调试。 |
| `dmx capture` | 手动写入一条知识，或先放入 review inbox。 |
| `dmx search <query>` | 搜索项目知识。 |
| `dmx knowledge get <id>` | 读取一条知识的当前记录。 |
| `dmx knowledge list` | 按 layer、type、tag、PARA、作者等过滤知识。 |
| `dmx knowledge update <id>` | 更新一条知识的标题、摘要、内容、标签、质量分等字段。 |
| `dmx knowledge delete <id>` | tombstone 一条知识，让普通搜索不再返回它。 |
| `dmx rate <id>` | 给知识应用评分、采纳度、置信度或权重反馈。 |
| `dmx inbox [action] [id]` | 查看、接受或拒绝待审查知识候选。 |
| `dmx index rebuild` | 重建本地搜索索引和图谱索引。 |
| `dmx graph explore` | 探索知识图谱中的节点和边。 |
| `dmx graph edge list` | 列出语义知识边。 |
| `dmx graph edge add` | 创建 `supersedes`、`duplicates` 或 `contradicts` 语义边。 |
| `dmx graph visualize` | 生成本地交互式知识图谱 HTML。 |
| `dmx visualize` | `dmx graph visualize` 的顶层快捷命令。 |

## 初始化和运行

### `dmx init`

```bash
dmx init
dmx init --project
dmx init --global --tool codex --tool claude --scope user
```

| 参数 | 说明 |
| --- | --- |
| `--global` | 初始化全局 DevMesh 配置。 |
| `--project` | 初始化当前项目的 `.dev-mesh`。 |
| `--root <path>` | 指定项目根目录。未搭配 `--global` 时，显式传入会按项目初始化；搭配 `--global` 时，会把 MCP launcher 固定到该项目根。 |
| `--name <displayName>` | 成员显示名，默认 `local`。 |
| `--mcp-url <url>` | 本地 MCP proxy URL，默认 `http://127.0.0.1:8722/mcp`。 |
| `--yes` | 使用默认值，不进入交互选择。 |
| `--json` | 输出 JSON。 |
| `--tool <tool>` | 要配置的 MCP host，可重复。支持 `codex`、`claude`、`opencode`。 |
| `--tools <tools>` | 逗号分隔 MCP host。 |
| `--scope <scope>` | MCP host 配置范围：`user` 或 `project`。 |

`dmx init` 默认是全局初始化：扫描本机安装的 MCP host，配置它们运行 `dmx serve --mcp`。`dmx serve --mcp` 是前台 stdio launcher，会按项目拉起或复用后台共享 daemon。`--global` 和 `--project` 表示互斥的初始化模式，不能同时使用。

### `dmx join <server>`

```bash
dmx join https://your-devmesh-hub.example.com --branch default --name Alice --token <invite-token>
```

| 参数 | 说明 |
| --- | --- |
| `<server>` | Hub Server URL、IP 或 `host:port`。 |
| `--branch <branch>` | 团队 branch。 |
| `--name <displayName>` | 成员显示名。 |
| `--handle <handle>` | 可选成员 handle。 |
| `--token <inviteToken>` | 邀请 token。 |
| `--yes` | 非交互确认。 |
| `--json` | 输出 JSON。 |

加入后，本地 daemon 会在 `auto_sync` 开启时自动向 Hub push/pull 事件，并把远端可回放知识写回项目 `.dev-mesh/knowledge/`。

### `dmx status`

```bash
dmx status
dmx status --root <project-root> --json
```

| 参数 | 说明 |
| --- | --- |
| `--root <path>` | 项目根目录，默认当前目录。 |
| `--name <displayName>` | 成员显示名，默认 `local`。 |
| `--json` | 输出 JSON。 |

### `dmx doctor`

```bash
dmx doctor
dmx doctor --root <project-root> --mcp-url http://127.0.0.1:8722/mcp
```

| 参数 | 说明 |
| --- | --- |
| `--root <path>` | 项目根目录。 |
| `--global-root <path>` | 全局 DevMesh 根目录。 |
| `--mcp-url <url>` | 要检查的本地 MCP proxy URL。 |
| `--json` | 输出 JSON。 |

真实终端中会用 TUI 分组展示；CI、管道或 `--json` 会输出 JSON。

### `dmx serve --mcp`

```bash
dmx serve --mcp
dmx serve --mcp --root <project-root> --name local
```

| 参数 | 说明 |
| --- | --- |
| `--mcp` | 必填，启动 stdio MCP launcher。 |
| `--root <path>` | 项目根目录。 |
| `--name <displayName>` | 成员显示名。 |
| `--global-root <path>` | 全局 DevMesh 根目录。 |
| `--daemon-idle-ms <number>` | daemon 空闲退出时间。 |
| `--daemon-sync-interval-ms <number>` | daemon 自动同步间隔。 |

MCP host 只需要启动这个命令。launcher 会快速响应 `initialize` 和 `tools/list`，随后转发 tool call 到项目 daemon；daemon 不可用时降级到本进程执行。

### `dmx proxy`

```bash
dmx proxy --port 8722
dmx proxy --host 127.0.0.1 --port 8722 --root <project-root>
```

| 参数 | 说明 |
| --- | --- |
| `--host <host>` | 监听地址，默认 `127.0.0.1`。 |
| `--port <number>` | 监听端口，默认 `8722`。 |
| `--root <path>` | 项目根目录。 |
| `--name <displayName>` | 成员显示名。 |

本地 proxy 暴露 `GET /healthz` 和 `ALL /mcp`，主要用于调试 streamable HTTP MCP。

## 知识写入和检索

### `dmx capture`

```bash
dmx capture --title "Release note" --summary "Published a new alpha." --type release --tag npm
dmx capture --title "Risk" --summary "Needs review." --review --reason "Check wording"
```

| 参数 | 说明 |
| --- | --- |
| `--title <title>` | 知识标题，必填。 |
| `--summary <summary>` | 短摘要，必填。 |
| `--type <type>` | 知识类型，默认 `note`。 |
| `--content <content>` | 长正文。 |
| `--layer <layer>` | `raw`、`extract` 或 `canonical`，默认 `extract`。 |
| `--visibility <visibility>` | `private`、`project`、`team` 或 `org`，默认 `project`。 |
| `--para <category:key>` | PARA 位置，例如 `projects:DevMesh`。 |
| `--tag <tag...>` | 标签。 |
| `--review` | 先进入 review inbox，不直接发布。 |
| `--reason <reason>` | review 原因。 |
| `--root <path>` | 项目根目录。 |
| `--name <displayName>` | 成员显示名。 |
| `--json` | 输出 JSON。 |

### `dmx search <query>`

```bash
dmx search "release workflow" --limit 5
```

| 参数 | 说明 |
| --- | --- |
| `<query>` | 搜索词，必填。 |
| `--limit <n>` | 返回数量，默认 `8`。 |
| `--root <path>` | 项目根目录。 |
| `--json` | 输出 JSON。 |

### `dmx knowledge get <id>`

```bash
dmx knowledge get <knowledge-id>
```

| 参数 | 说明 |
| --- | --- |
| `<id>` | 知识 ID。 |
| `--root <path>` | 项目根目录。 |
| `--json` | 输出 JSON。 |

### `dmx knowledge list`

```bash
dmx knowledge list --layer canonical --type decision --tag release --limit 20
```

| 参数 | 说明 |
| --- | --- |
| `--layer <layer>` | layer 过滤，可重复。 |
| `--type <type>` | type 过滤，可重复。 |
| `--tag <tag>` | tag 过滤，可重复。 |
| `--para <category:key>` | PARA 前缀过滤。 |
| `--author <name>` | 作者显示名、handle 或 member id。 |
| `--include-superseded` | 包含 superseded 和 tombstone 条目。 |
| `--recency-days <n>` | 只看最近 n 天更新的条目。 |
| `--limit <n>` | 返回数量，默认 `20`。 |
| `--root <path>` | 项目根目录。 |
| `--json` | 输出 JSON。 |

### `dmx knowledge update <id>`

```bash
dmx knowledge update <knowledge-id> --summary "New summary" --tag release --reason "Refresh after publish"
```

| 参数 | 说明 |
| --- | --- |
| `<id>` | 知识 ID。 |
| `--title <title>` | 新标题。 |
| `--summary <summary>` | 新摘要。 |
| `--content <content>` | 新正文。 |
| `--clear-content` | 清空正文。 |
| `--type <type>` | 新类型。 |
| `--layer <layer>` | 新 layer。 |
| `--visibility <visibility>` | 新可见性。 |
| `--status <status>` | `active`、`superseded` 或 `tombstone`。 |
| `--para <category:key>` | 新 PARA 位置。 |
| `--tag <tag>` | 替换标签列表，可重复。 |
| `--confidence <score>` | 置信度，0 到 1。 |
| `--weight <weight>` | 排名权重。 |
| `--reason <reason>` | 更新原因。 |
| `--root <path>` | 项目根目录。 |
| `--name <displayName>` | 成员显示名。 |
| `--json` | 输出 JSON。 |

### `dmx knowledge delete <id>`

```bash
dmx knowledge delete <knowledge-id> --reason "Superseded"
```

| 参数 | 说明 |
| --- | --- |
| `<id>` | 知识 ID。 |
| `--reason <reason>` | 删除原因。 |
| `--root <path>` | 项目根目录。 |
| `--name <displayName>` | 成员显示名。 |
| `--json` | 输出 JSON。 |

### `dmx rate <id>`

```bash
dmx rate <knowledge-id> --rating 0.9 --adoption-delta 0.1 --reason "Used successfully"
```

| 参数 | 说明 |
| --- | --- |
| `<id>` | 知识 ID。 |
| `--rating <score>` | 显式评分，0 到 1。 |
| `--adoption-delta <delta>` | 采纳分增量，-1 到 1。 |
| `--confidence-delta <delta>` | 置信度增量，-1 到 1。 |
| `--weight-delta <delta>` | 权重增量。 |
| `--reason <reason>` | 反馈原因。 |
| `--root <path>` | 项目根目录。 |
| `--name <displayName>` | 成员显示名。 |
| `--json` | 输出 JSON。 |

## Review、索引和图谱

### `dmx inbox [action] [id]`

```bash
dmx inbox
dmx inbox accept <queue-id>
dmx inbox reject <queue-id> --reason "Not durable"
```

| 参数 | 说明 |
| --- | --- |
| `[action]` | `list`、`accept` 或 `reject`，默认 `list`。 |
| `[id]` | review queue item id。 |
| `--root <path>` | 项目根目录。 |
| `--reason <reason>` | 拒绝原因。 |
| `--json` | 输出 JSON。 |

### `dmx index rebuild`

```bash
dmx index rebuild
```

| 参数 | 说明 |
| --- | --- |
| `--root <path>` | 项目根目录。 |
| `--json` | 输出 JSON。 |

### `dmx graph explore`

```bash
dmx graph explore --query "release" --depth 2 --limit 40
```

| 参数 | 说明 |
| --- | --- |
| `--root <path>` | 项目根目录。 |
| `--query <query>` | 搜索并选择图谱种子节点。 |
| `--id <id>` | 知识 ID 种子，可重复。 |
| `--depth <n>` | 关系深度，默认 `2`。 |
| `--limit <n>` | 最大节点数，默认 `40`。 |
| `--node-kind <kind>` | 节点类型过滤，可重复。 |
| `--edge-kind <kind>` | 边类型过滤，可重复。 |
| `--json` | 输出 JSON。 |

节点类型：`knowledge`、`para`、`type`、`tag`、`member`、`source`。

边类型：`authored_by`、`belongs_to_para`、`has_type`、`parent_para`、`sourced_from`、`tagged_with`、`supersedes`、`duplicates`、`contradicts`。

### `dmx graph edge list`

```bash
dmx graph edge list --kind supersedes
```

| 参数 | 说明 |
| --- | --- |
| `--root <path>` | 项目根目录。 |
| `--kind <kind>` | `supersedes`、`duplicates` 或 `contradicts`。 |
| `--from <id>` | source 知识 ID。 |
| `--to <id>` | target 知识 ID。 |
| `--json` | 输出 JSON。 |

### `dmx graph edge add`

```bash
dmx graph edge add --kind supersedes --from <new-id> --to <old-id> --reason "New decision replaces the old one"
```

| 参数 | 说明 |
| --- | --- |
| `--kind <kind>` | 必填，`supersedes`、`duplicates` 或 `contradicts`。 |
| `--from <id>` | 必填，source 知识 ID。 |
| `--to <id>` | 必填，target 知识 ID。 |
| `--reason <reason>` | 关系说明。 |
| `--root <path>` | 项目根目录。 |
| `--name <displayName>` | 成员显示名。 |
| `--json` | 输出 JSON。 |

### `dmx graph visualize` / `dmx visualize`

```bash
dmx visualize --query "release"
dmx graph visualize --id <knowledge-id> --depth 3 --output .dev-mesh/visualizations/release.html
```

| 参数 | 说明 |
| --- | --- |
| `--root <path>` | 项目根目录。 |
| `--query <query>` | 搜索并选择图谱种子节点。 |
| `--id <id>` | 知识 ID 种子，可重复。 |
| `--depth <n>` | 关系深度，默认 `2`。 |
| `--limit <n>` | 最大节点数，默认 `80`。 |
| `--node-kind <kind>` | 节点类型过滤，可重复。 |
| `--edge-kind <kind>` | 边类型过滤，可重复。 |
| `--output <path>` | HTML 输出路径。 |
| `--no-open` | 只生成文件，不自动打开浏览器。 |

可视化使用 Cytoscape.js 的 COSE force layout，默认输出到 `.dev-mesh/visualizations/graph.html`。

## MCP host 行为

`dmx init` 写入的 MCP host 配置会启动 `dmx serve --mcp`。Codex、Claude Code 或 opencode 会看到 [MCP 工具](/reference/mcp) 里的强提示，并由工具自身结合当前对话、代码阅读、编辑和命令结果决定何时调用 `mesh_capture_knowledge` 或 `mesh_capture_task`。DevMesh 不依赖后台扫描 Git 或文件变更来强行沉淀知识。
