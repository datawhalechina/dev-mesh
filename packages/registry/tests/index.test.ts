import { describe, expect, it } from 'vitest';
import type { DevMeshExtension, SearchBackend, ToolAdapter } from '@devmesh/extension-api';
import { createExtensionRegistry } from '../src/index.js';

describe('DefaultExtensionRegistry', () => {
  it('resolves matching capabilities by priority and id', () => {
    const registry = createExtensionRegistry();
    registry.registerSearchBackend(searchBackend('devmesh.search.beta', 10, ['search.keyword']));
    registry.registerSearchBackend(searchBackend('devmesh.search.alpha', 10, ['search.keyword']));
    registry.registerSearchBackend(searchBackend('devmesh.search.priority', 50, ['search.keyword']));
    registry.registerSearchBackend(searchBackend('devmesh.search.vector', 100, ['search.vector']));

    const resolved = registry.resolve<SearchBackend>('search-backend', 'search.keyword');

    expect(resolved.map((backend) => backend.id)).toEqual([
      'devmesh.search.priority',
      'devmesh.search.alpha',
      'devmesh.search.beta'
    ]);
  });

  it('replaces duplicate component ids on re-registration', () => {
    const registry = createExtensionRegistry();
    registry.registerSearchBackend(searchBackend('devmesh.search.keyword', 1, ['search.keyword']));
    registry.registerSearchBackend(searchBackend('devmesh.search.keyword', 99, ['search.keyword']));

    const resolved = registry.resolve<SearchBackend>('search-backend', 'search.keyword');

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.priority).toBe(99);
  });

  it('rejects registration under the wrong component kind', () => {
    const registry = createExtensionRegistry();
    const adapter = {
      ...toolAdapter('devmesh.adapter.codex'),
      kind: 'search-backend' as const
    };

    expect(() => registry.registerAdapter(adapter as unknown as ToolAdapter)).toThrow(
      'Cannot register devmesh.adapter.codex as tool-adapter'
    );
  });

  it('allows extensions to register components', async () => {
    const registry = createExtensionRegistry();
    const extension: DevMeshExtension = {
      id: 'company.search',
      version: '0.1.0',
      kind: 'search-backend',
      capabilities: ['search.keyword'],
      register(registry) {
        registry.registerSearchBackend(searchBackend('company.search.keyword', 20, ['search.keyword']));
      }
    };

    await registry.registerExtension(extension);

    expect(registry.resolve<SearchBackend>('search-backend', 'search.keyword')[0]?.id).toBe('company.search.keyword');
  });
});

function searchBackend(id: string, priority: number, capabilities: string[]): SearchBackend {
  return {
    id,
    kind: 'search-backend',
    capabilities,
    priority,
    async index() {
      return;
    },
    async remove() {
      return;
    },
    async search() {
      return [];
    }
  };
}

function toolAdapter(id: string): ToolAdapter {
  return {
    id,
    kind: 'tool-adapter',
    capabilities: ['tool.detect'],
    async detect() {
      return { detected: true };
    },
    async isConfigured() {
      return false;
    },
    async configure() {
      return { changed: false };
    },
    async remove() {
      return;
    },
    async doctor() {
      return [];
    }
  };
}
