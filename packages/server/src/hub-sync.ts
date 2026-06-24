import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { DevMeshCore, KnowledgeItem } from '@devmesh/core';
import type { SyncEvent, SyncPullResponse, SyncPushRequest, SyncPushResponse } from '@devmesh/protocol';
import { appendHubAuditLog } from './hub-audit.js';
import type { HubAuthContext, HubKnowledgeEdge, HubResult, HubState, HubSyncEvent } from './hub-model.js';
import { withKnowledgeGroupKey } from './hub-knowledge-scope.js';
import { hubError, ok } from './hub-utils.js';

export interface HubSyncEventLogPage {
  cursor: string;
  events: HubSyncEvent[];
}

export interface HubSyncEventMergeInput {
  branch: string;
  events: HubSyncEvent[];
  acceptedAt?: string;
  actor?: string;
}

export interface HubSyncEventMergeResult {
  accepted: number;
  skipped: number;
  cursor: string;
}

export interface HubSyncEventLogVerificationInput {
  branch: string;
  actor?: string;
}

export interface HubSyncEventLogVerificationFailure {
  id: string;
  reason: string;
}

export interface HubSyncEventLogVerificationResult {
  ok: boolean;
  checked: number;
  rejected: HubSyncEventLogVerificationFailure[];
}

export interface HubSyncTombstoneReplayInput {
  branch: string;
  cursor?: string;
  actor?: string;
}

export interface HubSyncTombstoneReplayResult {
  scanned: number;
  applied: number;
  skipped: number;
  missing: number;
  cursor: string;
}

export interface HubSyncConflictReplayInput {
  branch: string;
  cursor?: string;
  actor?: string;
}

export interface HubSyncConflictReplayResult {
  scanned: number;
  conflicts: number;
  edgesCreated: number;
  skipped: number;
  cursor: string;
}

export interface HubSyncKnowledgeSnapshotReplayInput {
  branch: string;
  cursor?: string;
  actor?: string;
}

export interface HubSyncKnowledgeSnapshotReplayResult {
  scanned: number;
  upserted: number;
  skipped: number;
  cursor: string;
}

interface KnowledgeConflictRevision {
  knowledgeId: string;
  revisionId: string;
  event: HubSyncEvent;
  reason?: string;
}

export function pushHubSyncEvents(
  state: HubState,
  auth: HubAuthContext,
  input: SyncPushRequest
): HubResult<SyncPushResponse> {
  if (input.clientId !== auth.clientId) {
    return hubError(403, 'sync.client_mismatch', 'clientId must match the authenticated client.');
  }

  if (!Array.isArray(input.events)) {
    return hubError(400, 'sync.events_invalid', 'events must be an array.');
  }

  const groupEvents = getBranchSyncEvents(state, auth.branch);
  const existingIds = new Set(groupEvents.map((event) => event.id));
  const rejected: SyncPushResponse['rejected'] = [];
  let accepted = 0;

  for (const rawEvent of input.events) {
    const validation = normalizeSyncEvent(rawEvent);

    if (!validation.ok) {
      auditSyncSignatureRejection(state, auth, validation.rejected.id, validation.rejected.reason);
      rejected.push(validation.rejected);
      continue;
    }

    const { event } = validation;
    const signatureRejection = validateSyncEventSignature(auth, event);

    if (signatureRejection !== undefined) {
      auditSyncSignatureRejection(state, auth, event.id, signatureRejection.reason);
      rejected.push(signatureRejection);
      continue;
    }

    if (existingIds.has(event.id)) {
      continue;
    }

    const hubEvent = appendHubSyncEvent(groupEvents, createHubSyncEvent(auth, event));
    existingIds.add(event.id);
    accepted += 1;
    auditSyncTombstoneAccepted(state, {
      actor: auth.memberId,
      branch: auth.branch,
      event: hubEvent
    });
  }

  return ok({
    accepted,
    rejected,
    cursor: createSyncCursor(auth.branch, groupEvents.length)
  });
}

export function pullHubSyncEvents(
  state: HubState,
  auth: HubAuthContext,
  cursor: string | undefined
): SyncPullResponse {
  const page = pullHubSyncEventLog(state, auth.branch, cursor);

  return {
    cursor: page.cursor,
    events: page.events.map(toProtocolSyncEvent)
  };
}

