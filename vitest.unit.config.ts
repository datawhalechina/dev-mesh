import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.integration.test.ts',
      '**/*.contract.test.ts',
      '**/*.security.test.ts',
      '**/*.e2e.test.ts'
    ],
    passWithNoTests: true
  }
});
