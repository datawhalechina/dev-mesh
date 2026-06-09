import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DEV_MESH_DIR, ensureProjectStore, readProjectConfig } from '@devmesh/local-store';
import type { DevMeshDoctorCheck, DoctorContext } from './doctor-types.js';

export async function checkProjectStore(context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  try {
    const store = await ensureProjectStore(context.projectRoot);
    const config = await readProjectConfig(context.projectRoot);
    context.projectConfig = config;

    const missing = await listMissingPaths([
      store.paths.root,
      store.paths.config,
      store.paths.eventsDir,
      store.paths.knowledgeDir,
      store.paths.indexDir,
      store.paths.visualizationsDir,
      store.paths.queueDir,
      store.paths.syncDir,
      store.paths.secretsDir
    ]);

    if (missing.length > 0) {
      return [
        {
          id: 'store.paths',
          category: 'store',
          status: 'error',
          message: `Project store is missing ${missing.length} required path(s).`,
          fixHint: `Run dmx init --root "${context.projectRoot}" to rebuild the local store skeleton.`
        }
      ];
    }

    return [
      {
        id: 'store.project',
        category: 'store',
        status: 'ok',
        message: `Project store is available at ${store.storeRoot}.`
      },
      {
        id: 'store.schema',
        category: 'store',
        status: 'ok',
        message: `Project store schema version ${config.schemaVersion} is supported.`
      }
    ];
  } catch (error) {
    return [
      {
        id: 'store.project',
        category: 'store',
        status: 'error',
        message: error instanceof Error ? error.message : 'Project store check failed.',
        fixHint: `Run dmx init --root "${context.projectRoot}" or inspect ${join(context.projectRoot, DEV_MESH_DIR)}.`
      }
    ];
  }
}

async function listMissingPaths(paths: string[]): Promise<string[]> {
  const missing: string[] = [];

  for (const path of paths) {
    try {
      await stat(path);
    } catch {
      missing.push(path);
    }
  }

  return missing;
}