export function pullHubSyncEventLog(
  state: HubState,
  branch: string,
  cursor: string | undefined,
  limit?: number
): HubSyncEventLogPage {
  const groupEvents = getBranchSyncEvents(state, branch);
  const offset = readSyncCursorOffset(branch, cursor);
  const boundedLimit = limit === undefined ? undefined : Math.max(0, Math.floor(limit));
  const end = boundedLimit === undefined ? undefined : offset + boundedLimit;
  const nextEvents = groupEvents.slice(offset, end);
  const nextOffset = boundedLimit === undefined ? groupEvents.length : offset + nextEvents.length;

  return {
    cursor: createSyncCursor(branch, nextOffset),
    events: nextEvents.map(cloneHubSyncEvent)
  };
}

export function mergeHubSyncEventLog(state: HubState, input: HubSyncEventMergeInput): HubSyncEventMergeResult {
  const groupEvents = getBranchSyncEvents(state, input.branch);
  const existingIds = new Set(groupEvents.map((event) => event.id));
  const acceptedAt = input.acceptedAt ?? new Date().toISOString();
  let accepted = 0;
  let skipped = 0;

  for (const event of input.events) {
    if (existingIds.has(event.id)) {
      skipped += 1;
      continue;
    }

    const merged = appendHubSyncEvent(
      groupEvents,
      cloneHubSyncEvent({
        ...event,
        branch: input.branch,
        acceptedAt
      })
    );
    existingIds.add(merged.id);
    accepted += 1;
    auditSyncTombstoneAccepted(state, {
      actor: input.actor ?? merged.clientId,
      branch: input.branch,
      event: merged
    });
  }

  return {
    accepted,
    skipped,
    cursor: createSyncCursor(input.branch, groupEvents.length)
  };
}

export async function replayHubSyncTombstones(
  state: HubState,
  core: DevMeshCore,
  input: HubSyncTombstoneReplayInput
): Promise<HubSyncTombstoneReplayResult> {
  const page = pullHubSyncEventLog(state, input.branch, input.cursor);
  let applied = 0;
  let skipped = 0;
  let missing = 0;

  for (const event of page.events) {
    const tombstone = readKnowledgeTombstonePayload(event);

    if (tombstone === undefined) {
      skipped += 1;
      continue;
    }

    const existing = await core.repository.get(tombstone.knowledgeId);

    if (existing === undefined) {
      missing += 1;
      continue;
    }

    if (existing.status === 'tombstone') {
      skipped += 1;
      continue;
    }

    await core.repository.upsert(createTombstoneKnowledgeItem(existing, tombstone.deletedAt ?? event.createdAt));
    applied += 1;
    auditSyncTombstoneReplayed(state, {
      actor: input.actor ?? event.clientId,
      branch: input.branch,
      event,
      tombstone,
      previousStatus: existing.status
    });
  }

  return {
    scanned: page.events.length,
    applied,
    skipped,
    missing,
    cursor: page.cursor
  };
}

export async function replayHubSyncConflicts(
  state: HubState,
  core: DevMeshCore,
  input: HubSyncConflictReplayInput
): Promise<HubSyncConflictReplayResult> {
  const page = pullHubSyncEventLog(state, input.branch, input.cursor);
  const revisionsByKnowledgeId = collectKnowledgeConflictRevisions(state, input.branch);
  const processedPairs = new Set<string>();
  const knownKnowledge = new Map<string, boolean>();
  let conflicts = 0;
  let edgesCreated = 0;
  let skipped = 0;

  for (const event of page.events) {
    const revision = readKnowledgeConflictRevision(event);

    if (revision === undefined) {
      skipped += 1;
      continue;
    }

    const contenders = revisionsByKnowledgeId
      .get(revision.knowledgeId)
      ?.filter((candidate) => candidate.revisionId !== revision.revisionId);

    if (contenders === undefined || contenders.length === 0) {
      skipped += 1;
      continue;
    }

    for (const contender of contenders) {
      const [left, right] = orderKnowledgeConflictPair(revision, contender);
      const pairKey = createKnowledgeConflictPairKey(input.branch, left, right);

      if (processedPairs.has(pairKey)) {
        continue;
      }

      processedPairs.add(pairKey);
      conflicts += 1;

      if (hasKnowledgeConflictEdge(state, input.branch, left.revisionId, right.revisionId)) {
        skipped += 1;
        continue;
      }

      const [leftExists, rightExists] = await Promise.all([
        hasKnowledgeItem(core, knownKnowledge, left.revisionId),
        hasKnowledgeItem(core, knownKnowledge, right.revisionId)
      ]);

      if (!leftExists || !rightExists) {
        skipped += 1;
        continue;
      }

      const edge = createHubSyncConflictEdge({
        branch: input.branch,
        actor: input.actor ?? revision.event.clientId,
        left,
        right
      });
      state.knowledgeEdges.push(edge);
      edgesCreated += 1;
      auditSyncConflictReplayed(state, {
        actor: input.actor ?? revision.event.clientId,
        branch: input.branch,
        edge,
        left,
        right
      });
    }
  }

  return {
    scanned: page.events.length,
    conflicts,
    edgesCreated,
    skipped,
    cursor: page.cursor
  };
}

