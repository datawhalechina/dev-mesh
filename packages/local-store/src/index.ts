import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createKnowledgeId,
  matchesKnowledgeFilter,
  rankKnowledgeItem,
  type KnowledgeFilter,
  type KnowledgeItem,
  type KnowledgeLayer,
  type KnowledgeRepository,
  type SearchKnowledgeInput
} from '@mcp-dev-mesh/core';
import { nowIso } from '@mcp-dev-mesh/shared';

export const DEV_MESH_DIR = '.dev-mesh';
export const PROJECT_STORE_SCHEMA_VERSION = 1;

export interface ProjectStorePaths {
  root: string;
  config: string;
  eventsDir: string;
  knowledgeDir: string;
  indexDir: string;
  queueDir: string;
  syncDir: string;
  secretsDir: string;
}

export interface ProjectStore {
  projectRoot: string;
  storeRoot: string;
  paths: ProjectStorePaths;
}

export interface EnsureProjectStoreOptions {
  projectKey?: string;
  displayName?: string;
}

export interface DevMeshEvent {
  id: string;
  kind: string;
  projectKey: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export async function ensureProjectStore(
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

export class JsonlKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly projectRoot: string) {}

  async upsert(item: KnowledgeItem): Promise<void> {
    const store = await ensureProjectStore(this.projectRoot);
    await appendJsonLine(getKnowledgeFile(store.paths.knowledgeDir, item.layer), item);
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    const items = await this.loadItems();
    return items.find((item) => item.id === id);
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    const items = await this.loadItems();
    return items
      .filter((item) => matchesKnowledgeFilter(item, filter))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async search(input: SearchKnowledgeInput): Promise<KnowledgeItem[]> {
    const items = await this.loadItems();
    return items
      .filter((item) => matchesKnowledgeFilter(item, input))
      .map((item) => ({
        item,
        score: rankKnowledgeItem(item, input)
      }))
      .filter((candidate) => candidate.score > 0 || input.query.trim().length === 0)
      .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
      .slice(0, input.limit ?? 8)
      .map((candidate) => candidate.item);
  }

  private async loadItems(): Promise<KnowledgeItem[]> {
    const store = await ensureProjectStore(this.projectRoot);
    const files = await walkJsonlFiles(store.paths.knowledgeDir);
    const byId = new Map<string, KnowledgeItem>();

    for (const file of files) {
      const lines = await readJsonl<KnowledgeItem>(file);

      for (const item of lines) {
        byId.set(item.id, item);
      }
    }

    return [...byId.values()];
  }
}

export async function appendProjectEvent(
  projectRoot: string,
  kind: string,
  payload: Record<string, unknown>,
  projectKey = 'auto'
): Promise<DevMeshEvent> {
  const store = await ensureProjectStore(projectRoot, { projectKey });
  const event: DevMeshEvent = {
    id: createKnowledgeId('evt'),
    kind,
    projectKey,
    createdAt: nowIso(),
    payload
  };
  const month = event.createdAt.slice(0, 7);
  await appendJsonLine(join(store.paths.eventsDir, `${month}.jsonl`), event);
  return event;
}

function getKnowledgeFile(knowledgeDir: string, layer: KnowledgeLayer): string {
  if (layer === 'raw') {
    return join(knowledgeDir, 'raw', `${nowIso().slice(0, 7)}.jsonl`);
  }

  return join(knowledgeDir, layer, 'entries.jsonl');
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function walkJsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkJsonlFiles(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }

  return files.sort();
}

async function writeFileIfMissing(path: string, content: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

function defaultProjectConfig(options: EnsureProjectStoreOptions): string {
  const projectKey = options.projectKey ?? 'auto';
  const displayName = options.displayName ?? 'local';

  return [
    `schema_version = ${PROJECT_STORE_SCHEMA_VERSION}`,
    `project_key = "${escapeToml(projectKey)}"`,
    `display_name = "${escapeToml(displayName)}"`,
    'local_only = true',
    '',
    '[automation]',
    'auto_init = true',
    'auto_reference = true',
    'auto_capture = true',
    'auto_sync = false',
    '',
    '[privacy]',
    'redaction_enabled = true',
    'upload_raw_transcripts = false',
    'upload_large_source_blocks = false',
    ''
  ].join('\n');
}

function defaultStoreGitignore(): string {
  return [
    'index/',
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

function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
