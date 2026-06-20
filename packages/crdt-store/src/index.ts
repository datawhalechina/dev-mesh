import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as Automerge from '@automerge/automerge';
import type {
  Change as AutomergeBinaryChange,
  DecodedChange,
  Doc as AutomergeDoc,
  Heads as AutomergeHeads
} from '@automerge/automerge';
import {
  createQualitySignals,
  type KnowledgeItem,
  type KnowledgeLayer,
  type QualitySignals,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeType,
  type KnowledgeVisibility,
  type MemberIdentity,
  type ParaRef
} from '@devmesh/core';
import { nowIso } from '@devmesh/shared';

export const CRDT_STORE_SCHEMA_VERSION = 2;
export const PROJECT_AUTOMERGE_RELATIVE_PATH = join('crdt', 'project.automerge');
export const AUTOMERGE_GENESIS_ACTOR_ID = '00000000000000000000000000000000';

export type EntityKind =
  | 'project'
  | 'repo'
  | 'package'
  | 'api'
  | 'person'
  | 'service'
  | 'concept'
  | 'file'
  | 'command'
  | string;

export type RelationKind =
  | 'mentions'
  | 'about'
  | 'depends_on'
  | 'implemented_by'
  | 'supersedes'
  | 'duplicates'
  | 'contradicts'
  | 'supports'
  | 'owned_by'
  | 'uses'
  | string;

export type ClaimStatus = 'active' | 'disputed' | 'superseded' | 'tombstone';
export type ConflictStatus = 'open' | 'resolved' | 'ignored';
export type QualitySignalKind =
  | 'confirm'
  | 'dispute'
  | 'use'
  | 'rate'
  | 'demote'
  | 'stale'
  | 'refresh';

