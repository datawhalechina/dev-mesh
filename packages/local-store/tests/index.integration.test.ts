import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevMeshCore } from '@mcp-dev-mesh/core';
import {
  captureProjectKnowledge,
  JsonlKnowledgeRepository,
  rateProjectKnowledge,
  rebuildProjectIndex,
  searchProjectIndex
} from '../src/index.js';

describe('local-store SQLite repository integration', () => {
  it('persists JSONL knowledge, rebuilds SQLite FTS, and keeps ratings outside knowledge reads', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-sqlite-repository-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });
      const canonical = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        layer: 'canonical',
        title: 'SQLite repository integration path',
        summary: 'The local repository rebuilds the SQLite index for river-needle lookups.',
        tags: ['sqlite', 'repository'],
        para: {
          category: 'areas',
          key: 'storage/local-store'
        }
      });
      const extract = await captureProjectKnowledge(projectRoot, {
        type: 'pitfall',
        layer: 'extract',
        title: 'Do not index ratings as knowledge',
        summary: 'Feedback records belong in knowledge/ratings and must not appear as normal knowledge items.',
        tags: ['ratings']
      });
      const rated = await rateProjectKnowledge(
        projectRoot,
        core,
        {
          id: canonical.item.id,
          rating: 1,
          adoptionDelta: 0.2
        },
        {
          reason: 'Integration test feedback should stay out of the FTS document set.'
        }
      );
      const rebuilt = await rebuildProjectIndex(projectRoot);
      const manifest = JSON.parse(await readFile(rebuilt.indexPath, 'utf8')) as {
        documentCount: number;
        documents: Array<{ id: string; title: string }>;
      };
      const directSqliteHits = await searchProjectIndex(projectRoot, {
        query: 'river-needle',
        limit: 5
      });
      const repositoryHits = await repository.search({
        query: 'river-needle',
        limit: 5
      });
      const allKnowledge = await repository.list({ includeSuperseded: true });

      await expect(stat(rebuilt.sqlitePath)).resolves.toMatchObject({
        isFile: expect.any(Function)
      });
      expect(rebuilt.documentCount).toBe(2);
      expect(manifest.documentCount).toBe(2);
      expect(manifest.documents.map((document) => document.id).sort()).toEqual(
        [canonical.item.id, extract.item.id].sort()
      );
      expect(manifest.documents.map((document) => document.id)).not.toContain(rated.rating.id);
      expect(directSqliteHits[0]).toMatchObject({
        id: canonical.item.id,
        score: expect.any(Number)
      });
      expect(repositoryHits[0]).toMatchObject({
        id: canonical.item.id,
        title: 'SQLite repository integration path'
      });
      expect(allKnowledge.map((item) => item.id).sort()).toEqual([canonical.item.id, extract.item.id].sort());
      expect(allKnowledge.find((item) => item.id === canonical.item.id)?.quality.rating).toBe(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
