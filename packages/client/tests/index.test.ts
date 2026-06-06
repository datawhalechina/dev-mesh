import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initGlobalConfig } from '../src/index.js';

describe('initGlobalConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to all built-in MCP host tools', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-global-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-client-codex-home-'));
    const claudeHome = await mkdtemp(join(tmpdir(), 'dev-mesh-client-claude-home-'));
    const opencodeConfigHome = await mkdtemp(join(tmpdir(), 'dev-mesh-client-opencode-config-'));

    try {
      vi.stubEnv('CODEX_HOME', codexHome);
      vi.stubEnv('HOME', claudeHome);
      vi.stubEnv('USERPROFILE', claudeHome);
      vi.stubEnv('XDG_CONFIG_HOME', opencodeConfigHome);

      const result = await initGlobalConfig('Xiaoyun', {
        globalRoot
      });
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');
      const identity = JSON.parse(await readFile(join(globalRoot, 'identity.json'), 'utf8')) as {
        selectedTools: string[];
        tools: Array<{ key: string; configured: boolean; targetPath?: string }>;
      };
      const toolByKey = Object.fromEntries(identity.tools.map((tool) => [tool.key, tool]));

      expect(result.selectedTools).toEqual(['codex', 'claude', 'opencode']);
      expect(identity.selectedTools).toEqual(result.selectedTools);
      expect(config).toContain('codex = true');
      expect(config).toContain('claude = true');
      expect(config).toContain('opencode = true');
      expect(toolByKey.codex).toMatchObject({
        configured: true,
        targetPath: join(codexHome, 'config.toml')
      });
      expect(toolByKey.claude).toMatchObject({
        configured: true,
        targetPath: join(claudeHome, '.claude.json')
      });
      expect(toolByKey.opencode).toMatchObject({
        configured: true,
        targetPath: join(opencodeConfigHome, 'opencode', 'opencode.json')
      });
      await expect(readFile(join(codexHome, 'config.toml'), 'utf8')).resolves.toContain(
        'url = "http://127.0.0.1:8722/mcp"'
      );
      await expect(readFile(join(claudeHome, '.claude.json'), 'utf8')).resolves.toContain(
        'url": "http://127.0.0.1:8722/mcp"'
      );
      await expect(readFile(join(opencodeConfigHome, 'opencode', 'opencode.json'), 'utf8')).resolves.toContain(
        '"url": "http://127.0.0.1:8722/mcp"'
      );
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
      await rm(opencodeConfigHome, { recursive: true, force: true });
    }
  });

  it('normalizes aliases and comma-separated tool lists', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-global-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-client-codex-home-'));
    const claudeHome = await mkdtemp(join(tmpdir(), 'dev-mesh-client-claude-home-'));
    const opencodeConfigHome = await mkdtemp(join(tmpdir(), 'dev-mesh-client-opencode-config-'));

    try {
      vi.stubEnv('CODEX_HOME', codexHome);
      vi.stubEnv('HOME', claudeHome);
      vi.stubEnv('USERPROFILE', claudeHome);
      vi.stubEnv('XDG_CONFIG_HOME', opencodeConfigHome);

      const result = await initGlobalConfig('Xiaoyun', {
        globalRoot,
        tools: ['claude-code,open-code']
      });
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');

      expect(result.selectedTools).toEqual(['claude', 'opencode']);
      expect(config).toContain('codex = false');
      expect(config).toContain('claude = true');
      expect(config).toContain('opencode = true');
      await expect(readFile(join(codexHome, 'config.toml'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(claudeHome, '.claude.json'), 'utf8')).resolves.toContain(
        'url": "http://127.0.0.1:8722/mcp"'
      );
      await expect(readFile(join(opencodeConfigHome, 'opencode', 'opencode.json'), 'utf8')).resolves.toContain(
        '"url": "http://127.0.0.1:8722/mcp"'
      );
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
      await rm(opencodeConfigHome, { recursive: true, force: true });
    }
  });

  it('applies per-tool project scopes when initializing global config', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-global-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-project-'));
    const opencodeConfigHome = await mkdtemp(join(tmpdir(), 'dev-mesh-client-opencode-config-'));

    try {
      vi.stubEnv('XDG_CONFIG_HOME', opencodeConfigHome);

      const result = await initGlobalConfig('Xiaoyun', {
        globalRoot,
        projectRoot,
        tools: ['opencode'],
        toolScopes: {
          opencode: 'project'
        }
      });
      const opencodeStatus = result.tools.find((tool) => tool.key === 'opencode');

      expect(opencodeStatus).toMatchObject({
        selected: true,
        configured: true,
        scope: 'project',
        targetPath: join(projectRoot, 'opencode.json')
      });
      await expect(readFile(join(projectRoot, 'opencode.json'), 'utf8')).resolves.toContain(
        'http://127.0.0.1:8722/mcp'
      );
      await expect(readFile(join(opencodeConfigHome, 'opencode', 'opencode.json'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
      await rm(opencodeConfigHome, { recursive: true, force: true });
    }
  });

  it('rejects unknown tools before writing global config files', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-global-'));

    try {
      await expect(
        initGlobalConfig('Xiaoyun', {
          globalRoot,
          tools: ['vim']
        })
      ).rejects.toThrow('Unknown tool "vim"');
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
    }
  });
});
