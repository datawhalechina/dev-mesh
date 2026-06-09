import type { KnowledgeItem, ParaCategory } from '@devmesh/core';

export const KNOWLEDGE_GRAPH_NODE_KINDS = ['knowledge', 'para', 'type', 'tag', 'member', 'source'] as const;
export const KNOWLEDGE_GRAPH_METADATA_EDGE_KINDS = [
  'authored_by',
  'belongs_to_para',
  'has_type',
  'parent_para',
  'sourced_from',
  'tagged_with'
] as const;
export const KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS = ['supersedes', 'duplicates', 'contradicts'] as const;
export const KNOWLEDGE_GRAPH_EDGE_KINDS = [
  ...KNOWLEDGE_GRAPH_METADATA_EDGE_KINDS,
  ...KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS
] as const;

export type KnowledgeGraphNodeKind = (typeof KNOWLEDGE_GRAPH_NODE_KINDS)[number];
export type KnowledgeGraphMetadataEdgeKind = (typeof KNOWLEDGE_GRAPH_METADATA_EDGE_KINDS)[number];
export type KnowledgeGraphSemanticEdgeKind = (typeof KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS)[number];
export type KnowledgeGraphEdgeKind = (typeof KNOWLEDGE_GRAPH_EDGE_KINDS)[number];

export interface KnowledgeGraphNode {
  id: string;
  kind: KnowledgeGraphNodeKind;
  label: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: KnowledgeGraphEdgeKind;
  weight: number;
  evidence: string[];
}

