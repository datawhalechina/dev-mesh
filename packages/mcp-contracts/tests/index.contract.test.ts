import { describe, expect, it, vi } from 'vitest';
import {
  DEV_MESH_MCP_INSTRUCTIONS,
  meshCaptureKnowledgeInputSchema,
  meshDeleteKnowledgeInputSchema,
  meshExploreKnowledgeGraphInputSchema,
  meshGetKnowledgeInputSchema,
  meshGetStatusInputSchema,
  meshLinkKnowledgeInputSchema,
  meshListKnowledgeInputSchema,
  meshRateKnowledgeInputSchema,
  meshSearchContextInputSchema,
  meshUpdateKnowledgeInputSchema,
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

  it('accepts semantic graph edge filters', () => {
    const input = meshExploreKnowledgeGraphInputSchema.parse({
      ids: ['ki_new'],
      edgeKinds: ['supersedes', 'duplicates', 'contradicts']
    });

    expect(input.edgeKinds).toEqual(['supersedes', 'duplicates', 'contradicts']);
  });

  it('accepts knowledge link inputs', () => {
    const input = meshLinkKnowledgeInputSchema.parse({
      kind: 'supersedes',
      fromId: 'ki_new',
      toId: 'ki_old',
      reason: 'The new decision replaces the old one.'
    });

    expect(input).toMatchObject({
      kind: 'supersedes',
      fromId: 'ki_new',
      toId: 'ki_old',
      project: 'auto'
    });
  });

  it('applies defaults for status checks', () => {
    expect(meshGetStatusInputSchema.parse({})).toEqual({
      project: 'auto'
    });
  });

  it('validates knowledge CRUD tool inputs', () => {
    expect(meshGetKnowledgeInputSchema.parse({ id: 'ki_1' })).toEqual({
      id: 'ki_1'
    });
    expect(meshListKnowledgeInputSchema.parse({})).toEqual({
      includeSuperseded: false,
      limit: 20
    });
    expect(
      meshUpdateKnowledgeInputSchema.parse({
        id: 'ki_1',
        summary: 'Updated summary.',
        reason: 'Refresh stale wording.'
      })
    ).toMatchObject({
      id: 'ki_1',
      summary: 'Updated summary.',
      reason: 'Refresh stale wording.'
    });
    expect(() => meshUpdateKnowledgeInputSchema.parse({ id: 'ki_1', reason: 'No actual patch.' })).toThrow();
    expect(meshDeleteKnowledgeInputSchema.parse({ id: 'ki_1' })).toEqual({
      id: 'ki_1'
    });
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
      getStatus: vi.fn(async () => ({ service: 'devmesh', version: '0.1.0', mode: 'test', knowledgeItems: 1 })),
      searchContext: vi.fn(async () => ({
        query: 'auth',
        generatedAt: '2026-06-10T00:00:00.000Z',
        items: [
          {
            id: 'ki_auth',
            title: 'Auth decision',
            summary: 'Use the shared auth helper.',
            type: 'decision',
            layer: 'canonical'
          }
        ]
      })),
      getKnowledge: vi.fn(async () => ({ id: 'ki_get', title: 'Get item', summary: 'Fetch one item.' })),
      listKnowledge: vi.fn(async () => ({ total: 1, limit: 20, items: [{ id: 'ki_list', title: 'List item' }] })),
      captureKnowledge: vi.fn(async () => ({ id: 'ki_capture', title: 'Captured item' })),
      updateKnowledge: vi.fn(async () => ({ id: 'ki_update', title: 'Updated item' })),
      deleteKnowledge: vi.fn(async () => ({ id: 'ki_delete', title: 'Deleted item', status: 'tombstone' })),
      captureTask: vi.fn(async () => ({ id: 'ki_task', title: 'Captured task', taskStatus: 'done' })),
      rateKnowledge: vi.fn(async () => ({ id: 'ki_rate', title: 'Rated item', quality: { rating: 1 } })),
      linkKnowledge: vi.fn(async () => ({ kind: 'supersedes', fromId: 'ki_new', toId: 'ki_old' })),
      searchMemberExperience: vi.fn(async () => ({ query: 'auth', items: [] })),
      resolveTerm: vi.fn(async () => [{ id: 'ki_term', title: 'Term item' }]),
      scanProjectKnowledge: vi.fn(async () => ({ projectRoot: '/tmp/project', findings: [] })),
      exploreKnowledgeGraph: vi.fn(async () => ({ nodes: [{ id: 'knowledge:ki_1', kind: 'knowledge' }], edges: [] }))
    };

    registerMeshTools(fakeServer as never, handlers);

    expect(registered.map((tool) => tool.name)).toEqual([
      'mesh_get_status',
      'mesh_search_context',
      'mesh_get_knowledge',
      'mesh_list_knowledge',
      'mesh_capture_knowledge',
      'mesh_update_knowledge',
      'mesh_delete_knowledge',
      'mesh_capture_task',
      'mesh_rate_knowledge',
      'mesh_link_knowledge',
      'mesh_search_member_experience',
      'mesh_resolve_term',
      'mesh_scan_project_knowledge',
      'mesh_explore_knowledge_graph'
    ]);

    const toolDescriptions = Object.fromEntries(registered.map((tool) => [tool.name, tool.config.description ?? '']));

    expect(toolDescriptions.mesh_get_status).toContain('running DevMesh version');
    expect(toolDescriptions.mesh_get_knowledge).toContain('full current record');
    expect(toolDescriptions.mesh_delete_knowledge).toContain('Tombstone one DevMesh knowledge item');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Do not wait for the user');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Before the final response');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Prefer one high-signal item');
    expect(toolDescriptions.mesh_capture_task).toContain('Summarize what changed');
    expect(toolDescriptions.mesh_capture_task).toContain('before stopping after partial work');
    expect(toolDescriptions.mesh_link_knowledge).toContain('supersedes, duplicates, or contradicts');
    expect(toolDescriptions.mesh_scan_project_knowledge).toContain('Capture only durable conclusions');
    expect(toolDescriptions.mesh_explore_knowledge_graph).toContain('related decisions');

    const result = await registered[0]?.callback({ query: 'auth' });
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: expect.stringContaining('DevMesh status')
        }
      ]
    });
    expect(readRegisteredToolText(result)).not.toMatch(/^\s*\{/);
    expect(handlers.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'auto'
      })
    );

    const searchResult = await registered[1]?.callback({ query: 'auth' });
    expect(searchResult).toEqual({
      content: [
        {
          type: 'text',
          text: expect.stringContaining('Auth decision')
        }
      ]
    });
    expect(readRegisteredToolText(searchResult)).not.toMatch(/^\s*\{/);
    expect(handlers.searchContext).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'auth',
        limit: 8
      })
    );

    vi.mocked(handlers.getStatus).mockResolvedValueOnce('DevMesh status');
    const textResult = await registered[0]?.callback({});

    expect(textResult).toEqual({
      content: [
        {
          type: 'text',
          text: 'DevMesh status'
        }
      ]
    });
  });

  it('publishes assistant-led capture server instructions', () => {
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('assistant-led project knowledge memory');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_get_status');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('Before final responses');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_capture_knowledge');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_capture_task');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_link_knowledge');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('Do not capture secrets');
  });
});

function readRegisteredToolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;

  if (text === undefined) {
    throw new Error('Expected a text tool result.');
  }

  return text;
}
