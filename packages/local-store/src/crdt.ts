import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeItem } from '@devmesh/core';
import {
  KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS,
  type KnowledgeGraphSemanticEdge,
  type KnowledgeGraphSemanticEdgeKind
} from '@devmesh/graph';
import {
  AutomergeFileCrdtBackend,
  createProjectDoc,
  createQualitySignal,
  getProjectAutomergePath,
  importV1JsonlToProjectDoc,
  type ImportV1JsonlToProjectDocInput,
  type AutomergeFileCrdtBackendOptions,
  type CrdtChangeInput,
  knowledgeItemToNode,
  touchProjectDoc,
  type BranchScope,
  type KnowledgeNode,
  type ProjectDoc,
  type QualitySignalKind,
  type RelationKind
} from '@devmesh/crdt-store';
import { ensureProjectStore, projectKeyOptions, readProjectConfigFile, readProjectKey } from './project-store.js';
import { LocalProjectionBackend } from './projection-backend.js';
import { writeJsonl } from './files.js';
import {
  type ProjectProjectionStatus,
  type RebuildProjectProjectionResult
} from './types.js';

export interface ProjectCrdtStoreResult {
  path: string;
  doc: ProjectDoc;
  heads: string[];
}

export interface ProjectCrdtSyncState {
  path: string;
  initialized: boolean;
  heads: string[];
  changeCount: number;
}

export interface ReadProjectCrdtChangesSinceResult extends ProjectCrdtSyncState {
  sinceHeads: string[];
  changes: Uint8Array[];
}

export interface ReadBranchCrdtChangesSinceResult extends BranchCrdtSyncState {
  sinceHeads: string[];
  changes: Uint8Array[];
}

export interface ApplyProjectCrdtChangesResult extends ProjectCrdtStoreResult {
  headsBefore: string[];
  headsAfter: string[];
  applied: number;
}

export interface BranchCrdtSyncState extends ProjectCrdtSyncState {
  branchKey: string;
}

export interface ApplyBranchCrdtChangesResult extends ApplyProjectCrdtChangesResult {
  branchKey: string;
}

export interface ImportProjectJsonlToCrdtOptions {
  projectKey?: string;
  actorId?: string;
  overwrite?: boolean;
}

export interface ImportProjectJsonlToCrdtResult extends ProjectCrdtStoreResult {
  importedKnowledge: number;
  importedRelations: number;
  importedQualitySignals: number;
  importedAuditEvents: number;
  skipped: number;
  sourceFiles: string[];
}

export interface RebuildProjectProjectionsFromCrdtOptions {
  projectKey?: string;
  actorId?: string;
}

export interface RebuildProjectProjectionsFromCrdtResult extends RebuildProjectProjectionResult {
  crdtPath: string;
  metadataPath: string;
  sourceHeads: string[];
}

export interface ExportProjectCrdtKnowledgeJsonlOptions {
  projectKey?: string;
  path?: string;
  includeTombstones?: boolean;
}

export interface ExportProjectCrdtKnowledgeJsonlResult {
  path: string;
  crdtPath: string;
  heads: string[];
  exportedKnowledge: number;
  skippedTombstones: number;
}

export interface UpsertProjectKnowledgeToCrdtOptions extends ImportProjectJsonlToCrdtOptions {
  summary?: string;
  now?: () => Date;
}

export interface UpsertProjectKnowledgeToCrdtResult extends ProjectCrdtStoreResult {
  knowledgeId: string;
}

export interface CreateProjectRelationInCrdtInput {
  id: string;
  kind: RelationKind;
  fromId: string;
  toId: string;
  evidenceKnowledgeIds?: string[];
  confidence?: number;
  createdAt: string;
  createdBy?: KnowledgeItem['createdBy'];
}

export interface CreateProjectRelationInCrdtOptions extends ImportProjectJsonlToCrdtOptions {
  summary?: string;
  now?: () => Date;
}

export interface CreateProjectRelationInCrdtResult extends ProjectCrdtStoreResult {
  relationId: string;
}

export interface CreateProjectQualitySignalInCrdtInput {
  id: string;
  knowledgeId: string;
  kind: QualitySignalKind;
  actorId?: string;
  value?: number;
  reason?: string;
  createdAt: string;
}

