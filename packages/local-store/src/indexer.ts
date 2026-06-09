import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { SearchKnowledgeInput } from '@devmesh/core';
import { nowIso } from '@devmesh/shared';
import { ensureProjectStore } from './project-store.js';
import { getSqliteIndexFile, pathExists } from './files.js';
import { writeProjectGraphIndex } from './graph-indexer.js';
import { listProjectKnowledgeEdges } from './knowledge-edges.js';
import { loadProjectKnowledgeItems } from './knowledge-files.js';
import {
  PROJECT_STORE_SCHEMA_VERSION,
  type ProjectIndexDocument,
  type ProjectIndexSearchResult,
  type RebuildProjectIndexResult
} from './types.js';

const requireNodeBuiltin = createRequire(import.meta.url);

export async function rebuildProjectIndex(projectRoot: string): Promise<RebuildProjectIndexResult> {
  const store = await ensureProjectStore(projectRoot);
  const items = await loadProjectKnowledgeItems(projectRoot);
  const semanticEdges = await listProjectKnowledgeEdges(projectRoot);
  const rebuiltAt = nowIso();
  const documents: ProjectIndexDocument[] = items.map((item) => ({
    id: item.id,
    entryKey: item.entryKey,
    layer: item.layer,
    type: item.type,
    title: item.title,
    summary: item.summary,
    text: [item.title, item.summary, item.content, item.entryKey, item.tags.join(' ')].filter(Boolean).join('\n'),
    tags: item.tags,
    updatedAt: item.updatedAt
  }));
  const indexPath = join(store.paths.indexDir, 'manifest.json');
  const sqlitePath = getSqliteIndexFile(store.paths.indexDir);
  const graph = await writeProjectGraphIndex(store.paths.indexDir, items, rebuiltAt, semanticEdges);

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
  await rebuildSqliteIndex(sqlitePath, documents);

  return {
    indexPath,
    sqlitePath,
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
  input: SearchKnowledgeInput
): Promise<ProjectIndexSearchResult[]> {
  return (await trySearchProjectIndex(projectRoot, input)) ?? [];
}

export async function trySearchProjectIndex(
  projectRoot: string,
  input: SearchKnowledgeInput
): Promise<ProjectIndexSearchResult[] | undefined> {
  const store = await ensureProjectStore(projectRoot);
  const sqlitePath = getSqliteIndexFile(store.paths.indexDir);

  if (!(await pathExists(sqlitePath))) {
    return undefined;
  }

  const db = await openSqliteDatabase(sqlitePath);

  try {
    const limit = input.limit ?? 8;
    const ftsQuery = createFtsQuery(input.query);

    if (ftsQuery === undefined) {
      const rows = db
        .prepare(
          `
          SELECT id
          FROM knowledge_documents
          ORDER BY updated_at DESC
          LIMIT ?
        `
        )
        .all(limit);

      return rows.map((row, index) => ({
        id: readSqliteString(row.id),
        score: 1 / (index + 1)
      }));
    }

    const rows = db
      .prepare(
        `
        SELECT id, bm25(knowledge_fts, 2.0, 1.5, 1.0, 0.5) AS rank
        FROM knowledge_fts
        WHERE knowledge_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
      )
      .all(ftsQuery, limit);

    return rows.map((row, index) => ({
      id: readSqliteString(row.id),
      score: scoreSqliteRank(row.rank, index)
    }));
  } finally {
    db.close();
  }
}

async function rebuildSqliteIndex(sqlitePath: string, documents: ProjectIndexDocument[]): Promise<void> {
  await mkdir(dirname(sqlitePath), { recursive: true });
  const db = await openSqliteDatabase(sqlitePath);

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        entry_key TEXT NOT NULL,
        layer TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        text TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
        USING fts5(id UNINDEXED, title, summary, text, tags);
      DELETE FROM knowledge_documents;
      DELETE FROM knowledge_fts;
    `);

    const insertDocument = db.prepare(`
      INSERT INTO knowledge_documents (
        id,
        entry_key,
        layer,
        type,
        title,
        summary,
        text,
        tags_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO knowledge_fts (id, title, summary, text, tags)
      VALUES (?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN');
    try {
      for (const document of documents) {
        insertDocument.run(
          document.id,
          document.entryKey,
          document.layer,
          document.type,
          document.title,
          document.summary,
          document.text,
          JSON.stringify(document.tags),
          document.updatedAt
        );
        insertFts.run(document.id, document.title, document.summary, document.text, document.tags.join(' '));
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

function scoreSqliteRank(value: unknown, index: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? 1 / (1 + Math.max(0, value)) : 1 / (index + 1);
}
