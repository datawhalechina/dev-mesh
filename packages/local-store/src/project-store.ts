import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_AUTO_CAPTURE_KNOWLEDGE_TYPES, type KnowledgeType } from '@devmesh/core';
import { DevMeshError } from '@devmesh/shared';
import {
  DEV_MESH_DIR,
  KNOWLEDGE_BRANCH_POLICY_PRESETS,
  PROJECT_STORE_SCHEMA_VERSION,
  type EnsureProjectStoreOptions,
  type KnowledgeBranchDefinition,
  type KnowledgeBranchPolicyPreset,
  type ProjectConfig,
  type ProjectBranchScope,
  type ProjectStore,
  type ProjectStorePaths
} from './types.js';
import { escapeToml, writeFileIfMissing } from './files.js';

export async function ensureProjectStore(
  projectRoot: string,
  options: EnsureProjectStoreOptions = {}
): Promise<ProjectStore> {
  const store = await bootstrapProjectStore(projectRoot, options);
  await migrateProjectStoreConfig(store.paths.config);

  return store;
}

export function createProjectStorePaths(storeRoot: string): ProjectStorePaths {
  return {
    root: storeRoot,
    config: join(storeRoot, 'config.toml'),
    stateDir: join(storeRoot, 'state'),
    eventsDir: join(storeRoot, 'events'),
    crdtDir: join(storeRoot, 'crdt'),
    crdtSyncDir: join(storeRoot, 'crdt', 'sync'),
    exportsDir: join(storeRoot, 'exports'),
    knowledgeDir: join(storeRoot, 'knowledge'),
    indexDir: join(storeRoot, 'index'),
    visualizationsDir: join(storeRoot, 'visualizations'),
    queueDir: join(storeRoot, 'queue'),
    secretsDir: join(storeRoot, 'secrets')
  };
}

export async function readProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const store = await ensureProjectStore(projectRoot);

  return readProjectConfigFile(store.paths.config);
}

export async function readProjectBranchScope(projectRoot: string): Promise<ProjectBranchScope> {
  return createProjectBranchScope(await readProjectConfig(projectRoot));
}

export function createProjectBranchScope(config: ProjectConfig): ProjectBranchScope {
  const readable = uniqueStrings([
    config.knowledgeBranch.active,
    ...(config.knowledgeBranch.base === undefined ? [] : [config.knowledgeBranch.base])
  ]);
  const scope: ProjectBranchScope = {
    active: config.knowledgeBranch.active,
    readable
  };

  if (config.knowledgeBranch.base !== undefined) {
    scope.base = config.knowledgeBranch.base;
  }

  return scope;
}

export async function writeProjectConfig(projectRoot: string, config: ProjectConfig): Promise<ProjectConfig> {
  const store = await ensureProjectStore(projectRoot);
  const normalized = normalizeProjectConfig({
    ...flattenProjectConfig(config),
    schema_version: PROJECT_STORE_SCHEMA_VERSION
  });

  await writeFile(store.paths.config, projectConfigToToml(normalized), 'utf8');

  return normalized;
}

export async function migrateProjectStore(projectRoot: string): Promise<ProjectConfig> {
  const store = await bootstrapProjectStore(projectRoot);

  return migrateProjectStoreConfig(store.paths.config);
}

export function projectKeyOptions(projectKey: string | undefined): EnsureProjectStoreOptions {
  if (projectKey === undefined) {
    return {};
  }

  return {
    projectKey
  };
}

export async function readProjectKey(store: ProjectStore, override: string | undefined): Promise<string> {
  if (override !== undefined) {
    return override;
  }

  const config = await readProjectConfigFile(store.paths.config);

  return config.projectKey;
}

export async function readProjectConfigFile(configPath: string): Promise<ProjectConfig> {
  const parsed = parseSimpleToml(await readFile(configPath, 'utf8'));

  return normalizeProjectConfig(parsed);
}

