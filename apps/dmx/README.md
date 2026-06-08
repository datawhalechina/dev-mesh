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

`dmx init` scans supported MCP host tools, lets you select them in a Clack-powered TUI, writes their MCP configuration, shows a readable result summary in interactive terminals, and enables local auto-init/auto-reference/auto-capture settings. CI, redirected output, and `--json` still use machine-readable JSON. MCP hosts are configured to run `dmx serve --mcp` without pinning the init-time directory as `--root`; that foreground launcher uses the host project directory, starts or reuses the project daemon on demand, and falls back to local execution if the daemon is not ready. After `dmx join`, the same project daemon also performs automatic Hub sync when `auto_sync` is enabled, including replaying remote knowledge snapshots into the local searchable `.dev-mesh/knowledge/` store.

`dmx doctor` uses the same TUI style in interactive terminals and groups diagnostics by store, privacy, sync, launcher/daemon, and MCP hosts. Use `dmx doctor --json` for scripts.

`dmx proxy` still starts the Streamable HTTP MCP endpoint directly and is useful for debugging or embedding.

The CLI writes local project data under `.dev-mesh/`, stores sync cursors/status under `.dev-mesh/sync/`, and keeps secrets under `.dev-mesh/secrets/`.
