import { randomUUID } from 'node:crypto';
import type {
  CaptureKnowledgeInput,
  DevMeshCore,
  KnowledgeFilter,
  KnowledgeItem,
  KnowledgeLayer,
  SearchKnowledgeInput
} from '@devmesh/core';
import type { JoinResponse, ProjectAclMember, ProjectAclRole, ProjectAclVisibility, ProjectSummary } from '@devmesh/protocol';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import {
  ACCESS_TOKEN_TTL_MS,
  DEFAULT_ADMIN_INVITE_TTL_MS,
  DEFAULT_GROUP_KEY,
  type HubCrdtChange,
  type HubCrdtDocument,
  type HubGlobalProjection,
  type HubGlobalProjectionDocument,
  type HubBranch,
  type HubInvite,
  type HubKnowledgeEdge,
  type HubKnowledgeEdgeKind,
  type HubResult,
  type HubState
} from './hub-model.js';
import { appendHubAuditLog } from './hub-audit.js';
import { appendAdminGlobalCrdtOperation } from './hub-global-crdt.js';
import { filterKnowledgeByGroup, knowledgeBelongsToGroup, readKnowledgeMetadataString } from './hub-knowledge-scope.js';
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

export interface AdminBranchSummary {
  branchKey: string;
  branch: string;
  displayName: string;
  joinMode: HubBranch['joinMode'];
  description?: string;
  counts: {
    members: number;
    projects: number;
    crdtDocuments: number;
    knowledge: number;
    relations: number;
    qualitySignals: number;
    conflicts: number;
  };
  projects: ProjectSummary[];
  updatedAt?: string;
}

export interface AdminBranchInput extends AdminGroupInput {
  branchKey?: string;
}

export interface AdminProjectInput {
  branchKey?: string;
  branch?: string;
  id?: string;
  projectKey?: string;
  name?: string;
  description?: string;
}

export interface AdminProjectBranchInput {
  branchKey?: string;
  branch?: string;
}

export interface AdminProjectAclInput {
  visibility?: ProjectAclVisibility;
  members?: Array<{
    memberId?: string;
    role?: ProjectAclRole;
  }>;
}

export interface AdminInviteInput {
  branchKey?: string;
  branch?: string;
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
  branchKey?: string;
  branch?: string;
  projectKey?: string;
  aliases?: string[];
  tags?: string[];
}

export interface AdminKnowledgeEdgeInput {
  kind?: HubKnowledgeEdgeKind;
  fromId?: string;
  toId?: string;
  branchKey?: string;
  branch?: string;
  reason?: string;
}

export interface AdminKnowledgeEdgeSummary extends HubKnowledgeEdge {
  branchKey?: string;
}

export interface AdminKnowledgeBranchPublishInput {
  sourceId?: string;
  targetBranchKey?: string;
  targetBranchKey?: string;
  reason?: string;
}

export interface AdminKnowledgeBranchBulkPublishInput {
  sourceBranchKey?: string;
  sourceGroupKey?: string;
  targetBranchKey?: string;
  targetBranchKey?: string;
  sourceIds?: string[];
  reason?: string;
}

export interface AdminKnowledgeBranchBulkPublishResult {
  published: KnowledgeItem[];
  rejected: Array<{
    sourceId: string;
    code: string;
    reason: string;
  }>;
}

export interface AdminBranchMergePreviewInput {
  sourceBranchKey?: string;
  sourceGroupKey?: string;
  targetBranchKey?: string;
  targetBranchKey?: string;
  limit?: number;
}

export interface AdminBranchMergePreview {
  sourceBranchKey: string;
  targetBranchKey: string;
  summary: {
    sourceKnowledge: number;
    targetKnowledge: number;
    publishable: number;
    alreadyPublished: number;
    possibleConflicts: number;
  };
  items: AdminBranchMergePreviewItem[];
}

export interface AdminBranchMergePreviewItem {
  source: KnowledgeItem;
  status: 'publishable' | 'already_published' | 'possible_conflict';
  target?: KnowledgeItem;
  reason: string;
}

export interface AdminCrdtDocumentQuery {
  kind?: string;
  branchKey?: string;
  branch?: string;
  projectKey?: string;
}

export interface AdminCrdtDocumentSummary {
  key: string;
  document: HubCrdtDocument['document'];
  kind: string;
  updatedAt: string;
  heads: string[];
  changeCount: number;
  snapshotPresent: boolean;
  branchKey?: string;
  branch?: string;
  projectKey?: string;
  documentId?: string;
  namespace?: string;
  schemaVersion?: number;
  latestChange?: AdminCrdtChangeSummary;
}

export interface AdminCrdtChangeSummary {
  id: string;
  receivedAt: string;
  clientId: string;
  branchKey: string;
  branch: string;
  actorId?: string;
  createdAt?: string;
  summary?: string;
}

