import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const paraSchema = z.object({
  category: z.enum(['projects', 'areas', 'resources', 'archives']).optional(),
  key: z.string().min(1).optional()
});

const paraRefSchema = z.object({
  category: z.enum(['projects', 'areas', 'resources', 'archives']),
  key: z.string().min(1)
});

const knowledgeLayerSchema = z.enum(['raw', 'extract', 'canonical']);
const knowledgeVisibilitySchema = z.enum(['private', 'project', 'team', 'org']);
const knowledgeStatusSchema = z.enum(['active', 'superseded', 'tombstone']);

const knowledgeSourceSchema = z.object({
  kind: z.string().min(1),
  ref: z.string().optional(),
  url: z.string().optional(),
  commit: z.string().optional(),
  storageRef: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const memberIdentitySchema = z.object({
  memberId: z.string().optional(),
  displayName: z.string().min(1),
  handle: z.string().optional(),
  clientId: z.string().optional()
});

export const meshSearchContextInputSchema = z.object({
  query: z.string().min(1),
  project: z.string().default('auto'),
  authorName: z.string().nullable().optional(),
  para: paraSchema.nullable().optional(),
  layers: z.array(z.enum(['raw', 'extract', 'canonical'])).default(['canonical', 'extract']),
  types: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).default(8),
  recencyDays: z.number().int().positive().optional(),
  includeSuperseded: z.boolean().default(false)
});

export const meshGetStatusInputSchema = z.object({
  project: z.string().default('auto')
});

export const meshGetKnowledgeInputSchema = z.object({
  id: z.string().min(1)
});

export const meshListKnowledgeInputSchema = z.object({
  layers: z.array(knowledgeLayerSchema).optional(),
  types: z.array(z.string().min(1)).optional(),
  para: paraSchema.nullable().optional(),
  authorName: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  includeSuperseded: z.boolean().default(false),
  recencyDays: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(20)
});

export const meshCaptureKnowledgeInputSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  content: z.string().optional(),
  layer: knowledgeLayerSchema.default('extract'),
  para: paraRefSchema.optional(),
  tags: z.array(z.string()).default([]),
  visibility: knowledgeVisibilitySchema.default('project'),
  confidence: z.number().min(0).max(1).optional(),
  weight: z.number().min(0).default(1),
  source: knowledgeSourceSchema.optional(),
  createdBy: memberIdentitySchema.optional()
});

export const meshUpdateKnowledgeInputSchema = z
  .object({
    id: z.string().min(1),
    layer: knowledgeLayerSchema.optional(),
    entryKey: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    content: z.string().nullable().optional(),
    para: paraRefSchema.optional(),
    tags: z.array(z.string()).optional(),
    source: knowledgeSourceSchema.optional(),
    visibility: knowledgeVisibilitySchema.optional(),
    status: knowledgeStatusSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    weight: z.number().min(0).optional(),
    reason: z.string().optional()
  })
  .refine(
    (input) =>
      Object.entries(input).some(([key, value]) => !['id', 'reason'].includes(key) && value !== undefined),
    {
      message: 'At least one knowledge field must be provided to update.'
    }
  );

export const meshDeleteKnowledgeInputSchema = z.object({
  id: z.string().min(1),
  reason: z.string().optional()
});

export const meshCaptureTaskInputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  status: z.enum(['pending', 'in-progress', 'blocked', 'done']).default('in-progress'),
  content: z.string().optional(),
  tags: z.array(z.string()).default([]),
  para: z
    .object({
      category: z.enum(['projects', 'areas', 'resources', 'archives']),
      key: z.string().min(1)
    })
    .optional()
});

export const meshRateKnowledgeInputSchema = z.object({
  id: z.string().min(1),
  rating: z.number().min(0).max(1).optional(),
  adoptionDelta: z.number().min(-1).max(1).optional(),
  confidenceDelta: z.number().min(-1).max(1).optional(),
  weightDelta: z.number().min(-10).max(10).optional()
});

const knowledgeGraphSemanticEdgeKinds = ['supersedes', 'duplicates', 'contradicts'] as const;

export const meshLinkKnowledgeInputSchema = z.object({
  kind: z.enum(knowledgeGraphSemanticEdgeKinds),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  reason: z.string().optional(),
  project: z.string().default('auto')
});

