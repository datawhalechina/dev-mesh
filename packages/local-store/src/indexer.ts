import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  getKnowledgeTypeProfile,
  type KnowledgeItem,
  type SearchKnowledgeInput
} from '@devmesh/core';
import type { KnowledgeGraphSemanticEdge } from '@devmesh/graph';
import { nowIso } from '@devmesh/shared';
import { ensureProjectStore } from './project-store.js';
import {
  getKnowledgeProjectionFile,
  getSearchProjectionFile,
  getSqliteIndexFile,
  pathExists
} from './files.js';
import { writeProjectGraphIndex } from './graph-indexer.js';
import { listProjectKnowledgeEdges } from './knowledge-edges.js';
import {
  loadProjectKnowledgeItems,
  readKnowledgeItemBranch
} from './knowledge-files.js';
import {
  PROJECT_STORE_SCHEMA_VERSION,
  type ProjectBranchScope,
  type ProjectIndexDocument,
  type ProjectIndexSearchResult,
  type RebuildProjectIndexResult
} from './types.js';

const requireNodeBuiltin = createRequire(import.meta.url);

export async function rebuildProjectIndex(projectRoot: string): Promise<RebuildProjectIndexResult> {
  const store = await ensureProjectStore(projectRoot);
  const items = await loadProjectKnowledgeItems(projectRoot);
  const semanticEdges = await listProjectKnowledgeEdges(projectRoot);

  return rebuildProjectIndexFromItems(store.paths.indexDir, items, semanticEdges);
}

