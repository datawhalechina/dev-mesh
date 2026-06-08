import { describe, expect, it, vi } from 'vitest';
import {
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
    const registered: Array<{ name: string; callback: (args: unknown) => Promise<unknown> }> = [];
    const fakeServer = {
      registerTool(name: string, _config: unknown, callback: (args: unknown) => Promise<unknown>) {
        registered.push({ name, callback });
      }
    };
    const handlers: MeshToolHandlers = {
      searchContext: vi.fn(async () => ({ ok: 'search' })),
      captureKnowledge: vi.fn(async () => ({ ok: 'capture' })),
      captureTask: vi.fn(async () => ({ ok: 'task' })),
      rateKnowledge: vi.fn(async () => ({ ok: 'rate' })),
      searchMemberExperience: vi.fn(async () => ({ ok: 'member' })),
      resolveTerm: vi.fn(async () => ({ ok: 'term' })),
      listDevelopmentSignals: vi.fn(async () => ({ ok: 'signals' }))
    };

    registerMeshTools(fakeServer as never, handlers);

    expect(registered.map((tool) => tool.name)).toEqual([
      'mesh_search_context',
      'mesh_capture_knowledge',
      'mesh_capture_task',
      'mesh_rate_knowledge',
      'mesh_search_member_experience',
      'mesh_resolve_term',
      'mesh_list_development_signals'
    ]);

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
});
