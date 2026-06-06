import { mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { createBuiltInAdapters, type BuiltInToolAdapterId } from '@mcp-dev-mesh/adapters';
import { DEFAULT_LOCAL_PROXY_URL, escapeToml, getGlobalConfigPaths } from './global-config.js';

export type GlobalToolKey = 'codex' | 'claude' | 'opencode';

export interface GlobalToolStatus {
  key: GlobalToolKey;
  adapterId: BuiltInToolAdapterId;
  displayName: string;
  selected: boolean;
  detected: boolean;
  configured: boolean;
  reason?: string;
  message?: string;
}

export interface InitGlobalConfigOptions {
  globalRoot?: string;
  mcpUrl?: string;
  tools?: string[];
}

export interface GlobalInitResult {
  globalRoot: string;
  configPath: string;
  identityPath: string;
  selectedTools: GlobalToolKey[];
  tools: GlobalToolStatus[];
}

const GLOBAL_TOOL_DEFINITIONS: Array<{
  key: GlobalToolKey;
  adapterId: BuiltInToolAdapterId;
  displayName: string;
  aliases: string[];
}> = [
  { key: 'codex', adapterId: 'codex', displayName: 'Codex', aliases: ['codex'] },
  {
    key: 'claude',
    adapterId: 'claude-code',
    displayName: 'Claude Code',
    aliases: ['claude', 'claude-code', 'claudecode']
  },
  { key: 'opencode', adapterId: 'opencode', displayName: 'opencode', aliases: ['opencode', 'open-code'] }
];

export async function initGlobalConfig(
  displayName = 'local',
  options: InitGlobalConfigOptions = {}
): Promise<GlobalInitResult> {
  const { globalRoot, configPath, identityPath } = getGlobalConfigPaths(options.globalRoot);
  const mcpUrl = options.mcpUrl ?? DEFAULT_LOCAL_PROXY_URL;
  const selectedTools = normalizeGlobalTools(options.tools);
  const tools = await inspectGlobalTools(selectedTools, mcpUrl);

  await mkdir(globalRoot, { recursive: true });
  await writeFile(configPath, createGlobalConfigToml(displayName, mcpUrl, selectedTools), 'utf8');
  await writeFile(
    identityPath,
    `${JSON.stringify(
      {
        displayName,
        hostname: hostname(),
        createdAt: new Date().toISOString(),
        localProxyUrl: mcpUrl,
        selectedTools,
        tools
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    globalRoot,
    configPath,
    identityPath,
    selectedTools,
    tools
  };
}

function createGlobalConfigToml(displayName: string, mcpUrl: string, selectedTools: GlobalToolKey[]): string {
  return [
    'schema_version = 1',
    `display_name = "${escapeToml(displayName)}"`,
    `local_proxy_url = "${escapeToml(mcpUrl)}"`,
    '',
    '[automation]',
    'auto_init = true',
    'auto_reference = true',
    'auto_capture = true',
    'auto_sync = false',
    '',
    '[tools]',
    `codex = ${selectedTools.includes('codex')}`,
    `claude = ${selectedTools.includes('claude')}`,
    `opencode = ${selectedTools.includes('opencode')}`,
    ''
  ].join('\n');
}

function normalizeGlobalTools(tools?: string[]): GlobalToolKey[] {
  if (!tools?.length) {
    return GLOBAL_TOOL_DEFINITIONS.map((definition) => definition.key);
  }

  const selected = new Set<GlobalToolKey>();
  const aliasMap = createGlobalToolAliasMap();

  for (const value of tools) {
    for (const item of value.split(',')) {
      const normalized = item.trim().toLowerCase();

      if (!normalized) {
        continue;
      }

      const key = aliasMap.get(normalized);

      if (key === undefined) {
        throw new Error(`Unknown tool "${item.trim()}". Expected one of: codex, claude, opencode.`);
      }

      selected.add(key);
    }
  }

  if (selected.size === 0) {
    return GLOBAL_TOOL_DEFINITIONS.map((definition) => definition.key);
  }

  return GLOBAL_TOOL_DEFINITIONS.filter((definition) => selected.has(definition.key)).map((definition) => definition.key);
}

async function inspectGlobalTools(selectedTools: GlobalToolKey[], mcpUrl: string): Promise<GlobalToolStatus[]> {
  const selected = new Set(selectedTools);
  const adapters = new Map(createBuiltInAdapters().map((adapter) => [adapter.id, adapter]));
  const projectRoot = process.cwd();
  const statuses: GlobalToolStatus[] = [];

  for (const definition of GLOBAL_TOOL_DEFINITIONS) {
    const adapter = adapters.get(`dev-mesh.adapter.${definition.adapterId}`);
    const isSelected = selected.has(definition.key);

    if (adapter === undefined) {
      statuses.push({
        key: definition.key,
        adapterId: definition.adapterId,
        displayName: definition.displayName,
        selected: isSelected,
        detected: false,
        configured: false,
        reason: 'Built-in adapter is not registered.'
      });
      continue;
    }

    const detection = await adapter.detect();
    const configured = isSelected ? await adapter.isConfigured(projectRoot) : false;
    const status: GlobalToolStatus = {
      key: definition.key,
      adapterId: definition.adapterId,
      displayName: definition.displayName,
      selected: isSelected,
      detected: detection.detected,
      configured
    };

    if (detection.reason !== undefined) {
      status.reason = detection.reason;
    }

    if (isSelected) {
      // Adapter writes are intentionally dry-run until host-specific configure
      // implementations are complete; init still records the user's selection.
      const configure = await adapter.configure({
        projectRoot,
        mcpUrl,
        scope: 'user',
        dryRun: true
      });

      if (configure.message !== undefined) {
        status.message = configure.message;
      }
    }

    statuses.push(status);
  }

  return statuses;
}

function createGlobalToolAliasMap(): Map<string, GlobalToolKey> {
  const aliases = new Map<string, GlobalToolKey>();

  for (const definition of GLOBAL_TOOL_DEFINITIONS) {
    aliases.set(definition.key, definition.key);

    for (const alias of definition.aliases) {
      aliases.set(alias, definition.key);
    }
  }

  return aliases;
}
