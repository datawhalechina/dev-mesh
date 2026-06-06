import type {
  AdminOverview,
  AuditLog,
  GlossaryInput,
  GroupInput,
  GroupSummary,
  InviteInput,
  InviteSummary,
  KnowledgeItem,
  MemberSummary,
  ProjectAclInput,
  ProjectInput,
  ProjectSummary,
  ReviewQueueItem
} from './types.js';

export async function fetchAdminOverview(): Promise<AdminOverview> {
  return requestJson<AdminOverview>('/api/v1/admin/overview');
}

export async function fetchGroups(): Promise<GroupSummary[]> {
  const response = await requestJson<{ groups: GroupSummary[] }>('/api/v1/admin/groups');

  return response.groups;
}

export async function createGroup(input: GroupInput): Promise<GroupSummary> {
  return requestJson<GroupSummary>('/api/v1/admin/groups', {
    method: 'POST',
    body: input
  });
}

export async function fetchMembers(): Promise<MemberSummary[]> {
  const response = await requestJson<{ members: MemberSummary[] }>('/api/v1/admin/members');

  return response.members;
}

export async function disableMember(memberId: string, reason?: string): Promise<MemberSummary> {
  return requestJson<MemberSummary>(`/api/v1/admin/members/${encodeURIComponent(memberId)}/disable`, {
    method: 'POST',
    body: reason ? { reason } : {}
  });
}

export async function fetchInvites(): Promise<InviteSummary[]> {
  const response = await requestJson<{ invites: InviteSummary[] }>('/api/v1/admin/invites');

  return response.invites;
}

export async function createInvite(input: InviteInput): Promise<InviteSummary> {
  return requestJson<InviteSummary>('/api/v1/admin/invites', {
    method: 'POST',
    body: input
  });
}

export async function revokeInvite(token: string): Promise<InviteSummary> {
  return requestJson<InviteSummary>(`/api/v1/admin/invites/${encodeURIComponent(token)}`, {
    method: 'DELETE'
  });
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const response = await requestJson<{ projects: ProjectSummary[] }>('/api/v1/admin/projects');

  return response.projects;
}

export async function createProject(input: ProjectInput): Promise<ProjectSummary> {
  return requestJson<ProjectSummary>('/api/v1/admin/projects', {
    method: 'POST',
    body: input
  });
}

export async function updateProjectAcl(groupKey: string, projectId: string, input: ProjectAclInput): Promise<ProjectSummary> {
  return requestJson<ProjectSummary>(
    `/api/v1/admin/projects/${encodeURIComponent(groupKey)}/${encodeURIComponent(projectId)}/acl`,
    {
      method: 'PUT',
      body: input
    }
  );
}

export async function fetchKnowledge(layer = '', query = ''): Promise<KnowledgeItem[]> {
  const params = new URLSearchParams();

  if (layer) {
    params.set('layer', layer);
  }

  if (query.trim()) {
    params.set('query', query.trim());
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await requestJson<{ items: KnowledgeItem[] }>(`/api/v1/admin/knowledge${suffix}`);

  return response.items;
}

export async function fetchGlossary(query = '', groupKey = '', projectKey = ''): Promise<KnowledgeItem[]> {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set('query', query.trim());
  }

  if (groupKey) {
    params.set('groupKey', groupKey);
  }

  if (projectKey.trim()) {
    params.set('projectKey', projectKey.trim());
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await requestJson<{ items: KnowledgeItem[] }>(`/api/v1/admin/glossary${suffix}`);

  return response.items;
}

export async function createGlossaryItem(input: GlossaryInput): Promise<KnowledgeItem> {
  return requestJson<KnowledgeItem>('/api/v1/admin/glossary', {
    method: 'POST',
    body: input
  });
}

export async function updateGlossaryItem(id: string, input: GlossaryInput): Promise<KnowledgeItem> {
  return requestJson<KnowledgeItem>(`/api/v1/admin/glossary/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input
  });
}

export async function fetchReviewQueue(): Promise<ReviewQueueItem[]> {
  const response = await requestJson<{ items: ReviewQueueItem[] }>('/api/v1/admin/review-queue');

  return response.items;
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const response = await requestJson<{ auditLogs: AuditLog[] }>('/api/v1/admin/audit');

  return response.auditLogs;
}

async function requestJson<T>(url: string, init: ApiRequestInit = {}): Promise<T> {
  const { body: requestPayload, ...rest } = init;
  const headers = new Headers(init.headers);
  const request: RequestInit = {
    ...rest,
    headers
  };

  if (requestPayload !== undefined) {
    headers.set('content-type', 'application/json');
    request.body = JSON.stringify(requestPayload);
  }

  const response = await fetch(url, request);
  const text = await response.text();
  const responsePayload = text ? (JSON.parse(text) as T | ApiError) : ({} as T);

  if (!response.ok) {
    const error = (responsePayload as ApiError).error;
    throw new Error(error ? `${error.code}: ${error.message}` : `Request failed with ${response.status}`);
  }

  return responsePayload as T;
}

interface ApiError {
  error?: {
    code: string;
    message: string;
  };
}

interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
}