export const meshSearchMemberExperienceInputSchema = meshSearchContextInputSchema.extend({
  memberName: z.string().min(1)
});

export const meshResolveTermInputSchema = z.object({
  term: z.string().min(1),
  project: z.string().default('auto'),
  limit: z.number().int().min(1).max(10).default(5)
});

export const meshScanProjectKnowledgeInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50)
});

const knowledgeGraphNodeKinds = ['knowledge', 'para', 'type', 'tag', 'member', 'source'] as const;
const knowledgeGraphEdgeKinds = [
  'authored_by',
  'belongs_to_para',
  'has_type',
  'parent_para',
  'sourced_from',
  'tagged_with',
  ...knowledgeGraphSemanticEdgeKinds
] as const;

export const meshExploreKnowledgeGraphInputSchema = z.object({
  query: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).optional(),
  depth: z.number().int().min(0).max(4).default(2),
  limit: z.number().int().min(1).max(200).default(40),
  nodeKinds: z.array(z.enum(knowledgeGraphNodeKinds)).optional(),
  edgeKinds: z.array(z.enum(knowledgeGraphEdgeKinds)).optional()
});

export type MeshSearchContextInput = z.infer<typeof meshSearchContextInputSchema>;
export type MeshGetStatusInput = z.infer<typeof meshGetStatusInputSchema>;
export type MeshGetKnowledgeInput = z.infer<typeof meshGetKnowledgeInputSchema>;
export type MeshListKnowledgeInput = z.infer<typeof meshListKnowledgeInputSchema>;
export type MeshCaptureKnowledgeInput = z.infer<typeof meshCaptureKnowledgeInputSchema>;
export type MeshUpdateKnowledgeInput = z.infer<typeof meshUpdateKnowledgeInputSchema>;
export type MeshDeleteKnowledgeInput = z.infer<typeof meshDeleteKnowledgeInputSchema>;
export type MeshCaptureTaskInput = z.infer<typeof meshCaptureTaskInputSchema>;
export type MeshRateKnowledgeInput = z.infer<typeof meshRateKnowledgeInputSchema>;
export type MeshLinkKnowledgeInput = z.infer<typeof meshLinkKnowledgeInputSchema>;
export type MeshSearchMemberExperienceInput = z.infer<typeof meshSearchMemberExperienceInputSchema>;
export type MeshResolveTermInput = z.infer<typeof meshResolveTermInputSchema>;
export type MeshScanProjectKnowledgeInput = z.infer<typeof meshScanProjectKnowledgeInputSchema>;
export type MeshExploreKnowledgeGraphInput = z.infer<typeof meshExploreKnowledgeGraphInputSchema>;

export const DEV_MESH_MCP_INSTRUCTIONS = [
  'DevMesh is an assistant-led project knowledge memory. Treat knowledge capture as part of normal coding work, not as an optional user-requested step.',
  'Use mesh_get_status when you need to confirm the running DevMesh version, project store, or automation state.',
  'Before final responses after meaningful coding, debugging, review, design, setup, release, deployment, or documentation work, decide whether you learned durable project knowledge.',
  'Capture durable decisions, conventions, commands, architecture notes, debugging lessons, pitfalls, setup/deployment steps, release notes, and handoffs with mesh_capture_knowledge.',
  'Capture task state, blockers, verification status, and next actions with mesh_capture_task when work starts, changes state, finishes, or needs handoff.',
  'Use mesh_get_knowledge, mesh_list_knowledge, mesh_update_knowledge, and mesh_delete_knowledge to inspect, correct, merge, or tombstone existing entries instead of creating duplicates.',
  'When new or existing knowledge clearly supersedes, duplicates, or contradicts another item, link the items with mesh_link_knowledge so the graph stays navigable.',
  'Do not capture secrets, credentials, raw private transcripts, large source blocks, noisy step-by-step logs, or facts that are already obvious from the code.',
  'Prefer one concise high-signal item over many small items. Search or explore existing knowledge first when duplication is likely.'
].join(' ');

const assistantLedCaptureReminder =
  'IMPORTANT: Treat capture as a default end-of-task habit. Do not wait for the user to ask. Before the final response for meaningful coding, debugging, review, design, setup, release, deployment, or documentation work, decide whether the session produced durable project knowledge. If yes, summarize it yourself and call mesh_capture_knowledge or mesh_capture_task first.';

