import {
  matchesKnowledgeFilter,
  rankKnowledgeItem,
  type KnowledgeFilter,
  type KnowledgeItem,
  type KnowledgeRepository,
  type SearchKnowledgeInput
} from '@devmesh/core';
import { appendJsonLine, getKnowledgeFile } from './files.js';
import { filterAndRankKnowledgeItems, filterKnowledgeItems, loadProjectKnowledgeItems } from './knowledge-files.js';
import { ensureProjectStore } from './project-store.js';
import { trySearchProjectIndex } from './indexer.js';

export class JsonlKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly projectRoot: string) {}

  async upsert(item: KnowledgeItem): Promise<void> {
    const store = await ensureProjectStore(this.projectRoot);

    await appendJsonLine(getKnowledgeFile(store.paths.knowledgeDir, item.layer), item);
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    const items = await this.loadItems();

    return items.find((item) => item.id === id);
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    const items = await this.loadItems();

    return filterKnowledgeItems(items, filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async search(input: SearchKnowledgeInput): Promise<KnowledgeItem[]> {
    const items = await this.loadItems();
    const indexed = await trySearchProjectIndex(this.projectRoot, {
      ...input,
      limit: Math.max((input.limit ?? 8) * 4, 20)
    });
    const filteredItems = items.filter((item) => matchesKnowledgeFilter(item, input));

    if (indexed !== undefined) {
      const byId = new Map(filteredItems.map((item) => [item.id, item]));

      return indexed
        .map((candidate) => {
          const item = byId.get(candidate.id);

          return item === undefined
            ? undefined
            : {
                item,
                score: candidate.score * 0.65 + rankKnowledgeItem(item, input) * 0.35
              };
        })
        .filter((candidate): candidate is { item: KnowledgeItem; score: number } => candidate !== undefined)
        .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
        .slice(0, input.limit ?? 8)
        .map((candidate) => candidate.item);
    }

    return filterAndRankKnowledgeItems(items, input);
  }

  private loadItems(): Promise<KnowledgeItem[]> {
    return loadProjectKnowledgeItems(this.projectRoot);
  }
}
