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

function textToolResult(_toolName: string, value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}
