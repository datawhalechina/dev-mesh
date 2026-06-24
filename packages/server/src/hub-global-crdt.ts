import { createHash, randomUUID } from 'node:crypto';
import * as Automerge from '@automerge/automerge';
import type { Change as AutomergeBinaryChange, Doc as AutomergeDoc } from '@automerge/automerge';
import type { CrdtSyncDocumentRef } from '@devmesh/protocol';
import type { HubCrdtDocument, HubGlobalProjectionDocument, HubState } from './hub-model.js';

const SERVER_GLOBAL_GROUP_KEY = 'server-global';
const ADMIN_OPERATIONS_NAMESPACE = 'admin-operations';

const ADMIN_OPERATIONS_DOCUMENT: CrdtSyncDocumentRef = {
  kind: 'server-global',
  namespace: ADMIN_OPERATIONS_NAMESPACE,
  schemaVersion: 2
};

interface AdminOperationsDocument {
  schemaVersion?: number;
  operations?: Record<string, AdminGlobalCrdtOperation>;
  operationIds?: string[];
}

export interface AdminGlobalCrdtOperation {
  id: string;
  action: string;
  actor: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  branch: string;
  payload: Record<string, unknown>;
}

export interface AdminGlobalCrdtOperationInput {
  action: string;
  actor?: string;
  targetType: string;
  targetId: string;
  branch?: string;
  payload?: Record<string, unknown>;
}

export function appendAdminGlobalCrdtOperation(
  state: HubState,
  input: AdminGlobalCrdtOperationInput,
  now: () => Date = () => new Date()
): AdminGlobalCrdtOperation {
  const timestamp = now().toISOString();
  const operation: AdminGlobalCrdtOperation = {
    id: `op_${randomUUID().replace(/-/g, '')}`,
    action: input.action,
    actor: input.actor ?? 'admin',
    targetType: input.targetType,
    targetId: input.targetId,
    createdAt: timestamp,
    branch: input.branch ?? SERVER_GLOBAL_GROUP_KEY,
    payload: sanitizeCrdtRecord(input.payload ?? {})
  };
  const document = getOrCreateServerGlobalDocument(state, timestamp);
  const currentDoc = loadAutomergeDocument(document);
  const headsBefore = [...Automerge.getHeads(currentDoc)];
  const nextDoc = Automerge.change(currentDoc, (draft) => {
    draft.schemaVersion = 2;

    if (!isPlainRecord(draft.operations)) {
      draft.operations = {};
    }

    if (!Array.isArray(draft.operationIds)) {
      draft.operationIds = [];
    }

    const operations = draft.operations as Record<string, AdminGlobalCrdtOperation>;
    const operationIds = draft.operationIds as string[];

    operations[operation.id] = operation;
    operationIds.push(operation.id);
  });
  const headsAfter = [...Automerge.getHeads(nextDoc)];
  const binaryChanges = Automerge.getChanges(currentDoc, nextDoc);

  for (const binaryChange of binaryChanges) {
    document.changes.push({
      id: createChangeId(binaryChange),
      engine: 'automerge',
      encoding: 'base64',
      bytes: encodeBinary(binaryChange),
      headsBefore,
      headsAfter,
      receivedAt: timestamp,
      clientId: 'admin',
      branch: operation.branch,
      actorId: operation.actor,
      createdAt: timestamp,
      summary: operation.action
    });
  }

  document.heads = headsAfter;
  document.snapshot = encodeBinary(Automerge.save(nextDoc));
  document.updatedAt = timestamp;
  updateServerGlobalProjectionDocument(state, document, timestamp);

  return operation;
}

function getOrCreateServerGlobalDocument(state: HubState, now: string): HubCrdtDocument {
  const key = createDocumentKey(ADMIN_OPERATIONS_DOCUMENT);
  const existing = state.crdtDocuments.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const document: HubCrdtDocument = {
    key,
    document: cloneDocumentRef(ADMIN_OPERATIONS_DOCUMENT),
    heads: [],
    changes: [],
    updatedAt: now
  };

  state.crdtDocuments.set(key, document);

  return document;
}

function loadAutomergeDocument(document: HubCrdtDocument): AutomergeDoc<AdminOperationsDocument> {
  if (document.snapshot !== undefined) {
    return Automerge.load<AdminOperationsDocument>(decodeBase64(document.snapshot));
  }

  let doc = Automerge.init<AdminOperationsDocument>();

  for (const change of document.changes) {
    const [nextDoc] = Automerge.applyChanges(doc, [decodeBase64(change.bytes)] as AutomergeBinaryChange[]);
    doc = nextDoc;
  }

  return doc;
}

function updateServerGlobalProjectionDocument(state: HubState, document: HubCrdtDocument, materializedAt: string): void {
  const projectionDocument: HubGlobalProjectionDocument = {
    documentKey: document.key,
    document: cloneDocumentRef(document.document),
    sourceHeads: [...document.heads],
    materializedAt,
    knowledgeIds: [],
    relationIds: [],
    qualitySignalIds: [],
    conflictIds: []
  };

  state.globalProjection.documents[document.key] = projectionDocument;
  state.globalProjection.updatedAt = materializedAt;
  state.globalProjection.counts = createGlobalProjectionCounts(Object.values(state.globalProjection.documents));
}

function createGlobalProjectionCounts(documents: HubGlobalProjectionDocument[]): HubState['globalProjection']['counts'] {
  const groups = new Set(documents.map((document) => document.branch).filter((branch): branch is string => branch !== undefined));

  return {
    documents: documents.length,
    groups: groups.size,
    knowledge: documents.reduce((total, document) => total + document.knowledgeIds.length, 0),
    relations: documents.reduce((total, document) => total + document.relationIds.length, 0),
    qualitySignals: documents.reduce((total, document) => total + document.qualitySignalIds.length, 0),
    conflicts: documents.reduce((total, document) => total + document.conflictIds.length, 0)
  };
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

function sanitizeCrdtRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, sanitizeCrdtValue(entryValue)])
  );
}

function sanitizeCrdtValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(sanitizeCrdtValue);
  }

  if (isPlainRecord(value)) {
    return sanitizeCrdtRecord(value);
  }

  return value;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid server-global CRDT change encoding.');
  }

  const buffer = Buffer.from(value, 'base64');

  if (buffer.byteLength === 0) {
    throw new Error('Invalid empty server-global CRDT change.');
  }

  return new Uint8Array(buffer);
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
