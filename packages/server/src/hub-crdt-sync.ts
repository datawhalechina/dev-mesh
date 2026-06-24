import { createHash } from 'node:crypto';
import * as Automerge from '@automerge/automerge';
import type {
  Change as AutomergeBinaryChange,
  Doc as AutomergeDoc,
  Heads as AutomergeHeads
} from '@automerge/automerge';
import { computeQualityScore, createQualitySignals, type DevMeshCore, type KnowledgeItem } from '@devmesh/core';
import type {
  CrdtSyncAcceptedChange,
  CrdtSyncChange,
  CrdtSyncDocumentKind,
  CrdtSyncDocumentRef,
  CrdtSyncExchangeResponse,
  CrdtSyncRejectedChange
} from '@devmesh/protocol';
import { appendHubAuditLog } from './hub-audit.js';
import type {
  HubAuthContext,
  HubCrdtChange,
  HubCrdtDocument,
  HubGlobalProjectionDocument,
  HubResult,
  HubState
} from './hub-model.js';
import { withKnowledgeGroupKey } from './hub-knowledge-scope.js';
import { hubError, ok } from './hub-utils.js';

const DEFAULT_MAX_RESPONSE_CHANGES = 250;
const MAX_RESPONSE_CHANGES = 1000;
const MAX_CRDT_CHANGE_BYTES = 5 * 1024 * 1024;

interface NormalizedExchangeRequest {
  clientId: string;
  documentKey: string;
  document: CrdtSyncDocumentRef;
  heads: string[];
  changes: unknown[];
  maxChanges: number;
}

interface NormalizedCrdtChange {
  id: string;
  bytes: string;
  binary: Uint8Array;
  headsBefore: string[];
  headsAfter: string[];
  actorId?: string;
  createdAt?: string;
  summary?: string;
}

export function exchangeHubCrdtChanges(
  state: HubState,
  auth: HubAuthContext,
  input: unknown,
  now: () => Date = () => new Date()
): HubResult<CrdtSyncExchangeResponse> {
  const request = normalizeExchangeRequest(auth, input);

  if (!request.ok) {
    return request;
  }

  if (request.value.clientId !== auth.clientId) {
    return hubError(403, 'sync.client_mismatch', 'clientId must match the authenticated client.');
  }

  const timestamp = now().toISOString();
  const document = getOrCreateHubCrdtDocument(state, request.value.documentKey, request.value.document, timestamp);
  let automergeDoc = loadAutomergeDocument(document);
  const acceptedChanges: CrdtSyncAcceptedChange[] = [];
  const rejected: CrdtSyncRejectedChange[] = [];
  const existingChangeIds = new Set(document.changes.map((change) => change.id));
  const incomingChangeIds = new Set<string>();

  for (const [index, rawChange] of request.value.changes.entries()) {
    const normalized = normalizeCrdtChange(rawChange, index);

    if (!normalized.ok) {
      rejected.push(normalized.rejected);
      continue;
    }

    const change = normalized.value;
    incomingChangeIds.add(change.id);

    if (existingChangeIds.has(change.id)) {
      continue;
    }

    try {
      const [nextDoc] = Automerge.applyChanges(automergeDoc, [change.binary] as AutomergeBinaryChange[]);
      const headsAfter = [...Automerge.getHeads(nextDoc)];
      const storedChange = createStoredCrdtChange({
        auth,
        change,
        headsAfter,
        receivedAt: timestamp
      });

      automergeDoc = nextDoc;
      document.changes.push(storedChange);
      existingChangeIds.add(storedChange.id);
      acceptedChanges.push({
        id: storedChange.id,
        headsAfter: [...storedChange.headsAfter]
      });
    } catch (error) {
      rejected.push(createRejectedChange(index, 'change.apply_failed', change.id));
    }
  }

  document.heads = [...Automerge.getHeads(automergeDoc)];
  document.snapshot = encodeBinary(Automerge.save(automergeDoc));
  document.updatedAt = timestamp;

  const responseChanges = getChangesForClient(document, automergeDoc, request.value.heads, incomingChangeIds)
    .slice(0, request.value.maxChanges)
    .map(toProtocolCrdtChange);

  if (acceptedChanges.length > 0 || rejected.length > 0) {
    auditCrdtExchange(state, auth, {
      document,
      acceptedChanges,
      rejected,
      returnedChanges: responseChanges.length
    });
  }

  return ok({
    document: cloneDocumentRef(document.document),
    acceptedChanges,
    rejected,
    heads: [...document.heads],
    changes: responseChanges,
    projection: {
      materialized: false,
      sourceHeads: [...document.heads]
    }
  });
}

