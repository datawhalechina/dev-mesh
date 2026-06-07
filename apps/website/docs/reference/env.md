---
id: env
title: 环境变量
---

# 环境变量

服务端支持通过 env 文件配置。命令行传入 `--env-file` 后，配置会按如下优先级合并：

```text
CLI 参数 > process env > env file
```

## 服务端

| 变量 | 说明 |
| --- | --- |
| `DEV_MESH_HOST` | 服务监听地址 |
| `DEV_MESH_PORT` | 服务监听端口 |
| `DEV_MESH_BASE_URL` | 客户端和管理后台使用的服务端基础 URL |
| `DEV_MESH_PROJECT_ROOT` | 默认项目根目录 |
| `DEV_MESH_HUB_STATE_PATH` | JSON Hub 状态文件路径 |
| `DEV_MESH_POSTGRES_URL` | PostgreSQL 连接串 |
| `DEV_MESH_POSTGRES_KNOWLEDGE_TABLE` | PostgreSQL 知识表 |
| `DEV_MESH_POSTGRES_HUB_STATE_TABLE` | PostgreSQL Hub 状态表 |
| `DEV_MESH_LOGGER` | 日志模式 |

## 示例

```dotenv
DEV_MESH_HOST=0.0.0.0
DEV_MESH_PORT=8721
DEV_MESH_BASE_URL=https://devmesh.example.com
DEV_MESH_POSTGRES_URL=postgres://devmesh:devmesh@postgres:5432/devmesh
DEV_MESH_POSTGRES_KNOWLEDGE_TABLE=dev_mesh_knowledge
DEV_MESH_POSTGRES_HUB_STATE_TABLE=dev_mesh_hub_state
```
