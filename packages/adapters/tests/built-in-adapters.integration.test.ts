import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBuiltInAdapters } from '../src/index.js';

describe('built-in adapters with temporary home directories', () => {
  it('configures, diagnoses, and removes MCP config without touching real user config', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-adapters-project-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-adapters-codex-'));
    const claudeHome = await mkdtemp(join(tmpdir(), 'dev-mesh-adapters-claude-'));
    const opencodeConfigHome = await mkdtemp(join(tmpdir(), 'dev-mesh-adapters-opencode-'));
    const mcpUrl = 'http://127.0.0.1:8722/mcp';

    try {
      const adapters = createBuiltInAdapters({
        codex: {
          codexHome,
          command: process.execPath
        },
        claudeCode: {
          homeDir: claudeHome,
          command: process.execPath
        },
        opencode: {
          configHome: opencodeConfigHome,
          command: process.execPath
        }
      });
      const expectedTargetPaths = new Map([
        ['devmesh.adapter.codex', join(codexHome, 'config.toml')],
        ['devmesh.adapter.claude-code', join(claudeHome, '.claude.json')],
        ['devmesh.adapter.opencode', join(opencodeConfigHome, 'opencode', 'opencode.json')]
      ]);

      for (const adapter of adapters) {
        const configure = await adapter.configure({
          projectRoot,
          mcpUrl,
          scope: 'user'
        });
        const expectedTargetPath = expectedTargetPaths.get(adapter.id);

        expect(expectedTargetPath).toBeDefined();
        expect(configure).toMatchObject({
          changed: true,
          targetPath: expectedTargetPath
        });
        await expect(adapter.isConfigured(projectRoot)).resolves.toBe(true);
        expect(await adapter.doctor(projectRoot)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: expect.stringMatching(/^adapter\..+\.mcp-config$/),
              status: 'ok',
              message: expect.stringContaining(expectedTargetPath as string)
            })
          ])
        );

        await adapter.remove({
          projectRoot,
          scope: 'user'
        });
        await expect(adapter.isConfigured(projectRoot)).resolves.toBe(false);
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
      await rm(opencodeConfigHome, { recursive: true, force: true });
    }
  });
});
