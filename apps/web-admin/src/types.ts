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
}

export interface KnowledgeItem {
  id: string;
  layer: string;
  type: string;
  title: string;
  summary: string;
  para: {
    category: string;
    key: string;
  };
  createdBy: {
    displayName: string;
    handle?: string;
  };
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
  createdAt: string;
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