export async function createAdminOverview(
  state: HubState,
  core: DevMeshCore,
  baseUrl: string
): Promise<AdminOverview> {
  const knowledgeItems = await core.listKnowledge({});

  return {
    service: 'devmesh',
    version: DEV_MESH_VERSION,
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
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.displayName.localeCompare(b.displayName));
}

export function listAdminProjects(state: HubState): ProjectSummary[] {
  return [...state.projects.values()]
    .map((project) => withAdminProjectBranchKey(withNormalizedAccess(project)))
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.id.localeCompare(b.id));
}

export function listAdminBranches(state: HubState): AdminBranchSummary[] {
  return [...state.groups.values()]
    .map((group) => createAdminBranchSummary(state, group))
    .sort((a, b) => a.branchKey.localeCompare(b.branchKey));
}

export function createAdminBranch(state: HubState, input: AdminBranchInput): HubResult<AdminBranchSummary> {
  const requestedKey = slugHandle(input.branchKey ?? input.key ?? input.displayName ?? '');
  const existing = requestedKey ? state.groups.get(requestedKey) : undefined;
  const groupInput: AdminGroupInput = {};
  const branch = input.branchKey ?? input.key;

  if (branch !== undefined) {
    groupInput.key = branch;
  }

  if (input.displayName !== undefined) {
    groupInput.displayName = input.displayName;
  }

  if (input.description !== undefined) {
    groupInput.description = input.description;
  }

  if (input.joinMode !== undefined) {
    groupInput.joinMode = input.joinMode;
  }

  const result = createAdminGroup(state, groupInput);

  if (!result.ok) {
    return result;
  }

  appendAdminGlobalCrdtOperation(state, {
    action: existing === undefined ? 'branch.created' : 'branch.updated',
    targetType: 'branch',
    targetId: result.value.key,
    branch: result.value.key,
    payload: {
      branchKey: result.value.key,
      displayName: result.value.displayName,
      joinMode: result.value.joinMode,
      description: result.value.description
    }
  });

  return ok(createAdminBranchSummary(state, result.value));
}

export async function createAdminBranchMergePreview(
  state: HubState,
  core: DevMeshCore,
  input: AdminBranchMergePreviewInput
): Promise<HubResult<AdminBranchMergePreview>> {
  const sourceBranchKey = (input.sourceBranchKey ?? input.sourceGroupKey)?.trim();
  const targetBranchKey = (input.targetBranchKey ?? input.targetBranchKey)?.trim();

  if (!sourceBranchKey || !targetBranchKey) {
    return hubError(400, 'admin.branch_merge_target_required', 'Source and target branch keys are required.');
  }

  if (!state.groups.has(sourceBranchKey)) {
    return hubError(404, 'admin.source_branch_not_found', 'The source branch/group does not exist.');
  }

  if (!state.groups.has(targetBranchKey)) {
    return hubError(404, 'admin.target_branch_not_found', 'The target branch/group does not exist.');
  }

  if (sourceBranchKey === targetBranchKey) {
    return hubError(409, 'admin.branch_merge_same_branch', 'Source and target branch must be different.');
  }

  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const allKnowledge = await core.listKnowledge({
    includeSuperseded: false
  });
  const sourceItems = filterKnowledgeByBranchKey(allKnowledge, sourceBranchKey)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const targetItems = filterKnowledgeByBranchKey(allKnowledge, targetBranchKey);
  const targetByPublishedSource = new Map<string, KnowledgeItem>();
  const targetByEntryKey = new Map<string, KnowledgeItem>();
  const targetByTitle = new Map<string, KnowledgeItem>();

  for (const target of targetItems) {
    const publishedFromId = readKnowledgeMetadataString(target, 'publishedFromId');

    if (publishedFromId !== undefined) {
      targetByPublishedSource.set(publishedFromId, target);
    }

    targetByEntryKey.set(target.entryKey, target);
    targetByTitle.set(normalizeMergeTitle(target.title), target);
  }

  const items = sourceItems.slice(0, limit).map((source) =>
    createBranchMergePreviewItem(source, {
      targetByPublishedSource,
      targetByEntryKey,
      targetByTitle
    })
  );

  return ok({
    sourceBranchKey,
    targetBranchKey,
    summary: {
      sourceKnowledge: sourceItems.length,
      targetKnowledge: targetItems.length,
      publishable: items.filter((item) => item.status === 'publishable').length,
      alreadyPublished: items.filter((item) => item.status === 'already_published').length,
      possibleConflicts: items.filter((item) => item.status === 'possible_conflict').length
    },
    items
  });
}

