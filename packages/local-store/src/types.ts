import type {
  CaptureKnowledgeInput,
  KnowledgeItem,
  KnowledgeLayer,
  KnowledgeVisibility,
  MemberIdentity,
  ParaRef,
  RateKnowledgeInput
} from '@devmesh/core';

export const DEV_MESH_DIR = '.dev-mesh';
export const PROJECT_STORE_SCHEMA_VERSION = 1;

export interface ProjectStorePaths {
  root: string;
  config: string;
  eventsDir: string;
  knowledgeDir: string;
  indexDir: string;
  queueDir: string;
  syncDir: string;
  secretsDir: string;
}

export interface ProjectStore {
  projectRoot: string;
  storeRoot: string;
  paths: ProjectStorePaths;
}

export interface EnsureProjectStoreOptions {
  projectKey?: string;
  displayName?: string;
}

export interface DevMeshEvent {
  id: string;
  kind: string;
  projectKey: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface ProjectConfig {
  schemaVersion: number;
  projectKey: string;
  displayName: string;
  localOnly: boolean;
  automation: {
    autoInit: boolean;
    autoReference: boolean;
    autoSync: boolean;
  };
  privacy: {
    redactionEnabled: boolean;
    uploadRawTranscripts: boolean;
    uploadLargeSourceBlocks: boolean;
  };
}

export interface ProjectIndexDocument {
  id: string;
  entryKey: string;
  layer: KnowledgeLayer;
  type: string;
  title: string;
  summary: string;
  text: string;
  tags: string[];
  updatedAt: string;
}

export interface RebuildProjectIndexResult {
  indexPath: string;
  sqlitePath: string;
  documentCount: number;
  rebuiltAt: string;
  schemaVersion: number;
}

export interface ProjectIndexSearchResult {
  id: string;
  score: number;
}

export type ReviewQueueRisk = 'medium' | 'high';

export interface EnqueuePendingKnowledgeOptions {
  reason?: string;
  risk?: ReviewQueueRisk;
  projectKey?: string;
}

export interface PendingKnowledgeReviewItem {
  id: string;
  kind: 'knowledge';
  risk: ReviewQueueRisk;
  reason: string;
  projectKey: string;
  createdAt: string;
  input: CaptureKnowledgeInput;
}

export interface RejectedKnowledgeReviewItem extends PendingKnowledgeReviewItem {
  status: 'rejected';
  rejectedAt: string;
  rejectedReason: string;
}

export interface AcceptPendingKnowledgeResult {
  queueItem: PendingKnowledgeReviewItem;
  item: KnowledgeItem;
  event: DevMeshEvent;
}

export interface RejectPendingKnowledgeResult {
  queueItem: RejectedKnowledgeReviewItem;
  event: DevMeshEvent;
}

export interface ProjectCaptureOptions {
  projectKey?: string;
}

export interface CaptureProjectKnowledgeResult {
  item: KnowledgeItem;
  event: DevMeshEvent;
}

export type ProjectTaskStatus = 'pending' | 'in-progress' | 'blocked' | 'done';

export interface CaptureProjectTaskInput {
  title: string;
  summary: string;
  status?: ProjectTaskStatus;
  content?: string;
  tags?: string[];
  para?: ParaRef;
  createdBy?: MemberIdentity;
  visibility?: KnowledgeVisibility;
}

export interface CaptureProjectTaskResult {
  item: KnowledgeItem;
  event: DevMeshEvent;
  status: ProjectTaskStatus;
}

export interface RateProjectKnowledgeOptions extends ProjectCaptureOptions {
  reason?: string;
  createdBy?: MemberIdentity;
}

export interface KnowledgeRatingRecord {
  id: string;
  knowledgeId: string;
  projectKey: string;
  createdAt: string;
  rating?: number;
  adoptionDelta?: number;
  confidenceDelta?: number;
  weightDelta?: number;
  reason?: string;
  createdBy?: MemberIdentity;
  quality: KnowledgeItem['quality'];
}

export interface RateProjectKnowledgeResult {
  item: KnowledgeItem;
  rating: KnowledgeRatingRecord;
  event: DevMeshEvent;
}

export type RatingInput = RateKnowledgeInput;

export type KnowledgeUsageKind = 'context_pack.hit' | 'review.accepted' | string;

export interface KnowledgeUsageInput {
  knowledgeId: string;
  kind: KnowledgeUsageKind;
  adoptionDelta?: number;
  confidenceDelta?: number;
  weightDelta?: number;
  context?: Record<string, unknown>;
}

export interface KnowledgeUsageOptions extends ProjectCaptureOptions {
  reason?: string;
  createdBy?: MemberIdentity;
}

export interface KnowledgeUsageRecord {
  id: string;
  knowledgeId: string;
  projectKey: string;
  kind: KnowledgeUsageKind;
  createdAt: string;
  adoptionDelta?: number;
  confidenceDelta?: number;
  weightDelta?: number;
  reason?: string;
  context?: Record<string, unknown>;
  createdBy?: MemberIdentity;
  quality: KnowledgeItem['quality'];
}

export interface RecordKnowledgeUsageResult {
  item: KnowledgeItem;
  usage: KnowledgeUsageRecord;
  event: DevMeshEvent;
}
