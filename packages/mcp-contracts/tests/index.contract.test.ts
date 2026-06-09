import { describe, expect, it, vi } from 'vitest';
import {
  DEV_MESH_MCP_INSTRUCTIONS,
  meshCaptureKnowledgeInputSchema,
  meshRateKnowledgeInputSchema,
  meshSearchContextInputSchema,
  registerMeshTools,
  type MeshToolHandlers
} from '../src/index.js';

describe('MCP tool contract schemas', () => {
  it('applies defaults for context search', () => {
    const input = meshSearchContextInputSchema.parse({
      query: 'auth decisions'
    });

    expect(input).toMatchObject({
      query: 'auth decisions',
      project: 'auto',
      layers: ['canonical', 'extract'],
      limit: 8,
      includeSuperseded: false
    });
  });

  it('rejects invalid search limits and layers', () => {
    expect(() =>
      meshSearchContextInputSchema.parse({
        query: 'auth',
        limit: 99
      })
    ).toThrow();
    expect(() =>
      meshSearchContextInputSchema.parse({
        query: 'auth',
        layers: ['unknown']
      })
    ).toThrow();
  });

  it('applies defaults for knowledge capture and rating bounds', () => {
    const capture = meshCaptureKnowledgeInputSchema.parse({
      type: 'decision',
      title: 'Use AuthSession',
      summary: 'Read login state through AuthSession.'
    });

    expect(capture.layer).toBe('extract');
    expect(capture.tags).toEqual([]);
    expect(capture.visibility).toBe('project');
    expect(capture.weight).toBe(1);
    expect(() => meshRateKnowledgeInputSchema.parse({ id: 'ki_1', rating: 2 })).toThrow();
  });

  it('registers the expected public tools', async () => {
    const registered: Array<{
      name: string;
      config: { description?: string };
      callback: (args: unknown) => Promise<unknown>;
    }> = [];
    const fakeServer = {
      registerTool(name: string, config: { description?: string }, callback: (args: unknown) => Promise<unknown>) {
        registered.push({ name, config, callback });
      }
    };
    const handlers: MeshToolHandlers = {
      searchContext: vi.fn(async () => ({ ok: 'search' })),
      captureKnowledge: vi.fn(async () => ({ ok: 'capture' })),
      captureTask: vi.fn(async () => ({ ok: 'task' })),
      rateKnowledge: vi.fn(async () => ({ ok: 'rate' })),
      searchMemberExperience: vi.fn(async () => ({ ok: 'member' })),
      resolveTerm: vi.fn(async () => ({ ok: 'term' })),
      scanProjectKnowledge: vi.fn(async () => ({ ok: 'scan' })),
      exploreKnowledgeGraph: vi.fn(async () => ({ ok: 'graph' }))
    };

    registerMeshTools(fakeServer as never, handlers);

    expect(registered.map((tool) => tool.name)).toEqual([
      'mesh_search_context',
      'mesh_capture_knowledge',
      'mesh_capture_task',
      'mesh_rate_knowledge',
      'mesh_search_member_experience',
      'mesh_resolve_term',
      'mesh_scan_project_knowledge',
      'mesh_explore_knowledge_graph'
    ]);

    const toolDescriptions = Object.fromEntries(registered.map((tool) => [tool.name, tool.config.description ?? '']));

    expect(toolDescriptions.mesh_capture_knowledge).toContain('Do not wait for the user');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Before the final response');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Prefer one high-signal item');
    expect(toolDescriptions.mesh_capture_task).toContain('Summarize what changed');
    expect(toolDescriptions.mesh_capture_task).toContain('before stopping after partial work');
    expect(toolDescriptions.mesh_scan_project_knowledge).toContain('Capture only durable conclusions');
    expect(toolDescriptions.mesh_explore_knowledge_graph).toContain('related decisions');

    const result = await registered[0]?.callback({ query: 'auth' });
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: 'search' }, null, 2)
        }
      ]
    });
    expect(handlers.searchContext).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'auth',
        limit: 8
      })
    );
  });

  it('publishes assistant-led capture server instructions', () => {
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('assistant-led project knowledge memory');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('Before final responses');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_capture_knowledge');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_capture_task');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('Do not capture secrets');
  });
});