export interface CreateProjectQualitySignalInCrdtOptions extends ImportProjectJsonlToCrdtOptions {
  summary?: string;
  now?: () => Date;
}

export interface CreateProjectQualitySignalInCrdtResult extends ProjectCrdtStoreResult {
  qualitySignalId: string;
}

type AutomergeProjectDoc = ProjectDoc & Record<string, unknown>;
const PROJECT_CRDT_GENESIS_TIME = '1970-01-01T00:00:00.000Z';

export async function initializeProjectCrdtStore(
  projectRoot: string,
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<ProjectCrdtStoreResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const backend = await createProjectCrdtBackend(projectRoot, options);

  return {
    path: getProjectAutomergePath(store.storeRoot),
    doc: (await backend.load()) as ProjectDoc,
    heads: await backend.getHeads()
  };
}

export async function readProjectCrdtSyncState(
  projectRoot: string,
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<ProjectCrdtSyncState> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const path = getProjectAutomergePath(store.storeRoot);

  if (!(await pathExists(path))) {
    return {
      path,
      initialized: false,
      heads: [],
      changeCount: 0
    };
  }

  const backend = await createProjectCrdtBackend(projectRoot, options);

  return {
    path,
    initialized: true,
    heads: await backend.getHeads(),
    changeCount: (await backend.getAllChanges()).length
  };
}

export async function readProjectCrdtChangesSince(
  projectRoot: string,
  heads: string[],
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<ReadProjectCrdtChangesSinceResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const path = getProjectAutomergePath(store.storeRoot);
  const sinceHeads = [...heads];

  if (!(await pathExists(path))) {
    return {
      path,
      initialized: false,
      heads: [],
      changeCount: 0,
      sinceHeads,
      changes: []
    };
  }

  const backend = await createProjectCrdtBackend(projectRoot, options);
  let changes: Uint8Array[];

  try {
    changes = await backend.getChangesSince(sinceHeads);
  } catch {
    changes = await backend.getAllChanges();
  }

  const currentHeads = await backend.getHeads();

  return {
    path,
    initialized: true,
    heads: currentHeads,
    changeCount: (await backend.getAllChanges()).length,
    sinceHeads,
    changes
  };
}

export async function readBranchCrdtChangesSince(
  projectRoot: string,
  branchKey: string,
  heads: string[],
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<ReadBranchCrdtChangesSinceResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const path = getBranchAutomergePath(store.storeRoot, branchKey);
  const sinceHeads = [...heads];

  if (!(await pathExists(path))) {
    return {
      branchKey,
      path,
      initialized: false,
      heads: [],
      changeCount: 0,
      sinceHeads,
      changes: []
    };
  }

  const backend = await createBranchCrdtBackend(projectRoot, branchKey, options);
  let changes: Uint8Array[];

  try {
    changes = await backend.getChangesSince(sinceHeads);
  } catch {
    changes = await backend.getAllChanges();
  }

  return {
    branchKey,
    path,
    initialized: true,
    heads: await backend.getHeads(),
    changeCount: (await backend.getAllChanges()).length,
    sinceHeads,
    changes
  };
}

export async function applyProjectCrdtChanges(
  projectRoot: string,
  changes: Uint8Array[],
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<ApplyProjectCrdtChangesResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const backend = await createProjectCrdtBackend(projectRoot, options);
  const result = await backend.applyAutomergeChanges(changes);

  return {
    path: getProjectAutomergePath(store.storeRoot),
    doc: result.doc as ProjectDoc,
    heads: result.headsAfter,
    headsBefore: result.headsBefore,
    headsAfter: result.headsAfter,
    applied: result.applied
  };
}

export async function readBranchCrdtSyncState(
  projectRoot: string,
  branchKey: string,
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<BranchCrdtSyncState> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const path = getBranchAutomergePath(store.storeRoot, branchKey);

  if (!(await pathExists(path))) {
    return {
      branchKey,
      path,
      initialized: false,
      heads: [],
      changeCount: 0
    };
  }

  const backend = await createBranchCrdtBackend(projectRoot, branchKey, options);

  return {
    branchKey,
    path,
    initialized: true,
    heads: await backend.getHeads(),
    changeCount: (await backend.getAllChanges()).length
  };
}

