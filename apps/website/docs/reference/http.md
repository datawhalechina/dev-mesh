---
id: http
title: HTTP API
---

# HTTP API

Hub Server 提供团队同步和管理接口。本地调试 proxy 只提供 `/healthz` 和 `/mcp`；完整团队接口由 Hub Server 提供。

默认 Hub 监听地址由部署配置决定，示例使用：

```bash
DEV_MESH_HUB_URL=https://your-devmesh-hub.example.com
```

## 认证

| 接口类型 | 认证 |
| --- | --- |
| `GET /healthz`、`GET /.well-known/devmesh`、`GET /api/v1/groups`、`POST /api/v1/join` | 公开。 |
| 普通团队 API | `Authorization: Bearer <accessToken>`。 |
| `/mcp` | Streamable HTTP MCP session headers，按 MCP client 处理。 |
| `/api/v1/admin/*` | 当前 Hub 管理面需要由部署层保护，例如内网、反向代理认证或网关鉴权。 |

错误响应格式：

```json
{
  "error": {
    "code": "server.internal_error",
    "message": "Unexpected server error."
  }
}
```

## 发现和加入

| Method | Path | Auth | 说明 |
| --- | --- | --- | --- |
| `GET` | `/healthz` | public | 健康检查，返回 service 和 version。 |
| `GET` | `/.well-known/devmesh` | public | 服务发现，返回 base URL、MCP URL、安装命令和最低客户端版本。 |
| `GET` | `/api/v1/groups` | public | 列出可发现的团队组摘要。 |
| `POST` | `/api/v1/join` | public | 使用邀请 token 加入团队组。 |
| `POST` | `/api/v1/auth/rotate` | bearer | 轮换当前访问令牌。 |

### `POST /api/v1/join`

请求体：

```json
{
  "inviteToken": "inv_xxx",
  "groupKey": "default",
  "displayName": "Alice",
  "handle": "alice",
  "clientLabel": "Alice laptop",
  "hostname": "workstation",
  "tools": ["codex", "claude"],
  "automation": {
    "autoInit": true,
    "autoReference": true,
    "autoSync": true
  }
}
```

返回：

```json
{
  "memberId": "member_default_alice",
  "clientId": "client_xxx",
  "groupKey": "default",
  "accessToken": "mesh_xxx",
  "syncSigningSecret": "secret",
  "expiresAt": "2026-12-31T00:00:00.000Z"
}
```

## 同步和项目

