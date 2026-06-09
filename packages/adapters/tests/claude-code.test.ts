import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeCodeToolAdapter } from '../src/index.js';

describe('createClaudeCodeToolAdapter', () => {
  it('configures, updates, and removes the user scoped Claude Code MCP server', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'dev-mesh-claude-home-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-claude-project-'));
    const adapter = createClaudeCodeToolAdapter({
      homeDir,
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
        targetPath: join(homeDir, '.claude.json'),
        message: 'Configured claude-code for http://127.0.0.1:8722/mcp'
      });
      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(true);

      const configPath = join(homeDir, '.claude.json');
      await expect(readJson(configPath)).resolves.toMatchObject({
        mcpServers: {
          'devmesh': {
            type: 'http',
            url: 'http://127.0.0.1:8722/mcp'
          }
        }
      });

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
      await expect(readJson(configPath)).resolves.toMatchObject({
        mcpServers: {
          'devmesh': {
            type: 'http',
            url: 'http://127.0.0.1:9999/mcp'
          }
        }
      });

      await adapter.remove({
        projectRoot,
        scope: 'user'
      });

      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(false);
      await expect(readJson(configPath)).resolves.toEqual({
        mcpServers: {}
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves unrelated Claude Code config and prefers project scoped MCP config when present', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'dev-mesh-claude-home-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-claude-project-'));
    const adapter = createClaudeCodeToolAdapter({
      homeDir,
      command: process.execPath
    });
    const userConfigPath = join(homeDir, '.claude.json');

    try {
      await writeFile(
        userConfigPath,
        `${JSON.stringify(
          {
            theme: 'dark',
            mcpServers: {
              other: {
                type: 'stdio',
                command: 'node'
              }
            }
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      await adapter.configure({
        projectRoot,
        mcpUrl: 'http://127.0.0.1:8722/mcp',
        scope: 'project'
      });

      const projectConfigPath = join(projectRoot, '.mcp.json');

      await expect(readJson(userConfigPath)).resolves.toMatchObject({
        theme: 'dark',
        mcpServers: {
          other: {
            type: 'stdio',
            command: 'node'
          }
        }
      });
      await expect(readJson(projectConfigPath)).resolves.toMatchObject({
        mcpServers: {
          'devmesh': {
            type: 'http',
            url: 'http://127.0.0.1:8722/mcp'
          }
        }
      });
      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(true);

      const checks = await adapter.doctor(projectRoot);

      expect(checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'adapter.claude-code.cli',
            status: 'ok'
          }),
          expect.objectContaining({
            id: 'adapter.claude-code.mcp-config',
            status: 'ok',
            message: expect.stringContaining(projectConfigPath)
          })
        ])
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
