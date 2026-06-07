import { appendHubAuditLog } from './hub-audit.js';
import type { HubResult, HubState, HubSyncEvent } from './hub-model.js';
import { hubError, ok } from './hub-utils.js';
import { mergeHubSyncEventLog, pullHubSyncEventLog, type HubSyncEventLogPage } from './hub-sync.js';

export interface HubFederationSyncInput {
  peerId: string;
  groupKey: string;
  cursor?: string;
  limit?: number;
}

export interface HubFederationSyncResponse {
  peerId: string;
  groupKey: string;
  previousCursor?: string;
  cursor: string;
  pulled: number;
  accepted: number;
  skipped: number;
}

export interface HubHttpFederationSyncInput extends HubFederationSyncInput {
  peerBaseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
}

interface MergeFederationSyncPageInput {
  peerId: string;
  groupKey: string;
  cursorKey: string;
  previousCursor?: string;
  page: HubSyncEventLogPage;
}

interface HttpFederationEventLogPullInput {
  peerBaseUrl: string;
  accessToken: string;
  groupKey: string;
  cursor?: string;
  limit?: number;
  fetch?: typeof fetch;
}

export function federateHubSyncEvents(
  source: HubState,
  target: HubState,
  input: HubFederationSyncInput
): HubResult<HubFederationSyncResponse> {
  const peerId = input.peerId.trim();
  const groupKey = input.groupKey.trim();

  if (!peerId) {
    return hubError(400, 'federation.peer_id_required', 'peerId is required.');
  }

  if (!groupKey) {
    return hubError(400, 'federation.group_key_required', 'groupKey is required.');
  }

  if (!source.groups.has(groupKey)) {
    return hubError(404, 'federation.source_group_not_found', 'The source group does not exist.');
  }

  if (!target.groups.has(groupKey)) {
    return hubError(404, 'federation.target_group_not_found', 'The target group does not exist.');
  }

  const limit = normalizeFederationLimit(input.limit);

  if (!limit.ok) {
    return limit;
  }

  const cursorKey = createFederationCursorKey(peerId, groupKey);
  const previousCursor = input.cursor ?? target.federationCursors.get(cursorKey);
  const page = pullHubSyncEventLog(source, groupKey, previousCursor, limit.value);
  const mergeInput: MergeFederationSyncPageInput = {
    peerId,
    groupKey,
    cursorKey,
    page
  };

  if (previousCursor !== undefined) {
    mergeInput.previousCursor = previousCursor;
  }

  return ok(mergeFederationSyncPage(target, mergeInput));
}

export async function federateHubSyncEventsFromHttpPeer(
  target: HubState,
  input: HubHttpFederationSyncInput
): Promise<HubResult<HubFederationSyncResponse>> {
  const peerId = input.peerId.trim();
  const groupKey = input.groupKey.trim();
  const peerBaseUrl = input.peerBaseUrl.trim();
  const accessToken = input.accessToken.trim();

  if (!peerId) {
    return hubError(400, 'federation.peer_id_required', 'peerId is required.');
  }

  if (!groupKey) {
    return hubError(400, 'federation.group_key_required', 'groupKey is required.');
  }

  if (!peerBaseUrl) {
    return hubError(400, 'federation.peer_base_url_required', 'peerBaseUrl is required.');
  }

  if (!accessToken) {
    return hubError(400, 'federation.access_token_required', 'accessToken is required.');
  }

  if (!target.groups.has(groupKey)) {
    return hubError(404, 'federation.target_group_not_found', 'The target group does not exist.');
  }

  const limit = normalizeFederationLimit(input.limit);

  if (!limit.ok) {
    return limit;
  }

  const cursorKey = createFederationCursorKey(peerId, groupKey);
  const previousCursor = input.cursor ?? target.federationCursors.get(cursorKey);
  const pullInput: HttpFederationEventLogPullInput = {
    peerBaseUrl,
    accessToken,
    groupKey
  };

  if (previousCursor !== undefined) {
    pullInput.cursor = previousCursor;
  }

  if (limit.value !== undefined) {
    pullInput.limit = limit.value;
  }

  if (input.fetch !== undefined) {
    pullInput.fetch = input.fetch;
  }

  const page = await pullHttpFederationSyncEventLog(pullInput);

  if (!page.ok) {
    return page;
  }

  const mergeInput: MergeFederationSyncPageInput = {
    peerId,
    groupKey,
    cursorKey,
    page: page.value
  };

  if (previousCursor !== undefined) {
    mergeInput.previousCursor = previousCursor;
  }

  return ok(mergeFederationSyncPage(target, mergeInput));
}