export async function replayHubSyncKnowledgeSnapshots(
  state: HubState,
  core: DevMeshCore,
  input: HubSyncKnowledgeSnapshotReplayInput
): Promise<HubSyncKnowledgeSnapshotReplayResult> {
  const page = pullHubSyncEventLog(state, input.branch, input.cursor);
  let upserted = 0;
  let skipped = 0;

  for (const event of page.events) {
    const item = readKnowledgeSnapshot(event);

    if (item === undefined) {
      skipped += 1;
      continue;
    }

    await core.repository.upsert(withKnowledgeGroupKey(item, input.branch));
    upserted += 1;
    auditSyncKnowledgeSnapshotReplayed(state, {
      actor: input.actor ?? event.clientId,
      branch: input.branch,
      event,
      item
    });
  }

  return {
    scanned: page.events.length,
    upserted,
    skipped,
    cursor: page.cursor
  };
}

export function verifyHubSyncEventLog(
  state: HubState,
  input: HubSyncEventLogVerificationInput
): HubSyncEventLogVerificationResult {
  const groupEvents = getBranchSyncEvents(state, input.branch);
  const rejected: HubSyncEventLogVerificationFailure[] = [];
  let previousHash: string | undefined;

  for (const [index, event] of groupEvents.entries()) {
    const expectedSequence = index + 1;

    if (event.log === undefined) {
      rejected.push({
        id: event.id,
        reason: 'event.log_missing'
      });
      previousHash = undefined;
    } else {
      if (event.log.sequence !== expectedSequence) {
        rejected.push({
          id: event.id,
          reason: 'event.log_sequence_mismatch'
        });
      }

      if (event.log.previousHash !== previousHash) {
        rejected.push({
          id: event.id,
          reason: 'event.log_previous_hash_mismatch'
        });
      }

      if (event.log.hash !== createSyncEventLogHash(event, expectedSequence, previousHash)) {
        rejected.push({
          id: event.id,
          reason: 'event.log_hash_mismatch'
        });
      }

      previousHash = event.log.hash;
    }

    const signatureRejection = verifyStoredSyncEventSignature(state, event);

    if (signatureRejection !== undefined) {
      rejected.push(signatureRejection);
    }
  }

  const result: HubSyncEventLogVerificationResult = {
    ok: rejected.length === 0,
    checked: groupEvents.length,
    rejected
  };

  if (!result.ok && input.actor !== undefined) {
    auditSyncEventLogVerificationFailure(state, input, result);
  }

  return result;
}

function getBranchSyncEvents(state: HubState, branch: string): HubSyncEvent[] {
  let events = state.syncEvents.get(branch);

  if (events === undefined) {
    events = [];
    state.syncEvents.set(branch, events);
  }

  return events;
}

