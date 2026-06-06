import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCodexToolAdapter } from '../src/index.js';

describe('createCodexToolAdapter', () => {
  it('configures, updates, and removes the user scoped Codex MCP server', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-codex-home-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-codex-project-'));
    const adapter = createCodexToolAdapter({
      codexHome,
      command: process.execPath
    });

    try {
      const first = await adapter.configure({
        projectRoot,
        mcpUrl: 'http://127.0.0.1:8722/mcp',
        scope: 'user'
      });

      expect(first).toMatchObject({
        changed: true,
        targetPath: join(codexHome, 'config.toml'),
        message: 'Configured codex for http://127.0.0.1:8722/mcp'
      });
      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(true);

      const configPath = join(codexHome, 'config.toml');
      await expect(readFile(configPath, 'utf8')).resolves.toBe(
        '[mcp_servers.dev-mesh]\nurl = "http://127.0.0.1:8722/mcp"\n'
      );

      const second = await adapter.configure({
        projectRoot,
        mcpUrl: 'http://127.0.0.1:8722/mcp',
        scope: 'user'
      });

      expect(second.changed).toBe(false);

      const update = await adapter.configure({
        projectRoot,
        mcpUrl: 'http://127.0.0.1:9999/mcp',
        scope: 'user'
      });

      expect(update.changed).toBe(true);
      await expect(readFile(configPath, 'utf8')).resolves.toBe(
        '[mcp_servers.dev-mesh]\nurl = "http://127.0.0.1:9999/mcp"\n'
      );

      await adapter.remove({
        projectRoot,
        scope: 'user'
      });

      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(false);
      await expect(readFile(configPath, 'utf8')).resolves.toBe('');
    } finally {
      await rm(codexHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves unrelated Codex config and prefers project scoped MCP config when present', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-codex-home-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-codex-project-'));
    const adapter = createCodexToolAdapter({
      codexHome,
      command: process.execPath
    });
    const userConfigPath = join(codexHome, 'config.toml');

    try {
      await writeFile(userConfigPath, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "node"\n', 'utf8');

      await adapter.configure({
        projectRoot,
        mcpUrl: 'http://127.0.0.1:8722/mcp',
        scope: 'project'
      });

      const projectConfigPath = join(projectRoot, '.codex', 'config.toml');

      await expect(readFile(userConfigPath, 'utf8')).resolves.toBe(
        'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "node"\n'
      );
      await expect(readFile(projectConfigPath, 'utf8')).resolves.toBe(
        '[mcp_servers.dev-mesh]\nurl = "http://127.0.0.1:8722/mcp"\n'
      );
      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(true);

      const checks = await adapter.doctor(projectRoot);

      expect(checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'adapter.codex.cli',
            status: 'ok'
          }),
          expect.objectContaining({
            id: 'adapter.codex.mcp-config',
            status: 'ok',
            message: expect.stringContaining(projectConfigPath)
          })
        ])
      );
    } finally {
      await rm(codexHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
