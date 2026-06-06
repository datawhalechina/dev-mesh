import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initGlobalConfig } from '../src/index.js';

describe('initGlobalConfig', () => {
  it('defaults to all built-in MCP host tools', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-global-'));

    try {
      const result = await initGlobalConfig('Xiaoyun', {
        globalRoot
      });
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');
      const identity = JSON.parse(await readFile(join(globalRoot, 'identity.json'), 'utf8')) as {
        selectedTools: string[];
      };

      expect(result.selectedTools).toEqual(['codex', 'claude', 'opencode']);
      expect(identity.selectedTools).toEqual(result.selectedTools);
      expect(config).toContain('codex = true');
      expect(config).toContain('claude = true');
      expect(config).toContain('opencode = true');
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('normalizes aliases and comma-separated tool lists', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-global-'));

    try {
      const result = await initGlobalConfig('Xiaoyun', {
        globalRoot,
        tools: ['claude-code,open-code']
      });
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');

      expect(result.selectedTools).toEqual(['claude', 'opencode']);
      expect(config).toContain('codex = false');
      expect(config).toContain('claude = true');
      expect(config).toContain('opencode = true');
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
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
