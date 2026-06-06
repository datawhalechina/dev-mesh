import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/tests/**/*.security.test.ts', 'apps/**/tests/**/*.security.test.ts'],
    passWithNoTests: true
  }
});
