import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SyncEvent, SyncPullResponse, SyncPushRequest, SyncPushResponse } from '@mcp-dev-mesh/protocol';
import { appendHubAuditLog } from './hub-audit.js';
import type { HubAuthContext, HubResult, HubState, HubSyncEvent } from './hub-model.js';
import { hubError, ok } from './hub-utils.js';

export interface HubSyncEventLogPage {
  cursor: string;
  events: HubSyncEvent[];
}

export interface HubSyncEventMergeInput {
  groupKey: string;
  events: HubSyncEvent[];
  acceptedAt?: string;
  actor?: string;
}

export interface HubSyncEventMergeResult {
  accepted: number;
  skipped: number;
  cursor: string;
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

  const groupEvents = getGroupSyncEvents(state, auth.groupKey);
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
      groupKey: auth.groupKey,
      event: hubEvent
    });
  }

  return ok({
    accepted,
    rejected,
    cursor: createSyncCursor(auth.groupKey, groupEvents.length)
  });
}

export function pullHubSyncEvents(
  state: HubState,
  auth: HubAuthContext,
  cursor: string | undefined
): SyncPullResponse {
  const page = pullHubSyncEventLog(state, auth.groupKey, cursor);

  return {
    cursor: page.cursor,
    events: page.events.map(toProtocolSyncEvent)
  };
}

export function pullHubSyncEventLog(
  state: HubState,
  groupKey: string,
  cursor: string | undefined,
  limit?: number
): HubSyncEventLogPage {
  const groupEvents = getGroupSyncEvents(state, groupKey);
  const offset = readSyncCursorOffset(groupKey, cursor);
  const boundedLimit = limit === undefined ? undefined : Math.max(0, Math.floor(limit));
  const end = boundedLimit === undefined ? undefined : offset + boundedLimit;
  const nextEvents = groupEvents.slice(offset, end);
  const nextOffset = boundedLimit === undefined ? groupEvents.length : offset + nextEvents.length;

  return {
    cursor: createSyncCursor(groupKey, nextOffset),
    events: nextEvents.map(cloneHubSyncEvent)
  };
}

export function mergeHubSyncEventLog(state: HubState, input: HubSyncEventMergeInput): HubSyncEventMergeResult {
  const groupEvents = getGroupSyncEvents(state, input.groupKey);
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
        groupKey: input.groupKey,
        acceptedAt
      })
    );
    existingIds.add(merged.id);
    accepted += 1;
    auditSyncTombstoneAccepted(state, {
      actor: input.actor ?? merged.clientId,
      groupKey: input.groupKey,
      event: merged
    });
  }

  return {
    accepted,
    skipped,
    cursor: createSyncCursor(input.groupKey, groupEvents.length)
  };
}

function getGroupSyncEvents(state: HubState, groupKey: string): HubSyncEvent[] {
  let events = state.syncEvents.get(groupKey);

  if (events === undefined) {
    events = [];
    state.syncEvents.set(groupKey, events);
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
    groupKey: auth.groupKey,
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
    groupKey: event.groupKey,
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
          groupKey: event.groupKey,
          acceptedAt: event.acceptedAt,
          signature: event.signature ?? null
        }
      })
    )
    .digest('hex');
}

function createSyncCursor(groupKey: string, offset: number): string {
  return `cur_${groupKey}_${offset}`;
}

function readSyncCursorOffset(groupKey: string, cursor: string | undefined): number {
  const prefix = `cur_${groupKey}_`;

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

function createSyncEventSignature(auth: HubAuthContext, event: SyncEvent): string {
  return createHmac('sha256', auth.syncSigningSecret)
    .update(
      stableStringify({
        clientId: auth.clientId,
        groupKey: auth.groupKey,
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
    groupKey: auth.groupKey,
    payload: {
      clientId: auth.clientId,
      reason
    }
  });
}

function auditSyncTombstoneAccepted(
  state: HubState,
  input: {
    actor: string;
    groupKey: string;
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
    groupKey: input.groupKey,
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
