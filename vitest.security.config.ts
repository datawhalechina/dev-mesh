import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/*.security.test.ts', 'apps/**/*.security.test.ts'],
    passWithNoTests: true
  }
});
