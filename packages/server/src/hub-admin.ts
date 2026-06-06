import { randomUUID } from 'node:crypto';
import type {
  CaptureKnowledgeInput,
  DevMeshCore,
  KnowledgeFilter,
  KnowledgeItem,
  KnowledgeLayer,
  SearchKnowledgeInput
} from '@mcp-dev-mesh/core';
import type { ProjectAclMember, ProjectAclRole, ProjectAclVisibility, ProjectSummary } from '@mcp-dev-mesh/protocol';
import {
  DEFAULT_GROUP_KEY,
  type HubGroup,
  type HubInvite,
  type HubKnowledgeEdge,
  type HubKnowledgeEdgeKind,
  type HubResult,
  type HubState
} from './hub-model.js';
import { appendHubAuditLog } from './hub-audit.js';
import { withNormalizedAccess } from './hub-projects.js';
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

export interface AdminProjectAclInput {
  visibility?: ProjectAclVisibility;
  members?: Array<{
    memberId?: string;
    role?: ProjectAclRole;
  }>;
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

export interface AdminGlossaryInput {
  term?: string;
  definition?: string;
  content?: string;
  groupKey?: string;
  projectKey?: string;
  aliases?: string[];
  tags?: string[];
}

export interface AdminKnowledgeEdgeInput {
  kind?: HubKnowledgeEdgeKind;
  fromId?: string;
  toId?: string;
  groupKey?: string;
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
  return [...state.projects.values()]
    .map((project) => withNormalizedAccess(project))
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.id.localeCompare(b.id));
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

    if (input.includeSuperseded !== undefined) {
      search.includeSuperseded = input.includeSuperseded;
    }

    if (input.layer !== undefined) {
      search.layers = [input.layer];
    }

    return core.searchKnowledge(search);
  }

  const filter: KnowledgeFilter = {};

  if (input.includeSuperseded !== undefined) {
    filter.includeSuperseded = input.includeSuperseded;
  }

  if (input.layer !== undefined) {
    filter.layers = [input.layer];
  }

  const items = await core.listKnowledge(filter);

  return items.slice(0, limit);
}

export function listAdminKnowledgeEdges(
  state: HubState,
  input: AdminKnowledgeEdgeQuery = {}
): HubKnowledgeEdge[] {
  const limit = input.limit ?? 50;

  return state.knowledgeEdges
    .filter((edge) => input.groupKey === undefined || edge.groupKey === input.groupKey)
    .filter((edge) => input.kind === undefined || edge.kind === input.kind)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

export async function createAdminQualityReview(
  core: DevMeshCore,
  input: AdminQualityReviewQuery = {}
): Promise<AdminQualityReviewResponse> {
  const policy = normalizeQualityReviewPolicy(input);
  const filter: KnowledgeFilter = {
    includeSuperseded: policy.includeSuperseded
  };

  if (input.layer !== undefined) {
    filter.layers = [input.layer];
  }

  const items = await core.listKnowledge(filter);
  const reviewItems = items
    .map((item) => createQualityReviewItem(item, policy))
    .filter((item): item is AdminQualityReviewItem => item !== undefined)
    .sort(compareQualityReviewItems);

  return {
    summary: createQualityReviewSummary(items, policy, reviewItems.length),
    items: reviewItems.slice(0, policy.limit)
  };
}

export async function createAdminTaskDigest(
  core: DevMeshCore,
  input: AdminTaskDigestQuery = {}
): Promise<AdminTaskDigestResponse> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const items = await core.listKnowledge({
    types: ['task'],
    includeSuperseded: input.includeSuperseded ?? true
  });
  const entries = [...groupTaskDigestEntries(items, input).values()]
    .map(createTaskDigestEntry)
    .filter((entry) => input.projectKey === undefined || entry.taskKey === input.projectKey)
    .filter((entry) => input.status === undefined || entry.status === input.status)
    .filter((entry) => input.includeDone || entry.status !== 'done')
    .sort(compareTaskDigestEntries);

  return {
    summary: createTaskDigestSummary(entries),
    entries: entries.slice(0, limit)
  };
}

