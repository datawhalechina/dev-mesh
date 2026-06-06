import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { createOpencodeToolAdapter } from '../src/index.js';

describe('createOpencodeToolAdapter', () => {
  it('configures, updates, and removes the user scoped opencode MCP server', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'dev-mesh-opencode-config-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-opencode-project-'));
    const adapter = createOpencodeToolAdapter({
      configHome,
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
        targetPath: join(configHome, 'opencode', 'opencode.json'),
        message: 'Configured opencode for http://127.0.0.1:8722/mcp'
      });
      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(true);

      const configPath = join(configHome, 'opencode', 'opencode.json');

      await expect(readJsonc(configPath)).resolves.toMatchObject({
        mcp: {
          'dev-mesh': {
            type: 'remote',
            url: 'http://127.0.0.1:8722/mcp',
            enabled: true
          }
        },
        permission: {
          'dev-mesh_*': 'ask'
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
      await expect(readJsonc(configPath)).resolves.toMatchObject({
        mcp: {
          'dev-mesh': {
            type: 'remote',
            url: 'http://127.0.0.1:9999/mcp',
            enabled: true
          }
        }
      });

      await adapter.remove({
        projectRoot,
        scope: 'user'
      });

      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(false);
      await expect(readJsonc(configPath)).resolves.toEqual({
        mcp: {},
        permission: {}
      });
    } finally {
      await rm(configHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves JSONC comments and unrelated opencode config when project config exists', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'dev-mesh-opencode-config-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-opencode-project-'));
    const adapter = createOpencodeToolAdapter({
      configHome,
      command: process.execPath
    });
    const projectConfigPath = join(projectRoot, 'opencode.jsonc');

    try {
      await writeFile(
        projectConfigPath,
        [
          '{',
          '  // Keep this comment while editing Dev Mesh config.',
          '  "$schema": "https://opencode.ai/config.json",',
          '  "mcp": {',
          '    "other": {',
          '      "type": "remote",',
          '      "url": "https://example.test/mcp"',
          '    }',
          '  },',
          '  "permission": {',
          '    "other_*": "allow"',
          '  }',
          '}',
          ''
        ].join('\n'),
        'utf8'
      );

      await adapter.configure({
        projectRoot,
        mcpUrl: 'http://127.0.0.1:8722/mcp',
        scope: 'project'
      });

      const content = await readFile(projectConfigPath, 'utf8');

      expect(content).toContain('// Keep this comment while editing Dev Mesh config.');
      expect(parse(content)).toMatchObject({
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          other: {
            type: 'remote',
            url: 'https://example.test/mcp'
          },
          'dev-mesh': {
            type: 'remote',
            url: 'http://127.0.0.1:8722/mcp',
            enabled: true
          }
        },
        permission: {
          'other_*': 'allow',
          'dev-mesh_*': 'ask'
        }
      });
      await expect(adapter.isConfigured(projectRoot)).resolves.toBe(true);

      const checks = await adapter.doctor(projectRoot);

      expect(checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'adapter.opencode.cli',
            status: 'ok'
          }),
          expect.objectContaining({
            id: 'adapter.opencode.mcp-config',
            status: 'ok',
            message: expect.stringContaining(projectConfigPath)
          })
        ])
      );
    } finally {
      await rm(configHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

async function readJsonc(path: string): Promise<Record<string, unknown>> {
  return parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
