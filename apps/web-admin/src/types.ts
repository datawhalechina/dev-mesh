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

export interface RotatedAccessToken {
  memberId: string;
  clientId: string;
  groupKey: string;
  accessToken: string;
  syncSigningSecret?: string;
  expiresAt?: string;
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
export type KnowledgeStatus = 'active' | 'superseded' | 'tombstone';
export type KnowledgeEdgeKind = 'supersedes' | 'duplicates' | 'contradicts';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'unknown';

export interface ProjectAclMember {
  memberId: string;
  role: ProjectAclRole;
}

export interface ProjectAccess {
  visibility: ProjectAclVisibility;
  members: ProjectAclMember[];
}

export interface KnowledgeEdge {
  id: string;
  kind: KnowledgeEdgeKind;
  fromId: string;
  toId: string;
  createdBy: string;
  createdAt: string;
  groupKey?: string;
  reason?: string;
}

export interface QualityReviewSummary {
  totalKnowledge: number;
  needsReview: number;
  lowQuality: number;
  lowConfidence: number;
  lowRating: number;
  lowAdoption: number;
  stale: number;
  nonActive: number;
}

export interface QualityReviewItem {
  item: KnowledgeItem;
  reasons: string[];
  priority: 'high' | 'medium' | 'low';
  score: number;
}

export interface QualityReviewResponse {
  summary: QualityReviewSummary;
  items: QualityReviewItem[];
}

export interface TaskDigestSummary {
  totalTasks: number;
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  unknown: number;
}

export interface TaskDigestEntry {
  taskKey: string;
  title: string;
  status: TaskStatus;
  latestSummary: string;
  latestUpdatedAt: string;
  owners: string[];
  tags: string[];
  itemCount: number;
  items: KnowledgeItem[];
}

export interface TaskDigestResponse {
  summary: TaskDigestSummary;
  entries: TaskDigestEntry[];
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
  status: KnowledgeStatus;
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

export interface KnowledgeEdgeInput {
  kind: KnowledgeEdgeKind;
  fromId: string;
  toId: string;
  groupKey?: string;
  reason?: string;
}

export interface QualityReviewFilters {
  layer?: string;
  limit?: number;
  includeSuperseded?: boolean;
  maxQualityScore?: number;
  maxConfidence?: number;
  maxRating?: number;
  maxAdoptionScore?: number;
  staleDays?: number;
}

export interface TaskDigestFilters {
  projectKey?: string;
  status?: TaskStatus | '';
  limit?: number;
  includeDone?: boolean;
  includeSuperseded?: boolean;
}