export interface MeshToolHandlers {
  getStatus(input: MeshGetStatusInput): Promise<unknown>;
  searchContext(input: MeshSearchContextInput): Promise<unknown>;
  getKnowledge(input: MeshGetKnowledgeInput): Promise<unknown>;
  listKnowledge(input: MeshListKnowledgeInput): Promise<unknown>;
  captureKnowledge(input: MeshCaptureKnowledgeInput): Promise<unknown>;
  updateKnowledge(input: MeshUpdateKnowledgeInput): Promise<unknown>;
  deleteKnowledge(input: MeshDeleteKnowledgeInput): Promise<unknown>;
  captureTask(input: MeshCaptureTaskInput): Promise<unknown>;
  rateKnowledge(input: MeshRateKnowledgeInput): Promise<unknown>;
  linkKnowledge(input: MeshLinkKnowledgeInput): Promise<unknown>;
  searchMemberExperience(input: MeshSearchMemberExperienceInput): Promise<unknown>;
  resolveTerm(input: MeshResolveTermInput): Promise<unknown>;
  scanProjectKnowledge(input: MeshScanProjectKnowledgeInput): Promise<unknown>;
  exploreKnowledgeGraph(input: MeshExploreKnowledgeGraphInput): Promise<unknown>;
}

export type MeshToolName =
  | 'mesh_search_context'
  | 'mesh_get_status'
  | 'mesh_get_knowledge'
  | 'mesh_list_knowledge'
  | 'mesh_capture_knowledge'
  | 'mesh_update_knowledge'
  | 'mesh_delete_knowledge'
  | 'mesh_capture_task'
  | 'mesh_rate_knowledge'
  | 'mesh_link_knowledge'
  | 'mesh_search_member_experience'
  | 'mesh_resolve_term'
  | 'mesh_scan_project_knowledge'
  | 'mesh_explore_knowledge_graph';

