import { join } from 'node:path';
import { createKnowledgeId } from '@mcp-dev-mesh/core';
import { nowIso } from '@mcp-dev-mesh/shared';
import { appendJsonLine } from './files.js';
import { ensureProjectStore, projectKeyOptions, readProjectKey } from './project-store.js';
import type { DevMeshEvent } from './types.js';

export async function appendProjectEvent(
  projectRoot: string,
  kind: string,
  payload: Record<string, unknown>,
  projectKey?: string
): Promise<DevMeshEvent> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(projectKey));
  const eventProjectKey = await readProjectKey(store, projectKey);
  const event: DevMeshEvent = {
    id: createKnowledgeId('evt'),
    kind,
    projectKey: eventProjectKey,
    createdAt: nowIso(),
    payload
  };
  const month = event.createdAt.slice(0, 7);

  await appendJsonLine(join(store.paths.eventsDir, `${month}.jsonl`), event);

  return event;
}
