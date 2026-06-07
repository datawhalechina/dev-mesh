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
pnpm --filter mcp-dev-mesh dev -- init --global --tools codex,claude,opencode --mcp-url http://127.0.0.1:8722/mcp --yes
```

## 加入 Hub

```powershell
pnpm --filter mcp-dev-mesh dev -- join http://127.0.0.1:8721 --root C:\path\to\project --group default --name local --token devmesh-local-invite
```

## 本地 MCP proxy

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
