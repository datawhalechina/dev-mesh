<script setup lang="ts">
import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { Component } from 'vue';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  createGlossaryItem,
  createInvite,
  createGroup,
  createKnowledgeEdge,
  createProject,
  disableMember,
  fetchAdminOverview,
  fetchAuditLogs,
  fetchGlossary,
  fetchGroups,
  fetchInvites,
  fetchKnowledge,
  fetchKnowledgeEdges,
  fetchMembers,
  fetchProjects,
  fetchQualityReview,
  fetchReviewQueue,
  fetchTaskDigest,
  revokeInvite,
  updateGlossaryItem,
  updateProjectAcl
} from './api.js';
import type {
  AdminOverview,
  AuditLog,
  GlossaryInput,
  GroupInput,
  GroupSummary,
  InviteInput,
  InviteSummary,
  KnowledgeEdge,
  KnowledgeEdgeInput,
  KnowledgeEdgeKind,
  KnowledgeItem,
  MemberSummary,
  ProjectAclRole,
  ProjectInput,
  ProjectSummary,
  QualityReviewFilters,
  QualityReviewItem,
  QualityReviewResponse,
  ReviewQueueItem,
  TaskDigestFilters,
  TaskDigestResponse,
  TaskStatus
} from './types.js';

const icons = ElementPlusIcons as unknown as Record<string, Component>;
const CircleCheck = icons.CircleCheck;
const Collection = icons.Collection;
const Connection = icons.Connection;
const DataAnalysis = icons.DataAnalysis;
const Document = icons.Document;
const Folder = icons.Folder;
const Lock = icons.Lock;
const Memo = icons.Memo;
const Plus = icons.Plus;
const Refresh = icons.Refresh;
const Search = icons.Search;
const User = icons.User;

const activeView = ref('overview');
const loading = ref(false);
const errorMessage = ref('');
const overview = ref<AdminOverview | null>(null);
const groups = ref<GroupSummary[]>([]);
const members = ref<MemberSummary[]>([]);
const invites = ref<InviteSummary[]>([]);
const projects = ref<ProjectSummary[]>([]);
const glossary = ref<KnowledgeItem[]>([]);
const knowledge = ref<KnowledgeItem[]>([]);
const edgeKnowledge = ref<KnowledgeItem[]>([]);
const knowledgeEdges = ref<KnowledgeEdge[]>([]);
const qualityReview = ref<QualityReviewResponse | null>(null);
const taskDigest = ref<TaskDigestResponse | null>(null);
const reviewQueue = ref<ReviewQueueItem[]>([]);
const auditLogs = ref<AuditLog[]>([]);
const knowledgeLayer = ref('');
const knowledgeQuery = ref('');
const knowledgeIncludeSuperseded = ref(false);
const qualityLayer = ref('');
const qualityMaxScore = ref(0.6);
const qualityStaleDays = ref(180);
const qualityIncludeSuperseded = ref(true);
const taskDigestProjectKey = ref('');
const taskDigestStatus = ref<TaskStatus | ''>('');
const taskDigestIncludeDone = ref(false);
const taskDigestIncludeSuperseded = ref(true);
const glossaryQuery = ref('');
const glossaryGroupKey = ref('');
const glossaryProjectKey = ref('');
const groupDialogOpen = ref(false);
const inviteDialogOpen = ref(false);
const projectDialogOpen = ref(false);
const projectAclDialogOpen = ref(false);
const glossaryDialogOpen = ref(false);
const edgeDialogOpen = ref(false);
const selectedAclProject = ref<ProjectSummary | null>(null);
const editingGlossaryId = ref<string | null>(null);
const groupForm = reactive<GroupInput>({
  key: '',
  displayName: '',
  description: '',
  joinMode: 'invite'
});
const projectForm = reactive<ProjectInput>({
  groupKey: '',
  id: '',
  name: '',
  description: ''
});
const inviteForm = reactive<InviteFormInput>({
  groupKey: '',
  token: '',
  expiresAt: '',
  maxUses: ''
});
const projectAclForm = reactive<ProjectAclFormInput>({
  visibility: 'group',
  memberIds: [],
  role: 'member'
});
const glossaryForm = reactive<GlossaryFormInput>({
  groupKey: '',
  projectKey: '',
  term: '',
  definition: '',
  content: '',
  aliases: '',
  tags: ''
});
const edgeForm = reactive<KnowledgeEdgeFormInput>({
  kind: 'supersedes',
  groupKey: '',
  fromId: '',
  toId: '',
  reason: ''
});

const navItems = [
  { key: 'overview', label: 'Overview', icon: DataAnalysis },
  { key: 'groups', label: 'Groups', icon: Collection },
  { key: 'members', label: 'Members', icon: User },
  { key: 'invites', label: 'Invites', icon: Lock },
  { key: 'projects', label: 'Projects', icon: Folder },
  { key: 'glossary', label: 'Glossary', icon: Memo },
  { key: 'knowledge', label: 'Knowledge', icon: Document },
  { key: 'quality', label: 'Quality', icon: DataAnalysis },
  { key: 'edges', label: 'Edges', icon: Connection },
  { key: 'digest', label: 'Task Digest', icon: Memo },
  { key: 'review', label: 'Review Queue', icon: Memo },
  { key: 'audit', label: 'Audit Log', icon: Lock }
];

