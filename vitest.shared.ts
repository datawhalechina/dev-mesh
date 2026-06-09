import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AliasOptions } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export const devMeshAliases: AliasOptions = {
  '@devmesh/adapters': resolve(root, 'packages/adapters/src/index.ts'),
  '@devmesh/agent': resolve(root, 'packages/agent/src/index.ts'),
  '@devmesh/client': resolve(root, 'packages/client/src/index.ts'),
  '@devmesh/core': resolve(root, 'packages/core/src/index.ts'),
  '@devmesh/extension-api': resolve(root, 'packages/extension-api/src/index.ts'),
  '@devmesh/graph': resolve(root, 'packages/graph/src/index.ts'),
  '@devmesh/local-store': resolve(root, 'packages/local-store/src/index.ts'),
  '@devmesh/mcp-contracts': resolve(root, 'packages/mcp-contracts/src/index.ts'),
  '@devmesh/protocol': resolve(root, 'packages/protocol/src/index.ts'),
  '@devmesh/providers': resolve(root, 'packages/providers/src/index.ts'),
  '@devmesh/quality': resolve(root, 'packages/quality/src/index.ts'),
  '@devmesh/redaction': resolve(root, 'packages/redaction/src/index.ts'),
  '@devmesh/registry': resolve(root, 'packages/registry/src/index.ts'),
  '@devmesh/search': resolve(root, 'packages/search/src/index.ts'),
  '@devmesh/server': resolve(root, 'packages/server/src/index.ts'),
  '@devmesh/shared': resolve(root, 'packages/shared/src/index.ts'),
  '@devmesh/storage': resolve(root, 'packages/storage/src/index.ts')
};