function createAdminBranchSummary(state: HubState, group: HubBranch): AdminBranchSummary {
  const projects = [...state.projects.values()]
    .filter((project) => project.branch === group.key)
    .map((project) => withNormalizedAccess(project))
    .sort((a, b) => a.id.localeCompare(b.id));
  const documents = Object.values(state.globalProjection.documents).filter((document) => document.branch === group.key);
  const updatedAt = documents
    .map((document) => document.materializedAt)
    .sort((a, b) => b.localeCompare(a))[0];
  const summary: AdminBranchSummary = {
    branchKey: group.key,
    branch: group.key,
    displayName: group.displayName,
    joinMode: group.joinMode,
    counts: {
      members: [...state.members.values()].filter((member) => member.branch === group.key).length,
      projects: projects.length,
      crdtDocuments: documents.length,
      knowledge: documents.reduce((total, document) => total + document.knowledgeIds.length, 0),
      relations: documents.reduce((total, document) => total + document.relationIds.length, 0),
      qualitySignals: documents.reduce((total, document) => total + document.qualitySignalIds.length, 0),
      conflicts: documents.reduce((total, document) => total + document.conflictIds.length, 0)
    },
    projects
  };

  if (group.description !== undefined) {
    summary.description = group.description;
  }

  if (updatedAt !== undefined) {
    summary.updatedAt = updatedAt;
  }

  return summary;
}

function createBranchMergePreviewItem(
  source: KnowledgeItem,
  targetIndexes: {
    targetByPublishedSource: Map<string, KnowledgeItem>;
    targetByEntryKey: Map<string, KnowledgeItem>;
    targetByTitle: Map<string, KnowledgeItem>;
  }
): AdminBranchMergePreviewItem {
  const publishedTarget = targetIndexes.targetByPublishedSource.get(source.id);

  if (publishedTarget !== undefined) {
    return {
      source,
      target: publishedTarget,
      status: 'already_published',
      reason: 'target branch already has a published copy of this source'
    };
  }

  const entryKeyTarget = targetIndexes.targetByEntryKey.get(source.entryKey);

  if (entryKeyTarget !== undefined) {
    return {
      source,
      target: entryKeyTarget,
      status: 'possible_conflict',
      reason: 'target branch already has knowledge with the same entryKey'
    };
  }

  const titleTarget = targetIndexes.targetByTitle.get(normalizeMergeTitle(source.title));

  if (titleTarget !== undefined) {
    return {
      source,
      target: titleTarget,
      status: 'possible_conflict',
      reason: 'target branch already has knowledge with the same title'
    };
  }

  return {
    source,
    status: 'publishable',
    reason: 'no matching target knowledge found'
  };
}

function normalizeMergeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function filterKnowledgeByBranchKey(items: KnowledgeItem[], branchKey: string): KnowledgeItem[] {
  return items.filter(
    (item) => (readKnowledgeMetadataString(item, 'branchKey') ?? readKnowledgeMetadataString(item, 'branch') ?? DEFAULT_GROUP_KEY) === branchKey
  );
}

export function listAdminInvites(state: HubState): AdminInviteSummary[] {
  return [...state.invites.values()]
    .map((invite) => ({
      ...invite,
      branchKey: invite.branch,
      status: getInviteStatus(invite)
    }))
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.createdAt.localeCompare(b.createdAt));
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

    return filterKnowledgeByGroup(await core.searchKnowledge(search), readAdminBranchFilter(input)).slice(0, limit);
  }

  const filter: KnowledgeFilter = {};

  if (input.includeSuperseded !== undefined) {
    filter.includeSuperseded = input.includeSuperseded;
  }

  if (input.layer !== undefined) {
    filter.layers = [input.layer];
  }

  const items = filterKnowledgeByGroup(await core.listKnowledge(filter), readAdminBranchFilter(input));

  return items.slice(0, limit);
}

export function listAdminKnowledgeEdges(
  state: HubState,
  input: AdminKnowledgeEdgeQuery = {}
): AdminKnowledgeEdgeSummary[] {
  const limit = input.limit ?? 50;
  const branchKey = readAdminBranchFilter(input);

  return state.knowledgeEdges
    .filter((edge) => branchKey === undefined || edge.branch === branchKey)
    .filter((edge) => input.kind === undefined || edge.kind === input.kind)
    .map((edge) => withKnowledgeEdgeBranchKey(edge))
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

  const items = filterKnowledgeByGroup(await core.listKnowledge(filter), readAdminBranchFilter(input));
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
  const items = filterKnowledgeByGroup(await core.listKnowledge({
    types: ['task'],
    includeSuperseded: input.includeSuperseded ?? true
  }), readAdminBranchFilter(input));
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

  return filterKnowledgeByGroup(items, readAdminBranchFilter(input)).filter((item) => matchesGlossaryQuery(item, input)).slice(0, limit);
}

export function createAdminGroup(state: HubState, input: AdminGroupInput): HubResult<HubBranch> {
  const key = slugHandle(input.key ?? input.displayName ?? '');

  if (!key) {
    return hubError(400, 'admin.group_key_required', 'A group key or displayName is required.');
  }

  const existing = state.groups.get(key);
  const group: HubBranch = {
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
    targetType: 'branch',
    targetId: key,
    branch: key,
    payload: {
      displayName: group.displayName,
      joinMode: group.joinMode
    }
  });

  return ok(group);
}

