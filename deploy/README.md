# Deployment Helpers

This directory contains the alpha Docker Compose stack for DevMesh.

## Docker Hub Images

Pre-built images are published to Docker Hub on every tagged release:

- `xy200303/devmesh-server:alpha` — Hub Server + MCP endpoint
- `xy200303/devmesh-web-admin:alpha` — Web Admin UI
- `xy200303/devmesh-website:alpha` — Documentation website

Pull the latest alpha images:

```bash
docker pull xy200303/devmesh-server:alpha
docker pull xy200303/devmesh-web-admin:alpha
docker pull xy200303/devmesh-website:alpha
```

## Services

- `postgres`: durable PostgreSQL storage for knowledge and Hub state.
- `mesh-server`: Hub Server and MCP Streamable HTTP endpoint.
- `web-admin`: static Web Admin served by Nginx, with `/api` and `/healthz` proxied to the Hub Server.
- `website`: static VitePress documentation website served by Nginx.

## Quick Commands

Run these commands from the repository root:

```bash
pnpm docker:config
pnpm docker:up
```

Start in the background:

```bash
pnpm docker:up:detached
```

Verify the running stack:

```bash
pnpm docker:smoke
```

Stop the stack:

```bash
pnpm docker:down
```

Reset PostgreSQL and server volumes intentionally:

```bash
pnpm docker:down:volumes
```

Run the release verification suite before tagging or shipping images:

```bash
pnpm release:check
```

## Default Ports

```text
Hub Server: http://127.0.0.1:8721
MCP endpoint: http://127.0.0.1:8721/mcp
Web Admin: http://127.0.0.1:5173
Website: http://127.0.0.1:3000
```

## Environment

The Compose stack defines the development alpha environment inline. Use `mesh-server.env.example` as the template for direct server deployments:

```bash
cp deploy/mesh-server.env.example mesh-server.env
node apps/mesh-server/dist/index.js --env-file ./mesh-server.env
```

The smoke test URLs can be overridden when ports or hosts differ:

```bash
DEV_MESH_SMOKE_HUB_URL=http://127.0.0.1:8721 pnpm docker:smoke
DEV_MESH_SMOKE_WEB_ADMIN_URL=http://127.0.0.1:5173 pnpm docker:smoke
DEV_MESH_SMOKE_WEBSITE_URL=http://127.0.0.1:3000 pnpm docker:smoke
```

PowerShell example:

```powershell
$env:DEV_MESH_SMOKE_HUB_URL = 'http://127.0.0.1:8721'
pnpm docker:smoke
```

For full release notes and boundaries, see [`../docs/release.md`](../docs/release.md).
