import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/*.e2e.test.ts', 'apps/**/*.e2e.test.ts'],
    passWithNoTests: true
  }
});