export async function listAdminGlossary(
  core: DevMeshCore,
  input: AdminGlossaryQuery = {}
): Promise<KnowledgeItem[]> {
  const limit = input.limit ?? 50;
  const items = input.query?.trim()
    ? await core.searchKnowledge({
        query: input.query,
        layers: ['canonical'],
        types: ['glossary'],
        limit
      })
    : await core.listKnowledge({
        layers: ['canonical'],
        types: ['glossary']
      });

  return items.filter((item) => matchesGlossaryQuery(item, input)).slice(0, limit);
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
    return ok(withNormalizedAccess(existing));
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

  return ok(withNormalizedAccess(project));
}

export function updateAdminProjectAcl(
  state: HubState,
  groupKey: string,
  projectId: string,
  input: AdminProjectAclInput
): HubResult<ProjectSummary> {
  const project = state.projects.get(projectMapKey(groupKey, projectId));

  if (project === undefined) {
    return hubError(404, 'admin.project_not_found', 'Project was not found.');
  }

  const visibility = input.visibility ?? project.access?.visibility ?? 'group';

  if (visibility !== 'group' && visibility !== 'restricted') {
    return hubError(400, 'admin.project_acl_visibility_invalid', 'Project ACL visibility is invalid.');
  }

  const members = input.members === undefined ? project.access?.members ?? [] : normalizeAclMembers(state, groupKey, input.members);

  if (!Array.isArray(members)) {
    return members;
  }

  project.access = {
    visibility,
    members: visibility === 'restricted' ? members : []
  };

  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'project.acl.updated',
    targetType: 'project',
    targetId: project.id,
    groupKey,
    payload: {
      visibility: project.access.visibility,
      memberIds: project.access.members.map((member) => member.memberId)
    }
  });

  return ok(withNormalizedAccess(project));
}

export async function createAdminKnowledgeEdge(
  state: HubState,
  core: DevMeshCore,
  input: AdminKnowledgeEdgeInput
): Promise<HubResult<HubKnowledgeEdge>> {
  const kind = input.kind?.trim();
  const fromId = input.fromId?.trim();
  const toId = input.toId?.trim();

  if (!isKnowledgeEdgeKind(kind)) {
    return hubError(400, 'admin.knowledge_edge_kind_invalid', 'Knowledge edge kind is invalid.');
  }

  if (!fromId || !toId) {
    return hubError(400, 'admin.knowledge_edge_target_required', 'Knowledge edge fromId and toId are required.');
  }

  if (fromId === toId) {
    return hubError(400, 'admin.knowledge_edge_self_reference', 'Knowledge edge cannot reference the same item.');
  }

  const groupKey = resolveKnowledgeEdgeGroupKey(state, input.groupKey);

  if (!groupKey.ok) {
    return groupKey;
  }

  const fromItem = await core.getKnowledge(fromId);

  if (fromItem === undefined) {
    return hubError(404, 'admin.knowledge_edge_from_not_found', 'Knowledge edge source item was not found.');
  }

  const toItem = await core.getKnowledge(toId);

  if (toItem === undefined) {
    return hubError(404, 'admin.knowledge_edge_to_not_found', 'Knowledge edge target item was not found.');
  }

  const createdAt = new Date().toISOString();

  if (kind === 'supersedes') {
    await core.repository.upsert({
      ...toItem,
      status: 'superseded',
      updatedAt: createdAt
    });
  }

  const edge: HubKnowledgeEdge = {
    id: createKnowledgeEdgeId(),
    kind,
    fromId,
    toId,
    createdBy: 'admin',
    createdAt
  };
  const reason = input.reason?.trim();

  if (groupKey.value !== undefined) {
    edge.groupKey = groupKey.value;
  }

  if (reason) {
    edge.reason = reason;
  }

  state.knowledgeEdges.push(edge);
  const auditPayload = {
    actor: 'admin',
    action: 'knowledge.edge.created',
    targetType: 'knowledge-edge',
    targetId: edge.id,
    payload: {
      kind: edge.kind,
      fromId: edge.fromId,
      toId: edge.toId
    }
  };

  appendHubAuditLog(
    state,
    edge.groupKey === undefined
      ? auditPayload
      : {
          ...auditPayload,
          groupKey: edge.groupKey
        }
  );

  return ok(edge);
}