function mergeFederationSyncPage(target: HubState, input: MergeFederationSyncPageInput): HubFederationSyncResponse {
  const merge = mergeHubSyncEventLog(target, {
    groupKey: input.groupKey,
    events: input.page.events,
    actor: input.peerId
  });
  const response: HubFederationSyncResponse = {
    peerId: input.peerId,
    groupKey: input.groupKey,
    cursor: input.page.cursor,
    pulled: input.page.events.length,
    accepted: merge.accepted,
    skipped: merge.skipped
  };
  const auditPayload: Record<string, unknown> = {
    peerId: input.peerId,
    cursor: input.page.cursor,
    pulled: input.page.events.length,
    accepted: merge.accepted,
    skipped: merge.skipped
  };

  if (input.previousCursor !== undefined) {
    response.previousCursor = input.previousCursor;
    auditPayload.previousCursor = input.previousCursor;
  }

  target.federationCursors.set(input.cursorKey, input.page.cursor);

  if (input.page.events.length > 0) {
    appendHubAuditLog(target, {
      actor: input.peerId,
      action: 'federation.synced',
      targetType: 'group',
      targetId: input.groupKey,
      groupKey: input.groupKey,
      payload: auditPayload
    });
  }

  return response;
}

function createFederationCursorKey(peerId: string, groupKey: string): string {
  return `${peerId}:${groupKey}`;
}

async function pullHttpFederationSyncEventLog(input: HttpFederationEventLogPullInput): Promise<HubResult<HubSyncEventLogPage>> {
  const fetcher = input.fetch ?? fetch;
  const url = new URL(`${input.peerBaseUrl.replace(/\/$/, '')}/api/v1/federation/sync-events`);
  url.searchParams.set('groupKey', input.groupKey);

  if (input.cursor !== undefined) {
    url.searchParams.set('cursor', input.cursor);
  }

  if (input.limit !== undefined) {
    url.searchParams.set('limit', input.limit.toString());
  }

  try {
    const response = await fetcher(url, {
      headers: {
        authorization: `Bearer ${input.accessToken}`
      }
    });

    if (!response.ok) {
      return hubError(502, 'federation.peer_request_failed', `Peer federation pull failed with HTTP ${response.status}.`);
    }

    return normalizeFederationEventLogPage(await response.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown peer request error.';

    return hubError(502, 'federation.peer_request_failed', message);
  }
}

function normalizeFederationEventLogPage(value: unknown): HubResult<HubSyncEventLogPage> {
  if (!isPlainRecord(value) || typeof value.cursor !== 'string' || !Array.isArray(value.events)) {
    return hubError(502, 'federation.peer_response_invalid', 'Peer federation response is not a valid event page.');
  }

  const events: HubSyncEvent[] = [];

  for (const rawEvent of value.events) {
    const event = normalizeFederationHubSyncEvent(rawEvent);

    if (event === undefined) {
      return hubError(502, 'federation.peer_response_invalid', 'Peer federation response contains an invalid event.');
    }

    events.push(event);
  }

  return ok({
    cursor: value.cursor,
    events
  });
}

function normalizeFederationHubSyncEvent(value: unknown): HubSyncEvent | undefined {
  if (
    !isPlainRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.kind !== 'string' ||
    !isPlainRecord(value.payload) ||
    typeof value.createdAt !== 'string' ||
    typeof value.clientId !== 'string' ||
    typeof value.groupKey !== 'string' ||
    typeof value.acceptedAt !== 'string'
  ) {
    return undefined;
  }

  const event: HubSyncEvent = {
    id: value.id,
    kind: value.kind,
    payload: value.payload,
    createdAt: value.createdAt,
    clientId: value.clientId,
    groupKey: value.groupKey,
    acceptedAt: value.acceptedAt
  };

  if (value.signature !== undefined) {
    if (!isPlainRecord(value.signature) || value.signature.algorithm !== 'hmac-sha256') {
      return undefined;
    }

    if (typeof value.signature.value !== 'string' || !/^[a-f0-9]{64}$/i.test(value.signature.value)) {
      return undefined;
    }

    event.signature = {
      algorithm: 'hmac-sha256',
      value: value.signature.value.toLowerCase()
    };

    if (typeof value.signature.signedAt === 'string') {
      event.signature.signedAt = value.signature.signedAt;
    }

    if (typeof value.signature.keyId === 'string') {
      event.signature.keyId = value.signature.keyId;
    }
  }

  if (value.log !== undefined) {
    if (!isPlainRecord(value.log) || typeof value.log.sequence !== 'number' || !Number.isInteger(value.log.sequence)) {
      return undefined;
    }

    if (typeof value.log.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.log.hash)) {
      return undefined;
    }

    const log: NonNullable<HubSyncEvent['log']> = {
      sequence: value.log.sequence,
      hash: value.log.hash.toLowerCase()
    };

    if (typeof value.log.previousHash === 'string') {
      log.previousHash = value.log.previousHash.toLowerCase();
    }

    event.log = log;
  }

  return event;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFederationLimit(limit: number | undefined): HubResult<number | undefined> {
  if (limit === undefined) {
    return ok(undefined);
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return hubError(400, 'federation.limit_invalid', 'limit must be a positive integer.');
  }

  return ok(Math.min(limit, 1000));
}
