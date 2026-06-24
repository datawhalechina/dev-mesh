import type { KnowledgeItem } from '@devmesh/core';

export const DEFAULT_HUB_KNOWLEDGE_GROUP = 'default';

export function readKnowledgeGroupKey(item: KnowledgeItem): string | undefined {
  return readKnowledgeMetadataString(item, 'branch');
}

export function withKnowledgeGroupKey(item: KnowledgeItem, branch: string): KnowledgeItem {
  return {
    ...item,
    source: {
      ...item.source,
      metadata: {
        ...(item.source.metadata ?? {}),
        branch
      }
    }
  };
}

export function filterKnowledgeByGroup(items: KnowledgeItem[], branch: string | undefined): KnowledgeItem[] {
  if (branch === undefined) {
    return items;
  }

  return items.filter((item) => item.visibility === 'org' || readKnowledgeGroupKeyOrDefault(item) === branch);
}

export function knowledgeBelongsToGroup(item: KnowledgeItem, branch: string | undefined): boolean {
  return branch === undefined || item.visibility === 'org' || readKnowledgeGroupKeyOrDefault(item) === branch;
}

export function readKnowledgeMetadataString(item: KnowledgeItem, key: string): string | undefined {
  const value = item.source.metadata?.[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readKnowledgeGroupKeyOrDefault(item: KnowledgeItem): string {
  return readKnowledgeGroupKey(item) ?? DEFAULT_HUB_KNOWLEDGE_GROUP;
}
