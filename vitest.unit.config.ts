import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { devMeshAliases } from './vitest.shared.js';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: devMeshAliases
  },
  test: {
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
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