function normalizeSyncEvent(
  event: unknown
): { ok: true; event: SyncEvent } | { ok: false; rejected: SyncPushResponse['rejected'][number] } {
  if (!isPlainRecord(event) || typeof event.id !== 'string' || !event.id.trim()) {
    return {
      ok: false,
      rejected: {
        id: isPlainRecord(event) && typeof event.id === 'string' && event.id.trim() ? event.id : 'unknown',
        reason: 'event.id_required'
      }
    };
  }

  if (typeof event.kind !== 'string' || !event.kind.trim()) {
    return {
      ok: false,
      rejected: {
        id: event.id,
        reason: 'event.kind_required'
      }
    };
  }

  if (!isPlainRecord(event.payload)) {
    return {
      ok: false,
      rejected: {
        id: event.id,
        reason: 'event.payload_invalid'
      }
    };
  }

  const payloadRejection = validateSyncEventPayload(event.id, event.kind, event.payload);

  if (payloadRejection !== undefined) {
    return {
      ok: false,
      rejected: payloadRejection
    };
  }

  const normalized: SyncEvent = {
    id: event.id,
    kind: event.kind,
    payload: event.payload
  };

  if (typeof event.createdAt === 'string') {
    normalized.createdAt = event.createdAt;
  }

  if (event.signature !== undefined) {
    if (!isPlainRecord(event.signature)) {
      return {
        ok: false,
        rejected: {
          id: event.id,
          reason: 'event.signature_invalid'
        }
      };
    }

    if (event.signature.algorithm !== 'hmac-sha256') {
      return {
        ok: false,
        rejected: {
          id: event.id,
          reason: 'event.signature_unsupported'
        }
      };
    }

    if (typeof event.signature.value !== 'string' || !/^[a-f0-9]{64}$/i.test(event.signature.value)) {
      return {
        ok: false,
        rejected: {
          id: event.id,
          reason: 'event.signature_invalid'
        }
      };
    }

    normalized.signature = {
      algorithm: 'hmac-sha256',
      value: event.signature.value.toLowerCase()
    };

    if (typeof event.signature.signedAt === 'string') {
      normalized.signature.signedAt = event.signature.signedAt;
    }

    if (typeof event.signature.keyId === 'string') {
      normalized.signature.keyId = event.signature.keyId;
    }
  }

  return {
    ok: true,
    event: normalized
  };
}

function validateSyncEventSignature(
  auth: HubAuthContext,
  event: SyncEvent
): SyncPushResponse['rejected'][number] | undefined {
  if (event.signature === undefined) {
    return undefined;
  }

  if (event.signature.keyId !== undefined && event.signature.keyId !== auth.clientId) {
    return {
      id: event.id,
      reason: 'event.signature_key_mismatch'
    };
  }

  const expectedSignature = createSyncEventSignature(auth, event);

  if (!isEqualSignature(expectedSignature, event.signature.value)) {
    return {
      id: event.id,
      reason: 'event.signature_mismatch'
    };
  }

  return undefined;
}

function createHubSyncEvent(auth: HubAuthContext, event: SyncEvent): HubSyncEvent {
  const createdAt = typeof event.createdAt === 'string' && event.createdAt.trim() ? event.createdAt : new Date().toISOString();

  const hubEvent: HubSyncEvent = {
    id: event.id,
    kind: event.kind,
    payload: event.payload,
    createdAt,
    clientId: auth.clientId,
    branch: auth.branch,
    acceptedAt: new Date().toISOString()
  };

  if (event.signature !== undefined) {
    hubEvent.signature = event.signature;
  }

  return hubEvent;
}

function toProtocolSyncEvent(event: HubSyncEvent): SyncEvent {
  const protocolEvent: SyncEvent = {
    id: event.id,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt
  };

  if (event.signature !== undefined) {
    protocolEvent.signature = event.signature;
  }

  if (event.log !== undefined) {
    protocolEvent.log = cloneSyncEventLogMetadata(event.log);
  }

  return protocolEvent;
}

function cloneHubSyncEvent(event: HubSyncEvent): HubSyncEvent {
  const clone: HubSyncEvent = {
    id: event.id,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt,
    clientId: event.clientId,
    branch: event.branch,
    acceptedAt: event.acceptedAt
  };

  if (event.signature !== undefined) {
    clone.signature = event.signature;
  }

  if (event.log !== undefined) {
    clone.log = cloneSyncEventLogMetadata(event.log);
  }

  return clone;
}