async function bootstrapProjectStore(
  projectRoot: string,
  options: EnsureProjectStoreOptions = {}
): Promise<ProjectStore> {
  const storeRoot = join(projectRoot, DEV_MESH_DIR);
  const paths = createProjectStorePaths(storeRoot);

  await Promise.all([
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.eventsDir, { recursive: true }),
    mkdir(paths.crdtDir, { recursive: true }),
    mkdir(paths.crdtSyncDir, { recursive: true }),
    mkdir(paths.exportsDir, { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'raw'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'extract'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'canonical'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'ratings'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'usage'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'para'), { recursive: true }),
    mkdir(paths.indexDir, { recursive: true }),
    mkdir(paths.visualizationsDir, { recursive: true }),
    mkdir(paths.queueDir, { recursive: true }),
    mkdir(paths.secretsDir, { recursive: true })
  ]);

  await Promise.all([
    writeFileIfMissing(paths.config, defaultProjectConfig(options)),
    ensureStoreGitignore(storeRoot),
    writeFileIfMissing(join(paths.knowledgeDir, 'edges.jsonl'), ''),
    writeFileIfMissing(join(paths.knowledgeDir, 'extract', 'entries.jsonl'), ''),
    writeFileIfMissing(join(paths.knowledgeDir, 'canonical', 'entries.jsonl'), ''),
    writeFileIfMissing(join(paths.knowledgeDir, 'para', 'index.json'), `${JSON.stringify(defaultParaIndex(), null, 2)}\n`),
    writeFileIfMissing(join(paths.crdtSyncDir, 'peers.json'), `${JSON.stringify({ schemaVersion: 2, remotes: {} }, null, 2)}\n`),
    writeFileIfMissing(join(paths.crdtSyncDir, 'heads.json'), `${JSON.stringify({ schemaVersion: 2, heads: [] }, null, 2)}\n`),
    writeFileIfMissing(join(paths.queueDir, 'pending.jsonl'), ''),
    writeFileIfMissing(join(paths.queueDir, 'rejected.jsonl'), '')
  ]);

  return {
    projectRoot,
    storeRoot,
    paths
  };
}

async function migrateProjectStoreConfig(configPath: string): Promise<ProjectConfig> {
  const config = await readProjectConfigFile(configPath);

  if (config.schemaVersion > PROJECT_STORE_SCHEMA_VERSION) {
    throw new DevMeshError(
      'project_store.unsupported_schema',
      `Project store schema ${config.schemaVersion} is newer than supported schema ${PROJECT_STORE_SCHEMA_VERSION}`,
      {
        configPath,
        schemaVersion: config.schemaVersion,
        supportedSchemaVersion: PROJECT_STORE_SCHEMA_VERSION
      }
    );
  }

  if (config.schemaVersion < PROJECT_STORE_SCHEMA_VERSION) {
    const migrated: ProjectConfig = {
      ...config,
      schemaVersion: PROJECT_STORE_SCHEMA_VERSION
    };
    await writeFile(configPath, projectConfigToToml(migrated), 'utf8');

    return migrated;
  }

  return config;
}

function normalizeProjectConfig(parsed: Record<string, unknown>): ProjectConfig {
  return {
    schemaVersion: readNumber(parsed.schema_version, PROJECT_STORE_SCHEMA_VERSION),
    projectKey: readString(parsed.project_key, 'auto'),
    displayName: readString(parsed.display_name, 'local'),
    localOnly: readBoolean(parsed.local_only, true),
    automation: {
      autoInit: readBoolean(parsed['automation.auto_init'], true),
      autoReference: readBoolean(parsed['automation.auto_reference'], true),
      autoSync: readBoolean(parsed['automation.auto_sync'], false)
    },
    knowledgeBranch: normalizeKnowledgeBranchConfig(parsed),
    knowledge: {
      autoCaptureTypes: readStringArray(
        parsed['knowledge.auto_capture_types'],
        DEFAULT_AUTO_CAPTURE_KNOWLEDGE_TYPES
      ) as KnowledgeType[],
      includeVolatileInContext: readBoolean(parsed['knowledge.include_volatile_in_context'], false)
    },
    privacy: {
      redactionEnabled: readBoolean(parsed['privacy.redaction_enabled'], true),
      uploadRawTranscripts: readBoolean(parsed['privacy.upload_raw_transcripts'], false),
      uploadLargeSourceBlocks: readBoolean(parsed['privacy.upload_large_source_blocks'], false)
    }
  };
}

