import type {
  KnowledgeFilter,
  KnowledgeItem,
  KnowledgeRepository,
  SearchKnowledgeInput
} from '@mcp-dev-mesh/core';
import { matchesKnowledgeFilter, rankKnowledgeItem } from '@mcp-dev-mesh/core';
import type { RawEvent, StorageBackend } from '@mcp-dev-mesh/extension-api';

export interface InMemoryStorageState {
  knowledgeItems: unknown[];
  events: RawEvent[];
  cursors: Record<string, string>;
}

export function createInMemoryStorageBackend(): StorageBackend & { state: InMemoryStorageState } {
  const state: InMemoryStorageState = {
    knowledgeItems: [],
    events: [],
    cursors: {}
  };

  return {
    id: 'dev-mesh.storage.memory',
    kind: 'storage-backend',
    capabilities: ['storage.memory'],
    priority: 1,
    knowledgeItems: state.knowledgeItems,
    events: state.events,
    cursors: state.cursors,
    state
  };
}

export const DEFAULT_POSTGRES_KNOWLEDGE_TABLE = 'dev_mesh_knowledge_items';

export interface PostgresExecutor {
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface PostgresKnowledgeRepositoryOptions {
  tableName?: string;
}

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  private readonly table: string;

  constructor(
    private readonly db: PostgresExecutor,
    options: PostgresKnowledgeRepositoryOptions = {}
  ) {
    this.table = quoteIdentifier(options.tableName ?? DEFAULT_POSTGRES_KNOWLEDGE_TABLE);
  }

