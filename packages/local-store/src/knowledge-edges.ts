import { createKnowledgeId, type KnowledgeItem } from '@devmesh/core';
import { KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS, type KnowledgeGraphSemanticEdgeKind } from '@devmesh/graph';
import { DevMeshError, nowIso } from '@devmesh/shared';
import { appendProjectEvent } from './events.js';
import { appendJsonLine, getKnowledgeEdgeFile, getKnowledgeFile, readJsonl } from './files.js';
import { loadProjectKnowledgeItems } from './knowledge-files.js';
import { ensureProjectStore, projectKeyOptions, readProjectKey } from './project-store.js';
import type {
  CreateProjectKnowledgeEdgeInput,
  CreateProjectKnowledgeEdgeResult,
  ProjectCaptureOptions,
  ProjectKnowledgeEdge,
  ProjectKnowledgeEdgeQuery
} from './types.js';

export async function createProjectKnowledgeEdge(
  projectRoot: string,
  input: CreateProjectKnowledgeEdgeInput,
  options: ProjectCaptureOptions = {}
): Promise<CreateProjectKnowledgeEdgeResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const kind = normalizeKnowledgeEdgeKind(input.kind);
  const fromId = input.fromId.trim();
  const toId = input.toId.trim();

  if (!fromId || !toId) {
    throw new DevMeshError('knowledge_edge.target_required', 'Knowledge edge fromId and toId are required.', {
      fromId,
      toId
    });
  }

  if (fromId === toId) {
    throw new DevMeshError('knowledge_edge.self_reference', 'Knowledge edge cannot reference the same item.', {
      fromId,
      toId
    });
  }

  const items = await loadProjectKnowledgeItems(projectRoot);
  const fromItem = items.find((item) => item.id === fromId);
  const toItem = items.find((item) => item.id === toId);

  if (fromItem === undefined) {
    throw new DevMeshError('knowledge_edge.from_not_found', `Knowledge edge source item ${fromId} was not found.`, {
      fromId
    });
  }

  if (toItem === undefined) {
    throw new DevMeshError('knowledge_edge.to_not_found', `Knowledge edge target item ${toId} was not found.`, {
      toId
    });
  }

  const createdAt = nowIso();
  const projectKey = await readProjectKey(store, options.projectKey);
  const edge: ProjectKnowledgeEdge = {
    id: createKnowledgeId('edge'),
    kind,
    fromId,
    toId,
    projectKey,
    createdAt
  };
  const reason = input.reason?.trim();

  if (reason) {
    edge.reason = reason;
  }

  if (input.createdBy !== undefined) {
    edge.createdBy = input.createdBy;
  }

  if (kind === 'supersedes') {
    await appendSupersededKnowledgeItem(store.paths.knowledgeDir, toItem, createdAt);
  }

  await appendJsonLine(getKnowledgeEdgeFile(store.paths.knowledgeDir), edge);
  const event = await appendProjectEvent(
    projectRoot,
    'knowledge.edge.created',
    {
      edgeId: edge.id,
      kind: edge.kind,
      fromId: edge.fromId,
      toId: edge.toId,
      reason: edge.reason,
      createdBy: edge.createdBy
    },
    projectKey
  );

  return {
    edge,
    event
  };
}

export async function listProjectKnowledgeEdges(
  projectRoot: string,
  query: ProjectKnowledgeEdgeQuery = {}
): Promise<ProjectKnowledgeEdge[]> {
  const store = await ensureProjectStore(projectRoot);
  const edges = await readJsonl<ProjectKnowledgeEdge>(getKnowledgeEdgeFile(store.paths.knowledgeDir));

  return edges
    .filter((edge) => query.kind === undefined || edge.kind === query.kind)
    .filter((edge) => query.fromId === undefined || edge.fromId === query.fromId)
    .filter((edge) => query.toId === undefined || edge.toId === query.toId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

function normalizeKnowledgeEdgeKind(kind: KnowledgeGraphSemanticEdgeKind): KnowledgeGraphSemanticEdgeKind {
  if ((KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS as readonly string[]).includes(kind)) {
    return kind;
  }

  throw new DevMeshError('knowledge_edge.kind_invalid', `Knowledge edge kind ${kind} is invalid.`, {
    kind
  });
}

async function appendSupersededKnowledgeItem(
  knowledgeDir: string,
  item: KnowledgeItem,
  updatedAt: string
): Promise<void> {
  await appendJsonLine(getKnowledgeFile(knowledgeDir, item.layer), {
    ...item,
    status: 'superseded',
    updatedAt
  });
}