export interface ProjectMeta {
  id: string;
  key: string;
  name: string;
  groupKey: string;
  groupId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupNode {
  id: string;
  key: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectNode extends ProjectMeta {
  description?: string;
}

export interface MemberNode {
  id: string;
  displayName: string;
  handle?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientNode {
  id: string;
  memberId: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupScopedNode {
  groupKey: string;
  groupId?: string;
  sourceProjectId?: string;
}

export interface KnowledgeNode extends GroupScopedNode {
  id: string;
  layer: KnowledgeLayer;
  entryKey: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content?: string;
  tags: string[];
  para: ParaRef;
  status: KnowledgeStatus;
  source: KnowledgeSource;
  createdBy: MemberIdentity;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  visibility: KnowledgeVisibility;
  quality: QualitySignals;
}

export interface EntityNode extends GroupScopedNode {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RelationEdge extends GroupScopedNode {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  evidenceKnowledgeIds: string[];
  confidence: number;
  createdBy: MemberIdentity;
  createdAt: string;
}

export interface ClaimNode extends GroupScopedNode {
  id: string;
  text: string;
  subjectEntityId?: string;
  objectEntityId?: string;
  evidenceKnowledgeIds: string[];
  confidence: number;
  status: ClaimStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QualitySignal extends GroupScopedNode {
  id: string;
  knowledgeId: string;
  kind: QualitySignalKind;
  actorId: string;
  value?: number;
  reason?: string;
  createdAt: string;
}

export interface ConflictNode extends GroupScopedNode {
  id: string;
  kind: string;
  subjectIds: string[];
  status: ConflictStatus;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: MemberIdentity;
}

export interface ExtensionState {
  schemaVersion: number;
  data: Record<string, unknown>;
}

export interface ProjectDoc {
  schemaVersion: 2;
  project: ProjectMeta;
  groupKey: string;
  knowledge: Record<string, KnowledgeNode>;
  entities: Record<string, EntityNode>;
  relations: Record<string, RelationEdge>;
  claims: Record<string, ClaimNode>;
  qualitySignals: Record<string, QualitySignal>;
  conflicts: Record<string, ConflictNode>;
  extensions?: Record<string, ExtensionState>;
}

export interface ServerGlobalDoc {
  schemaVersion: 2;
  server: ServerMeta;
  groups: Record<string, GroupNode>;
  projects: Record<string, ProjectNode>;
  members: Record<string, MemberNode>;
  clients: Record<string, ClientNode>;
  knowledge: Record<string, KnowledgeNode>;
  entities: Record<string, EntityNode>;
  relations: Record<string, RelationEdge>;
  claims: Record<string, ClaimNode>;
  conflicts: Record<string, ConflictNode>;
  qualitySignals: Record<string, QualitySignal>;
  extensions?: Record<string, ExtensionState>;
}

export interface CrdtChange<TDoc> {
  id: string;
  engine?: 'memory' | 'automerge';
  actorId: string;
  createdAt: string;
  headsBefore: string[];
  headsAfter: string[];
  summary: string;
  binaryChanges?: Uint8Array[];
  apply(doc: TDoc): TDoc;
}

export interface CrdtBackend<TDoc> {
  load(): Promise<TDoc>;
  save(doc: TDoc): Promise<void>;
  getHeads(): Promise<string[]>;
  change(input: CrdtChangeInput<TDoc>): Promise<CrdtChangeResult<TDoc>>;
  apply(change: CrdtChange<TDoc>): Promise<CrdtChangeResult<TDoc>>;
}

export interface CrdtChangeInput<TDoc> {
  actorId: string;
  summary: string;
  mutate(doc: TDoc): TDoc;
  now?: () => Date;
}

export interface CrdtChangeResult<TDoc> {
  doc: TDoc;
  change: CrdtChange<TDoc>;
}

export interface AutomergeFileCrdtBackendOptions<TDoc> {
  path: string;
  initialDoc: TDoc | (() => TDoc);
  actorId?: string;
}

export interface ApplyAutomergeChangesResult<TDoc> {
  doc: TDoc;
  headsBefore: string[];
  headsAfter: string[];
  applied: number;
}

export interface ImportV1JsonlToProjectDocInput {
  doc: ProjectDoc;
  knowledgeDir: string;
  eventsDir?: string;
  actorId?: string;
}

export interface ImportV1JsonlToProjectDocResult {
  doc: ProjectDoc;
  importedKnowledge: number;
  importedRelations: number;
  importedQualitySignals: number;
  importedAuditEvents: number;
  skipped: number;
  sourceFiles: string[];
}

export interface CreateProjectDocInput {
  projectId: string;
  projectKey: string;
  name: string;
  groupKey?: string;
  groupId?: string;
  now?: () => Date;
}

export interface CreateServerGlobalDocInput {
  serverId: string;
  name: string;
  now?: () => Date;
}

export function createProjectDoc(input: CreateProjectDocInput): ProjectDoc {
  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const groupKey = input.groupKey ?? input.projectKey;
  const project: ProjectMeta = {
    id: input.projectId,
    key: input.projectKey,
    name: input.name,
    groupKey,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (input.groupId !== undefined) {
    project.groupId = input.groupId;
  }

  return {
    schemaVersion: CRDT_STORE_SCHEMA_VERSION,
    project,
    groupKey,
    knowledge: {},
    entities: {},
    relations: {},
    claims: {},
    qualitySignals: {},
    conflicts: {}
  };
}

export function createServerGlobalDoc(input: CreateServerGlobalDocInput): ServerGlobalDoc {
  const timestamp = (input.now?.() ?? new Date()).toISOString();

  return {
    schemaVersion: CRDT_STORE_SCHEMA_VERSION,
    server: {
      id: input.serverId,
      name: input.name,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    groups: {},
    projects: {},
    members: {},
    clients: {},
    knowledge: {},
    entities: {},
    relations: {},
    claims: {},
    conflicts: {},
    qualitySignals: {}
  };
}

export function knowledgeItemToNode(item: KnowledgeItem, group: GroupScopedNode): KnowledgeNode {
  const node: KnowledgeNode = {
    id: item.id,
    layer: item.layer,
    entryKey: item.entryKey,
    type: item.type,
    title: item.title,
    summary: item.summary,
    tags: item.tags,
    para: item.para,
    status: item.status,
    source: item.source,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    visibility: item.visibility,
    quality: item.quality,
    groupKey: group.groupKey
  };

  if (item.content !== undefined) {
    node.content = item.content;
  }

  if (group.groupId !== undefined) {
    node.groupId = group.groupId;
  }

  if (group.sourceProjectId !== undefined) {
    node.sourceProjectId = group.sourceProjectId;
  }

  if (item.status === 'tombstone') {
    node.deletedAt = item.updatedAt;
  }

  return node;
}

export function getProjectAutomergePath(storeRoot: string): string {
  return join(storeRoot, PROJECT_AUTOMERGE_RELATIVE_PATH);
}

export async function importV1JsonlToProjectDoc(
  input: ImportV1JsonlToProjectDocInput
): Promise<ImportV1JsonlToProjectDocResult> {
  const sourceFiles = new Set<string>();
  const group: GroupScopedNode = {
    groupKey: input.doc.groupKey,
    sourceProjectId: input.doc.project.id
  };

  if (input.doc.project.groupId !== undefined) {
    group.groupId = input.doc.project.groupId;
  }
  const result: ImportV1JsonlToProjectDocResult = {
    doc: cloneJson(input.doc),
    importedKnowledge: 0,
    importedRelations: 0,
    importedQualitySignals: 0,
    importedAuditEvents: 0,
    skipped: 0,
    sourceFiles: []
  };
  const knowledgeFiles = await findJsonlFiles(input.knowledgeDir);

  for (const file of knowledgeFiles) {
    sourceFiles.add(file);
    const records = await readJsonlRecords(file);

    for (const record of records) {
      if (isKnowledgeItemRecord(record)) {
        const existing = result.doc.knowledge[record.id];

        if (existing === undefined || record.updatedAt >= existing.updatedAt) {
          result.doc.knowledge[record.id] = knowledgeItemToNode(record, group);
        }

        result.importedKnowledge += 1;
        continue;
      }

      if (isProjectKnowledgeEdgeRecord(record)) {
        result.doc.relations[record.id] = projectKnowledgeEdgeToRelation(record, group);
        result.importedRelations += 1;
        continue;
      }

      if (isKnowledgeUsageRecord(record)) {
        const signal = knowledgeUsageToQualitySignal(record, group, input.actorId);
        result.doc.qualitySignals[signal.id] = signal;
        result.importedQualitySignals += 1;
        continue;
      }

      if (isKnowledgeRatingRecord(record)) {
        const signals = knowledgeRatingToQualitySignals(record, group, input.actorId);

        for (const signal of signals) {
          result.doc.qualitySignals[signal.id] = signal;
          result.importedQualitySignals += 1;
        }

        continue;
      }

      result.skipped += 1;
    }
  }

  if (input.eventsDir !== undefined) {
    const eventFiles = await findJsonlFiles(input.eventsDir);

    for (const file of eventFiles) {
      sourceFiles.add(file);
      const records = await readJsonlRecords(file);

      for (const record of records) {
        if (!isDevMeshEventRecord(record)) {
          result.skipped += 1;
          continue;
        }

        const eventHints = importEventHints(result.doc, record, group, input.actorId);

        result.importedQualitySignals += eventHints.importedQualitySignals;
        result.importedAuditEvents += 1;
      }
    }
  }

  result.doc = touchProjectDoc(result.doc, findLatestUpdatedAt(result.doc) ?? nowIso());
  result.sourceFiles = [...sourceFiles].sort();

  return result;
}

export class InMemoryCrdtBackend<TDoc> implements CrdtBackend<TDoc> {
  private doc: TDoc;
  private heads: string[];
  private readonly appliedChangeIds = new Set<string>();

  constructor(initialDoc: TDoc) {
    this.doc = cloneJson(initialDoc);
    this.heads = [createDocumentHead(this.doc)];
  }

  async load(): Promise<TDoc> {
    return cloneJson(this.doc);
  }

  async save(doc: TDoc): Promise<void> {
    this.doc = cloneJson(doc);
    this.heads = [createDocumentHead(this.doc)];
  }

  async getHeads(): Promise<string[]> {
    return [...this.heads];
  }

  async change(input: CrdtChangeInput<TDoc>): Promise<CrdtChangeResult<TDoc>> {
    const headsBefore = await this.getHeads();
    const mutated = input.mutate(cloneJson(this.doc));
    const headsAfter = [createDocumentHead(mutated)];
    const change = createMemoryChange({
      actorId: input.actorId,
      createdAt: (input.now?.() ?? new Date()).toISOString(),
      headsBefore,
      headsAfter,
      summary: input.summary,
      nextDoc: mutated
    });

    return this.apply(change);
  }

  async apply(change: CrdtChange<TDoc>): Promise<CrdtChangeResult<TDoc>> {
    if (!this.appliedChangeIds.has(change.id)) {
      this.doc = cloneJson(change.apply(cloneJson(this.doc)));
      this.heads = [...change.headsAfter];
      this.appliedChangeIds.add(change.id);
    }

    return {
      doc: await this.load(),
      change
    };
  }
}

export class AutomergeFileCrdtBackend<TDoc extends Record<string, unknown>> implements CrdtBackend<TDoc> {
  private automergeDoc: AutomergeDoc<TDoc> | undefined;

  constructor(private readonly options: AutomergeFileCrdtBackendOptions<TDoc>) {}

  async load(): Promise<TDoc> {
    return automergeDocToPlain(await this.loadAutomergeDoc());
  }

  async save(doc: TDoc): Promise<void> {
    await this.persistAutomergeDoc(createSeededAutomergeDoc(doc, this.options.actorId));
  }

  async getHeads(): Promise<string[]> {
    return [...Automerge.getHeads(await this.loadAutomergeDoc())];
  }

  async change(input: CrdtChangeInput<TDoc>): Promise<CrdtChangeResult<TDoc>> {
    const current = await this.loadAutomergeDoc();
    const headsBefore = [...Automerge.getHeads(current)];
    const createdAtDate = input.now?.() ?? new Date();
    const createdAt = createdAtDate.toISOString();
    const changed = Automerge.change(
      current,
      {
        message: input.summary,
        time: Math.floor(createdAtDate.getTime() / 1000)
      },
      (draft) => {
        const draftDoc = draft as TDoc;
        const mutated = input.mutate(draftDoc);

        if (mutated !== draftDoc) {
          replaceDocumentContents(draftDoc, mutated);
        }
      }
    );
    const headsAfter = [...Automerge.getHeads(changed)];
    const binaryChanges = copyBinaryChanges([Automerge.getLastLocalChange(changed)].filter(isUint8Array));
    const doc = automergeDocToPlain(changed);
    const change = createAutomergeChange({
      actorId: input.actorId,
      createdAt,
      headsBefore,
      headsAfter,
      summary: input.summary,
      binaryChanges,
      nextDoc: doc
    });

    await this.persistAutomergeDoc(changed);

    return {
      doc,
      change
    };
  }

  async apply(change: CrdtChange<TDoc>): Promise<CrdtChangeResult<TDoc>> {
    if (change.binaryChanges?.length) {
      const result = await this.applyAutomergeChanges(change.binaryChanges);

      return {
        doc: result.doc,
        change: {
          ...change,
          headsAfter: result.headsAfter
        }
      };
    }

    const nextDoc = change.apply(await this.load());
    await this.save(nextDoc);

    return {
      doc: await this.load(),
      change
    };
  }

  async getAllChanges(): Promise<Uint8Array[]> {
    return copyBinaryChanges(Automerge.getAllChanges(await this.loadAutomergeDoc()));
  }

  async getChangesSince(heads: string[]): Promise<Uint8Array[]> {
    return copyBinaryChanges(Automerge.getChangesSince(await this.loadAutomergeDoc(), heads as AutomergeHeads));
  }

  async applyAutomergeChanges(changes: Uint8Array[]): Promise<ApplyAutomergeChangesResult<TDoc>> {
    const current =
      changes.length === 0 ? await this.loadAutomergeDoc() : await this.loadAutomergeDocForIncomingChanges();
    const headsBefore = [...Automerge.getHeads(current)];
    const orderedChanges = orderAutomergeChangesByDependencies(changes, current);
    const [next] =
      orderedChanges.length === 0
        ? [current]
        : Automerge.applyChanges(current, orderedChanges as AutomergeBinaryChange[]);
    const headsAfter = [...Automerge.getHeads(next)];

    await this.persistAutomergeDoc(next);

    return {
      doc: automergeDocToPlain(next),
      headsBefore,
      headsAfter,
      applied: orderedChanges.length
    };
  }

  private async loadAutomergeDoc(): Promise<AutomergeDoc<TDoc>> {
    if (this.automergeDoc !== undefined) {
      return this.automergeDoc;
    }

    try {
      const content = await readFile(this.options.path);
      this.automergeDoc = Automerge.load<TDoc>(new Uint8Array(content), this.options.actorId);

      return this.automergeDoc;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }

      const initialDoc =
        typeof this.options.initialDoc === 'function' ? this.options.initialDoc() : this.options.initialDoc;
      this.automergeDoc = createSeededAutomergeDoc(initialDoc, this.options.actorId);
      await this.persistAutomergeDoc(this.automergeDoc);

      return this.automergeDoc;
    }
  }

  private async loadAutomergeDocForIncomingChanges(): Promise<AutomergeDoc<TDoc>> {
    if (this.automergeDoc !== undefined) {
      return this.automergeDoc;
    }

    try {
      const content = await readFile(this.options.path);
      this.automergeDoc = Automerge.load<TDoc>(new Uint8Array(content), this.options.actorId);

      return this.automergeDoc;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }

      this.automergeDoc = Automerge.init<TDoc>(this.options.actorId);

      return this.automergeDoc;
    }
  }

  private async persistAutomergeDoc(doc: AutomergeDoc<TDoc>): Promise<void> {
    await mkdir(dirname(this.options.path), { recursive: true });
    await writeFile(this.options.path, Buffer.from(Automerge.save(doc)));
    this.automergeDoc = doc;
  }
}

interface CreateMemoryChangeInput<TDoc> {
  actorId: string;
  createdAt: string;
  headsBefore: string[];
  headsAfter: string[];
  summary: string;
  nextDoc: TDoc;
}

interface CreateAutomergeChangeInput<TDoc> extends CreateMemoryChangeInput<TDoc> {
  binaryChanges: Uint8Array[];
}

function createMemoryChange<TDoc>(input: CreateMemoryChangeInput<TDoc>): CrdtChange<TDoc> {
  const nextDoc = cloneJson(input.nextDoc);
  const id = `chg_${createHash('sha256')
    .update(
      stableStringify({
        actorId: input.actorId,
        createdAt: input.createdAt,
        headsBefore: input.headsBefore,
        headsAfter: input.headsAfter,
        summary: input.summary,
        nextDoc
      })
    )
    .digest('hex')
    .slice(0, 24)}_${randomUUID().slice(0, 8)}`;

  return {
    id,
    engine: 'memory',
    actorId: input.actorId,
    createdAt: input.createdAt,
    headsBefore: [...input.headsBefore],
    headsAfter: [...input.headsAfter],
    summary: input.summary,
    apply: () => cloneJson(nextDoc)
  };
}

function createAutomergeChange<TDoc>(input: CreateAutomergeChangeInput<TDoc>): CrdtChange<TDoc> {
  const nextDoc = cloneJson(input.nextDoc);
  const id = `am_${createHash('sha256')
    .update(
      stableStringify({
        actorId: input.actorId,
        createdAt: input.createdAt,
        headsBefore: input.headsBefore,
        headsAfter: input.headsAfter,
        summary: input.summary,
        binaryChanges: input.binaryChanges.map((change) => Buffer.from(change).toString('base64'))
      })
    )
    .digest('hex')
    .slice(0, 32)}`;

  return {
    id,
    engine: 'automerge',
    actorId: input.actorId,
    createdAt: input.createdAt,
    headsBefore: [...input.headsBefore],
    headsAfter: [...input.headsAfter],
    summary: input.summary,
    binaryChanges: copyBinaryChanges(input.binaryChanges),
    apply: () => cloneJson(nextDoc)
  };
}

function orderAutomergeChangesByDependencies<TDoc>(changes: Uint8Array[], current: AutomergeDoc<TDoc>): Uint8Array[] {
  const existingHashes = new Set(
    Automerge.getAllChanges(current).map((change) => (Automerge.decodeChange(change) as DecodedChange).hash)
  );
  const metadata = changes.map((change, index) => ({
    change: new Uint8Array(change),
    index,
    decoded: Automerge.decodeChange(change as AutomergeBinaryChange) as DecodedChange
  })).filter((item) => !existingHashes.has(item.decoded.hash));
  const pending = [...metadata];
  const available = new Set(existingHashes);
  const allHashes = new Set(metadata.map((item) => item.decoded.hash));
  const ordered: Uint8Array[] = [];

  while (pending.length > 0) {
    const ready = pending
      .filter((item) => item.decoded.deps.every((dep) => available.has(dep) || !allHashes.has(dep)))
      .sort((left, right) => left.decoded.seq - right.decoded.seq || left.index - right.index);

    if (ready.length === 0) {
      ordered.push(...pending.sort((left, right) => left.index - right.index).map((item) => item.change));
      break;
    }

    for (const item of ready) {
      const pendingIndex = pending.findIndex((candidate) => candidate.decoded.hash === item.decoded.hash);

      if (pendingIndex !== -1) {
        pending.splice(pendingIndex, 1);
      }

      available.add(item.decoded.hash);
      ordered.push(item.change);
    }
  }

  return ordered;
}

function createDocumentHead(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function automergeDocToPlain<TDoc>(doc: AutomergeDoc<TDoc>): TDoc {
  return cloneJson(Automerge.toJS(doc));
}

function createSeededAutomergeDoc<TDoc extends Record<string, unknown>>(
  doc: TDoc,
  actorId: string | undefined
): AutomergeDoc<TDoc> {
  const seeded = Automerge.from(cloneJson(doc), AUTOMERGE_GENESIS_ACTOR_ID);

  return Automerge.load<TDoc>(Automerge.save(seeded), actorId);
}

function replaceDocumentContents<TDoc extends Record<string, unknown>>(target: TDoc, next: TDoc): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  for (const [key, value] of Object.entries(cloneJson(next))) {
    target[key as keyof TDoc] = value as TDoc[keyof TDoc];
  }
}

function copyBinaryChanges(changes: Uint8Array[]): Uint8Array[] {
  return changes.map((change) => new Uint8Array(change));
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined && typeof entryValue !== 'function')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

export function createQualitySignal(input: {
  knowledgeId: string;
  kind: QualitySignalKind;
  actorId: string;
  group: GroupScopedNode;
  value?: number;
  reason?: string;
  now?: () => Date;
}): QualitySignal {
  const createdAt = (input.now?.() ?? new Date()).toISOString();
  const signal: QualitySignal = {
    id: `qs_${createHash('sha256')
      .update(
        stableStringify({
          knowledgeId: input.knowledgeId,
          kind: input.kind,
          actorId: input.actorId,
          value: input.value ?? null,
          reason: input.reason ?? null,
          createdAt
        })
      )
      .digest('hex')
      .slice(0, 24)}`,
    knowledgeId: input.knowledgeId,
    kind: input.kind,
    actorId: input.actorId,
    createdAt,
    groupKey: input.group.groupKey
  };

  if (input.value !== undefined) {
    signal.value = input.value;
  }

  if (input.reason !== undefined) {
    signal.reason = input.reason;
  }

  if (input.group.groupId !== undefined) {
    signal.groupId = input.group.groupId;
  }

  if (input.group.sourceProjectId !== undefined) {
    signal.sourceProjectId = input.group.sourceProjectId;
  }

  return signal;
}

interface ProjectKnowledgeEdgeRecord {
  id: string;
  kind: RelationKind;
  fromId: string;
  toId: string;
  projectKey: string;
  createdAt: string;
  reason?: string;
  createdBy?: MemberIdentity;
}

interface KnowledgeRatingRecord {
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
}

interface KnowledgeUsageRecord {
  id: string;
  knowledgeId: string;
  projectKey: string;
  kind: string;
  createdAt: string;
  adoptionDelta?: number;
  confidenceDelta?: number;
  weightDelta?: number;
  reason?: string;
  createdBy?: MemberIdentity;
}

interface DevMeshEventRecord {
  id: string;
  kind: string;
  projectKey: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

interface ImportEventHintsResult {
  importedQualitySignals: number;
  updatedKnowledge: number;
}

async function findJsonlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await findJsonlFiles(path)));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path);
      }
    }

    return files.sort();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function readJsonlRecords(path: string): Promise<unknown[]> {
  const content = await readFile(path, 'utf8');
  const records: unknown[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed));
    } catch {
      records.push(undefined);
    }
  }

  return records;
}