  async upsert(item: KnowledgeItem): Promise<void> {
    await this.db.query(
      `
        INSERT INTO ${this.table} (
          id,
          item,
          layer,
          type,
          status,
          entry_key,
          para_category,
          para_key,
          author_name,
          tags,
          title,
          summary,
          content,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2::jsonb,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::text[],
          $11,
          $12,
          $13,
          $14::timestamptz,
          $15::timestamptz
        )
        ON CONFLICT (id) DO UPDATE SET
          item = EXCLUDED.item,
          layer = EXCLUDED.layer,
          type = EXCLUDED.type,
          status = EXCLUDED.status,
          entry_key = EXCLUDED.entry_key,
          para_category = EXCLUDED.para_category,
          para_key = EXCLUDED.para_key,
          author_name = EXCLUDED.author_name,
          tags = EXCLUDED.tags,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          content = EXCLUDED.content,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        item.id,
        JSON.stringify(item),
        item.layer,
        item.type,
        item.status,
        item.entryKey,
        item.para.category,
        item.para.key,
        item.createdBy.displayName,
        item.tags,
        item.title,
        item.summary,
        item.content ?? null,
        item.createdAt,
        item.updatedAt
      ]
    );
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    const result = await this.db.query(`SELECT item FROM ${this.table} WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? readKnowledgeItem(row) : undefined;
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    const items = await this.loadItems(filter);
    return items
      .filter((item) => matchesKnowledgeFilter(item, filter))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async search(input: SearchKnowledgeInput): Promise<KnowledgeItem[]> {
    const items = await this.loadItems(input, input.query, Math.max((input.limit ?? 8) * 4, 20));
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

  private async loadItems(filter: KnowledgeFilter, query?: string, limit?: number): Promise<KnowledgeItem[]> {
    const where: string[] = [];
    const values: unknown[] = [];

    if (!filter.includeSuperseded) {
      where.push(`status = ${addValue(values, 'active')}`);
    }

    if (filter.layers?.length) {
      where.push(`layer = ANY(${addValue(values, filter.layers)}::text[])`);
    }

    if (filter.types?.length) {
      where.push(`type = ANY(${addValue(values, filter.types)}::text[])`);
    }

    if (filter.para?.category) {
      where.push(`para_category = ${addValue(values, filter.para.category)}`);
    }

    if (filter.para?.key) {
      where.push(`para_key LIKE ${addValue(values, `${escapeLike(filter.para.key)}%`)}`);
    }

    if (filter.authorName) {
      where.push(`lower(author_name) LIKE ${addValue(values, `%${escapeLike(filter.authorName.toLowerCase())}%`)}`);
    }

    if (filter.tags?.length) {
      where.push(`tags @> ${addValue(values, filter.tags)}::text[]`);
    }

    if (filter.recencyDays !== undefined) {
      const threshold = new Date(Date.now() - filter.recencyDays * 24 * 60 * 60 * 1000).toISOString();
      where.push(`updated_at >= ${addValue(values, threshold)}::timestamptz`);
    }

    const normalizedQuery = query?.trim();

    if (normalizedQuery) {
      const like = `%${escapeLike(normalizedQuery)}%`;
      const placeholder = addValue(values, like);
      where.push(`(
        title ILIKE ${placeholder}
        OR summary ILIKE ${placeholder}
        OR COALESCE(content, '') ILIKE ${placeholder}
        OR entry_key ILIKE ${placeholder}
        OR array_to_string(tags, ' ') ILIKE ${placeholder}
      )`);
    }

    const sql = [
      `SELECT item FROM ${this.table}`,
      where.length ? `WHERE ${where.join(' AND ')}` : '',
      'ORDER BY updated_at DESC',
      limit !== undefined ? `LIMIT ${addValue(values, limit)}` : ''
    ]
      .filter(Boolean)
      .join('\n');
    const result = await this.db.query(sql, values);

    return result.rows.map(readKnowledgeItem);
  }
}

/**
 * Installs the minimal table needed by PostgresKnowledgeRepository. The table
 * stores the canonical item JSONB plus denormalized columns used for filtering
 * and coarse text search; this keeps repository reads simple while preserving
 * the full domain object.
 */
export async function migratePostgresKnowledgeRepository(
  db: PostgresExecutor,
  options: PostgresKnowledgeRepositoryOptions = {}
): Promise<void> {
  const table = quoteIdentifier(options.tableName ?? DEFAULT_POSTGRES_KNOWLEDGE_TABLE);
  const suffix = normalizeIdentifier(options.tableName ?? DEFAULT_POSTGRES_KNOWLEDGE_TABLE);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id text PRIMARY KEY,
      item jsonb NOT NULL,
      layer text NOT NULL,
      type text NOT NULL,
      status text NOT NULL,
      entry_key text NOT NULL,
      para_category text NOT NULL,
      para_key text NOT NULL,
      author_name text NOT NULL,
      tags text[] NOT NULL DEFAULT '{}',
      title text NOT NULL,
      summary text NOT NULL,
      content text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${suffix}_layer_idx`)}
      ON ${table} (layer);

    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${suffix}_type_idx`)}
      ON ${table} (type);

    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${suffix}_para_idx`)}
      ON ${table} (para_category, para_key);

    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${suffix}_tags_idx`)}
      ON ${table} USING GIN (tags);

    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${suffix}_updated_at_idx`)}
      ON ${table} (updated_at DESC);
  `);
}

export function createPostgresStorageBackend(
  db: PostgresExecutor,
  options: PostgresKnowledgeRepositoryOptions = {}
): StorageBackend & { knowledgeItems: PostgresKnowledgeRepository } {
  const knowledgeItems = new PostgresKnowledgeRepository(db, options);

  return {
    id: 'dev-mesh.storage.postgres',
    kind: 'storage-backend',
    capabilities: ['storage.postgres', 'knowledge.repository'],
    priority: 10,
    knowledgeItems,
    events: undefined,
    cursors: undefined
  };
}

function readKnowledgeItem(row: Record<string, unknown>): KnowledgeItem {
  const value = row.item;

  if (typeof value === 'string') {
    return JSON.parse(value) as KnowledgeItem;
  }

  return value as KnowledgeItem;
}

function addValue(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function quoteIdentifier(value: string): string {
  return `"${normalizeIdentifier(value).replace(/"/g, '""')}"`;
}

function normalizeIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }

  return value;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