export function createAdminProject(state: HubState, input: AdminProjectInput): HubResult<ProjectSummary> {
  const branch = readInputBranchKey(input);

  if (!branch || !state.groups.has(branch)) {
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

  const key = projectMapKey(branch, id);
  const existing = state.projects.get(key);

  if (existing !== undefined) {
    return ok(withAdminProjectBranchKey(withNormalizedAccess(existing)));
  }

  const project: ProjectSummary = {
    id,
    projectKey: input.projectKey?.trim() || id,
    branch,
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
    branch,
    payload: {
      projectKey: project.projectKey,
      name: project.name
    }
  });

  return ok(withAdminProjectBranchKey(withNormalizedAccess(project)));
}

export function checkoutAdminProjectBranch(
  state: HubState,
  sourceGroupKey: string,
  projectId: string,
  input: AdminProjectBranchInput
): HubResult<ProjectSummary> {
  const project = state.projects.get(projectMapKey(sourceGroupKey, projectId));

  if (project === undefined) {
    return hubError(404, 'admin.project_not_found', 'Project was not found.');
  }

  const targetBranchKey = (input.branchKey ?? input.branch)?.trim();

  if (!targetBranchKey) {
    return hubError(400, 'admin.project_branch_required', 'A target branchKey or branch is required.');
  }

  if (!state.groups.has(targetBranchKey)) {
    return hubError(404, 'admin.group_not_found', 'The target branch/group does not exist.');
  }

  if (targetBranchKey === sourceGroupKey) {
    return ok(withNormalizedAccess(project));
  }

  const targetKey = projectMapKey(targetBranchKey, project.id);

  if (state.projects.has(targetKey)) {
    return hubError(409, 'admin.project_branch_conflict', 'A project with the same id already exists in the target branch.');
  }

  const previousAccess = project.access ?? {
    visibility: 'branch' as const,
    members: []
  };
  const moved: ProjectSummary = {
    ...project,
    branch: targetBranchKey
  };

  if (previousAccess.visibility === 'restricted') {
    moved.access = {
      visibility: 'branch',
      members: []
    };
  }

  state.projects.delete(projectMapKey(sourceGroupKey, project.id));
  state.projects.set(targetKey, moved);
  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'project.branch.checked_out',
    targetType: 'project',
    targetId: moved.id,
    branch: targetBranchKey,
    payload: {
      projectKey: moved.projectKey,
      fromBranch: sourceGroupKey,
      toBranch: targetBranchKey,
      resetRestrictedAcl: previousAccess.visibility === 'restricted'
    }
  });
  appendAdminGlobalCrdtOperation(state, {
    action: 'project.branch.checked_out',
    targetType: 'project',
    targetId: moved.id,
    branch: targetBranchKey,
    payload: {
      projectKey: moved.projectKey,
      fromBranch: sourceGroupKey,
      toBranch: targetBranchKey,
      resetRestrictedAcl: previousAccess.visibility === 'restricted'
    }
  });

  return ok(withAdminProjectBranchKey(withNormalizedAccess(moved)));
}

export function updateAdminProjectAcl(
  state: HubState,
  branch: string,
  projectId: string,
  input: AdminProjectAclInput
): HubResult<ProjectSummary> {
  const project = state.projects.get(projectMapKey(branch, projectId));

  if (project === undefined) {
    return hubError(404, 'admin.project_not_found', 'Project was not found.');
  }

  const visibility = input.visibility ?? project.access?.visibility ?? 'branch';

  if (visibility !== 'branch' && visibility !== 'restricted') {
    return hubError(400, 'admin.project_acl_visibility_invalid', 'Project ACL visibility is invalid.');
  }

  const members = input.members === undefined ? project.access?.members ?? [] : normalizeAclMembers(state, branch, input.members);

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
    branch,
    payload: {
      visibility: project.access.visibility,
      memberIds: project.access.members.map((member) => member.memberId)
    }
  });

  return ok(withAdminProjectBranchKey(withNormalizedAccess(project)));
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

  const branch = resolveKnowledgeEdgeGroupKey(state, readInputBranchKey(input));

  if (!branch.ok) {
    return branch;
  }

  const fromItem = await core.getKnowledge(fromId);

  if (fromItem === undefined || !knowledgeBelongsToGroup(fromItem, branch.value)) {
    return hubError(404, 'admin.knowledge_edge_from_not_found', 'Knowledge edge source item was not found.');
  }

  const toItem = await core.getKnowledge(toId);

  if (toItem === undefined || !knowledgeBelongsToGroup(toItem, branch.value)) {
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

  if (branch.value !== undefined) {
    edge.branch = branch.value;
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
    edge.branch === undefined
      ? auditPayload
      : {
          ...auditPayload,
          branch: edge.branch
        }
  );

  return ok(withKnowledgeEdgeBranchKey(edge));
}

