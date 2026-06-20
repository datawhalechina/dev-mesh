<script setup lang="ts">
import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { Component } from 'vue';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  bulkPublishKnowledgeToBranch,
  checkoutProjectBranch,
  createBranch,
  createGlossaryItem,
  createInvite,
  createGroup,
  createKnowledgeEdge,
  createProject,
  disableMember,
  fetchAdminOverview,
  fetchAuditLogs,
  fetchBranchMergePreview,
  fetchBranches,
  fetchCrdtDocuments,
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
  publishKnowledgeToBranch,
  rotateMemberToken,
  revokeInvite,
  updateGlossaryItem,
  updateProjectAcl
} from './api.js';
import type {
  AdminOverview,
  AuditLog,
  BranchInput,
  BranchMergePreview,
  BranchMergePreviewItem,
  BranchSummary,
  CrdtDocumentFilters,
  CrdtDocumentSummary,
  GlossaryInput,
  GroupInput,
  GroupSummary,
  InviteInput,
  InviteSummary,
  KnowledgeBranchPublishInput,
  KnowledgeBranchBulkPublishResult,
  KnowledgeEdge,
  KnowledgeEdgeInput,
  KnowledgeEdgeKind,
  KnowledgeItem,
  MemberSummary,
  ProjectAclRole,
  ProjectBranchInput,
  ProjectInput,
  ProjectSummary,
  QualityReviewFilters,
  QualityReviewItem,
  QualityReviewResponse,
  ReviewQueueItem,
  RotatedAccessToken,
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
const Files = icons.Files;
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
const branches = ref<BranchSummary[]>([]);
const crdtDocuments = ref<CrdtDocumentSummary[]>([]);
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
const crdtDocumentKind = ref('');
const crdtDocumentBranchKey = ref('');
const crdtDocumentProjectKey = ref('');
const glossaryQuery = ref('');
const glossaryBranchKey = ref('');
const glossaryProjectKey = ref('');
const groupDialogOpen = ref(false);
const branchDialogOpen = ref(false);
const branchMergePreviewDialogOpen = ref(false);
const inviteDialogOpen = ref(false);
const projectDialogOpen = ref(false);
const projectAclDialogOpen = ref(false);
const projectBranchDialogOpen = ref(false);
const rotatedTokenDialogOpen = ref(false);
const glossaryDialogOpen = ref(false);
const knowledgePublishDialogOpen = ref(false);
const edgeDialogOpen = ref(false);
const rotatedToken = ref<RotatedAccessToken | null>(null);
const selectedAclProject = ref<ProjectSummary | null>(null);
const selectedBranchProject = ref<ProjectSummary | null>(null);
const branchMergePreview = ref<BranchMergePreview | null>(null);
const branchMergeSelectedSourceIds = ref<string[]>([]);
const branchMergeBulkPublishResult = ref<KnowledgeBranchBulkPublishResult | null>(null);
const selectedPublishKnowledge = ref<KnowledgeItem | null>(null);
const editingGlossaryId = ref<string | null>(null);
const groupForm = reactive<GroupInput>({
  key: '',
  displayName: '',
  description: '',
  joinMode: 'invite'
});
const branchForm = reactive<BranchInput>({
  branchKey: '',
  displayName: '',
  description: '',
  joinMode: 'invite'
});
const branchMergePreviewForm = reactive<BranchMergePreviewFormInput>({
  sourceBranchKey: '',
  targetBranchKey: '',
  reason: ''
});
const projectForm = reactive<ProjectInput>({
  branchKey: '',
  id: '',
  name: '',
  description: ''
});
const inviteForm = reactive<InviteFormInput>({
  branchKey: '',
  token: '',
  expiresAt: '',
  maxUses: ''
});
const projectAclForm = reactive<ProjectAclFormInput>({
  visibility: 'group',
  memberIds: [],
  role: 'member'
});
const projectBranchForm = reactive<ProjectBranchInput>({
  branchKey: ''
});
const glossaryForm = reactive<GlossaryFormInput>({
  branchKey: '',
  projectKey: '',
  term: '',
  definition: '',
  content: '',
  aliases: '',
  tags: ''
});
const knowledgePublishForm = reactive<KnowledgePublishFormInput>({
  targetBranchKey: '',
  reason: ''
});
const edgeForm = reactive<KnowledgeEdgeFormInput>({
  kind: 'supersedes',
  branchKey: '',
  fromId: '',
  toId: '',
  reason: ''
});

const navItems = [
  { key: 'overview', label: 'Overview', icon: DataAnalysis },
  { key: 'groups', label: 'Groups', icon: Collection },
  { key: 'branches', label: 'Branches', icon: Connection },
  { key: 'crdt', label: 'CRDT Docs', icon: Files },
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

const branchMergePublishableItems = computed(() =>
  branchMergePreview.value?.items.filter((item) => item.status === 'publishable') ?? []
);

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
      branchData,
      crdtDocumentData,
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
      fetchBranches(),
      fetchCrdtDocuments(createCrdtDocumentFilters()),
      fetchGroups(),
      fetchMembers(),
      fetchInvites(),
      fetchProjects(),
      fetchGlossary(glossaryQuery.value, glossaryBranchKey.value, glossaryProjectKey.value),
      fetchKnowledge(knowledgeLayer.value, knowledgeQuery.value, knowledgeIncludeSuperseded.value),
      fetchKnowledge('', '', true),
      fetchKnowledgeEdges(),
      fetchQualityReview(createQualityReviewFilters()),
      fetchTaskDigest(createTaskDigestFilters()),
      fetchReviewQueue(),
      fetchAuditLogs()
    ]);

    overview.value = overviewData;
    branches.value = branchData;
    crdtDocuments.value = crdtDocumentData;
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

