import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { KnowledgeItem } from '@devmesh/core';
import {
  buildKnowledgeGraph,
  exploreKnowledgeGraph,
  type ExploreKnowledgeGraphInput,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type KnowledgeGraphSemanticEdge
} from '@devmesh/graph';
import { nowIso } from '@devmesh/shared';
import { getKnowledgeGraphIndexFile, pathExists } from './files.js';
import { filterProjectKnowledgeEdgesByBranchScope, listProjectKnowledgeEdges } from './knowledge-edges.js';
import { filterKnowledgeItemsByBranchScope, loadProjectKnowledgeItems } from './knowledge-files.js';
import { ensureProjectStore, readProjectBranchScope } from './project-store.js';
import { loadBranchKnowledgeEdgesFromCrdt, loadBranchKnowledgeItemsFromCrdt } from './crdt.js';
import {
  PROJECT_STORE_SCHEMA_VERSION,
  type ProjectBranchScope,
  type ProjectKnowledgeGraph,
  type ProjectKnowledgeGraphExploreResult,
  type RebuildProjectGraphResult
} from './types.js';

const requireNodeBuiltin = createRequire(import.meta.url);

export async function rebuildProjectGraph(projectRoot: string): Promise<RebuildProjectGraphResult> {
  const store = await ensureProjectStore(projectRoot);
  const graphInput = await loadProjectGraphInput(projectRoot, await readProjectBranchScope(projectRoot));

  return writeProjectGraphIndex(store.paths.indexDir, graphInput.items, nowIso(), graphInput.semanticEdges);
}

export async function writeProjectGraphIndex(
  indexDir: string,
  items: KnowledgeItem[],
  rebuiltAt: string,
  semanticEdges: KnowledgeGraphSemanticEdge[] = []
): Promise<RebuildProjectGraphResult> {
  const graphPath = getKnowledgeGraphIndexFile(indexDir);
  const graph = buildKnowledgeGraph(items, {
    now: () => new Date(rebuiltAt),
    semanticEdges
  });

  await writeGraphProjection(graphPath, {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    ...graph
  });

  return {
    graphPath,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    sourceItemCount: graph.sourceItemCount,
    rebuiltAt,
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION
  };
}

export async function readProjectGraph(projectRoot: string): Promise<ProjectKnowledgeGraph | undefined> {
  const store = await ensureProjectStore(projectRoot);
  const graphPath = getKnowledgeGraphIndexFile(store.paths.indexDir);

  if (!(await pathExists(graphPath))) {
    return undefined;
  }

  return readGraphProjection(graphPath);
}

export async function exploreProjectGraph(
  projectRoot: string,
  input: ExploreKnowledgeGraphInput = {},
  branchScope?: ProjectBranchScope
): Promise<ProjectKnowledgeGraphExploreResult> {
  const graphInput = await loadProjectGraphInput(projectRoot, branchScope ?? (await readProjectBranchScope(projectRoot)));
  const graph = buildKnowledgeGraph(graphInput.items, {
    semanticEdges: graphInput.semanticEdges
  });

  return exploreKnowledgeGraph(graph, input);
}

async function loadProjectGraphInput(
  projectRoot: string,
  branchScope: ProjectBranchScope | undefined
): Promise<{ items: KnowledgeItem[]; semanticEdges: KnowledgeGraphSemanticEdge[] }> {
  const items = filterKnowledgeItemsByBranchScope(await loadProjectKnowledgeItems(projectRoot), branchScope);
  const semanticEdges = filterProjectKnowledgeEdgesByBranchScope(await listProjectKnowledgeEdges(projectRoot), branchScope);

  if (branchScope?.base === undefined) {
    return {
      items,
      semanticEdges
    };
  }

  return {
    items: mergeKnowledgeItems([
      ...items,
      ...(await loadBranchKnowledgeItemsFromCrdt(projectRoot, branchScope.base))
    ]),
    semanticEdges: mergeSemanticEdges([
      ...semanticEdges,
      ...(await loadBranchKnowledgeEdgesFromCrdt(projectRoot, branchScope.base))
    ])
  };
}

function mergeKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  const byId = new Map<string, KnowledgeItem>();

  for (const item of items) {
    const existing = byId.get(item.id);

    if (existing === undefined || item.updatedAt >= existing.updatedAt) {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()];
}

function mergeSemanticEdges(edges: KnowledgeGraphSemanticEdge[]): KnowledgeGraphSemanticEdge[] {
  const byId = new Map<string, KnowledgeGraphSemanticEdge>();

  for (const edge of edges) {
    byId.set(readSemanticEdgeKey(edge), edge);
  }

  return [...byId.values()];
}

