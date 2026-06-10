# Contributing To DevMesh

Thanks for helping improve DevMesh. This project is still in alpha, so useful contributions are especially welcome when they keep the product easier to install, safer to run, and clearer for AI coding agents to use.

## Before You Start

- Read the product overview in [README.md](./README.md).
- Check the user-facing docs at <https://devmesh.xyun.dev/>.
- For larger changes, open an issue or discussion first so the scope is clear.
- Avoid committing local runtime data, secrets, logs, generated indexes, or build output.

## Development Setup

Requirements:

- Node.js 22+
- pnpm 10.6.2+

Install dependencies:

```bash
pnpm install
```

Useful checks:

```bash
pnpm typecheck
pnpm test:unit
pnpm build
```

Before a release-oriented change, run:

```bash
pnpm release:check
```

## Project Boundaries

DevMesh is a TypeScript monorepo:

```text
apps/dmx          CLI entrypoint and command composition
apps/mesh-server  Hub Server process entrypoint
apps/web-admin    Vue admin console
apps/website      VitePress website
packages/core     domain model and knowledge service
packages/client   local runtime, launcher, daemon, CLI support
packages/server   Hub HTTP API and MCP endpoint
packages/local-store .dev-mesh JSONL store and indexes
```

Keep core rules in lower-level packages and let app packages compose them. If a change adds an MCP tool, HTTP route, sync payload, `.dev-mesh/` file, or storage format, update docs and tests in the same PR.

## Code Style

- Prefer clear, direct TypeScript over premature abstraction.
- Keep package dependencies pointing in the existing direction.
- Use structured parsers and schemas for structured data.
- Add comments only for non-obvious behavior, security boundaries, persistence formats, or cross-platform details.
- Keep terminal output readable by default; use `--json` only for machine-readable modes.

## Knowledge Store Policy

Project knowledge that can be reviewed and shared may be committed:

- `.dev-mesh/knowledge/extract/entries.jsonl`
- `.dev-mesh/knowledge/canonical/entries.jsonl`
- `.dev-mesh/knowledge/para/index.json`
- `.dev-mesh/knowledge/edges.jsonl`

Local runtime state should stay ignored:

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

If your work creates durable project knowledge, capture it with DevMesh and commit it separately from code when practical.

## Commits

Use English Conventional Commits:

```text
feat: add knowledge graph visualization
fix: avoid Windows console popups
docs: simplify product README
test: cover daemon fallback path
```

Before committing:

```bash
git status --short
git diff --name-status
git diff --check
```

Stage only files that belong to the change. Do not use destructive cleanup commands to hide unrelated local edits.

## Pull Requests

Every PR should include:

- What changed and why.
- Which user-facing behavior changed.
- Which checks were run.
- Screenshots or terminal output for UI/TUI/CLI changes.
- Documentation updates when commands, APIs, environment variables, or `.dev-mesh/` behavior changes.

The PR template in [.github/pull_request_template.md](./.github/pull_request_template.md) lists the expected checklist.

## Security

Never commit credentials, private keys, tokens, local `.env` files, personal paths, or raw private conversation logs. If you discover a security issue, do not publish exploit details in a public issue; contact the maintainers privately first.