function projectKnowledgeEdgeToRelation(edge: ProjectKnowledgeEdgeRecord, group: GroupScopedNode): RelationEdge {
  const relation: RelationEdge = {
    id: edge.id,
    from: edge.fromId,
    to: edge.toId,
    kind: edge.kind,
    evidenceKnowledgeIds: [edge.fromId, edge.toId],
    confidence: 0.8,
    createdBy: edge.createdBy ?? { displayName: 'migration' },
    createdAt: edge.createdAt,
    groupKey: group.groupKey
  };

  if (group.groupId !== undefined) {
    relation.groupId = group.groupId;
  }

  if (group.sourceProjectId !== undefined) {
    relation.sourceProjectId = group.sourceProjectId;
  }

  return relation;
}

function knowledgeRatingToQualitySignals(
  rating: KnowledgeRatingRecord,
  group: GroupScopedNode,
  fallbackActorId = 'migration'
): QualitySignal[] {
  const actorId = rating.createdBy?.memberId ?? rating.createdBy?.handle ?? fallbackActorId;
  const signals: QualitySignal[] = [];

  if (rating.rating !== undefined) {
    signals.push(
      createQualitySignal(
        qualitySignalInput({
        knowledgeId: rating.knowledgeId,
        kind: 'rate',
        actorId,
        value: rating.rating,
        reason: rating.reason,
        group,
        now: () => new Date(rating.createdAt)
        })
      )
    );
  }

  if ((rating.confidenceDelta ?? 0) > 0) {
    signals.push(
      createQualitySignal(
        qualitySignalInput({
        knowledgeId: rating.knowledgeId,
        kind: 'confirm',
        actorId,
        value: rating.confidenceDelta,
        reason: rating.reason,
        group,
        now: () => new Date(rating.createdAt)
        })
      )
    );
  }

  if ((rating.confidenceDelta ?? 0) < 0 || (rating.weightDelta ?? 0) < 0) {
    signals.push(
      createQualitySignal(
        qualitySignalInput({
        knowledgeId: rating.knowledgeId,
        kind: 'demote',
        actorId,
        value: rating.weightDelta ?? rating.confidenceDelta,
        reason: rating.reason,
        group,
        now: () => new Date(rating.createdAt)
        })
      )
    );
  }

  return signals;
}

