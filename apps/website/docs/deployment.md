---
id: deployment
title: 部署
---

# 部署

普通用户只需要安装 `devmesh` CLI；只有团队需要共享 Hub、管理成员和跨项目同步时，才需要部署服务端。

```powershell
npm install -g devmesh@alpha
```

服务端可以通过 CLI 参数、系统环境变量或 env 文件配置。当前优先级为：

```text
CLI 参数 > process env > env file
```

## 最小 env 文件

创建 `mesh-server.env`：

```dotenv
DEV_MESH_HOST=127.0.0.1
DEV_MESH_PORT=8721
DEV_MESH_BASE_URL=http://127.0.0.1:8721
DEV_MESH_HUB_STATE_PATH=.dev-mesh-server/hub-state.json
```

启动：

```powershell
pnpm --filter @devmesh/mesh-server dev -- --env-file .\mesh-server.env
```

构建后启动：

```powershell
pnpm build
node .\apps\mesh-server\dist\index.js --env-file .\mesh-server.env
```

## PostgreSQL

如果配置了 `DEV_MESH_POSTGRES_URL`，服务端会使用 PostgreSQL 知识仓库：

```dotenv
DEV_MESH_POSTGRES_URL=postgres://devmesh:devmesh@127.0.0.1:5432/devmesh
DEV_MESH_POSTGRES_KNOWLEDGE_TABLE=dev_mesh_knowledge
DEV_MESH_POSTGRES_HUB_STATE_TABLE=dev_mesh_hub_state
```

当设置了 `DEV_MESH_POSTGRES_URL` 且没有设置 `DEV_MESH_HUB_STATE_PATH` 时，Hub 状态会使用 PostgreSQL 持久化。显式设置 `DEV_MESH_HUB_STATE_PATH` 时，Hub 状态会继续使用 JSON 文件。

## 管理后台

管理后台是独立的 Vite 应用：

```powershell
pnpm dev:admin
```

生产部署时先构建整个 workspace：

```powershell
pnpm build
```

然后按实际部署平台托管 `apps/web-admin/dist` 和官网 `apps/website/docs/.vitepress/dist`。
