# Alpha Release Guide

This guide describes the current alpha release path for the MCP Dev Mesh application. It covers the Hub Server, Web Admin, Website, and PostgreSQL runtime used by the Docker Compose stack.

## Release Scope

The alpha release publishes deployable application artifacts, not public npm packages. Workspace packages remain private and are bundled into Docker images from source.

Included artifacts:

- `apps/mesh-server`: Hub Server container.
- `apps/web-admin`: static Web Admin container with `/api` proxied to the Hub Server.
- `apps/website`: static documentation website container.
- `postgres`: PostgreSQL service for durable knowledge and Hub state storage.

## Preflight

Run the full verification suite before creating a tag or building images:

```bash
pnpm install
pnpm release:check
```

Known build warnings:

- The Web Admin Vite build may report existing chunk-size and pure annotation warnings.

## Local Docker Compose

Build and start the alpha stack:

```bash
pnpm docker:up
```

Default URLs:

```text
Hub Server: http://127.0.0.1:8721
MCP endpoint: http://127.0.0.1:8721/mcp
Web Admin: http://127.0.0.1:5173
Website: http://127.0.0.1:3000
```

Stop the stack:

```bash
pnpm docker:down
```

Remove local volumes when you intentionally want to reset PostgreSQL and server data:

```bash
pnpm docker:down:volumes
```

The same commands are summarized in [`../deploy/README.md`](../deploy/README.md).

## Mesh Server Environment

Use `deploy/mesh-server.env.example` as the template for non-compose deployments:

```bash
cp deploy/mesh-server.env.example mesh-server.env
```

The server config precedence is:

```text
CLI args > process env > env file
```

Run the built server directly:

```bash
pnpm build
node apps/mesh-server/dist/index.js --env-file ./mesh-server.env
```

## Docker Images

Build individual images from the repository root:

```bash
docker build -f apps/mesh-server/Dockerfile -t mcp-dev-mesh-server:alpha .
docker build -f apps/web-admin/Dockerfile -t mcp-dev-mesh-web-admin:alpha .
docker build -f apps/website/Dockerfile -t mcp-dev-mesh-website:alpha .
```

The `Docker Images` GitHub workflow builds these images on `v*` tags and manual dispatch. It does not push images yet.

## Website Deployment

The `Website Pages` GitHub workflow builds the VitePress site and uploads `apps/website/docs/.vitepress/dist` to GitHub Pages. Enable Pages in repository settings before relying on the workflow.

## Current Release Boundaries

- Public npm publishing is not enabled. Packages still use `private: true` and workspace dependencies.
- Container images are build-checked but not pushed to a registry.
- Web Admin is intended to be served behind the included Nginx proxy or another reverse proxy that forwards `/api` and `/healthz` to the Hub Server.
- Production secrets and external PostgreSQL credentials should be provided through the deployment platform, not committed to the repository.