function knowledgeUsageToQualitySignal(
  usage: KnowledgeUsageRecord,
  group: GroupScopedNode,
  fallbackActorId = 'migration'
): QualitySignal {
  return createQualitySignal(
    qualitySignalInput({
    knowledgeId: usage.knowledgeId,
    kind: 'use',
    actorId: readMemberActorId(usage.createdBy, fallbackActorId),
    value: usage.adoptionDelta ?? usage.confidenceDelta ?? usage.weightDelta,
    reason: usage.reason ?? usage.kind,
    group,
    now: () => new Date(usage.createdAt)
    })
  );
}

function importEventHints(
  doc: ProjectDoc,
  event: DevMeshEventRecord,
  group: GroupScopedNode,
  fallbackActorId = 'migration'
): ImportEventHintsResult {
  const result: ImportEventHintsResult = {
    importedQualitySignals: 0,
    updatedKnowledge: 0
  };

  if (event.kind === 'knowledge.deleted' && typeof event.payload.knowledgeId === 'string') {
    const existing = doc.knowledge[event.payload.knowledgeId];

    if (existing !== undefined && existing.updatedAt <= event.createdAt) {
      existing.status = 'tombstone';
      existing.updatedAt = event.createdAt;
      existing.deletedAt = event.createdAt;
      result.updatedKnowledge += 1;
    }
  }

  if (event.kind === 'knowledge.used' && typeof event.payload.knowledgeId === 'string') {
    result.importedQualitySignals += addQualitySignalIfNew(
      doc,
      qualitySignalInput({
      knowledgeId: event.payload.knowledgeId,
      kind: 'use',
      actorId: readActorId(event.payload.createdBy, fallbackActorId),
      value: readQualitySignalValue(event.payload),
      reason: readOptionalString(event.payload.reason),
      group,
      now: () => new Date(event.createdAt)
      })
    );
  }

  if (event.kind === 'knowledge.rated' && typeof event.payload.knowledgeId === 'string') {
    const signals = knowledgeRatingToQualitySignals(
      {
        id: readOptionalString(event.payload.ratingId) ?? event.id,
        knowledgeId: event.payload.knowledgeId,
        projectKey: event.projectKey,
        createdAt: event.createdAt,
        ...qualityEventFields(event.payload)
      },
      group,
      readActorId(event.payload.createdBy, fallbackActorId)
    );

    for (const signal of signals) {
      result.importedQualitySignals += addQualitySignalIfNew(doc, signal);
    }
  }

  if (event.kind === 'knowledge.review.accepted' && typeof event.payload.knowledgeId === 'string') {
    result.importedQualitySignals += addQualitySignalIfNew(
      doc,
      qualitySignalInput({
        knowledgeId: event.payload.knowledgeId,
        kind: 'confirm',
        actorId: readActorId(event.payload.createdBy, fallbackActorId),
        value: reviewRiskSignalValue(event.payload.risk),
        reason: readOptionalString(event.payload.reason) ?? 'Accepted from review queue.',
        group,
        now: () => new Date(event.createdAt)
      })
    );
  }

  if (event.kind === 'knowledge.review.rejected') {
    const candidateId = readOptionalString(event.payload.candidateId);

    if (candidateId !== undefined) {
      result.importedQualitySignals += addQualitySignalIfNew(
        doc,
        qualitySignalInput({
          knowledgeId: candidateId,
          kind: 'dispute',
          actorId: readActorId(event.payload.createdBy, fallbackActorId),
          value: reviewRiskSignalValue(event.payload.risk),
          reason: readOptionalString(event.payload.reason) ?? 'Rejected from review queue.',
          group,
          now: () => new Date(event.createdAt)
        })
      );
    }
  }

  if (event.kind === 'task.progress.captured') {
    result.updatedKnowledge += importTaskProgressHint(doc, event);
  }

  return result;
}

