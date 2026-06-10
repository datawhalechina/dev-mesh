import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDmx } from './run-dmx.js';

describe('dmx CLI local flow', () => {
  it('initializes a project, captures knowledge, searches it, and reports status', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-cli-'));

    try {
      const init = await runDmx(['init', '--root', projectRoot, '--name', 'Xiaoyun']);
      const capture = await runDmx([
        'capture',
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--title',
        'Run focused tests',
        '--summary',
        'Use pnpm test:unit before pushing.',
        '--type',
        'command',
        '--para',
        'resources:test-commands'
      ]);
      const captureJson = JSON.parse(capture.stdout);
      const previousCapture = await runDmx([
        'capture',
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--title',
        'Run broad tests',
        '--summary',
        'Use pnpm test for every change.',
        '--type',
        'command',
        '--para',
        'resources:test-commands'
      ]);
      const previousCaptureJson = JSON.parse(previousCapture.stdout);
      const edgeAdd = await runDmx([
        'graph',
        'edge',
        'add',
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--kind',
        'supersedes',
        '--from',
        captureJson.id,
        '--to',
        previousCaptureJson.id,
        '--reason',
        'Focused tests supersede the broad test note.'
      ]);
      const edgeList = await runDmx(['graph', 'edge', 'list', '--root', projectRoot, '--kind', 'supersedes']);
      const search = await runDmx(['search', 'focused tests', '--root', projectRoot]);
      const rate = await runDmx([
        'rate',
        captureJson.id,
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--rating',
        '1',
        '--reason',
        'Useful local command.'
      ]);
      const status = await runDmx(['status', '--root', projectRoot]);
      const index = await runDmx(['index', 'rebuild', '--root', projectRoot]);
      const graph = await runDmx([
        'graph',
        'explore',
        '--root',
        projectRoot,
        '--id',
        captureJson.id,
        '--depth',
        '1',
        '--edge-kind',
        'supersedes'
      ]);
      const graphHtmlPath = join(projectRoot, '.dev-mesh', 'visualizations', 'graph.html');
      const visualize = await runDmx([
        'visualize',
        '--root',
        projectRoot,
        '--query',
        'focused tests',
        '--depth',
        '1',
        '--no-open'
      ]);
      const knowledgeGet = await runDmx(['knowledge', 'get', captureJson.id, '--root', projectRoot]);
      const knowledgeList = await runDmx([
        'knowledge',
        'list',
        '--root',
        projectRoot,
        '--layer',
        'extract',
        '--type',
        'command',
        '--limit',
        '5'
      ]);
      const knowledgeUpdate = await runDmx([
        'knowledge',
        'update',
        captureJson.id,
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--summary',
        'Use pnpm test:unit for fast focused checks.',
        '--tag',
        'tests',
        '--tag',
        'focused',
        '--reason',
        'Clarify the local test command.'
      ]);
      const knowledgeDelete = await runDmx([
        'knowledge',
        'delete',
        previousCaptureJson.id,
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--reason',
        'Focused test guidance supersedes the broad note.'
      ]);
      const knowledgeListAll = await runDmx([
        'knowledge',
        'list',
        '--root',
        projectRoot,
        '--include-superseded',
        '--limit',
        '5'
      ]);

      const initJson = JSON.parse(init.stdout);
      const edgeAddJson = JSON.parse(edgeAdd.stdout);
      const edgeListJson = JSON.parse(edgeList.stdout);
      const searchJson = JSON.parse(search.stdout);
      const rateJson = JSON.parse(rate.stdout);
      const statusJson = JSON.parse(status.stdout);
      const indexJson = JSON.parse(index.stdout);
      const graphJson = JSON.parse(graph.stdout);
      const knowledgeGetJson = JSON.parse(knowledgeGet.stdout);
      const knowledgeListJson = JSON.parse(knowledgeList.stdout);
      const knowledgeUpdateJson = JSON.parse(knowledgeUpdate.stdout);
      const knowledgeDeleteJson = JSON.parse(knowledgeDelete.stdout);
      const knowledgeListAllJson = JSON.parse(knowledgeListAll.stdout);
      const indexManifest = JSON.parse(await readFile(join(projectRoot, '.dev-mesh', 'index', 'manifest.json'), 'utf8'));
      const graphIndex = JSON.parse(await readFile(join(projectRoot, '.dev-mesh', 'index', 'graph.json'), 'utf8'));
      const graphHtml = await readFile(graphHtmlPath, 'utf8');
      const ratingsJsonl = await readFile(
        join(
          projectRoot,
          '.dev-mesh',
          'knowledge',
          'ratings',
          `${rateJson.ratingEvent.createdAt.slice(0, 7)}.jsonl`
        ),
        'utf8'
      );
      const config = await readFile(join(projectRoot, '.dev-mesh', 'config.toml'), 'utf8');

      expect(initJson.storeRoot).toBe(join(projectRoot, '.dev-mesh'));
      expect(config).toContain('display_name = "Xiaoyun"');
      expect(captureJson).toMatchObject({
        title: 'Run focused tests',
        createdBy: {
          displayName: 'Xiaoyun'
        },
        para: {
          category: 'resources',
          key: 'test-commands'
        }
      });
      expect(searchJson.items[0]).toMatchObject({
        id: captureJson.id,
        title: 'Run focused tests'
      });
      expect(rateJson).toMatchObject({
        id: captureJson.id,
        quality: {
          rating: 1
        },
        ratingEvent: {
          knowledgeId: captureJson.id,
          reason: 'Useful local command.',
          createdBy: {
            displayName: 'Xiaoyun'
          }
        }
      });
      expect(ratingsJsonl).toContain(`"knowledgeId":"${captureJson.id}"`);
      expect(statusJson).toMatchObject({
        mode: 'local-only',
        schemaVersion: 1,
        knowledgeItems: 2
      });
      expect(indexJson).toMatchObject({
        documentCount: 2,
        graphNodeCount: expect.any(Number),
        graphEdgeCount: expect.any(Number),
        schemaVersion: 1
      });
      expect(indexManifest.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: captureJson.id,
            title: 'Run focused tests'
          }),
          expect.objectContaining({
            id: previousCaptureJson.id,
            title: 'Run broad tests'
          })
        ])
      );
      expect(graphJson.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `knowledge:${captureJson.id}`,
            kind: 'knowledge'
          }),
          expect.objectContaining({
            id: `knowledge:${previousCaptureJson.id}`,
            kind: 'knowledge'
          })
        ])
      );
      expect(graphJson.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'supersedes',
            from: `knowledge:${captureJson.id}`,
            to: `knowledge:${previousCaptureJson.id}`
          })
        ])
      );
      expect(edgeAddJson).toMatchObject({
        edge: {
          kind: 'supersedes',
          fromId: captureJson.id,
          toId: previousCaptureJson.id
        }
      });
      expect(edgeListJson).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'supersedes',
            fromId: captureJson.id,
            toId: previousCaptureJson.id
          })
        ])
      );
      expect(knowledgeGetJson).toMatchObject({
        id: captureJson.id,
        title: 'Run focused tests'
      });
      expect(knowledgeListJson.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: captureJson.id
          })
        ])
      );
      expect(knowledgeUpdateJson).toMatchObject({
        id: captureJson.id,
        summary: 'Use pnpm test:unit for fast focused checks.',
        tags: ['tests', 'focused'],
        event: {
          kind: 'knowledge.updated',
          payload: {
            knowledgeId: captureJson.id,
            reason: 'Clarify the local test command.',
            createdBy: {
              displayName: 'Xiaoyun'
            }
          }
        }
      });
      expect(knowledgeDeleteJson).toMatchObject({
        id: previousCaptureJson.id,
        status: 'tombstone',
        event: {
          kind: 'knowledge.deleted',
          payload: {
            knowledgeId: previousCaptureJson.id,
            reason: 'Focused test guidance supersedes the broad note.',
            createdBy: {
              displayName: 'Xiaoyun'
            }
          }
        }
      });
      expect(knowledgeListAllJson.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: previousCaptureJson.id,
            status: 'tombstone'
          })
        ])
      );
      expect(graphIndex.sourceItemCount).toBe(2);
      expect(visualize.stdout).toContain(graphHtmlPath);
      expect(graphHtml).toContain('DevMesh Knowledge Graph');
      expect(graphHtml).toContain('Cytoscape.js');
      expect(graphHtml).toContain('animate: true');
      expect(graphHtml).toContain('gravity: 1.2');
      expect(graphHtml).toContain('Run focused tests');
      expect(graphHtml).toContain(`knowledge:${captureJson.id}`);
      expect(graphHtml).toContain('supersedes');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});