export async function applyBranchCrdtChanges(
  projectRoot: string,
  branchKey: string,
  changes: Uint8Array[],
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<ApplyBranchCrdtChangesResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const backend = await createBranchCrdtBackend(projectRoot, branchKey, options);
  const result = await backend.applyAutomergeChanges(changes);

  return {
    branchKey,
    path: getBranchAutomergePath(store.storeRoot, branchKey),
    doc: result.doc as ProjectDoc,
    heads: result.headsAfter,
    headsBefore: result.headsBefore,
    headsAfter: result.headsAfter,
    applied: result.applied
  };
}

export async function importProjectJsonlToCrdt(
  projectRoot: string,
  options: ImportProjectJsonlToCrdtOptions = {}
): Promise<ImportProjectJsonlToCrdtResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const path = getProjectAutomergePath(store.storeRoot);

  if (options.overwrite !== true && (await pathExists(path))) {
    const existing = await createProjectCrdtBackend(projectRoot, options);

    return {
      path,
      doc: (await existing.load()) as ProjectDoc,
      heads: await existing.getHeads(),
      importedKnowledge: 0,
      importedRelations: 0,
      importedQualitySignals: 0,
      importedAuditEvents: 0,
      skipped: 0,
      sourceFiles: []
    };
  }

  const importInput: ImportV1JsonlToProjectDocInput = {
    doc: await createInitialProjectDoc(projectRoot, options),
    knowledgeDir: store.paths.knowledgeDir,
    eventsDir: store.paths.eventsDir
  };

  if (options.actorId !== undefined) {
    importInput.actorId = options.actorId;
  }

  const imported = await importV1JsonlToProjectDoc(importInput);
  const backend = await createProjectCrdtBackend(projectRoot, options, imported.doc);

  await backend.save(imported.doc as AutomergeProjectDoc);

  return {
    path,
    doc: (await backend.load()) as ProjectDoc,
    heads: await backend.getHeads(),
    importedKnowledge: imported.importedKnowledge,
    importedRelations: imported.importedRelations,
    importedQualitySignals: imported.importedQualitySignals,
    importedAuditEvents: imported.importedAuditEvents,
    skipped: imported.skipped,
    sourceFiles: imported.sourceFiles
  };
}