export async function publishAdminKnowledgeToBranch(
  state: HubState,
  core: DevMeshCore,
  input: AdminKnowledgeBranchPublishInput
): Promise<HubResult<KnowledgeItem>> {
  const sourceId = input.sourceId?.trim();

  if (!sourceId) {
    return hubError(400, 'admin.knowledge_publish_source_required', 'A source knowledge id is required.');
  }

  const targetBranchKey = (input.targetBranchKey ?? input.targetBranchKey)?.trim();

  if (!targetBranchKey) {
    return hubError(400, 'admin.knowledge_publish_target_required', 'A target branchKey or branch is required.');
  }

  if (!state.groups.has(targetBranchKey)) {
    return hubError(404, 'admin.group_not_found', 'The target branch/group does not exist.');
  }

  const source = await core.getKnowledge(sourceId);

  if (source === undefined) {
    return hubError(404, 'admin.knowledge_not_found', 'Source knowledge was not found.');
  }

  const sourceGroupKey = readKnowledgeMetadataString(source, 'branch') ?? DEFAULT_GROUP_KEY;

  if (sourceGroupKey === targetBranchKey) {
    return hubError(409, 'admin.knowledge_publish_same_branch', 'Source knowledge is already in the target branch.');
  }

  return ok(await publishKnowledgeItemToBranch(state, core, source, sourceGroupKey, targetBranchKey, input.reason, 'single'));
}

export async function publishAdminKnowledgeBatchToBranch(
  state: HubState,
  core: DevMeshCore,
  input: AdminKnowledgeBranchBulkPublishInput
): Promise<HubResult<AdminKnowledgeBranchBulkPublishResult>> {
  const sourceBranchKey = (input.sourceBranchKey ?? input.sourceGroupKey)?.trim();
  const targetBranchKey = (input.targetBranchKey ?? input.targetBranchKey)?.trim();

  if (!sourceBranchKey || !targetBranchKey) {
    return hubError(400, 'admin.branch_publish_target_required', 'Source and target branch keys are required.');
  }

  const sourceIds = normalizeSourceIds(input.sourceIds);

  if (sourceIds.length === 0) {
    return hubError(400, 'admin.branch_publish_source_ids_required', 'At least one source knowledge id is required.');
  }

  if (sourceIds.length > 500) {
    return hubError(400, 'admin.branch_publish_source_ids_too_many', 'At most 500 source knowledge ids can be published at once.');
  }

  const preview = await createAdminBranchMergePreview(state, core, {
    sourceBranchKey,
    targetBranchKey,
    limit: 500
  });

  if (!preview.ok) {
    return preview;
  }

  const previewBySourceId = new Map(preview.value.items.map((item) => [item.source.id, item]));
  const published: KnowledgeItem[] = [];
  const rejected: AdminKnowledgeBranchBulkPublishResult['rejected'] = [];

  for (const sourceId of sourceIds) {
    const item = previewBySourceId.get(sourceId);

    if (item === undefined) {
      rejected.push({
        sourceId,
        code: 'source_not_publishable',
        reason: 'source knowledge is missing or is not in the source branch preview'
      });
      continue;
    }

    if (item.status !== 'publishable') {
      rejected.push({
        sourceId,
        code: item.status,
        reason: item.reason
      });
      continue;
    }

    published.push(await publishKnowledgeItemToBranch(state, core, item.source, sourceBranchKey, targetBranchKey, input.reason, 'bulk'));
  }

  return ok({
    published,
    rejected
  });
}

async function publishKnowledgeItemToBranch(
  state: HubState,
  core: DevMeshCore,
  source: KnowledgeItem,
  sourceGroupKey: string,
  targetBranchKey: string,
  reasonInput: string | undefined,
  publishMode: 'single' | 'bulk'
): Promise<KnowledgeItem> {
  const reason = reasonInput?.trim();
  const capture: CaptureKnowledgeInput = {
    layer: source.layer,
    type: source.type,
    title: source.title,
    summary: source.summary,
    para: source.para,
    tags: [...new Set([...source.tags, 'branch-published'])],
    source: {
      ...source.source,
      kind: 'admin-branch-publish',
      metadata: {
        ...(source.source.metadata ?? {}),
        branchKey: targetBranchKey,
        branch: targetBranchKey,
        publishedFromId: source.id,
        publishedFromBranch: sourceGroupKey,
        publishedFromKind: source.source.kind,
        publishedBy: 'admin',
        ...(reason ? { publishedReason: reason } : {})
      }
    },
    createdBy: {
      ...source.createdBy,
      displayName: source.createdBy.displayName || 'admin'
    },
    visibility: source.visibility,
    confidence: source.quality.confidence,
    weight: source.quality.weight
  };

  if (source.content !== undefined) {
    capture.content = source.content;
  }

  const published = await core.captureKnowledge(capture);

  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'knowledge.branch.published',
    targetType: 'knowledge',
    targetId: published.id,
    branch: targetBranchKey,
    payload: {
      sourceId: source.id,
      sourceBranch: sourceGroupKey,
      targetBranch: targetBranchKey,
      ...(reason ? { reason } : {})
    }
  });
  appendAdminGlobalCrdtOperation(state, {
    action: 'knowledge.branch.published',
    targetType: 'knowledge',
    targetId: published.id,
    branch: targetBranchKey,
    payload: {
      sourceId: source.id,
      sourceBranch: sourceGroupKey,
      targetBranch: targetBranchKey,
      mode: publishMode,
      ...(reason ? { reason } : {})
    }
  });

  return published;
}

