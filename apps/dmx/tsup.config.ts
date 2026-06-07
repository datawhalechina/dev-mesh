import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  dts: false,
  splitting: false,
  noExternal: [
    '@mcp-dev-mesh/adapters',
    '@mcp-dev-mesh/agent',
    '@mcp-dev-mesh/client',
    '@mcp-dev-mesh/core',
    '@mcp-dev-mesh/extension-api',
    '@mcp-dev-mesh/extractor',
    '@mcp-dev-mesh/local-store',
    '@mcp-dev-mesh/mcp-contracts',
    '@mcp-dev-mesh/shared'
  ]
});
