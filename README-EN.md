<div align="center">
  <img src="apps/website/docs/public/img/logo.svg" width="72" alt="DevMesh logo">
  <h1>DevMesh</h1>
  <h3>CRDT-powered local-first project memory for AI coding agents</h3>
  <p><strong>Automerge CRDT core</strong> · <strong>MCP-native</strong> · <strong>knowledge follows the repo</strong> · <strong>team sync is optional</strong></p>
  <p>
    <a href="https://devmesh.xyun.dev/"><strong>Documentation & Website -></strong></a>
    ·
    <a href="./README.md">简体中文</a>
  </p>
  <p>
    <a href="https://www.npmjs.com/package/devmesh"><img alt="npm alpha version" src="https://img.shields.io/npm/v/devmesh/alpha?label=npm&color=2f7f68"></a>
    <a href="https://devmesh.xyun.dev/"><img alt="DevMesh docs" src="https://img.shields.io/badge/docs-devmesh.xyun.dev-4b5563"></a>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D22-5fa04e">
  </p>
  <p>
    <img alt="Windows supported" src="https://img.shields.io/badge/Windows-supported-3b72b9">
    <img alt="macOS supported" src="https://img.shields.io/badge/macOS-supported-3b72b9">
    <img alt="Linux supported" src="https://img.shields.io/badge/Linux-supported-3b72b9">
  </p>
  <p>
    <img alt="Codex supported" src="https://img.shields.io/badge/Codex-supported-6d3fc8">
    <img alt="Claude Code supported" src="https://img.shields.io/badge/Claude%20Code-supported-6d3fc8">
    <img alt="opencode supported" src="https://img.shields.io/badge/opencode-supported-6d3fc8">
    <img alt="MCP tools" src="https://img.shields.io/badge/MCP-tools-2b6f73">
  </p>
  <p><code>npm install -g devmesh@alpha</code></p>
</div>

## What Is DevMesh

DevMesh is a project knowledge layer for AI coding tools such as Codex, Claude Code, and opencode. It stores durable engineering context in the project's `.dev-mesh/` directory: decisions, conventions, task handoffs, useful commands, and pitfalls that future AI sessions should be able to retrieve.

Built on Automerge CRDT: multiple collaborators can edit the same knowledge base offline without conflicts. The default mode is local-first. You do not need to deploy a server, and raw conversations are not uploaded. When a team wants shared memory, DevMesh can optionally sync through a Hub Server.

## Who It Is For

- Individual developers using Codex, Claude Code, opencode, or similar AI coding tools
- Small teams that want project knowledge to travel with the repository
- Engineers building on top of MCP, project memory, or knowledge graph workflows

## Online Reading

- Website and docs: https://devmesh.xyun.dev/
- CLI reference: https://devmesh.xyun.dev/reference/cli
- MCP tools: https://devmesh.xyun.dev/reference/mcp
- HTTP API: https://devmesh.xyun.dev/reference/http

## Quick Start

```bash
npm install -g devmesh@alpha
dmx init
```

`dmx init` scans installed MCP hosts such as Codex, Claude Code, and opencode, then configures them to start the DevMesh stdio MCP launcher. After that, when you open a project with an AI coding tool, DevMesh reads or creates `.dev-mesh/` for that project and exposes MCP tools that help the assistant capture useful knowledge at the right time.

Common checks:

```bash
dmx status
dmx doctor
dmx search "release workflow"
```

Join a shared team Hub:

```bash
dmx join https://your-devmesh-hub.example.com \
  --group frontend \
  --name Alice \
  --token <invite-token>
```

## How It Works

DevMesh uses a foreground MCP launcher that starts or reuses a per-project daemon on demand:

- The MCP host only needs to run `dmx serve --mcp`.
- The launcher reuses the current project's daemon when it exists, or starts one when needed.
- During cold starts, the launcher answers MCP initialize and tools/list immediately so the AI host does not time out.
- Knowledge capture is assistant-led: the AI tool decides from the active conversation, code context, edits, and command output when to call DevMesh MCP tools.
- DevMesh does not rely on background Git or filesystem polling to force project analysis.

## What Gets Stored

Knowledge that is intended to follow the repository:

- `.dev-mesh/knowledge/extract/entries.jsonl`
- `.dev-mesh/knowledge/canonical/entries.jsonl`
- `.dev-mesh/knowledge/para/index.json`
- `.dev-mesh/knowledge/edges.jsonl`

Local runtime state that should not be committed:

- `.dev-mesh/daemon.json`
- `.dev-mesh/daemon.pid`
- `.dev-mesh/events/`
- `.dev-mesh/index/`
- `.dev-mesh/sync/`
- `.dev-mesh/queue/`
- `.dev-mesh/secrets/`
- `.dev-mesh/knowledge/raw/`
- `.dev-mesh/knowledge/ratings/`
- `.dev-mesh/knowledge/usage/`

When someone clones a project that already contains DevMesh knowledge, their local DevMesh can load the shared knowledge from the repo. Indexes, daemon state, sync cursors, and sensitive runtime files are regenerated on their machine.

## One-Click Deploy

All server components are available as Docker Hub images:

