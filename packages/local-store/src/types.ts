import type {
  CaptureKnowledgeInput,
  DeleteKnowledgeInput,
  KnowledgeItem,
  KnowledgeLayer,
  KnowledgeType,
  KnowledgeVisibility,
  MemberIdentity,
  ParaRef,
  RateKnowledgeInput,
  UpdateKnowledgeInput
} from '@devmesh/core';
import type {
  ExploreKnowledgeGraphInput,
  ExploreKnowledgeGraphResult,
  KnowledgeGraph,
  KnowledgeGraphSemanticEdgeKind
} from '@devmesh/graph';

export const DEV_MESH_DIR = '.dev-mesh';
export const PROJECT_STORE_SCHEMA_VERSION = 3;
export const KNOWLEDGE_BRANCH_POLICY_PRESETS = [
  'balanced',
  'durable_only',
  'frontend_design',
  'backend_design'
] as const;

export type KnowledgeBranchPolicyPreset = (typeof KNOWLEDGE_BRANCH_POLICY_PRESETS)[number];

export interface KnowledgeBranchDefinition {
  name: string;
  policy: KnowledgeBranchPolicyPreset;
}

export interface ProjectStorePaths {
  root: string;
  config: string;
  stateDir: string;
  eventsDir: string;
  crdtDir: string;
  crdtSyncDir: string;
  exportsDir: string;
  knowledgeDir: string;
  indexDir: string;
  visualizationsDir: string;
  queueDir: string;
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
  knowledgeBranch: {
    active: string;
    base?: string;
    branches: KnowledgeBranchDefinition[];
  };
  knowledge: {
    autoCaptureTypes: KnowledgeType[];
    includeVolatileInContext: boolean;
  };
  privacy: {
    redactionEnabled: boolean;
    uploadRawTranscripts: boolean;
    uploadLargeSourceBlocks: boolean;
  };
}

export interface ProjectIndexDocument {
  id: string;
  branch: string;
  entryKey: string;
  layer: KnowledgeLayer;
  type: string;
  includeInDefaultContext: boolean;
  expiresAt?: string;
  title: string;
  summary: string;
  text: string;
  tags: string[];
  updatedAt: string;
}

export interface RebuildProjectIndexResult {
  indexPath: string;
  sqlitePath: string;
  knowledgePath: string;
  searchPath: string;
  graphPath: string;
  documentCount: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  rebuiltAt: string;
  schemaVersion: number;
}

export interface ProjectedKnowledgeQuality {
  knowledgeId: string;
  reliability: number;
  usefulness: number;
  freshness: number;
  priority: number;
  score: number;
  signalCount: number;
  updatedAt: string;
}

export interface ProjectQualityProjection {
  schemaVersion: number;
  algorithmVersion: number;
  rebuiltAt: string;
  sourceHeads: string[];
  qualityCount: number;
  qualities: Record<string, ProjectedKnowledgeQuality>;
}

export interface RebuildProjectProjectionResult extends RebuildProjectIndexResult {
  qualityPath: string;
  qualityCount: number;
  qualityAlgorithmVersion: number;
}

export type ProjectProjectionStatusState =
  | 'missing_crdt'
  | 'missing'
  | 'schema_mismatch'
  | 'corrupt'
  | 'dirty'
  | 'ready';

export interface ProjectProjectionFileStatus {
  path: string;
  role: 'manifest' | 'knowledge' | 'search' | 'sqlite' | 'graph' | 'quality' | 'metadata';
  state: 'missing' | 'corrupt' | 'schema_mismatch' | 'ready';
  schemaVersion?: number;
  expectedSchemaVersion?: number;
  message?: string;
}

export interface ProjectProjectionMetadata {
  schemaVersion: number;
  backend?: string;
  source: string;
  sourceHeads: string[];
  rebuiltAt: string;
  documentCount: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  qualityCount?: number;
  qualityAlgorithmVersion?: number;
  qualityPath?: string;
  projectionFiles?: ProjectProjectionFileStatus[];
}

export interface ProjectProjectionStatus {
  state: ProjectProjectionStatusState;
  backend?: string;
  schemaVersion?: number;
  expectedSchemaVersion?: number;
  metadataPath: string;
  crdtPath: string;
  currentHeads: string[];
  sourceHeads: string[];
  message: string;
  projectionFiles?: ProjectProjectionFileStatus[];
  rebuiltAt?: string;
  documentCount?: number;
  graphNodeCount?: number;
  graphEdgeCount?: number;
  qualityCount?: number;
  qualityAlgorithmVersion?: number;
  qualityPath?: string;
}

export interface RebuildProjectGraphResult {
  graphPath: string;
  nodeCount: number;
  edgeCount: number;
  sourceItemCount: number;
  rebuiltAt: string;
  schemaVersion: number;
}

export type ProjectKnowledgeGraph = KnowledgeGraph & {
  schemaVersion: number;
};

export type ProjectKnowledgeGraphExploreResult = ExploreKnowledgeGraphResult;
export type ProjectKnowledgeGraphExploreInput = ExploreKnowledgeGraphInput;

export interface ProjectKnowledgeEdge {
  id: string;
  kind: KnowledgeGraphSemanticEdgeKind;
  fromId: string;
  toId: string;
  projectKey: string;
  branch?: string;
  createdAt: string;
  reason?: string;
  createdBy?: MemberIdentity;
}

export interface CreateProjectKnowledgeEdgeInput {
  kind: KnowledgeGraphSemanticEdgeKind;
  fromId: string;
  toId: string;
  branch?: string;
  reason?: string;
  createdBy?: MemberIdentity;
}

export interface ProjectKnowledgeEdgeQuery {
  kind?: KnowledgeGraphSemanticEdgeKind;
  fromId?: string;
  toId?: string;
  branch?: string;
}

export interface CreateProjectKnowledgeEdgeResult {
  edge: ProjectKnowledgeEdge;
  event: DevMeshEvent;
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
  branch?: string;
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
  branch?: string;
}

export interface ProjectBranchScope {
  active: string;
  base?: string;
  readable: string[];
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

export interface UpdateProjectKnowledgeOptions extends ProjectCaptureOptions {
  reason?: string;
  createdBy?: MemberIdentity;
}

export type UpdateProjectKnowledgeInput = UpdateKnowledgeInput;

export interface UpdateProjectKnowledgeResult {
  item: KnowledgeItem;
  event: DevMeshEvent;
}

export interface DeleteProjectKnowledgeOptions extends ProjectCaptureOptions {
  reason?: string;
  createdBy?: MemberIdentity;
}

export type DeleteProjectKnowledgeInput = DeleteKnowledgeInput;

export interface DeleteProjectKnowledgeResult {
  item: KnowledgeItem;
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
