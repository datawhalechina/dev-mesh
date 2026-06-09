# Alpha Release Guide

This guide describes the current alpha release path for the DevMesh application. It covers the Hub Server, Web Admin, Website, and PostgreSQL runtime used by the Docker Compose stack.

## Release Scope

The alpha release publishes deployable application artifacts, not public npm packages. Workspace packages remain private and are bundled into Docker images from source.

Included artifacts:

- `apps/mesh-server`: Hub Server container.
- `apps/web-admin`: static Web Admin container with `/api` proxied to the Hub Server.
- `apps/website`: static documentation website container.
- `postgres`: PostgreSQL service for durable knowledge and Hub state storage.

## Preflight

Run the full verification suite before creating a tag or building images. The release check synchronizes the publishable CLI package version from the workspace root before validating the git tag:

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

For background startup followed by a smoke check:

```bash
pnpm docker:up:detached
pnpm docker:smoke
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

`pnpm docker:smoke` waits for the stack and checks:

- Hub Server `/healthz`.
- Hub Server `/.well-known/dev-mesh`.
- Web Admin static shell.
- Web Admin `/healthz` proxy.
- Website home page.

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

The `Docker Images` GitHub workflow is manual-only for now, so `v*` tags can publish npm and GitHub Release artifacts without automatically publishing containers. When run manually, it publishes the three application images to GitHub Container Registry:

```text
ghcr.io/<owner>/mcp-dev-mesh-server:<tag>
ghcr.io/<owner>/mcp-dev-mesh-web-admin:<tag>
ghcr.io/<owner>/mcp-dev-mesh-website:<tag>
```

Tag rules for manual runs:

- Manual dispatch on a branch publishes `manual-<run-number>` and `sha-<short-sha>`.
- Manual dispatch on a tag publishes `<git-tag>`, `alpha`, and `sha-<short-sha>`.

The workflow uses the repository `GITHUB_TOKEN` with `packages: write`; no registry password needs to be committed. The target registry can be switched to Docker Hub later without changing the npm or GitHub Release workflows.

## Website Deployment

The `Website Pages` GitHub workflow builds the VitePress site and uploads `apps/website/docs/.vitepress/dist` to GitHub Pages. Enable Pages in repository settings before relying on the workflow.

## GitHub Release Artifacts

The `Release Artifacts` GitHub workflow runs `pnpm release:check`, packages non-Docker artifacts, and uploads them as workflow artifacts. On `v*` tags, it also creates a GitHub Release with generated notes.

Release assets:

```text
mcp-dev-mesh-web-admin-<tag>.tar.gz
mcp-dev-mesh-website-<tag>.tar.gz
mcp-dev-mesh-deploy-<tag>.tar.gz
```

The Web Admin and Website archives contain static files ready for any static host. The deploy archive contains `README.md`, `deploy/`, and this release guide.

## NPM CLI Publishing

The `NPM Publish` GitHub workflow publishes the `mcp-dev-mesh` CLI package on `v*` tags. Manual dispatch builds and uploads the npm tarball as a workflow artifact without publishing.

Required repository secret:

```text
NPM_TOKEN
```

The workflow publishes with provenance, public package access, and the `alpha` dist-tag:

```bash
npm install -g mcp-dev-mesh@alpha
```

The CLI package bundles internal workspace code into `dist/index.js`; runtime npm dependencies are limited to external packages used by the bundled CLI.
The CLI package `repository.url` must match the GitHub repository used by Actions provenance.

## Current Release Boundaries

- Public npm publishing is enabled for the `mcp-dev-mesh` CLI only. Internal workspace libraries remain private and are bundled into the CLI.
- Container image publishing is manual-only and currently targets GHCR; Docker Hub publishing can be wired in later without affecting npm releases.
- GitHub Release artifacts currently cover static frontends and deployment docs; the Node server is released through source checkout or container images, not as a standalone npm package.
- Web Admin is intended to be served behind the included Nginx proxy or another reverse proxy that forwards `/api` and `/healthz` to the Hub Server.
- Production secrets and external PostgreSQL credentials should be provided through the deployment platform, not committed to the repository.
