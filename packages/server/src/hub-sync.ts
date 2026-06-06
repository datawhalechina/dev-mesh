import type { SyncEvent, SyncPullResponse, SyncPushRequest, SyncPushResponse } from '@mcp-dev-mesh/protocol';
import type { HubAuthContext, HubResult, HubState, HubSyncEvent } from './hub-model.js';
import { hubError, ok } from './hub-utils.js';

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
      rejected.push(validation.rejected);
      continue;
    }

    const { event } = validation;

    if (existingIds.has(event.id)) {
      continue;
    }

    groupEvents.push(createHubSyncEvent(auth, event));
    existingIds.add(event.id);
    accepted += 1;
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
  const groupEvents = getGroupSyncEvents(state, auth.groupKey);
  const offset = readSyncCursorOffset(auth.groupKey, cursor);
  const nextEvents = groupEvents.slice(offset);

  return {
    cursor: createSyncCursor(auth.groupKey, groupEvents.length),
    events: nextEvents.map(toProtocolSyncEvent)
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

  const normalized: SyncEvent = {
    id: event.id,
    kind: event.kind,
    payload: event.payload
  };

  if (typeof event.createdAt === 'string') {
    normalized.createdAt = event.createdAt;
  }

  return {
    ok: true,
    event: normalized
  };
}

function createHubSyncEvent(auth: HubAuthContext, event: SyncEvent): HubSyncEvent {
  const createdAt = typeof event.createdAt === 'string' && event.createdAt.trim() ? event.createdAt : new Date().toISOString();

  return {
    id: event.id,
    kind: event.kind,
    payload: event.payload,
    createdAt,
    clientId: auth.clientId,
    groupKey: auth.groupKey,
    acceptedAt: new Date().toISOString()
  };
}

function toProtocolSyncEvent(event: HubSyncEvent): SyncEvent {
  return {
    id: event.id,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt
  };
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