export async function loadProjectKnowledgeItemsFromCrdt(
  projectRoot: string,
  options: RebuildProjectProjectionsFromCrdtOptions = {}
): Promise<KnowledgeItem[]> {
  const backend = await createProjectCrdtBackend(projectRoot, options);
  const doc = (await backend.load()) as ProjectDoc;

  return Object.values(doc.knowledge)
    .map(knowledgeNodeToItem)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export async function loadBranchKnowledgeItemsFromCrdt(
  projectRoot: string,
  branchKey: string,
  options: RebuildProjectProjectionsFromCrdtOptions = {}
): Promise<KnowledgeItem[]> {
  const state = await readBranchCrdtSyncState(projectRoot, branchKey, options);

  if (!state.initialized) {
    return [];
  }

  const backend = await createBranchCrdtBackend(projectRoot, branchKey, options);
  const doc = (await backend.load()) as ProjectDoc;

  return Object.values(doc.knowledge)
    .map(knowledgeNodeToItem)
    .map((item) => withKnowledgeBranchFallback(item, branchKey))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

export async function loadBranchKnowledgeEdgesFromCrdt(
  projectRoot: string,
  branchKey: string,
  options: RebuildProjectProjectionsFromCrdtOptions = {}
): Promise<KnowledgeGraphSemanticEdge[]> {
  const state = await readBranchCrdtSyncState(projectRoot, branchKey, options);

  if (!state.initialized) {
    return [];
  }

  const backend = await createBranchCrdtBackend(projectRoot, branchKey, options);
  const doc = (await backend.load()) as ProjectDoc;

  return Object.values(doc.relations).flatMap(relationToSemanticEdge);
}

export async function exportProjectCrdtKnowledgeJsonl(
  projectRoot: string,
  options: ExportProjectCrdtKnowledgeJsonlOptions = {}
): Promise<ExportProjectCrdtKnowledgeJsonlResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const backend = await createProjectCrdtBackend(projectRoot, options);
  const doc = (await backend.load()) as ProjectDoc;
  const crdtPath = getProjectAutomergePath(store.storeRoot);
  const outputPath = options.path ?? join(store.paths.exportsDir, 'knowledge.jsonl');
  const includeTombstones = options.includeTombstones ?? true;
  const allItems = Object.values(doc.knowledge)
    .map(knowledgeNodeToItem)
    .sort(compareKnowledgeItemsForExport);
  const items = includeTombstones ? allItems : allItems.filter((item) => item.status !== 'tombstone');

  await writeJsonl(outputPath, items);

  return {
    path: outputPath,
    crdtPath,
    heads: await backend.getHeads(),
    exportedKnowledge: items.length,
    skippedTombstones: allItems.length - items.length
  };
}

export async function upsertProjectKnowledgeToCrdt(
  projectRoot: string,
  item: KnowledgeItem,
  options: UpsertProjectKnowledgeToCrdtOptions = {}
): Promise<UpsertProjectKnowledgeToCrdtResult> {
  const backend = await createProjectCrdtBackend(projectRoot, options);
  const changeInput: CrdtChangeInput<AutomergeProjectDoc> = {
    actorId: options.actorId ?? readKnowledgeActorId(item.createdBy),
    summary: options.summary ?? `Upsert knowledge ${item.id}`,
    mutate(doc) {
      const group = createBranchScope(doc as ProjectDoc);

      doc.knowledge[item.id] = knowledgeItemToNode(item, group);
      doc.project.updatedAt = item.updatedAt;
      return doc;
    }
  };

  if (options.now !== undefined) {
    changeInput.now = options.now;
  }

  const result = await backend.change(changeInput);

  return {
    path: getProjectAutomergePath((await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey))).storeRoot),
    doc: result.doc as ProjectDoc,
    heads: await backend.getHeads(),
    knowledgeId: item.id
  };
}

export async function createProjectRelationInCrdt(
  projectRoot: string,
  input: CreateProjectRelationInCrdtInput,
  options: CreateProjectRelationInCrdtOptions = {}
): Promise<CreateProjectRelationInCrdtResult> {
  const backend = await createProjectCrdtBackend(projectRoot, options);
  const changeInput: CrdtChangeInput<AutomergeProjectDoc> = {
    actorId: options.actorId ?? readKnowledgeActorId(input.createdBy),
    summary: options.summary ?? `Create relation ${input.id}`,
    mutate(doc) {
      const group = createBranchScope(doc as ProjectDoc);

      doc.relations[input.id] = {
        id: input.id,
        from: input.fromId,
        to: input.toId,
        kind: input.kind,
        evidenceKnowledgeIds: input.evidenceKnowledgeIds ?? [input.fromId, input.toId],
        confidence: input.confidence ?? 0.8,
        createdBy: input.createdBy ?? { displayName: 'local' },
        createdAt: input.createdAt,
        ...group
      };

      doc.project.updatedAt = input.createdAt;
      return doc;
    }
  };

  if (options.now !== undefined) {
    changeInput.now = options.now;
  }

  const result = await backend.change(changeInput);

  return {
    path: getProjectAutomergePath((await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey))).storeRoot),
    doc: result.doc as ProjectDoc,
    heads: await backend.getHeads(),
    relationId: input.id
  };
}

