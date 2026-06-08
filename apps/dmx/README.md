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
dmx proxy --root . --port 8722
dmx doctor --root .
```

`dmx init` scans supported MCP host tools, lets you select them in a TUI, writes their MCP configuration, and enables local auto-init/auto-reference/auto-capture settings. Start `dmx proxy` in a project to serve the local MCP endpoint.

The CLI writes local project data under `.dev-mesh/` and keeps secrets under `.dev-mesh/secrets/`.