function normalizeSourceIds(sourceIds: string[] | undefined): string[] {
  if (!Array.isArray(sourceIds)) {
    return [];
  }

  return [...new Set(sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean))];
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

  const branch = resolveGlossaryGroupKey(state, readInputBranchKey(input));

  if (!branch.ok) {
    return branch;
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
      metadata: createGlossaryMetadata(branch.value, projectKey, input.aliases)
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
    branch: branch.value,
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
  const branch = resolveGlossaryGroupKey(state, readInputBranchKey(input) ?? readGlossaryMetadata(existing, 'branchKey') ?? readGlossaryMetadata(existing, 'branch'));

  if (!branch.ok) {
    return branch;
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
        ...createGlossaryMetadata(branch.value, projectKey, input.aliases ?? readGlossaryAliases(existing))
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
    branch: branch.value,
    payload: {
      term,
      projectKey
    }
  });

  return ok(updated);
}

export function createAdminInvite(state: HubState, input: AdminInviteInput): HubResult<AdminInviteSummary> {
  const branch = readInputBranchKey(input);

  if (!branch || !state.groups.has(branch)) {
    return hubError(404, 'admin.group_not_found', 'The target group does not exist.');
  }

  const token = input.token?.trim() || createInviteToken(state);

  if (!token) {
    return hubError(400, 'admin.invite_token_required', 'Invite token could not be derived.');
  }

  if (state.invites.has(token)) {
    return hubError(409, 'admin.invite_token_exists', 'Invite token already exists.');
  }

  const createdAt = new Date();
  const invite: HubInvite = {
    token,
    branch,
    uses: 0,
    createdAt: createdAt.toISOString(),
    createdBy: 'admin'
  };

  if (input.expiresAt !== undefined) {
    const expiresAt = input.expiresAt.trim();

    if (!Number.isFinite(Date.parse(expiresAt))) {
      return hubError(400, 'admin.invite_expires_at_invalid', 'expiresAt must be an ISO timestamp.');
    }

    invite.expiresAt = expiresAt;
  } else {
    invite.expiresAt = new Date(createdAt.getTime() + DEFAULT_ADMIN_INVITE_TTL_MS).toISOString();
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
    branch,
    payload: {
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses
    }
  });

  return ok({
    ...invite,
    branchKey: invite.branch,
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
      branch: invite.branch
    });
  }

  return ok({
    ...invite,
    branchKey: invite.branch,
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
      branch: member.branch,
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

export function rotateAdminMemberAccessToken(state: HubState, memberId: string): HubResult<JoinResponse> {
  const member = state.members.get(memberId);

  if (member === undefined) {
    return hubError(404, 'admin.member_not_found', 'Member was not found.');
  }

  if (member.status === 'disabled') {
    return hubError(403, 'admin.member_disabled', 'Disabled members cannot receive rotated access tokens.');
  }

  const previousTokens = [...state.tokens.values()].filter((token) => token.memberId === member.memberId);
  const previousToken = previousTokens.find((token) => token.clientId === member.clientId) ?? previousTokens[0];

  if (previousToken === undefined) {
    return hubError(404, 'admin.member_token_not_found', 'Member does not have an access token to rotate.');
  }

  const accessToken = createAccessToken();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();

  for (const token of previousTokens) {
    state.tokens.delete(token.token);
  }

  state.tokens.set(accessToken, {
    token: accessToken,
    memberId: member.memberId,
    clientId: member.clientId,
    branch: member.branch,
    syncSigningSecret: previousToken.syncSigningSecret,
    expiresAt
  });
  appendHubAuditLog(state, {
    actor: 'admin',
    action: 'auth.token_rotated',
    targetType: 'member',
    targetId: member.memberId,
    branch: member.branch,
    payload: {
      clientId: member.clientId,
      previousExpiresAt: previousToken.expiresAt,
      expiresAt,
      revokedTokenCount: previousTokens.length
    }
  });

  return ok({
    memberId: member.memberId,
    clientId: member.clientId,
    branch: member.branch,
    accessToken,
    syncSigningSecret: previousToken.syncSigningSecret,
    expiresAt
  });
}

export function listAdminAuditLogs(state: HubState, input: AdminAuditQuery = {}): { auditLogs: AdminAuditLog[] } {
  const limit = input.limit ?? 50;
  const branchKey = readAdminBranchFilter(input);
  const auditLogs = state.auditLogs
    .filter((log) => branchKey === undefined || log.branch === branchKey)
    .filter((log) => input.action === undefined || log.action === input.action)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((log) => withAdminAuditBranchKey(log))
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

export function getAdminGlobalProjection(state: HubState, input: AdminGlobalProjectionQuery = {}): HubGlobalProjection {
  return filterGlobalProjection(state.globalProjection, input);
}

export function listAdminCrdtDocuments(
  state: HubState,
  input: AdminCrdtDocumentQuery = {}
): { documents: AdminCrdtDocumentSummary[] } {
  const branchKey = readAdminBranchFilter(input);
  const documents = [...state.crdtDocuments.values()]
    .filter((document) => input.kind === undefined || document.document.kind === input.kind)
    .filter((document) => branchKey === undefined || document.document.branch === branchKey)
    .filter((document) => input.projectKey === undefined || document.document.projectKey === input.projectKey)
    .map(createAdminCrdtDocumentSummary)
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.kind.localeCompare(right.kind) ||
        left.key.localeCompare(right.key)
    );

  return {
    documents
  };
}

export interface AdminMemberSummary {
  memberId: string;
  clientId: string;
  branch: string;
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
  branchKey?: string;
  branch?: string;
  layer?: KnowledgeLayer;
  limit?: number;
  includeSuperseded?: boolean;
}

export interface AdminKnowledgeEdgeQuery {
  branchKey?: string;
  branch?: string;
  kind?: HubKnowledgeEdgeKind;
  limit?: number;
}

export interface AdminQualityReviewQuery {
  branchKey?: string;
  branch?: string;
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

type QualityReviewPolicy = Required<Omit<AdminQualityReviewQuery, 'branchKey' | 'branch' | 'layer'>>;

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
  branchKey?: string;
  branch?: string;
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
  branchKey?: string;
  branch?: string;
  projectKey?: string;
  limit?: number;
}

export interface AdminAuditLog {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  branchKey?: string;
  branch?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface AdminAuditQuery {
  branchKey?: string;
  branch?: string;
  action?: string;
  limit?: number;
}

export interface AdminGlobalProjectionQuery {
  branchKey?: string;
  branch?: string;
  projectKey?: string;
}

export interface AdminInviteSummary {
  token: string;
  branchKey: string;
  branch: string;
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

function createAccessToken(): string {
  return `mesh_${randomUUID().replace(/-/g, '')}`;
}

function createKnowledgeEdgeId(): string {
  return `edge_${randomUUID().replace(/-/g, '')}`;
}

function normalizeQualityReviewPolicy(input: AdminQualityReviewQuery): QualityReviewPolicy {
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

function readAdminBranchFilter(input: { branchKey?: string; branch?: string }): string | undefined {
  return readInputBranchKey(input);
}

function readInputBranchKey(input: { branchKey?: string; branch?: string }): string | undefined {
  return (input.branchKey ?? input.branch)?.trim() || undefined;
}

function withAdminProjectBranchKey(project: ProjectSummary): ProjectSummary & { branchKey: string } {
  return {
    ...project,
    branchKey: project.branch
  };
}

function withKnowledgeEdgeBranchKey(edge: HubKnowledgeEdge): AdminKnowledgeEdgeSummary {
  return edge.branch === undefined
    ? { ...edge }
    : {
        ...edge,
        branchKey: edge.branch
      };
}

function withAdminAuditBranchKey(log: AdminAuditLog): AdminAuditLog {
  return log.branch === undefined
    ? { ...log }
    : {
        ...log,
        branchKey: log.branch
      };
}

function filterGlobalProjection(projection: HubGlobalProjection, input: AdminGlobalProjectionQuery): HubGlobalProjection {
  const branchKey = readAdminBranchFilter(input);
  const documents = Object.fromEntries(
    Object.entries(projection.documents)
      .filter(([, document]) => branchKey === undefined || document.branch === branchKey)
      .filter(([, document]) => input.projectKey === undefined || document.projectKey === input.projectKey)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, document]) => [key, cloneGlobalProjectionDocument(document)])
  );
  const result: HubGlobalProjection = {
    schemaVersion: projection.schemaVersion,
    documents,
    counts: createGlobalProjectionCounts(Object.values(documents))
  };

  if (projection.updatedAt !== undefined) {
    result.updatedAt = projection.updatedAt;
  }

  return result;
}

function cloneGlobalProjectionDocument(document: HubGlobalProjectionDocument): HubGlobalProjectionDocument {
  const clone: HubGlobalProjectionDocument = {
    documentKey: document.documentKey,
    document: {
      ...document.document
    },
    sourceHeads: [...document.sourceHeads],
    materializedAt: document.materializedAt,
    knowledgeIds: [...document.knowledgeIds],
    relationIds: [...document.relationIds],
    qualitySignalIds: [...document.qualitySignalIds],
    conflictIds: [...document.conflictIds]
  };

  if (document.branch !== undefined) {
    clone.branch = document.branch;
  }

  if (document.projectKey !== undefined) {
    clone.projectKey = document.projectKey;
  }

  return clone;
}

function createAdminCrdtDocumentSummary(document: HubCrdtDocument): AdminCrdtDocumentSummary {
  const documentRef = {
    ...document.document
  } as HubCrdtDocument['document'] & { branchKey?: string };
  const summary: AdminCrdtDocumentSummary = {
    key: document.key,
    document: documentRef,
    kind: document.document.kind,
    updatedAt: document.updatedAt,
    heads: [...document.heads],
    changeCount: document.changes.length,
    snapshotPresent: document.snapshot !== undefined
  };
  const latestChange = document.changes
    .slice()
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))[0];

  if (document.document.branch !== undefined) {
    documentRef.branchKey = document.document.branch;
    summary.branchKey = document.document.branch;
    summary.branch = document.document.branch;
  }

  if (document.document.projectKey !== undefined) {
    summary.projectKey = document.document.projectKey;
  }

  if (document.document.documentId !== undefined) {
    summary.documentId = document.document.documentId;
  }

  if (document.document.namespace !== undefined) {
    summary.namespace = document.document.namespace;
  }

  if (document.document.schemaVersion !== undefined) {
    summary.schemaVersion = document.document.schemaVersion;
  }

  if (latestChange !== undefined) {
    summary.latestChange = createAdminCrdtChangeSummary(latestChange);
  }

  return summary;
}

