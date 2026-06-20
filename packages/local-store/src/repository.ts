import {
  matchesKnowledgeFilter,
  rankKnowledgeItem,
  type KnowledgeFilter,
  type KnowledgeItem,
  type KnowledgeRepository,
  type SearchKnowledgeInput
} from '@devmesh/core';
import { appendJsonLine, getKnowledgeFile } from './files.js';
import {
  filterAndRankKnowledgeItems,
  filterKnowledgeItems,
  filterKnowledgeItemsByBranchScope,
  loadProjectKnowledgeItems
} from './knowledge-files.js';
import { ensureProjectStore, readProjectBranchScope } from './project-store.js';
import { trySearchProjectIndex } from './indexer.js';
import { loadBranchKnowledgeItemsFromCrdt } from './crdt.js';
import type { ProjectBranchScope } from './types.js';

export class JsonlKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly projectRoot: string,
    private readonly options: { branchScope?: ProjectBranchScope | false } = {}
  ) {}

  async upsert(item: KnowledgeItem): Promise<void> {
    const store = await ensureProjectStore(this.projectRoot);

    await appendJsonLine(getKnowledgeFile(store.paths.knowledgeDir, item.layer), item);
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    const items = await this.loadScopedItems();

    return items.find((item) => item.id === id);
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    const items = await this.loadScopedItems();

    return filterKnowledgeItems(items, filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async search(input: SearchKnowledgeInput): Promise<KnowledgeItem[]> {
    const branchScope = await this.readBranchScope();
    const items = await this.loadScopedItems(branchScope);
    const indexed = await trySearchProjectIndex(this.projectRoot, {
      ...input,
      limit: Math.max((input.limit ?? 8) * 4, 20)
    }, branchScope);
    const filteredItems = items.filter((item) => matchesKnowledgeFilter(item, input));

    if (indexed !== undefined) {
      const byId = new Map(filteredItems.map((item) => [item.id, item]));
      const candidates = new Map<string, { item: KnowledgeItem; score: number }>();

      for (const candidate of indexed) {
        const item = byId.get(candidate.id);

        if (item === undefined) {
          continue;
        }

        candidates.set(item.id, {
          item,
          score: candidate.score * 0.65 + rankKnowledgeItem(item, input) * 0.35
        });
      }

      for (const item of filteredItems) {
        if (candidates.has(item.id)) {
          continue;
        }

        const score = rankKnowledgeItem(item, input);

        if (score > 0 || input.query.trim().length === 0) {
          candidates.set(item.id, {
            item,
            score
          });
        }
      }

      return [...candidates.values()]
        .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
        .slice(0, input.limit ?? 8)
        .map((candidate) => candidate.item);
    }

    return filterAndRankKnowledgeItems(items, input);
  }

  private async loadScopedItems(scope?: ProjectBranchScope): Promise<KnowledgeItem[]> {
    const resolvedScope = scope ?? (await this.readBranchScope());
    const items = filterKnowledgeItemsByBranchScope(await this.loadItems(), resolvedScope);

    if (resolvedScope?.base === undefined) {
      return items;
    }

    return mergeKnowledgeItems([
      ...items,
      ...(await loadBranchKnowledgeItemsFromCrdt(this.projectRoot, resolvedScope.base))
    ]);
  }

  private async readBranchScope(): Promise<ProjectBranchScope | undefined> {
    if (this.options.branchScope === false) {
      return undefined;
    }

    if (this.options.branchScope !== undefined) {
      return this.options.branchScope;
    }

    return readProjectBranchScope(this.projectRoot);
  }

  private loadItems(): Promise<KnowledgeItem[]> {
    return loadProjectKnowledgeItems(this.projectRoot);
  }
}

function mergeKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  const byId = new Map<string, KnowledgeItem>();

  for (const item of items) {
    const existing = byId.get(item.id);

    if (existing === undefined || item.updatedAt >= existing.updatedAt) {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()];
}
