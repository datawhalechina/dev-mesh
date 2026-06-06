<script setup lang="ts">
import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { Component } from 'vue';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  createInvite,
  createGroup,
  createProject,
  disableMember,
  fetchAdminOverview,
  fetchAuditLogs,
  fetchGroups,
  fetchInvites,
  fetchKnowledge,
  fetchMembers,
  fetchProjects,
  fetchReviewQueue,
  revokeInvite
} from './api.js';
import type {
  AdminOverview,
  AuditLog,
  GroupInput,
  GroupSummary,
  InviteInput,
  InviteSummary,
  KnowledgeItem,
  MemberSummary,
  ProjectInput,
  ProjectSummary,
  ReviewQueueItem
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
const knowledge = ref<KnowledgeItem[]>([]);
const reviewQueue = ref<ReviewQueueItem[]>([]);
const auditLogs = ref<AuditLog[]>([]);
const knowledgeLayer = ref('');
const knowledgeQuery = ref('');
const groupDialogOpen = ref(false);
const inviteDialogOpen = ref(false);
const projectDialogOpen = ref(false);
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

const navItems = [
  { key: 'overview', label: 'Overview', icon: DataAnalysis },
  { key: 'groups', label: 'Groups', icon: Collection },
  { key: 'members', label: 'Members', icon: User },
  { key: 'invites', label: 'Invites', icon: Lock },
  { key: 'projects', label: 'Projects', icon: Folder },
  { key: 'knowledge', label: 'Knowledge', icon: Document },
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

onMounted(() => {
  void refreshAll();
});

async function refreshAll(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';

  try {
    const [overviewData, groupData, memberData, inviteData, projectData, knowledgeData, queueData, auditData] = await Promise.all([
      fetchAdminOverview(),
      fetchGroups(),
      fetchMembers(),
      fetchInvites(),
      fetchProjects(),
      fetchKnowledge(knowledgeLayer.value, knowledgeQuery.value),
      fetchReviewQueue(),
      fetchAuditLogs()
    ]);

    overview.value = overviewData;
    groups.value = groupData;
    members.value = memberData;
    invites.value = inviteData;
    projects.value = projectData;
    knowledge.value = knowledgeData;
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
    knowledge.value = await fetchKnowledge(knowledgeLayer.value, knowledgeQuery.value);
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

interface InviteFormInput {
  groupKey: string;
  token: string;
  expiresAt: string;
  maxUses: string;
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
              <el-table-column prop="createdByMemberId" label="Created By" min-width="180" />
              <el-table-column prop="description" label="Description" min-width="220" />
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
              <el-button @click="reloadKnowledge">Apply</el-button>
            </div>
            <el-table :data="knowledge" empty-text="No knowledge">
              <el-table-column prop="title" label="Title" min-width="260" />
              <el-table-column prop="layer" label="Layer" width="120" />
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
  </el-config-provider>
</template>