export function registerMeshTools(server: McpServer, handlers: MeshToolHandlers): void {
  server.registerTool(
    'mesh_get_status',
    {
      title: 'Get DevMesh status',
      description:
        'Inspect the current running DevMesh version, runtime status, project store path, automation flags, and knowledge counts before assuming which version or mode is active.',
      inputSchema: meshGetStatusInputSchema.shape
    },
    async (args) => textToolResult('mesh_get_status', await handlers.getStatus(meshGetStatusInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_search_context',
    {
      title: 'Search project context',
      description:
        'IMPORTANT: For non-trivial project work, search DevMesh knowledge before starting or continuing so you can reuse prior decisions, conventions, pitfalls, commands, and handoffs. After using the returned context, keep watching for new durable knowledge to capture before your final response.',
      inputSchema: meshSearchContextInputSchema.shape
    },
    async (args) =>
      textToolResult('mesh_search_context', await handlers.searchContext(meshSearchContextInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_get_knowledge',
    {
      title: 'Get knowledge item',
      description:
        'Fetch one DevMesh knowledge item by id when you need the full current record before editing, deleting, linking, or citing it.',
      inputSchema: meshGetKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult('mesh_get_knowledge', await handlers.getKnowledge(meshGetKnowledgeInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_list_knowledge',
    {
      title: 'List knowledge items',
      description:
        'List DevMesh knowledge items with filters such as layer, type, PARA, tags, author, recency, and superseded/tombstone inclusion.',
      inputSchema: meshListKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult('mesh_list_knowledge', await handlers.listKnowledge(meshListKnowledgeInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_capture_knowledge',
    {
      title: 'Capture knowledge',
      description:
        `${assistantLedCaptureReminder} Use this tool for durable decisions, conventions, pitfalls, commands, architecture notes, debugging lessons, setup/deployment steps, release/publish notes, or handoffs discovered from the current conversation, code reading, edits, command output, reviews, or tests. Capture concise summaries only. Prefer one high-signal item over many tiny items. Skip duplicates and do not store secrets, raw private transcript text, credentials, large source blocks, or noisy step-by-step logs.`,
      inputSchema: meshCaptureKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult(
        'mesh_capture_knowledge',
        await handlers.captureKnowledge(meshCaptureKnowledgeInputSchema.parse(args))
      )
  );

  server.registerTool(
    'mesh_update_knowledge',
    {
      title: 'Update knowledge item',
      description:
        `${assistantLedCaptureReminder} Update one existing DevMesh knowledge item by id. Fetch or search first when you are unsure which item should change, and include a concise reason when the edit is meaningful.`,
      inputSchema: meshUpdateKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult(
        'mesh_update_knowledge',
        await handlers.updateKnowledge(meshUpdateKnowledgeInputSchema.parse(args))
      )
  );

  server.registerTool(
    'mesh_delete_knowledge',
    {
      title: 'Delete knowledge item',
      description:
        'Tombstone one DevMesh knowledge item by id so normal searches stop returning it while audit and sync history remain intact. Search or get the item first when the id is uncertain, and include a short reason.',
      inputSchema: meshDeleteKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult(
        'mesh_delete_knowledge',
        await handlers.deleteKnowledge(meshDeleteKnowledgeInputSchema.parse(args))
      )
  );

  server.registerTool(
    'mesh_capture_task',
    {
      title: 'Capture task progress',
      description:
        `${assistantLedCaptureReminder} Use this tool when a meaningful task starts, changes state, finishes, is blocked, or needs a handoff. Summarize what changed, what remains, verification status, and any next action that future assistants or teammates should know. Use this especially before stopping after partial work.`,
      inputSchema: meshCaptureTaskInputSchema.shape
    },
    async (args) =>
      textToolResult('mesh_capture_task', await handlers.captureTask(meshCaptureTaskInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_rate_knowledge',
    {
      title: 'Rate knowledge',
      description:
        'Apply explicit quality feedback to a knowledge item when the user or your work shows it is useful, stale, wrong, adopted, or should be deprioritized.',
      inputSchema: meshRateKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult('mesh_rate_knowledge', await handlers.rateKnowledge(meshRateKnowledgeInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_link_knowledge',
    {
      title: 'Link knowledge',
      description:
        `${assistantLedCaptureReminder} Use this tool when you discover that one knowledge item supersedes, duplicates, or contradicts another. Link only explicit relationships you can justify from the current context or existing knowledge, include a concise reason when helpful, and prefer linking durable items over creating duplicate captures.`,
      inputSchema: meshLinkKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult('mesh_link_knowledge', await handlers.linkKnowledge(meshLinkKnowledgeInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_search_member_experience',
    {
      title: 'Search member experience',
      description:
        'Search project knowledge by member identity when the user mentions a teammate, prior owner, or person-specific experience. Reuse relevant findings, and capture any new durable follow-up knowledge you infer from the current work.',
      inputSchema: meshSearchMemberExperienceInputSchema.shape
    },
    async (args) =>
      textToolResult(
        'mesh_search_member_experience',
        await handlers.searchMemberExperience(meshSearchMemberExperienceInputSchema.parse(args))
      )
  );

  server.registerTool(
    'mesh_resolve_term',
    {
      title: 'Resolve term',
      description:
        'Resolve a project glossary term before assuming local vocabulary, product names, or team-specific concepts. If the current task clarifies or corrects a term, summarize the durable glossary insight with mesh_capture_knowledge.',
      inputSchema: meshResolveTermInputSchema.shape
    },
    async (args) =>
      textToolResult('mesh_resolve_term', await handlers.resolveTerm(meshResolveTermInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_scan_project_knowledge',
    {
      title: 'Scan project knowledge',
      description:
        `${assistantLedCaptureReminder} On demand, scan the current project for high-signal Git and filesystem context when you decide a project-wide sweep would help. Inspect the returned highlights and relevant files yourself; do not store raw scan output. Capture only durable conclusions worth keeping.`,
      inputSchema: meshScanProjectKnowledgeInputSchema.shape
    },
    async (args) =>
      textToolResult(
        'mesh_scan_project_knowledge',
        await handlers.scanProjectKnowledge(meshScanProjectKnowledgeInputSchema.parse(args))
      )
  );

  server.registerTool(
    'mesh_explore_knowledge_graph',
    {
      title: 'Explore knowledge graph',
      description:
        'Explore the derived DevMesh knowledge graph around matching knowledge items, PARA areas, tags, authors, sources, types, and semantic edges such as supersedes, duplicates, and contradicts. Use this when relationships matter, such as finding related decisions, pits, owners, areas, or follow-up knowledge before answering or capturing a new item.',
      inputSchema: meshExploreKnowledgeGraphInputSchema.shape
    },
    async (args) =>
      textToolResult(
        'mesh_explore_knowledge_graph',
        await handlers.exploreKnowledgeGraph(meshExploreKnowledgeGraphInputSchema.parse(args))
      )
  );
}

export function formatMeshToolOutput(toolName: MeshToolName, value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  switch (toolName) {
    case 'mesh_get_status':
      return formatStatus(value);
    case 'mesh_search_context':
    case 'mesh_search_member_experience':
      return formatContextPack(value);
    case 'mesh_get_knowledge':
      return formatKnowledgeLookup(value);
    case 'mesh_list_knowledge':
      return formatKnowledgeList('Knowledge items', value);
    case 'mesh_capture_knowledge':
      return formatKnowledgeMutation('Captured knowledge', value);
    case 'mesh_update_knowledge':
      return formatKnowledgeMutation('Updated knowledge', value);
    case 'mesh_delete_knowledge':
      return formatKnowledgeMutation('Deleted knowledge', value);
    case 'mesh_capture_task':
      return formatKnowledgeMutation('Captured task', value);
    case 'mesh_rate_knowledge':
      return formatKnowledgeMutation('Rated knowledge', value);
    case 'mesh_link_knowledge':
      return formatKnowledgeLink(value);
    case 'mesh_resolve_term':
      return formatKnowledgeList('Resolved terms', value);
    case 'mesh_scan_project_knowledge':
      return formatProjectScan(value);
    case 'mesh_explore_knowledge_graph':
      return formatKnowledgeGraph(value);
  }
}

function textToolResult(toolName: MeshToolName, value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: formatMeshToolOutput(toolName, value)
      }
    ]
  };
}

function formatStatus(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const lines = ['DevMesh status'];
  pushField(lines, 'service', value.service);
  pushField(lines, 'version', value.version);
  pushField(lines, 'mode', value.mode);
  pushField(lines, 'projectRoot', value.projectRoot);
  pushField(lines, 'storeRoot', value.storeRoot);
  pushField(lines, 'repository', value.repository);
  pushField(lines, 'schemaVersion', value.schemaVersion);
  pushField(lines, 'knowledgeItems', value.knowledgeItems);
  pushBoolean(lines, 'autoInit', value.autoInit);
  pushBoolean(lines, 'autoReference', value.autoReference);
  pushBoolean(lines, 'autoSync', value.autoSync);
  pushField(lines, 'result', value.result);

  if (isRecord(value.mcp)) {
    lines.push(`mcp: ${formatRecordInline(value.mcp, ['entrypoint'])}`);

    if (isRecord(value.mcp.daemon)) {
      lines.push(`daemon: ${formatRecordInline(value.mcp.daemon, ['running', 'pid', 'version', 'mcpUrl'])}`);
    }
  }

  appendUnknownFields(lines, value, [
    'service',
    'version',
    'mode',
    'projectRoot',
    'storeRoot',
    'repository',
    'schemaVersion',
    'knowledgeItems',
    'autoInit',
    'autoReference',
    'autoSync',
    'result',
    'mcp'
  ]);

  return lines.join('\n');
}

function formatContextPack(value: unknown): string {
  if (!isRecord(value)) {
    return formatKnowledgeList('Context results', value);
  }

  const items = toRecordArray(value.items);
  const lines = ['DevMesh context results'];
  pushField(lines, 'query', value.query);
  pushField(lines, 'generatedAt', value.generatedAt);
  pushField(lines, 'total', value.total);
  lines.push(`items: ${items.length}`);

  if (items.length === 0) {
    lines.push('No matching knowledge found.');
    return lines.join('\n');
  }

  for (const [index, item] of items.slice(0, 8).entries()) {
    lines.push(formatKnowledgeListItem(index + 1, item));
  }

  if (items.length > 8) {
    lines.push(`... ${items.length - 8} more items omitted.`);
  }

  return lines.join('\n');
}

function formatKnowledgeLookup(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  if (value.found === false) {
    const lines = ['Knowledge item not found'];
    pushField(lines, 'id', value.id);
    pushField(lines, 'message', value.message);
    return lines.join('\n');
  }

  return formatKnowledgeMutation('Knowledge item', value);
}

function formatKnowledgeMutation(title: string, value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const lines = [title];
  pushField(lines, 'id', value.id);
  pushField(lines, 'title', value.title);
  pushField(lines, 'type', value.type);
  pushField(lines, 'layer', value.layer);
  pushField(lines, 'status', value.taskStatus ?? value.status);
  pushField(lines, 'entryKey', value.entryKey);
  pushField(lines, 'summary', scalarToString(value.summary));

  if (isRecord(value.para)) {
    lines.push(`para: ${formatRecordInline(value.para, ['category', 'key'])}`);
  }

  if (Array.isArray(value.tags)) {
    lines.push(`tags: ${value.tags.map((tag) => scalarToString(tag)).filter(Boolean).join(', ')}`);
  }

  if (isRecord(value.quality)) {
    lines.push(`quality: ${formatRecordInline(value.quality, ['qualityScore', 'confidence', 'rating'])}`);
  }

  if (isRecord(value.event)) {
    lines.push(`event: ${formatRecordInline(value.event, ['kind', 'createdAt'])}`);
  }

  if (isRecord(value.ratingEvent)) {
    lines.push(`ratingEvent: ${formatRecordInline(value.ratingEvent, ['rating', 'createdAt'])}`);
  }

  return lines.join('\n');
}

function formatKnowledgeLink(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const edge = isRecord(value.edge) ? value.edge : value;
  const lines = ['Linked knowledge'];
  pushField(lines, 'kind', edge.kind);
  pushField(lines, 'fromId', edge.fromId);
  pushField(lines, 'toId', edge.toId);
  pushField(lines, 'reason', edge.reason);

  if (isRecord(value.event)) {
    lines.push(`event: ${formatRecordInline(value.event, ['kind', 'createdAt'])}`);
  }

  if (typeof value.instruction === 'string') {
    lines.push(`instruction: ${truncate(value.instruction)}`);
  }

  return lines.join('\n');
}

function formatKnowledgeList(title: string, value: unknown): string {
  const record = isRecord(value) ? value : undefined;
  const items = Array.isArray(value) ? toRecordArray(value) : toRecordArray(record?.items);
  const lines = [title];
  pushField(lines, 'total', record?.total);
  pushField(lines, 'limit', record?.limit);
  lines.push(`items: ${items.length}`);

  if (items.length === 0) {
    lines.push('No items returned.');
    return lines.join('\n');
  }

  for (const [index, item] of items.slice(0, 8).entries()) {
    lines.push(formatKnowledgeListItem(index + 1, item));
  }

  if (items.length > 8) {
    lines.push(`... ${items.length - 8} more items omitted.`);
  }

  return lines.join('\n');
}

function formatProjectScan(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const findings = toRecordArray(value.findings);
  const lines = ['Project knowledge scan'];
  pushField(lines, 'projectRoot', value.projectRoot);
  pushField(lines, 'limit', value.limit);
  lines.push(`findings: ${findings.length}`);

  if (isRecord(value.highlights)) {
    lines.push(`highlights: ${formatRecordInline(value.highlights, ['changedFiles', 'fileCount', 'todoFiles'])}`);
  }

  for (const [index, finding] of findings.slice(0, 8).entries()) {
    lines.push(formatKnowledgeListItem(index + 1, finding));
  }

  if (findings.length > 8) {
    lines.push(`... ${findings.length - 8} more findings omitted.`);
  }

  if (typeof value.instruction === 'string') {
    lines.push(`instruction: ${truncate(value.instruction)}`);
  }

  return lines.join('\n');
}

function formatKnowledgeGraph(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const nodes = toRecordArray(value.nodes);
  const edges = toRecordArray(value.edges);
  const lines = ['Knowledge graph', `nodes: ${nodes.length}`, `edges: ${edges.length}`];

  for (const [index, node] of nodes.slice(0, 8).entries()) {
    const label = scalarToString(node.label ?? node.title ?? node.id) ?? 'untitled';
    const id = scalarToString(node.id) ?? 'unknown';
    const kind = scalarToString(node.kind) ?? 'unknown';
    lines.push(`${index + 1}. node id=${id} | kind=${kind} | ${truncate(label, 120)}`);
  }

  for (const [index, edge] of edges.slice(0, 8).entries()) {
    const kind = scalarToString(edge.kind) ?? 'unknown';
    const from = scalarToString(edge.from) ?? scalarToString(edge.fromId) ?? 'unknown';
    const to = scalarToString(edge.to) ?? scalarToString(edge.toId) ?? 'unknown';
    lines.push(`${index + 1}. edge kind=${kind} | from=${from} | to=${to}`);
  }

  if (nodes.length > 8 || edges.length > 8) {
    lines.push('Additional graph nodes or edges omitted.');
  }

  return lines.join('\n');
}

function formatKnowledgeListItem(index: number, item: Record<string, unknown>): string {
  const title = scalarToString(item.title ?? item.label ?? item.name) ?? 'untitled';
  const details = [
    item.type === undefined ? undefined : `type=${scalarToString(item.type)}`,
    item.layer === undefined ? undefined : `layer=${scalarToString(item.layer)}`,
    item.kind === undefined ? undefined : `kind=${scalarToString(item.kind)}`,
    formatPara(item.para),
    formatQuality(item.quality)
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);
  const summary = scalarToString(item.summary ?? item.content ?? item.text);
  const lines = [`${index}. id=${scalarToString(item.id) ?? 'unknown'} | ${truncate(title, 120)}`];

  if (details.length > 0) {
    lines.push(`   ${details.join(' | ')}`);
  }

  if (summary !== undefined) {
    lines.push(`   summary: ${truncate(summary)}`);
  }

  return lines.join('\n');
}

function formatGeneric(value: unknown): string {
  if (value === undefined) {
    return 'No result.';
  }

  if (value === null || typeof value !== 'object') {
    return scalarToString(value) ?? 'No result.';
  }

  if (Array.isArray(value)) {
    return formatKnowledgeList('Result list', value);
  }

  const lines = ['Result'];

  for (const [key, entryValue] of Object.entries(value).slice(0, 12)) {
    lines.push(`${key}: ${summarizeValue(entryValue)}`);
  }

  return lines.join('\n');
}

function appendUnknownFields(lines: string[], value: Record<string, unknown>, knownKeys: string[]): void {
  const known = new Set(knownKeys);

  for (const [key, entryValue] of Object.entries(value).slice(0, 16)) {
    if (!known.has(key)) {
      lines.push(`${key}: ${summarizeValue(entryValue)}`);
    }
  }
}

function pushField(lines: string[], label: string, value: unknown): void {
  const text = scalarToString(value);

  if (text !== undefined) {
    lines.push(`${label}: ${truncate(text)}`);
  }
}

function pushBoolean(lines: string[], label: string, value: unknown): void {
  if (typeof value === 'boolean') {
    lines.push(`${label}: ${value ? 'true' : 'false'}`);
  }
}

function formatPara(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const category = scalarToString(value.category);
  const key = scalarToString(value.key);

  if (category === undefined && key === undefined) {
    return undefined;
  }

  return `para=${[category, key].filter(Boolean).join('/')}`;
}

function formatQuality(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return formatRecordInline(value, ['qualityScore', 'confidence', 'rating']);
}

function formatRecordInline(value: Record<string, unknown>, keys: string[]): string {
  const parts = keys
    .map((key) => {
      const entryValue = value[key];

      if (Array.isArray(entryValue)) {
        return `${key}=${entryValue.length}`;
      }

      const text = scalarToString(entryValue);
      return text === undefined ? undefined : `${key}=${truncate(text, 80)}`;
    })
    .filter((part): part is string => part !== undefined);

  return parts.length === 0 ? 'none' : parts.join(', ');
}

function summarizeValue(value: unknown): string {
  const scalar = scalarToString(value);

  if (scalar !== undefined) {
    return truncate(scalar);
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }

  if (isRecord(value)) {
    return formatRecordInline(value, Object.keys(value).slice(0, 4));
  }

  return 'unknown';
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function truncate(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