export async function rebuildProjectIndexFromItems(
  indexDir: string,
  items: KnowledgeItem[],
  semanticEdges: KnowledgeGraphSemanticEdge[] = []
): Promise<RebuildProjectIndexResult> {
  const rebuiltAt = nowIso();
  const documents: ProjectIndexDocument[] = items.map((item) => ({
    id: item.id,
    branch: readKnowledgeItemBranch(item),
    entryKey: item.entryKey,
    layer: item.layer,
    type: item.type,
    includeInDefaultContext: getKnowledgeTypeProfile(item.type).includeInDefaultContext,
    ...expirationProjection(item),
    title: item.title,
    summary: item.summary,
    text: [item.title, item.summary, item.content, item.entryKey, item.tags.join(' ')].filter(Boolean).join('\n'),
    tags: item.tags,
    updatedAt: item.updatedAt
  }));
  const indexPath = join(indexDir, 'manifest.json');
  const knowledgePath = getKnowledgeProjectionFile(indexDir);
  const searchPath = getSearchProjectionFile(indexDir);
  const sqlitePath = getSqliteIndexFile(indexDir);
  const graph = await writeProjectGraphIndex(indexDir, items, rebuiltAt, semanticEdges);

  await writeFile(
    indexPath,
    `${JSON.stringify(
      {
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        rebuiltAt,
        documentCount: documents.length,
        documents
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  await rebuildKnowledgeProjection(knowledgePath, documents, rebuiltAt);
  await rebuildSearchProjection(searchPath, documents, rebuiltAt);

  return {
    indexPath,
    sqlitePath,
    knowledgePath,
    searchPath,
    graphPath: graph.graphPath,
    documentCount: documents.length,
    graphNodeCount: graph.nodeCount,
    graphEdgeCount: graph.edgeCount,
    rebuiltAt,
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION
  };
}

export async function searchProjectIndex(
  projectRoot: string,
  input: SearchKnowledgeInput,
  branchScope?: ProjectBranchScope
): Promise<ProjectIndexSearchResult[]> {
  return (await trySearchProjectIndex(projectRoot, input, branchScope)) ?? [];
}

export async function trySearchProjectIndex(
  projectRoot: string,
  input: SearchKnowledgeInput,
  branchScope?: ProjectBranchScope
): Promise<ProjectIndexSearchResult[] | undefined> {
  const store = await ensureProjectStore(projectRoot);
  const limit = input.limit ?? 8;
  const ftsQuery = createFtsQuery(input.query);

  if (ftsQuery === undefined) {
    const knowledgePath = getKnowledgeProjectionFile(store.paths.indexDir);

    if (!(await pathExists(knowledgePath))) {
      return undefined;
    }

    const db = await openSqliteDatabase(knowledgePath);

    try {
      const rows = db
        .prepare(
          `
        SELECT id
        FROM knowledge_documents
        ${whereSql(branchScope, input)}
        ORDER BY updated_at DESC
        LIMIT ?
      `
        )
        .all(...whereSqlValues(branchScope, input), limit);

      return rows.map((row, index) => ({
        id: readSqliteString(row.id),
        score: 1 / (index + 1)
      }));
    } finally {
      db.close();
    }
  }

  const searchPath = getSearchProjectionFile(store.paths.indexDir);

  if (!(await pathExists(searchPath))) {
    return undefined;
  }

  const db = await openSqliteDatabase(searchPath);

  try {
    const rows = db
      .prepare(
        `
        SELECT id, bm25(knowledge_fts, 2.0, 1.5, 1.0, 0.5) AS rank
        FROM knowledge_fts
        WHERE knowledge_fts MATCH ?
        ${andSql(branchScope, input)}
        ORDER BY rank
        LIMIT ?
      `
      )
      .all(ftsQuery, ...whereSqlValues(branchScope, input), limit);

    return rows.map((row, index) => ({
      id: readSqliteString(row.id),
      score: scoreSqliteRank(row.rank, index)
    }));
  } finally {
    db.close();
  }
}

async function rebuildKnowledgeProjection(
  knowledgePath: string,
  documents: ProjectIndexDocument[],
  rebuiltAt: string
): Promise<void> {
  await mkdir(dirname(knowledgePath), { recursive: true });
  await removeSqliteProjection(knowledgePath);
  const db = await openSqliteDatabase(knowledgePath);

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      DROP TABLE IF EXISTS projection_metadata;
      DROP TABLE IF EXISTS knowledge_documents;
      CREATE TABLE projection_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY,
        branch TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        layer TEXT NOT NULL,
        type TEXT NOT NULL,
        include_in_default_context INTEGER NOT NULL,
        expires_at TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        text TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    writeSqliteProjectionMetadata(db, {
      role: 'knowledge',
      rebuiltAt,
      documentCount: documents.length
    });

    const insertDocument = db.prepare(`
      INSERT INTO knowledge_documents (
        id,
        branch,
        entry_key,
        layer,
        type,
        include_in_default_context,
        expires_at,
        title,
        summary,
        text,
        tags_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN');
    try {
      for (const document of documents) {
        insertDocument.run(
          document.id,
          document.branch,
          document.entryKey,
          document.layer,
          document.type,
          document.includeInDefaultContext ? 1 : 0,
          document.expiresAt ?? null,
          document.title,
          document.summary,
          document.text,
          JSON.stringify(document.tags),
          document.updatedAt
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

async function rebuildSearchProjection(
  searchPath: string,
  documents: ProjectIndexDocument[],
  rebuiltAt: string
): Promise<void> {
  await mkdir(dirname(searchPath), { recursive: true });
  await removeSqliteProjection(searchPath);
  const db = await openSqliteDatabase(searchPath);

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      DROP TABLE IF EXISTS projection_metadata;
      DROP TABLE IF EXISTS knowledge_fts;
      CREATE TABLE projection_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE knowledge_fts
        USING fts5(
          id UNINDEXED,
          branch UNINDEXED,
          type UNINDEXED,
          include_in_default_context UNINDEXED,
          expires_at UNINDEXED,
          title,
          summary,
          text,
          tags
        );
    `);
    writeSqliteProjectionMetadata(db, {
      role: 'search',
      rebuiltAt,
      documentCount: documents.length
    });

    const insertFts = db.prepare(`
      INSERT INTO knowledge_fts (
        id,
        branch,
        type,
        include_in_default_context,
        expires_at,
        title,
        summary,
        text,
        tags
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN');
    try {
      for (const document of documents) {
        insertFts.run(
          document.id,
          document.branch,
          document.type,
          document.includeInDefaultContext ? 1 : 0,
          document.expiresAt ?? null,
          document.title,
          document.summary,
          document.text,
          document.tags.join(' ')
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

async function openSqliteDatabase(path: string): Promise<DatabaseSync> {
  const sqlite = requireNodeBuiltin('node:sqlite') as typeof import('node:sqlite');

  return new sqlite.DatabaseSync(path);
}

function writeSqliteProjectionMetadata(
  db: DatabaseSync,
  input: { role: string; rebuiltAt: string; documentCount: number }
): void {
  const insert = db.prepare('INSERT INTO projection_metadata (key, value) VALUES (?, ?)');

  insert.run('schemaVersion', String(PROJECT_STORE_SCHEMA_VERSION));
  insert.run('role', input.role);
  insert.run('rebuiltAt', input.rebuiltAt);
  insert.run('documentCount', String(input.documentCount));
}

async function removeSqliteProjection(path: string): Promise<void> {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true })
  ]);
}

function createFtsQuery(query: string): string | undefined {
  const terms = query
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((term) => term.trim())
    .filter(Boolean);

  if (!terms?.length) {
    return undefined;
  }

  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' ');
}

function readSqliteString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function whereSql(branchScope: ProjectBranchScope | undefined, input: SearchKnowledgeInput): string {
  const clauses = filterSqlClauses(branchScope, input);

  return clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
}

function andSql(branchScope: ProjectBranchScope | undefined, input: SearchKnowledgeInput): string {
  const clauses = filterSqlClauses(branchScope, input);

  return clauses.length === 0 ? '' : `AND ${clauses.join(' AND ')}`;
}

function filterSqlClauses(branchScope: ProjectBranchScope | undefined, input: SearchKnowledgeInput): string[] {
  const clauses: string[] = [];
  const branchPlaceholders = placeholders(branchScope?.readable);

  if (branchPlaceholders !== undefined) {
    clauses.push(`branch IN (${branchPlaceholders})`);
  }

  const typePlaceholders = placeholders(input.types);

  if (typePlaceholders !== undefined) {
    clauses.push(`type IN (${typePlaceholders})`);
  }

  if (input.includeVolatile !== true && typePlaceholders === undefined) {
    clauses.push('include_in_default_context = 1');
    clauses.push("(expires_at IS NULL OR expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
  }

  return clauses;
}

function placeholders(values: readonly unknown[] | undefined): string | undefined {
  return values === undefined || values.length === 0 ? undefined : values.map(() => '?').join(', ');
}

function whereSqlValues(branchScope: ProjectBranchScope | undefined, input: SearchKnowledgeInput): string[] {
  return [...(branchScope?.readable ?? []), ...(input.types ?? [])];
}

function scoreSqliteRank(value: unknown, index: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? 1 / (1 + Math.max(0, value)) : 1 / (index + 1);
}

function expirationProjection(item: KnowledgeItem): { expiresAt?: string } {
  const ttlDays = getKnowledgeTypeProfile(item.type).defaultTtlDays;

  if (ttlDays === undefined) {
    return {};
  }

  const updatedAt = Date.parse(item.updatedAt);

  if (Number.isNaN(updatedAt)) {
    return {};
  }

  return {
    expiresAt: new Date(updatedAt + ttlDays * 24 * 60 * 60 * 1000).toISOString()
  };
}
