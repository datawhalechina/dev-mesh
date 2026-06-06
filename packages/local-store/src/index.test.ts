import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createKnowledgeItem } from '@mcp-dev-mesh/core';
import { ensureProjectStore, JsonlKnowledgeRepository } from './index.js';

describe('local project store', () => {
  it('bootstraps .dev-mesh and stores knowledge as jsonl', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const store = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const config = await readFile(store.paths.config, 'utf8');
      expect(config).toContain('project_key = "org/repo"');

      const repository = new JsonlKnowledgeRepository(projectRoot);
      const item = createKnowledgeItem({
        type: 'command',
        title: 'Run unit tests',
        summary: 'Use pnpm test before pushing.'
      });
      await repository.upsert(item);

      const results = await repository.search({ query: 'unit tests' });
      expect(results[0]?.id).toBe(item.id);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('is idempotent and writes safety defaults', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const first = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });
      const second = await ensureProjectStore(projectRoot, { projectKey: 'org/repo' });

      expect(second.storeRoot).toBe(first.storeRoot);
      await expect(stat(first.paths.indexDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.queueDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(stat(first.paths.secretsDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

      const gitignore = await readFile(join(first.storeRoot, '.gitignore'), 'utf8');
      expect(gitignore).toContain('index/');
      expect(gitignore).toContain('secrets/');
      expect(gitignore).toContain('knowledge/raw/');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('deduplicates repeated JSONL items by id when reading', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-'));

    try {
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const original = createKnowledgeItem({
        type: 'decision',
        title: 'Prefer JSONL',
        summary: 'Original summary.'
      });
      const replacement = {
        ...original,
        summary: 'Replacement summary.',
        updatedAt: new Date(Date.parse(original.updatedAt) + 1000).toISOString()
      };

      await repository.upsert(original);
      await repository.upsert(replacement);

      const loaded = await repository.get(original.id);
      expect(loaded?.summary).toBe('Replacement summary.');
      expect(await repository.list({ includeSuperseded: true })).toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
