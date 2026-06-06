import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDmx } from './run-dmx.js';

describe('dmx CLI global init', () => {
  it('initializes global config with selected MCP host tools', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-global-'));
    const mcpUrl = 'http://127.0.0.1:9999/mcp';

    try {
      const init = await runDmx(
        ['init', '--global', '--name', 'Xiaoyun', '--tool', 'codex', '--tool', 'opencode', '--mcp-url', mcpUrl],
        {
          DEV_MESH_HOME: globalRoot
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
        selectedTools: ['codex', 'opencode']
      });
      expect(toolByKey.codex).toMatchObject({
        adapterId: 'codex',
        selected: true,
        detected: false,
        configured: false,
        message: `Would configure codex for ${mcpUrl}`
      });
      expect(toolByKey.claude).toMatchObject({
        adapterId: 'claude-code',
        selected: false,
        detected: false,
        configured: false
      });
      expect(toolByKey.opencode).toMatchObject({
        adapterId: 'opencode',
        selected: true,
        detected: false,
        configured: false,
        message: `Would configure opencode for ${mcpUrl}`
      });
      expect(config).toContain(`local_proxy_url = "${mcpUrl}"`);
      expect(config).toContain('[tools]');
      expect(config).toContain('codex = true');
      expect(config).toContain('claude = false');
      expect(config).toContain('opencode = true');
      expect(identity).toMatchObject({
        displayName: 'Xiaoyun',
        localProxyUrl: mcpUrl,
        selectedTools: ['codex', 'opencode']
      });
      expect(identity.tools).toEqual(initJson.tools);
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
    }
  }, 30000);
});

interface GlobalToolOutput {
  key: string;
  adapterId: string;
  selected: boolean;
  detected: boolean;
  configured: boolean;
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
