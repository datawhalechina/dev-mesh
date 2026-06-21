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

export interface KnowledgeGraphPathStep {
  from: string;
  to: string;
  edgeId: string;
  kind: KnowledgeGraphEdgeKind;
  direction: 'forward' | 'reverse';
}

export interface KnowledgeGraphPathResult {
  generatedAt: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceNode?: KnowledgeGraphNode;
  targetNode?: KnowledgeGraphNode;
  pathFound: boolean;
  nodeIds: string[];
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  steps: KnowledgeGraphPathStep[];
  explanation: string;
  exploredNodeCount: number;
  message?: string;
}

export interface FindKnowledgeGraphPathInput {
  sourceId?: string | undefined;
  sourceQuery?: string | undefined;
  targetId?: string | undefined;
  targetQuery?: string | undefined;
  depth?: number | undefined;
  limit?: number | undefined;
  nodeKinds?: KnowledgeGraphNodeKind[] | undefined;
  edgeKinds?: KnowledgeGraphEdgeKind[] | undefined;
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

export function findKnowledgeGraphPath(
  graph: KnowledgeGraph,
  input: FindKnowledgeGraphPathInput = {}
): KnowledgeGraphPathResult {
  const depth = clampInt(input.depth ?? 4, 1, 8);
  const limit = clampInt(input.limit ?? 120, 2, 400);
  const nodeKinds = input.nodeKinds === undefined ? new Set<KnowledgeGraphNodeKind>(['knowledge']) : new Set(input.nodeKinds);
  const edgeKinds =
    input.edgeKinds === undefined ? new Set<KnowledgeGraphEdgeKind>(KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS) : new Set(input.edgeKinds);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.filter((edge) => edgeKinds === undefined || edgeKinds.has(edge.kind));
  const adjacency = createPathAdjacency(edges);
  const source = resolvePathEndpoint(graph, nodesById, input.sourceId, input.sourceQuery, nodeKinds);
  const target = resolvePathEndpoint(graph, nodesById, input.targetId, input.targetQuery, nodeKinds);

  if (source.node === undefined || target.node === undefined) {
    const result: KnowledgeGraphPathResult = {
      generatedAt: graph.generatedAt,
      sourceNodeId: source.node?.id ?? source.nodeId,
      targetNodeId: target.node?.id ?? target.nodeId,
      pathFound: false,
      nodeIds: [],
      nodes: [],
      edges: [],
      steps: [],
      explanation: 'Unable to resolve one or both path endpoints.',
      exploredNodeCount: 0,
      message: source.node === undefined
        ? describeMissingEndpoint('source', source)
        : describeMissingEndpoint('target', target)
    };

    if (source.node !== undefined) {
      result.sourceNode = source.node;
    }

    if (target.node !== undefined) {
      result.targetNode = target.node;
    }

    if (source.query !== undefined) {
      result.message = `${result.message ?? ''}${result.message === undefined ? '' : ' '}`;
    }

    if (target.query !== undefined) {
      result.message = result.message ?? 'Unable to resolve one or both path endpoints.';
    }

    return result;
  }

  if (source.node.id === target.node.id) {
    const result: KnowledgeGraphPathResult = {
      generatedAt: graph.generatedAt,
      sourceNodeId: source.node.id,
      targetNodeId: target.node.id,
      pathFound: true,
      nodeIds: [source.node.id],
      nodes: [source.node],
      edges: [],
      steps: [],
      explanation: `Source and target already resolve to ${source.node.label}.`,
      exploredNodeCount: 1
    };

    if (source.query !== undefined) {
      result.message = `Source query: ${source.query}.`;
    }

    if (target.query !== undefined) {
      result.message = `${result.message ?? ''}${result.message?.length ? ' ' : ''}Target query: ${target.query}.`;
    }

    return result;
  }

  const visited = new Set<string>([source.node.id]);
  const queue: Array<{ id: string; distance: number }> = [{ id: source.node.id, distance: 0 }];
  const parents = new Map<string, { from: string; edgeId: string; direction: 'forward' | 'reverse' }>();
  let exploredNodeCount = 0;

  while (queue.length > 0 && visited.size < limit) {
    const current = queue.shift();

    if (current === undefined || current.distance > depth) {
      continue;
    }

    exploredNodeCount += 1;

    if (current.id === target.node.id) {
      break;
    }

    if (current.distance >= depth) {
      continue;
    }

    for (const next of adjacency.get(current.id) ?? []) {
      if (visited.has(next)) {
        continue;
      }

      const nextNode = nodesById.get(next);

      if (nextNode === undefined) {
        continue;
      }

      if (nextNode.id !== target.node.id && nextNode.id !== source.node.id && !nodeKinds.has(nextNode.kind)) {
        continue;
      }

      const edge = selectPathEdge(edges, current.id, next);

      if (edge === undefined) {
        continue;
      }

      visited.add(next);
      parents.set(next, {
        from: current.id,
        edgeId: edge.id,
        direction: edge.from === current.id && edge.to === next ? 'forward' : 'reverse'
      });
      queue.push({ id: next, distance: current.distance + 1 });
    }
  }

  if (!parents.has(target.node.id)) {
    const result: KnowledgeGraphPathResult = {
      generatedAt: graph.generatedAt,
      sourceNodeId: source.node.id,
      targetNodeId: target.node.id,
      pathFound: false,
      nodeIds: [],
      nodes: [],
      edges: [],
      steps: [],
      explanation: `No path found within depth ${depth}.`,
      exploredNodeCount,
      message: `No path found between ${source.node.label} and ${target.node.label} within depth ${depth} and limit ${limit}.`
    };

    result.sourceNode = source.node;
    result.targetNode = target.node;

    if (source.query !== undefined) {
      result.message = `${result.message ?? ''} Source query: ${source.query}.`;
    }

    if (target.query !== undefined) {
      result.message = `${result.message ?? ''} Target query: ${target.query}.`;
    }

    return result;
  }

  const nodeIds = reconstructPathNodeIds(source.node.id, target.node.id, parents);
  const nodes = nodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is KnowledgeGraphNode => node !== undefined);
  const steps = reconstructPathSteps(nodeIds, parents);
  const pathEdges = steps
    .map((step) => edges.find((edge) => edge.id === step.edgeId))
    .filter((edge): edge is KnowledgeGraphEdge => edge !== undefined);

