import type { DevMeshCore, KnowledgeItem } from '@devmesh/core';
import { readProjectConfig } from './project-store.js';

export interface ProjectBriefInput {
  project?: string;
  limit?: number;
}

export interface ProjectBriefResult {
  projectId: string;
  branch: string;
  items: KnowledgeItem[];
}

export async function createProjectBrief(core: DevMeshCore, input: ProjectBriefInput = {}): Promise<ProjectBriefResult> {
  const config = await readProjectConfig(core.projectRoot);
  const projectKey = resolveProjectKey(input.project, config.projectKey);
  const branch = config.knowledgeBranch.active;
  const candidates = await core.searchKnowledge({
    query: projectKey,
    layers: ['canonical'],
    limit: 50
  });

  return {
    projectId: projectKey,
    branch,
    items: candidates
      .filter((item) => canIncludeInProjectBrief(item, branch, projectKey))
      .slice(0, input.limit ?? 5)
  };
}

function canIncludeInProjectBrief(item: KnowledgeItem, branch: string, projectKey: string): boolean {
  if (item.visibility === 'org') {
    return true;
  }

  const itemGroupKey = readKnowledgeMetadataString(item, 'branch');

  if (itemGroupKey !== undefined && itemGroupKey !== branch) {
    return false;
  }

  if (item.visibility === 'project') {
    return matchesProjectKey(item, projectKey);
  }

  return true;
}

function matchesProjectKey(item: KnowledgeItem, projectKey: string): boolean {
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

function resolveProjectKey(project: string | undefined, fallback: string): string {
  if (project === undefined || project === 'auto') {
    return fallback;
  }

  const normalized = project.trim();

  return normalized.length > 0 ? normalized : fallback;
}
