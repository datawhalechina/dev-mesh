import type { KnowledgeItem } from '@devmesh/core';

export const DEFAULT_HUB_KNOWLEDGE_GROUP = 'default';

export function readKnowledgeGroupKey(item: KnowledgeItem): string | undefined {
  return readKnowledgeMetadataString(item, 'groupKey');
}

export function withKnowledgeGroupKey(item: KnowledgeItem, groupKey: string): KnowledgeItem {
  return {
    ...item,
    source: {
      ...item.source,
      metadata: {
        ...(item.source.metadata ?? {}),
        groupKey
      }
    }
  };
}

export function filterKnowledgeByGroup(items: KnowledgeItem[], groupKey: string | undefined): KnowledgeItem[] {
  if (groupKey === undefined) {
    return items;
  }

  return items.filter((item) => item.visibility === 'org' || readKnowledgeGroupKeyOrDefault(item) === groupKey);
}

export function knowledgeBelongsToGroup(item: KnowledgeItem, groupKey: string | undefined): boolean {
  return groupKey === undefined || item.visibility === 'org' || readKnowledgeGroupKeyOrDefault(item) === groupKey;
}

export function readKnowledgeMetadataString(item: KnowledgeItem, key: string): string | undefined {
  const value = item.source.metadata?.[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readKnowledgeGroupKeyOrDefault(item: KnowledgeItem): string {
  return readKnowledgeGroupKey(item) ?? DEFAULT_HUB_KNOWLEDGE_GROUP;
}