  const result: KnowledgeGraphPathResult = {
    generatedAt: graph.generatedAt,
    sourceNodeId: source.node.id,
    targetNodeId: target.node.id,
    pathFound: true,
    nodeIds,
    nodes,
    edges: pathEdges,
    steps,
    explanation: describePath(nodes, steps),
    exploredNodeCount
  };

  result.sourceNode = source.node;
  result.targetNode = target.node;

  if (source.query !== undefined) {
    result.message = `Source query: ${source.query}.`;
  }

  if (target.query !== undefined) {
    result.message = `${result.message ?? ''}${result.message?.length ? ' ' : ''}Target query: ${target.query}.`;
  }

  return result;
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

function createPathAdjacency(edges: KnowledgeGraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    pushAdjacent(adjacency, edge.from, edge.to);
    pushAdjacent(adjacency, edge.to, edge.from);
  }

  return adjacency;
}

function selectPathEdge(edges: KnowledgeGraphEdge[], from: string, to: string): KnowledgeGraphEdge | undefined {
  return edges.find((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from));
}

function resolvePathEndpoint(
  graph: KnowledgeGraph,
  nodesById: Map<string, KnowledgeGraphNode>,
  id: string | undefined,
  query: string | undefined,
  nodeKinds: Set<KnowledgeGraphNodeKind> | undefined
): { nodeId: string; node?: KnowledgeGraphNode; query?: string; score?: number } {
  if (id !== undefined) {
    const candidates = id.startsWith('knowledge:')
      || id.startsWith('para:')
      || id.startsWith('type:')
      || id.startsWith('tag:')
      || id.startsWith('member:')
      || id.startsWith('source:')
      ? [id]
      : [id, knowledgeNodeId(id)];
    const nodeId = candidates.find((candidate) => nodesById.has(candidate));

    if (nodeId === undefined) {
      return { nodeId: candidates[0] ?? id };
    }

    const node = nodesById.get(nodeId);

    if (node !== undefined && (nodeKinds === undefined || nodeKinds.has(node.kind))) {
      return { nodeId, node };
    }

    const result: { nodeId: string; node?: KnowledgeGraphNode; query?: string; score?: number } = { nodeId };

    if (node !== undefined) {
      result.node = node;
    }

    return result;
  }

  const trimmedQuery = query?.trim().toLowerCase();

  if (trimmedQuery === undefined || trimmedQuery.length === 0) {
    return { nodeId: '' };
  }

  const candidate = graph.nodes
    .filter((node) => nodeKinds === undefined || nodeKinds.has(node.kind))
    .map((node) => ({ node, score: scoreNode(node, trimmedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))[0];

  if (candidate === undefined) {
    return { nodeId: '' };
  }

  const result: { nodeId: string; node?: KnowledgeGraphNode; query?: string; score?: number } = {
    nodeId: candidate.node.id,
    node: candidate.node,
    score: candidate.score
  };

  if (query !== undefined) {
    result.query = query;
  }

  return result;
}

function reconstructPathNodeIds(
  sourceId: string,
  targetId: string,
  parents: Map<string, { from: string; edgeId: string; direction: 'forward' | 'reverse' }>
): string[] {
  const nodeIds = [targetId];
  let current = targetId;

  while (current !== sourceId) {
    const parent = parents.get(current);

    if (parent === undefined) {
      return [];
    }

    current = parent.from;
    nodeIds.push(current);
  }

  nodeIds.reverse();
  return nodeIds;
}

function reconstructPathSteps(
  nodeIds: string[],
  parents: Map<string, { from: string; edgeId: string; direction: 'forward' | 'reverse' }>
): KnowledgeGraphPathStep[] {
  const steps: KnowledgeGraphPathStep[] = [];

  for (let index = 1; index < nodeIds.length; index += 1) {
    const current = nodeIds[index];
    const previous = nodeIds[index - 1];

    if (current === undefined || previous === undefined) {
      continue;
    }

    const parent = parents.get(current);

    if (parent === undefined) {
      continue;
    }

    const edge = parent.edgeId;
    const kind = edge.includes(':') ? (edge.split(':', 1)[0] as KnowledgeGraphEdgeKind) : 'supersedes';

    steps.push({
      from: previous,
      to: current,
      edgeId: edge,
      kind,
      direction: parent.direction
    });
  }

  return steps;
}

function describePath(nodes: KnowledgeGraphNode[], steps: KnowledgeGraphPathStep[]): string {
  if (nodes.length === 0) {
    return 'No path found.';
  }

  if (steps.length === 0) {
    return `Resolved to ${nodes[0]?.label ?? 'a single node'}.`;
  }

  const parts: string[] = [];

  for (const step of steps) {
    const direction = step.direction === 'forward' ? '->' : '<-';
    parts.push(`${labelForPathNode(step.from)} ${direction}[${step.kind}] ${labelForPathNode(step.to)}`);
  }

  return parts.join(' | ');
}

function labelForPathNode(value: string): string {
  const decoded = value.includes(':') ? value.slice(value.indexOf(':') + 1) : value;

  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded;
  }
}

function describeMissingEndpoint(
  side: 'source' | 'target',
  endpoint: { nodeId: string; node?: KnowledgeGraphNode; query?: string }
): string {
  if (endpoint.query !== undefined) {
    return `Unable to resolve ${side} query "${endpoint.query}".`;
  }

  if (endpoint.nodeId.length > 0) {
    return `Unable to resolve ${side} node "${endpoint.nodeId}".`;
  }

  return `Missing ${side} selector.`;
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
