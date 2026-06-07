import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProjectSummary } from '@mcp-dev-mesh/protocol';
import type {
  HubAccessToken,
  HubAuditLog,
  HubGroup,
  HubInvite,
  HubKnowledgeEdge,
  HubMember,
  HubState,
  HubStateOptions,
  HubSyncEvent
} from './hub-model.js';
import { createHubState } from './hub-seed.js';

export interface HubStatePersistenceOptions {
  path: string;
}

export interface HubStatePersistenceStore {
  load(fallback?: HubStateOptions): Promise<HubState>;
  save(state: HubState): Promise<void>;
}

interface SerializedHubState {
  version: 1;
  groups: HubGroup[];
  invites: HubInvite[];
  members: HubMember[];
  tokens: HubAccessToken[];
  projects: ProjectSummary[];
  knowledgeEdges: HubKnowledgeEdge[];
  syncEvents: Array<[string, HubSyncEvent[]]>;
  federationCursors: Array<[string, string]>;
  auditLogs: HubAuditLog[];
}

export function createJsonHubStateStore(path: string): HubStatePersistenceStore {
  return {
    load(fallback) {
      return loadHubStateFromFile(path, fallback);
    },
    save(state) {
      return saveHubStateToFile(state, path);
    }
  };
}

export async function loadHubStateFromFile(path: string, fallback: HubStateOptions = {}): Promise<HubState> {
  try {
    const raw = await readFile(path, 'utf8');
    return deserializeHubState(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return createHubState(fallback);
    }

    throw error;
  }
}

export async function saveHubStateToFile(state: HubState, path: string): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true
  });

  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(serializeHubState(state), null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

export function serializeHubState(state: HubState): SerializedHubState {
  return {
    version: 1,
    groups: [...state.groups.values()].sort((a, b) => a.key.localeCompare(b.key)),
    invites: [...state.invites.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.token.localeCompare(b.token)),
    members: [...state.members.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.memberId.localeCompare(b.memberId)),
    tokens: [...state.tokens.values()].sort((a, b) => a.memberId.localeCompare(b.memberId) || a.token.localeCompare(b.token)),
    projects: [...state.projects.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.id.localeCompare(b.id)),
    knowledgeEdges: state.knowledgeEdges.slice().sort((a, b) => a.id.localeCompare(b.id)),
    syncEvents: [...state.syncEvents.entries()]
      .map(([groupKey, events]) => [groupKey, events] as [string, HubSyncEvent[]])
      .sort(([leftGroupKey], [rightGroupKey]) => leftGroupKey.localeCompare(rightGroupKey)),
    federationCursors: [...state.federationCursors.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    auditLogs: state.auditLogs.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  };
}

export function deserializeHubState(value: unknown): HubState {
  if (!isSerializedHubState(value)) {
    throw new Error('Invalid HubState persistence file.');
  }

  return {
    groups: new Map(value.groups.map((group) => [group.key, group])),
    invites: new Map(value.invites.map((invite) => [invite.token, invite])),
    members: new Map(value.members.map((member) => [member.memberId, member])),
    tokens: new Map(value.tokens.map((token) => [token.token, token])),
    projects: new Map(value.projects.map((project) => [`${project.groupKey}:${project.id}`, project])),
    knowledgeEdges: value.knowledgeEdges,
    syncEvents: new Map(value.syncEvents),
    federationCursors: new Map(value.federationCursors),
    auditLogs: value.auditLogs
  };
}

function isSerializedHubState(value: unknown): value is SerializedHubState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    Array.isArray((value as { groups?: unknown }).groups) &&
    Array.isArray((value as { invites?: unknown }).invites) &&
    Array.isArray((value as { members?: unknown }).members) &&
    Array.isArray((value as { tokens?: unknown }).tokens) &&
    Array.isArray((value as { projects?: unknown }).projects) &&
    Array.isArray((value as { knowledgeEdges?: unknown }).knowledgeEdges) &&
    Array.isArray((value as { syncEvents?: unknown }).syncEvents) &&
    Array.isArray((value as { federationCursors?: unknown }).federationCursors) &&
    Array.isArray((value as { auditLogs?: unknown }).auditLogs)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
