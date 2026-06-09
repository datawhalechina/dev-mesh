import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  dts: false,
  splitting: false,
  noExternal: [
    '@devmesh/adapters',
    '@devmesh/agent',
    '@devmesh/client',
    '@devmesh/core',
    '@devmesh/extension-api',
    '@devmesh/graph',
    '@devmesh/local-store',
    '@devmesh/mcp-contracts',
    '@devmesh/redaction',
    '@devmesh/shared'
  ]
});