```bash
# Pull images
docker pull xy200303/devmesh-server:alpha
docker pull xy200303/devmesh-web-admin:alpha

# Start PostgreSQL
docker run -d --name devmesh-postgres \
  -e POSTGRES_DB=devmesh -e POSTGRES_USER=devmesh -e POSTGRES_PASSWORD=devmesh \
  -v devmesh-pg:/var/lib/postgresql/data \
  postgres:16-alpine

# Start Hub Server
docker run -d --name devmesh-server \
  -p 8721:8721 \
  -e DEV_MESH_HOST=0.0.0.0 \
  -e DEV_MESH_PORT=8721 \
  -e DEV_MESH_BASE_URL=http://127.0.0.1:8721 \
  -e DEV_MESH_PROJECT_ROOT=/data/devmesh \
  -e DEV_MESH_POSTGRES_URL=postgres://devmesh:devmesh@devmesh-postgres:5432/devmesh \
  -e DEV_MESH_POSTGRES_KNOWLEDGE_TABLE=dev_mesh_knowledge_items \
  -e DEV_MESH_POSTGRES_HUB_STATE_TABLE=dev_mesh_hub_state \
  --link devmesh-postgres \
  xy200303/devmesh-server:alpha

# Start Web Admin
docker run -d --name devmesh-web-admin \
  -p 5173:80 \
  xy200303/devmesh-web-admin:alpha
```

Or use `docker compose` to start everything (including PostgreSQL) in one command:

```bash
curl -O https://raw.githubusercontent.com/datawhalechina/dev-mesh/main/deploy/docker-compose.deploy.yml
docker compose -f docker-compose.yml up -d
```

Visit `http://127.0.0.1:5173` for the admin dashboard.

## Common Commands

| Command | Purpose |
| --- | --- |
| `dmx init` | Configure local MCP hosts or initialize the current project. |
| `dmx join <server>` | Join a team Hub group and enable optional sync. |
| `dmx status` | Show version, project store, daemon, and knowledge counts. |
| `dmx doctor` | Check store, privacy, sync, daemon, and MCP host configuration. |
| `dmx capture` | Manually capture a knowledge item or queue it for review. |
| `dmx search <query>` | Search project knowledge. |
| `dmx knowledge get/list/update/delete` | Inspect and maintain knowledge items. |
| `dmx graph explore` | Explore knowledge graph relationships. |
| `dmx visualize` | Generate and open a local knowledge graph page. |
| `dmx serve --mcp` | Stdio MCP launcher, usually started by AI tools. |
| `dmx proxy` | Start the local Streamable HTTP MCP proxy for debugging. |

See the full [CLI reference](https://devmesh.xyun.dev/reference/cli).

## Interfaces

DevMesh exposes two interface surfaces:

- MCP tools for AI clients to read, capture, update, delete, rate, and link project knowledge.
- Hub HTTP APIs for team sync, admin workflows, invites, project ACLs, knowledge graph management, and audit trails.

Documentation:

- [MCP tools](https://devmesh.xyun.dev/reference/mcp)
- [HTTP API](https://devmesh.xyun.dev/reference/http)
- [Environment variables](https://devmesh.xyun.dev/reference/env)
- [Deployment guide](https://devmesh.xyun.dev/deployment)

## Project Status

| Stage | Status | Notes |
| --- | --- | --- |
| Planning | Complete | Product direction and local-first architecture are in place. |
| Alpha | In progress | The CLI is published on npm and the website is online. |
| Beta | Not started | Planned after install flow, Hub deployment, and docs stabilize. |

## Project Team

| Role | Member | Contact |
| --- | --- | --- |
| Project lead | `@xy200303` | GitHub: https://github.com/xy200303 |
| Project home | DevMesh | Website: https://devmesh.xyun.dev/ |

Add maintainers and collaborators here as the contributor group grows.

## Local Development

```bash
pnpm install
pnpm typecheck
pnpm test:unit
pnpm build
```

Full release check:

```bash
pnpm release:check
```

Development entrypoints:

```bash
pnpm dev:server
pnpm dev:admin
pnpm dev:website
pnpm dev:client -- --help
```

Repository layout:

```text
apps/
  dmx/          # npm CLI, installs the dmx command
  mesh-server/  # Hub Server entrypoint
  web-admin/    # Vue admin console
  website/      # VitePress website
packages/
  core/         # domain model and knowledge service
  client/       # local runtime, launcher, daemon, CLI support
  local-store/  # .dev-mesh JSONL store and indexes
  server/       # Hub HTTP API and MCP endpoint
  mcp-contracts/# MCP tool schemas and formatting
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before sending a pull request. Release details are in [docs/release.md](./docs/release.md).

## Contributing

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, commit rules, and `.dev-mesh` knowledge-store boundaries
- Run at least `pnpm typecheck`, `pnpm test:unit`, and `pnpm build` before opening a PR
- Update docs when commands, APIs, environment variables, or knowledge-store behavior changes
- If your work produces durable project knowledge, capture it with DevMesh and commit it separately when practical

## License

The code in this repository is released under the [MIT License](./LICENSE).

Documentation, website content, and community collaboration rules will continue to evolve with the project.

## Security And Privacy

- Raw conversations are not uploaded by default.
- DevMesh stays local until `dmx join` connects it to a team Hub.
- `.dev-mesh/secrets/`, `.env`, `*.pem`, `*.key`, and credential files should never be committed.
- High-risk knowledge should go through the review inbox before becoming project knowledge.

## Status

DevMesh is currently in alpha. The CLI is published on npm, and the website and core docs live at [devmesh.xyun.dev](https://devmesh.xyun.dev/). APIs and storage formats may still evolve, so production deployments should be evaluated with your own authentication, secret management, backup, and monitoring requirements.
