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

export interface GroupSummary {
  key: string;
  displayName: string;
  description?: string;
  joinMode: 'invite' | 'open' | 'admin';
  projectCount: number;
  memberCount: number;
}

export interface MemberSummary {
  memberId: string;
  clientId: string;
  groupKey: string;
  displayName: string;
  handle: string;
  joinedAt: string;
  status: 'active' | 'disabled';
  disabledAt?: string;
  disabledReason?: string;
  tokenExpiresAt?: string;
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

export interface KnowledgeItem {
  id: string;
  layer: string;
  type: string;
  title: string;
  summary: string;
  content?: string;
  para: {
    category: string;
    key: string;
  };
  tags: string[];
  source: {
    kind: string;
    metadata?: Record<string, unknown>;
  };
  createdBy: {
    displayName: string;
    handle?: string;
  };
  createdAt: string;
  updatedAt: string;
  quality: {
    qualityScore: number;
    confidence: number;
    rating: number;
    adoptionScore: number;
  };
}

export interface ReviewQueueItem {
  id: string;
  title: string;
  reason: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  groupKey?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface InviteSummary {
  token: string;
  groupKey: string;
  uses: number;
  createdAt: string;
  createdBy: string;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';
  expiresAt?: string;
  maxUses?: number;
  revokedAt?: string;
  revokedBy?: string;
}

export interface GroupInput {
  key: string;
  displayName: string;
  description?: string;
  joinMode: 'invite' | 'open' | 'admin';
}

export interface ProjectInput {
  groupKey: string;
  id?: string;
  name: string;
  description?: string;
}

export interface InviteInput {
  groupKey: string;
  token?: string;
  expiresAt?: string;
  maxUses?: number;
}

export interface ProjectAclInput {
  visibility: ProjectAclVisibility;
  members: ProjectAclMember[];
}

export interface GlossaryInput {
  term: string;
  definition: string;
  content?: string;
  groupKey?: string;
  projectKey?: string;
  aliases?: string[];
  tags?: string[];
}