export async function materializeHubCrdtDocument(
  state: HubState,
  core: DevMeshCore,
  documentKeyOrRef: string | CrdtSyncDocumentRef,
  actor = 'sync-crdt-materializer'
): Promise<HubCrdtMaterializeResult> {
  const documentKey = typeof documentKeyOrRef === 'string' ? documentKeyOrRef : createDocumentKey(documentKeyOrRef);
  const document = state.crdtDocuments.get(documentKey);

  if (document === undefined) {
    return {
      documentKey,
      materialized: 0,
      skipped: 0,
      heads: []
    };
  }

  const doc = Automerge.toJS(loadAutomergeDocument(document));
  const knowledge = isPlainRecord(doc.knowledge) ? doc.knowledge : {};
  const relations = isPlainRecord(doc.relations) ? doc.relations : {};
  const qualitySignals = isPlainRecord(doc.qualitySignals) ? doc.qualitySignals : {};
  const conflicts = isPlainRecord(doc.conflicts) ? doc.conflicts : {};
  const branch = document.document.branch;
  let materialized = 0;
  let skipped = 0;

  updateGlobalProjectionDocument(state, document, {
    knowledgeIds: collectProjectionRecordIds(knowledge),
    relationIds: collectProjectionRecordIds(relations),
    qualitySignalIds: collectProjectionRecordIds(qualitySignals),
    conflictIds: collectProjectionRecordIds(conflicts),
    materializedAt: new Date().toISOString()
  });

  if (branch === undefined) {
    return {
      documentKey,
      materialized: 0,
      skipped: Object.keys(knowledge).length,
      heads: [...document.heads]
    };
  }

  for (const value of Object.values(knowledge)) {
    const item = readCrdtKnowledgeItem(value, document.document);

    if (item === undefined) {
      skipped += 1;
      continue;
    }

    await core.repository.upsert(withKnowledgeGroupKey(item, branch));
    materialized += 1;
  }

  if (materialized > 0) {
    appendHubAuditLog(state, {
      actor,
      action: 'sync.crdt_materialized',
      targetType: 'crdt_document',
      targetId: document.key,
      branch,
      payload: {
        document: document.document,
        materialized,
        skipped,
        heads: document.heads
      }
    });
  }

  return {
    documentKey,
    materialized,
    skipped,
    heads: [...document.heads]
  };
}

export interface HubCrdtMaterializeResult {
  documentKey: string;
  materialized: number;
  skipped: number;
  heads: string[];
}

function updateGlobalProjectionDocument(
  state: HubState,
  document: HubCrdtDocument,
  input: Pick<
    HubGlobalProjectionDocument,
    'knowledgeIds' | 'relationIds' | 'qualitySignalIds' | 'conflictIds' | 'materializedAt'
  >
): void {
  const projectionDocument: HubGlobalProjectionDocument = {
    documentKey: document.key,
    document: cloneDocumentRef(document.document),
    sourceHeads: [...document.heads],
    materializedAt: input.materializedAt,
    knowledgeIds: input.knowledgeIds,
    relationIds: input.relationIds,
    qualitySignalIds: input.qualitySignalIds,
    conflictIds: input.conflictIds
  };

  if (document.document.branch !== undefined) {
    projectionDocument.branch = document.document.branch;
  }

  if (document.document.projectKey !== undefined) {
    projectionDocument.projectKey = document.document.projectKey;
  }

  state.globalProjection.documents[document.key] = projectionDocument;
  recalculateGlobalProjectionCounts(state);
}

function recalculateGlobalProjectionCounts(state: HubState): void {
  const documents = Object.values(state.globalProjection.documents);
  const groups = new Set(documents.map((document) => document.branch).filter((branch): branch is string => branch !== undefined));

  state.globalProjection.updatedAt = new Date().toISOString();
  state.globalProjection.counts = {
    documents: documents.length,
    groups: groups.size,
    knowledge: documents.reduce((total, document) => total + document.knowledgeIds.length, 0),
    relations: documents.reduce((total, document) => total + document.relationIds.length, 0),
    qualitySignals: documents.reduce((total, document) => total + document.qualitySignalIds.length, 0),
    conflicts: documents.reduce((total, document) => total + document.conflictIds.length, 0)
  };
}

