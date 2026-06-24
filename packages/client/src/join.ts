import { hostname } from 'node:os';
import type { JoinRequest, JoinResponse } from '@devmesh/protocol';
import { getGlobalConfigPaths } from './global-config.js';
import { persistJoinedServer } from './join-config.js';
import { discoverJoinEndpoint, requestServerJoin } from './join-http.js';
import type { JoinedServerRecord, JoinServerOptions, JoinServerResult } from './join-types.js';

export type { JoinedServerRecord, JoinServerOptions, JoinServerResult } from './join-types.js';

export async function joinServerGroup(options: JoinServerOptions): Promise<JoinServerResult> {
  const endpoint = await discoverJoinEndpoint(options.serverUrl);
  const joined = await requestServerJoin(endpoint.serverUrl, createJoinRequest(options));
  const joinedAt = new Date().toISOString();
  const paths = getGlobalConfigPaths(options.globalRoot);
  const record = createJoinedServerRecord(endpoint.serverUrl, endpoint.mcpUrl, options, joined, joinedAt);

  await persistJoinedServer(paths, record, options.displayName);

  const result: JoinServerResult = {
    globalRoot: paths.globalRoot,
    configPath: paths.configPath,
    identityPath: paths.identityPath,
    serverUrl: record.serverUrl,
    mcpUrl: record.mcpUrl,
    branch: record.branch,
    memberId: record.memberId,
    clientId: record.clientId
  };

  if (record.expiresAt !== undefined) {
    result.expiresAt = record.expiresAt;
  }

  return result;
}

function createJoinRequest(options: JoinServerOptions): JoinRequest {
  const request: JoinRequest = {
    displayName: options.displayName,
    hostname: hostname()
  };

  if (options.inviteToken !== undefined) {
    request.inviteToken = options.inviteToken;
  }

  if (options.branch !== undefined) {
    request.branch = options.branch;
  }

  if (options.handle !== undefined) {
    request.handle = options.handle;
  }

  return request;
}

function createJoinedServerRecord(
  serverUrl: string,
  mcpUrl: string,
  options: JoinServerOptions,
  joined: JoinResponse,
  joinedAt: string
): JoinedServerRecord {
  const record: JoinedServerRecord = {
    serverUrl,
    mcpUrl,
    branch: joined.branch,
    memberId: joined.memberId,
    clientId: joined.clientId,
    displayName: options.displayName,
    joinedAt,
    accessToken: joined.accessToken
  };

  if (options.handle !== undefined) {
    record.handle = options.handle;
  }

  if (joined.expiresAt !== undefined) {
    record.expiresAt = joined.expiresAt;
  }

  if (joined.syncSigningSecret !== undefined) {
    record.syncSigningSecret = joined.syncSigningSecret;
  }

  return record;
}
