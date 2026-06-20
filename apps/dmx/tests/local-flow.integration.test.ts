import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_STORE_SCHEMA_VERSION, readProjectGraph } from '@devmesh/local-store';
import { runDmx } from './run-dmx.js';

describe('dmx CLI local flow', () => {
  it('initializes a project, captures knowledge, searches it, and reports status', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-cli-'));

    try {
      const init = await runDmx(['init', '--root', projectRoot, '--name', 'Xiaoyun']);
      const branchList = await runDmx(['branch', 'list', '--root', projectRoot, '--json']);
      const branchCreate = await runDmx([
        'branch',
        'create',
        'frontend',
        '--root',
        projectRoot,
        '--policy',
        'frontend_design',
        '--base',
        'shared',
        '--json'
      ]);
      const branchSwitch = await runDmx([
        'branch',
        'switch',
        'frontend',
        '--root',
        projectRoot,
        '--policy',
        'balanced',
        '--json'
      ]);
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
        'resources:test-commands',
        '--json'
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
        'resources:test-commands',
        '--json'
      ]);
      const previousCaptureJson = JSON.parse(previousCapture.stdout);
      const branchPolicy = await runDmx([
        'branch',
        'policy',
        'durable_only',
        '--root',
        projectRoot,
        '--json'
      ]);
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
        'Focused tests supersede the broad test note.',
        '--json'
      ]);
      const edgeList = await runDmx(['graph', 'edge', 'list', '--root', projectRoot, '--kind', 'supersedes', '--json']);
      const search = await runDmx(['search', 'focused tests', '--root', projectRoot, '--json']);
      const searchMainBranch = await runDmx(['search', 'focused tests', '--root', projectRoot, '--branch', 'main', '--json']);
      const searchFrontendBranch = await runDmx([
        'search',
        'focused tests',
        '--root',
        projectRoot,
        '--branch',
        'frontend',
        '--json'
      ]);
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
        'Useful local command.',
        '--json'
      ]);
      const status = await runDmx(['status', '--root', projectRoot, '--json']);
      const index = await runDmx(['index', 'rebuild', '--root', projectRoot, '--json']);
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
        'supersedes',
        '--json'
      ]);
      const graphMainBranch = await runDmx([
        'graph',
        'explore',
        '--root',
        projectRoot,
        '--branch',
        'main',
        '--query',
        'focused tests',
        '--depth',
        '1',
        '--json'
      ]);
      const graphFrontendBranch = await runDmx([
        'graph',
        'explore',
        '--root',
        projectRoot,
        '--branch',
        'frontend',
        '--query',
        'focused tests',
        '--depth',
        '1',
        '--json'
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
      const knowledgeGet = await runDmx(['knowledge', 'get', captureJson.id, '--root', projectRoot, '--json']);
      const knowledgeList = await runDmx([
        'knowledge',
        'list',
        '--root',
        projectRoot,
        '--json',
        '--layer',
        'extract',
        '--type',
        'command',
        '--limit',
        '5'
      ]);
      const knowledgeListMainBranch = await runDmx([
        'knowledge',
        'list',
        '--root',
        projectRoot,
        '--json',
        '--branch',
        'main',
        '--limit',
        '5'
      ]);
      const knowledgeListFrontendBranch = await runDmx([
        'knowledge',
        'list',
        '--root',
        projectRoot,
        '--json',
        '--branch',
        'frontend',
        '--limit',
        '5'
      ]);
      const knowledgeUpdate = await runDmx([
        'knowledge',
        'update',
        captureJson.id,
        '--root',
        projectRoot,
        '--json',
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
        '--json',
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
        '--json',
        '--include-superseded',
        '--limit',
        '5'
      ]);
      const knowledgeExport = await runDmx(['knowledge', 'export', '--root', projectRoot, '--json']);
      const knowledgeActiveExportPath = join(projectRoot, '.dev-mesh', 'exports', 'knowledge-active.jsonl');
      const knowledgeActiveExport = await runDmx([
        'knowledge',
        'export',
        '--root',
        projectRoot,
        '--path',
        knowledgeActiveExportPath,
        '--no-tombstones',
        '--json'
      ]);
      const knowledgeGetText = await runDmx(['knowledge', 'get', captureJson.id, '--root', projectRoot]);
      const knowledgeListText = await runDmx([
        'knowledge',
        'list',
        '--root',
        projectRoot,
        '--include-superseded',
        '--limit',
        '5'
      ]);
      const knowledgeExportText = await runDmx(['knowledge', 'export', '--root', projectRoot]);
      const statusText = await runDmx(['status', '--root', projectRoot]);
      const searchText = await runDmx(['search', 'focused tests', '--root', projectRoot]);
      const edgeListText = await runDmx(['graph', 'edge', 'list', '--root', projectRoot, '--kind', 'supersedes']);
      const indexText = await runDmx(['index', 'rebuild', '--root', projectRoot]);

      const initJson = JSON.parse(init.stdout);
      const branchListJson = JSON.parse(branchList.stdout);
      const branchCreateJson = JSON.parse(branchCreate.stdout);
      const branchSwitchJson = JSON.parse(branchSwitch.stdout);
      const branchPolicyJson = JSON.parse(branchPolicy.stdout);
      const edgeAddJson = JSON.parse(edgeAdd.stdout);
      const edgeListJson = JSON.parse(edgeList.stdout);
      const searchJson = JSON.parse(search.stdout);
      const searchMainBranchJson = JSON.parse(searchMainBranch.stdout);
      const searchFrontendBranchJson = JSON.parse(searchFrontendBranch.stdout);
      const rateJson = JSON.parse(rate.stdout);
      const statusJson = JSON.parse(status.stdout);
      const indexJson = JSON.parse(index.stdout);
      const graphJson = JSON.parse(graph.stdout);
      const graphMainBranchJson = JSON.parse(graphMainBranch.stdout);
      const graphFrontendBranchJson = JSON.parse(graphFrontendBranch.stdout);
      const knowledgeGetJson = JSON.parse(knowledgeGet.stdout);
      const knowledgeListJson = JSON.parse(knowledgeList.stdout);
      const knowledgeListMainBranchJson = JSON.parse(knowledgeListMainBranch.stdout);
      const knowledgeListFrontendBranchJson = JSON.parse(knowledgeListFrontendBranch.stdout);
      const knowledgeUpdateJson = JSON.parse(knowledgeUpdate.stdout);
      const knowledgeDeleteJson = JSON.parse(knowledgeDelete.stdout);
      const knowledgeListAllJson = JSON.parse(knowledgeListAll.stdout);
      const knowledgeExportJson = JSON.parse(knowledgeExport.stdout);
      const knowledgeActiveExportJson = JSON.parse(knowledgeActiveExport.stdout);
      const knowledgeExportJsonl = await readFile(join(projectRoot, '.dev-mesh', 'exports', 'knowledge.jsonl'), 'utf8');
      const knowledgeActiveExportJsonl = await readFile(knowledgeActiveExportPath, 'utf8');
      const indexManifest = JSON.parse(await readFile(join(projectRoot, '.dev-mesh', 'index', 'manifest.json'), 'utf8'));
      const graphIndex = await readProjectGraph(projectRoot);
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
      expect(config).toContain('[knowledge_branch]');
      expect(config).toContain('active = "frontend"');
      expect(config).toContain('base = "shared"');
      expect(config).toContain('[knowledge_branch.policies.frontend]');
      expect(config).toContain('preset = "durable_only"');
      expect(branchListJson).toMatchObject({
        active: 'main',
        branches: [
          {
            name: 'main',
            active: true,
            policy: 'balanced'
          }
        ]
      });
      expect(branchCreateJson.branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'frontend',
            policy: 'frontend_design'
          }),
          expect.objectContaining({
            name: 'shared',
            base: true,
            policy: 'durable_only'
          })
        ])
      );
      expect(branchSwitchJson).toMatchObject({
        active: 'frontend'
      });
      expect(branchPolicyJson.branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'frontend',
            active: true,
            policy: 'durable_only'
          })
        ])
      );
      expect(captureJson).toMatchObject({
        title: 'Run focused tests',
        source: {
          metadata: {
            branch: 'frontend'
          }
        },
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
      expect(searchMainBranchJson.items).toEqual([]);
      expect(searchFrontendBranchJson.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: captureJson.id,
            title: 'Run focused tests'
          })
        ])
      );
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
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION,
        knowledgeItems: 2
      });
      expect(indexJson).toMatchObject({
        documentCount: 2,
        graphNodeCount: expect.any(Number),
        graphEdgeCount: expect.any(Number),
        schemaVersion: PROJECT_STORE_SCHEMA_VERSION
      });
      expect(indexManifest.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: captureJson.id,
            branch: 'frontend',
            title: 'Run focused tests'
          }),
          expect.objectContaining({
            id: previousCaptureJson.id,
            branch: 'frontend',
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
      expect(graphMainBranchJson.nodes).toEqual([]);
      expect(graphFrontendBranchJson.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `knowledge:${captureJson.id}`,
            kind: 'knowledge'
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
      expect(knowledgeListMainBranchJson.items).toEqual([]);
      expect(knowledgeListFrontendBranchJson.items).toEqual(
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
      expect(knowledgeExportJson).toMatchObject({
        path: join(projectRoot, '.dev-mesh', 'exports', 'knowledge.jsonl'),
        crdtPath: join(projectRoot, '.dev-mesh', 'crdt', 'project.automerge'),
        exportedKnowledge: 2,
        skippedTombstones: 0
      });
      expect(knowledgeExportJson.heads.length).toBeGreaterThan(0);
      expect(knowledgeExportJsonl).toContain(`"id":"${captureJson.id}"`);
      expect(knowledgeExportJsonl).toContain('"summary":"Use pnpm test:unit for fast focused checks."');
      expect(knowledgeExportJsonl).toContain(`"id":"${previousCaptureJson.id}"`);
      expect(knowledgeExportJsonl).toContain('"status":"tombstone"');
      expect(knowledgeActiveExportJson).toMatchObject({
        path: knowledgeActiveExportPath,
        exportedKnowledge: 1,
        skippedTombstones: 1
      });
      expect(knowledgeActiveExportJsonl).toContain(`"id":"${captureJson.id}"`);
      expect(knowledgeActiveExportJsonl).not.toContain(`"id":"${previousCaptureJson.id}"`);
      expect(knowledgeGetText.stdout).toContain('Knowledge item');
      expect(knowledgeGetText.stdout).toContain(`id: ${captureJson.id}`);
      expect(knowledgeGetText.stdout).toContain('summary: Use pnpm test:unit for fast focused checks.');
      expect(knowledgeGetText.stdout.trim()).not.toMatch(/^\{/);
      expect(knowledgeListText.stdout).toContain('Knowledge items');
      expect(knowledgeListText.stdout).toContain(`id=${previousCaptureJson.id}`);
      expect(knowledgeListText.stdout).toContain('status=tombstone');
      expect(knowledgeListText.stdout.trim()).not.toMatch(/^\{/);
      expect(knowledgeExportText.stdout).toContain('DevMesh knowledge exported');
      expect(knowledgeExportText.stdout).toContain('knowledge: 2');
      expect(knowledgeExportText.stdout.trim()).not.toMatch(/^\{/);
      expect(statusText.stdout).toContain('DevMesh status');
      expect(statusText.stdout).toContain('mode: local-only');
      expect(statusText.stdout.trim()).not.toMatch(/^\{/);
      expect(searchText.stdout).toContain('DevMesh context results');
      expect(searchText.stdout).toContain(`id=${captureJson.id}`);
      expect(searchText.stdout.trim()).not.toMatch(/^\{/);
      expect(edgeListText.stdout).toContain('Knowledge graph edges');
      expect(edgeListText.stdout).toContain(`from=${captureJson.id}`);
      expect(edgeListText.stdout.trim()).not.toMatch(/^\{/);
      expect(indexText.stdout).toContain('DevMesh index rebuilt');
      expect(indexText.stdout).toContain('documents: 2');
      expect(indexText.stdout.trim()).not.toMatch(/^\{/);
      expect(graphIndex?.sourceItemCount).toBe(2);
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
  }, 60000);
});
