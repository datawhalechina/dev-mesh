import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/tests/**/*.integration.test.ts', 'apps/**/tests/**/*.integration.test.ts'],
    passWithNoTests: true,
    testTimeout: 60000
  }
});
