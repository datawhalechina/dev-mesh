---
id: getting-started
title: 快速开始
---

# 快速开始

下面的流程会启动 Hub Server、初始化一个目标项目、启动本地 MCP proxy，并用手动 capture 命令验证知识是否写入项目。

## 准备

在仓库根目录安装依赖并构建：

```powershell
cd C:\Users\34834\Desktop\projectM\TS\mcp-context-mesh
pnpm install
pnpm build
```

## 启动服务端

开发模式：

```powershell
pnpm --filter @mcp-dev-mesh/mesh-server dev -- --host 127.0.0.1 --port 8721
```

如果已经准备了 env 文件：

```powershell
pnpm --filter @mcp-dev-mesh/mesh-server dev -- --env-file .\mesh-server.env
```

生产构建后也可以直接运行：

```powershell
node .\apps\mesh-server\dist\index.js --env-file .\mesh-server.env
```

## 初始化目标项目

把 `$project` 换成你要沉淀知识的项目路径：

```powershell
$project="C:\path\to\your\project"

pnpm --filter mcp-dev-mesh dev -- init --root $project --name local
pnpm --filter mcp-dev-mesh dev -- join http://127.0.0.1:8721 --root $project --group default --name local --token devmesh-local-invite
```

执行后目标项目会出现 `.dev-mesh` 目录。

## 启动本地 MCP proxy

保持服务端运行，再打开一个终端：

```powershell
$project="C:\path\to\your\project"

pnpm --filter mcp-dev-mesh dev -- proxy --root $project --name local --port 8722
```

proxy 默认暴露在：

```text
http://127.0.0.1:8722/mcp
```

## 配置 AI 客户端

全局配置 Codex、Claude Code 和 opencode 指向本地 proxy：

```powershell
pnpm --filter mcp-dev-mesh dev -- init --global --tools codex,claude,opencode --mcp-url http://127.0.0.1:8722/mcp --yes
```

之后在目标项目里让 AI 助手沉淀知识，它就可以通过 MCP 工具写入 `.dev-mesh`。

## Smoke test

先用 CLI 手动写一条知识：

```powershell
pnpm --filter mcp-dev-mesh dev -- capture --root $project --name local --title "Smoke test knowledge" --summary "Dev Mesh can persist project knowledge." --type decision --layer canonical --tag smoke
```

再搜索验证：

```powershell
pnpm --filter mcp-dev-mesh dev -- search --root $project --query "Dev Mesh"
pnpm --filter mcp-dev-mesh dev -- status --root $project
pnpm --filter mcp-dev-mesh dev -- doctor --root $project
```

如果搜索有结果，并且 `.dev-mesh/knowledge` 或 `.dev-mesh/events` 中有新文件，就说明本地沉淀链路已经跑通。
