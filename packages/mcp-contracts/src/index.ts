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

export type MeshSearchContextInput = z.infer<typeof meshSearchContextInputSchema>;
export type MeshCaptureKnowledgeInput = z.infer<typeof meshCaptureKnowledgeInputSchema>;
export type MeshCaptureTaskInput = z.infer<typeof meshCaptureTaskInputSchema>;
export type MeshRateKnowledgeInput = z.infer<typeof meshRateKnowledgeInputSchema>;
export type MeshSearchMemberExperienceInput = z.infer<typeof meshSearchMemberExperienceInputSchema>;
export type MeshResolveTermInput = z.infer<typeof meshResolveTermInputSchema>;
export type MeshScanProjectKnowledgeInput = z.infer<typeof meshScanProjectKnowledgeInputSchema>;

export interface MeshToolHandlers {
  searchContext(input: MeshSearchContextInput): Promise<unknown>;
  captureKnowledge(input: MeshCaptureKnowledgeInput): Promise<unknown>;
  captureTask(input: MeshCaptureTaskInput): Promise<unknown>;
  rateKnowledge(input: MeshRateKnowledgeInput): Promise<unknown>;
  searchMemberExperience(input: MeshSearchMemberExperienceInput): Promise<unknown>;
  resolveTerm(input: MeshResolveTermInput): Promise<unknown>;
  scanProjectKnowledge(input: MeshScanProjectKnowledgeInput): Promise<unknown>;
}

export function registerMeshTools(server: McpServer, handlers: MeshToolHandlers): void {
  server.registerTool(
    'mesh_search_context',
    {
      title: 'Search project context',
      description:
        'Search DevMesh project knowledge before starting or continuing non-trivial work so you can reuse prior decisions, conventions, pitfalls, commands, and handoffs.',
      inputSchema: meshSearchContextInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.searchContext(meshSearchContextInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_capture_knowledge',
    {
      title: 'Capture knowledge',
      description:
        'When your current conversation, code reading, edit, command, review, or debugging work reveals durable project knowledge, decide yourself whether it is worth preserving and call this tool. Capture only summarized decisions, conventions, pitfalls, commands, or handoffs; do not store secrets, raw private transcript text, or noisy step-by-step logs.',
      inputSchema: meshCaptureKnowledgeInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.captureKnowledge(meshCaptureKnowledgeInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_capture_task',
    {
      title: 'Capture task progress',
      description:
        'When a meaningful task starts, changes state, finishes, or needs a handoff, decide yourself whether the current task state should be preserved and call this tool with a concise summary of what changed and what remains.',
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
      description: 'Search project knowledge by member identity.',
      inputSchema: meshSearchMemberExperienceInputSchema.shape
    },
    async (args) =>
      jsonToolResult(await handlers.searchMemberExperience(meshSearchMemberExperienceInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_resolve_term',
    {
      title: 'Resolve term',
      description: 'Resolve a project glossary term before assuming local vocabulary, product names, or team-specific concepts.',
      inputSchema: meshResolveTermInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.resolveTerm(meshResolveTermInputSchema.parse(args)))
  );

  server.registerTool(
    'mesh_scan_project_knowledge',
    {
      title: 'Scan project knowledge',
      description:
        'On demand, scan the current project for high-signal Git and filesystem context when you decide a project-wide sweep would help. Inspect the returned highlights and relevant files yourself, then call mesh_capture_knowledge or mesh_capture_task only for durable knowledge worth keeping.',
      inputSchema: meshScanProjectKnowledgeInputSchema.shape
    },
    async (args) => jsonToolResult(await handlers.scanProjectKnowledge(meshScanProjectKnowledgeInputSchema.parse(args)))
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
