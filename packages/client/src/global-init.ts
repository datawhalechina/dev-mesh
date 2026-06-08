import { mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { createBuiltInAdapters, type BuiltInToolAdapterId } from '@mcp-dev-mesh/adapters';
import type { McpCommandConfig } from '@mcp-dev-mesh/extension-api';
import { DEFAULT_LOCAL_PROXY_URL, escapeToml, getGlobalConfigPaths } from './global-config.js';

export type GlobalToolKey = 'codex' | 'claude' | 'opencode';
export type GlobalToolScope = 'user' | 'project';

export interface GlobalToolStatus {
  key: GlobalToolKey;
  adapterId: BuiltInToolAdapterId;
  displayName: string;
  selected: boolean;
  detected: boolean;
  configured: boolean;
  scope: GlobalToolScope;
  reason?: string;
  message?: string;
  targetPath?: string;
}

export interface InitGlobalConfigOptions {
  globalRoot?: string;
  mcpUrl?: string;
  projectRoot?: string;
  tools?: string[];
  toolScopes?: Partial<Record<GlobalToolKey, GlobalToolScope>>;
  configureTools?: boolean;
  mcpCommand?: McpCommandConfig;
}

export interface InspectGlobalToolsOptions {
  mcpUrl?: string;
  projectRoot?: string;
  tools?: string[];
  toolScopes?: Partial<Record<GlobalToolKey, GlobalToolScope>>;
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
  const projectRoot = options.projectRoot ?? process.cwd();
  const selectedTools = normalizeGlobalTools(options.tools);
  const toolScopes = normalizeGlobalToolScopes(options.toolScopes);
  const inspectOptions: InspectGlobalToolsInternalOptions = {
    selectedTools,
    mcpUrl,
    projectRoot,
    toolScopes,
    configureTools: options.configureTools ?? true,
    checkConfiguredForAll: false
  };

  if (options.mcpCommand !== undefined) {
    inspectOptions.mcpCommand = options.mcpCommand;
  }

  const tools = await inspectGlobalTools(inspectOptions);

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

export async function inspectGlobalToolStatuses(
  options: InspectGlobalToolsOptions = {}
): Promise<GlobalToolStatus[]> {
  const mcpUrl = options.mcpUrl ?? DEFAULT_LOCAL_PROXY_URL;
  const projectRoot = options.projectRoot ?? process.cwd();
  const selectedTools =
    options.tools === undefined ? GLOBAL_TOOL_DEFINITIONS.map((definition) => definition.key) : normalizeGlobalTools(options.tools);

  return inspectGlobalTools({
    selectedTools,
    mcpUrl,
    projectRoot,
    toolScopes: normalizeGlobalToolScopes(options.toolScopes),
    configureTools: false,
    checkConfiguredForAll: true
  });
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
    'auto_sync = true',
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

interface InspectGlobalToolsInternalOptions {
  selectedTools: GlobalToolKey[];
  mcpUrl: string;
  projectRoot: string;
  toolScopes: Record<GlobalToolKey, GlobalToolScope>;
  mcpCommand?: McpCommandConfig;
  configureTools: boolean;
  checkConfiguredForAll: boolean;
}

async function inspectGlobalTools(options: InspectGlobalToolsInternalOptions): Promise<GlobalToolStatus[]> {
  const { selectedTools, mcpUrl, projectRoot, toolScopes, mcpCommand, configureTools, checkConfiguredForAll } = options;
  const selected = new Set(selectedTools);
  const adapters = new Map(createBuiltInAdapters().map((adapter) => [adapter.id, adapter]));
  const statuses: GlobalToolStatus[] = [];

  for (const definition of GLOBAL_TOOL_DEFINITIONS) {
    const adapter = adapters.get(`dev-mesh.adapter.${definition.adapterId}`);
    const isSelected = selected.has(definition.key);
    const scope = toolScopes[definition.key];

    if (adapter === undefined) {
      statuses.push({
        key: definition.key,
        adapterId: definition.adapterId,
        displayName: definition.displayName,
        selected: isSelected,
        detected: false,
        configured: false,
        scope,
        reason: 'Built-in adapter is not registered.'
      });
      continue;
    }

    const detection = await adapter.detect();
    let configured = isSelected || checkConfiguredForAll ? await adapter.isConfigured(projectRoot) : false;
    const status: GlobalToolStatus = {
      key: definition.key,
      adapterId: definition.adapterId,
      displayName: definition.displayName,
      selected: isSelected,
      detected: detection.detected,
      configured,
      scope
    };

    if (detection.reason !== undefined) {
      status.reason = detection.reason;
    }

    if (isSelected) {
      const configure = await adapter.configure({
        projectRoot,
        mcpUrl,
        scope,
        dryRun: !configureTools,
        ...(mcpCommand !== undefined ? { mcpCommand } : {})
      });

      if (configureTools) {
        configured = await adapter.isConfigured(projectRoot);
        status.configured = configured;
      }

      if (configure.message !== undefined) {
        status.message = configure.message;
      }

      if (configure.targetPath !== undefined) {
        status.targetPath = configure.targetPath;
      }
    }

    statuses.push(status);
  }

  return statuses;
}

function normalizeGlobalToolScopes(
  scopes: Partial<Record<GlobalToolKey, GlobalToolScope>> = {}
): Record<GlobalToolKey, GlobalToolScope> {
  return {
    codex: scopes.codex ?? 'user',
    claude: scopes.claude ?? 'user',
    opencode: scopes.opencode ?? 'user'
  };
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
