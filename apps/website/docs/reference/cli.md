---
id: cli
title: CLI 参考
---

# CLI 参考

开发模式下可以通过 workspace filter 运行 CLI：

```powershell
pnpm --filter mcp-dev-mesh dev -- <command>
```

## 项目初始化

```powershell
pnpm --filter mcp-dev-mesh dev -- init --root C:\path\to\project --name local
```

## 全局客户端配置

```powershell
pnpm --filter mcp-dev-mesh dev -- init --global --tools codex,claude,opencode --yes
```

`dmx init` 会使用 Clack 风格的交互选择器，并把支持的 MCP host 配置为运行等价于 `dmx serve --mcp` 的 stdio launcher。生产安装场景会尽量直接使用当前 Node 可执行文件和解析后的 CLI 入口，避免经过 npm shell shim。真实终端中初始化完成后会继续显示 TUI 结果摘要；CI、管道重定向或 `--json` 会输出结构化 JSON。默认配置不固化 `--root`，让 MCP host 在当前项目目录启动 launcher；前台 launcher 会按项目拉起共享 daemon。daemon 会在 `auto_capture` 开启时后台采集 Git / filesystem 开发信号，并通过 `mesh_list_development_signals` 交给 Codex、Claude Code 或 opencode 自己总结知识。执行 `dmx join` 后，daemon 会在 `auto_sync` 开启时自动与 Hub push/pull，并把远端可回放知识写入本地 `.dev-mesh/knowledge/` 供搜索使用。

## 加入 Hub

```powershell
pnpm --filter mcp-dev-mesh dev -- join http://127.0.0.1:8721 --root C:\path\to\project --group default --name local --token devmesh-local-invite
```

## 本地 MCP launcher

```powershell
pnpm --filter mcp-dev-mesh dev -- serve --mcp --root C:\path\to\project --name local
```

上面的 `--root` 适合手动调试；`dmx init` 写入全局 MCP host 配置时默认不会带 `--root`。

常用调试参数：

```powershell
pnpm --filter mcp-dev-mesh dev -- serve --mcp --root C:\path\to\project --global-root C:\path\to\dev-mesh-home --daemon-sync-interval-ms 5000 --daemon-capture-interval-ms 5000
```

## HTTP MCP proxy 调试

```powershell
pnpm --filter mcp-dev-mesh dev -- proxy --root C:\path\to\project --name local --port 8722
```

## 写入和检索

```powershell
pnpm --filter mcp-dev-mesh dev -- capture --root C:\path\to\project --name local --title "Decision" --summary "Persist project knowledge." --type decision --layer canonical --tag smoke
pnpm --filter mcp-dev-mesh dev -- search --root C:\path\to\project --query "project knowledge"
```

## 诊断

```powershell
pnpm --filter mcp-dev-mesh dev -- status --root C:\path\to\project
pnpm --filter mcp-dev-mesh dev -- doctor --root C:\path\to\project
pnpm --filter mcp-dev-mesh dev -- inbox --root C:\path\to\project
```

`dmx doctor` 在真实终端中会用 Clack TUI 按 store、privacy、auto capture、sync、launcher/daemon 和 MCP hosts 分组显示检测结果与修复建议。脚本场景使用 `dmx doctor --json`。