export interface KnowledgeGraph {
  generatedAt: string;
  sourceItemCount: number;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface KnowledgeGraphSemanticEdge {
  id?: string;
  kind: KnowledgeGraphSemanticEdgeKind;
  fromId: string;
  toId: string;
  reason?: string;
  createdAt?: string;
}

export interface BuildKnowledgeGraphOptions {
  now?: () => Date;
  semanticEdges?: KnowledgeGraphSemanticEdge[] | undefined;
}

export interface ExploreKnowledgeGraphInput {
  ids?: string[] | undefined;
  query?: string | undefined;
  depth?: number | undefined;
  limit?: number | undefined;
  nodeKinds?: KnowledgeGraphNodeKind[] | undefined;
  edgeKinds?: KnowledgeGraphEdgeKind[] | undefined;
}

export interface ExploreKnowledgeGraphResult {
  generatedAt: string;
  seedNodeIds: string[];
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  totalNodes: number;
  totalEdges: number;
}

interface MutableGraph {
  nodes: Map<string, KnowledgeGraphNode>;
  edges: Map<string, KnowledgeGraphEdge>;
}

export function buildKnowledgeGraph(
  items: KnowledgeItem[],
  options: BuildKnowledgeGraphOptions = {}
): KnowledgeGraph {
  const graph: MutableGraph = {
    nodes: new Map(),
    edges: new Map()
  };

  for (const item of items) {
    addKnowledgeItemGraph(graph, item);
  }

  for (const edge of options.semanticEdges ?? []) {
    addKnowledgeSemanticEdgeGraph(graph, edge);
  }

  return {
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    sourceItemCount: items.length,
    nodes: [...graph.nodes.values()].sort(sortNodes),
    edges: [...graph.edges.values()].sort(sortEdges)
  };
}

export function exploreKnowledgeGraph(
  graph: KnowledgeGraph,
  input: ExploreKnowledgeGraphInput = {}
): ExploreKnowledgeGraphResult {
  const depth = clampInt(input.depth ?? 2, 0, 4);
  const limit = clampInt(input.limit ?? 40, 1, 200);
  const nodeKinds = input.nodeKinds === undefined ? undefined : new Set(input.nodeKinds);
  const edgeKinds = input.edgeKinds === undefined ? undefined : new Set(input.edgeKinds);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = createAdjacency(graph.edges.filter((edge) => edgeKinds === undefined || edgeKinds.has(edge.kind)));
  const seedNodeIds = selectSeedNodeIds(graph, input, limit);
  const visited = new Set<string>();
  const queue = seedNodeIds.map((id) => ({ id, distance: 0 }));

  while (queue.length > 0 && visited.size < limit) {
    const current = queue.shift();

    if (current === undefined || visited.has(current.id) || !nodesById.has(current.id)) {
      continue;
    }

    visited.add(current.id);

    if (current.distance >= depth) {
      continue;
    }

    for (const next of adjacency.get(current.id) ?? []) {
      if (!visited.has(next)) {
        queue.push({
          id: next,
          distance: current.distance + 1
        });
      }
    }
  }

  const visibleNodeIds = new Set(
    [...visited].filter((id) => {
      const node = nodesById.get(id);
      return node !== undefined && (nodeKinds === undefined || nodeKinds.has(node.kind));
    })
  );
  const nodes = [...visibleNodeIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is KnowledgeGraphNode => node !== undefined)
    .sort(sortNodes);
  const edges = graph.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .filter((edge) => edgeKinds === undefined || edgeKinds.has(edge.kind))
    .sort(sortEdges);

  return {
    generatedAt: graph.generatedAt,
    seedNodeIds,
    nodes,
    edges,
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length
  };
}

export function knowledgeNodeId(itemId: string): string {
  return nodeId('knowledge', itemId);
}

export function isKnowledgeGraphSemanticEdgeKind(value: KnowledgeGraphEdgeKind): value is KnowledgeGraphSemanticEdgeKind {
  return (KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS as readonly string[]).includes(value);
}

function addKnowledgeItemGraph(graph: MutableGraph, item: KnowledgeItem): void {
  const knowledgeId = knowledgeNodeId(item.id);
  addNode(graph, {
    id: knowledgeId,
    kind: 'knowledge',
    label: item.title,
    metadata: {
      itemId: item.id,
      entryKey: item.entryKey,
      layer: item.layer,
      type: item.type,
      status: item.status,
      summary: item.summary,
      updatedAt: item.updatedAt,
      qualityScore: item.quality.qualityScore
    }
  });

  const paraId = addParaNodes(graph, item.para.category, item.para.key);
  addEdge(graph, knowledgeId, paraId, 'belongs_to_para', item.id);

  const typeId = nodeId('type', item.type);
  addNode(graph, {
    id: typeId,
    kind: 'type',
    label: item.type,
    metadata: {
      type: item.type
    }
  });
  addEdge(graph, knowledgeId, typeId, 'has_type', item.id);

  for (const tag of item.tags) {
    const tagId = nodeId('tag', tag);
    addNode(graph, {
      id: tagId,
      kind: 'tag',
      label: tag,
      metadata: {
        tag
      }
    });
    addEdge(graph, knowledgeId, tagId, 'tagged_with', item.id);
  }

  const memberId = nodeId('member', item.createdBy.memberId ?? item.createdBy.handle ?? item.createdBy.displayName);
  addNode(graph, {
    id: memberId,
    kind: 'member',
    label: item.createdBy.displayName,
    metadata: {
      memberId: item.createdBy.memberId,
      handle: item.createdBy.handle,
      clientId: item.createdBy.clientId
    }
  });
  addEdge(graph, knowledgeId, memberId, 'authored_by', item.id);

  const sourceKey = [item.source.kind, item.source.ref, item.source.commit, item.source.url, item.source.storageRef]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(':');

  if (sourceKey.length > 0) {
    const sourceId = nodeId('source', sourceKey);
    addNode(graph, {
      id: sourceId,
      kind: 'source',
      label: sourceKey,
      metadata: {
        ...item.source
      }
    });
    addEdge(graph, knowledgeId, sourceId, 'sourced_from', item.id);
  }
}

function addKnowledgeSemanticEdgeGraph(graph: MutableGraph, edge: KnowledgeGraphSemanticEdge): void {
  const from = knowledgeNodeId(edge.fromId);
  const to = knowledgeNodeId(edge.toId);

  if (from === to || !graph.nodes.has(from) || !graph.nodes.has(to)) {
    return;
  }

  addEdge(graph, from, to, edge.kind, edge.id ?? `${edge.kind}:${edge.fromId}->${edge.toId}`);
}

function addParaNodes(graph: MutableGraph, category: ParaCategory, key: string): string {
  const parts = key.split('/').filter(Boolean);
  let currentKey = '';
  let parentId: string | undefined;
  let currentId = nodeId('para', `${category}:`);

  addNode(graph, {
    id: currentId,
    kind: 'para',
    label: category,
    metadata: {
      category,
      key: ''
    }
  });

  for (const part of parts) {
    parentId = currentId;
    currentKey = currentKey ? `${currentKey}/${part}` : part;
    currentId = nodeId('para', `${category}:${currentKey}`);
    addNode(graph, {
      id: currentId,
      kind: 'para',
      label: `${category}/${currentKey}`,
      metadata: {
        category,
        key: currentKey
      }
    });
    addEdge(graph, currentId, parentId, 'parent_para', `${category}:${currentKey}`);
  }

  return currentId;
}

function addNode(graph: MutableGraph, node: KnowledgeGraphNode): void {
  if (!graph.nodes.has(node.id)) {
    graph.nodes.set(node.id, node);
  }
}

function addEdge(
  graph: MutableGraph,
  from: string,
  to: string,
  kind: KnowledgeGraphEdgeKind,
  evidence: string
): void {
  const id = `${kind}:${from}->${to}`;
  const existing = graph.edges.get(id);

  if (existing !== undefined) {
    existing.weight += 1;
    existing.evidence = [...new Set([...existing.evidence, evidence])].sort();
    return;
  }

  graph.edges.set(id, {
    id,
    from,
    to,
    kind,
    weight: 1,
    evidence: [evidence]
  });
}

function createAdjacency(edges: KnowledgeGraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    pushAdjacent(adjacency, edge.from, edge.to);
    pushAdjacent(adjacency, edge.to, edge.from);
  }

