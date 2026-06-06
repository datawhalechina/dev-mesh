export interface JoinServerOptions {
  globalRoot?: string;
  serverUrl: string;
  groupKey?: string;
  displayName: string;
  handle?: string;
  inviteToken?: string;
}

export interface JoinedServerRecord {
  serverUrl: string;
  mcpUrl: string;
  groupKey: string;
  memberId: string;
  clientId: string;
  displayName: string;
  joinedAt: string;
  handle?: string;
  accessToken: string;
  syncSigningSecret?: string;
  expiresAt?: string;
}

export interface JoinServerResult {
  globalRoot: string;
  configPath: string;
  identityPath: string;
  serverUrl: string;
  mcpUrl: string;
  groupKey: string;
  memberId: string;
  clientId: string;
  expiresAt?: string;
}