const stats = computed(() => {
  if (overview.value === null) {
    return [];
  }

  return [
    { label: 'Groups', value: overview.value.counts.groups, icon: Collection },
    { label: 'Members', value: overview.value.counts.members, icon: User },
    { label: 'Projects', value: overview.value.counts.projects, icon: Folder },
    { label: 'Knowledge', value: overview.value.counts.knowledgeItems, icon: Document }
  ];
});

const qualityStats = computed(() => {
  if (qualityReview.value === null) {
    return [];
  }

  return [
    { label: 'Needs Review', value: qualityReview.value.summary.needsReview, icon: DataAnalysis },
    { label: 'Low Quality', value: qualityReview.value.summary.lowQuality, icon: Document },
    { label: 'Low Rating', value: qualityReview.value.summary.lowRating, icon: Memo },
    { label: 'Stale', value: qualityReview.value.summary.stale, icon: Refresh }
  ];
});

const qualityReviewItems = computed(() => qualityReview.value?.items ?? []);

const taskDigestStats = computed(() => {
  if (taskDigest.value === null) {
    return [];
  }

  return [
    { label: 'Open Tasks', value: taskDigest.value.summary.totalTasks - taskDigest.value.summary.done, icon: Memo },
    { label: 'In Progress', value: taskDigest.value.summary.inProgress, icon: DataAnalysis },
    { label: 'Blocked', value: taskDigest.value.summary.blocked, icon: Lock },
    { label: 'Done', value: taskDigest.value.summary.done, icon: CircleCheck }
  ];
});

const taskDigestEntries = computed(() => taskDigest.value?.entries ?? []);

const projectAclMembers = computed(() => {
  if (selectedAclProject.value === null) {
    return [];
  }

  return members.value.filter((member) => member.groupKey === selectedAclProject.value?.groupKey && member.status === 'active');
});

const edgeKnowledgeOptions = computed(() =>
  edgeKnowledge.value.map((item) => ({
    label: knowledgeLabel(item.id),
    value: item.id
  }))
);

const edgeFormInvalid = computed(() => !edgeForm.fromId || !edgeForm.toId || edgeForm.fromId === edgeForm.toId);

onMounted(() => {
  void refreshAll();
});

