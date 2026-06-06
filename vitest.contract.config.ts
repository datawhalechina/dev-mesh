import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/*.contract.test.ts', 'apps/**/*.contract.test.ts'],
    passWithNoTests: true
  }
});
