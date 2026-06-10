import { describe, expect, it } from 'vitest';
import { createDevMeshCore, createKnowledgeItem, InMemoryKnowledgeRepository } from '../src/index.js';

describe('createDevMeshCore', () => {
  it('captures and searches knowledge', async () => {
    const core = createDevMeshCore();

    const item = await core.captureKnowledge({
      type: 'decision',
      title: 'Auth sessions are read through AuthSession',
      summary: 'Use AuthSession as the boundary for login state.',
      para: { category: 'areas', key: 'backend/auth' },
      layer: 'canonical',
      createdBy: { displayName: 'Xiaoyun', handle: 'xiaoyun' }
    });

    const results = await core.searchKnowledge({
      query: 'login session',
      para: { category: 'areas', key: 'backend/auth' },
      authorName: 'xiaoyun'
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(item.id);
    expect(results[0]?.quality.qualityScore).toBeGreaterThan(0);
  });

  it('updates rating signals without replacing the item identity', async () => {
    const core = createDevMeshCore();
    const item = await core.captureKnowledge({
      type: 'pitfall',
      title: 'Avoid committing local indexes',
      summary: '.dev-mesh/index is rebuildable and should stay local.'
    });

    const updated = await core.rateKnowledge({
      id: item.id,
      rating: 1,
      adoptionDelta: 0.25
    });

    expect(updated.id).toBe(item.id);
    expect(updated.quality.rating).toBe(1);
    expect(updated.quality.adoptionScore).toBe(0.25);
  });

  it('updates and tombstones knowledge without replacing the item identity', async () => {
    const core = createDevMeshCore();
    const item = await core.captureKnowledge({
      type: 'note',
      title: 'Draft deployment note',
      summary: 'Initial deployment wording.',
      content: 'Remove this content later.',
      tags: ['draft']
    });

    const updated = await core.updateKnowledge({
      id: item.id,
      title: 'Deployment note',
      summary: 'Updated deployment wording.',
      content: null,
      tags: ['release'],
      confidence: 0.9
    });

    expect(updated.id).toBe(item.id);
    expect(updated.title).toBe('Deployment note');
    expect(updated.summary).toBe('Updated deployment wording.');
    expect(updated.content).toBeUndefined();
    expect(updated.tags).toEqual(['release']);
    expect(updated.quality.confidence).toBe(0.9);

    const deleted = await core.deleteKnowledge({ id: item.id });

    expect(deleted.id).toBe(item.id);
    expect(deleted.status).toBe('tombstone');
    expect(await core.searchKnowledge({ query: 'deployment' })).toHaveLength(0);
    expect(await core.searchKnowledge({ query: 'deployment', includeSuperseded: true })).toHaveLength(1);
  });

  it('applies layer defaults and PARA inference when capturing knowledge', async () => {
    const core = createDevMeshCore();

    const canonical = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'Prefer project stores',
      summary: 'Project knowledge lives under .dev-mesh.'
    });
    const task = await core.captureKnowledge({
      type: 'task',
      title: 'Finish local proxy',
      summary: 'Implement the MCP proxy loop.'
    });
    const command = await core.captureKnowledge({
      type: 'command',
      title: 'Run focused tests',
      summary: 'Use pnpm test:unit for fast feedback.'
    });

    expect(canonical.quality.confidence).toBe(0.8);
    expect(canonical.para).toEqual({ category: 'areas', key: 'general' });
    expect(task.para).toEqual({ category: 'projects', key: 'current' });
    expect(command.para).toEqual({ category: 'resources', key: 'developer-workflow' });
  });

  it('filters superseded knowledge unless explicitly included', async () => {
    const repository = new InMemoryKnowledgeRepository();
    const active = createKnowledgeItem({
      type: 'decision',
      title: 'Use canonical entries',
      summary: 'Active knowledge should be visible.'
    });
    const superseded = {
      ...createKnowledgeItem({
        type: 'decision',
        title: 'Use stale entries',
        summary: 'Superseded knowledge should be hidden.'
      }),
      status: 'superseded' as const
    };
    await repository.upsert(active);
    await repository.upsert(superseded);

    const core = createDevMeshCore({ repository });

    expect(await core.searchKnowledge({ query: 'entries' })).toHaveLength(1);
    expect(await core.searchKnowledge({ query: 'entries', includeSuperseded: true })).toHaveLength(2);
  });

  it('uses knowledge weight as a ranking multiplier', async () => {
    const core = createDevMeshCore();
    const lowWeight = await core.captureKnowledge({
      type: 'note',
      title: 'Search ranking policy',
      summary: 'The ranking policy can be weak evidence.',
      weight: 0.2
    });
    const highWeight = await core.captureKnowledge({
      type: 'note',
      title: 'Search ranking policy',
      summary: 'The ranking policy is strongly adopted.',
      weight: 2
    });

    const [first, second] = await core.searchKnowledge({ query: 'ranking policy', limit: 2 });

    expect(first?.id).toBe(highWeight.id);
    expect(second?.id).toBe(lowWeight.id);
  });

  it('throws a domain error when rating a missing item', async () => {
    const core = createDevMeshCore();

    await expect(core.rateKnowledge({ id: 'missing', rating: 1 })).rejects.toMatchObject({
      code: 'knowledge.not_found'
    });
  });
});
