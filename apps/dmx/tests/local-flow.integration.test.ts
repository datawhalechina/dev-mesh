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
      const search = await runDmx(['search', 'focused tests', '--root', projectRoot]);
      const rate = await runDmx([
        'rate',
        JSON.parse(capture.stdout).id,
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
      const graph = await runDmx(['graph', 'explore', '--root', projectRoot, '--query', 'focused tests', '--depth', '1']);
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

      const initJson = JSON.parse(init.stdout);
      const captureJson = JSON.parse(capture.stdout);
      const searchJson = JSON.parse(search.stdout);
      const rateJson = JSON.parse(rate.stdout);
      const statusJson = JSON.parse(status.stdout);
      const indexJson = JSON.parse(index.stdout);
      const graphJson = JSON.parse(graph.stdout);
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
        knowledgeItems: 1
      });
      expect(indexJson).toMatchObject({
        documentCount: 1,
        graphNodeCount: expect.any(Number),
        graphEdgeCount: expect.any(Number),
        schemaVersion: 1
      });
      expect(indexManifest.documents[0]).toMatchObject({
        id: captureJson.id,
        title: 'Run focused tests'
      });
      expect(graphJson.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `knowledge:${captureJson.id}`,
            kind: 'knowledge'
          })
        ])
      );
      expect(graphIndex.sourceItemCount).toBe(1);
      expect(visualize.stdout).toContain(graphHtmlPath);
      expect(graphHtml).toContain('DevMesh Knowledge Graph');
      expect(graphHtml).toContain('Cytoscape.js');
      expect(graphHtml).toContain('animate: true');
      expect(graphHtml).toContain('gravity: 1.2');
      expect(graphHtml).toContain('Run focused tests');
      expect(graphHtml).toContain(`knowledge:${captureJson.id}`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});
