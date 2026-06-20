import { createKnowledgeId, type KnowledgeItem } from '@devmesh/core';
import { KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS, type KnowledgeGraphSemanticEdgeKind } from '@devmesh/graph';
import { DevMeshError, nowIso } from '@devmesh/shared';
import { appendProjectEvent } from './events.js';
import { appendJsonLine, getKnowledgeEdgeFile, getKnowledgeFile, readJsonl } from './files.js';
import { DEFAULT_KNOWLEDGE_BRANCH, loadProjectKnowledgeItems } from './knowledge-files.js';
import { ensureProjectStore, projectKeyOptions, readProjectBranchScope, readProjectKey } from './project-store.js';
import { createProjectRelationInCrdt, upsertProjectKnowledgeToCrdt } from './crdt.js';
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
  const branch = input.branch ?? options.branch ?? (await readProjectBranchScope(projectRoot)).active;
  const edge: ProjectKnowledgeEdge = {
    id: createKnowledgeId('edge'),
    kind,
    fromId,
    toId,
    projectKey,
    branch,
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
    await upsertProjectKnowledgeToCrdt(projectRoot, {
      ...toItem,
      status: 'superseded',
      updatedAt: createdAt
    }, crdtWriteOptions(options.projectKey, `Supersede knowledge ${toItem.id}`));
  }

  await appendJsonLine(getKnowledgeEdgeFile(store.paths.knowledgeDir), edge);
  const crdtRelation = {
    id: edge.id,
    kind: edge.kind,
    fromId: edge.fromId,
    toId: edge.toId,
    createdAt: edge.createdAt,
    evidenceKnowledgeIds: [edge.fromId, edge.toId],
    confidence: 0.8
  };

  if (edge.createdBy !== undefined) {
    Object.assign(crdtRelation, {
      createdBy: edge.createdBy
    });
  }

  await createProjectRelationInCrdt(
    projectRoot,
    crdtRelation,
    crdtWriteOptions(options.projectKey, `Create knowledge edge ${edge.id}`)
  );
  const event = await appendProjectEvent(
    projectRoot,
    'knowledge.edge.created',
    {
      edgeId: edge.id,
      kind: edge.kind,
      fromId: edge.fromId,
      toId: edge.toId,
      branch: edge.branch,
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
    .filter((edge) => query.branch === undefined || readProjectKnowledgeEdgeBranch(edge) === query.branch)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function filterProjectKnowledgeEdgesByBranchScope(
  edges: ProjectKnowledgeEdge[],
  scope: { readable: string[] } | undefined
): ProjectKnowledgeEdge[] {
  if (scope === undefined) {
    return edges;
  }

  const readable = new Set(scope.readable);

  return edges.filter((edge) => readable.has(readProjectKnowledgeEdgeBranch(edge)));
}

export function readProjectKnowledgeEdgeBranch(edge: ProjectKnowledgeEdge): string {
  return edge.branch ?? DEFAULT_KNOWLEDGE_BRANCH;
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

function crdtWriteOptions(projectKey: string | undefined, summary: string): { projectKey?: string; summary: string } {
  const options: { projectKey?: string; summary: string } = {
    summary
  };

  if (projectKey !== undefined) {
    options.projectKey = projectKey;
  }

  return options;
}