function collectProjectionRecordIds(records: Record<string, unknown>): string[] {
  return Object.entries(records)
    .map(([key, value]) => (isPlainRecord(value) ? readNonEmptyString(value.id) ?? key : key))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeExchangeRequest(auth: HubAuthContext, input: unknown): HubResult<NormalizedExchangeRequest> {
  if (!isPlainRecord(input)) {
    return hubError(400, 'crdt_sync.body_invalid', 'CRDT sync exchange body must be an object.');
  }

  const clientId = readNonEmptyString(input.clientId);

  if (clientId === undefined) {
    return hubError(400, 'crdt_sync.client_id_required', 'clientId is required.');
  }

  const heads = normalizeStringArray(input.heads);

  if (heads === undefined) {
    return hubError(400, 'crdt_sync.heads_invalid', 'heads must be an array of strings.');
  }

  if (!Array.isArray(input.changes)) {
    return hubError(400, 'crdt_sync.changes_invalid', 'changes must be an array.');
  }

  const maxChanges = normalizeMaxChanges(input.maxChanges);

  if (maxChanges === undefined) {
    return hubError(400, 'crdt_sync.max_changes_invalid', 'maxChanges must be a positive integer.');
  }

  const document = normalizeDocumentRef(auth, input.document, input.projectKey);

  if (!document.ok) {
    return document;
  }

  return ok({
    clientId,
    documentKey: createDocumentKey(document.value),
    document: document.value,
    heads,
    changes: input.changes,
    maxChanges
  });
}

function normalizeDocumentRef(
  auth: HubAuthContext,
  value: unknown,
  projectKeyShortcut: unknown
): HubResult<CrdtSyncDocumentRef> {
  if (value !== undefined && !isPlainRecord(value)) {
    return hubError(400, 'crdt_sync.document_invalid', 'document must be an object when provided.');
  }

  const rawDocument = isPlainRecord(value) ? value : {};
  const requestedGroupKey = readNonEmptyString(rawDocument.branch);

  if (requestedGroupKey !== undefined && requestedGroupKey !== auth.branch) {
    return hubError(403, 'crdt_sync.group_mismatch', 'CRDT sync document branch must match the authenticated group.');
  }

  const kind = (readNonEmptyString(rawDocument.kind) ?? 'project') as CrdtSyncDocumentKind;
  const projectKey = readNonEmptyString(rawDocument.projectKey) ?? readNonEmptyString(projectKeyShortcut);
  const documentId = readNonEmptyString(rawDocument.documentId);
  const namespace = readNonEmptyString(rawDocument.namespace);
  const schemaVersion = readOptionalPositiveInteger(rawDocument.schemaVersion);

  if (rawDocument.schemaVersion !== undefined && schemaVersion === undefined) {
    return hubError(400, 'crdt_sync.schema_version_invalid', 'document.schemaVersion must be a positive integer.');
  }

  const document: CrdtSyncDocumentRef = {
    kind,
    branch: auth.branch
  };

  if (projectKey !== undefined) {
    document.projectKey = projectKey;
  } else if (kind === 'project') {
    document.projectKey = 'default';
  }

  if (documentId !== undefined) {
    document.documentId = documentId;
  }

  if (namespace !== undefined) {
    document.namespace = namespace;
  }

  if (schemaVersion !== undefined) {
    document.schemaVersion = schemaVersion;
  }

  return ok(document);
}

function normalizeCrdtChange(
  value: unknown,
  index: number
): { ok: true; value: NormalizedCrdtChange } | { ok: false; rejected: CrdtSyncRejectedChange } {
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      rejected: createRejectedChange(index, 'change.invalid')
    };
  }

  if (value.engine !== 'automerge') {
    return {
      ok: false,
      rejected: createRejectedChange(index, 'change.engine_unsupported', readNonEmptyString(value.id))
    };
  }

  if (value.encoding !== 'base64') {
    return {
      ok: false,
      rejected: createRejectedChange(index, 'change.encoding_unsupported', readNonEmptyString(value.id))
    };
  }

  const bytes = readNonEmptyString(value.bytes);
  const decoded = bytes === undefined ? undefined : decodeBase64(bytes);

  if (bytes === undefined || decoded === undefined || decoded.byteLength > MAX_CRDT_CHANGE_BYTES) {
    return {
      ok: false,
      rejected: createRejectedChange(index, 'change.bytes_invalid', readNonEmptyString(value.id))
    };
  }

  const headsBefore = normalizeStringArray(value.headsBefore);

  if (headsBefore === undefined) {
    return {
      ok: false,
      rejected: createRejectedChange(index, 'change.heads_before_invalid', readNonEmptyString(value.id))
    };
  }

  const headsAfter = normalizeStringArray(value.headsAfter);

  if (headsAfter === undefined) {
    return {
      ok: false,
      rejected: createRejectedChange(index, 'change.heads_after_invalid', readNonEmptyString(value.id))
    };
  }

  const id = readNonEmptyString(value.id) ?? createChangeId(decoded);
  const change: NormalizedCrdtChange = {
    id,
    bytes: encodeBinary(decoded),
    binary: decoded,
    headsBefore,
    headsAfter
  };
  const actorId = readNonEmptyString(value.actorId);
  const createdAt = readNonEmptyString(value.createdAt);
  const summary = readNonEmptyString(value.summary);

  if (actorId !== undefined) {
    change.actorId = actorId;
  }

  if (createdAt !== undefined) {
    change.createdAt = createdAt;
  }

  if (summary !== undefined) {
    change.summary = summary;
  }

  return {
    ok: true,
    value: change
  };
}

