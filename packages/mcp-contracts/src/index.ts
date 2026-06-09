import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const paraSchema = z.object({
  category: z.enum(['projects', 'areas', 'resources', 'archives']).optional(),
  key: z.string().min(1).optional()
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

export const meshCaptureKnowledgeInputSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  content: z.string().optional(),
  layer: z.enum(['raw', 'extract', 'canonical']).default('extract'),
  para: z
    .object({
      category: z.enum(['projects', 'areas', 'resources', 'archives']),
      key: z.string().min(1)
    })
    .optional(),
  tags: z.array(z.string()).default([]),
  visibility: z.enum(['private', 'project', 'team', 'org']).default('project'),
  confidence: z.number().min(0).max(1).optional(),
  weight: z.number().min(0).default(1),
  source: z
    .object({
      kind: z.string().min(1),
      ref: z.string().optional(),
      url: z.string().optional(),
      commit: z.string().optional(),
      storageRef: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    })
    .optional(),
  createdBy: z
    .object({
      memberId: z.string().optional(),
      displayName: z.string().min(1),
      handle: z.string().optional(),
      clientId: z.string().optional()
    })
    .optional()
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

export const meshExploreKnowledgeGraphInputSchema = z.object({
  query: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).optional(),
  depth: z.number().int().min(0).max(4).default(2),
  limit: z.number().int().min(1).max(200).default(40),
  nodeKinds: z.array(z.enum(['knowledge', 'para', 'type', 'tag', 'member', 'source'])).optional(),
  edgeKinds: z
    .array(z.enum(['authored_by', 'belongs_to_para', 'has_type', 'parent_para', 'sourced_from', 'tagged_with']))
    .optional()
});

export type MeshSearchContextInput = z.infer<typeof meshSearchContextInputSchema>;
export type MeshCaptureKnowledgeInput = z.infer<typeof meshCaptureKnowledgeInputSchema>;
export type MeshCaptureTaskInput = z.infer<typeof meshCaptureTaskInputSchema>;
export type MeshRateKnowledgeInput = z.infer<typeof meshRateKnowledgeInputSchema>;
export type MeshSearchMemberExperienceInput = z.infer<typeof meshSearchMemberExperienceInputSchema>;
export type MeshResolveTermInput = z.infer<typeof meshResolveTermInputSchema>;
export type MeshScanProjectKnowledgeInput = z.infer<typeof meshScanProjectKnowledgeInputSchema>;
export type MeshExploreKnowledgeGraphInput = z.infer<typeof meshExploreKnowledgeGraphInputSchema>;

export const DEV_MESH_MCP_INSTRUCTIONS = [
  'DevMesh is an assistant-led project knowledge memory. Treat knowledge capture as part of normal coding work, not as an optional user-requested step.',
  'Before final responses after meaningful coding, debugging, review, design, setup, release, deployment, or documentation work, decide whether you learned durable project knowledge.',
  'Capture durable decisions, conventions, commands, architecture notes, debugging lessons, pitfalls, setup/deployment steps, release notes, and handoffs with mesh_capture_knowledge.',
  'Capture task state, blockers, verification status, and next actions with mesh_capture_task when work starts, changes state, finishes, or needs handoff.',
  'Do not capture secrets, credentials, raw private transcripts, large source blocks, noisy step-by-step logs, or facts that are already obvious from the code.',
  'Prefer one concise high-signal item over many small items. Search or explore existing knowledge first when duplication is likely.'
].join(' ');

const assistantLedCaptureReminder =
  'IMPORTANT: Treat capture as a default end-of-task habit. Do not wait for the user to ask. Before the final response for meaningful coding, debugging, review, design, setup, release, deployment, or documentation work, decide whether the session produced durable project knowledge. If yes, summarize it yourself and call mesh_capture_knowledge or mesh_capture_task first.';

export interface MeshToolHandlers {
  searchContext(input: MeshSearchContextInput): Promise<unknown>;
  captureKnowledge(input: MeshCaptureKnowledgeInput): Promise<unknown>;
  captureTask(input: MeshCaptureTaskInput): Promise<unknown>;
  rateKnowledge(input: MeshRateKnowledgeInput): Promise<unknown>;
  searchMemberExperience(input: MeshSearchMemberExperienceInput): Promise<unknown>;
  resolveTerm(input: MeshResolveTermInput): Promise<unknown>;
  scanProjectKnowledge(input: MeshScanProjectKnowledgeInput): Promise<unknown>;
  exploreKnowledgeGraph(input: MeshExploreKnowledgeGraphInput): Promise<unknown>;
}

export function registerMeshTools(server: McpServer, handlers: MeshToolHandlers): void {
  server.registerTool(
    'mesh_search_context',
    {
      title: 'Search project context',
      description:
        'IMPORTANT: For non-trivial project work, search DevMesh knowledge before starting or continuing so you can reuse prior decisions, conventions, pitfalls, commands, and handoffs. After using the returned context, keep watching for new durable knowledge to capture before your final response.',
      inputSchema: meshSearchContextInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.searchContext(meshSearchContextInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_capture_knowledge',
    {
      title: 'Capture knowledge',
      description:
        `${assistantLedCaptureReminder} Use this tool for durable decisions, conventions, pitfalls, commands, architecture notes, debugging lessons, setup/deployment steps, release/publish notes, or handoffs discovered from the current conversation, code reading, edits, command output, reviews, or tests. Capture concise summaries only. Prefer one high-signal item over many tiny items. Skip duplicates and do not store secrets, raw private transcript text, credentials, large source blocks, or noisy step-by-step logs.`,
      inputSchema: meshCaptureKnowledgeInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.captureKnowledge(meshCaptureKnowledgeInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_capture_task',
    {
      title: 'Capture task progress',
      description:
        `${assistantLedCaptureReminder} Use this tool when a meaningful task starts, changes state, finishes, is blocked, or needs a handoff. Summarize what changed, what remains, verification status, and any next action that future assistants or teammates should know. Use this especially before stopping after partial work.`,
      inputSchema: meshCaptureTaskInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.captureTask(meshCaptureTaskInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_rate_knowledge',
    {
      title: 'Rate knowledge',
      description:
        'Apply explicit quality feedback to a knowledge item when the user or your work shows it is useful, stale, wrong, adopted, or should be deprioritized.',
      inputSchema: meshRateKnowledgeInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.rateKnowledge(meshRateKnowledgeInputSchema.parse(args)))
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
      jsonToolResult(await handlers.searchMemberExperience(meshSearchMemberExperienceInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_resolve_term',
    {
      title: 'Resolve term',
      description:
        'Resolve a project glossary term before assuming local vocabulary, product names, or team-specific concepts. If the current task clarifies or corrects a term, summarize the durable glossary insight with mesh_capture_knowledge.',
      inputSchema: meshResolveTermInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.resolveTerm(meshResolveTermInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_scan_project_knowledge',
    {
      title: 'Scan project knowledge',
      description:
        `${assistantLedCaptureReminder} On demand, scan the current project for high-signal Git and filesystem context when you decide a project-wide sweep would help. Inspect the returned highlights and relevant files yourself; do not store raw scan output. Capture only durable conclusions worth keeping.`,
      inputSchema: meshScanProjectKnowledgeInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.scanProjectKnowledge(meshScanProjectKnowledgeInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_explore_knowledge_graph',
    {
      title: 'Explore knowledge graph',
      description:
        'Explore the derived DevMesh knowledge graph around matching knowledge items, PARA areas, tags, authors, sources, and types. Use this when relationships matter, such as finding related decisions, pits, owners, areas, or follow-up knowledge before answering or capturing a new item.',
      inputSchema: meshExploreKnowledgeGraphInputSchema.shape
    },
    async (args) =>
      jsonToolResult(await handlers.exploreKnowledgeGraph(meshExploreKnowledgeGraphInputSchema.parse(args)))
  );
}

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