function importTaskProgressHint(doc: ProjectDoc, event: DevMeshEventRecord): number {
  const knowledgeId = readOptionalString(event.payload.knowledgeId);

  if (knowledgeId === undefined) {
    return 0;
  }

  const existing = doc.knowledge[knowledgeId];

  if (existing === undefined) {
    return 0;
  }

  let changed = false;
  const status = readOptionalString(event.payload.status);
  const summary = readOptionalString(event.payload.summary);
  const branch = readOptionalString(event.payload.branch);

  if (existing.type !== 'task') {
    existing.type = 'task';
    changed = true;
  }

  if (summary !== undefined && existing.summary !== summary) {
    existing.summary = summary;
    changed = true;
  }

  if (event.createdAt >= existing.updatedAt) {
    existing.updatedAt = event.createdAt;
    changed = true;
  }

  const metadata = isPlainRecord(existing.source.metadata) ? { ...existing.source.metadata } : {};

  if (status !== undefined && metadata.taskStatus !== status) {
    metadata.taskStatus = status;
    changed = true;
  }

  if (branch !== undefined && metadata.branch !== branch) {
    metadata.branch = branch;
    changed = true;
  }

  if (!changed) {
    return 0;
  }

  existing.source = {
    ...existing.source,
    kind: existing.source.kind || 'task',
    metadata
  };

  return 1;
}

