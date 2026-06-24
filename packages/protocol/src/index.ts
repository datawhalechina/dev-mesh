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
  branch?: string;
  displayName: string;
  handle?: string;
  clientLabel?: string;
  hostname?: string;
  tools?: string[];
  automation?: {
    autoInit?: boolean;
    autoReference?: boolean;
    autoSync?: boolean;
  };
}

export interface JoinResponse {
  memberId: string;
  clientId: string;
  branch: string;
  accessToken: string;
  syncSigningSecret?: string;
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
  branch: string;
  name: string;
  description?: string;
  createdByMemberId: string;
  createdAt: string;
  access?: ProjectAccess;
}

export type ProjectAclVisibility = 'branch' | 'restricted';
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
  signature?: SyncEventSignature;
  log?: SyncEventLogMetadata;
}

export interface SyncEventSignature {
  algorithm: 'hmac-sha256';
  value: string;
  signedAt?: string;
  keyId?: string;
}

export interface SyncEventLogMetadata {
  sequence: number;
  hash: string;
  previousHash?: string;
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

export type CrdtSyncDocumentKind = 'project' | 'server-global' | 'branch' | (string & {});

export interface CrdtSyncDocumentRef {
  kind: CrdtSyncDocumentKind;
  branch?: string;
  projectKey?: string;
  documentId?: string;
  namespace?: string;
  schemaVersion?: number;
}

export interface CrdtSyncChange {
  id?: string;
  engine: 'automerge';
  encoding: 'base64';
  bytes: string;
  headsBefore: string[];
  headsAfter: string[];
  actorId?: string;
  createdAt?: string;
  summary?: string;
}

export interface CrdtSyncExchangeRequest {
  clientId: string;
  /**
   * Transitional shortcut for project documents. New clients should prefer
   * document.projectKey so all CRDT sync messages share one explicit scope.
   */
  projectKey?: string;
  document?: CrdtSyncDocumentRef;
  heads: string[];
  changes: CrdtSyncChange[];
  maxChanges?: number;
}

export interface CrdtSyncAcceptedChange {
  id: string;
  headsAfter: string[];
}

export interface CrdtSyncRejectedChange {
  index: number;
  reason: string;
  id?: string;
}

export interface CrdtSyncProjectionCheckpoint {
  materialized: boolean;
  sourceHeads: string[];
  updatedAt?: string;
}

export interface CrdtSyncExchangeResponse {
  document: CrdtSyncDocumentRef;
  acceptedChanges: CrdtSyncAcceptedChange[];
  rejected: CrdtSyncRejectedChange[];
  heads: string[];
  changes: CrdtSyncChange[];
  projection?: CrdtSyncProjectionCheckpoint;
}

export function createDefaultWellKnown(baseUrl = 'http://127.0.0.1:8721'): WellKnownDevMesh {
  return {
    serverName: 'DevMesh',
    serverId: 'mesh_local',
    baseUrl,
    mcpUrl: `${baseUrl.replace(/\/$/, '')}/mcp`,
    groups: {
      required: true,
      defaultJoinMode: 'invite'
    },
    install: {
      npmPackage: 'devmesh',
      command: 'npm install -g devmesh'
    },
    minClientVersion: '0.1.0'
  };
}
