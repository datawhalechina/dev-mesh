import { readFile, writeFile } from 'node:fs/promises';
import type { KnowledgeItem } from '@devmesh/core';
import {
  buildKnowledgeGraph,
  exploreKnowledgeGraph,
  type ExploreKnowledgeGraphInput
} from '@devmesh/graph';
import { nowIso } from '@devmesh/shared';
import { getKnowledgeGraphIndexFile, pathExists } from './files.js';
import { loadProjectKnowledgeItems } from './knowledge-files.js';
import { ensureProjectStore } from './project-store.js';
import {
  PROJECT_STORE_SCHEMA_VERSION,
  type ProjectKnowledgeGraph,
  type ProjectKnowledgeGraphExploreResult,
  type RebuildProjectGraphResult
} from './types.js';

export async function rebuildProjectGraph(projectRoot: string): Promise<RebuildProjectGraphResult> {
  const store = await ensureProjectStore(projectRoot);
  const items = await loadProjectKnowledgeItems(projectRoot);

  return writeProjectGraphIndex(store.paths.indexDir, items, nowIso());
}

export async function writeProjectGraphIndex(
  indexDir: string,
  items: KnowledgeItem[],
  rebuiltAt: string
): Promise<RebuildProjectGraphResult> {
  const graphPath = getKnowledgeGraphIndexFile(indexDir);
  const graph = buildKnowledgeGraph(items, {
    now: () => new Date(rebuiltAt)
  });
  const payload: ProjectKnowledgeGraph = {
    schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
    ...graph
  };

  await writeFile(graphPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

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

  return JSON.parse(await readFile(graphPath, 'utf8')) as ProjectKnowledgeGraph;
}

export async function exploreProjectGraph(
  projectRoot: string,
  input: ExploreKnowledgeGraphInput = {}
): Promise<ProjectKnowledgeGraphExploreResult> {
  const items = await loadProjectKnowledgeItems(projectRoot);
  const graph = buildKnowledgeGraph(items);

  return exploreKnowledgeGraph(graph, input);
}