function parseSimpleToml(content: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  let section: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim();
      continue;
    }

    const separator = line.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = parseTomlValue(line.slice(separator + 1).trim());
    values[section ? `${section}.${key}` : key] = value;
  }

  return values;
}

function parseTomlValue(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    return parseTomlArray(value);
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return value;
}

function parseTomlArray(value: string): unknown[] {
  const body = value.slice(1, -1).trim();

  if (!body) {
    return [];
  }

  const items: unknown[] = [];
  let index = 0;

  while (index < body.length) {
    while (body[index] === ' ' || body[index] === '\t' || body[index] === ',') {
      index += 1;
    }

    if (index >= body.length) {
      break;
    }

    if (body[index] === '"') {
      let cursor = index + 1;
      let escaped = false;
      let text = '';

      while (cursor < body.length) {
        const character = body[cursor] ?? '';

        if (escaped) {
          text += character;
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          break;
        } else {
          text += character;
        }

        cursor += 1;
      }

      items.push(text);
      index = cursor + 1;
      continue;
    }

    const nextComma = body.indexOf(',', index);
    const rawItem = body.slice(index, nextComma === -1 ? undefined : nextComma).trim();

    if (rawItem) {
      items.push(parseTomlValue(rawItem));
    }

    index = nextComma === -1 ? body.length : nextComma + 1;
  }

  return items;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const strings = value.filter((item): item is string => typeof item === 'string' && item.length > 0);

  return strings.length > 0 ? [...new Set(strings)] : [...fallback];
}

function normalizeKnowledgeBranchConfig(parsed: Record<string, unknown>): ProjectConfig['knowledgeBranch'] {
  const active = normalizeBranchName(readString(parsed['knowledge_branch.active'], 'main'));
  const base = normalizeOptionalBranchName(readStringOrUndefined(parsed['knowledge_branch.base']));
  const branchNames = readStringArray(parsed['knowledge_branch.branches'], [active, ...(base === undefined ? [] : [base])]);
  const branches = uniqueStrings([active, ...(base === undefined ? [] : [base]), ...branchNames]).map((name) => ({
    name,
    policy: readBranchPolicy(parsed[`knowledge_branch.policies.${name}.preset`], defaultBranchPolicy(name, active, base))
  }));

  const config: ProjectConfig['knowledgeBranch'] = {
    active,
    branches
  };

  if (base !== undefined) {
    config.base = base;
  }

  return config;
}

function flattenProjectConfig(config: ProjectConfig): Record<string, unknown> {
  const values: Record<string, unknown> = {
    schema_version: config.schemaVersion,
    project_key: config.projectKey,
    display_name: config.displayName,
    local_only: config.localOnly,
    'automation.auto_init': config.automation.autoInit,
    'automation.auto_reference': config.automation.autoReference,
    'automation.auto_sync': config.automation.autoSync,
    'knowledge.auto_capture_types': config.knowledge.autoCaptureTypes,
    'knowledge.include_volatile_in_context': config.knowledge.includeVolatileInContext,
    'privacy.redaction_enabled': config.privacy.redactionEnabled,
    'privacy.upload_raw_transcripts': config.privacy.uploadRawTranscripts,
    'privacy.upload_large_source_blocks': config.privacy.uploadLargeSourceBlocks,
    'knowledge_branch.active': config.knowledgeBranch.active,
    'knowledge_branch.branches': config.knowledgeBranch.branches.map((branch) => branch.name)
  };

  if (config.knowledgeBranch.base !== undefined) {
    values['knowledge_branch.base'] = config.knowledgeBranch.base;
  }

  for (const branch of config.knowledgeBranch.branches) {
    values[`knowledge_branch.policies.${branch.name}.preset`] = branch.policy;
  }

  return values;
}

function readStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeOptionalBranchName(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return normalizeBranchName(value);
}

function normalizeBranchName(value: string): string {
  const normalized = value.trim();

  return normalized.length === 0 ? 'main' : normalized;
}

function readBranchPolicy(value: unknown, fallback: KnowledgeBranchPolicyPreset): KnowledgeBranchPolicyPreset {
  return typeof value === 'string' && isKnowledgeBranchPolicyPreset(value) ? value : fallback;
}

function isKnowledgeBranchPolicyPreset(value: string): value is KnowledgeBranchPolicyPreset {
  return (KNOWLEDGE_BRANCH_POLICY_PRESETS as readonly string[]).includes(value);
}

