import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  captureProjectKnowledge,
  ensureProjectStore,
  importProjectJsonlToCrdt,
  readProjectProjectionStatus
} from '@devmesh/local-store';
import { runDmx } from './run-dmx.js';

describe('dmx index command', () => {
  it('rebuilds local projections from the v2 CRDT document', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-cli-index-crdt-'));

    try {
      await ensureProjectStore(projectRoot);
      await captureProjectKnowledge(projectRoot, {
        id: 'kn_cli_crdt_projection_1',
        type: 'decision',
        layer: 'canonical',
        title: 'CLI rebuilds CRDT projections',
        summary: 'The index command can materialize local read models from the v2 CRDT document.',
        tags: ['crdt', 'projection']
      });
      const imported = await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'cccccccccccccccccccccccccccccccc'
      });

      await rm(join(projectRoot, '.dev-mesh', 'index'), { recursive: true, force: true });
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'missing'
      });

      const rebuild = await runDmx(['index', 'rebuild', '--root', projectRoot, '--from-crdt', '--json']);
      const result = JSON.parse(rebuild.stdout) as {
        crdtPath: string;
        metadataPath: string;
        sourceHeads: string[];
        documentCount: number;
      };

      expect(result).toMatchObject({
        crdtPath: imported.path,
        metadataPath: join(projectRoot, '.dev-mesh', 'index', 'projection-meta.json'),
        sourceHeads: imported.heads,
        documentCount: 1
      });
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'ready',
        sourceHeads: imported.heads,
        documentCount: 1
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
