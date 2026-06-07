import type { ProjectAccess, ProjectSummary, SyncEvent } from '@mcp-dev-mesh/protocol';

export const DEFAULT_LOCAL_INVITE_TOKEN = 'devmesh-local-invite';
export const DEFAULT_GROUP_KEY = 'default';
export const ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface HubGroupSeed {
  key: string;
  displayName?: string;
  description?: string;
  joinMode?: 'invite' | 'open' | 'admin';
}

export interface HubInviteSeed {
  token: string;
  groupKey: string;
  expiresAt?: string;
  maxUses?: number;
}

export interface HubProjectSeed {
  id: string;
  groupKey: string;
  name?: string;
  projectKey?: string;
  description?: string;
  createdByMemberId?: string;
  createdAt?: string;
  access?: ProjectAccess;
}

export interface HubStateOptions {
  groups?: HubGroupSeed[];
  invites?: HubInviteSeed[];
  projects?: HubProjectSeed[];
}

export interface HubAuthContext {
  memberId: string;
  clientId: string;
  groupKey: string;
  syncSigningSecret: string;
}

export interface HubError {
  statusCode: number;
  code: string;
  message: string;
}

export type HubResult<T> = { ok: true; value: T } | { ok: false; error: HubError };

export interface HubGroup {
  key: string;
  displayName: string;
  joinMode: 'invite' | 'open' | 'admin';
  description?: string;
}

export interface HubInvite {
  token: string;
  groupKey: string;
  uses: number;
  createdAt: string;
  createdBy: string;
  expiresAt?: string;
  maxUses?: number;
  revokedAt?: string;
  revokedBy?: string;
}

export interface HubMember {
  memberId: string;
  clientId: string;
  groupKey: string;
  displayName: string;
  handle: string;
  joinedAt: string;
  status: 'active' | 'disabled';
  disabledAt?: string;
  disabledReason?: string;
}

export interface HubAccessToken extends HubAuthContext {
  token: string;
  expiresAt: string;
}

export interface HubAuditLog {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  groupKey?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export type HubKnowledgeEdgeKind = 'supersedes' | 'duplicates' | 'contradicts';

export interface HubKnowledgeEdge {
  id: string;
  kind: HubKnowledgeEdgeKind;
  fromId: string;
  toId: string;
  createdBy: string;
  createdAt: string;
  groupKey?: string;
  reason?: string;
}

export interface HubSyncEvent extends SyncEvent {
  createdAt: string;
  clientId: string;
  groupKey: string;
  acceptedAt: string;
}

export interface HubState {
  groups: Map<string, HubGroup>;
  invites: Map<string, HubInvite>;
  members: Map<string, HubMember>;
  tokens: Map<string, HubAccessToken>;
  projects: Map<string, ProjectSummary>;
  knowledgeEdges: HubKnowledgeEdge[];
  syncEvents: Map<string, HubSyncEvent[]>;
  federationCursors: Map<string, string>;
  auditLogs: HubAuditLog[];
}
