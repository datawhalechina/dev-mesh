# MCP Dev Mesh CLI

`mcp-dev-mesh` provides the `dmx` command for local-first project knowledge capture, search, review, and MCP proxy setup.

## Install

```bash
npm install -g mcp-dev-mesh@alpha
```

## Commands

```bash
dmx init
dmx init --yes --tool codex
dmx init --project --root . --name local
dmx capture --root . --title "Run focused tests" --summary "Use pnpm test:unit before pushing." --type command
dmx search "focused tests" --root .
dmx serve --mcp --root .
dmx proxy --root . --port 8722
dmx doctor --root .
```

`dmx init` scans supported MCP host tools, lets you select them in a TUI, writes their MCP configuration, and enables local auto-init/auto-reference/auto-capture settings. MCP hosts are configured to run `dmx serve --mcp`; that foreground launcher starts or reuses the project daemon on demand and falls back to local execution if the daemon is not ready.

`dmx proxy` still starts the Streamable HTTP MCP endpoint directly and is useful for debugging or embedding.

The CLI writes local project data under `.dev-mesh/` and keeps secrets under `.dev-mesh/secrets/`.
