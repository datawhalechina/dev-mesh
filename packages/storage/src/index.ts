import type { RawEvent, StorageBackend } from '@mcp-dev-mesh/extension-api';

export interface InMemoryStorageState {
  knowledgeItems: unknown[];
  events: RawEvent[];
  cursors: Record<string, string>;
}

export function createInMemoryStorageBackend(): StorageBackend & { state: InMemoryStorageState } {
  const state: InMemoryStorageState = {
    knowledgeItems: [],
    events: [],
    cursors: {}
  };

  return {
    id: 'dev-mesh.storage.memory',
    kind: 'storage-backend',
    capabilities: ['storage.memory'],
    priority: 1,
    knowledgeItems: state.knowledgeItems,
    events: state.events,
    cursors: state.cursors,
    state
  };
}
