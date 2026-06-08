import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDmx } from './run-dmx.js';

describe('dmx CLI global init', () => {
  it('initializes global config with selected MCP host tools', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-global-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-codex-home-'));
    const claudeHome = await mkdtemp(join(tmpdir(), 'dev-mesh-claude-home-'));
    const opencodeConfigHome = await mkdtemp(join(tmpdir(), 'dev-mesh-opencode-config-'));
    const mcpUrl = 'http://127.0.0.1:9999/mcp';

    try {
      const init = await runDmx(
        [
          'init',
          '--global',
          '--name',
          'Xiaoyun',
          '--tool',
          'codex',
          '--tool',
          'claude',
          '--tool',
          'opencode',
          '--mcp-url',
          mcpUrl
        ],
        {
          DEV_MESH_HOME: globalRoot,
          CODEX_HOME: codexHome,
          HOME: claudeHome,
          USERPROFILE: claudeHome,
          XDG_CONFIG_HOME: opencodeConfigHome
        }
      );
      const initJson = JSON.parse(init.stdout) as GlobalInitOutput;
      const toolByKey = Object.fromEntries(initJson.tools.map((tool) => [tool.key, tool]));
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');
      const identity = JSON.parse(await readFile(join(globalRoot, 'identity.json'), 'utf8')) as GlobalIdentityOutput;

      expect(initJson).toMatchObject({
        globalRoot,
        configPath: join(globalRoot, 'config.toml'),
        identityPath: join(globalRoot, 'identity.json'),
        selectedTools: ['codex', 'claude', 'opencode']
      });
      expect(toolByKey.codex).toMatchObject({
        adapterId: 'codex',
        selected: true,
        configured: true,
        message: `Configured codex for ${mcpUrl}`,
        targetPath: join(codexHome, 'config.toml')
      });
      expect(toolByKey.claude).toMatchObject({
        adapterId: 'claude-code',
        selected: true,
        configured: true,
        message: `Configured claude-code for ${mcpUrl}`,
        targetPath: join(claudeHome, '.claude.json')
      });
      expect(toolByKey.opencode).toMatchObject({
        adapterId: 'opencode',
        selected: true,
        configured: true,
        message: `Configured opencode for ${mcpUrl}`,
        targetPath: join(opencodeConfigHome, 'opencode', 'opencode.json')
      });
      expect(config).toContain(`local_proxy_url = "${mcpUrl}"`);
      expect(config).toContain('[tools]');
      expect(config).toContain('codex = true');
      expect(config).toContain('claude = true');
      expect(config).toContain('opencode = true');
      expect(identity).toMatchObject({
        displayName: 'Xiaoyun',
        localProxyUrl: mcpUrl,
        selectedTools: ['codex', 'claude', 'opencode']
      });
      expect(identity.tools).toEqual(initJson.tools);
      await expect(readFile(join(codexHome, 'config.toml'), 'utf8')).resolves.toContain(`url = "${mcpUrl}"`);
      await expect(readFile(join(claudeHome, '.claude.json'), 'utf8')).resolves.toContain(`"url": "${mcpUrl}"`);
      await expect(readFile(join(opencodeConfigHome, 'opencode', 'opencode.json'), 'utf8')).resolves.toContain(
        `"url": "${mcpUrl}"`
      );
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
      await rm(opencodeConfigHome, { recursive: true, force: true });
    }
  }, 30000);

  it('uses global tool setup as the default init flow', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-default-global-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-default-codex-home-'));
    const mcpUrl = 'http://127.0.0.1:9998/mcp';

    try {
      const init = await runDmx(['init', '--yes', '--tool', 'codex', '--mcp-url', mcpUrl], {
        DEV_MESH_HOME: globalRoot,
        CODEX_HOME: codexHome
      });
      const initJson = JSON.parse(init.stdout) as GlobalInitOutput;
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');
      const codexConfig = await readFile(join(codexHome, 'config.toml'), 'utf8');

      expect(initJson).toMatchObject({
        globalRoot,
        selectedTools: ['codex']
      });
      expect(config).toContain('auto_capture = true');
      expect(config).toContain('auto_sync = false');
      expect(codexConfig).toContain(`[mcp_servers.dev-mesh]`);
      expect(codexConfig).toContain(`url = "${mcpUrl}"`);
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
    }
  }, 30000);
});

interface GlobalToolOutput {
  key: string;
  adapterId: string;
  selected: boolean;
  detected: boolean;
  configured: boolean;
  targetPath?: string;
  message?: string;
}

interface GlobalInitOutput {
  globalRoot: string;
  configPath: string;
  identityPath: string;
  selectedTools: string[];
  tools: GlobalToolOutput[];
}

interface GlobalIdentityOutput {
  displayName: string;
  localProxyUrl: string;
  selectedTools: string[];
  tools: GlobalToolOutput[];
}