async function reloadCrdtDocuments(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    crdtDocuments.value = await fetchCrdtDocuments(createCrdtDocumentFilters());
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
    glossary.value = await fetchGlossary(glossaryQuery.value, glossaryBranchKey.value, glossaryProjectKey.value);
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

async function submitBranch(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    await createBranch(branchForm);
    branchDialogOpen.value = false;
    Object.assign(branchForm, {
      branchKey: '',
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

async function openBranchMergePreview(row: BranchSummary): Promise<void> {
  const targetBranch = branches.value.find((branch) => branch.branchKey !== row.branchKey);

  Object.assign(branchMergePreviewForm, {
    sourceBranchKey: row.branchKey,
    targetBranchKey: targetBranch?.branchKey ?? '',
    reason: ''
  });
  branchMergePreview.value = null;
  branchMergeSelectedSourceIds.value = [];
  branchMergeBulkPublishResult.value = null;
  branchMergePreviewDialogOpen.value = true;

  if (branchMergePreviewForm.targetBranchKey) {
    await reloadBranchMergePreview();
  }
}

async function reloadBranchMergePreview(): Promise<void> {
  if (!branchMergePreviewForm.sourceBranchKey || !branchMergePreviewForm.targetBranchKey) {
    branchMergePreview.value = null;
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    branchMergePreview.value = await fetchBranchMergePreview(
      branchMergePreviewForm.sourceBranchKey,
      branchMergePreviewForm.targetBranchKey
    );
    branchMergeSelectedSourceIds.value = branchMergePublishableItems.value.map((item) => item.source.id);
    branchMergeBulkPublishResult.value = null;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function submitBranchMergeBulkPublish(): Promise<void> {
  if (!branchMergePreviewForm.sourceBranchKey || !branchMergePreviewForm.targetBranchKey) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    const reason = branchMergePreviewForm.reason.trim();
    branchMergeBulkPublishResult.value = await bulkPublishKnowledgeToBranch({
      sourceBranchKey: branchMergePreviewForm.sourceBranchKey,
      targetBranchKey: branchMergePreviewForm.targetBranchKey,
      sourceIds: branchMergeSelectedSourceIds.value,
      ...(reason ? { reason } : {})
    });
    await refreshAll();
    await reloadBranchMergePreview();
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
      branchKey: '',
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
      branchKey: inviteForm.branchKey
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
      branchKey: '',
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

async function rotateMemberTokenRow(row: MemberSummary): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    rotatedToken.value = await rotateMemberToken(row.memberId);
    rotatedTokenDialogOpen.value = true;
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

function openProjectBranch(row: ProjectSummary): void {
  selectedBranchProject.value = row;
  projectBranchForm.branchKey = row.groupKey;
  projectBranchDialogOpen.value = true;
}

async function submitProjectBranch(): Promise<void> {
  if (selectedBranchProject.value === null) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    await checkoutProjectBranch(selectedBranchProject.value.groupKey, selectedBranchProject.value.id, {
      branchKey: projectBranchForm.branchKey
    });
    projectBranchDialogOpen.value = false;
    selectedBranchProject.value = null;
    projectBranchForm.branchKey = '';
    await refreshAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
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
    branchKey: readMetadataString(row, 'branchKey') ?? readMetadataString(row, 'groupKey') ?? branches.value[0]?.branchKey ?? '',
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
    const branchKey = glossaryForm.branchKey.trim();
    const projectKey = glossaryForm.projectKey.trim();
    const content = glossaryForm.content.trim();
    const aliases = parseList(glossaryForm.aliases);
    const tags = parseList(glossaryForm.tags);

    if (branchKey) {
      payload.branchKey = branchKey;
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
      branchKey: '',
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

function openKnowledgePublishDialog(row: KnowledgeItem): void {
  const sourceBranch = knowledgeBranchKey(row);
  const targetBranch = branches.value.find((branch) => branch.branchKey !== sourceBranch);

  selectedPublishKnowledge.value = row;
  Object.assign(knowledgePublishForm, {
    targetBranchKey: targetBranch?.branchKey ?? '',
    reason: ''
  });
  knowledgePublishDialogOpen.value = true;
}

async function submitKnowledgePublish(): Promise<void> {
  if (selectedPublishKnowledge.value === null) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    const payload: KnowledgeBranchPublishInput = {
      sourceId: selectedPublishKnowledge.value.id,
      targetBranchKey: knowledgePublishForm.targetBranchKey
    };
    const reason = knowledgePublishForm.reason.trim();

    if (reason) {
      payload.reason = reason;
    }

    await publishKnowledgeToBranch(payload);
    knowledgePublishDialogOpen.value = false;
    selectedPublishKnowledge.value = null;
    Object.assign(knowledgePublishForm, {
      targetBranchKey: '',
      reason: ''
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
    branchKey: branches.value[0]?.branchKey ?? '',
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
    const branchKey = edgeForm.branchKey.trim();
    const reason = edgeForm.reason.trim();

    if (branchKey) {
      payload.branchKey = branchKey;
    }

    if (reason) {
      payload.reason = reason;
    }

    await createKnowledgeEdge(payload);
    edgeDialogOpen.value = false;
    Object.assign(edgeForm, {
      kind: 'supersedes',
      branchKey: '',
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

function createCrdtDocumentFilters(): CrdtDocumentFilters {
  const filters: CrdtDocumentFilters = {};

  if (crdtDocumentKind.value.trim()) {
    filters.kind = crdtDocumentKind.value.trim();
  }

  if (crdtDocumentBranchKey.value.trim()) {
    filters.branchKey = crdtDocumentBranchKey.value.trim();
  }

  if (crdtDocumentProjectKey.value.trim()) {
    filters.projectKey = crdtDocumentProjectKey.value.trim();
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

function branchMergePreviewStatusType(status: BranchMergePreviewItem['status']): 'success' | 'warning' | 'info' {
  if (status === 'publishable') {
    return 'success';
  }

  return status === 'possible_conflict' ? 'warning' : 'info';
}

function crdtDocumentScope(row: CrdtDocumentSummary): string {
  const parts = [row.kind];
  const branchKey = row.branchKey ?? row.groupKey;

  if (branchKey !== undefined) {
    parts.push(`branch:${branchKey}`);
  }

  if (row.projectKey !== undefined) {
    parts.push(`project:${row.projectKey}`);
  }

  if (row.namespace !== undefined) {
    parts.push(`ns:${row.namespace}`);
  }

  if (row.documentId !== undefined) {
    parts.push(`doc:${row.documentId}`);
  }

  return parts.join(' / ');
}

function crdtLatestChange(row: CrdtDocumentSummary): string {
  if (row.latestChange === undefined) {
    return '-';
  }

  return [row.latestChange.summary, row.latestChange.id].filter(Boolean).join(' / ');
}

function isBranchMergePreviewRowSelectable(row: BranchMergePreviewItem): boolean {
  return row.status === 'publishable';
}

function isBranchMergePreviewRowSelected(row: BranchMergePreviewItem): boolean {
  return branchMergeSelectedSourceIds.value.includes(row.source.id);
}

function toggleBranchMergePreviewRow(row: BranchMergePreviewItem, selected: unknown): void {
  if (!isBranchMergePreviewRowSelectable(row)) {
    return;
  }

  branchMergeSelectedSourceIds.value = Boolean(selected)
    ? [...new Set([...branchMergeSelectedSourceIds.value, row.source.id])]
    : branchMergeSelectedSourceIds.value.filter((sourceId) => sourceId !== row.source.id);
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

function knowledgeBranchKey(row: KnowledgeItem): string {
  return readMetadataString(row, 'branchKey') ?? readMetadataString(row, 'groupKey') ?? 'default';
}

function projectBranchKey(row: ProjectSummary): string {
  return row.branchKey ?? row.groupKey;
}

function knowledgeEdgeBranchKey(row: KnowledgeEdge): string {
  return row.branchKey ?? row.groupKey ?? '-';
}

function auditLogBranchKey(row: AuditLog): string {
  return row.branchKey ?? row.groupKey ?? '-';
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
  branchKey: string;
  token: string;
  expiresAt: string;
  maxUses: string;
}

interface ProjectAclFormInput {
  visibility: 'group' | 'restricted';
  memberIds: string[];
  role: ProjectAclRole;
}

interface BranchMergePreviewFormInput {
  sourceBranchKey: string;
  targetBranchKey: string;
  reason: string;
}

interface GlossaryFormInput {
  branchKey: string;
  projectKey: string;
  term: string;
  definition: string;
  content: string;
  aliases: string;
  tags: string;
}

interface KnowledgePublishFormInput {
  targetBranchKey: string;
  reason: string;
}

interface KnowledgeEdgeFormInput {
  kind: KnowledgeEdgeKind;
  branchKey: string;
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
            <strong>DevMesh</strong>
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

          <section v-else-if="activeView === 'branches'" class="view">
            <div class="toolbar">
              <el-button :icon="Plus" type="primary" @click="branchDialogOpen = true">New Branch</el-button>
            </div>
            <el-table :data="branches" empty-text="No knowledge branches">
              <el-table-column prop="branchKey" label="Branch" min-width="170" />
              <el-table-column prop="displayName" label="Name" min-width="180" />
              <el-table-column prop="joinMode" label="Join" width="110" />
              <el-table-column label="Members" width="100">
                <template #default="{ row }">{{ row.counts.members }}</template>
              </el-table-column>
              <el-table-column label="Projects" min-width="220">
                <template #default="{ row }">
                  <el-tag v-for="project in row.projects" :key="project.id" class="reason-tag">
                    {{ project.projectKey }}
                  </el-tag>
                  <span v-if="row.projects.length === 0">-</span>
                </template>
              </el-table-column>
              <el-table-column label="CRDT Docs" width="110">
                <template #default="{ row }">{{ row.counts.crdtDocuments }}</template>
              </el-table-column>
              <el-table-column label="Knowledge" width="110">
                <template #default="{ row }">{{ row.counts.knowledge }}</template>
              </el-table-column>
              <el-table-column label="Relations" width="100">
                <template #default="{ row }">{{ row.counts.relations }}</template>
              </el-table-column>
              <el-table-column label="Signals" width="90">
                <template #default="{ row }">{{ row.counts.qualitySignals }}</template>
              </el-table-column>
              <el-table-column label="Conflicts" width="100">
                <template #default="{ row }">{{ row.counts.conflicts }}</template>
              </el-table-column>
              <el-table-column prop="updatedAt" label="Materialized" min-width="190" />
              <el-table-column label="Actions" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button :disabled="branches.length < 2" :icon="Search" size="small" @click="openBranchMergePreview(row)">
                    Preview
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section v-else-if="activeView === 'crdt'" class="view">
            <div class="toolbar">
              <el-select v-model="crdtDocumentKind" class="layer-select" placeholder="Kind" clearable @change="reloadCrdtDocuments">
                <el-option label="project" value="project" />
                <el-option label="group" value="group" />
                <el-option label="server-global" value="server-global" />
              </el-select>
              <el-select
                v-model="crdtDocumentBranchKey"
                class="layer-select"
                placeholder="Branch"
                clearable
                filterable
                @change="reloadCrdtDocuments"
              >
                <el-option v-for="branch in branches" :key="branch.branchKey" :label="branch.displayName" :value="branch.branchKey" />
              </el-select>
              <el-input
                v-model="crdtDocumentProjectKey"
                class="query-input"
                clearable
                placeholder="Project key"
                @keyup.enter="reloadCrdtDocuments"
              />
              <el-button @click="reloadCrdtDocuments">Apply</el-button>
            </div>
            <el-table :data="crdtDocuments" empty-text="No CRDT documents">
              <el-table-column prop="key" label="Key" min-width="260" />
              <el-table-column label="Scope" min-width="300">
                <template #default="{ row }">{{ crdtDocumentScope(row) }}</template>
              </el-table-column>
              <el-table-column prop="schemaVersion" label="Schema" width="90" />
              <el-table-column label="Heads" width="90">
                <template #default="{ row }">{{ row.heads.length }}</template>
              </el-table-column>
              <el-table-column prop="changeCount" label="Changes" width="100" />
              <el-table-column label="Snapshot" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.snapshotPresent ? 'success' : 'info'">{{ row.snapshotPresent ? 'yes' : 'no' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="Latest Change" min-width="280">
                <template #default="{ row }">{{ crdtLatestChange(row) }}</template>
              </el-table-column>
              <el-table-column label="Latest Actor" min-width="180">
                <template #default="{ row }">{{ row.latestChange?.actorId ?? row.latestChange?.clientId ?? '-' }}</template>
              </el-table-column>
              <el-table-column label="Latest Received" min-width="190">
                <template #default="{ row }">{{ row.latestChange?.receivedAt ?? '-' }}</template>
              </el-table-column>
              <el-table-column prop="updatedAt" label="Updated" min-width="190" />
            </el-table>
          </section>

          <section v-else-if="activeView === 'members'" class="view">
            <el-table :data="members" empty-text="No members">
              <el-table-column prop="displayName" label="Name" min-width="160" />
              <el-table-column prop="handle" label="Handle" width="140" />
              <el-table-column prop="branchKey" label="Branch" width="150" />
              <el-table-column label="Status" width="120">
                <template #default="{ row }">
                  <el-tag :type="memberStatusType(row.status)">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="clientId" label="Client" min-width="260" />
              <el-table-column prop="tokenExpiresAt" label="Token Expires" min-width="190" />
              <el-table-column label="Actions" width="220" fixed="right">
                <template #default="{ row }">
                  <el-button-group>
                    <el-button
                      :disabled="row.status === 'disabled'"
                      :icon="Refresh"
                      size="small"
                      @click="rotateMemberTokenRow(row)"
                    >
                      Rotate
                    </el-button>
                    <el-button
                      :disabled="row.status === 'disabled'"
                      :icon="Lock"
                      size="small"
                      type="danger"
                      @click="disableMemberRow(row)"
                    >
                      Disable
                    </el-button>
                  </el-button-group>
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
              <el-table-column label="Branch" width="150">
                <template #default="{ row }">{{ projectBranchKey(row) }}</template>
              </el-table-column>
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
              <el-table-column label="Actions" width="190" fixed="right">
                <template #default="{ row }">
                  <el-button-group>
                    <el-button :icon="Collection" size="small" @click="openProjectBranch(row)">Branch</el-button>
                    <el-button :icon="Lock" size="small" @click="openProjectAcl(row)">ACL</el-button>
                  </el-button-group>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <section v-else-if="activeView === 'glossary'" class="view">
            <div class="toolbar">
              <el-button :icon="Plus" type="primary" @click="openGlossaryDialog()">New Term</el-button>
              <el-select v-model="glossaryBranchKey" class="layer-select" placeholder="Branch" clearable @change="reloadGlossary">
                <el-option v-for="branch in branches" :key="branch.branchKey" :label="branch.displayName" :value="branch.branchKey" />
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
              <el-table-column label="Branch" width="140">
                <template #default="{ row }">{{ knowledgeBranchKey(row) }}</template>
              </el-table-column>
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
              <el-table-column label="Actions" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button :icon="Connection" size="small" @click="openKnowledgePublishDialog(row)">Publish</el-button>
                </template>
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
              <el-table-column label="Branch" width="150">
                <template #default="{ row }">{{ knowledgeEdgeBranchKey(row) }}</template>
              </el-table-column>
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
              <el-table-column label="Branch" width="150">
                <template #default="{ row }">{{ auditLogBranchKey(row) }}</template>
              </el-table-column>
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
        <el-form-item label="Branch">
          <el-select v-model="inviteForm.branchKey" filterable>
            <el-option v-for="branch in branches" :key="branch.branchKey" :label="branch.displayName" :value="branch.branchKey" />
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

    <el-dialog v-model="rotatedTokenDialogOpen" title="Rotated Token" width="640px">
      <el-descriptions v-if="rotatedToken" :column="1" border>
        <el-descriptions-item label="Member">{{ rotatedToken.memberId }}</el-descriptions-item>
        <el-descriptions-item label="Client">{{ rotatedToken.clientId }}</el-descriptions-item>
        <el-descriptions-item label="Access Token">
          <span class="secret-value">{{ rotatedToken.accessToken }}</span>
        </el-descriptions-item>
        <el-descriptions-item v-if="rotatedToken.syncSigningSecret" label="Sync Secret">
          <span class="secret-value">{{ rotatedToken.syncSigningSecret }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="Expires">{{ rotatedToken.expiresAt }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="rotatedTokenDialogOpen = false">Close</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="branchDialogOpen" title="New Knowledge Branch" width="520px">
      <el-form label-position="top">
        <el-form-item label="Branch">
          <el-input v-model="branchForm.branchKey" />
        </el-form-item>
        <el-form-item label="Name">
          <el-input v-model="branchForm.displayName" />
        </el-form-item>
        <el-form-item label="Join Mode">
          <el-select v-model="branchForm.joinMode">
            <el-option label="invite" value="invite" />
            <el-option label="open" value="open" />
            <el-option label="admin" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="Description">
          <el-input v-model="branchForm.description" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="branchDialogOpen = false">Cancel</el-button>
        <el-button type="primary" @click="submitBranch">Create</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="branchMergePreviewDialogOpen" title="Branch Merge Preview" width="900px">
      <el-form label-position="top">
        <el-form-item label="Source Branch">
          <el-select v-model="branchMergePreviewForm.sourceBranchKey" filterable @change="reloadBranchMergePreview">
            <el-option
              v-for="branch in branches"
              :key="branch.branchKey"
              :disabled="branch.branchKey === branchMergePreviewForm.targetBranchKey"
              :label="branch.displayName"
              :value="branch.branchKey"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Target Branch">
          <el-select v-model="branchMergePreviewForm.targetBranchKey" filterable @change="reloadBranchMergePreview">
            <el-option
              v-for="branch in branches"
              :key="branch.branchKey"
              :disabled="branch.branchKey === branchMergePreviewForm.sourceBranchKey"
              :label="branch.displayName"
              :value="branch.branchKey"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Reason">
          <el-input v-model="branchMergePreviewForm.reason" type="textarea" />
        </el-form-item>
      </el-form>
      <el-alert
        v-if="branchMergeBulkPublishResult"
        :title="`Published ${branchMergeBulkPublishResult.published.length}, rejected ${branchMergeBulkPublishResult.rejected.length}`"
        class="alert"
        type="success"
        show-icon
      />
      <el-descriptions v-if="branchMergePreview" :column="5" border>
        <el-descriptions-item label="Source">{{ branchMergePreview.summary.sourceKnowledge }}</el-descriptions-item>
        <el-descriptions-item label="Target">{{ branchMergePreview.summary.targetKnowledge }}</el-descriptions-item>
        <el-descriptions-item label="Publishable">{{ branchMergePreview.summary.publishable }}</el-descriptions-item>
        <el-descriptions-item label="Published">{{ branchMergePreview.summary.alreadyPublished }}</el-descriptions-item>
        <el-descriptions-item label="Conflicts">{{ branchMergePreview.summary.possibleConflicts }}</el-descriptions-item>
      </el-descriptions>
      <el-table
        v-if="branchMergePreview"
        :data="branchMergePreview.items"
        class="dialog-table"
        empty-text="No merge candidates"
      >
        <el-table-column width="54">
          <template #default="{ row }">
            <el-checkbox
              :model-value="isBranchMergePreviewRowSelected(row)"
              :disabled="!isBranchMergePreviewRowSelectable(row)"
              @change="(value: unknown) => toggleBranchMergePreviewRow(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column label="Status" width="150">
          <template #default="{ row }">
            <el-tag :type="branchMergePreviewStatusType(row.status)">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Source" min-width="240">
          <template #default="{ row }">{{ row.source.title }}</template>
        </el-table-column>
        <el-table-column label="Target" min-width="240">
          <template #default="{ row }">{{ row.target?.title ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="Reason" min-width="260" />
      </el-table>
      <template #footer>
        <el-button @click="branchMergePreviewDialogOpen = false">Close</el-button>
        <el-button
          :disabled="branchMergeSelectedSourceIds.length === 0"
          type="success"
          @click="submitBranchMergeBulkPublish"
        >
          Publish Selected
        </el-button>
        <el-button type="primary" @click="reloadBranchMergePreview">Refresh</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="projectDialogOpen" title="New Project" width="520px">
      <el-form label-position="top">
        <el-form-item label="Branch">
          <el-select v-model="projectForm.branchKey" filterable>
            <el-option
              v-for="branch in branches"
              :key="branch.branchKey"
              :label="branch.displayName"
              :value="branch.branchKey"
            />
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

    <el-dialog v-model="projectBranchDialogOpen" title="Project Branch" width="520px">
      <el-form label-position="top">
        <el-form-item label="Project">
          <el-input :model-value="selectedBranchProject?.name ?? ''" disabled />
        </el-form-item>
        <el-form-item label="Branch">
          <el-select v-model="projectBranchForm.branchKey" filterable>
            <el-option
              v-for="branch in branches"
              :key="branch.branchKey"
              :label="branch.displayName"
              :value="branch.branchKey"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="projectBranchDialogOpen = false">Cancel</el-button>
        <el-button type="primary" @click="submitProjectBranch">Save</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="glossaryDialogOpen" title="Glossary Term" width="560px">
      <el-form label-position="top">
        <el-form-item label="Branch">
          <el-select v-model="glossaryForm.branchKey" filterable>
            <el-option v-for="branch in branches" :key="branch.branchKey" :label="branch.displayName" :value="branch.branchKey" />
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

    <el-dialog v-model="knowledgePublishDialogOpen" title="Publish Knowledge" width="560px">
      <el-form label-position="top">
        <el-form-item label="Source">
          <el-input :model-value="selectedPublishKnowledge?.title ?? ''" disabled />
        </el-form-item>
        <el-form-item label="From Branch">
          <el-input :model-value="selectedPublishKnowledge ? knowledgeBranchKey(selectedPublishKnowledge) : ''" disabled />
        </el-form-item>
        <el-form-item label="Target Branch">
          <el-select v-model="knowledgePublishForm.targetBranchKey" filterable>
            <el-option
              v-for="branch in branches"
              :key="branch.branchKey"
              :disabled="selectedPublishKnowledge !== null && branch.branchKey === knowledgeBranchKey(selectedPublishKnowledge)"
              :label="branch.displayName"
              :value="branch.branchKey"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Reason">
          <el-input v-model="knowledgePublishForm.reason" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="knowledgePublishDialogOpen = false">Cancel</el-button>
        <el-button :disabled="!knowledgePublishForm.targetBranchKey" type="primary" @click="submitKnowledgePublish">
          Publish
        </el-button>
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
        <el-form-item label="Branch">
          <el-select v-model="edgeForm.branchKey" clearable filterable>
            <el-option v-for="branch in branches" :key="branch.branchKey" :label="branch.displayName" :value="branch.branchKey" />
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
