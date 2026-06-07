import { appendHubAuditLog } from './hub-audit.js';
import type { HubResult, HubState } from './hub-model.js';
import { hubError, ok } from './hub-utils.js';
import { mergeHubSyncEventLog, pullHubSyncEventLog } from './hub-sync.js';

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
  const merge = mergeHubSyncEventLog(target, {
    groupKey,
    events: page.events
  });
  const response: HubFederationSyncResponse = {
    peerId,
    groupKey,
    cursor: page.cursor,
    pulled: page.events.length,
    accepted: merge.accepted,
    skipped: merge.skipped
  };
  const auditPayload: Record<string, unknown> = {
    peerId,
    cursor: page.cursor,
    pulled: page.events.length,
    accepted: merge.accepted,
    skipped: merge.skipped
  };

  if (previousCursor !== undefined) {
    response.previousCursor = previousCursor;
    auditPayload.previousCursor = previousCursor;
  }

  target.federationCursors.set(cursorKey, page.cursor);

  if (page.events.length > 0) {
    appendHubAuditLog(target, {
      actor: peerId,
      action: 'federation.synced',
      targetType: 'group',
      targetId: groupKey,
      groupKey,
      payload: auditPayload
    });
  }

  return ok(response);
}

function createFederationCursorKey(peerId: string, groupKey: string): string {
  return `${peerId}:${groupKey}`;
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
