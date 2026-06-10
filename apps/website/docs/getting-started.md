---
id: getting-started
title: 快速开始
---

# 快速开始

下面的流程使用已经发布到 npm 的 DevMesh CLI。你不需要 clone 仓库，也不需要先启动 Hub Server；先在本机把 MCP host 配好，打开项目后让 AI 助手按需沉淀知识即可。

## 安装

DevMesh 当前以 alpha 版本发布：

```powershell
npm install -g devmesh@alpha
dmx --version
```

CLI 包安装后会提供 `dmx` 命令。建议使用 Node.js 22 或更高版本。

## 配置 AI 客户端

在终端运行：

```powershell
dmx init
```

`dmx init` 会扫描本机已安装的 Codex、Claude Code 和 opencode，用 TUI 让你选择要配置的工具，并写入等价于 `dmx serve --mcp` 的 stdio MCP launcher。之后这些 AI 客户端打开项目时，会按需启动项目级共享 daemon。

## 初始化项目

进入你正在开发的项目目录：

```powershell
cd C:\path\to\your-project
dmx init --project
```

执行后项目里会出现 `.dev-mesh` 目录。这个目录保存本地知识、事件、图谱关系和可视化产物。

## 检查状态

```powershell
dmx status
dmx doctor
```

`dmx doctor` 会用 TUI 分组显示 store、privacy、assistant-led capture、sync、launcher/daemon 和 MCP host 配置状态。

## 让 AI 自动沉淀

重新打开 Codex、Claude Code 或 opencode，并在目标项目里开发。DevMesh 的 MCP instructions 会提示 AI 客户端在有意义的编码、调试、评审、设计、部署、发布或文档工作结束前，主动判断是否需要调用 `mesh_capture_knowledge` 或 `mesh_capture_task`。

你也可以直接对 AI 助手说：

```text
请把这次实现里的长期项目知识沉淀到 DevMesh，包括关键决策、约定和后续注意事项。
```

DevMesh 不依赖后台扫描 Git 或文件变化来猜测知识；总结动作由 AI 客户端结合当前对话、代码上下文、编辑和命令结果自主触发。

## 手动验证

可以先用 CLI 写入一条测试知识：

```powershell
dmx capture --title "Smoke test knowledge" --summary "DevMesh can persist project knowledge." --type decision --layer canonical --tag smoke
```

再搜索验证：

```powershell
dmx search "DevMesh"
dmx status
```

如果搜索有结果，并且 `.dev-mesh/knowledge` 或 `.dev-mesh/events` 中有新文件，就说明本地沉淀链路已经跑通。

## 团队同步

本地使用不需要 Hub Server。团队要共享知识时，再让管理员部署 Hub Server，并用邀请链接加入：

```powershell
dmx join https://your-devmesh-hub.example.com --group default --name local --token <invite-token>
```

加入后，项目 daemon 会在 `auto_sync` 开启时自动 push / pull，把远端知识回放到本地 `.dev-mesh/knowledge/`，供搜索和图谱探索使用。