function defaultBranchPolicy(
  name: string,
  active: string,
  base: string | undefined
): KnowledgeBranchPolicyPreset {
  if (base !== undefined && name === base) {
    return 'durable_only';
  }

  return name === active ? 'balanced' : 'balanced';
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function defaultProjectConfig(options: EnsureProjectStoreOptions): string {
  return projectConfigToToml({
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    projectKey: options.projectKey ?? 'auto',
    displayName: options.displayName ?? 'local',
    localOnly: true,
    automation: {
      autoInit: true,
      autoReference: true,
      autoSync: true
    },
    knowledgeBranch: {
      active: 'main',
      branches: [
        {
          name: 'main',
          policy: 'balanced'
        }
      ]
    },
    knowledge: {
      autoCaptureTypes: DEFAULT_AUTO_CAPTURE_KNOWLEDGE_TYPES,
      includeVolatileInContext: false
    },
    privacy: {
      redactionEnabled: true,
      uploadRawTranscripts: false,
      uploadLargeSourceBlocks: false
    }
  });
}

function projectConfigToToml(config: ProjectConfig): string {
  return [
    `schema_version = ${config.schemaVersion}`,
    `project_key = "${escapeToml(config.projectKey)}"`,
    `display_name = "${escapeToml(config.displayName)}"`,
    `local_only = ${config.localOnly}`,
    '',
    '[automation]',
    `auto_init = ${config.automation.autoInit}`,
    `auto_reference = ${config.automation.autoReference}`,
    `auto_sync = ${config.automation.autoSync}`,
    '',
    '[knowledge_branch]',
    `active = "${escapeToml(config.knowledgeBranch.active)}"`,
    ...(config.knowledgeBranch.base === undefined ? [] : [`base = "${escapeToml(config.knowledgeBranch.base)}"`]),
    `branches = ${formatTomlStringArray(config.knowledgeBranch.branches.map((branch) => branch.name))}`,
    '',
    ...formatKnowledgeBranchPolicySections(config.knowledgeBranch.branches),
    '[knowledge]',
    `auto_capture_types = ${formatTomlStringArray(config.knowledge.autoCaptureTypes)}`,
    `include_volatile_in_context = ${config.knowledge.includeVolatileInContext}`,
    '',
    '[privacy]',
    `redaction_enabled = ${config.privacy.redactionEnabled}`,
    `upload_raw_transcripts = ${config.privacy.uploadRawTranscripts}`,
    `upload_large_source_blocks = ${config.privacy.uploadLargeSourceBlocks}`,
    ''
  ].join('\n');
}

function formatKnowledgeBranchPolicySections(branches: readonly KnowledgeBranchDefinition[]): string[] {
  return branches.flatMap((branch) => [
    `[knowledge_branch.policies.${branch.name}]`,
    `preset = "${escapeToml(branch.policy)}"`,
    ''
  ]);
}

function formatTomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => `"${escapeToml(value)}"`).join(', ')}]`;
}

function defaultStoreGitignore(): string {
  return [...defaultStoreGitignoreLines(), ''].join('\n');
}

async function ensureStoreGitignore(storeRoot: string): Promise<void> {
  const gitignorePath = join(storeRoot, '.gitignore');

  try {
    const current = await readFile(gitignorePath, 'utf8');
    const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
    const missing = defaultStoreGitignoreLines().filter((line) => !lines.has(line));

    if (missing.length === 0) {
      return;
    }

    await writeFile(gitignorePath, `${current.trimEnd()}\n${missing.join('\n')}\n`, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      await writeFile(gitignorePath, defaultStoreGitignore(), 'utf8');
      return;
    }

    throw error;
  }
}

function defaultStoreGitignoreLines(): string[] {
  return [
    'state/',
    'index/',
    'visualizations/',
    'queue/',
    'crdt/sync/',
    'exports/',
    'secrets/',
    'events/',
    'knowledge/raw/',
    'knowledge/ratings/',
    'knowledge/usage/',
    '*.sqlite',
    '*.db'
  ];
}

function defaultParaIndex(): Record<string, unknown> {
  return {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    projects: {},
    areas: {},
    resources: {},
    archives: {}
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