export async function createAdminGlossary(
  state: HubState,
  core: DevMeshCore,
  input: AdminGlossaryInput
): Promise<HubResult<KnowledgeItem>> {
  const term = input.term?.trim();
  const definition = input.definition?.trim();

  if (!term) {
    return hubError(400, 'admin.glossary_term_required', 'Glossary term is required.');
  }

  if (!definition) {
    return hubError(400, 'admin.glossary_definition_required', 'Glossary definition is required.');
  }

  const groupKey = resolveGlossaryGroupKey(state, input.groupKey);

  if (!groupKey.ok) {
    return groupKey;
  }

  const projectKey = normalizeOptionalString(input.projectKey);
  const capture: CaptureKnowledgeInput = {
    type: 'glossary',
    layer: 'canonical',
    title: term,
    summary: definition,
    content: input.content?.trim() || definition,
    entryKey: createGlossaryEntryKey(term, projectKey),
    para: {
      category: 'resources',
      key: projectKey === undefined ? 'glossary' : `glossary/${projectKey}`
    },
    tags: normalizeGlossaryTags(input.tags),
    source: {
      kind: 'admin',
      metadata: createGlossaryMetadata(groupKey.value, projectKey, input.aliases)
    },
    createdBy: {
      displayName: 'admin'
    },
    visibility: 'team',
    confidence: 0.85
  };
  const item = await core.captureKnowledge(capture);

  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'glossary.created',
    targetType: 'knowledge',
    targetId: item.id,
    groupKey: groupKey.value,
    payload: {
      term,
      projectKey
    }
  });

  return ok(item);
}

export async function updateAdminGlossary(
  state: HubState,
  core: DevMeshCore,
  id: string,
  input: AdminGlossaryInput
): Promise<HubResult<KnowledgeItem>> {
  const existing = await core.getKnowledge(id);

  if (existing === undefined || existing.type !== 'glossary') {
    return hubError(404, 'admin.glossary_not_found', 'Glossary item was not found.');
  }

  const term = input.term?.trim() || existing.title;
  const definition = input.definition?.trim() || existing.summary;
  const groupKey = resolveGlossaryGroupKey(state, input.groupKey ?? readGlossaryMetadata(existing, 'groupKey'));

  if (!groupKey.ok) {
    return groupKey;
  }

  const projectKey =
    input.projectKey === undefined ? readGlossaryMetadata(existing, 'projectKey') : normalizeOptionalString(input.projectKey);
  const updated: KnowledgeItem = {
    ...existing,
    title: term,
    summary: definition,
    entryKey: createGlossaryEntryKey(term, projectKey),
    para: {
      category: 'resources',
      key: projectKey === undefined ? 'glossary' : `glossary/${projectKey}`
    },
    tags: input.tags === undefined ? existing.tags : normalizeGlossaryTags(input.tags),
    source: {
      ...existing.source,
      kind: existing.source.kind || 'admin',
      metadata: {
        ...(existing.source.metadata ?? {}),
        ...createGlossaryMetadata(groupKey.value, projectKey, input.aliases ?? readGlossaryAliases(existing))
      }
    },
    updatedAt: new Date().toISOString()
  };

  if (input.content !== undefined) {
    const content = input.content.trim();

    if (content) {
      updated.content = content;
    } else {
      delete updated.content;
    }
  }

  await core.repository.upsert(updated);
  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'glossary.updated',
    targetType: 'knowledge',
    targetId: updated.id,
    groupKey: groupKey.value,
    payload: {
      term,
      projectKey
    }
  });

  return ok(updated);
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
  includeSuperseded?: boolean;
}

export interface AdminKnowledgeEdgeQuery {
  groupKey?: string;
  kind?: HubKnowledgeEdgeKind;
  limit?: number;
}

export interface AdminQualityReviewQuery {
  layer?: KnowledgeLayer;
  limit?: number;
  includeSuperseded?: boolean;
  maxQualityScore?: number;
  maxConfidence?: number;
  maxRating?: number;
  maxAdoptionScore?: number;
  staleDays?: number;
}

export interface AdminQualityReviewResponse {
  summary: AdminQualityReviewSummary;
  items: AdminQualityReviewItem[];
}

export interface AdminQualityReviewSummary {
  totalKnowledge: number;
  needsReview: number;
  lowQuality: number;
  lowConfidence: number;
  lowRating: number;
  lowAdoption: number;
  stale: number;
  nonActive: number;
}

export interface AdminQualityReviewItem {
  item: KnowledgeItem;
  reasons: string[];
  priority: 'high' | 'medium' | 'low';
  score: number;
}

export type AdminTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'unknown';

export interface AdminTaskDigestQuery {
  projectKey?: string;
  status?: AdminTaskStatus;
  limit?: number;
  includeDone?: boolean;
  includeSuperseded?: boolean;
}

