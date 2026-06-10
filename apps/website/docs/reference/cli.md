---
id: cli
title: CLI 参考
---

# CLI 参考

开发模式下可以通过 workspace filter 运行 CLI：

```powershell
pnpm --filter devmesh dev -- <command>
```

## 项目初始化

```powershell
pnpm --filter devmesh dev -- init --root C:\path\to\project --name local
```

## 全局客户端配置

```powershell
pnpm --filter devmesh dev -- init --global --tools codex,claude,opencode --yes
```

`dmx init` 会使用 Clack 风格的交互选择器，并把支持的 MCP host 配置为运行等价于 `dmx serve --mcp` 的 stdio launcher。生产安装场景会尽量直接使用当前 Node 可执行文件和解析后的 CLI 入口，避免经过 npm shell shim。真实终端中初始化完成后会继续显示 TUI 结果摘要；CI、管道重定向或 `--json` 会输出结构化 JSON。默认配置不固化 `--root`，让 MCP host 在当前项目目录启动 launcher；前台 launcher 会按项目拉起共享 daemon。Codex、Claude Code 或 opencode 根据 MCP server instructions 和工具强提示，结合当前对话、代码上下文、编辑和命令结果自主判断是否调用 capture 工具，daemon 不再为 capture 后台轮询 Git / filesystem。执行 `dmx join` 后，daemon 会在 `auto_sync` 开启时自动与 Hub push/pull，并把远端可回放知识写入本地 `.dev-mesh/knowledge/` 供搜索使用。

## 加入 Hub

```powershell
pnpm --filter devmesh dev -- join http://127.0.0.1:8721 --root C:\path\to\project --group default --name local --token devmesh-local-invite
```

## 本地 MCP launcher

```powershell
pnpm --filter devmesh dev -- serve --mcp --root C:\path\to\project --name local
```

上面的 `--root` 适合手动调试；`dmx init` 写入全局 MCP host 配置时默认不会带 `--root`。

常用调试参数：

```powershell
pnpm --filter devmesh dev -- serve --mcp --root C:\path\to\project --global-root C:\path\to\dev-mesh-home --daemon-sync-interval-ms 5000
```

## HTTP MCP proxy 调试

```powershell
pnpm --filter devmesh dev -- proxy --root C:\path\to\project --name local --port 8722
```

本地 stdio launcher 和 HTTP proxy 暴露同一套核心 MCP tools：`mesh_get_status`、`mesh_search_context`、`mesh_get_knowledge`、`mesh_list_knowledge`、`mesh_capture_knowledge`、`mesh_update_knowledge`、`mesh_delete_knowledge`、`mesh_capture_task`、`mesh_rate_knowledge`、`mesh_link_knowledge`、`mesh_resolve_term`、`mesh_scan_project_knowledge` 和 `mesh_explore_knowledge_graph`。

## 写入和检索

```powershell
pnpm --filter devmesh dev -- capture --root C:\path\to\project --name local --title "Decision" --summary "Persist project knowledge." --type decision --layer canonical --tag smoke
pnpm --filter devmesh dev -- search --root C:\path\to\project --query "project knowledge"
pnpm --filter devmesh dev -- graph explore --root C:\path\to\project --query "project knowledge" --depth 2
pnpm --filter devmesh dev -- graph edge add --root C:\path\to\project --kind supersedes --from <new-id> --to <old-id> --reason "New decision replaces the old one"
pnpm --filter devmesh dev -- graph edge list --root C:\path\to\project --kind supersedes
pnpm --filter devmesh dev -- visualize --root C:\path\to\project --query "project knowledge"
```

`dmx graph edge add` 会把本地已确认的语义关系写入 `.dev-mesh/knowledge/edges.jsonl`；`supersedes` 会把被替代条目标记为 superseded。`visualize` 会生成一个基于 Cytoscape.js COSE force layout 的本地交互 HTML 图谱，打开时会以引力/斥力动画收敛，默认输出到 `.dev-mesh/visualizations/graph.html`；语义边会用方向、颜色和标签区分 `supersedes`、`duplicates`、`contradicts`。

## 诊断

```powershell
pnpm --filter devmesh dev -- status --root C:\path\to\project
pnpm --filter devmesh dev -- doctor --root C:\path\to\project
pnpm --filter devmesh dev -- inbox --root C:\path\to\project
```

`dmx doctor` 在真实终端中会用 Clack TUI 按 store、privacy、assistant-led capture、sync、launcher/daemon 和 MCP hosts 分组显示检测结果与修复建议。脚本场景使用 `dmx doctor --json`。