function appendHubSyncEvent(groupEvents: HubSyncEvent[], event: HubSyncEvent): HubSyncEvent {
  const previousHash = groupEvents.at(-1)?.log?.hash;
  const loggedEvent = cloneHubSyncEvent({
    ...event,
    log: createSyncEventLogMetadata(event, groupEvents.length + 1, previousHash)
  });

  groupEvents.push(loggedEvent);

  return loggedEvent;
}

function createSyncEventLogMetadata(
  event: HubSyncEvent,
  sequence: number,
  previousHash: string | undefined
): NonNullable<HubSyncEvent['log']> {
  const log: NonNullable<HubSyncEvent['log']> = {
    sequence,
    hash: createSyncEventLogHash(event, sequence, previousHash)
  };

  if (previousHash !== undefined) {
    log.previousHash = previousHash;
  }

  return log;
}

function cloneSyncEventLogMetadata(log: NonNullable<HubSyncEvent['log']>): NonNullable<HubSyncEvent['log']> {
  const clone: NonNullable<HubSyncEvent['log']> = {
    sequence: log.sequence,
    hash: log.hash
  };

  if (log.previousHash !== undefined) {
    clone.previousHash = log.previousHash;
  }

  return clone;
}

function createSyncEventLogHash(
  event: HubSyncEvent,
  sequence: number,
  previousHash: string | undefined
): string {
  return createHash('sha256')
    .update(
      stableStringify({
        version: 1,
        sequence,
        previousHash: previousHash ?? null,
        event: {
          id: event.id,
          kind: event.kind,
          payload: event.payload,
          createdAt: event.createdAt,
          clientId: event.clientId,
          branch: event.branch,
          acceptedAt: event.acceptedAt,
          signature: event.signature ?? null
        }
      })
    )
    .digest('hex');
}

function createSyncCursor(branch: string, offset: number): string {
  return `cur_${branch}_${offset}`;
}

