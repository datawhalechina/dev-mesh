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
      const expectedCommand = 'dmx serve --mcp';

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
        message: expect.stringContaining(expectedCommand),
        targetPath: join(codexHome, 'config.toml')
      });
      expect(toolByKey.claude).toMatchObject({
        adapterId: 'claude-code',
        selected: true,
        configured: true,
        message: expect.stringContaining(expectedCommand),
        targetPath: join(claudeHome, '.claude.json')
      });
      expect(toolByKey.opencode).toMatchObject({
        adapterId: 'opencode',
        selected: true,
        configured: true,
        message: expect.stringContaining(expectedCommand),
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
      await expect(readFile(join(codexHome, 'config.toml'), 'utf8')).resolves.toContain('command = "dmx"');
      await expect(readFile(join(codexHome, 'config.toml'), 'utf8')).resolves.toContain('"serve"');
      await expect(readFile(join(claudeHome, '.claude.json'), 'utf8')).resolves.toContain('"type": "stdio"');
      await expect(readFile(join(claudeHome, '.claude.json'), 'utf8')).resolves.toContain('"command": "dmx"');
      await expect(readFile(join(opencodeConfigHome, 'opencode', 'opencode.json'), 'utf8')).resolves.toContain(
        '"type": "local"'
      );
      await expect(readFile(join(opencodeConfigHome, 'opencode', 'opencode.json'), 'utf8')).resolves.toContain(
        '"command": ['
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
      expect(config).toContain('auto_reference = true');
      expect(config).toContain('auto_sync = true');
      expect(codexConfig).toContain(`[mcp_servers.devmesh]`);
      expect(codexConfig).toContain('command = "dmx"');
      expect(codexConfig).toContain('"serve"');
      expect(codexConfig).toContain('"--mcp"');
      expect(codexConfig).not.toContain('"--root"');
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
    }
  }, 30000);

  it('only pins an MCP project root when --root is explicit', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-explicit-root-global-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-explicit-root-codex-home-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-explicit-root-project-'));

    try {
      await runDmx(['init', '--global', '--yes', '--tool', 'codex', '--root', projectRoot], {
        DEV_MESH_HOME: globalRoot,
        CODEX_HOME: codexHome
      });
      const codexConfig = await readFile(join(codexHome, 'config.toml'), 'utf8');

      expect(codexConfig).toContain('"--root"');
      expect(codexConfig).toContain(JSON.stringify(projectRoot));
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects conflicting init modes', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-conflicting-init-global-'));

    try {
      await expect(
        runDmx(['init', '--global', '--project', '--yes'], {
          DEV_MESH_HOME: globalRoot
        })
      ).rejects.toThrow(/cannot be used with option/);

      await expect(readFile(join(globalRoot, 'config.toml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