function getOrCreateHubCrdtDocument(
  state: HubState,
  key: string,
  documentRef: CrdtSyncDocumentRef,
  now: string
): HubCrdtDocument {
  const existing = state.crdtDocuments.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const document: HubCrdtDocument = {
    key,
    document: cloneDocumentRef(documentRef),
    heads: [],
    changes: [],
    updatedAt: now
  };

  state.crdtDocuments.set(key, document);

  return document;
}

function loadAutomergeDocument(document: HubCrdtDocument): AutomergeDoc<Record<string, unknown>> {
  if (document.snapshot !== undefined) {
    return Automerge.load<Record<string, unknown>>(decodeBase64(document.snapshot) ?? new Uint8Array());
  }

  let doc = Automerge.init<Record<string, unknown>>();

  for (const change of document.changes) {
    const decoded = decodeBase64(change.bytes);

    if (decoded === undefined) {
      continue;
    }

    const [nextDoc] = Automerge.applyChanges(doc, [decoded] as AutomergeBinaryChange[]);
    doc = nextDoc;
  }

  return doc;
}

function createStoredCrdtChange(input: {
  auth: HubAuthContext;
  change: NormalizedCrdtChange;
  headsAfter: string[];
  receivedAt: string;
}): HubCrdtChange {
  const stored: HubCrdtChange = {
    id: input.change.id,
    engine: 'automerge',
    encoding: 'base64',
    bytes: input.change.bytes,
    headsBefore: [...input.change.headsBefore],
    headsAfter: [...input.headsAfter],
    receivedAt: input.receivedAt,
    clientId: input.auth.clientId,
    branch: input.auth.branch
  };

  if (input.change.actorId !== undefined) {
    stored.actorId = input.change.actorId;
  }

  if (input.change.createdAt !== undefined) {
    stored.createdAt = input.change.createdAt;
  }

  if (input.change.summary !== undefined) {
    stored.summary = input.change.summary;
  }

  return stored;
}

function getChangesForClient(
  document: HubCrdtDocument,
  automergeDoc: AutomergeDoc<Record<string, unknown>>,
  heads: string[],
  incomingChangeIds: Set<string>
): HubCrdtChange[] {
  let binaryChanges: Uint8Array[];

  try {
    binaryChanges = Automerge.getChangesSince(automergeDoc, heads as AutomergeHeads);
  } catch {
    binaryChanges = Automerge.getAllChanges(automergeDoc);
  }

  const storedByBytes = new Map(document.changes.map((change) => [change.bytes, change]));
  const changes: HubCrdtChange[] = [];

  for (const binaryChange of binaryChanges) {
    const bytes = encodeBinary(binaryChange);
    const stored = storedByBytes.get(bytes);

    if (stored === undefined || incomingChangeIds.has(stored.id)) {
      continue;
    }

    changes.push(stored);
  }

  return changes;
}