export interface AdminTaskDigestResponse {
  summary: AdminTaskDigestSummary;
  entries: AdminTaskDigestEntry[];
}

export interface AdminTaskDigestSummary {
  totalTasks: number;
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  unknown: number;
}

export interface AdminTaskDigestEntry {
  taskKey: string;
  title: string;
  status: AdminTaskStatus;
  latestSummary: string;
  latestUpdatedAt: string;
  owners: string[];
  tags: string[];
  itemCount: number;
  items: KnowledgeItem[];
}

export interface AdminGlossaryQuery {
  query?: string;
  groupKey?: string;
  projectKey?: string;
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

function createKnowledgeEdgeId(): string {
  return `edge_${randomUUID().replace(/-/g, '')}`;
}

function normalizeQualityReviewPolicy(input: AdminQualityReviewQuery): Required<Omit<AdminQualityReviewQuery, 'layer'>> {
  return {
    limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
    includeSuperseded: input.includeSuperseded ?? true,
    maxQualityScore: normalizeUnitThreshold(input.maxQualityScore, 0.6),
    maxConfidence: normalizeUnitThreshold(input.maxConfidence, 0.55),
    maxRating: normalizeUnitThreshold(input.maxRating, 0.4),
    maxAdoptionScore: normalizeUnitThreshold(input.maxAdoptionScore, 0.2),
    staleDays: Math.max(input.staleDays ?? 180, 1)
  };
}

function normalizeUnitThreshold(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 0), 1);
}

function createQualityReviewSummary(
  items: KnowledgeItem[],
  policy: Required<Omit<AdminQualityReviewQuery, 'layer'>>,
  needsReview: number
): AdminQualityReviewSummary {
  return {
    totalKnowledge: items.length,
    needsReview,
    lowQuality: items.filter((item) => item.quality.qualityScore <= policy.maxQualityScore).length,
    lowConfidence: items.filter((item) => item.quality.confidence <= policy.maxConfidence).length,
    lowRating: items.filter((item) => item.quality.rating <= policy.maxRating).length,
    lowAdoption: items.filter((item) => item.quality.adoptionScore <= policy.maxAdoptionScore).length,
    stale: items.filter((item) => isKnowledgeStale(item, policy.staleDays)).length,
    nonActive: items.filter((item) => item.status !== 'active').length
  };
}

function createQualityReviewItem(
  item: KnowledgeItem,
  policy: Required<Omit<AdminQualityReviewQuery, 'layer'>>
): AdminQualityReviewItem | undefined {
  const reasons = createQualityReviewReasons(item, policy);

  if (!reasons.length) {
    return undefined;
  }

  return {
    item,
    reasons,
    priority: createQualityReviewPriority(item, reasons, policy),
    score: createQualityReviewScore(item, reasons)
  };
}

function createQualityReviewReasons(item: KnowledgeItem, policy: Required<Omit<AdminQualityReviewQuery, 'layer'>>): string[] {
  const reasons: string[] = [];

  if (item.status !== 'active') {
    reasons.push(item.status);
  }

  if (item.quality.qualityScore <= policy.maxQualityScore) {
    reasons.push('low quality');
  }

  if (item.quality.confidence <= policy.maxConfidence) {
    reasons.push('low confidence');
  }

  if (item.quality.rating <= policy.maxRating) {
    reasons.push('low rating');
  }

  if (item.quality.adoptionScore <= policy.maxAdoptionScore) {
    reasons.push('low adoption');
  }

  if (isKnowledgeStale(item, policy.staleDays)) {
    reasons.push('stale');
  }

  return reasons;
}

function createQualityReviewPriority(
  item: KnowledgeItem,
  reasons: string[],
  policy: Required<Omit<AdminQualityReviewQuery, 'layer'>>
): AdminQualityReviewItem['priority'] {
  if (
    item.status !== 'active' ||
    item.quality.qualityScore <= policy.maxQualityScore * 0.75 ||
    item.quality.rating <= policy.maxRating * 0.75
  ) {
    return 'high';
  }

  return reasons.length >= 2 ? 'medium' : 'low';
}

function createQualityReviewScore(item: KnowledgeItem, reasons: string[]): number {
  return Number((reasons.length + (1 - item.quality.qualityScore)).toFixed(4));
}

