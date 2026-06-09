import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDevMeshCore, createKnowledgeItem } from '@devmesh/core';
import {
  acceptPendingKnowledge,
  captureProjectKnowledge,
  captureProjectTask,
  enqueuePendingKnowledge,
  ensureProjectStore,
  JsonlKnowledgeRepository,
  listPendingKnowledge,
  migrateProjectStore,
  PROJECT_STORE_SCHEMA_VERSION,
  readProjectConfig,
  recordKnowledgeUsage,
  rateProjectKnowledge,
  rebuildProjectIndex,
  rejectPendingKnowledge,
  searchProjectIndex
} from '../src/index.js';

describe('local project store', () => {
  it('bootstraps .dev-mesh and stores knowledge as jsonl', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const config = await readFile(store.paths.config, 'utf8');
      expect(config).toContain('project_key = "org/repo"');
      expect(config).toContain('auto_reference = true');
      await expect(readProjectConfig(projectRoot)).resolves.toMatchObject({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        projectKey: 'org/repo',
        localOnly: true,
        automation: {
          autoInit: true,
          autoSync: true
        },
        privacy: {
          redactionEnabled: true,
          uploadRawTranscripts: false
        }
      });

      const repository = new JsonlKnowledgeRepository(projectRoot);
      const item = createKnowledgeItem({
        type: 'command',
        title: 'Run unit tests',
        summary: 'Use pnpm test before pushing.'
      });
      await repository.upsert(item);

      const results = await repository.search({ query: 'unit tests' });
      expect(results[0]?.id).toBe(item.id);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('is idempotent and writes safety defaults', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const first = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const second = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });

      expect(second.storeRoot).toBe(first.storeRoot);
      await expect(stat(first.paths.indexDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.queueDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.secretsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

      const gitignore = await readFile(join(first.storeRoot, '.gitignore'), 'utf8');
      expect(gitignore).toContain('index/');
      expect(gitignore).toContain('secrets/');
      expect(gitignore).toContain('knowledge/raw/');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('deduplicates repeated JSONL items by id when reading', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const original = createKnowledgeItem({
        type: 'decision',
        title: 'Prefer JSONL',
        summary: 'Original summary.'
      });
      const replacement = {
        ...original,
        summary: 'Replacement summary.',
        updatedAt: new Date(Date.parse(original.updatedAt) + 1000).toISOString()
      };

      await repository.upsert(original);
      await repository.upsert(replacement);

      const loaded = await repository.get(original.id);
      expect(loaded?.summary).toBe('Replacement summary.');
      expect(await repository.list({ includeSuperseded: true })).toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('migrates old config files to the current schema while preserving values', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot, { projectKey: 'org/repo', displayName: 'Xiaoyun' });
      await writeFile(
        store.paths.config,
        [
          'schema_version = 0',
          'project_key = "org/repo"',
          'display_name = "Xiaoyun"',
          'local_only = true',
          '',
          '[automation]',
          'auto_init = true',
          'auto_reference = false',
          'auto_sync = true',
          '',
          '[privacy]',
          'redaction_enabled = true',
          'upload_raw_transcripts = false',
          'upload_large_source_blocks = false',
          ''
        ].join('\n'),
        'utf8'
      );

      const migrated = await migrateProjectStore(projectRoot);
      const migratedToml = await readFile(store.paths.config, 'utf8');

      expect(migrated).toMatchObject({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        projectKey: 'org/repo',
        displayName: 'Xiaoyun',
        automation: {
          autoReference: false
        }
      });
      expect(migratedToml).toContain(`schema_version = ${PROJECT_STORE_SCHEMA_VERSION}`);
      expect(migratedToml).toContain('auto_reference = false');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects project stores created by a newer schema', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot);
      await writeFile(
        store.paths.config,
        [
          'schema_version = 999',
          'project_key = "future/repo"',
          'display_name = "future"',
          'local_only = true',
          ''
        ].join('\n'),
        'utf8'
      );

      await expect(ensureProjectStore(projectRoot)).rejects.toMatchObject({
        code: 'project_store.unsupported_schema'
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rebuilds a local index manifest from JSONL knowledge', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const item = createKnowledgeItem({
        type: 'decision',
        layer: 'canonical',
        title: 'Rebuild local index',
        summary: 'The derived index can be rebuilt from JSONL knowledge.',
        tags: ['index']
      });

      await repository.upsert(item);

      const result = await rebuildProjectIndex(projectRoot);
      const manifest = JSON.parse(await readFile(result.indexPath, 'utf8')) as {
        schemaVersion: number;
        documentCount: number;
        documents: Array<{ id: string; text: string; tags: string[] }>;
      };
      const graph = JSON.parse(await readFile(result.graphPath, 'utf8')) as {
        schemaVersion: number;
        sourceItemCount: number;
        nodes: Array<{ id: string; kind: string }>;
        edges: Array<{ kind: string }>;
      };
      const indexHits = await searchProjectIndex(projectRoot, {
        query: 'derived index',
        limit: 5
      });
      const repositoryHits = await repository.search({
        query: 'derived index',
        limit: 5
      });

      expect(result.documentCount).toBe(1);
      expect(result.graphNodeCount).toBeGreaterThan(0);
      expect(result.graphEdgeCount).toBeGreaterThan(0);
      await expect(stat(result.sqlitePath)).resolves.toMatchObject({ isFile: expect.any(Function) });
      expect(manifest.schemaVersion).toBe(PROJECT_STORE_SCHEMA_VERSION);
      expect(manifest.documentCount).toBe(1);
      expect(manifest.documents[0]).toMatchObject({
        id: item.id,
        tags: ['index']
      });
      expect(manifest.documents[0]?.text).toContain('Rebuild local index');
      expect(manifest.documents[0]?.text).toContain(item.entryKey);
      expect(graph.schemaVersion).toBe(PROJECT_STORE_SCHEMA_VERSION);
      expect(graph.sourceItemCount).toBe(1);
      expect(graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: `knowledge:${item.id}` })]));
      expect(graph.edges.map((edge) => edge.kind)).toEqual(expect.arrayContaining(['belongs_to_para', 'tagged_with']));
      expect(indexHits[0]).toMatchObject({
        id: item.id,
        score: expect.any(Number)
      });
      expect(repositoryHits[0]).toMatchObject({
        id: item.id,
        title: 'Rebuild local index'
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('captures project knowledge with an append-only event', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const captured = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        layer: 'canonical',
        title: 'Capture durable decisions',
        summary: 'Published knowledge should leave an event trail.',
        tags: ['capture'],
        createdBy: {
          displayName: 'Xiaoyun'
        }
      });
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const eventJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'events', `${captured.event.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );

      await expect(repository.get(captured.item.id)).resolves.toMatchObject({
        title: 'Capture durable decisions',
        layer: 'canonical'
      });
      expect(captured.event).toMatchObject({
        kind: 'knowledge.captured',
        projectKey: 'org/repo',
        payload: {
          knowledgeId: captured.item.id,
          type: 'decision',
          title: 'Capture durable decisions'
        }
      });
      expect(eventJsonl).toContain('"kind":"knowledge.captured"');
      expect(eventJsonl).toContain(`"knowledgeId":"${captured.item.id}"`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('captures task progress as task knowledge and a task event', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const captured = await captureProjectTask(projectRoot, {
        title: 'Finish local write path',
        summary: 'Capture task status in the project store.',
        status: 'blocked',
        tags: ['task'],
        para: {
          category: 'projects',
          key: 'devmesh'
        },
        createdBy: {
          displayName: 'Xiaoyun'
        }
      });
      const repository = new JsonlKnowledgeRepository(projectRoot);

      await expect(repository.get(captured.item.id)).resolves.toMatchObject({
        type: 'task',
        title: 'Finish local write path',
        summary: '[blocked] Capture task status in the project store.',
        source: {
          kind: 'task'
        }
      });
      expect(captured).toMatchObject({
        status: 'blocked',
        event: {
          kind: 'task.progress.captured',
          payload: {
            knowledgeId: captured.item.id,
            status: 'blocked'
          }
        }
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('stores explicit knowledge feedback in ratings JSONL without polluting knowledge search', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });
      const captured = await captureProjectKnowledge(projectRoot, {
        type: 'pitfall',
        title: 'Old local cache note',
        summary: 'This note needs updated feedback.'
      });
      const rated = await rateProjectKnowledge(
        projectRoot,
        core,
        {
          id: captured.item.id,
          rating: 0,
          confidenceDelta: -0.2,
          weightDelta: -0.5
        },
        {
          reason: 'Outdated after the new index path.',
          createdBy: {
            displayName: 'Ayuan'
          }
        }
      );
      const ratingsJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'ratings', `${rated.rating.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );
      const allItems = await repository.list({ includeSuperseded: true });

      expect(rated.item).toMatchObject({
        id: captured.item.id,
        quality: {
          rating: 0,
          weight: 0.5
        }
      });
      expect(rated.item.quality.confidence).toBeCloseTo(0.35);
      expect(rated.rating).toMatchObject({
        knowledgeId: captured.item.id,
        rating: 0,
        confidenceDelta: -0.2,
        weightDelta: -0.5,
        reason: 'Outdated after the new index path.',
        createdBy: {
          displayName: 'Ayuan'
        }
      });
      expect(ratingsJsonl).toContain('"knowledgeId"');
      expect(ratingsJsonl).toContain('"reason":"Outdated after the new index path."');
      expect(rated.event).toMatchObject({
        kind: 'knowledge.rated',
        payload: {
          ratingId: rated.rating.id,
          knowledgeId: captured.item.id
        }
      });
      expect(allItems).toHaveLength(1);
      expect(allItems[0]?.id).toBe(captured.item.id);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('records usage feedback outside ratings and updates adoption quality', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });
      const captured = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        title: 'Reuse local context pack hits',
        summary: 'Context pack hits should improve adoption without becoming explicit ratings.'
      });
      const used = await recordKnowledgeUsage(
        projectRoot,
        core,
        {
          knowledgeId: captured.item.id,
          kind: 'context_pack.hit',
          adoptionDelta: 0.01,
          context: {
            query: 'local context',
            rank: 1
          }
        },
        {
          reason: 'Returned in a context pack.',
          createdBy: {
            displayName: 'Ayuan'
          }
        }
      );
      const usageJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'usage', `${used.usage.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );
      const eventsJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'events', `${used.event.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );
      const allItems = await repository.list({ includeSuperseded: true });

      expect(used.item.quality.adoptionScore).toBeCloseTo(0.01);
      expect(used.usage).toMatchObject({
        knowledgeId: captured.item.id,
        kind: 'context_pack.hit',
        adoptionDelta: 0.01,
        reason: 'Returned in a context pack.',
        createdBy: {
          displayName: 'Ayuan'
        },
        context: {
          query: 'local context',
          rank: 1
        }
      });
      expect(usageJsonl).toContain('"kind":"context_pack.hit"');
      expect(usageJsonl).toContain(`"knowledgeId":"${captured.item.id}"`);
      await expect(
        readFile(
          join(projectRoot, '.dev-mesh', 'knowledge', 'ratings', `${used.usage.createdAt.slice(0, 7)}.jsonl`),
          'utf8'
        )
      ).rejects.toMatchObject({
        code: 'ENOENT'
      });
      expect(eventsJsonl).toContain('"kind":"knowledge.used"');
      expect(allItems).toHaveLength(1);
      expect(allItems[0]?.id).toBe(captured.item.id);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reviews queued knowledge by accepting or rejecting pending candidates', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const acceptedCandidate = await enqueuePendingKnowledge(
        projectRoot,
        {
          type: 'decision',
          title: 'Review queue acceptance',
          summary: 'Accepted candidates become searchable project knowledge.',
          tags: ['review']
        },
        {
          reason: 'High-risk knowledge capture.',
          risk: 'high'
        }
      );

      expect(await listPendingKnowledge(projectRoot)).toMatchObject([
        {
          id: acceptedCandidate.id,
          kind: 'knowledge',
          risk: 'high',
          input: {
            id: acceptedCandidate.input.id,
            title: 'Review queue acceptance'
          }
        }
      ]);

      const accepted = await acceptPendingKnowledge(projectRoot, acceptedCandidate.id);
      const repository = new JsonlKnowledgeRepository(projectRoot);

      expect(accepted.item).toMatchObject({
        id: acceptedCandidate.input.id,
        title: 'Review queue acceptance'
      });
      await expect(repository.get(accepted.item.id)).resolves.toMatchObject({
        title: 'Review queue acceptance'
      });
      expect(await listPendingKnowledge(projectRoot)).toHaveLength(0);
      expect(accepted.event).toMatchObject({
        kind: 'knowledge.review.accepted',
        payload: {
          queueId: acceptedCandidate.id,
          knowledgeId: accepted.item.id
        }
      });

      const rejectedCandidate = await enqueuePendingKnowledge(projectRoot, {
        type: 'pitfall',
        title: 'Reject noisy candidate',
        summary: 'This candidate is not durable enough.'
      });
      const rejected = await rejectPendingKnowledge(projectRoot, rejectedCandidate.id, 'Not durable enough.');
      const rejectedJsonl = await readFile(join(projectRoot, '.dev-mesh', 'queue', 'rejected.jsonl'), 'utf8');

      expect(await listPendingKnowledge(projectRoot)).toHaveLength(0);
      expect(rejected.queueItem).toMatchObject({
        id: rejectedCandidate.id,
        status: 'rejected',
        rejectedReason: 'Not durable enough.'
      });
      expect(rejectedJsonl).toContain('"status":"rejected"');
      expect(rejected.event).toMatchObject({
        kind: 'knowledge.review.rejected',
        payload: {
          queueId: rejectedCandidate.id,
          reason: 'Not durable enough.'
        }
      });
      await expect(repository.get(rejectedCandidate.input.id ?? '')).resolves.toBeUndefined();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
