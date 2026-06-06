import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/tests/**/*.contract.test.ts', 'apps/**/tests/**/*.contract.test.ts'],
    passWithNoTests: true
  }
});