function compareQualityReviewItems(a: AdminQualityReviewItem, b: AdminQualityReviewItem): number {
  return (
    qualityPriorityRank(b.priority) - qualityPriorityRank(a.priority) ||
    b.score - a.score ||
    a.item.quality.qualityScore - b.item.quality.qualityScore ||
    a.item.updatedAt.localeCompare(b.item.updatedAt)
  );
}

function qualityPriorityRank(priority: AdminQualityReviewItem['priority']): number {
  if (priority === 'high') {
    return 3;
  }

  return priority === 'medium' ? 2 : 1;
}

function isKnowledgeStale(item: KnowledgeItem, staleDays: number): boolean {
  const updatedAt = Date.parse(item.updatedAt);

  return !Number.isNaN(updatedAt) && Date.now() - updatedAt > staleDays * 24 * 60 * 60 * 1000;
}

function groupTaskDigestEntries(
  items: KnowledgeItem[],
  input: AdminTaskDigestQuery
): Map<string, TaskDigestWorkingEntry> {
  const entries = new Map<string, TaskDigestWorkingEntry>();

  for (const item of items) {
    const taskKey = readTaskKey(item);

    if (input.projectKey !== undefined && taskKey !== input.projectKey) {
      continue;
    }

    const existing = entries.get(taskKey);

    if (existing === undefined) {
      entries.set(taskKey, {
        taskKey,
        items: [item]
      });
      continue;
    }

    existing.items.push(item);
  }

  return entries;
}

function createTaskDigestEntry(entry: TaskDigestWorkingEntry): AdminTaskDigestEntry {
  const items = entry.items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = items[0];

  if (latest === undefined) {
    throw new Error('Task digest entries require at least one knowledge item.');
  }

  const status = readTaskStatus(latest);

  return {
    taskKey: entry.taskKey,
    title: latest.title,
    status,
    latestSummary: stripTaskStatusPrefix(latest.summary),
    latestUpdatedAt: latest.updatedAt,
    owners: readTaskOwners(items),
    tags: readTaskTags(items),
    itemCount: items.length,
    items: items.slice(0, 5)
  };
}

function createTaskDigestSummary(entries: AdminTaskDigestEntry[]): AdminTaskDigestSummary {
  return {
    totalTasks: entries.length,
    todo: entries.filter((entry) => entry.status === 'todo').length,
    inProgress: entries.filter((entry) => entry.status === 'in_progress').length,
    blocked: entries.filter((entry) => entry.status === 'blocked').length,
    done: entries.filter((entry) => entry.status === 'done').length,
    unknown: entries.filter((entry) => entry.status === 'unknown').length
  };
}

function compareTaskDigestEntries(a: AdminTaskDigestEntry, b: AdminTaskDigestEntry): number {
  return (
    taskStatusRank(b.status) - taskStatusRank(a.status) ||
    b.latestUpdatedAt.localeCompare(a.latestUpdatedAt) ||
    a.taskKey.localeCompare(b.taskKey)
  );
}

function taskStatusRank(status: AdminTaskStatus): number {
  if (status === 'blocked') {
    return 5;
  }

  if (status === 'in_progress') {
    return 4;
  }

  if (status === 'todo') {
    return 3;
  }

  return status === 'unknown' ? 2 : 1;
}

function readTaskKey(item: KnowledgeItem): string {
  const metadataTaskKey = readMetadataStringValue(item, 'taskKey');

  if (metadataTaskKey !== undefined) {
    return metadataTaskKey;
  }

  if (item.para.category === 'projects') {
    return item.para.key;
  }

  return 'current';
}

function readTaskStatus(item: KnowledgeItem): AdminTaskStatus {
  const metadataStatus = readMetadataStringValue(item, 'status') ?? readMetadataStringValue(item, 'taskStatus');

  if (isTaskStatus(metadataStatus)) {
    return metadataStatus;
  }

  const match = /^\[([^\]]+)\]\s*/.exec(item.summary.trim());
  const summaryStatus = match?.[1];

  return isTaskStatus(summaryStatus) ? summaryStatus : 'unknown';
}

function stripTaskStatusPrefix(summary: string): string {
  return summary.replace(/^\[[^\]]+\]\s*/, '');
}

