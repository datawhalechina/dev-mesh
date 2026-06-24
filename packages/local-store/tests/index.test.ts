import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDevMeshCore, createKnowledgeItem } from '@devmesh/core';
import {
  acceptPendingKnowledge,
  captureProjectKnowledge,
  captureProjectTask,
  createProjectKnowledgeEdge,
  deleteProjectKnowledge,
  enqueuePendingKnowledge,
  ensureProjectStore,
  exportProjectCrdtKnowledgeJsonl,
  importProjectJsonlToCrdt,
  initializeProjectCrdtStore,
  JsonlKnowledgeRepository,
  listProjectKnowledgeEdges,
  listPendingKnowledge,
  migrateProjectStore,
  PROJECT_STORE_SCHEMA_VERSION,
  QUALITY_PROJECTION_ALGORITHM_VERSION,
  readProjectGraph,
  readProjectConfig,
  readProjectQualityProjection,
  readProjectProjectionStatus,
  loadProjectKnowledgeItemsFromCrdt,
  recordKnowledgeUsage,
  rateProjectKnowledge,
  rebuildProjectIndex,
  rebuildProjectGraph,
  rebuildProjectProjectionsFromCrdt,
  rejectPendingKnowledge,
  searchProjectIndex,
  writeProjectConfig,
  updateProjectKnowledge
} from '../src/index.js';

