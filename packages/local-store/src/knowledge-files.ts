import {
  matchesKnowledgeFilter,
  rankKnowledgeItem,
  type KnowledgeFilter,
  type KnowledgeItem,
  type SearchKnowledgeInput
} from '@devmesh/core';
import { ensureProjectStore } from './project-store.js';
import { readJsonl, walkKnowledgeItemFiles } from './files.js';
import type { ProjectBranchScope } from './types.js';

export const DEFAULT_KNOWLEDGE_BRANCH = 'main';

export async function loadProjectKnowledgeItems(projectRoot: string): Promise<KnowledgeItem[]> {
  const store = await ensureProjectStore(projectRoot);
  const files = await walkKnowledgeItemFiles(store.paths.knowledgeDir);
  const byId = new Map<string, KnowledgeItem>();

  for (const file of files) {
    const lines = await readJsonl<KnowledgeItem>(file);

    for (const item of lines) {
      const existing = byId.get(item.id);

      if (existing === undefined || item.updatedAt >= existing.updatedAt) {
        byId.set(item.id, item);
      }
    }
  }

  return [...byId.values()];
}

export function filterAndRankKnowledgeItems(
  items: KnowledgeItem[],
  input: SearchKnowledgeInput
): KnowledgeItem[] {
  return items
    .filter((item) => matchesKnowledgeFilter(item, input))
    .map((item) => ({
      item,
      score: rankKnowledgeItem(item, input)
    }))
    .filter((candidate) => candidate.score > 0 || input.query.trim().length === 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
    .slice(0, input.limit ?? 8)
    .map((candidate) => candidate.item);
}

export function filterKnowledgeItems(items: KnowledgeItem[], filter: KnowledgeFilter): KnowledgeItem[] {
  return items.filter((item) => matchesKnowledgeFilter(item, filter));
}

export function filterKnowledgeItemsByBranchScope(
  items: KnowledgeItem[],
  scope: ProjectBranchScope | undefined
): KnowledgeItem[] {
  if (scope === undefined) {
    return items;
  }

  const readable = new Set(scope.readable);

  return items.filter((item) => readable.has(readKnowledgeItemBranch(item)));
}

export function readKnowledgeItemBranch(item: KnowledgeItem): string {
  const value = item.source.metadata?.branch;

  return typeof value === 'string' && value.length > 0 ? value : DEFAULT_KNOWLEDGE_BRANCH;
}
