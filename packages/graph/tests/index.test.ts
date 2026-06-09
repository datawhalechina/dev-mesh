import { describe, expect, it } from 'vitest';
import { createKnowledgeItem } from '@devmesh/core';
import { buildKnowledgeGraph, exploreKnowledgeGraph, knowledgeNodeId } from '../src/index.js';

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
});
