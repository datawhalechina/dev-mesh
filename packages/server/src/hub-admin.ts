import type {
  DevMeshCore,
  KnowledgeFilter,
  KnowledgeItem,
  KnowledgeLayer,
  SearchKnowledgeInput
} from '@mcp-dev-mesh/core';
import type { ProjectSummary } from '@mcp-dev-mesh/protocol';
import {
  type HubGroup,
  type HubResult,
  type HubState
} from './hub-model.js';
import { countByGroup, hubError, ok, projectMapKey, slugHandle } from './hub-utils.js';

export interface AdminOverview {
  service: string;
  version: string;
  baseUrl: string;
  mcpUrl: string;
  counts: {
    groups: number;
    members: number;
    projects: number;
    knowledgeItems: number;
    reviewQueue: number;
  };
  sync: {
    status: 'idle' | 'active';
    joinedGroups: number;
  };
  recentKnowledge: KnowledgeItem[];
}

export interface AdminGroupInput {
  key?: string;
  displayName?: string;
  description?: string;
  joinMode?: 'invite' | 'open' | 'admin';
}

export interface AdminProjectInput {
  groupKey?: string;
  id?: string;
  projectKey?: string;
  name?: string;
  description?: string;
}

export async function createAdminOverview(
  state: HubState,
  core: DevMeshCore,
  baseUrl: string
): Promise<AdminOverview> {
  const knowledgeItems = await core.listKnowledge({});

  return {
    service: 'mcp-dev-mesh',
    version: '0.1.0',
    baseUrl,
    mcpUrl: `${baseUrl.replace(/\/$/, '')}/mcp`,
    counts: {
      groups: state.groups.size,
      members: state.members.size,
      projects: state.projects.size,
      knowledgeItems: knowledgeItems.length,
      reviewQueue: 0
    },
    sync: {
      status: 'idle',
      joinedGroups: state.groups.size
    },
    recentKnowledge: knowledgeItems.slice(0, 5)
  };
}

export function listAdminMembers(state: HubState): AdminMemberSummary[] {
  return [...state.members.values()]
    .map((member) => {
      const token = [...state.tokens.values()].find((item) => item.memberId === member.memberId);
      const summary: AdminMemberSummary = {
        ...member
      };

      if (token?.expiresAt !== undefined) {
        summary.tokenExpiresAt = token.expiresAt;
      }

      return summary;
    })
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.displayName.localeCompare(b.displayName));
}

export function listAdminProjects(state: HubState): ProjectSummary[] {
  return [...state.projects.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.id.localeCompare(b.id));
}

export async function listAdminKnowledge(
  core: DevMeshCore,
  input: AdminKnowledgeQuery = {}
): Promise<KnowledgeItem[]> {
  const limit = input.limit ?? 50;

  if (input.query?.trim()) {
    const search: SearchKnowledgeInput = {
      query: input.query,
      limit
    };

    if (input.layer !== undefined) {
      search.layers = [input.layer];
    }

    return core.searchKnowledge(search);
  }

  const filter: KnowledgeFilter = {};

  if (input.layer !== undefined) {
    filter.layers = [input.layer];
  }

  const items = await core.listKnowledge(filter);

  return items.slice(0, limit);
}

export function createAdminGroup(state: HubState, input: AdminGroupInput): HubResult<HubGroup> {
  const key = slugHandle(input.key ?? input.displayName ?? '');

  if (!key) {
    return hubError(400, 'admin.group_key_required', 'A group key or displayName is required.');
  }

  const existing = state.groups.get(key);
  const group: HubGroup = {
    key,
    displayName: input.displayName?.trim() || existing?.displayName || key,
    joinMode: input.joinMode ?? existing?.joinMode ?? 'invite'
  };
  const description = input.description?.trim();

  if (description) {
    group.description = description;
  } else if (existing?.description !== undefined) {
    group.description = existing.description;
  }

  state.groups.set(key, group);

  return ok(group);
}

export function createAdminProject(state: HubState, input: AdminProjectInput): HubResult<ProjectSummary> {
  const groupKey = input.groupKey?.trim();

  if (!groupKey || !state.groups.has(groupKey)) {
    return hubError(404, 'admin.group_not_found', 'The target group does not exist.');
  }

  const name = input.name?.trim();

  if (!name) {
    return hubError(400, 'admin.project_name_required', 'A project name is required.');
  }

  const id = slugHandle(input.id ?? input.projectKey ?? name);

  if (!id) {
    return hubError(400, 'admin.project_id_invalid', 'Project id could not be derived.');
  }

  const key = projectMapKey(groupKey, id);
  const existing = state.projects.get(key);

  if (existing !== undefined) {
    return ok(existing);
  }

  const project: ProjectSummary = {
    id,
    projectKey: input.projectKey?.trim() || id,
    groupKey,
    name,
    createdByMemberId: 'admin',
    createdAt: new Date().toISOString()
  };
  const description = input.description?.trim();

  if (description) {
    project.description = description;
  }

  state.projects.set(key, project);

  return ok(project);
}

export function listAdminAuditLogs(): { auditLogs: AdminAuditLog[] } {
  return {
    auditLogs: []
  };
}

export function listAdminReviewQueue(): { items: AdminReviewQueueItem[] } {
  return {
    items: []
  };
}

export interface AdminMemberSummary {
  memberId: string;
  clientId: string;
  groupKey: string;
  displayName: string;
  handle: string;
  joinedAt: string;
  tokenExpiresAt?: string;
}

export interface AdminKnowledgeQuery {
  query?: string;
  layer?: KnowledgeLayer;
  limit?: number;
}

export interface AdminAuditLog {
  id: string;
  actor: string;
  action: string;
  createdAt: string;
}

export interface AdminReviewQueueItem {
  id: string;
  title: string;
  reason: string;
  createdAt: string;
}
