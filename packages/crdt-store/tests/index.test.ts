import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createKnowledgeItem } from '@devmesh/core';
import {
  AutomergeFileCrdtBackend,
  createProjectDoc,
  createQualitySignal,
  createServerGlobalDoc,
  getProjectAutomergePath,
  importV1JsonlToProjectDoc,
  InMemoryCrdtBackend,
  knowledgeItemToNode,
  touchProjectDoc
} from '../src/index.js';

describe('@devmesh/crdt-store', () => {
  it('creates an empty project document bound to a group', () => {
    const doc = createProjectDoc({
      projectId: 'project_alpha',
      projectKey: 'alpha',
      name: 'Alpha',
      branch: 'frontend-platform',
      now: () => new Date('2026-06-15T00:00:00.000Z')
    });

    expect(doc).toMatchObject({
      schemaVersion: 2,
      branch: 'frontend-platform',
      project: {
        id: 'project_alpha',
        key: 'alpha',
        branch: 'frontend-platform',
        },
      knowledge: {},
      entities: {},
      relations: {},
      claims: {},
      qualitySignals: {},
      conflicts: {}
    });
  });

  it('maps existing knowledge items into group-scoped CRDT nodes', () => {
    const item = createKnowledgeItem({
      id: 'ki_design_group',
      type: 'decision',
      layer: 'canonical',
      title: 'Use group boundaries for shared knowledge',
      summary: 'Projects only share knowledge when they join the same group.',
      content: 'A project can use its own group for isolation.',
      tags: ['branch'],
      para: { category: 'projects', key: 'alpha' },
      createdAt: '2026-06-15T00:00:00.000Z'
    });

    const node = knowledgeItemToNode(item, {
      branch: 'frontend-platform',
      sourceProjectId: 'project_alpha',
    });

    expect(node).toMatchObject({
      id: 'ki_design_group',
      branch: 'frontend-platform',
      sourceProjectId: 'project_alpha',
      content: 'A project can use its own group for isolation.'
    });
  });

  it('applies deterministic in-memory CRDT changes and ignores duplicate change ids', async () => {
    const backend = new InMemoryCrdtBackend(
      createProjectDoc({
        projectId: 'project_alpha',
        projectKey: 'alpha',
        name: 'Alpha',
        branch: 'frontend-platform'
      })
    );

    const result = await backend.change({
      actorId: 'member_alice',
      summary: 'Capture project knowledge',
      now: () => new Date('2026-06-15T00:00:00.000Z'),
      mutate(doc) {
        doc.knowledge['ki_one'] = {
          id: 'ki_one',
          branch: 'frontend-platform',
          sourceProjectId: 'project_alpha',
          layer: 'extract',
          type: 'note',
          title: 'One',
          summary: 'First item',
          tags: [],
          para: { category: 'projects', key: 'alpha' },
          status: 'active',
          source: { kind: 'manual' },
          createdBy: { displayName: 'Alice', memberId: 'member_alice' },
          createdAt: '2026-06-15T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
          visibility: 'project'
        };
        return touchProjectDoc(doc, '2026-06-15T00:00:00.000Z');
      }
    });

    expect(result.doc.knowledge['ki_one']?.title).toBe('One');
    const headsAfterFirstApply = await backend.getHeads();

    await backend.apply(result.change);

    expect(await backend.getHeads()).toEqual(headsAfterFirstApply);
    expect(Object.keys((await backend.load()).knowledge)).toEqual(['ki_one']);
  });

  it('creates scoped quality signals for projection scoring', () => {
    const signal = createQualitySignal({
      knowledgeId: 'ki_one',
      kind: 'confirm',
      actorId: 'member_alice',
      reason: 'Reviewed in admin',
      group: {
        branch: 'frontend-platform',
        },
      now: () => new Date('2026-06-15T00:00:00.000Z')
    });

    expect(signal).toMatchObject({
      knowledgeId: 'ki_one',
      kind: 'confirm',
      actorId: 'member_alice',
      reason: 'Reviewed in admin',
      branch: 'frontend-platform',
    });
  });

  it('creates server global documents for Hub-side state', () => {
    const doc = createServerGlobalDoc({
      serverId: 'srv_local',
      name: 'Local Hub',
      now: () => new Date('2026-06-15T00:00:00.000Z')
    });

    expect(doc).toMatchObject({
      schemaVersion: 2,
      server: {
        id: 'srv_local',
        name: 'Local Hub'
      },
      groups: {},
      projects: {},
      members: {},
      clients: {},
      knowledge: {},
      entities: {},
      relations: {},
      claims: {},
      conflicts: {},
      qualitySignals: {}
    });
  });

  it('persists project documents through an Automerge-backed file store', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'devmesh-crdt-store-'));
    const storeRoot = join(projectRoot, '.dev-mesh');
    const automergePath = getProjectAutomergePath(storeRoot);
    const initialDoc = createProjectDoc({
      projectId: 'project_alpha',
      projectKey: 'alpha',
      name: 'Alpha',
      branch: 'frontend-platform',
      now: () => new Date('2026-06-15T00:00:00.000Z')
    });

    try {
      const backend = new AutomergeFileCrdtBackend({
        path: automergePath,
        initialDoc,
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      const first = await backend.change({
        actorId: 'member_alice',
        summary: 'Capture durable CRDT item',
        now: () => new Date('2026-06-15T00:00:01.000Z'),
        mutate(doc) {
          doc.knowledge['ki_crdt_file'] = {
            id: 'ki_crdt_file',
            branch: 'frontend-platform',
            sourceProjectId: 'project_alpha',
            layer: 'canonical',
            entryKey: 'projects/alpha/crdt-file',
            type: 'decision',
            title: 'Persist CRDT files',
            summary: 'Project documents are saved as Automerge binary files.',
            tags: ['crdt'],
            para: { category: 'projects', key: 'alpha' },
            status: 'active',
            source: { kind: 'manual' },
            createdBy: { displayName: 'Alice', memberId: 'member_alice' },
            createdAt: '2026-06-15T00:00:01.000Z',
            updatedAt: '2026-06-15T00:00:01.000Z',
            visibility: 'project',
            quality: {
              confidence: 0.8,
              weight: 1,
              rating: 0.5,
              adoptionScore: 0,
              sourceTrust: 0.5,
              evidence: 0.3,
              freshness: 1,
              qualityScore: 0.59
            }
          };
          return touchProjectDoc(doc, '2026-06-15T00:00:01.000Z');
        }
      });
      const reloaded = new AutomergeFileCrdtBackend({
        path: automergePath,
        initialDoc,
        actorId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      });

      expect(first.change.engine).toBe('automerge');
      expect(first.change.binaryChanges?.length).toBe(1);
      expect((await readFile(automergePath)).byteLength).toBeGreaterThan(0);
      await expect(reloaded.load()).resolves.toMatchObject({
        knowledge: {
          ki_crdt_file: {
            title: 'Persist CRDT files'
          }
        }
      });

      const peer = new AutomergeFileCrdtBackend({
        path: join(storeRoot, 'crdt', 'peer.automerge'),
        initialDoc,
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      const allChanges = await backend.getAllChanges();
      const applied = await peer.applyAutomergeChanges(allChanges);

      expect(applied.doc.knowledge['ki_crdt_file']?.summary).toBe(
        'Project documents are saved as Automerge binary files.'
      );
      expect(applied.headsAfter).toEqual(first.change.headsAfter);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('merges concurrent Automerge field changes without losing independent edits', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'devmesh-crdt-merge-'));
    const initialDoc = createProjectDoc({
      projectId: 'project_alpha',
      projectKey: 'alpha',
      name: 'Alpha',
      branch: 'frontend-platform',
      now: () => new Date('2026-06-15T00:00:00.000Z')
    });

    try {
      const seed = new AutomergeFileCrdtBackend({
        path: join(projectRoot, 'seed.automerge'),
        initialDoc,
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      await seed.change({
        actorId: 'member_alice',
        summary: 'Seed merge item',
        now: () => new Date('2026-06-15T00:00:01.000Z'),
        mutate(doc) {
          doc.knowledge['ki_merge'] = knowledgeItemToNode(
            createKnowledgeItem({
              id: 'ki_merge',
              layer: 'canonical',
              type: 'decision',
              title: 'Original title',
              summary: 'Original summary',
              para: { category: 'projects', key: 'alpha' },
              createdAt: '2026-06-15T00:00:01.000Z'
            }),
            {
              branch: 'frontend-platform',
              sourceProjectId: 'project_alpha'
            }
          );
          return doc;
        }
      });

      const baseChanges = await seed.getAllChanges();
      const left = new AutomergeFileCrdtBackend({
        path: join(projectRoot, 'left.automerge'),
        initialDoc,
        actorId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      });
      const right = new AutomergeFileCrdtBackend({
        path: join(projectRoot, 'right.automerge'),
        initialDoc,
        actorId: 'cccccccccccccccccccccccccccccccc'
      });
      await left.applyAutomergeChanges(baseChanges);
      await right.applyAutomergeChanges(baseChanges);
      const leftChange = await left.change({
        actorId: 'member_left',
        summary: 'Edit title',
        now: () => new Date('2026-06-15T00:00:02.000Z'),
        mutate(doc) {
          doc.knowledge['ki_merge']!.title = 'Merged title';
          doc.knowledge['ki_merge']!.updatedAt = '2026-06-15T00:00:02.000Z';
          return doc;
        }
      });
      const rightChange = await right.change({
        actorId: 'member_right',
        summary: 'Edit tags',
        now: () => new Date('2026-06-15T00:00:03.000Z'),
        mutate(doc) {
          doc.knowledge['ki_merge']!.tags.push('merged');
          doc.knowledge['ki_merge']!.updatedAt = '2026-06-15T00:00:03.000Z';
          return doc;
        }
      });
      await left.applyAutomergeChanges(rightChange.change.binaryChanges ?? []);
      await right.applyAutomergeChanges(leftChange.change.binaryChanges ?? []);

      const leftDoc = await left.load();
      const rightDoc = await right.load();

      expect(leftDoc.knowledge['ki_merge']).toMatchObject({
        title: 'Merged title',
        tags: ['merged']
      });
      expect(rightDoc.knowledge['ki_merge']).toMatchObject(leftDoc.knowledge['ki_merge']);
      expect((await left.getHeads()).sort()).toEqual((await right.getHeads()).sort());
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('merges independently initialized project documents without losing top-level maps', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'devmesh-crdt-independent-init-'));
    const initialDoc = createProjectDoc({
      projectId: 'project_alpha',
      projectKey: 'alpha',
      name: 'Alpha',
      branch: 'frontend-platform',
      now: () => new Date('2026-06-15T00:00:00.000Z')
    });

    try {
      const left = new AutomergeFileCrdtBackend({
        path: join(projectRoot, 'left.automerge'),
        initialDoc,
        actorId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      });
      const right = new AutomergeFileCrdtBackend({
        path: join(projectRoot, 'right.automerge'),
        initialDoc,
        actorId: 'cccccccccccccccccccccccccccccccc'
      });

      await left.change({
        actorId: 'member_left',
        summary: 'Create left knowledge',
        now: () => new Date('2026-06-15T00:00:01.000Z'),
        mutate(doc) {
          doc.knowledge['ki_left'] = knowledgeItemToNode(
            createKnowledgeItem({
              id: 'ki_left',
              layer: 'canonical',
              type: 'decision',
              title: 'Left knowledge',
              summary: 'Created on the left peer.',
              para: { category: 'projects', key: 'alpha' },
              createdAt: '2026-06-15T00:00:01.000Z'
            }),
            {
              branch: 'frontend-platform',
              sourceProjectId: 'project_alpha'
            }
          );
          return doc;
        }
      });
      await right.change({
        actorId: 'member_right',
        summary: 'Create right knowledge',
        now: () => new Date('2026-06-15T00:00:02.000Z'),
        mutate(doc) {
          doc.knowledge['ki_right'] = knowledgeItemToNode(
            createKnowledgeItem({
              id: 'ki_right',
              layer: 'canonical',
              type: 'decision',
              title: 'Right knowledge',
              summary: 'Created on the right peer.',
              para: { category: 'projects', key: 'alpha' },
              createdAt: '2026-06-15T00:00:02.000Z'
            }),
            {
              branch: 'frontend-platform',
              sourceProjectId: 'project_alpha'
            }
          );
          return doc;
        }
      });

      await left.applyAutomergeChanges(await right.getAllChanges());
      await right.applyAutomergeChanges(await left.getAllChanges());

      expect(Object.keys((await left.load()).knowledge).sort()).toEqual(['ki_left', 'ki_right']);
      expect(Object.keys((await right.load()).knowledge).sort()).toEqual(['ki_left', 'ki_right']);
      expect((await left.getHeads()).sort()).toEqual((await right.getHeads()).sort());
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('applies Automerge changes in dependency order when transport delivers them out of order', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'devmesh-crdt-out-of-order-'));
    const initialDoc = createProjectDoc({
      projectId: 'project_alpha',
      projectKey: 'alpha',
      name: 'Alpha',
      branch: 'frontend-platform',
      now: () => new Date('2026-06-15T00:00:00.000Z')
    });

    try {
      const source = new AutomergeFileCrdtBackend({
        path: join(projectRoot, 'source.automerge'),
        initialDoc,
        actorId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      const first = await source.change({
        actorId: 'member_alice',
        summary: 'Create out-of-order item',
        now: () => new Date('2026-06-15T00:00:01.000Z'),
        mutate(doc) {
          doc.knowledge['ki_out_of_order'] = knowledgeItemToNode(
            createKnowledgeItem({
              id: 'ki_out_of_order',
              layer: 'canonical',
              type: 'decision',
              title: 'Original sync title',
              summary: 'Created before the update change.',
              para: { category: 'projects', key: 'alpha' },
              createdAt: '2026-06-15T00:00:01.000Z'
            }),
            {
              branch: 'frontend-platform',
              sourceProjectId: 'project_alpha'
            }
          );
          return doc;
        }
      });
      const second = await source.change({
        actorId: 'member_alice',
        summary: 'Update out-of-order item',
        now: () => new Date('2026-06-15T00:00:02.000Z'),
        mutate(doc) {
          doc.knowledge['ki_out_of_order']!.title = 'Updated sync title';
          doc.knowledge['ki_out_of_order']!.tags.push('sync');
          doc.knowledge['ki_out_of_order']!.updatedAt = '2026-06-15T00:00:02.000Z';
          return doc;
        }
      });
      const target = new AutomergeFileCrdtBackend({
        path: join(projectRoot, 'target.automerge'),
        initialDoc,
        actorId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      });
      const outOfOrderChanges = (await source.getAllChanges()).reverse();

      expect(first.change.binaryChanges?.length).toBe(1);
      expect(second.change.binaryChanges?.length).toBe(1);
      expect(outOfOrderChanges.length).toBeGreaterThan(2);

      await target.applyAutomergeChanges(outOfOrderChanges);

      await expect(target.load()).resolves.toMatchObject({
        knowledge: {
          ki_out_of_order: {
            title: 'Updated sync title',
            tags: ['sync']
          }
        }
      });
      expect((await target.getHeads()).sort()).toEqual((await source.getHeads()).sort());
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('imports v1 JSONL knowledge, edges, feedback, usage, and tombstones into a project doc', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'devmesh-crdt-import-'));
    const knowledgeDir = join(projectRoot, '.dev-mesh', 'knowledge');
    const eventsDir = join(projectRoot, '.dev-mesh', 'events');
    const active = createKnowledgeItem({
      id: 'ki_imported',
      type: 'decision',
      layer: 'canonical',
      title: 'Import v1 knowledge',
      summary: 'The migration keeps JSONL knowledge in the CRDT document.',
      tags: ['migration'],
      para: { category: 'projects', key: 'alpha' },
      createdAt: '2026-06-15T00:00:00.000Z'
    });
    const tombstoned = createKnowledgeItem({
      id: 'ki_deleted',
      type: 'note',
      layer: 'extract',
      title: 'Deleted import note',
      summary: 'This entry was deleted after capture.',
      createdAt: '2026-06-15T00:01:00.000Z'
    });

    try {
      await mkdir(join(knowledgeDir, 'canonical'), { recursive: true });
      await mkdir(join(knowledgeDir, 'extract'), { recursive: true });
      await mkdir(join(knowledgeDir, 'ratings'), { recursive: true });
      await mkdir(join(knowledgeDir, 'usage'), { recursive: true });
      await mkdir(eventsDir, { recursive: true });
      await writeFile(join(knowledgeDir, 'canonical', 'entries.jsonl'), `${JSON.stringify(active)}\n`, 'utf8');
      await writeFile(join(knowledgeDir, 'extract', 'entries.jsonl'), `${JSON.stringify(tombstoned)}\n`, 'utf8');
      await writeFile(
        join(knowledgeDir, 'edges.jsonl'),
        `${JSON.stringify({
          id: 'edge_imported',
          kind: 'supersedes',
          fromId: 'ki_imported',
          toId: 'ki_deleted',
          projectKey: 'alpha',
          createdAt: '2026-06-15T00:02:00.000Z',
          createdBy: { displayName: 'Alice', memberId: 'member_alice' }
        })}\n`,
        'utf8'
      );
      await writeFile(
        join(knowledgeDir, 'ratings', '2026-06.jsonl'),
        `${JSON.stringify({
          id: 'rate_imported',
          knowledgeId: 'ki_imported',
          projectKey: 'alpha',
          createdAt: '2026-06-15T00:03:00.000Z',
          rating: 1,
          confidenceDelta: 0.1,
          reason: 'Reviewed during migration.',
          createdBy: { displayName: 'Alice', memberId: 'member_alice' }
        })}\n`,
        'utf8'
      );
      await writeFile(
        join(knowledgeDir, 'usage', '2026-06.jsonl'),
        `${JSON.stringify({
          id: 'use_imported',
          knowledgeId: 'ki_imported',
          projectKey: 'alpha',
          kind: 'context_pack.hit',
          createdAt: '2026-06-15T00:04:00.000Z',
          adoptionDelta: 0.1,
          reason: 'Returned to an agent.'
        })}\n`,
        'utf8'
      );
      await writeFile(
        join(eventsDir, '2026-06.jsonl'),
        `${JSON.stringify({
          id: 'evt_deleted',
          kind: 'knowledge.deleted',
          projectKey: 'alpha',
          createdAt: '2026-06-15T00:05:00.000Z',
          payload: {
            knowledgeId: 'ki_deleted'
          }
        })}\n${JSON.stringify({
          id: 'evt_task',
          kind: 'task.progress.captured',
          projectKey: 'alpha',
          createdAt: '2026-06-15T00:06:00.000Z',
          payload: {
            knowledgeId: 'ki_imported',
            status: 'blocked',
            summary: '[blocked] Finish v2 import coverage.',
            branch: 'frontend-platform'
          }
        })}\n`,
        'utf8'
      );

      const imported = await importV1JsonlToProjectDoc({
        doc: createProjectDoc({
          projectId: 'project_alpha',
          projectKey: 'alpha',
          name: 'Alpha',
          branch: 'frontend-platform',
          now: () => new Date('2026-06-15T00:00:00.000Z')
        }),
        knowledgeDir,
        eventsDir,
        actorId: 'migration'
      });

      expect(imported).toMatchObject({
        importedKnowledge: 2,
        importedRelations: 1,
        importedQualitySignals: 3,
        importedAuditEvents: 2,
        skipped: 0
      });
      expect(imported.doc.knowledge['ki_imported']).toMatchObject({
        entryKey: active.entryKey,
        branch: 'frontend-platform',
        sourceProjectId: 'project_alpha',
        quality: active.quality,
        type: 'task',
        summary: '[blocked] Finish v2 import coverage.',
        source: {
          metadata: {
            taskStatus: 'blocked',
            branch: 'frontend-platform'
          }
        }
      });
      expect(imported.doc.knowledge['ki_deleted']).toMatchObject({
        status: 'tombstone',
        deletedAt: '2026-06-15T00:05:00.000Z'
      });
      expect(imported.doc.relations['edge_imported']).toMatchObject({
        kind: 'supersedes',
        from: 'ki_imported',
        to: 'ki_deleted',
        branch: 'frontend-platform'
      });
      expect(Object.values(imported.doc.qualitySignals).map((signal) => signal.kind).sort()).toEqual([
        'confirm',
        'rate',
        'use'
      ]);
      expect(imported.sourceFiles).toHaveLength(6);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