describe('local project store', () => {
  it('bootstraps .dev-mesh and stores knowledge as jsonl', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const config = await readFile(store.paths.config, 'utf8');
      expect(config).toContain('project_key = "org/repo"');
      expect(config).toContain('auto_reference = true');
      expect(config).toContain('[knowledge_branch]');
      expect(config).toContain('active = "main"');
      expect(config).toContain('[knowledge]');
      expect(config).toContain('auto_capture_types = [');
      expect(config).toContain('include_volatile_in_context = false');
      await expect(readProjectConfig(projectRoot)).resolves.toMatchObject({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        projectKey: 'org/repo',
        localOnly: true,
        automation: {
          autoInit: true,
          autoSync: true
        },
        knowledgeBranch: {
          active: 'main',
          branches: [
            {
              name: 'main',
              policy: 'balanced'
            }
          ]
        },
        knowledge: {
          autoCaptureTypes: expect.arrayContaining(['decision', 'design_principle', 'macro_experience']),
          includeVolatileInContext: false
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
      await expect(stat(first.paths.stateDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.indexDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.crdtDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.crdtSyncDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.exportsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.visualizationsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.queueDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.secretsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(readFile(join(first.paths.crdtSyncDir, 'peers.json'), 'utf8')).resolves.toContain(
        '"schemaVersion": 2'
      );
      await expect(readFile(join(first.paths.crdtSyncDir, 'heads.json'), 'utf8')).resolves.toContain('"heads": []');
      await expect(stat(join(first.storeRoot, 'sync', 'cursors.json'))).rejects.toMatchObject({
        code: 'ENOENT'
      });

      const gitignore = await readFile(join(first.storeRoot, '.gitignore'), 'utf8');
      expect(gitignore).toContain('state/');
      expect(gitignore).toContain('crdt/sync/');
      expect(gitignore).toContain('exports/');
      expect(gitignore).toContain('index/');
      expect(gitignore).toContain('visualizations/');
      expect(gitignore).toContain('secrets/');
      expect(gitignore).toContain('knowledge/raw/');
      expect(gitignore).toContain('knowledge/ratings/');
      expect(gitignore).toContain('knowledge/usage/');

      await writeFile(join(first.storeRoot, '.gitignore'), 'index/\ncustom-local/\n', 'utf8');
      await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const migratedGitignore = await readFile(join(first.storeRoot, '.gitignore'), 'utf8');
      expect(migratedGitignore).toContain('custom-local/');
      expect(migratedGitignore).toContain('visualizations/');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('initializes the v2 project CRDT document from project config', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot, {
        projectKey: 'org/repo',
        displayName: 'Repo'
      });
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'missing_crdt',
        currentHeads: [],
        sourceHeads: []
      });
      const initialized = await initializeProjectCrdtStore(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });

      expect(initialized.path).toBe(join(store.storeRoot, 'crdt', 'project.automerge'));
      await expect(stat(initialized.path)).resolves.toMatchObject({ isFile: expect.any(Function) });
      expect(initialized.heads.length).toBeGreaterThan(0);
      expect(initialized.doc).toMatchObject({
        schemaVersion: 2,
        branch: 'main',
        project: {
          id: 'org/repo',
          key: 'org/repo',
          name: 'Repo',
          branch: 'main'
        },
        knowledge: {},
        relations: {},
        qualitySignals: {}
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('imports v1 JSONL project knowledge into the v2 CRDT document', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot, {
        projectKey: 'org/repo',
        displayName: 'Repo'
      });
      const durable = await captureProjectKnowledge(projectRoot, {
        id: 'ki_crdt_import',
        type: 'decision',
        layer: 'canonical',
        title: 'Import through local-store',
        summary: 'The local store can materialize JSONL history into Automerge.',
        createdAt: '2026-06-15T00:00:00.000Z'
      });
      const obsolete = await captureProjectKnowledge(projectRoot, {
        id: 'ki_crdt_obsolete',
        type: 'note',
        title: 'Obsolete JSONL note',
        summary: 'This note should become a tombstone.',
        createdAt: '2026-06-15T00:01:00.000Z'
      });
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });

      await createProjectKnowledgeEdge(projectRoot, {
        kind: 'supersedes',
        fromId: durable.item.id,
        toId: obsolete.item.id,
        reason: 'CRDT import keeps semantic edges.'
      });
      await rateProjectKnowledge(
        projectRoot,
        core,
        {
          id: durable.item.id,
          rating: 1,
          confidenceDelta: 0.1
        },
        {
          reason: 'Confirmed before import.'
        }
      );
      await recordKnowledgeUsage(
        projectRoot,
        core,
        {
          knowledgeId: durable.item.id,
          kind: 'context_pack.hit',
          adoptionDelta: 0.1
        },
        {
          reason: 'Used before import.'
        }
      );
      await deleteProjectKnowledge(
        projectRoot,
        core,
        {
          id: obsolete.item.id
        },
        {
          reason: 'Remove before import.'
        }
      );

      const imported = await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        overwrite: true
      });
      const second = await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });

      expect(imported.path).toBe(join(store.storeRoot, 'crdt', 'project.automerge'));
      await expect(stat(imported.path)).resolves.toMatchObject({ isFile: expect.any(Function) });
      expect(imported).toMatchObject({
        importedKnowledge: 6,
        importedRelations: 1,
        importedQualitySignals: 6
      });
      expect(imported.importedAuditEvents).toBeGreaterThanOrEqual(6);
      expect(imported.doc.knowledge[durable.item.id]).toMatchObject({
        title: 'Import through local-store',
        branch: 'main',
        sourceProjectId: 'org/repo'
      });
      expect(imported.doc.knowledge[obsolete.item.id]).toMatchObject({
        status: 'tombstone'
      });
      expect(Object.values(imported.doc.relations)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'supersedes',
            from: durable.item.id,
            to: obsolete.item.id
          })
        ])
      );
      const qualitySignalKinds = Object.values(imported.doc.qualitySignals).map((signal) => signal.kind).sort();
      expect(qualitySignalKinds).toEqual(['confirm', 'confirm', 'rate', 'rate', 'use', 'use']);
      expect(qualitySignalKinds.filter((kind) => kind === 'use')).toHaveLength(2);
      expect(second).toMatchObject({
        importedKnowledge: 0,
        importedRelations: 0,
        importedQualitySignals: 0,
        importedAuditEvents: 0,
        skipped: 0
      });
      expect(second.doc.knowledge[durable.item.id]?.title).toBe('Import through local-store');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rebuilds local projections from the v2 CRDT document', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const first = await captureProjectKnowledge(projectRoot, {
        id: 'ki_projection_source',
        type: 'decision',
        layer: 'canonical',
        title: 'Rebuild projections from CRDT',
        summary: 'Deleting local projections should not lose knowledge.',
        tags: ['projection']
      });
      const second = await captureProjectKnowledge(projectRoot, {
        id: 'ki_projection_target',
        type: 'decision',
        layer: 'canonical',
        title: 'Keep CRDT as source',
        summary: 'CRDT data should materialize graph semantic edges.'
      });

      await createProjectKnowledgeEdge(projectRoot, {
        kind: 'supersedes',
        fromId: first.item.id,
        toId: second.item.id,
        reason: 'Projection rebuild should include CRDT relations.'
      });
      const imported = await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        overwrite: true
      });

      await rm(join(projectRoot, '.dev-mesh', 'index'), { recursive: true, force: true });

      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'missing',
        currentHeads: imported.heads,
        sourceHeads: []
      });

      const rebuilt = await rebuildProjectProjectionsFromCrdt(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      const readyStatus = await readProjectProjectionStatus(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      const manifest = JSON.parse(await readFile(rebuilt.indexPath, 'utf8')) as {
        documentCount: number;
        documents: Array<{ id: string; text: string; tags: string[] }>;
      };
      const graph = await readProjectGraph(projectRoot);
      const hits = await searchProjectIndex(projectRoot, {
        query: 'local projections',
        limit: 5
      });

      expect(rebuilt.crdtPath).toBe(imported.path);
      expect(rebuilt.metadataPath).toBe(join(projectRoot, '.dev-mesh', 'index', 'projection-meta.json'));
      expect(rebuilt.sourceHeads).toEqual(imported.heads);
      expect(readyStatus).toMatchObject({
        state: 'ready',
        crdtPath: imported.path,
        metadataPath: rebuilt.metadataPath,
        currentHeads: imported.heads,
        sourceHeads: imported.heads,
        documentCount: 2
      });
      expect(rebuilt.documentCount).toBe(2);
      expect(manifest.documentCount).toBe(2);
      expect(manifest.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: first.item.id,
            tags: ['projection']
          })
        ])
      );
      expect(graph?.sourceItemCount).toBe(2);
      expect(graph?.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'supersedes',
            from: `knowledge:${first.item.id}`,
            to: `knowledge:${second.item.id}`
          })
        ])
      );
      expect(hits[0]).toMatchObject({
        id: first.item.id,
        score: expect.any(Number)
      });

      await captureProjectKnowledge(projectRoot, {
        id: 'ki_projection_dirty',
        type: 'decision',
        layer: 'canonical',
        title: 'Dirty projection marker',
        summary: 'A later CRDT write should make projection metadata stale.',
        tags: ['projection']
      });
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'dirty',
        sourceHeads: rebuilt.sourceHeads
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('reports projection backend health for stale schema and damaged files', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      await captureProjectKnowledge(projectRoot, {
        id: 'ki_projection_health',
        type: 'decision',
        layer: 'canonical',
        title: 'Projection health is diagnostic',
        summary: 'Projection backends report schema and file health before rebuild.',
        tags: ['projection', 'health']
      });
      const imported = await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      const rebuilt = await rebuildProjectProjectionsFromCrdt(projectRoot);
      const metadata = JSON.parse(await readFile(rebuilt.metadataPath, 'utf8')) as Record<string, unknown>;

      expect(await readProjectProjectionStatus(projectRoot)).toMatchObject({
        state: 'ready',
        backend: 'local-sqlite-json',
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        expectedSchemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        projectionFiles: expect.arrayContaining([
          expect.objectContaining({ role: 'manifest', state: 'ready' }),
          expect.objectContaining({ role: 'knowledge', state: 'ready' }),
          expect.objectContaining({ role: 'search', state: 'ready' }),
          expect.objectContaining({ role: 'graph', state: 'ready' })
        ])
      });

      await writeFile(
        rebuilt.metadataPath,
        `${JSON.stringify(
          {
            ...metadata,
            schemaVersion: PROJECT_STORE_SCHEMA_VERSION - 1
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'schema_mismatch',
        sourceHeads: imported.heads,
        projectionFiles: expect.arrayContaining([
          expect.objectContaining({ role: 'metadata', state: 'schema_mismatch' })
        ])
      });

      await rebuildProjectProjectionsFromCrdt(projectRoot);
      await writeFile(rebuilt.graphPath, '{', 'utf8');
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'corrupt',
        projectionFiles: expect.arrayContaining([expect.objectContaining({ role: 'graph', state: 'corrupt' })])
      });

      await rebuildProjectProjectionsFromCrdt(projectRoot);
      await rm(rebuilt.searchPath, { force: true });
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'missing',
        projectionFiles: expect.arrayContaining([expect.objectContaining({ role: 'search', state: 'missing' })])
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('materializes dynamic quality scores from CRDT quality signals', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });
      const captured = await captureProjectKnowledge(projectRoot, {
        id: 'ki_projection_quality',
        type: 'decision',
        layer: 'canonical',
        title: 'Project quality from CRDT signals',
        summary: 'Dynamic quality should be projected from durable CRDT quality signals.',
        confidence: 0.7
      });

      await rateProjectKnowledge(projectRoot, core, {
        id: captured.item.id,
        rating: 1,
        confidenceDelta: 0.2
      });
      await recordKnowledgeUsage(projectRoot, core, {
        knowledgeId: captured.item.id,
        kind: 'context_pack.hit',
        adoptionDelta: 0.3
      });
      const imported = await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        overwrite: true
      });
      const rebuilt = await rebuildProjectProjectionsFromCrdt(projectRoot);
      const status = await readProjectProjectionStatus(projectRoot);
      const quality = await readProjectQualityProjection(rebuilt.qualityPath);
      const projected = quality?.qualities[captured.item.id];

      expect(rebuilt).toMatchObject({
        qualityPath: join(projectRoot, '.dev-mesh', 'index', 'quality.json'),
        qualityCount: 1,
        qualityAlgorithmVersion: QUALITY_PROJECTION_ALGORITHM_VERSION
      });
      expect(status).toMatchObject({
        state: 'ready',
        qualityCount: 1,
        qualityAlgorithmVersion: QUALITY_PROJECTION_ALGORITHM_VERSION,
        qualityPath: rebuilt.qualityPath,
        projectionFiles: expect.arrayContaining([expect.objectContaining({ role: 'quality', state: 'ready' })])
      });
      expect(quality).toMatchObject({
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        algorithmVersion: QUALITY_PROJECTION_ALGORITHM_VERSION,
        sourceHeads: imported.heads,
        qualityCount: 1
      });
      expect(projected).toMatchObject({
        knowledgeId: captured.item.id,
        reliability: expect.any(Number),
        usefulness: expect.any(Number),
        freshness: expect.any(Number),
        priority: expect.any(Number),
        score: expect.any(Number)
      });
      expect(projected?.signalCount).toBeGreaterThanOrEqual(3);
      expect(projected?.usefulness).toBeGreaterThan(0.5);
      expect(projected?.score).toBeGreaterThan(0.5);
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

  it('scopes list and search to the active and base knowledge branches', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        title: 'Main branch decision',
        summary: 'Main knowledge should stay visible on the default branch.'
      });
      const shared = await captureProjectKnowledge(
        projectRoot,
        {
          type: 'decision',
          title: 'Shared branch decision',
          summary: 'Shared knowledge should be visible through base branch.'
        },
        {
          branch: 'shared'
        }
      );
      const frontend = await captureProjectKnowledge(
        projectRoot,
        {
          type: 'decision',
          title: 'Frontend branch decision',
          summary: 'Frontend knowledge should stay in the frontend branch.'
        },
        {
          branch: 'frontend'
        }
      );

      await expect(new JsonlKnowledgeRepository(projectRoot).search({ query: 'branch decision', limit: 10 })).resolves
        .toEqual([
          expect.objectContaining({
            title: 'Main branch decision'
          })
        ]);

      const config = await readProjectConfig(projectRoot);
      config.knowledgeBranch.active = 'frontend';
      config.knowledgeBranch.base = 'shared';
      config.knowledgeBranch.branches = [
        ...config.knowledgeBranch.branches,
        {
          name: 'frontend',
          policy: 'balanced'
        },
        {
          name: 'shared',
          policy: 'durable_only'
        }
      ];
      await writeProjectConfig(projectRoot, config);

      const repository = new JsonlKnowledgeRepository(projectRoot);
      const visible = await repository.search({ query: 'branch decision', limit: 10 });

      expect(visible.map((item) => item.id)).toEqual(expect.arrayContaining([frontend.item.id, shared.item.id]));
      expect(visible.map((item) => item.title)).not.toContain('Main branch decision');
      await expect(repository.get(frontend.item.id)).resolves.toMatchObject({
        source: {
          metadata: {
            branch: 'frontend'
          }
        }
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('updates and tombstones project knowledge with events', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });
      const captured = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        title: 'Use local CRUD tools',
        summary: 'Codex should edit knowledge through MCP tools.',
        layer: 'canonical'
      });
      const updated = await updateProjectKnowledge(
        projectRoot,
        core,
        {
          id: captured.item.id,
          summary: 'Codex should edit knowledge through MCP CRUD tools.',
          tags: ['mcp', 'crud']
        },
        {
          reason: 'Clarify tool scope.'
        }
      );

      expect(updated.item).toMatchObject({
        id: captured.item.id,
        summary: 'Codex should edit knowledge through MCP CRUD tools.',
        tags: ['mcp', 'crud']
      });
      expect(updated.event).toMatchObject({
        kind: 'knowledge.updated',
        payload: {
          knowledgeId: captured.item.id,
          changedFields: ['summary', 'tags'],
          reason: 'Clarify tool scope.'
        }
      });

      const deleted = await deleteProjectKnowledge(
        projectRoot,
        core,
        {
          id: captured.item.id
        },
        {
          reason: 'Remove obsolete knowledge.'
        }
      );

      expect(deleted.item.status).toBe('tombstone');
      await expect(repository.search({ query: 'CRUD tools' })).resolves.toHaveLength(0);
      await expect(repository.search({ query: 'CRUD tools', includeSuperseded: true })).resolves.toHaveLength(1);

      const eventsJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'events', `${deleted.event.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );

      expect(eventsJsonl).toContain('"kind":"knowledge.updated"');
      expect(eventsJsonl).toContain('"kind":"knowledge.deleted"');
      expect(eventsJsonl).toContain('"tombstone":true');
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
          '[knowledge_branch]',
          'active = "frontend"',
          'base = "shared"',
          'branches = ["frontend", "shared"]',
          '',
          '[knowledge_branch.policies.frontend]',
          'preset = "frontend_design"',
          '',
          '[knowledge_branch.policies.shared]',
          'preset = "durable_only"',
          '',
          '[knowledge]',
          'auto_capture_types = ["decision", "project_fact"]',
          'include_volatile_in_context = true',
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
        },
        knowledge: {
          autoCaptureTypes: ['decision', 'project_fact'],
          includeVolatileInContext: true
        },
        knowledgeBranch: {
          active: 'frontend',
          base: 'shared',
          branches: [
            {
              name: 'frontend',
              policy: 'frontend_design'
            },
            {
              name: 'shared',
              policy: 'durable_only'
            }
          ]
        }
      });
      expect(migratedToml).toContain(`schema_version = ${PROJECT_STORE_SCHEMA_VERSION}`);
      expect(migratedToml).toContain('auto_reference = false');
      expect(migratedToml).toContain('[knowledge_branch]');
      expect(migratedToml).toContain('active = "frontend"');
      expect(migratedToml).toContain('base = "shared"');
      expect(migratedToml).toContain('[knowledge_branch.policies.frontend]');
      expect(migratedToml).toContain('[knowledge]');
      expect(migratedToml).toContain('auto_capture_types = ["decision", "project_fact"]');
      expect(migratedToml).toContain('include_volatile_in_context = true');
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
      const graph = await readProjectGraph(projectRoot);
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
      await expect(stat(result.knowledgePath)).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(stat(result.searchPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
      expect(manifest.schemaVersion).toBe(PROJECT_STORE_SCHEMA_VERSION);
      expect(manifest.documentCount).toBe(1);
      expect(manifest.documents[0]).toMatchObject({
        id: item.id,
        tags: ['index']
      });
      expect(manifest.documents[0]?.text).toContain('Rebuild local index');
      expect(manifest.documents[0]?.text).toContain(item.entryKey);
      expect(graph?.schemaVersion).toBe(PROJECT_STORE_SCHEMA_VERSION);
      expect(graph?.sourceItemCount).toBe(1);
      expect(graph?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: `knowledge:${item.id}` })]));
      expect(graph?.edges.map((edge) => edge.kind)).toEqual(expect.arrayContaining(['belongs_to_para', 'tagged_with']));
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

  it('falls back to JSONL ranking when an existing SQLite index is stale', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const indexed = createKnowledgeItem({
        type: 'decision',
        layer: 'canonical',
        title: 'Indexed stale baseline',
        summary: 'This entry exists before the index is rebuilt.',
        tags: ['index']
      });

      await repository.upsert(indexed);
      await rebuildProjectIndex(projectRoot);

      const fresh = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        layer: 'canonical',
        title: 'Fresh local-first search token',
        summary: 'Search should find fresh-stale-token even before projection maintenance rebuilds SQLite.',
        tags: ['fresh']
      });
      const hits = await repository.search({
        query: 'fresh-stale-token',
        limit: 5
      });

      expect(hits.map((item) => item.id)).toContain(fresh.item.id);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('stores local semantic knowledge edges and includes them in graph rebuilds', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const oldDecision = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        layer: 'canonical',
        title: 'Use background polling',
        summary: 'The daemon scans Git and filesystem changes on an interval.'
      });
      const newDecision = await captureProjectKnowledge(projectRoot, {
        type: 'decision',
        layer: 'canonical',
        title: 'Use assistant-led capture',
        summary: 'Assistants decide when durable knowledge should be captured.'
      });
      const linked = await createProjectKnowledgeEdge(
        projectRoot,
        {
          kind: 'supersedes',
          fromId: newDecision.item.id,
          toId: oldDecision.item.id,
          reason: 'Assistant-led capture replaced background polling.'
        },
        {
          projectKey: 'org/repo'
        }
      );
      const repository = new JsonlKnowledgeRepository(projectRoot);
      await rebuildProjectGraph(projectRoot);
      const graphJson = await readProjectGraph(projectRoot);

      await expect(repository.get(oldDecision.item.id)).resolves.toMatchObject({
        status: 'superseded'
      });
      await expect(listProjectKnowledgeEdges(projectRoot)).resolves.toMatchObject([
        {
          id: linked.edge.id,
          kind: 'supersedes',
          fromId: newDecision.item.id,
          toId: oldDecision.item.id,
          projectKey: 'org/repo'
        }
      ]);
      expect(linked.event).toMatchObject({
        kind: 'knowledge.edge.created',
        projectKey: 'org/repo',
        payload: {
          edgeId: linked.edge.id,
          kind: 'supersedes',
          fromId: newDecision.item.id,
          toId: oldDecision.item.id
        }
      });
      expect(graphJson?.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'supersedes',
            from: `knowledge:${newDecision.item.id}`,
            to: `knowledge:${oldDecision.item.id}`
          })
        ])
      );
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

  it('dual-writes local knowledge mutations to the v2 CRDT document', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });
      const captured = await captureProjectKnowledge(projectRoot, {
        id: 'kn_crdt_write_path',
        type: 'decision',
        layer: 'canonical',
        title: 'Dual write knowledge to CRDT',
        summary: 'The transitional local write path should keep the CRDT source in sync.',
        createdBy: {
          displayName: 'Xiaoyun',
          clientId: 'feedface'
        }
      });

      const updated = await updateProjectKnowledge(projectRoot, core, {
        id: captured.item.id,
        summary: 'The JSONL path and CRDT source should converge on the latest item state.',
        tags: ['crdt', 'write-path']
      });
      const rated = await rateProjectKnowledge(projectRoot, core, {
        id: captured.item.id,
        rating: 1,
        confidenceDelta: 0.1
      });
      const used = await recordKnowledgeUsage(projectRoot, core, {
        knowledgeId: captured.item.id,
        kind: 'context_pack.hit',
        adoptionDelta: 0.02
      });
      const deleted = await deleteProjectKnowledge(projectRoot, core, {
        id: captured.item.id
      });
      const crdt = await initializeProjectCrdtStore(projectRoot);
      const items = await loadProjectKnowledgeItemsFromCrdt(projectRoot);

      expect(updated.item.tags).toEqual(['crdt', 'write-path']);
      expect(rated.item.quality.rating).toBe(1);
      expect(used.item.quality.adoptionScore).toBeCloseTo(0.02);
      expect(deleted.item.status).toBe('tombstone');
      expect(crdt.doc.knowledge[captured.item.id]).toMatchObject({
        id: captured.item.id,
        status: 'tombstone',
        summary: 'The JSONL path and CRDT source should converge on the latest item state.',
        tags: ['crdt', 'write-path'],
        quality: {
          rating: 1
        }
      });
      expect(crdt.doc.knowledge[captured.item.id]?.quality.adoptionScore).toBeCloseTo(0.02);
      expect(Object.values(crdt.doc.qualitySignals).map((signal) => signal.kind).sort()).toEqual([
        'confirm',
        'rate',
        'use'
      ]);
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: captured.item.id,
            status: 'tombstone'
          })
        ])
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('exports on-demand knowledge JSONL from the v2 CRDT document', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const core = createDevMeshCore({
        projectRoot,
        repository
      });
      const kept = await captureProjectKnowledge(projectRoot, {
        id: 'kn_export_kept',
        type: 'decision',
        layer: 'canonical',
        title: 'Export kept item',
        summary: 'This knowledge should remain active.',
        createdBy: {
          displayName: 'Xiaoyun',
          clientId: 'feedface'
        }
      });
      const removed = await captureProjectKnowledge(projectRoot, {
        id: 'kn_export_removed',
        type: 'pitfall_record',
        layer: 'extract',
        title: 'Export removed item',
        summary: 'This knowledge should be exported as a tombstone.',
        createdBy: {
          displayName: 'Xiaoyun',
          clientId: 'feedface'
        }
      });

      await updateProjectKnowledge(projectRoot, core, {
        id: kept.item.id,
        summary: 'The exported JSONL should contain the latest CRDT state.',
        tags: ['crdt', 'export']
      });
      await deleteProjectKnowledge(projectRoot, core, {
        id: removed.item.id
      });

      const exported = await exportProjectCrdtKnowledgeJsonl(projectRoot);
      const records = parseJsonlRecords(await readFile(exported.path, 'utf8'));

      expect(exported).toMatchObject({
        path: join(store.paths.exportsDir, 'knowledge.jsonl'),
        crdtPath: join(store.paths.crdtDir, 'project.automerge'),
        exportedKnowledge: 2,
        skippedTombstones: 0
      });
      expect(exported.heads.length).toBeGreaterThan(0);
      expect(records.map((record) => record.id).sort()).toEqual(['kn_export_kept', 'kn_export_removed']);
      expect(records.find((record) => record.id === 'kn_export_kept')).toMatchObject({
        status: 'active',
        summary: 'The exported JSONL should contain the latest CRDT state.',
        tags: ['crdt', 'export']
      });
      expect(records.find((record) => record.id === 'kn_export_removed')).toMatchObject({
        status: 'tombstone',
        summary: 'This knowledge should be exported as a tombstone.'
      });

      const activeExportPath = join(store.paths.exportsDir, 'knowledge-active.jsonl');
      const activeExported = await exportProjectCrdtKnowledgeJsonl(projectRoot, {
        path: activeExportPath,
        includeTombstones: false
      });
      const activeRecords = parseJsonlRecords(await readFile(activeExported.path, 'utf8'));

      expect(activeExported).toMatchObject({
        path: activeExportPath,
        exportedKnowledge: 1,
        skippedTombstones: 1
      });
      expect(activeRecords).toEqual([
        expect.objectContaining({
          id: 'kn_export_kept',
          status: 'active'
        })
      ]);
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

function parseJsonlRecords(content: string): Array<Record<string, unknown>> {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