export async function createProjectQualitySignalInCrdt(
  projectRoot: string,
  input: CreateProjectQualitySignalInCrdtInput,
  options: CreateProjectQualitySignalInCrdtOptions = {}
): Promise<CreateProjectQualitySignalInCrdtResult> {
  const backend = await createProjectCrdtBackend(projectRoot, options);
  const changeInput: CrdtChangeInput<AutomergeProjectDoc> = {
    actorId: options.actorId ?? input.actorId ?? 'local',
    summary: options.summary ?? `Create quality signal ${input.id}`,
    mutate(doc) {
      const group = createBranchScope(doc as ProjectDoc);
      const signalInput: Parameters<typeof createQualitySignal>[0] = {
        knowledgeId: input.knowledgeId,
        kind: input.kind,
        actorId: input.actorId ?? 'local',
        group,
        now: () => new Date(input.createdAt)
      };

      if (input.value !== undefined) {
        signalInput.value = input.value;
      }

      if (input.reason !== undefined) {
        signalInput.reason = input.reason;
      }

      const signal = createQualitySignal(signalInput);

      doc.qualitySignals[input.id] = {
        ...signal,
        id: input.id
      };

      doc.project.updatedAt = input.createdAt;
      return doc;
    }
  };

  if (options.now !== undefined) {
    changeInput.now = options.now;
  }

  const result = await backend.change(changeInput);

  return {
    path: getProjectAutomergePath((await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey))).storeRoot),
    doc: result.doc as ProjectDoc,
    heads: await backend.getHeads(),
    qualitySignalId: input.id
  };
}

export async function rebuildProjectProjectionsFromCrdt(
  projectRoot: string,
  options: RebuildProjectProjectionsFromCrdtOptions = {}
): Promise<RebuildProjectProjectionsFromCrdtResult> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const backend = await createProjectCrdtBackend(projectRoot, options);
  const projectionBackend = new LocalProjectionBackend({ indexDir: store.paths.indexDir });
  const crdtPath = getProjectAutomergePath(store.storeRoot);
  const doc = (await backend.load()) as ProjectDoc;
  const config = await readProjectConfigFile(store.paths.config);
  const items = mergeKnowledgeItems([
    ...Object.values(doc.knowledge).map(knowledgeNodeToItem),
    ...(config.knowledgeBranch.base === undefined
      ? []
      : await loadBranchKnowledgeItemsFromCrdt(projectRoot, config.knowledgeBranch.base, options))
  ]);
  const semanticEdges = [
    ...Object.values(doc.relations).flatMap(relationToSemanticEdge),
    ...(config.knowledgeBranch.base === undefined
      ? []
      : await loadBranchKnowledgeEdgesFromCrdt(projectRoot, config.knowledgeBranch.base, options))
  ];
  const sourceHeads = await backend.getHeads();
  const rebuilt = await projectionBackend.dropAndRebuild({
    crdtPath,
    sourceHeads,
    items,
    semanticEdges,
    qualitySignals: Object.values(doc.qualitySignals)
  });

  return {
    ...rebuilt,
    crdtPath,
    metadataPath: projectionBackend.metadataPath,
    sourceHeads
  };
}

function mergeKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  const byId = new Map<string, KnowledgeItem>();

  for (const item of items) {
    const existing = byId.get(item.id);

    if (existing === undefined || item.updatedAt >= existing.updatedAt) {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()];
}

export async function readProjectProjectionStatus(
  projectRoot: string,
  options: RebuildProjectProjectionsFromCrdtOptions = {}
): Promise<ProjectProjectionStatus> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const crdtPath = getProjectAutomergePath(store.storeRoot);
  const projectionBackend = new LocalProjectionBackend({ indexDir: store.paths.indexDir });

  if (!(await pathExists(crdtPath))) {
    return {
      state: 'missing_crdt',
      backend: projectionBackend.name,
      schemaVersion: projectionBackend.schemaVersion,
      expectedSchemaVersion: projectionBackend.schemaVersion,
      metadataPath: projectionBackend.metadataPath,
      crdtPath,
      currentHeads: [],
      sourceHeads: [],
      message: 'CRDT project document has not been initialized.'
    };
  }

  const backend = await createProjectCrdtBackend(projectRoot, options);
  const currentHeads = await backend.getHeads();

  return projectionBackend.healthCheck({ crdtPath, currentHeads });
}

