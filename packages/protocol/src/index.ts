export interface WellKnownDevMesh {
  serverName: string;
  serverId: string;
  baseUrl: string;
  mcpUrl: string;
  groups: {
    required: boolean;
    defaultJoinMode: 'invite' | 'open' | 'admin';
  };
  install: {
    npmPackage: string;
    command: string;
  };
  minClientVersion: string;
  publicKeyFingerprint?: string;
}

export interface JoinRequest {
  inviteToken?: string;
  groupKey?: string;
  displayName: string;
  handle?: string;
  clientLabel?: string;
  hostname?: string;
  tools?: string[];
  automation?: {
    autoInit?: boolean;
    autoReference?: boolean;
    autoCapture?: boolean;
    autoSync?: boolean;
  };
}

export interface JoinResponse {
  memberId: string;
  clientId: string;
  groupKey: string;
  accessToken: string;
  expiresAt?: string;
}

/**
 * Public metadata for a server group. This is intentionally small because the
 * endpoint is discoverable before a member has joined the group.
 */
export interface ServerGroupSummary {
  key: string;
  displayName: string;
  description?: string;
  joinMode: 'invite' | 'open' | 'admin';
  projectCount: number;
  memberCount: number;
}

export interface GroupsResponse {
  groups: ServerGroupSummary[];
}

export interface CreateProjectRequest {
  id?: string;
  projectKey?: string;
  name: string;
  description?: string;
}

export interface ProjectSummary {
  id: string;
  projectKey: string;
  groupKey: string;
  name: string;
  description?: string;
  createdByMemberId: string;
  createdAt: string;
  access?: ProjectAccess;
}

export type ProjectAclVisibility = 'group' | 'restricted';
export type ProjectAclRole = 'owner' | 'maintainer' | 'member' | 'readonly';

export interface ProjectAclMember {
  memberId: string;
  role: ProjectAclRole;
}

export interface ProjectAccess {
  visibility: ProjectAclVisibility;
  members: ProjectAclMember[];
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface ProjectResponse {
  project: ProjectSummary;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface SyncEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

export interface SyncPushRequest {
  clientId: string;
  events: SyncEvent[];
}

export interface SyncPushResponse {
  accepted: number;
  rejected: Array<{
    id: string;
    reason: string;
  }>;
  cursor: string;
}

export interface SyncPullResponse {
  cursor: string;
  events: SyncEvent[];
}

export function createDefaultWellKnown(baseUrl = 'http://127.0.0.1:8721'): WellKnownDevMesh {
  return {
    serverName: 'MCP Dev Mesh',
    serverId: 'mesh_local',
    baseUrl,
    mcpUrl: `${baseUrl.replace(/\/$/, '')}/mcp`,
    groups: {
      required: true,
      defaultJoinMode: 'invite'
    },
    install: {
      npmPackage: 'mcp-dev-mesh',
      command: 'npm install -g mcp-dev-mesh'
    },
    minClientVersion: '0.1.0'
  };
}
