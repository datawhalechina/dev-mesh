import { describe, expect, it, vi } from 'vitest';
import {
  DEV_MESH_MCP_INSTRUCTIONS,
  MESH_CORE_TOOL_NAMES,
  MESH_ADMIN_TOOL_NAMES,
  MESH_POWER_TOOL_NAMES,
  meshBranchCreateInputSchema,
  meshBranchListInputSchema,
  meshBranchPolicyInputSchema,
  meshBranchSwitchInputSchema,
  meshAdminConflictQueueInputSchema,
  meshAdminEntityMergeInputSchema,
  meshAdminGraphOverviewInputSchema,
  meshAdminMemberActivityInputSchema,
  meshAdminPolicyUpdateInputSchema,
  meshAdminQualityReviewInputSchema,
  meshCaptureKnowledgeInputSchema,
  meshDeleteKnowledgeInputSchema,
  meshExploreKnowledgeGraphInputSchema,
  meshGetProjectBriefInputSchema,
  meshGetKnowledgeInputSchema,
  meshGetStatusInputSchema,
  meshLinkKnowledgeInputSchema,
  meshListKnowledgeInputSchema,
  meshProjectionRebuildInputSchema,
  meshProjectionStatusInputSchema,
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
    expect(input.includeVolatile).toBeUndefined();
    expect(meshSearchContextInputSchema.parse({ query: 'facts', includeVolatile: true })).toMatchObject({
      includeVolatile: true
    });
    expect(meshSearchContextInputSchema.parse({ query: 'auth', branch: 'frontend' })).toMatchObject({
      branch: 'frontend'
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
      branch: 'frontend',
      ids: ['ki_new'],
      edgeKinds: ['supersedes', 'duplicates', 'contradicts']
    });

    expect(input.branch).toBe('frontend');
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
    expect(meshLinkKnowledgeInputSchema.parse({
      kind: 'duplicates',
      fromId: 'ki_a',
      toId: 'ki_b',
      project: 'frontend-team'
    })).toMatchObject({
      project: 'frontend-team'
    });
  });

  it('applies defaults for status checks', () => {
    expect(meshGetStatusInputSchema.parse({})).toEqual({
      project: 'auto'
    });
    expect(meshProjectionStatusInputSchema.parse({})).toEqual({
      project: 'auto'
    });
    expect(meshProjectionRebuildInputSchema.parse({})).toEqual({
      project: 'auto'
    });
  });

  it('validates knowledge branch tool inputs', () => {
    expect(meshBranchListInputSchema.parse({})).toEqual({
      project: 'auto'
    });
    expect(
      meshBranchCreateInputSchema.parse({
        name: 'frontend',
        policy: 'frontend_design',
        base: 'shared'
      })
    ).toMatchObject({
      name: 'frontend',
      policy: 'frontend_design',
      base: 'shared',
      project: 'auto'
    });
    expect(
      meshBranchSwitchInputSchema.parse({
        name: 'backend',
        policy: 'backend_design'
      })
    ).toMatchObject({
      name: 'backend',
      policy: 'backend_design',
      project: 'auto'
    });
    expect(meshBranchPolicyInputSchema.parse({ policy: 'durable_only' })).toEqual({
      policy: 'durable_only'
    });
    expect(() => meshBranchPolicyInputSchema.parse({ policy: 'project_fact_only' })).toThrow();
  });

  it('validates knowledge CRUD tool inputs', () => {
    expect(meshGetKnowledgeInputSchema.parse({ id: 'ki_1' })).toEqual({
      id: 'ki_1'
    });
    expect(meshListKnowledgeInputSchema.parse({})).toEqual({
      includeSuperseded: false,
      limit: 20
    });
    expect(meshListKnowledgeInputSchema.parse({ includeVolatile: true })).toMatchObject({
      includeVolatile: true
    });
    expect(meshListKnowledgeInputSchema.parse({ branch: 'frontend' })).toMatchObject({
      branch: 'frontend'
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
      getStatus: vi.fn(async () => ({
        service: 'devmesh',
        version: '0.1.0',
        mode: 'test',
        knowledgeItems: 1,
        projection: {
          state: 'ready',
          documentCount: 1
        }
      })),
      getProjectionStatus: vi.fn(async () => ({
        state: 'ready',
        currentHeads: ['head1'],
        sourceHeads: ['head1'],
        message: 'Projections are ready.'
      })),
      rebuildProjection: vi.fn(async () => ({
        documentCount: 1,
        graphNodeCount: 2,
        graphEdgeCount: 3,
        schemaVersion: 3,
        sourceHeads: ['head1'],
        crdtPath: '/tmp/project/.dev-mesh/crdt/project.automerge',
        metadataPath: '/tmp/project/.dev-mesh/index/projection-meta.json'
      })),
      listBranches: vi.fn(async () => ({
        active: 'main',
        branches: [{ name: 'main', active: true, base: false, policy: 'balanced' }]
      })),
      createBranch: vi.fn(async () => ({
        active: 'main',
        branches: [
          { name: 'main', active: true, base: false, policy: 'balanced' },
          { name: 'frontend', active: false, base: false, policy: 'frontend_design' }
        ]
      })),
      switchBranch: vi.fn(async () => ({
        active: 'frontend',
        branches: [
          { name: 'main', active: false, base: false, policy: 'balanced' },
          { name: 'frontend', active: true, base: false, policy: 'frontend_design' }
        ]
      })),
      setBranchPolicy: vi.fn(async () => ({
        active: 'frontend',
        branches: [
          { name: 'main', active: false, base: false, policy: 'balanced' },
          { name: 'frontend', active: true, base: false, policy: 'durable_only' }
        ]
      })),
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
      getProjectBrief: vi.fn(async () => ({ projectId: 'frontend-dashboard', groupKey: 'frontend', items: [] })),
      graphPath: vi.fn(async () => ({
        sourceNodeId: 'knowledge:ki_1',
        targetNodeId: 'knowledge:ki_2',
        pathFound: true,
        nodeIds: ['knowledge:ki_1', 'knowledge:ki_2'],
        nodes: [
          { id: 'knowledge:ki_1', kind: 'knowledge', label: 'Source', metadata: {} },
          { id: 'knowledge:ki_2', kind: 'knowledge', label: 'Target', metadata: {} }
        ],
        edges: [],
        steps: [],
        explanation: 'Source and target already resolve to Source.',
        exploredNodeCount: 2
      })),
      exploreKnowledgeGraph: vi.fn(async () => ({ nodes: [{ id: 'knowledge:ki_1', kind: 'knowledge' }], edges: [] }))
    };

    registerMeshTools(fakeServer as never, handlers);

    expect(registered.map((tool) => tool.name)).toEqual(MESH_CORE_TOOL_NAMES);

    const toolDescriptions = Object.fromEntries(registered.map((tool) => [tool.name, tool.config.description ?? '']));

    expect(toolDescriptions.mesh_get_status).toContain('running DevMesh version');
    expect(toolDescriptions.mesh_projection_status).toContain('CRDT projection health');
    expect(toolDescriptions.mesh_projection_rebuild).toContain('Rebuild local search and graph projections');
    expect(toolDescriptions.mesh_branch_switch).toContain('git checkout');
    expect(toolDescriptions.mesh_branch_policy).toContain('durable_only');
    expect(toolDescriptions.mesh_search_context).toContain('without switching checkout');
    expect(toolDescriptions.mesh_list_knowledge).toContain('branch');
    expect(toolDescriptions.mesh_get_knowledge).toContain('full current record');
    expect(toolDescriptions.mesh_delete_knowledge).toContain('Tombstone one DevMesh knowledge item');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Do not wait for the user');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Before the final response');
    expect(toolDescriptions.mesh_capture_knowledge).toContain('Prefer one high-signal item');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('project_fact');
    expect(toolDescriptions.mesh_capture_task).toContain('Summarize what changed');
    expect(toolDescriptions.mesh_capture_task).toContain('before stopping after partial work');
    expect(toolDescriptions.mesh_link_knowledge).toContain('supersedes, duplicates, or contradicts');
    expect(toolDescriptions.mesh_scan_project_knowledge).toContain('Capture only durable conclusions');
    expect(toolDescriptions.mesh_explore_knowledge_graph).toContain('related decisions');
    expect(toolDescriptions.mesh_explore_knowledge_graph).toContain('without switching checkout');
    expect(registered.map((tool) => tool.name)).not.toContain('mesh_graph_path');

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
    expect(readRegisteredToolText(result)).toContain('projection: state=ready, documentCount=1');
    expect(handlers.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'auto'
      })
    );

    const projectionStatusResult = await registered[1]?.callback({});
    expect(readRegisteredToolText(projectionStatusResult)).toContain('Projection status');
    expect(readRegisteredToolText(projectionStatusResult)).toContain('state: ready');

    const projectionRebuildResult = await registered[2]?.callback({});
    expect(readRegisteredToolText(projectionRebuildResult)).toContain('Projection rebuilt');
    expect(readRegisteredToolText(projectionRebuildResult)).toContain('documents: 1');

    const branchResult = await registered[3]?.callback({});
    expect(branchResult).toEqual({
      content: [
        {
          type: 'text',
          text: expect.stringContaining('Knowledge branches')
        }
      ]
    });
    expect(readRegisteredToolText(branchResult)).toContain('* main');
    expect(handlers.listBranches).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'auto'
      })
    );

    const searchResult = await registered[7]?.callback({ query: 'auth' });
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

    const briefIndex = registered.findIndex((tool) => tool.name === 'mesh_get_project_brief');
    const briefResult = await registered[briefIndex]?.callback({});
    expect(readRegisteredToolText(briefResult)).toContain('Project brief');
    expect(handlers.getProjectBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'auto'
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
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_projection_rebuild');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_branch_switch');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('Before final responses');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_capture_knowledge');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_capture_task');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('mesh_link_knowledge');
    expect(DEV_MESH_MCP_INSTRUCTIONS).toContain('Do not capture secrets');
  });

  it('keeps power tools opt-in at registration time', () => {
    const registered: string[] = [];
    const fakeServer = {
      registerTool(name: string) {
        registered.push(name);
      }
    };

    registerMeshTools(
      fakeServer as never,
      {
        getStatus: vi.fn(async () => ({})),
        getProjectionStatus: vi.fn(async () => ({})),
        rebuildProjection: vi.fn(async () => ({})),
        listBranches: vi.fn(async () => ({})),
        createBranch: vi.fn(async () => ({})),
        switchBranch: vi.fn(async () => ({})),
        setBranchPolicy: vi.fn(async () => ({})),
        searchContext: vi.fn(async () => ({})),
        getKnowledge: vi.fn(async () => ({})),
        listKnowledge: vi.fn(async () => ({})),
        captureKnowledge: vi.fn(async () => ({})),
        updateKnowledge: vi.fn(async () => ({})),
        deleteKnowledge: vi.fn(async () => ({})),
        captureTask: vi.fn(async () => ({})),
        rateKnowledge: vi.fn(async () => ({})),
        linkKnowledge: vi.fn(async () => ({})),
        searchMemberExperience: vi.fn(async () => ({})),
        resolveTerm: vi.fn(async () => ({})),
        scanProjectKnowledge: vi.fn(async () => ({})),
        getProjectBrief: vi.fn(async () => ({})),
        graphPath: vi.fn(async () => ({})),
        exploreKnowledgeGraph: vi.fn(async () => ({}))
      },
      {
        capabilities: {
          power: false
        }
      }
    );

    expect(registered).not.toContain('mesh_graph_path');
    expect(registered).not.toContain('mesh_get_project_brief');
    expect(MESH_POWER_TOOL_NAMES).toEqual(['mesh_get_project_brief', 'mesh_graph_path']);
  });

  it('registers power tools when power capability is enabled', () => {
    const registered: string[] = [];
    const fakeServer = {
      registerTool(name: string) {
        registered.push(name);
      }
    };

    registerMeshTools(
      fakeServer as never,
      {
        getStatus: vi.fn(async () => ({})),
        getProjectionStatus: vi.fn(async () => ({})),
        rebuildProjection: vi.fn(async () => ({})),
        listBranches: vi.fn(async () => ({})),
        createBranch: vi.fn(async () => ({})),
        switchBranch: vi.fn(async () => ({})),
        setBranchPolicy: vi.fn(async () => ({})),
        searchContext: vi.fn(async () => ({})),
        getKnowledge: vi.fn(async () => ({})),
        listKnowledge: vi.fn(async () => ({})),
        captureKnowledge: vi.fn(async () => ({})),
        updateKnowledge: vi.fn(async () => ({})),
        deleteKnowledge: vi.fn(async () => ({})),
        captureTask: vi.fn(async () => ({})),
        rateKnowledge: vi.fn(async () => ({})),
        linkKnowledge: vi.fn(async () => ({})),
        searchMemberExperience: vi.fn(async () => ({})),
        resolveTerm: vi.fn(async () => ({})),
        scanProjectKnowledge: vi.fn(async () => ({})),
        getProjectBrief: vi.fn(async () => ({})),
        graphPath: vi.fn(async () => ({})),
        exploreKnowledgeGraph: vi.fn(async () => ({}))
      },
      {
        capabilities: {
          power: true
        }
      }
    );

    expect(registered).toEqual([
      ...MESH_CORE_TOOL_NAMES.slice(0, -1),
      ...MESH_POWER_TOOL_NAMES,
      MESH_CORE_TOOL_NAMES[MESH_CORE_TOOL_NAMES.length - 1]
    ]);
  });

  it('keeps admin tools opt-in and returns not-implemented placeholders', async () => {
    const registered: string[] = [];
    const toolCallbacks = new Map<string, (args: unknown) => Promise<unknown>>();
    const fakeServer = {
      registerTool(name: string, _config: unknown, callback: (args: unknown) => Promise<unknown>) {
        registered.push(name);
        toolCallbacks.set(name, callback);
      }
    };

    registerMeshTools(
      fakeServer as never,
      {
        getStatus: vi.fn(async () => ({})),
        getProjectionStatus: vi.fn(async () => ({})),
        rebuildProjection: vi.fn(async () => ({})),
        listBranches: vi.fn(async () => ({})),
        createBranch: vi.fn(async () => ({})),
        switchBranch: vi.fn(async () => ({})),
        setBranchPolicy: vi.fn(async () => ({})),
        searchContext: vi.fn(async () => ({})),
        getKnowledge: vi.fn(async () => ({})),
        listKnowledge: vi.fn(async () => ({})),
        captureKnowledge: vi.fn(async () => ({})),
        updateKnowledge: vi.fn(async () => ({})),
        deleteKnowledge: vi.fn(async () => ({})),
        captureTask: vi.fn(async () => ({})),
        rateKnowledge: vi.fn(async () => ({})),
        linkKnowledge: vi.fn(async () => ({})),
        searchMemberExperience: vi.fn(async () => ({})),
        resolveTerm: vi.fn(async () => ({})),
        scanProjectKnowledge: vi.fn(async () => ({})),
        getProjectBrief: vi.fn(async () => ({})),
        graphPath: vi.fn(async () => ({})),
        exploreKnowledgeGraph: vi.fn(async () => ({}))
      },
      {
        capabilities: {
          admin: true
        }
      }
    );

    expect(registered).toEqual([...MESH_CORE_TOOL_NAMES, ...MESH_ADMIN_TOOL_NAMES]);
    expect(meshAdminGraphOverviewInputSchema.parse({})).toEqual({
      limit: 50
    });
    expect(meshAdminMemberActivityInputSchema.parse({ memberId: 'member_1' })).toMatchObject({
      memberId: 'member_1',
      limit: 50
    });
    expect(meshAdminQualityReviewInputSchema.parse({ layer: 'canonical' })).toMatchObject({
      layer: 'canonical',
      limit: 50
    });
    expect(meshAdminConflictQueueInputSchema.parse({ branchKey: 'main' })).toMatchObject({
      branchKey: 'main',
      limit: 50
    });
    expect(meshAdminEntityMergeInputSchema.parse({ fromId: 'a', toId: 'b' })).toMatchObject({
      fromId: 'a',
      toId: 'b'
    });
    expect(meshAdminPolicyUpdateInputSchema.parse({ policy: 'balanced' })).toEqual({
      policy: 'balanced'
    });

    const result = await toolCallbacks.get('mesh_admin_graph_overview')?.({});
    expect(readRegisteredToolText(result)).toContain('Admin graph overview');
    expect(registered).not.toContain('mesh_graph_path');
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
