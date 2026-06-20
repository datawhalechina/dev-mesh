import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevMeshCore } from '@devmesh/core';
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
      await expect(stat(rebuilt.knowledgePath)).resolves.toMatchObject({
        isFile: expect.any(Function)
      });
      await expect(stat(rebuilt.searchPath)).resolves.toMatchObject({
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
  }, 15_000);

  it('combines SQLite keyword hits with member filters and quality ranking', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-sqlite-member-search-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const lowWeight = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        layer: 'extract',
        title: 'Member memory ranking token',
        summary: 'The ranking-token entry has the same keyword text but weak local quality.',
        weight: 0.2,
        createdBy: {
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const highWeight = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        layer: 'extract',
        title: 'Member memory ranking token',
        summary: 'The ranking-token entry has the same keyword text and strong local quality.',
        weight: 2,
        createdBy: {
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });

      await rebuildProjectIndex(projectRoot);

      const ranked = await repository.search({
        query: 'ranking-token',
        limit: 2
      });
      const memberSpecific = await repository.search({
        query: 'ranking-token',
        authorName: 'xiao',
        limit: 2
      });

      expect(ranked.map((item) => item.id)).toEqual([highWeight.item.id, lowWeight.item.id]);
      expect(memberSpecific.map((item) => item.id)).toEqual([highWeight.item.id]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps volatile and expired project facts out of SQLite projection recall by default', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-sqlite-volatile-recall-'));

    try {
      await captureProjectKnowledge(projectRoot, {
        id: 'kn_sqlite_durable_recall',
        type: 'decision',
        layer: 'canonical',
        title: 'Durable recall policy',
        summary: 'The recall-token durable item should stay in default projection search.'
      });
      await captureProjectKnowledge(projectRoot, {
        id: 'kn_sqlite_project_fact_recall',
        type: 'project_fact',
        layer: 'extract',
        title: 'Temporary recall policy',
        summary: 'The recall-token volatile project fact should require explicit projection recall.',
        createdAt: '2026-01-01T00:00:00.000Z'
      });

      await rebuildProjectIndex(projectRoot);

      const defaultHits = await searchProjectIndex(projectRoot, {
        query: 'recall-token',
        limit: 10
      });
      const volatileHits = await searchProjectIndex(projectRoot, {
        query: 'recall-token',
        includeVolatile: true,
        limit: 10
      });
      const typedHits = await searchProjectIndex(projectRoot, {
        query: 'recall-token',
        types: ['project_fact'],
        limit: 10
      });

      expect(defaultHits.map((hit) => hit.id)).toEqual(['kn_sqlite_durable_recall']);
      expect(volatileHits.map((hit) => hit.id)).toEqual(
        expect.arrayContaining(['kn_sqlite_durable_recall', 'kn_sqlite_project_fact_recall'])
      );
      expect(typedHits.map((hit) => hit.id)).toEqual(['kn_sqlite_project_fact_recall']);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