  return adjacency;
}

function pushAdjacent(adjacency: Map<string, string[]>, from: string, to: string): void {
  const values = adjacency.get(from) ?? [];

  if (!values.includes(to)) {
    values.push(to);
    values.sort();
    adjacency.set(from, values);
  }
}

function selectSeedNodeIds(graph: KnowledgeGraph, input: ExploreKnowledgeGraphInput, limit: number): string[] {
  const explicit = (input.ids ?? []).map((id) => (id.startsWith('knowledge:') ? id : knowledgeNodeId(id)));

  if (explicit.length > 0) {
    return [...new Set(explicit)].slice(0, limit);
  }

  const query = input.query?.trim().toLowerCase();

  if (query !== undefined && query.length > 0) {
    return graph.nodes
      .map((node) => ({
        node,
        score: scoreNode(node, query)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
      .slice(0, limit)
      .map((candidate) => candidate.node.id);
  }

  return graph.nodes
    .filter((node) => node.kind === 'knowledge')
    .sort(sortKnowledgeNodesByUpdatedAt)
    .slice(0, limit)
    .map((node) => node.id);
}

function scoreNode(node: KnowledgeGraphNode, query: string): number {
  const haystack = [node.label, ...Object.values(node.metadata).map((value) => String(value))]
    .join('\n')
    .toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return 0;
  }

  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

function nodeId(kind: KnowledgeGraphNodeKind, key: string): string {
  return `${kind}:${encodeURIComponent(key)}`;
}

function sortNodes(a: KnowledgeGraphNode, b: KnowledgeGraphNode): number {
  return a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function sortKnowledgeNodesByUpdatedAt(a: KnowledgeGraphNode, b: KnowledgeGraphNode): number {
  return String(b.metadata.updatedAt ?? '').localeCompare(String(a.metadata.updatedAt ?? '')) || a.id.localeCompare(b.id);
}

function sortEdges(a: KnowledgeGraphEdge, b: KnowledgeGraphEdge): number {
  return a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.trunc(value), min), max);
}