function toProtocolCrdtChange(change: HubCrdtChange): CrdtSyncChange {
  const output: CrdtSyncChange = {
    id: change.id,
    engine: 'automerge',
    encoding: 'base64',
    bytes: change.bytes,
    headsBefore: [...change.headsBefore],
    headsAfter: [...change.headsAfter]
  };

  if (change.actorId !== undefined) {
    output.actorId = change.actorId;
  }

  if (change.createdAt !== undefined) {
    output.createdAt = change.createdAt;
  }

  if (change.summary !== undefined) {
    output.summary = change.summary;
  }

  return output;
}

function readCrdtKnowledgeItem(value: unknown, document: CrdtSyncDocumentRef): KnowledgeItem | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const id = readNonEmptyString(value.id);
  const layer = readKnowledgeLayer(value.layer);
  const entryKey = readNonEmptyString(value.entryKey);
  const type = readNonEmptyString(value.type);
  const title = readNonEmptyString(value.title);
  const summary = readNonEmptyString(value.summary);
  const para = readParaRef(value.para);
  const source = readKnowledgeSource(value.source, document);
  const createdBy = readMemberIdentity(value.createdBy);
  const createdAt = readNonEmptyString(value.createdAt);
  const updatedAt = readNonEmptyString(value.updatedAt);
  const visibility = readKnowledgeVisibility(value.visibility);
  const status = readKnowledgeStatus(value.status);
  const quality = readQualitySignals(value.quality);

  if (
    id === undefined ||
    layer === undefined ||
    entryKey === undefined ||
    type === undefined ||
    title === undefined ||
    summary === undefined ||
    para === undefined ||
    source === undefined ||
    createdBy === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    visibility === undefined ||
    status === undefined
  ) {
    return undefined;
  }

  const item: KnowledgeItem = {
    id,
    layer,
    entryKey,
    type,
    title,
    summary,
    para,
    tags: normalizeTags(value.tags),
    source,
    createdBy,
    createdAt,
    updatedAt,
    visibility,
    status,
    quality
  };
  const content = readOptionalString(value.content);

  if (content !== undefined) {
    item.content = content;
  }

  return item;
}

function readKnowledgeLayer(value: unknown): KnowledgeItem['layer'] | undefined {
  return value === 'raw' || value === 'extract' || value === 'canonical' ? value : undefined;
}

function readKnowledgeVisibility(value: unknown): KnowledgeItem['visibility'] | undefined {
  return value === 'private' || value === 'project' || value === 'team' || value === 'org' ? value : undefined;
}

function readKnowledgeStatus(value: unknown): KnowledgeItem['status'] | undefined {
  return value === 'active' || value === 'superseded' || value === 'tombstone' ? value : undefined;
}

function readParaRef(value: unknown): KnowledgeItem['para'] | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const category = value.category;
  const key = readNonEmptyString(value.key);

  if (
    key === undefined ||
    (category !== 'projects' && category !== 'areas' && category !== 'resources' && category !== 'archives')
  ) {
    return undefined;
  }

  return {
    category,
    key
  };
}

function readKnowledgeSource(value: unknown, document: CrdtSyncDocumentRef): KnowledgeItem['source'] | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const kind = readNonEmptyString(value.kind);

  if (kind === undefined) {
    return undefined;
  }

  const source: KnowledgeItem['source'] = {
    kind
  };
  const ref = readOptionalString(value.ref);
  const url = readOptionalString(value.url);
  const commit = readOptionalString(value.commit);
  const storageRef = readOptionalString(value.storageRef);
  const metadata = isPlainRecord(value.metadata) ? value.metadata : {};

  if (ref !== undefined) {
    source.ref = ref;
  }

  if (url !== undefined) {
    source.url = url;
  }

  if (commit !== undefined) {
    source.commit = commit;
  }

  if (storageRef !== undefined) {
    source.storageRef = storageRef;
  }

  source.metadata = {
    ...metadata,
    branch: document.branch,
    projectKey: document.projectKey ?? metadata.projectKey
  };

  return source;
}

function readMemberIdentity(value: unknown): KnowledgeItem['createdBy'] | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const displayName = readNonEmptyString(value.displayName);

  if (displayName === undefined) {
    return undefined;
  }

  const identity: KnowledgeItem['createdBy'] = {
    displayName
  };
  const memberId = readOptionalString(value.memberId);
  const handle = readOptionalString(value.handle);
  const clientId = readOptionalString(value.clientId);

  if (memberId !== undefined) {
    identity.memberId = memberId;
  }

  if (handle !== undefined) {
    identity.handle = handle;
  }

  if (clientId !== undefined) {
    identity.clientId = clientId;
  }

  return identity;
}

