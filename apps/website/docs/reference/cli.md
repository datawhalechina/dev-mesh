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

`dmx init` 会把支持的 MCP host 配置为运行 `dmx serve --mcp`。默认配置不固化 `--root`，让 MCP host 在当前项目目录启动 launcher；前台 launcher 会按项目拉起共享 daemon。执行 `dmx join` 后，daemon 会在 `auto_sync` 开启时自动与 Hub push/pull，并把远端可回放知识写入本地 `.dev-mesh/knowledge/` 供搜索使用。

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
pnpm --filter mcp-dev-mesh dev -- serve --mcp --root C:\path\to\project --global-root C:\path\to\dev-mesh-home --daemon-sync-interval-ms 5000
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
