import { randomBytes, randomUUID } from 'node:crypto';
import type { JoinRequest, JoinResponse } from '@devmesh/protocol';
import { appendHubAuditLog } from './hub-audit.js';
import { ACCESS_TOKEN_TTL_MS, type HubAuthContext, type HubResult, type HubState } from './hub-model.js';
import { hubError, isExpired, ok, slugHandle } from './hub-utils.js';

/**
 * Exchanges an invite token for a group-scoped client identity. The invite owns
 * the group decision; a request may repeat that branch, but it cannot use a
 * token from one group to join another group.
 */
export function joinHubBranch(state: HubState, input: JoinRequest): HubResult<JoinResponse> {
  const displayName = input.displayName?.trim();

  if (!displayName) {
    return hubError(400, 'join.display_name_required', 'displayName is required.');
  }

  const inviteToken = input.inviteToken?.trim();

  if (!inviteToken) {
    return hubError(401, 'join.invite_required', 'inviteToken is required.');
  }

  const invite = state.invites.get(inviteToken);

  if (!invite || invite.revokedAt !== undefined || isExpired(invite.expiresAt)) {
    return hubError(401, 'join.invite_invalid', 'inviteToken is invalid or expired.');
  }

  if (invite.maxUses !== undefined && invite.uses >= invite.maxUses) {
    return hubError(401, 'join.invite_exhausted', 'inviteToken has no remaining uses.');
  }

  const requestedGroupKey = input.branch?.trim() || invite.branch;

  if (requestedGroupKey !== invite.branch) {
    return hubError(403, 'join.group_mismatch', 'inviteToken is not valid for the requested group.');
  }

  const group = state.groups.get(requestedGroupKey);

  if (!group) {
    return hubError(404, 'join.group_not_found', 'The requested group does not exist.');
  }

  const handle = slugHandle(input.handle ?? displayName);
  const memberId = `member_${slugHandle(group.key)}_${handle}`;
  const existingMember = state.members.get(memberId);

  if (existingMember?.status === 'disabled') {
    return hubError(403, 'join.member_disabled', 'This member has been disabled by an administrator.');
  }

  const clientId = `client_${slugHandle(group.key)}_${handle}_${randomUUID().slice(0, 8)}`;
  const accessToken = createHubAccessToken();
  const syncSigningSecret = createHubSyncSigningSecret();
  const expiresAt = createHubAccessTokenExpiry();
  const joinedAt = new Date().toISOString();

  state.members.set(memberId, {
    memberId,
    clientId,
    branch: group.key,
    displayName,
    handle,
    joinedAt,
    status: 'active'
  });
  state.tokens.set(accessToken, {
    token: accessToken,
    memberId,
    clientId,
    branch: group.key,
    syncSigningSecret,
    expiresAt
  });
  invite.uses += 1;
  appendHubAuditLog(state, {
    actor: memberId,
    action: 'member.joined',
    targetType: 'member',
    targetId: memberId,
    branch: group.key,
    payload: {
      clientId
    }
  });

  return ok({
    memberId,
    clientId,
    branch: group.key,
    accessToken,
    syncSigningSecret,
    expiresAt
  });
}

export function rotateHubAccessToken(state: HubState, token: string | undefined): HubResult<JoinResponse> {
  const auth = authenticateHubToken(state, token);

  if (!auth.ok) {
    return auth;
  }

  const previousToken = token === undefined ? undefined : state.tokens.get(token);

  if (previousToken === undefined) {
    return hubError(401, 'auth.invalid_token', 'Bearer access token is invalid or expired.');
  }

  const accessToken = createHubAccessToken();
  const expiresAt = createHubAccessTokenExpiry();
  state.tokens.delete(previousToken.token);
  state.tokens.set(accessToken, {
    ...previousToken,
    token: accessToken,
    expiresAt
  });
  appendHubAuditLog(state, {
    actor: auth.value.memberId,
    action: 'auth.token_rotated',
    targetType: 'member',
    targetId: auth.value.memberId,
    branch: auth.value.branch,
    payload: {
      clientId: auth.value.clientId,
      previousExpiresAt: previousToken.expiresAt,
      expiresAt
    }
  });

  return ok({
    memberId: auth.value.memberId,
    clientId: auth.value.clientId,
    branch: auth.value.branch,
    accessToken,
    syncSigningSecret: auth.value.syncSigningSecret,
    expiresAt
  });
}

/**
 * Validates a bearer token issued by joinHubBranch. The returned auth context is
 * intentionally small so route handlers can pass it around without exposing the
 * raw token or member profile.
 */
export function authenticateHubToken(state: HubState, token: string | undefined): HubResult<HubAuthContext> {
  if (!token) {
    return hubError(401, 'auth.missing_token', 'Bearer access token is required.');
  }

  const accessToken = state.tokens.get(token);

  if (!accessToken || isExpired(accessToken.expiresAt)) {
    return hubError(401, 'auth.invalid_token', 'Bearer access token is invalid or expired.');
  }

  const member = state.members.get(accessToken.memberId);

  if (member?.status === 'disabled') {
    return hubError(403, 'auth.member_disabled', 'The authenticated member has been disabled.');
  }

  return ok({
    memberId: accessToken.memberId,
    clientId: accessToken.clientId,
    branch: accessToken.branch,
    syncSigningSecret: accessToken.syncSigningSecret
  });
}

function createHubAccessToken(): string {
  return `mesh_${randomUUID().replace(/-/g, '')}`;
}

function createHubSyncSigningSecret(): string {
  return `sync_${randomBytes(32).toString('base64url')}`;
}

function createHubAccessTokenExpiry(): string {
  return new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();
}