function readTaskOwners(items: KnowledgeItem[]): string[] {
  return [
    ...new Set(
      items
        .map((item) => item.createdBy.displayName.trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));
}

function readTaskTags(items: KnowledgeItem[]): string[] {
  return [
    ...new Set(
      items
        .flatMap((item) => item.tags)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));
}

function readMetadataStringValue(item: KnowledgeItem, key: string): string | undefined {
  const value = item.source.metadata?.[key];

  return typeof value === 'string' ? value : undefined;
}

function isTaskStatus(value: string | undefined): value is AdminTaskStatus {
  return value === 'todo' || value === 'in_progress' || value === 'blocked' || value === 'done' || value === 'unknown';
}

interface TaskDigestWorkingEntry {
  taskKey: string;
  items: KnowledgeItem[];
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

function normalizeAclMembers(
  state: HubState,
  groupKey: string,
  members: NonNullable<AdminProjectAclInput['members']>
): ProjectAclMember[] | HubResult<never> {
  const normalized = new Map<string, ProjectAclMember>();

  for (const member of members) {
    const memberId = member.memberId?.trim();

    if (!memberId) {
      return hubError(400, 'admin.project_acl_member_required', 'ACL memberId is required.');
    }

    const existingMember = state.members.get(memberId);

    if (existingMember === undefined || existingMember.groupKey !== groupKey) {
      return hubError(404, 'admin.project_acl_member_not_found', 'ACL member must belong to the project group.');
    }

    const role = member.role ?? 'member';

    if (!isProjectAclRole(role)) {
      return hubError(400, 'admin.project_acl_role_invalid', 'ACL member role is invalid.');
    }

    normalized.set(memberId, {
      memberId,
      role
    });
  }

  return [...normalized.values()].sort((a, b) => a.memberId.localeCompare(b.memberId));
}

function isProjectAclRole(value: string): value is ProjectAclRole {
  return value === 'owner' || value === 'maintainer' || value === 'member' || value === 'readonly';
}

function isKnowledgeEdgeKind(value: string | undefined): value is HubKnowledgeEdgeKind {
  return value === 'supersedes' || value === 'duplicates' || value === 'contradicts';
}

function resolveGlossaryGroupKey(state: HubState, input: string | undefined): HubResult<string> {
  const fallbackGroup = state.groups.has(DEFAULT_GROUP_KEY) ? DEFAULT_GROUP_KEY : state.groups.keys().next().value;
  const groupKey = input?.trim() || fallbackGroup;

  if (groupKey === undefined || !state.groups.has(groupKey)) {
    return hubError(404, 'admin.group_not_found', 'The target group does not exist.');
  }

  return ok(groupKey);
}

function resolveKnowledgeEdgeGroupKey(state: HubState, input: string | undefined): HubResult<string | undefined> {
  const groupKey = normalizeOptionalString(input);

  if (groupKey !== undefined && !state.groups.has(groupKey)) {
    return hubError(404, 'admin.group_not_found', 'The target group does not exist.');
  }

  return ok(groupKey);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function normalizeGlossaryTags(tags: string[] | undefined): string[] {
  return [...new Set(['glossary', ...(tags ?? []).map((tag) => tag.trim()).filter(Boolean)])];
}

function createGlossaryEntryKey(term: string, projectKey: string | undefined): string {
  const scope = slugHandle(projectKey ?? 'team') || 'team';
  const slug = slugHandle(term) || 'term';

  return `resources/glossary/${scope}/${slug}`;
}

function createGlossaryMetadata(
  groupKey: string,
  projectKey: string | undefined,
  aliases: string[] | undefined
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    groupKey
  };
  const normalizedAliases = aliases?.map((alias) => alias.trim()).filter(Boolean);

  if (projectKey !== undefined) {
    metadata.projectKey = projectKey;
  }

  if (normalizedAliases !== undefined) {
    metadata.aliases = [...new Set(normalizedAliases)];
  }

  return metadata;
}

function matchesGlossaryQuery(item: KnowledgeItem, input: AdminGlossaryQuery): boolean {
  const groupKey = readGlossaryMetadata(item, 'groupKey');
  const projectKey = readGlossaryMetadata(item, 'projectKey');

  if (input.groupKey !== undefined && groupKey !== input.groupKey) {
    return false;
  }

  if (input.projectKey !== undefined && projectKey !== input.projectKey) {
    return false;
  }

  return true;
}

function readGlossaryMetadata(item: KnowledgeItem, key: string): string | undefined {
  const value = item.source.metadata?.[key];

  return typeof value === 'string' ? value : undefined;
}

function readGlossaryAliases(item: KnowledgeItem): string[] | undefined {
  const aliases = item.source.metadata?.aliases;

  return Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === 'string') : undefined;
}