function createAdminCrdtChangeSummary(change: HubCrdtChange): AdminCrdtChangeSummary {
  const summary: AdminCrdtChangeSummary = {
    id: change.id,
    receivedAt: change.receivedAt,
    clientId: change.clientId,
    branchKey: change.branch,
    branch: change.branch
  };

  if (change.actorId !== undefined) {
    summary.actorId = change.actorId;
  }

  if (change.createdAt !== undefined) {
    summary.createdAt = change.createdAt;
  }

  if (change.summary !== undefined) {
    summary.summary = change.summary;
  }

  return summary;
}

function createGlobalProjectionCounts(documents: HubGlobalProjectionDocument[]): HubGlobalProjection['counts'] {
  const groups = new Set(documents.map((document) => document.branch).filter((branch): branch is string => branch !== undefined));

  return {
    documents: documents.length,
    groups: groups.size,
    knowledge: documents.reduce((total, document) => total + document.knowledgeIds.length, 0),
    relations: documents.reduce((total, document) => total + document.relationIds.length, 0),
    qualitySignals: documents.reduce((total, document) => total + document.qualitySignalIds.length, 0),
    conflicts: documents.reduce((total, document) => total + document.conflictIds.length, 0)
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
  policy: QualityReviewPolicy,
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
  policy: QualityReviewPolicy
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

function createQualityReviewReasons(item: KnowledgeItem, policy: QualityReviewPolicy): string[] {
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
  policy: QualityReviewPolicy
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
  branch: string,
  members: NonNullable<AdminProjectAclInput['members']>
): ProjectAclMember[] | HubResult<never> {
  const normalized = new Map<string, ProjectAclMember>();

  for (const member of members) {
    const memberId = member.memberId?.trim();

    if (!memberId) {
      return hubError(400, 'admin.project_acl_member_required', 'ACL memberId is required.');
    }

    const existingMember = state.members.get(memberId);

    if (existingMember === undefined || existingMember.branch !== branch) {
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
  const branch = input?.trim() || fallbackGroup;

  if (branch === undefined || !state.groups.has(branch)) {
    return hubError(404, 'admin.group_not_found', 'The target group does not exist.');
  }

  return ok(branch);
}

function resolveKnowledgeEdgeGroupKey(state: HubState, input: string | undefined): HubResult<string | undefined> {
  const branch = normalizeOptionalString(input);

  if (branch !== undefined && !state.groups.has(branch)) {
    return hubError(404, 'admin.group_not_found', 'The target group does not exist.');
  }

  return ok(branch);
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
  branch: string,
  projectKey: string | undefined,
  aliases: string[] | undefined
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    branchKey: branch,
    branch
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
  const branch = readGlossaryMetadata(item, 'branch');
  const branchKey = readGlossaryMetadata(item, 'branchKey') ?? branch;
  const inputBranchKey = readAdminBranchFilter(input);
  const projectKey = readGlossaryMetadata(item, 'projectKey');

  if (inputBranchKey !== undefined && branchKey !== inputBranchKey) {
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