function addQualitySignalIfNew(doc: ProjectDoc, input: QualitySignal | Parameters<typeof createQualitySignal>[0]): number {
  const signal = 'id' in input ? input : createQualitySignal(input);
  const duplicate = Object.values(doc.qualitySignals).some((existing) => qualitySignalsEquivalent(existing, signal));

  if (duplicate) {
    return 0;
  }

  doc.qualitySignals[signal.id] = signal;

  return 1;
}

function qualitySignalsEquivalent(left: QualitySignal, right: QualitySignal): boolean {
  return (
    left.knowledgeId === right.knowledgeId &&
    left.kind === right.kind &&
    left.actorId === right.actorId &&
    left.createdAt === right.createdAt &&
    left.value === right.value &&
    (left.reason ?? '') === (right.reason ?? '')
  );
}

function qualityEventFields(payload: Record<string, unknown>): {
  rating?: number;
  adoptionDelta?: number;
  confidenceDelta?: number;
  weightDelta?: number;
  reason?: string;
  createdBy?: MemberIdentity;
} {
  const fields: {
    rating?: number;
    adoptionDelta?: number;
    confidenceDelta?: number;
    weightDelta?: number;
    reason?: string;
    createdBy?: MemberIdentity;
  } = {};
  const rating = readOptionalNumber(payload.rating);
  const adoptionDelta = readOptionalNumber(payload.adoptionDelta);
  const confidenceDelta = readOptionalNumber(payload.confidenceDelta);
  const weightDelta = readOptionalNumber(payload.weightDelta);
  const reason = readOptionalString(payload.reason);

  if (rating !== undefined) {
    fields.rating = rating;
  }

  if (adoptionDelta !== undefined) {
    fields.adoptionDelta = adoptionDelta;
  }

  if (confidenceDelta !== undefined) {
    fields.confidenceDelta = confidenceDelta;
  }

  if (weightDelta !== undefined) {
    fields.weightDelta = weightDelta;
  }

  if (reason !== undefined) {
    fields.reason = reason;
  }

  if (isMemberIdentity(payload.createdBy)) {
    fields.createdBy = payload.createdBy;
  }

  return fields;
}