function readSemanticEdgeKey(edge: KnowledgeGraphSemanticEdge): string {
  return edge.id ?? `${edge.kind}:${edge.fromId}->${edge.toId}`;
}

async function writeGraphProjection(path: string, graph: ProjectKnowledgeGraph): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await removeSqliteProjection(path);
  const db = await openSqliteDatabase(path);

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      DROP TABLE IF EXISTS projection_metadata;
      DROP TABLE IF EXISTS graph_summary;
      DROP TABLE IF EXISTS graph_nodes;
      DROP TABLE IF EXISTS graph_edges;
      CREATE TABLE projection_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE graph_summary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        generated_at TEXT NOT NULL,
        source_item_count INTEGER NOT NULL
      );
      CREATE TABLE graph_nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE graph_edges (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        weight REAL NOT NULL,
        evidence_json TEXT NOT NULL
      );
    `);

    const insertMetadata = db.prepare('INSERT INTO projection_metadata (key, value) VALUES (?, ?)');
    insertMetadata.run('schemaVersion', String(graph.schemaVersion));
    insertMetadata.run('role', 'graph');
    insertMetadata.run('rebuiltAt', graph.generatedAt);
    insertMetadata.run('nodeCount', String(graph.nodes.length));
    insertMetadata.run('edgeCount', String(graph.edges.length));

    db.prepare('INSERT INTO graph_summary (id, generated_at, source_item_count) VALUES (1, ?, ?)').run(
      graph.generatedAt,
      graph.sourceItemCount
    );

    const insertNode = db.prepare(`
      INSERT INTO graph_nodes (id, kind, label, metadata_json)
      VALUES (?, ?, ?, ?)
    `);
    const insertEdge = db.prepare(`
      INSERT INTO graph_edges (id, from_id, to_id, kind, weight, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN');
    try {
      for (const node of graph.nodes) {
        insertNode.run(node.id, node.kind, node.label, JSON.stringify(node.metadata));
      }

      for (const edge of graph.edges) {
        insertEdge.run(edge.id, edge.from, edge.to, edge.kind, edge.weight, JSON.stringify(edge.evidence));
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

async function readGraphProjection(path: string): Promise<ProjectKnowledgeGraph> {
  const db = await openSqliteDatabase(path);

  try {
    const schemaVersion = Number(readMetadataValue(db, 'schemaVersion'));
    const summary = db.prepare('SELECT generated_at, source_item_count FROM graph_summary WHERE id = 1').get();
    const nodeRows = db.prepare('SELECT id, kind, label, metadata_json FROM graph_nodes ORDER BY kind, label, id').all();
    const edgeRows = db
      .prepare('SELECT id, from_id, to_id, kind, weight, evidence_json FROM graph_edges ORDER BY kind, from_id, to_id')
      .all();

    return {
      schemaVersion,
      generatedAt: readSqliteString(summary?.generated_at),
      sourceItemCount: readSqliteNumber(summary?.source_item_count),
      nodes: nodeRows.map(readGraphNode),
      edges: edgeRows.map(readGraphEdge)
    };
  } finally {
    db.close();
  }
}

async function openSqliteDatabase(path: string): Promise<DatabaseSync> {
  const sqlite = requireNodeBuiltin('node:sqlite') as typeof import('node:sqlite');

  return new sqlite.DatabaseSync(path);
}

function readMetadataValue(db: DatabaseSync, key: string): string {
  const row = db.prepare('SELECT value FROM projection_metadata WHERE key = ?').get(key);

  return readSqliteString(row?.value);
}

function readGraphNode(row: Record<string, unknown>): KnowledgeGraphNode {
  return {
    id: readSqliteString(row.id),
    kind: readSqliteString(row.kind) as KnowledgeGraphNode['kind'],
    label: readSqliteString(row.label),
    metadata: readJsonRecord(row.metadata_json)
  };
}

function readGraphEdge(row: Record<string, unknown>): KnowledgeGraphEdge {
  return {
    id: readSqliteString(row.id),
    from: readSqliteString(row.from_id),
    to: readSqliteString(row.to_id),
    kind: readSqliteString(row.kind) as KnowledgeGraphEdge['kind'],
    weight: readSqliteNumber(row.weight),
    evidence: readJsonStringArray(row.evidence_json)
  };
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  const parsed = JSON.parse(readSqliteString(value)) as unknown;

  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function readJsonStringArray(value: unknown): string[] {
  const parsed = JSON.parse(readSqliteString(value)) as unknown;

  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readSqliteString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function readSqliteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
}

async function removeSqliteProjection(path: string): Promise<void> {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true })
  ]);
}
