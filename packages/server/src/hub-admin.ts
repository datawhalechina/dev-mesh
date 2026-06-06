import { randomUUID } from 'node:crypto';
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
  type HubInvite,
  type HubResult,
  type HubState
} from './hub-model.js';
import { appendHubAuditLog } from './hub-audit.js';
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

export interface AdminInviteInput {
  groupKey?: string;
  token?: string;
  expiresAt?: string;
  maxUses?: number;
}

export interface AdminMemberDisableInput {
  reason?: string;
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

export function listAdminInvites(state: HubState): AdminInviteSummary[] {
  return [...state.invites.values()]
    .map((invite) => ({
      ...invite,
      status: getInviteStatus(invite)
    }))
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.createdAt.localeCompare(b.createdAt));
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
  appendHubAuditLog(state, {
    actor: 'admin',
    action: existing === undefined ? 'group.created' : 'group.updated',
    targetType: 'group',
    targetId: key,
    groupKey: key,
    payload: {
      displayName: group.displayName,
      joinMode: group.joinMode
    }
  });

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
  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'project.created',
    targetType: 'project',
    targetId: project.id,
    groupKey,
    payload: {
      projectKey: project.projectKey,
      name: project.name
    }
  });

  return ok(project);
}

export function createAdminInvite(state: HubState, input: AdminInviteInput): HubResult<AdminInviteSummary> {
  const groupKey = input.groupKey?.trim();

  if (!groupKey || !state.groups.has(groupKey)) {
    return hubError(404, 'admin.group_not_found', 'The target group does not exist.');
  }

  const token = input.token?.trim() || createInviteToken(state);

  if (!token) {
    return hubError(400, 'admin.invite_token_required', 'Invite token could not be derived.');
  }

  if (state.invites.has(token)) {
    return hubError(409, 'admin.invite_token_exists', 'Invite token already exists.');
  }

  const invite: HubInvite = {
    token,
    groupKey,
    uses: 0,
    createdAt: new Date().toISOString(),
    createdBy: 'admin'
  };

  if (input.expiresAt !== undefined) {
    const expiresAt = input.expiresAt.trim();

    if (!Number.isFinite(Date.parse(expiresAt))) {
      return hubError(400, 'admin.invite_expires_at_invalid', 'expiresAt must be an ISO timestamp.');
    }

    invite.expiresAt = expiresAt;
  }

  if (input.maxUses !== undefined) {
    if (!Number.isInteger(input.maxUses) || input.maxUses <= 0) {
      return hubError(400, 'admin.invite_max_uses_invalid', 'maxUses must be a positive integer.');
    }

    invite.maxUses = input.maxUses;
  }

  state.invites.set(token, invite);
  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'invite.created',
    targetType: 'invite',
    targetId: token,
    groupKey,
    payload: {
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses
    }
  });

  return ok({
    ...invite,
    status: 'active'
  });
}

export function revokeAdminInvite(state: HubState, token: string): HubResult<AdminInviteSummary> {
  const invite = state.invites.get(token);

  if (invite === undefined) {
    return hubError(404, 'admin.invite_not_found', 'Invite token was not found.');
  }

  if (invite.revokedAt === undefined) {
    invite.revokedAt = new Date().toISOString();
    invite.revokedBy = 'admin';
    appendHubAuditLog(state, {
      actor: 'admin',
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: invite.token,
      groupKey: invite.groupKey
    });
  }

  return ok({
    ...invite,
    status: getInviteStatus(invite)
  });
}

export function disableAdminMember(
  state: HubState,
  memberId: string,
  input: AdminMemberDisableInput = {}
): HubResult<AdminMemberSummary> {
  const member = state.members.get(memberId);

  if (member === undefined) {
    return hubError(404, 'admin.member_not_found', 'Member was not found.');
  }

  if (member.status !== 'disabled') {
    member.status = 'disabled';
    member.disabledAt = new Date().toISOString();

    const reason = input.reason?.trim();

    if (reason) {
      member.disabledReason = reason;
    }

    appendHubAuditLog(state, {
      actor: 'admin',
      action: 'member.disabled',
      targetType: 'member',
      targetId: member.memberId,
      groupKey: member.groupKey,
      payload: {
        reason
      }
    });
  }

  const summary: AdminMemberSummary = {
    ...member
  };
  const token = [...state.tokens.values()].find((item) => item.memberId === member.memberId);

  if (token?.expiresAt !== undefined) {
    summary.tokenExpiresAt = token.expiresAt;
  }

  return ok(summary);
}

export function listAdminAuditLogs(state: HubState, input: AdminAuditQuery = {}): { auditLogs: AdminAuditLog[] } {
  const limit = input.limit ?? 50;
  const auditLogs = state.auditLogs
    .filter((log) => input.groupKey === undefined || log.groupKey === input.groupKey)
    .filter((log) => input.action === undefined || log.action === input.action)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return {
    auditLogs
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
  status: 'active' | 'disabled';
  disabledAt?: string;
  disabledReason?: string;
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
  targetType: string;
  targetId: string;
  groupKey?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface AdminAuditQuery {
  groupKey?: string;
  action?: string;
  limit?: number;
}

export interface AdminInviteSummary {
  token: string;
  groupKey: string;
  uses: number;
  createdAt: string;
  createdBy: string;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';
  expiresAt?: string;
  maxUses?: number;
  revokedAt?: string;
  revokedBy?: string;
}

export interface AdminReviewQueueItem {
  id: string;
  title: string;
  reason: string;
  createdAt: string;
}

function createInviteToken(state: HubState): string {
  let token = '';

  do {
    token = `inv_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  } while (state.invites.has(token));

  return token;
}

function getInviteStatus(invite: HubInvite): AdminInviteSummary['status'] {
  if (invite.revokedAt !== undefined) {
    return 'revoked';
  }

  if (invite.expiresAt !== undefined && Date.parse(invite.expiresAt) <= Date.now()) {
    return 'expired';
  }

  if (invite.maxUses !== undefined && invite.uses >= invite.maxUses) {
    return 'exhausted';
  }

  return 'active';
}