function readQualitySignals(value: unknown): KnowledgeItem['quality'] {
  if (!isPlainRecord(value)) {
    return createQualitySignals();
  }

  const input: Parameters<typeof createQualitySignals>[0] = {};
  const confidence = readFiniteNumber(value.confidence);
  const weight = readFiniteNumber(value.weight);
  const rating = readFiniteNumber(value.rating);
  const adoptionScore = readFiniteNumber(value.adoptionScore);
  const sourceTrust = readFiniteNumber(value.sourceTrust);
  const evidence = readFiniteNumber(value.evidence);
  const freshness = readFiniteNumber(value.freshness);

  if (confidence !== undefined) {
    input.confidence = confidence;
  }

  if (weight !== undefined) {
    input.weight = weight;
  }

  if (rating !== undefined) {
    input.rating = rating;
  }

  if (adoptionScore !== undefined) {
    input.adoptionScore = adoptionScore;
  }

  if (sourceTrust !== undefined) {
    input.sourceTrust = sourceTrust;
  }

  if (evidence !== undefined) {
    input.evidence = evidence;
  }

  if (freshness !== undefined) {
    input.freshness = freshness;
  }

  const quality = createQualitySignals(input);
  const qualityScore = readFiniteNumber(value.qualityScore);

  if (qualityScore !== undefined) {
    quality.qualityScore = qualityScore;
  } else {
    quality.qualityScore = computeQualityScore(quality);
  }

  return quality;
}

function normalizeTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

function auditCrdtExchange(
  state: HubState,
  auth: HubAuthContext,
  input: {
    document: HubCrdtDocument;
    acceptedChanges: CrdtSyncAcceptedChange[];
    rejected: CrdtSyncRejectedChange[];
    returnedChanges: number;
  }
): void {
  appendHubAuditLog(state, {
    actor: auth.memberId,
    action: 'sync.crdt_exchange',
    targetType: 'crdt_document',
    targetId: input.document.key,
    branch: auth.branch,
    payload: {
      clientId: auth.clientId,
      document: input.document.document,
      acceptedChanges: input.acceptedChanges.length,
      rejectedChanges: input.rejected.length,
      returnedChanges: input.returnedChanges,
      heads: input.document.heads
    }
  });
}

function createRejectedChange(index: number, reason: string, id?: string): CrdtSyncRejectedChange {
  const rejected: CrdtSyncRejectedChange = {
    index,
    reason
  };

  if (id !== undefined) {
    rejected.id = id;
  }

  return rejected;
}

function createDocumentKey(document: CrdtSyncDocumentRef): string {
  return `crdt_${createHash('sha256')
    .update(
      stableStringify({
        kind: document.kind,
        branch: document.branch,
        projectKey: document.projectKey,
        documentId: document.documentId,
        namespace: document.namespace
      })
    )
    .digest('hex')
    .slice(0, 32)}`;
}

function createChangeId(bytes: Uint8Array): string {
  return `am_${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}`;
}

function cloneDocumentRef(document: CrdtSyncDocumentRef): CrdtSyncDocumentRef {
  const clone: CrdtSyncDocumentRef = {
    kind: document.kind
  };

  if (document.branch !== undefined) {
    clone.branch = document.branch;
  }

  if (document.projectKey !== undefined) {
    clone.projectKey = document.projectKey;
  }

  if (document.documentId !== undefined) {
    clone.documentId = document.documentId;
  }

  if (document.namespace !== undefined) {
    clone.namespace = document.namespace;
  }

  if (document.schemaVersion !== undefined) {
    clone.schemaVersion = document.schemaVersion;
  }

  return clone;
}

function normalizeMaxChanges(value: unknown): number | undefined {
  if (value === undefined) {
    return DEFAULT_MAX_RESPONSE_CHANGES;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }

  return Math.min(value, MAX_RESPONSE_CHANGES);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings: string[] = [];

  for (const item of value) {
    const normalized = readNonEmptyString(item);

    if (normalized === undefined) {
      return undefined;
    }

    strings.push(normalized);
  }

  return strings;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return undefined;
  }

  const buffer = Buffer.from(value, 'base64');

  return buffer.byteLength === 0 ? undefined : new Uint8Array(buffer);
}

function encodeBinary(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}
