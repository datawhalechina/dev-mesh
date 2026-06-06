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
  KnowledgeItem,
  MemberSummary,
  ProjectAclInput,
  ProjectInput,
  ProjectSummary,
  QualityReviewFilters,
  QualityReviewResponse,
  ReviewQueueItem,
  TaskDigestFilters,
  TaskDigestResponse
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

export async function fetchKnowledge(layer = '', query = '', includeSuperseded = false): Promise<KnowledgeItem[]> {
  const params = new URLSearchParams();

  if (layer) {
    params.set('layer', layer);
  }

  if (query.trim()) {
    params.set('query', query.trim());
  }

  if (includeSuperseded) {
    params.set('includeSuperseded', 'true');
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await requestJson<{ items: KnowledgeItem[] }>(`/api/v1/admin/knowledge${suffix}`);

  return response.items;
}

export async function fetchKnowledgeEdges(kind = '', groupKey = ''): Promise<KnowledgeEdge[]> {
  const params = new URLSearchParams();

  if (kind) {
    params.set('kind', kind);
  }

  if (groupKey) {
    params.set('groupKey', groupKey);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await requestJson<{ edges: KnowledgeEdge[] }>(`/api/v1/admin/knowledge-edges${suffix}`);

  return response.edges;
}

export async function createKnowledgeEdge(input: KnowledgeEdgeInput): Promise<KnowledgeEdge> {
  return requestJson<KnowledgeEdge>('/api/v1/admin/knowledge-edges', {
    method: 'POST',
    body: input
  });
}

export async function fetchQualityReview(input: QualityReviewFilters = {}): Promise<QualityReviewResponse> {
  const params = new URLSearchParams();

  if (input.layer) {
    params.set('layer', input.layer);
  }

  if (input.includeSuperseded !== undefined) {
    params.set('includeSuperseded', String(input.includeSuperseded));
  }

  setNumberParam(params, 'maxQualityScore', input.maxQualityScore);
  setNumberParam(params, 'maxConfidence', input.maxConfidence);
  setNumberParam(params, 'maxRating', input.maxRating);
  setNumberParam(params, 'maxAdoptionScore', input.maxAdoptionScore);
  setNumberParam(params, 'staleDays', input.staleDays);
  setNumberParam(params, 'limit', input.limit);

  const suffix = params.toString() ? `?${params.toString()}` : '';

  return requestJson<QualityReviewResponse>(`/api/v1/admin/quality-review${suffix}`);
}

export async function fetchTaskDigest(input: TaskDigestFilters = {}): Promise<TaskDigestResponse> {
  const params = new URLSearchParams();

  if (input.projectKey?.trim()) {
    params.set('projectKey', input.projectKey.trim());
  }

  if (input.status) {
    params.set('status', input.status);
  }

  if (input.includeDone !== undefined) {
    params.set('includeDone', String(input.includeDone));
  }

  if (input.includeSuperseded !== undefined) {
    params.set('includeSuperseded', String(input.includeSuperseded));
  }

  setNumberParam(params, 'limit', input.limit);

  const suffix = params.toString() ? `?${params.toString()}` : '';

  return requestJson<TaskDigestResponse>(`/api/v1/admin/task-digest${suffix}`);
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

function setNumberParam(params: URLSearchParams, key: string, value: number | undefined): void {
  if (value !== undefined && Number.isFinite(value)) {
    params.set(key, String(value));
  }
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