function readSyncCursorOffset(branch: string, cursor: string | undefined): number {
  const prefix = `cur_${branch}_`;

  if (cursor === undefined || !cursor.startsWith(prefix)) {
    return 0;
  }

  const offset = Number.parseInt(cursor.slice(prefix.length), 10);

  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSyncEventPayload(
  eventId: string,
  kind: string,
  payload: Record<string, unknown>
): SyncPushResponse['rejected'][number] | undefined {
  if (kind === 'knowledge.updated') {
    return validateKnowledgeConflictPayload(eventId, payload);
  }

  if (kind !== 'knowledge.deleted') {
    return undefined;
  }

  if (typeof payload.knowledgeId !== 'string' || !payload.knowledgeId.trim()) {
    return {
      id: eventId,
      reason: 'event.tombstone_knowledge_id_required'
    };
  }

  if (payload.tombstone !== true) {
    return {
      id: eventId,
      reason: 'event.tombstone_flag_required'
    };
  }

  if (payload.reason !== undefined && typeof payload.reason !== 'string') {
    return {
      id: eventId,
      reason: 'event.tombstone_reason_invalid'
    };
  }

  if (payload.deletedAt !== undefined && typeof payload.deletedAt !== 'string') {
    return {
      id: eventId,
      reason: 'event.tombstone_deleted_at_invalid'
    };
  }

  return undefined;
}

function validateKnowledgeConflictPayload(
  eventId: string,
  payload: Record<string, unknown>
): SyncPushResponse['rejected'][number] | undefined {
  if (payload.conflict !== true) {
    return undefined;
  }

  if (typeof payload.knowledgeId !== 'string' || !payload.knowledgeId.trim()) {
    return {
      id: eventId,
      reason: 'event.conflict_knowledge_id_required'
    };
  }

  if (typeof payload.revisionId !== 'string' || !payload.revisionId.trim()) {
    return {
      id: eventId,
      reason: 'event.conflict_revision_id_required'
    };
  }

  if (payload.knowledgeId.trim() === payload.revisionId.trim()) {
    return {
      id: eventId,
      reason: 'event.conflict_revision_self_reference'
    };
  }

  if (payload.reason !== undefined && typeof payload.reason !== 'string') {
    return {
      id: eventId,
      reason: 'event.conflict_reason_invalid'
    };
  }

  if (payload.baseEventId !== undefined && typeof payload.baseEventId !== 'string') {
    return {
      id: eventId,
      reason: 'event.conflict_base_event_id_invalid'
    };
  }

  if (payload.baseVersion !== undefined && typeof payload.baseVersion !== 'string') {
    return {
      id: eventId,
      reason: 'event.conflict_base_version_invalid'
    };
  }

  return undefined;
}

function readKnowledgeTombstonePayload(
  event: HubSyncEvent
): { knowledgeId: string; reason?: string; deletedAt?: string } | undefined {
  if (event.kind !== 'knowledge.deleted') {
    return undefined;
  }

  const knowledgeId = event.payload.knowledgeId;

  if (typeof knowledgeId !== 'string' || !knowledgeId.trim() || event.payload.tombstone !== true) {
    return undefined;
  }

  const tombstone: { knowledgeId: string; reason?: string; deletedAt?: string } = {
    knowledgeId
  };

  if (typeof event.payload.reason === 'string') {
    tombstone.reason = event.payload.reason;
  }

  if (typeof event.payload.deletedAt === 'string') {
    tombstone.deletedAt = event.payload.deletedAt;
  }

  return tombstone;
}

function readKnowledgeSnapshot(event: HubSyncEvent): KnowledgeItem | undefined {
  if (event.kind === 'knowledge.deleted') {
    return undefined;
  }

  const value = event.payload.knowledge;

  return isKnowledgeItem(value) ? value : undefined;
}

function collectKnowledgeConflictRevisions(
  state: HubState,
  branch: string
): Map<string, KnowledgeConflictRevision[]> {
  const revisions = new Map<string, KnowledgeConflictRevision[]>();
  const events = pullHubSyncEventLog(state, branch, undefined).events;

  for (const event of events) {
    const revision = readKnowledgeConflictRevision(event);

    if (revision === undefined) {
      continue;
    }

    const existing = revisions.get(revision.knowledgeId);

    if (existing === undefined) {
      revisions.set(revision.knowledgeId, [revision]);
      continue;
    }

    if (!existing.some((candidate) => candidate.revisionId === revision.revisionId)) {
      existing.push(revision);
    }
  }

  return revisions;
}

function readKnowledgeConflictRevision(event: HubSyncEvent): KnowledgeConflictRevision | undefined {
  if (event.kind !== 'knowledge.updated' || event.payload.conflict === false) {
    return undefined;
  }

  const knowledgeId = readPayloadString(event.payload, 'knowledgeId');
  const revisionId = readPayloadString(event.payload, 'revisionId');

  if (knowledgeId === undefined || revisionId === undefined || knowledgeId === revisionId) {
    return undefined;
  }

  const revision: KnowledgeConflictRevision = {
    knowledgeId,
    revisionId,
    event
  };
  const reason = readPayloadString(event.payload, 'reason');

  if (reason !== undefined) {
    revision.reason = reason;
  }

  return revision;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();

  return normalized ? normalized : undefined;
}

function orderKnowledgeConflictPair(
  left: KnowledgeConflictRevision,
  right: KnowledgeConflictRevision
): [KnowledgeConflictRevision, KnowledgeConflictRevision] {
  return left.revisionId.localeCompare(right.revisionId) <= 0 ? [left, right] : [right, left];
}

function createKnowledgeConflictPairKey(
  branch: string,
  left: KnowledgeConflictRevision,
  right: KnowledgeConflictRevision
): string {
  return `${branch}:${left.knowledgeId}:${left.revisionId}:${right.revisionId}`;
}

function hasKnowledgeConflictEdge(state: HubState, branch: string, leftId: string, rightId: string): boolean {
  return state.knowledgeEdges.some(
    (edge) =>
      edge.kind === 'contradicts' &&
      edge.branch === branch &&
      ((edge.fromId === leftId && edge.toId === rightId) || (edge.fromId === rightId && edge.toId === leftId))
  );
}

async function hasKnowledgeItem(core: DevMeshCore, cache: Map<string, boolean>, id: string): Promise<boolean> {
  const cached = cache.get(id);

  if (cached !== undefined) {
    return cached;
  }

  const exists = (await core.getKnowledge(id)) !== undefined;
  cache.set(id, exists);

  return exists;
}

function createHubSyncConflictEdge(input: {
  branch: string;
  actor: string;
  left: KnowledgeConflictRevision;
  right: KnowledgeConflictRevision;
}): HubKnowledgeEdge {
  const reason =
    input.left.reason ?? input.right.reason ?? `Offline update conflict for knowledge ${input.left.knowledgeId}`;

  return {
    id: createSyncConflictEdgeId(input.branch, input.left.knowledgeId, input.left.revisionId, input.right.revisionId),
    kind: 'contradicts',
    fromId: input.left.revisionId,
    toId: input.right.revisionId,
    createdBy: input.actor,
    createdAt: new Date().toISOString(),
    branch: input.branch,
    reason
  };
}

function createSyncConflictEdgeId(branch: string, knowledgeId: string, leftId: string, rightId: string): string {
  return `edge_sync_conflict_${createHash('sha256')
    .update(`${branch}:${knowledgeId}:${leftId}:${rightId}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function createTombstoneKnowledgeItem(item: KnowledgeItem, updatedAt: string): KnowledgeItem {
  return {
    ...item,
    status: 'tombstone',
    updatedAt
  };
}

function isKnowledgeItem(value: unknown): value is KnowledgeItem {
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

function isKnowledgeLayer(value: unknown): value is KnowledgeItem['layer'] {
  return value === 'raw' || value === 'extract' || value === 'canonical';
}

function isParaRef(value: unknown): value is KnowledgeItem['para'] {
  return (
    isPlainRecord(value) &&
    (value.category === 'projects' ||
      value.category === 'areas' ||
      value.category === 'resources' ||
      value.category === 'archives') &&
    typeof value.key === 'string'
  );
}

function isKnowledgeSource(value: unknown): value is KnowledgeItem['source'] {
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

function isMemberIdentity(value: unknown): value is KnowledgeItem['createdBy'] {
  return (
    isPlainRecord(value) &&
    (value.memberId === undefined || typeof value.memberId === 'string') &&
    typeof value.displayName === 'string' &&
    (value.handle === undefined || typeof value.handle === 'string') &&
    (value.clientId === undefined || typeof value.clientId === 'string')
  );
}

function isKnowledgeVisibility(value: unknown): value is KnowledgeItem['visibility'] {
  return value === 'private' || value === 'project' || value === 'team' || value === 'org';
}

function isKnowledgeStatus(value: unknown): value is KnowledgeItem['status'] {
  return value === 'active' || value === 'superseded' || value === 'tombstone';
}

function isQualitySignals(value: unknown): value is KnowledgeItem['quality'] {
  if (!isPlainRecord(value)) {
    return false;
  }

  return [
    value.confidence,
    value.weight,
    value.rating,
    value.adoptionScore,
    value.sourceTrust,
    value.evidence,
    value.freshness,
    value.qualityScore
  ].every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function createSyncEventSignature(auth: HubAuthContext, event: SyncEvent): string {
  return createHmac('sha256', auth.syncSigningSecret)
    .update(
      stableStringify({
        clientId: auth.clientId,
        branch: auth.branch,
        event: {
          id: event.id,
          kind: event.kind,
          createdAt: event.createdAt ?? null,
          payload: event.payload
        },
        signature: {
          algorithm: event.signature?.algorithm ?? 'hmac-sha256',
          keyId: event.signature?.keyId ?? null,
          signedAt: event.signature?.signedAt ?? null
        }
      })
    )
    .digest('hex');
}

function isEqualSignature(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifyStoredSyncEventSignature(
  state: HubState,
  event: HubSyncEvent
): HubSyncEventLogVerificationFailure | undefined {
  if (event.signature === undefined) {
    return undefined;
  }

  const auth = findSyncEventAuthContext(state, event);

  if (auth === undefined) {
    return {
      id: event.id,
      reason: 'event.signature_secret_missing'
    };
  }

  const rejection = validateSyncEventSignature(auth, event);

  return rejection === undefined
    ? undefined
    : {
        id: rejection.id,
        reason: rejection.reason
      };
}

function findSyncEventAuthContext(state: HubState, event: HubSyncEvent): HubAuthContext | undefined {
  for (const token of state.tokens.values()) {
    if (token.clientId === event.clientId && token.branch === event.branch) {
      return {
        memberId: token.memberId,
        clientId: token.clientId,
        branch: token.branch,
        syncSigningSecret: token.syncSigningSecret
      };
    }
  }

  return undefined;
}

function auditSyncSignatureRejection(
  state: HubState,
  auth: HubAuthContext,
  eventId: string,
  reason: string
): void {
  if (!reason.startsWith('event.signature_')) {
    return;
  }

  appendHubAuditLog(state, {
    actor: auth.memberId,
    action: 'sync.event_signature_rejected',
    targetType: 'sync_event',
    targetId: eventId,
    branch: auth.branch,
    payload: {
      clientId: auth.clientId,
      reason
    }
  });
}

function auditSyncEventLogVerificationFailure(
  state: HubState,
  input: HubSyncEventLogVerificationInput,
  result: HubSyncEventLogVerificationResult
): void {
  appendHubAuditLog(state, {
    actor: input.actor ?? 'system',
    action: 'sync.event_log_verification_failed',
    targetType: 'sync_log',
    targetId: input.branch,
    branch: input.branch,
    payload: {
      checked: result.checked,
      rejected: result.rejected
    }
  });
}

function auditSyncTombstoneAccepted(
  state: HubState,
  input: {
    actor: string;
    branch: string;
    event: HubSyncEvent;
  }
): void {
  const tombstone = readKnowledgeTombstonePayload(input.event);

  if (tombstone === undefined) {
    return;
  }

  const payload: Record<string, unknown> = {
    eventId: input.event.id,
    clientId: input.event.clientId
  };

  if (tombstone.reason !== undefined) {
    payload.reason = tombstone.reason;
  }

  if (tombstone.deletedAt !== undefined) {
    payload.deletedAt = tombstone.deletedAt;
  }

  appendHubAuditLog(state, {
    actor: input.actor,
    action: 'sync.tombstone_accepted',
    targetType: 'knowledge',
    targetId: tombstone.knowledgeId,
    branch: input.branch,
    payload
  });
}

function auditSyncTombstoneReplayed(
  state: HubState,
  input: {
    actor: string;
    branch: string;
    event: HubSyncEvent;
    tombstone: { knowledgeId: string; reason?: string; deletedAt?: string };
    previousStatus: string;
  }
): void {
  const payload: Record<string, unknown> = {
    eventId: input.event.id,
    clientId: input.event.clientId,
    previousStatus: input.previousStatus
  };

  if (input.tombstone.reason !== undefined) {
    payload.reason = input.tombstone.reason;
  }

  if (input.tombstone.deletedAt !== undefined) {
    payload.deletedAt = input.tombstone.deletedAt;
  }

  appendHubAuditLog(state, {
    actor: input.actor,
    action: 'sync.tombstone_replayed',
    targetType: 'knowledge',
    targetId: input.tombstone.knowledgeId,
    branch: input.branch,
    payload
  });
}

function auditSyncKnowledgeSnapshotReplayed(
  state: HubState,
  input: {
    actor: string;
    branch: string;
    event: HubSyncEvent;
    item: KnowledgeItem;
  }
): void {
  appendHubAuditLog(state, {
    actor: input.actor,
    action: 'sync.knowledge_snapshot_replayed',
    targetType: 'knowledge',
    targetId: input.item.id,
    branch: input.branch,
    payload: {
      eventId: input.event.id,
      clientId: input.event.clientId,
      layer: input.item.layer,
      type: input.item.type
    }
  });
}

function auditSyncConflictReplayed(
  state: HubState,
  input: {
    actor: string;
    branch: string;
    edge: HubKnowledgeEdge;
    left: KnowledgeConflictRevision;
    right: KnowledgeConflictRevision;
  }
): void {
  const reason = input.edge.reason;
  const payload: Record<string, unknown> = {
    knowledgeId: input.left.knowledgeId,
    fromId: input.edge.fromId,
    toId: input.edge.toId,
    eventIds: [input.left.event.id, input.right.event.id],
    clientIds: [input.left.event.clientId, input.right.event.clientId]
  };

  if (reason !== undefined) {
    payload.reason = reason;
  }

  appendHubAuditLog(state, {
    actor: input.actor,
    action: 'sync.conflict_replayed',
    targetType: 'knowledge-edge',
    targetId: input.edge.id,
    branch: input.branch,
    payload
  });
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