async function createProjectCrdtBackend(
  projectRoot: string,
  options: ImportProjectJsonlToCrdtOptions,
  initialDoc?: ProjectDoc
): Promise<AutomergeFileCrdtBackend<AutomergeProjectDoc>> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const backendOptions: AutomergeFileCrdtBackendOptions<AutomergeProjectDoc> = {
    path: getProjectAutomergePath(store.storeRoot),
    initialDoc: (initialDoc ?? (await createInitialProjectDoc(projectRoot, options))) as AutomergeProjectDoc
  };

  if (options.actorId !== undefined) {
    backendOptions.actorId = options.actorId;
  }

  return new AutomergeFileCrdtBackend<AutomergeProjectDoc>(backendOptions);
}

async function createBranchCrdtBackend(
  projectRoot: string,
  branchKey: string,
  options: ImportProjectJsonlToCrdtOptions
): Promise<AutomergeFileCrdtBackend<AutomergeProjectDoc>> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const backendOptions: AutomergeFileCrdtBackendOptions<AutomergeProjectDoc> = {
    path: getBranchAutomergePath(store.storeRoot, branchKey),
    initialDoc: (await createInitialProjectDoc(projectRoot, options, branchKey)) as AutomergeProjectDoc
  };

  if (options.actorId !== undefined) {
    backendOptions.actorId = options.actorId;
  }

  return new AutomergeFileCrdtBackend<AutomergeProjectDoc>(backendOptions);
}

function getBranchAutomergePath(storeRoot: string, branchKey: string): string {
  return join(storeRoot, 'crdt', 'branches', `${encodeBranchFilename(branchKey)}.automerge`);
}

function encodeBranchFilename(branchKey: string): string {
  return encodeURIComponent(branchKey).replace(/\*/g, '%2A');
}

async function createInitialProjectDoc(
  projectRoot: string,
  options: ImportProjectJsonlToCrdtOptions,
  branch?: string
): Promise<ProjectDoc> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const config = await readProjectConfigFile(store.paths.config);
  const projectKey = await readProjectKey(store, options.projectKey);

  return createProjectDoc({
    projectId: projectKey,
    projectKey,
    name: config.displayName,
    branch: branch ?? config.knowledgeBranch.active,
    now: () => new Date(PROJECT_CRDT_GENESIS_TIME)
  });
}

function knowledgeNodeToItem(node: KnowledgeNode): KnowledgeItem {
  const item: KnowledgeItem = {
    id: node.id,
    layer: node.layer,
    entryKey: node.entryKey,
    type: node.type,
    title: node.title,
    summary: node.summary,
    para: node.para,
    tags: [...node.tags],
    source: node.source,
    createdBy: node.createdBy,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    visibility: node.visibility,
    status: node.status,
    quality: node.quality
  };

  if (node.content !== undefined) {
    item.content = node.content;
  }

  return item;
}

function withKnowledgeBranchFallback(item: KnowledgeItem, branch: string): KnowledgeItem {
  const metadata = item.source.metadata;

  if (typeof metadata?.branch === 'string' && metadata.branch.length > 0) {
    return item;
  }

  return {
    ...item,
    source: {
      ...item.source,
      metadata: {
        ...(metadata ?? {}),
        branch
      }
    }
  };
}

function compareKnowledgeItemsForExport(left: KnowledgeItem, right: KnowledgeItem): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function createBranchScope(doc: ProjectDoc): BranchScope {
  const group: BranchScope = {
    branch: doc.project.branch ?? 'default',
    sourceProjectId: doc.project.id
  };

  if (doc.project.branchId !== undefined) {
    group.branchId = doc.project.branchId;
  }

  return group;
}

function readKnowledgeActorId(identity: KnowledgeItem['createdBy'] | undefined): string {
  return identity?.clientId ?? identity?.memberId ?? identity?.handle ?? 'local';
}

function relationToSemanticEdge(relation: ProjectDoc['relations'][string]): KnowledgeGraphSemanticEdge[] {
  if (!isCrdtRelationSemanticEdgeKind(relation.kind)) {
    return [];
  }

  return [
    {
      id: relation.id,
      kind: relation.kind,
      fromId: relation.from,
      toId: relation.to,
      createdAt: relation.createdAt
    }
  ];
}

function isCrdtRelationSemanticEdgeKind(value: string): value is KnowledgeGraphSemanticEdgeKind {
  return (KNOWLEDGE_GRAPH_SEMANTIC_EDGE_KINDS as readonly string[]).includes(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
