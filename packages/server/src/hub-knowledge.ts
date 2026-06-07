import type { DevMeshCore, KnowledgeItem } from '@mcp-dev-mesh/core';
import type { ProjectSummary } from '@mcp-dev-mesh/protocol';
import type { HubAuthContext } from './hub-model.js';

export interface HubProjectBrief {
  projectId: string;
  groupKey: string;
  items: KnowledgeItem[];
}

export async function createHubProjectBrief(
  core: DevMeshCore,
  auth: HubAuthContext,
  project: ProjectSummary
): Promise<HubProjectBrief> {
  const candidates = await core.searchKnowledge({
    query: project.projectKey,
    layers: ['canonical'],
    limit: 50
  });

  return {
    projectId: project.id,
    groupKey: project.groupKey,
    items: candidates
      .filter((item) => canShareKnowledgeWithProject(item, auth.groupKey, project.projectKey))
      .slice(0, 5)
  };
}

export function canShareKnowledgeWithProject(item: KnowledgeItem, groupKey: string, projectKey: string): boolean {
  if (item.visibility === 'org') {
    return true;
  }

  const itemGroupKey = readKnowledgeMetadataString(item, 'groupKey');

  if (itemGroupKey !== undefined && itemGroupKey !== groupKey) {
    return false;
  }

  if (item.visibility === 'project') {
    return matchesKnowledgeProject(item, projectKey);
  }

  return true;
}

function matchesKnowledgeProject(item: KnowledgeItem, projectKey: string): boolean {
  const itemProjectKey = readKnowledgeMetadataString(item, 'projectKey');

  if (itemProjectKey !== undefined) {
    return itemProjectKey === projectKey;
  }

  return item.para.category !== 'projects' || item.para.key === projectKey;
}

function readKnowledgeMetadataString(item: KnowledgeItem, key: string): string | undefined {
  const value = item.source.metadata?.[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
