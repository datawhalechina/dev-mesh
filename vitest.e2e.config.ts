import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/tests/**/*.e2e.test.ts', 'apps/**/tests/**/*.e2e.test.ts'],
    passWithNoTests: true
  }
});