async function refreshAll(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    const [
      overviewData,
      groupData,
      memberData,
      inviteData,
      projectData,
      glossaryData,
      knowledgeData,
      edgeKnowledgeData,
      edgeData,
      qualityData,
      taskDigestData,
      queueData,
      auditData
    ] = await Promise.all([
      fetchAdminOverview(),
      fetchGroups(),
      fetchMembers(),
      fetchInvites(),
      fetchProjects(),
      fetchGlossary(glossaryQuery.value, glossaryGroupKey.value, glossaryProjectKey.value),
      fetchKnowledge(knowledgeLayer.value, knowledgeQuery.value, knowledgeIncludeSuperseded.value),
      fetchKnowledge('', '', true),
      fetchKnowledgeEdges(),
      fetchQualityReview(createQualityReviewFilters()),
      fetchTaskDigest(createTaskDigestFilters()),
      fetchReviewQueue(),
      fetchAuditLogs()
    ]);

    overview.value = overviewData;
    groups.value = groupData;
    members.value = memberData;
    invites.value = inviteData;
    projects.value = projectData;
    glossary.value = glossaryData;
    knowledge.value = knowledgeData;
    edgeKnowledge.value = edgeKnowledgeData;
    knowledgeEdges.value = edgeData;
    qualityReview.value = qualityData;
    taskDigest.value = taskDigestData;
    reviewQueue.value = queueData;
    auditLogs.value = auditData;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function reloadKnowledge(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    knowledge.value = await fetchKnowledge(knowledgeLayer.value, knowledgeQuery.value, knowledgeIncludeSuperseded.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function reloadQualityReview(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    qualityReview.value = await fetchQualityReview(createQualityReviewFilters());
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function reloadTaskDigest(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    taskDigest.value = await fetchTaskDigest(createTaskDigestFilters());
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function reloadGlossary(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    glossary.value = await fetchGlossary(glossaryQuery.value, glossaryGroupKey.value, glossaryProjectKey.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function submitGroup(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    await createGroup(groupForm);
    groupDialogOpen.value = false;
    Object.assign(groupForm, {
      key: '',
      displayName: '',
      description: '',
      joinMode: 'invite'
    });
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function submitProject(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    await createProject(projectForm);
    projectDialogOpen.value = false;
    Object.assign(projectForm, {
      groupKey: '',
      id: '',
      name: '',
      description: ''
    });
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function submitInvite(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    const payload: InviteInput = {
      groupKey: inviteForm.groupKey
    };
    const token = inviteForm.token.trim();
    const expiresAt = inviteForm.expiresAt.trim();
    const maxUses = Number.parseInt(inviteForm.maxUses.trim(), 10);

    if (token) {
      payload.token = token;
    }

    if (expiresAt) {
      payload.expiresAt = expiresAt;
    }

    if (Number.isFinite(maxUses) && maxUses > 0) {
      payload.maxUses = maxUses;
    }

    await createInvite(payload);
    inviteDialogOpen.value = false;
    Object.assign(inviteForm, {
      groupKey: '',
      token: '',
      expiresAt: '',
      maxUses: ''
    });
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function revokeInviteRow(row: InviteSummary): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    await revokeInvite(row.token);
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function disableMemberRow(row: MemberSummary): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    await disableMember(row.memberId, 'Disabled from web admin');
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function openProjectAcl(row: ProjectSummary): void {
  const access = row.access ?? {
    visibility: 'group',
    members: []
  };

  selectedAclProject.value = row;
  projectAclForm.visibility = access.visibility;
  projectAclForm.memberIds = access.members.map((member) => member.memberId);
  projectAclForm.role = access.members[0]?.role ?? 'member';
  projectAclDialogOpen.value = true;
}

async function submitProjectAcl(): Promise<void> {
  if (selectedAclProject.value === null) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    await updateProjectAcl(selectedAclProject.value.groupKey, selectedAclProject.value.id, {
      visibility: projectAclForm.visibility,
      members:
        projectAclForm.visibility === 'restricted'
          ? projectAclForm.memberIds.map((memberId) => ({
              memberId,
              role: projectAclForm.role
            }))
          : []
    });
    projectAclDialogOpen.value = false;
    selectedAclProject.value = null;
    Object.assign(projectAclForm, {
      visibility: 'group',
      memberIds: [],
      role: 'member'
    });
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function openGlossaryDialog(row?: KnowledgeItem): void {
  editingGlossaryId.value = row?.id ?? null;
  Object.assign(glossaryForm, {
    groupKey: readMetadataString(row, 'groupKey') ?? groups.value[0]?.key ?? '',
    projectKey: readMetadataString(row, 'projectKey') ?? '',
    term: row?.title ?? '',
    definition: row?.summary ?? '',
    content: row?.content ?? '',
    aliases: glossaryAliases(row).join(', '),
    tags: row?.tags.filter((tag) => tag !== 'glossary').join(', ') ?? ''
  });
  glossaryDialogOpen.value = true;
}

async function submitGlossary(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    const payload: GlossaryInput = {
      term: glossaryForm.term,
      definition: glossaryForm.definition
    };
    const groupKey = glossaryForm.groupKey.trim();
    const projectKey = glossaryForm.projectKey.trim();
    const content = glossaryForm.content.trim();
    const aliases = parseList(glossaryForm.aliases);
    const tags = parseList(glossaryForm.tags);

    if (groupKey) {
      payload.groupKey = groupKey;
    }

    if (projectKey) {
      payload.projectKey = projectKey;
    }

    if (content) {
      payload.content = content;
    }

    if (aliases.length) {
      payload.aliases = aliases;
    }

    if (tags.length) {
      payload.tags = tags;
    }

    if (editingGlossaryId.value === null) {
      await createGlossaryItem(payload);
    } else {
      await updateGlossaryItem(editingGlossaryId.value, payload);
    }

    glossaryDialogOpen.value = false;
    editingGlossaryId.value = null;
    Object.assign(glossaryForm, {
      groupKey: '',
      projectKey: '',
      term: '',
      definition: '',
      content: '',
      aliases: '',
      tags: ''
    });
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function openEdgeDialog(): void {
  Object.assign(edgeForm, {
    kind: 'supersedes',
    groupKey: groups.value[0]?.key ?? '',
    fromId: edgeKnowledge.value[0]?.id ?? '',
    toId: edgeKnowledge.value[1]?.id ?? '',
    reason: ''
  });
  edgeDialogOpen.value = true;
}

async function submitEdge(): Promise<void> {
  if (edgeFormInvalid.value) {
    errorMessage.value = 'Choose two different knowledge items.';
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    const payload: KnowledgeEdgeInput = {
      kind: edgeForm.kind,
      fromId: edgeForm.fromId,
      toId: edgeForm.toId
    };
    const groupKey = edgeForm.groupKey.trim();
    const reason = edgeForm.reason.trim();

    if (groupKey) {
      payload.groupKey = groupKey;
    }

    if (reason) {
      payload.reason = reason;
    }

    await createKnowledgeEdge(payload);
    edgeDialogOpen.value = false;
    Object.assign(edgeForm, {
      kind: 'supersedes',
      groupKey: '',
      fromId: '',
      toId: '',
      reason: ''
    });
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function createQualityReviewFilters(): QualityReviewFilters {
  const filters: QualityReviewFilters = {
    maxQualityScore: qualityMaxScore.value,
    staleDays: qualityStaleDays.value,
    includeSuperseded: qualityIncludeSuperseded.value
  };

  if (qualityLayer.value) {
    filters.layer = qualityLayer.value;
  }

  return filters;
}

function createTaskDigestFilters(): TaskDigestFilters {
  const filters: TaskDigestFilters = {
    includeDone: taskDigestIncludeDone.value,
    includeSuperseded: taskDigestIncludeSuperseded.value
  };
  const projectKey = taskDigestProjectKey.value.trim();

  if (projectKey) {
    filters.projectKey = projectKey;
  }

  if (taskDigestStatus.value) {
    filters.status = taskDigestStatus.value;
  }

  return filters;
}

function memberStatusType(status: MemberSummary['status']): 'success' | 'danger' {
  return status === 'active' ? 'success' : 'danger';
}

function inviteStatusType(status: InviteSummary['status']): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'active') {
    return 'success';
  }

  if (status === 'revoked') {
    return 'danger';
  }

  return status === 'expired' ? 'info' : 'warning';
}

function knowledgeStatusType(status: KnowledgeItem['status']): 'success' | 'warning' | 'danger' {
  if (status === 'active') {
    return 'success';
  }

  return status === 'superseded' ? 'warning' : 'danger';
}

function edgeKindType(kind: KnowledgeEdgeKind): 'success' | 'warning' | 'danger' {
  if (kind === 'supersedes') {
    return 'warning';
  }

  return kind === 'contradicts' ? 'danger' : 'success';
}

function taskStatusType(status: TaskStatus): 'success' | 'info' | 'warning' | 'danger' {
  if (status === 'done') {
    return 'success';
  }

  if (status === 'blocked') {
    return 'danger';
  }

  return status === 'in_progress' ? 'warning' : 'info';
}

function qualityPriorityType(priority: QualityReviewItem['priority']): 'danger' | 'warning' | 'info' {
  if (priority === 'high') {
    return 'danger';
  }

  return priority === 'medium' ? 'warning' : 'info';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function projectAccessVisibility(project: ProjectSummary): 'group' | 'restricted' {
  return project.access?.visibility ?? 'group';
}

function projectAccessMemberCount(project: ProjectSummary): number {
  return project.access?.members.length ?? 0;
}

function projectAccessType(project: ProjectSummary): 'success' | 'warning' {
  return projectAccessVisibility(project) === 'group' ? 'success' : 'warning';
}

function memberLabel(memberId: string): string {
  const member = members.value.find((item) => item.memberId === memberId);

  return member === undefined ? memberId : `${member.displayName} (${member.handle})`;
}

function knowledgeLabel(id: string): string {
  const item = edgeKnowledge.value.find((candidate) => candidate.id === id) ?? knowledge.value.find((candidate) => candidate.id === id);

  return item === undefined ? id : `${item.title} (${item.id})`;
}

function glossaryScope(row: KnowledgeItem): string {
  return readMetadataString(row, 'projectKey') ?? row.para.key;
}

function glossaryAliases(row: KnowledgeItem | undefined): string[] {
  const aliases = row?.source.metadata?.aliases;

  return Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === 'string') : [];
}

function glossaryTags(row: KnowledgeItem): string {
  return row.tags.filter((tag) => tag !== 'glossary').join(', ');
}

function readMetadataString(row: KnowledgeItem | undefined, key: string): string | undefined {
  const value = row?.source.metadata?.[key];

  return typeof value === 'string' ? value : undefined;
}

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

interface InviteFormInput {
  groupKey: string;
  token: string;
  expiresAt: string;
  maxUses: string;
}

interface ProjectAclFormInput {
  visibility: 'group' | 'restricted';
  memberIds: string[];
  role: ProjectAclRole;
}

interface GlossaryFormInput {
  groupKey: string;
  projectKey: string;
  term: string;
  definition: string;
  content: string;
  aliases: string;
  tags: string;
}

interface KnowledgeEdgeFormInput {
  kind: KnowledgeEdgeKind;
  groupKey: string;
  fromId: string;
  toId: string;
  reason: string;
}
</script>

<template>
  <el-config-provider>
    <el-container class="admin-shell">
      <el-aside class="sidebar" width="236px">
        <div class="brand">
          <Connection class="brand-icon" />
          <div>
            <strong>MCP Dev Mesh</strong>
            <span>Admin</span>
          </div>
        </div>
        <el-menu v-model:default-active="activeView" class="nav" @select="activeView = $event">
          <el-menu-item v-for="item in navItems" :key="item.key" :index="item.key">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-container>
        <el-header class="topbar">
          <div>
            <h1>{{ navItems.find((item) => item.key === activeView)?.label }}</h1>
            <p v-if="overview">{{ overview.baseUrl }}</p>
          </div>
          <el-button :icon="Refresh" :loading="loading" type="primary" @click="refreshAll">Refresh</el-button>
        </el-header>

        <el-main v-loading="loading" class="content">
          <el-alert v-if="errorMessage" :title="errorMessage" class="alert" type="error" show-icon />

          <section v-if="activeView === 'overview'" class="view">
            <div class="stats-grid">
              <div v-for="stat in stats" :key="stat.label" class="stat-panel">
                <el-icon><component :is="stat.icon" /></el-icon>
                <span>{{ stat.label }}</span>
                <strong>{{ stat.value }}</strong>
              </div>
            </div>
            <div class="panel-grid">
              <section class="panel">
                <h2>Server</h2>
                <el-descriptions v-if="overview" :column="1" border>
                  <el-descriptions-item label="Version">{{ overview.version }}</el-descriptions-item>
                  <el-descriptions-item label="MCP">{{ overview.mcpUrl }}</el-descriptions-item>
                  <el-descriptions-item label="Sync">
                    <el-tag type="success">{{ overview.sync.status }}</el-tag>
                  </el-descriptions-item>
                </el-descriptions>
              </section>
              <section class="panel">
                <h2>Recent Knowledge</h2>
                <el-empty v-if="!overview?.recentKnowledge.length" description="No records" />
                <el-table v-else :data="overview.recentKnowledge" size="small">
                  <el-table-column prop="title" label="Title" min-width="220" />
                  <el-table-column prop="layer" label="Layer" width="120" />
                  <el-table-column label="Quality" width="120">
                    <template #default="{ row }">
                      {{ Math.round(row.quality.qualityScore * 100) }}%
                    </template>
                  </el-table-column>
                </el-table>
              </section>
            </div>
          </section>

          <section v-else-if="activeView === 'groups'" class="view">
            <div class="toolbar">
              <el-button :icon="Plus" type="primary" @click="groupDialogOpen = true">New Group</el-button>
            </div>
            <el-table :data="groups" empty-text="No groups">
              <el-table-column prop="key" label="Key" min-width="160" />
              <el-table-column prop="displayName" label="Name" min-width="180" />
              <el-table-column prop="joinMode" label="Join" width="120" />
              <el-table-column prop="memberCount" label="Members" width="110" />
              <el-table-column prop="projectCount" label="Projects" width="110" />
              <el-table-column prop="description" label="Description" min-width="220" />
            </el-table>
          </section>

          <section v-else-if="activeView === 'members'" class="view">
            <el-table :data="members" empty-text="No members">
              <el-table-column prop="displayName" label="Name" min-width="160" />
              <el-table-column prop="handle" label="Handle" width="140" />
              <el-table-column prop="groupKey" label="Group" width="150" />
              <el-table-column label="Status" width="120">
                <template #default="{ row }">
                  <el-tag :type="memberStatusType(row.status)">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="clientId" label="Client" min-width="260" />
              <el-table-column prop="tokenExpiresAt" label="Token Expires" min-width="190" />
              <el-table-column label="Actions" width="130" fixed="right">
                <template #default="{ row }">
                  <el-button
                    :disabled="row.status === 'disabled'"
                    :icon="Lock"
                    size="small"
                    type="danger"
                    @click="disableMemberRow(row)"
                  >
                    Disable
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section v-else-if="activeView === 'invites'" class="view">
            <div class="toolbar">
              <el-button :icon="Plus" type="primary" @click="inviteDialogOpen = true">New Invite</el-button>
            </div>
            <el-table :data="invites" empty-text="No invites">
              <el-table-column prop="token" label="Token" min-width="230" />
              <el-table-column prop="groupKey" label="Group" width="150" />
              <el-table-column label="Status" width="120">
                <template #default="{ row }">
                  <el-tag :type="inviteStatusType(row.status)">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="uses" label="Uses" width="90" />
              <el-table-column prop="maxUses" label="Max" width="90" />
              <el-table-column prop="expiresAt" label="Expires" min-width="190" />
              <el-table-column prop="createdAt" label="Created" min-width="190" />
              <el-table-column label="Actions" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button
                    :disabled="row.status === 'revoked'"
                    :icon="Lock"
                    size="small"
                    type="danger"
                    @click="revokeInviteRow(row)"
                  >
                    Revoke
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section v-else-if="activeView === 'projects'" class="view">
            <div class="toolbar">
              <el-button :icon="Plus" type="primary" @click="projectDialogOpen = true">New Project</el-button>
            </div>
            <el-table :data="projects" empty-text="No projects">
              <el-table-column prop="id" label="ID" min-width="170" />
              <el-table-column prop="name" label="Name" min-width="190" />
              <el-table-column prop="groupKey" label="Group" width="150" />
              <el-table-column label="Access" width="140">
                <template #default="{ row }">
                  <el-tag :type="projectAccessType(row)">{{ projectAccessVisibility(row) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="ACL Members" width="130">
                <template #default="{ row }">{{ projectAccessMemberCount(row) }}</template>
              </el-table-column>
              <el-table-column prop="createdByMemberId" label="Created By" min-width="180" />
              <el-table-column prop="description" label="Description" min-width="220" />
              <el-table-column label="Actions" width="110" fixed="right">
                <template #default="{ row }">
                  <el-button :icon="Lock" size="small" @click="openProjectAcl(row)">ACL</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section v-else-if="activeView === 'glossary'" class="view">
            <div class="toolbar">
              <el-button :icon="Plus" type="primary" @click="openGlossaryDialog()">New Term</el-button>
              <el-select v-model="glossaryGroupKey" class="layer-select" placeholder="Group" clearable @change="reloadGlossary">
                <el-option v-for="group in groups" :key="group.key" :label="group.displayName" :value="group.key" />
              </el-select>
              <el-input
                v-model="glossaryProjectKey"
                class="query-input"
                clearable
                placeholder="Project key"
                @keyup.enter="reloadGlossary"
              />
              <el-input
                v-model="glossaryQuery"
                :prefix-icon="Search"
                class="query-input"
                clearable
                placeholder="Search terms"
                @keyup.enter="reloadGlossary"
              />
              <el-button @click="reloadGlossary">Apply</el-button>
            </div>
            <el-table :data="glossary" empty-text="No glossary terms">
              <el-table-column prop="title" label="Term" min-width="180" />
              <el-table-column prop="summary" label="Definition" min-width="320" />
              <el-table-column label="Scope" min-width="160">
                <template #default="{ row }">{{ glossaryScope(row) }}</template>
              </el-table-column>
              <el-table-column label="Aliases" min-width="180">
                <template #default="{ row }">{{ glossaryAliases(row).join(', ') }}</template>
              </el-table-column>
              <el-table-column label="Tags" min-width="160">
                <template #default="{ row }">{{ glossaryTags(row) }}</template>
              </el-table-column>
              <el-table-column label="Actions" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" @click="openGlossaryDialog(row)">Edit</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section v-else-if="activeView === 'knowledge'" class="view">
            <div class="toolbar">
              <el-select v-model="knowledgeLayer" class="layer-select" placeholder="Layer" clearable @change="reloadKnowledge">
                <el-option label="raw" value="raw" />
                <el-option label="extract" value="extract" />
                <el-option label="canonical" value="canonical" />
              </el-select>
              <el-input
                v-model="knowledgeQuery"
                :prefix-icon="Search"
                class="query-input"
                clearable
                placeholder="Search knowledge"
                @keyup.enter="reloadKnowledge"
              />
              <el-switch
                v-model="knowledgeIncludeSuperseded"
                active-text="Include Superseded"
                @change="reloadKnowledge"
              />
              <el-button @click="reloadKnowledge">Apply</el-button>
            </div>
            <el-table :data="knowledge" empty-text="No knowledge">
              <el-table-column prop="title" label="Title" min-width="260" />
              <el-table-column prop="layer" label="Layer" width="120" />
              <el-table-column label="Status" width="130">
                <template #default="{ row }">
                  <el-tag :type="knowledgeStatusType(row.status)">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="type" label="Type" width="130" />
              <el-table-column label="PARA" min-width="190">
                <template #default="{ row }">{{ row.para.category }}/{{ row.para.key }}</template>
              </el-table-column>
              <el-table-column label="Quality" width="120">
                <template #default="{ row }">
                  <el-tag>{{ Math.round(row.quality.qualityScore * 100) }}%</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="Owner" width="150">
                <template #default="{ row }">{{ row.createdBy.displayName }}</template>
              </el-table-column>
            </el-table>
          </section>

          <section v-else-if="activeView === 'quality'" class="view">
            <div class="toolbar">
              <el-select v-model="qualityLayer" class="layer-select" placeholder="Layer" clearable>
                <el-option label="raw" value="raw" />
                <el-option label="extract" value="extract" />
                <el-option label="canonical" value="canonical" />
              </el-select>
              <el-input-number
                v-model="qualityMaxScore"
                :max="1"
                :min="0"
                :precision="2"
                :step="0.05"
                controls-position="right"
                placeholder="Max quality"
              />
              <el-input-number
                v-model="qualityStaleDays"
                :min="1"
                :step="30"
                controls-position="right"
                placeholder="Stale days"
              />
              <el-switch v-model="qualityIncludeSuperseded" active-text="Include Superseded" />
              <el-button @click="reloadQualityReview">Apply</el-button>
            </div>
            <div class="stats-grid">
              <div v-for="stat in qualityStats" :key="stat.label" class="stat-panel">
                <el-icon><component :is="stat.icon" /></el-icon>
                <span>{{ stat.label }}</span>
                <strong>{{ stat.value }}</strong>
              </div>
            </div>
            <el-table :data="qualityReviewItems" empty-text="No quality review items">
              <el-table-column prop="item.title" label="Title" min-width="260" />
              <el-table-column label="Priority" width="110">
                <template #default="{ row }">
                  <el-tag :type="qualityPriorityType(row.priority)">{{ row.priority }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="Reasons" min-width="220">
                <template #default="{ row }">
                  <el-tag v-for="reason in row.reasons" :key="reason" class="reason-tag" type="warning">
                    {{ reason }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="Quality" width="110">
                <template #default="{ row }">{{ formatPercent(row.item.quality.qualityScore) }}</template>
              </el-table-column>
              <el-table-column label="Confidence" width="120">
                <template #default="{ row }">{{ formatPercent(row.item.quality.confidence) }}</template>
              </el-table-column>
              <el-table-column label="Rating" width="110">
                <template #default="{ row }">{{ formatPercent(row.item.quality.rating) }}</template>
              </el-table-column>
              <el-table-column label="Adoption" width="110">
                <template #default="{ row }">{{ formatPercent(row.item.quality.adoptionScore) }}</template>
              </el-table-column>
              <el-table-column label="Status" width="130">
                <template #default="{ row }">
                  <el-tag :type="knowledgeStatusType(row.item.status)">{{ row.item.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="item.updatedAt" label="Updated" width="190" />
            </el-table>
          </section>

          <section v-else-if="activeView === 'edges'" class="view">
            <div class="toolbar">
              <el-button :icon="Plus" type="primary" @click="openEdgeDialog">New Edge</el-button>
            </div>
            <el-table :data="knowledgeEdges" empty-text="No knowledge edges">
              <el-table-column label="Kind" width="130">
                <template #default="{ row }">
                  <el-tag :type="edgeKindType(row.kind)">{{ row.kind }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="From" min-width="260">
                <template #default="{ row }">{{ knowledgeLabel(row.fromId) }}</template>
              </el-table-column>
              <el-table-column label="To" min-width="260">
                <template #default="{ row }">{{ knowledgeLabel(row.toId) }}</template>
              </el-table-column>
              <el-table-column prop="groupKey" label="Group" width="150" />
              <el-table-column prop="reason" label="Reason" min-width="220" />
              <el-table-column prop="createdAt" label="Created" width="190" />
            </el-table>
          </section>

          <section v-else-if="activeView === 'digest'" class="view">
            <div class="toolbar">
              <el-input
                v-model="taskDigestProjectKey"
                class="query-input"
                clearable
                placeholder="Task key"
                @keyup.enter="reloadTaskDigest"
              />
              <el-select v-model="taskDigestStatus" class="layer-select" placeholder="Status" clearable>
                <el-option label="todo" value="todo" />
                <el-option label="in_progress" value="in_progress" />
                <el-option label="blocked" value="blocked" />
                <el-option label="done" value="done" />
                <el-option label="unknown" value="unknown" />
              </el-select>
              <el-switch v-model="taskDigestIncludeDone" active-text="Include Done" />
              <el-switch v-model="taskDigestIncludeSuperseded" active-text="Include Superseded" />
              <el-button @click="reloadTaskDigest">Apply</el-button>
            </div>
            <div class="stats-grid">
              <div v-for="stat in taskDigestStats" :key="stat.label" class="stat-panel">
                <el-icon><component :is="stat.icon" /></el-icon>
                <span>{{ stat.label }}</span>
                <strong>{{ stat.value }}</strong>
              </div>
            </div>
            <el-table :data="taskDigestEntries" empty-text="No task digest entries">
              <el-table-column prop="taskKey" label="Task" min-width="160" />
              <el-table-column prop="title" label="Title" min-width="230" />
              <el-table-column label="Status" width="130">
                <template #default="{ row }">
                  <el-tag :type="taskStatusType(row.status)">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="latestSummary" label="Latest Summary" min-width="320" />
              <el-table-column label="Owners" min-width="180">
                <template #default="{ row }">{{ row.owners.join(', ') }}</template>
              </el-table-column>
              <el-table-column label="Tags" min-width="180">
                <template #default="{ row }">
                  <el-tag v-for="tag in row.tags" :key="tag" class="reason-tag" type="info">{{ tag }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="itemCount" label="Items" width="90" />
              <el-table-column prop="latestUpdatedAt" label="Updated" width="190" />
            </el-table>
          </section>

          <section v-else-if="activeView === 'review'" class="view">
            <el-empty v-if="!reviewQueue.length" description="No pending items">
              <template #image>
                <el-icon class="empty-icon"><CircleCheck /></el-icon>
              </template>
            </el-empty>
            <el-table v-else :data="reviewQueue">
              <el-table-column prop="title" label="Title" min-width="260" />
              <el-table-column prop="reason" label="Reason" min-width="260" />
              <el-table-column prop="createdAt" label="Created" width="190" />
            </el-table>
          </section>

          <section v-else class="view">
            <el-table :data="auditLogs" empty-text="No audit logs">
              <el-table-column prop="actor" label="Actor" min-width="180" />
              <el-table-column prop="action" label="Action" min-width="220" />
              <el-table-column prop="targetType" label="Target Type" width="140" />
              <el-table-column prop="targetId" label="Target" min-width="190" />
              <el-table-column prop="groupKey" label="Group" width="150" />
              <el-table-column prop="createdAt" label="Created" width="190" />
            </el-table>
          </section>
        </el-main>
      </el-container>
    </el-container>

    <el-dialog v-model="groupDialogOpen" title="New Group" width="520px">
      <el-form label-position="top">
        <el-form-item label="Key">
          <el-input v-model="groupForm.key" />
        </el-form-item>
        <el-form-item label="Name">
          <el-input v-model="groupForm.displayName" />
        </el-form-item>
        <el-form-item label="Join Mode">
          <el-select v-model="groupForm.joinMode">
            <el-option label="invite" value="invite" />
            <el-option label="open" value="open" />
            <el-option label="admin" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="Description">
          <el-input v-model="groupForm.description" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupDialogOpen = false">Cancel</el-button>
        <el-button type="primary" @click="submitGroup">Create</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="inviteDialogOpen" title="New Invite" width="520px">
      <el-form label-position="top">
        <el-form-item label="Group">
          <el-select v-model="inviteForm.groupKey" filterable>
            <el-option v-for="group in groups" :key="group.key" :label="group.displayName" :value="group.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="Token">
          <el-input v-model="inviteForm.token" />
        </el-form-item>
        <el-form-item label="Max Uses">
          <el-input v-model="inviteForm.maxUses" type="number" />
        </el-form-item>
        <el-form-item label="Expires At">
          <el-input v-model="inviteForm.expiresAt" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="inviteDialogOpen = false">Cancel</el-button>
        <el-button type="primary" @click="submitInvite">Create</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="projectDialogOpen" title="New Project" width="520px">
      <el-form label-position="top">
        <el-form-item label="Group">
          <el-select v-model="projectForm.groupKey" filterable>
            <el-option v-for="group in groups" :key="group.key" :label="group.displayName" :value="group.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="ID">
          <el-input v-model="projectForm.id" />
        </el-form-item>
        <el-form-item label="Name">
          <el-input v-model="projectForm.name" />
        </el-form-item>
        <el-form-item label="Description">
          <el-input v-model="projectForm.description" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="projectDialogOpen = false">Cancel</el-button>
        <el-button type="primary" @click="submitProject">Create</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="glossaryDialogOpen" title="Glossary Term" width="560px">
      <el-form label-position="top">
        <el-form-item label="Group">
          <el-select v-model="glossaryForm.groupKey" filterable>
            <el-option v-for="group in groups" :key="group.key" :label="group.displayName" :value="group.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="Project Key">
          <el-input v-model="glossaryForm.projectKey" />
        </el-form-item>
        <el-form-item label="Term">
          <el-input v-model="glossaryForm.term" />
        </el-form-item>
        <el-form-item label="Definition">
          <el-input v-model="glossaryForm.definition" type="textarea" />
        </el-form-item>
        <el-form-item label="Content">
          <el-input v-model="glossaryForm.content" type="textarea" />
        </el-form-item>
        <el-form-item label="Aliases">
          <el-input v-model="glossaryForm.aliases" />
        </el-form-item>
        <el-form-item label="Tags">
          <el-input v-model="glossaryForm.tags" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="glossaryDialogOpen = false">Cancel</el-button>
        <el-button type="primary" @click="submitGlossary">Save</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="edgeDialogOpen" title="Knowledge Edge" width="600px">
      <el-form label-position="top">
        <el-form-item label="Kind">
          <el-radio-group v-model="edgeForm.kind">
            <el-radio-button label="supersedes">supersedes</el-radio-button>
            <el-radio-button label="duplicates">duplicates</el-radio-button>
            <el-radio-button label="contradicts">contradicts</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="Group">
          <el-select v-model="edgeForm.groupKey" clearable filterable>
            <el-option v-for="group in groups" :key="group.key" :label="group.displayName" :value="group.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="From">
          <el-select v-model="edgeForm.fromId" filterable>
            <el-option
              v-for="item in edgeKnowledgeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="To">
          <el-select v-model="edgeForm.toId" filterable>
            <el-option
              v-for="item in edgeKnowledgeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Reason">
          <el-input v-model="edgeForm.reason" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edgeDialogOpen = false">Cancel</el-button>
        <el-button :disabled="edgeFormInvalid" type="primary" @click="submitEdge">Create</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="projectAclDialogOpen" title="Project ACL" width="560px">
      <el-form label-position="top">
        <el-form-item label="Project">
          <el-input :model-value="selectedAclProject ? `${selectedAclProject.groupKey}/${selectedAclProject.id}` : ''" disabled />
        </el-form-item>
        <el-form-item label="Visibility">
          <el-radio-group v-model="projectAclForm.visibility">
            <el-radio-button label="group">group</el-radio-button>
            <el-radio-button label="restricted">restricted</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="Members">
          <el-select
            v-model="projectAclForm.memberIds"
            :disabled="projectAclForm.visibility !== 'restricted'"
            filterable
            multiple
          >
            <el-option
              v-for="member in projectAclMembers"
              :key="member.memberId"
              :label="memberLabel(member.memberId)"
              :value="member.memberId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Role">
          <el-select v-model="projectAclForm.role" :disabled="projectAclForm.visibility !== 'restricted'">
            <el-option label="owner" value="owner" />
            <el-option label="maintainer" value="maintainer" />
            <el-option label="member" value="member" />
            <el-option label="readonly" value="readonly" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="projectAclDialogOpen = false">Cancel</el-button>
        <el-button type="primary" @click="submitProjectAcl">Save</el-button>
      </template>
    </el-dialog>
  </el-config-provider>
</template>
