import type {
  AdminOverview,
  AuditLog,
  GroupInput,
  GroupSummary,
  KnowledgeItem,
  MemberSummary,
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
