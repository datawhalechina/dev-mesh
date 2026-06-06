import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AliasOptions } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export const devMeshAliases: AliasOptions = {
  '@mcp-dev-mesh/adapters': resolve(root, 'packages/adapters/src/index.ts'),
  '@mcp-dev-mesh/agent': resolve(root, 'packages/agent/src/index.ts'),
  '@mcp-dev-mesh/client': resolve(root, 'packages/client/src/index.ts'),
  '@mcp-dev-mesh/core': resolve(root, 'packages/core/src/index.ts'),
  '@mcp-dev-mesh/extension-api': resolve(root, 'packages/extension-api/src/index.ts'),
  '@mcp-dev-mesh/extractor': resolve(root, 'packages/extractor/src/index.ts'),
  '@mcp-dev-mesh/local-store': resolve(root, 'packages/local-store/src/index.ts'),
  '@mcp-dev-mesh/mcp-contracts': resolve(root, 'packages/mcp-contracts/src/index.ts'),
  '@mcp-dev-mesh/protocol': resolve(root, 'packages/protocol/src/index.ts'),
  '@mcp-dev-mesh/providers': resolve(root, 'packages/providers/src/index.ts'),
  '@mcp-dev-mesh/quality': resolve(root, 'packages/quality/src/index.ts'),
  '@mcp-dev-mesh/registry': resolve(root, 'packages/registry/src/index.ts'),
  '@mcp-dev-mesh/search': resolve(root, 'packages/search/src/index.ts'),
  '@mcp-dev-mesh/server': resolve(root, 'packages/server/src/index.ts'),
  '@mcp-dev-mesh/shared': resolve(root, 'packages/shared/src/index.ts'),
  '@mcp-dev-mesh/storage': resolve(root, 'packages/storage/src/index.ts')
};
