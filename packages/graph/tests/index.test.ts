import { describe, expect, it } from 'vitest';
import { createKnowledgeItem } from '@devmesh/core';
import { buildKnowledgeGraph, exploreKnowledgeGraph, findKnowledgeGraphPath, knowledgeNodeId } from '../src/index.js';

describe('knowledge graph', () => {
  it('builds graph nodes and edges from knowledge items', () => {
    const item = createKnowledgeItem({
      id: 'ki_button',
      type: 'decision',
      title: 'Button tokens',
      summary: 'Buttons use shared design tokens.',
      para: {
        category: 'areas',
        key: 'frontend/styles'
      },
      tags: ['frontend', 'tokens'],
      createdBy: {
        displayName: 'Xiaoyun',
        handle: 'xy'
      },
      source: {
        kind: 'commit',
        commit: 'abc123'
      },
      createdAt: '2026-06-09T10:00:00.000Z'
    });
    const graph = buildKnowledgeGraph([item], {
      now: () => new Date('2026-06-09T11:00:00.000Z')
    });

    expect(graph.generatedAt).toBe('2026-06-09T11:00:00.000Z');
    expect(graph.sourceItemCount).toBe(1);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: knowledgeNodeId('ki_button'),
          kind: 'knowledge',
          label: 'Button tokens'
        }),
        expect.objectContaining({
          kind: 'para',
          label: 'areas/frontend/styles'
        }),
        expect.objectContaining({
          kind: 'member',
          label: 'Xiaoyun'
        }),
        expect.objectContaining({
          kind: 'tag',
          label: 'tokens'
        })
      ])
    );
    expect(graph.edges.map((edge) => edge.kind)).toEqual(
      expect.arrayContaining(['authored_by', 'belongs_to_para', 'has_type', 'sourced_from', 'tagged_with'])
    );
  });

  it('explores related knowledge through shared graph neighbors', () => {
    const first = createKnowledgeItem({
      id: 'ki_first',
      type: 'decision',
      title: 'Button tokens',
      summary: 'Buttons use shared design tokens.',
      para: {
        category: 'areas',
        key: 'frontend/styles'
      },
      tags: ['frontend'],
      createdAt: '2026-06-09T10:00:00.000Z'
    });
    const second = createKnowledgeItem({
      id: 'ki_second',
      type: 'pitfall',
      title: 'Avoid hardcoded colors',
      summary: 'Hardcoded colors drift from shared theme tokens.',
      para: {
        category: 'areas',
        key: 'frontend/styles'
      },
      tags: ['frontend'],
      createdAt: '2026-06-09T10:05:00.000Z'
    });
    const graph = buildKnowledgeGraph([first, second]);
    const explored = exploreKnowledgeGraph(graph, {
      ids: ['ki_first'],
      depth: 2,
      limit: 20
    });

    expect(explored.seedNodeIds).toEqual([knowledgeNodeId('ki_first')]);
    expect(explored.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([knowledgeNodeId('ki_second')]));
    expect(explored.edges.length).toBeGreaterThan(0);
  });

  it('builds and explores semantic knowledge edges', () => {
    const oldDecision = createKnowledgeItem({
      id: 'ki_old',
      type: 'decision',
      title: 'Use polling sync',
      summary: 'The daemon scans Git and filesystem signals on an interval.',
      createdAt: '2026-06-09T09:00:00.000Z'
    });
    const newDecision = createKnowledgeItem({
      id: 'ki_new',
      type: 'decision',
      title: 'Use assistant-led capture',
      summary: 'Assistants decide when to capture durable project knowledge.',
      createdAt: '2026-06-09T10:00:00.000Z'
    });
    const duplicate = createKnowledgeItem({
      id: 'ki_duplicate',
      type: 'decision',
      title: 'Assistant capture habit',
      summary: 'Capture only durable conclusions after meaningful work.',
      createdAt: '2026-06-09T10:05:00.000Z'
    });
    const conflict = createKnowledgeItem({
      id: 'ki_conflict',
      type: 'pitfall',
      title: 'Avoid background polling',
      summary: 'Polling signals can add overhead without improving capture quality.',
      createdAt: '2026-06-09T10:10:00.000Z'
    });
    const graph = buildKnowledgeGraph([oldDecision, newDecision, duplicate, conflict], {
      semanticEdges: [
        {
          id: 'edge_supersedes',
          kind: 'supersedes',
          fromId: 'ki_new',
          toId: 'ki_old',
          reason: 'The newer decision replaces polling-based capture.'
        },
        {
          id: 'edge_duplicates',
          kind: 'duplicates',
          fromId: 'ki_duplicate',
          toId: 'ki_new'
        },
        {
          id: 'edge_contradicts',
          kind: 'contradicts',
          fromId: 'ki_conflict',
          toId: 'ki_old'
        },
        {
          id: 'edge_missing',
          kind: 'duplicates',
          fromId: 'ki_missing',
          toId: 'ki_new'
        }
      ]
    });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `supersedes:${knowledgeNodeId('ki_new')}->${knowledgeNodeId('ki_old')}`,
          from: knowledgeNodeId('ki_new'),
          to: knowledgeNodeId('ki_old'),
          kind: 'supersedes',
          evidence: ['edge_supersedes']
        }),
        expect.objectContaining({
          kind: 'duplicates'
        }),
        expect.objectContaining({
          kind: 'contradicts'
        })
      ])
    );
    expect(graph.edges.some((edge) => edge.evidence.includes('edge_missing'))).toBe(false);

    const explored = exploreKnowledgeGraph(graph, {
      ids: ['ki_new'],
      depth: 1,
      edgeKinds: ['supersedes'],
      limit: 10
    });

    expect(explored.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([knowledgeNodeId('ki_new'), knowledgeNodeId('ki_old')])
    );
    expect(explored.edges.map((edge) => edge.kind)).toEqual(['supersedes']);
  });

  it('finds an explanatory path between related knowledge items', () => {
    const currentTask = createKnowledgeItem({
      id: 'ki_task',
      type: 'task',
      title: 'Implement graph.path',
      summary: 'The current task needs a graph path to a prior decision.',
      tags: ['graph', 'path'],
      createdAt: '2026-06-09T10:00:00.000Z'
    });
    const packageEntity = createKnowledgeItem({
      id: 'ki_package',
      type: 'design_principle',
      title: 'Local-store exposes graph traversal helpers',
      summary: 'The local store reuses graph building and traversal primitives.',
      para: {
        category: 'projects',
        key: 'mcp-context-mesh'
      },
      createdAt: '2026-06-09T10:01:00.000Z'
    });
    const apiEntity = createKnowledgeItem({
      id: 'ki_api',
      type: 'decision',
      title: 'Expose graph path through runtime',
      summary: 'Runtime should surface graph path as a first-class operation.',
      createdAt: '2026-06-09T10:02:00.000Z'
    });
    const historicalPitfall = createKnowledgeItem({
      id: 'ki_pitfall',
      type: 'pitfall',
      title: 'Avoid text-hit-only graph tools',
      summary: 'Graph tools that only return text hits are hard to explain.',
      createdAt: '2026-06-09T10:03:00.000Z'
    });
    const canonicalDecision = createKnowledgeItem({
      id: 'ki_decision',
      type: 'decision',
      title: 'Use graph paths for explanation',
      summary: 'Return knowledge paths instead of only text matches.',
      createdAt: '2026-06-09T10:04:00.000Z'
    });
    const graph = buildKnowledgeGraph([currentTask, packageEntity, apiEntity, historicalPitfall, canonicalDecision], {
      semanticEdges: [
        {
          kind: 'supersedes',
          fromId: 'ki_task',
          toId: 'ki_package'
        },
        {
          kind: 'supersedes',
          fromId: 'ki_package',
          toId: 'ki_api'
        },
        {
          kind: 'contradicts',
          fromId: 'ki_api',
          toId: 'ki_pitfall'
        },
        {
          kind: 'supersedes',
          fromId: 'ki_pitfall',
          toId: 'ki_decision'
        }
      ]
    });

    const path = findKnowledgeGraphPath(graph, {
      sourceId: 'ki_task',
      targetId: 'ki_decision',
      depth: 4
    });

    expect(path.pathFound).toBe(true);
    expect(path.nodeIds).toEqual([
      knowledgeNodeId('ki_task'),
      knowledgeNodeId('ki_package'),
      knowledgeNodeId('ki_api'),
      knowledgeNodeId('ki_pitfall'),
      knowledgeNodeId('ki_decision')
    ]);
    expect(path.steps.map((step) => step.kind)).toEqual([
      'supersedes',
      'supersedes',
      'contradicts',
      'supersedes'
    ]);
    expect(path.explanation).toContain('supersedes');
  });

  it('reports when a path endpoint cannot be resolved', () => {
    const graph = buildKnowledgeGraph([]);
    const path = findKnowledgeGraphPath(graph, {
      sourceId: 'missing',
      targetId: 'also-missing'
    });

    expect(path.pathFound).toBe(false);
    expect(path.message).toContain('Unable to resolve');
  });
});