function readQualitySignalValue(payload: Record<string, unknown>): number | undefined {
  return (
    readOptionalNumber(payload.adoptionDelta) ??
    readOptionalNumber(payload.confidenceDelta) ??
    readOptionalNumber(payload.weightDelta) ??
    readOptionalNumber(payload.value)
  );
}

function reviewRiskSignalValue(value: unknown): number {
  if (value === 'high') {
    return 0.15;
  }

  if (value === 'medium') {
    return 0.1;
  }

  return 0.08;
}

function qualitySignalInput(input: {
  knowledgeId: string;
  kind: QualitySignalKind;
  actorId: string;
  group: GroupScopedNode;
  value?: number | undefined;
  reason?: string | undefined;
  now?: (() => Date) | undefined;
}): {
  knowledgeId: string;
  kind: QualitySignalKind;
  actorId: string;
  group: GroupScopedNode;
  value?: number;
  reason?: string;
  now?: () => Date;
} {
  const output: {
    knowledgeId: string;
    kind: QualitySignalKind;
    actorId: string;
    group: GroupScopedNode;
    value?: number;
    reason?: string;
    now?: () => Date;
  } = {
    knowledgeId: input.knowledgeId,
    kind: input.kind,
    actorId: input.actorId,
    group: input.group
  };

  if (input.value !== undefined) {
    output.value = input.value;
  }

  if (input.reason !== undefined) {
    output.reason = input.reason;
  }

  if (input.now !== undefined) {
    output.now = input.now;
  }

  return output;
}

