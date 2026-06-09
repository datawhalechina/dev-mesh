import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DevMeshError } from '@devmesh/shared';
import {
  DEV_MESH_DIR,
  PROJECT_STORE_SCHEMA_VERSION,
  type EnsureProjectStoreOptions,
  type ProjectConfig,
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
    eventsDir: join(storeRoot, 'events'),
    knowledgeDir: join(storeRoot, 'knowledge'),
    indexDir: join(storeRoot, 'index'),
    queueDir: join(storeRoot, 'queue'),
    syncDir: join(storeRoot, 'sync'),
    secretsDir: join(storeRoot, 'secrets')
  };
}

export async function readProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const store = await ensureProjectStore(projectRoot);

  return readProjectConfigFile(store.paths.config);
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
    mkdir(paths.eventsDir, { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'raw'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'extract'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'canonical'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'ratings'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'usage'), { recursive: true }),
    mkdir(join(paths.knowledgeDir, 'para'), { recursive: true }),
    mkdir(paths.indexDir, { recursive: true }),
    mkdir(paths.queueDir, { recursive: true }),
    mkdir(paths.syncDir, { recursive: true }),
    mkdir(paths.secretsDir, { recursive: true })
  ]);

  await Promise.all([
    writeFileIfMissing(paths.config, defaultProjectConfig(options)),
    writeFileIfMissing(join(storeRoot, '.gitignore'), defaultStoreGitignore()),
    writeFileIfMissing(join(paths.knowledgeDir, 'extract', 'entries.jsonl'), ''),
    writeFileIfMissing(join(paths.knowledgeDir, 'canonical', 'entries.jsonl'), ''),
    writeFileIfMissing(join(paths.knowledgeDir, 'para', 'index.json'), `${JSON.stringify(defaultParaIndex(), null, 2)}\n`),
    writeFileIfMissing(join(paths.syncDir, 'cursors.json'), `${JSON.stringify({ remotes: {} }, null, 2)}\n`),
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
      autoCapture: readBoolean(parsed['automation.auto_capture'], true),
      autoSync: readBoolean(parsed['automation.auto_sync'], false)
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

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
      autoCapture: true,
      autoSync: true
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
    `auto_capture = ${config.automation.autoCapture}`,
    `auto_sync = ${config.automation.autoSync}`,
    '',
    '[privacy]',
    `redaction_enabled = ${config.privacy.redactionEnabled}`,
    `upload_raw_transcripts = ${config.privacy.uploadRawTranscripts}`,
    `upload_large_source_blocks = ${config.privacy.uploadLargeSourceBlocks}`,
    ''
  ].join('\n');
}

function defaultStoreGitignore(): string {
  return [
    'index/',
    'capture/',
    'queue/',
    'sync/',
    'secrets/',
    'events/',
    'knowledge/raw/',
    '*.sqlite',
    '*.db',
    ''
  ].join('\n');
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