| Method | Path | Auth | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/sync/push` | bearer | 推送本地事件。 |
| `GET` | `/api/v1/sync/pull?cursor=<cursor>` | bearer | 拉取远端事件。 |
| `GET` | `/api/v1/federation/sync-events?branch=<branch>&cursor=<cursor>&limit=<n>` | bearer | 读取带 hash log metadata 的同步事件日志。 |
| `GET` | `/api/v1/projects` | bearer | 列出当前成员可访问项目。 |
| `POST` | `/api/v1/projects` | bearer | 创建项目。 |
| `GET` | `/api/v1/projects/:id/brief` | bearer | 生成项目知识 brief。 |

### `POST /api/v1/sync/push`

请求体：

```json
{
  "clientId": "client_xxx",
  "events": [
    {
      "id": "evt_xxx",
      "kind": "knowledge.captured",
      "payload": {},
      "createdAt": "2026-06-10T00:00:00.000Z"
    }
  ]
}
```

返回：

```json
{
  "accepted": 1,
  "rejected": [],
  "cursor": "42"
}
```

### `GET /api/v1/sync/pull`

返回：

```json
{
  "cursor": "43",
  "events": []
}
```

### `POST /api/v1/projects`

请求体：

```json
{
  "id": "devmesh",
  "projectKey": "DevMesh",
  "name": "DevMesh",
  "description": "Local-first memory for coding agents"
}
```

## 管理接口

| Method | Path | Query / Body | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/overview` |  | 管理总览、计数、近期知识和 MCP URL。 |
| `GET` | `/api/v1/admin/groups` |  | 列出团队组。 |
| `POST` | `/api/v1/admin/groups` | `AdminGroupInput` | 创建或更新团队组。 |
| `GET` | `/api/v1/admin/members` |  | 列出成员。 |
| `POST` | `/api/v1/admin/members/:memberId/disable` | `{ reason? }` | 禁用成员。 |
| `POST` | `/api/v1/admin/members/:memberId/rotate-token` |  | 轮换成员 token。 |
| `GET` | `/api/v1/admin/invites` |  | 列出邀请。 |
| `POST` | `/api/v1/admin/invites` | `AdminInviteInput` | 创建邀请。 |
| `DELETE` | `/api/v1/admin/invites/:token` |  | 撤销邀请。 |
| `GET` | `/api/v1/admin/projects` |  | 列出所有项目。 |
| `POST` | `/api/v1/admin/projects` | `AdminProjectInput` | 创建项目。 |
| `PUT` | `/api/v1/admin/projects/:groupKey/:id/acl` | `AdminProjectAclInput` | 更新项目 ACL。 |
| `GET` | `/api/v1/admin/glossary` | `query`、`groupKey`、`projectKey`、`limit` | 查询词汇表。 |
| `POST` | `/api/v1/admin/glossary` | `AdminGlossaryInput` | 创建词汇条目。 |
| `PUT` | `/api/v1/admin/glossary/:id` | `AdminGlossaryInput` | 更新词汇条目。 |
| `GET` | `/api/v1/admin/knowledge` | `query`、`layer`、`includeSuperseded`、`limit` | 查询知识。 |
| `GET` | `/api/v1/admin/knowledge-edges` | `groupKey`、`kind`、`limit` | 查询知识语义边。 |
| `POST` | `/api/v1/admin/knowledge-edges` | `AdminKnowledgeEdgeInput` | 创建知识语义边。 |
| `GET` | `/api/v1/admin/quality-review` | `layer`、`includeSuperseded`、`maxQualityScore`、`maxConfidence`、`maxRating`、`maxAdoptionScore`、`staleDays`、`limit` | 生成质量审查列表。 |
| `GET` | `/api/v1/admin/task-digest` | `projectKey`、`status`、`includeDone`、`includeSuperseded`、`limit` | 生成任务摘要。 |
| `GET` | `/api/v1/admin/review-queue` |  | 查看 review queue。 |
| `GET` | `/api/v1/admin/audit` | `groupKey`、`action`、`limit` | 查看审计日志。 |

### 管理请求体

`AdminGroupInput`：

```json
{
  "key": "platform",
  "displayName": "Platform",
  "description": "Platform team",
  "joinMode": "invite"
}
```

`AdminInviteInput`：

```json
{
  "groupKey": "platform",
  "token": "inv_custom",
  "expiresAt": "2026-12-31T00:00:00.000Z",
  "maxUses": 10
}
```

`AdminProjectInput`：

```json
{
  "groupKey": "platform",
  "id": "devmesh",
  "projectKey": "DevMesh",
  "name": "DevMesh",
  "description": "Local-first project knowledge"
}
```

`AdminProjectAclInput`：

```json
{
  "visibility": "restricted",
  "members": [
    {
      "memberId": "member_platform_alice",
      "role": "maintainer"
    }
  ]
}
```

`AdminGlossaryInput`：

```json
{
  "term": "daemon",
  "definition": "Project-level background MCP worker",
  "content": "Longer explanation",
  "groupKey": "platform",
  "projectKey": "DevMesh",
  "aliases": ["background worker"],
  "tags": ["runtime"]
}
```

`AdminKnowledgeEdgeInput`：

```json
{
  "kind": "supersedes",
  "fromId": "ki_new",
  "toId": "ki_old",
  "groupKey": "platform",
  "reason": "Newer release decision"
}
```

## MCP over HTTP

| Method | Path | Auth | 说明 |
| --- | --- | --- | --- |
| `ALL` | `/mcp` | MCP session | Streamable HTTP MCP endpoint。 |

这个 endpoint 提供与 `dmx serve --mcp` 相同的 DevMesh MCP tools。工具清单见 [MCP 工具](/reference/mcp)。