function findLatestUpdatedAt(doc: ProjectDoc): string | undefined {
  return [
    ...Object.values(doc.knowledge).map((item) => item.updatedAt),
    ...Object.values(doc.entities).map((entity) => entity.updatedAt),
    ...Object.values(doc.claims).map((claim) => claim.updatedAt),
    ...Object.values(doc.conflicts).map((conflict) => conflict.updatedAt),
    ...Object.values(doc.qualitySignals).map((signal) => signal.createdAt),
    ...Object.values(doc.relations).map((relation) => relation.createdAt)
  ].sort((left, right) => right.localeCompare(left))[0];
}

function isKnowledgeItemRecord(value: unknown): value is KnowledgeItem {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    isKnowledgeLayer(value.layer) &&
    typeof value.entryKey === 'string' &&
    typeof value.type === 'string' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    (value.content === undefined || typeof value.content === 'string') &&
    isParaRef(value.para) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    isKnowledgeSource(value.source) &&
    isMemberIdentity(value.createdBy) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    isKnowledgeVisibility(value.visibility) &&
    isKnowledgeStatus(value.status) &&
    isQualitySignals(value.quality)
  );
}

function isProjectKnowledgeEdgeRecord(value: unknown): value is ProjectKnowledgeEdgeRecord {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.fromId === 'string' &&
    typeof value.toId === 'string' &&
    typeof value.projectKey === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.createdBy === undefined || isMemberIdentity(value.createdBy))
  );
}

function isKnowledgeRatingRecord(value: unknown): value is KnowledgeRatingRecord {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.knowledgeId === 'string' &&
    typeof value.projectKey === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.rating === undefined || isFiniteNumber(value.rating)) &&
    (value.adoptionDelta === undefined || isFiniteNumber(value.adoptionDelta)) &&
    (value.confidenceDelta === undefined || isFiniteNumber(value.confidenceDelta)) &&
    (value.weightDelta === undefined || isFiniteNumber(value.weightDelta)) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.createdBy === undefined || isMemberIdentity(value.createdBy))
  );
}

function isKnowledgeUsageRecord(value: unknown): value is KnowledgeUsageRecord {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.knowledgeId === 'string' &&
    typeof value.projectKey === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.adoptionDelta === undefined || isFiniteNumber(value.adoptionDelta)) &&
    (value.confidenceDelta === undefined || isFiniteNumber(value.confidenceDelta)) &&
    (value.weightDelta === undefined || isFiniteNumber(value.weightDelta)) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.createdBy === undefined || isMemberIdentity(value.createdBy))
  );
}

function isDevMeshEventRecord(value: unknown): value is DevMeshEventRecord {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.projectKey === 'string' &&
    typeof value.createdAt === 'string' &&
    isPlainRecord(value.payload)
  );
}

function isKnowledgeLayer(value: unknown): value is KnowledgeLayer {
  return value === 'raw' || value === 'extract' || value === 'canonical';
}

function isParaRef(value: unknown): value is ParaRef {
  return (
    isPlainRecord(value) &&
    (value.category === 'projects' ||
      value.category === 'areas' ||
      value.category === 'resources' ||
      value.category === 'archives') &&
    typeof value.key === 'string'
  );
}

function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return (
    isPlainRecord(value) &&
    typeof value.kind === 'string' &&
    (value.ref === undefined || typeof value.ref === 'string') &&
    (value.url === undefined || typeof value.url === 'string') &&
    (value.commit === undefined || typeof value.commit === 'string') &&
    (value.storageRef === undefined || typeof value.storageRef === 'string') &&
    (value.metadata === undefined || isPlainRecord(value.metadata))
  );
}

function isMemberIdentity(value: unknown): value is MemberIdentity {
  return (
    isPlainRecord(value) &&
    (value.memberId === undefined || typeof value.memberId === 'string') &&
    typeof value.displayName === 'string' &&
    (value.handle === undefined || typeof value.handle === 'string') &&
    (value.clientId === undefined || typeof value.clientId === 'string')
  );
}

function isKnowledgeVisibility(value: unknown): value is KnowledgeVisibility {
  return value === 'private' || value === 'project' || value === 'team' || value === 'org';
}

function isKnowledgeStatus(value: unknown): value is KnowledgeStatus {
  return value === 'active' || value === 'superseded' || value === 'tombstone';
}

function isQualitySignals(value: unknown): value is QualitySignals {
  if (!isPlainRecord(value)) {
    return false;
  }

  const candidate = {
    ...createQualitySignals(),
    ...value
  };

  return [
    candidate.confidence,
    candidate.weight,
    candidate.rating,
    candidate.adoptionScore,
    candidate.sourceTrust,
    candidate.evidence,
    candidate.freshness,
    candidate.qualityScore
  ].every(isFiniteNumber);
}

function readActorId(value: unknown, fallback: string): string {
  if (isMemberIdentity(value)) {
    return value.memberId ?? value.handle ?? fallback;
  }

  return fallback;
}

function readMemberActorId(value: MemberIdentity | undefined, fallback: string): string {
  return value?.memberId ?? value?.handle ?? fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function touchProjectDoc(doc: ProjectDoc, now = nowIso()): ProjectDoc {
  return {
    ...doc,
    project: {
      ...doc.project,
      updatedAt: now
    }
  };
}
