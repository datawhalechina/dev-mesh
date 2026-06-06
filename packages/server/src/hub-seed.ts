import type { ProjectSummary } from '@mcp-dev-mesh/protocol';
import {
  DEFAULT_GROUP_KEY,
  DEFAULT_LOCAL_INVITE_TOKEN,
  type HubGroup,
  type HubGroupSeed,
  type HubInvite,
  type HubInviteSeed,
  type HubProjectSeed,
  type HubState,
  type HubStateOptions
} from './hub-model.js';
import { projectMapKey } from './hub-utils.js';

/**
 * Creates the development in-memory Hub state. The default invite is only for
 * local skeleton usage; production storage should seed short-lived invites from
 * an admin workflow instead.
 */
export function createHubState(options: HubStateOptions = {}): HubState {
  const state: HubState = {
    groups: new Map(),
    invites: new Map(),
    members: new Map(),
    tokens: new Map(),
    projects: new Map(),
    auditLogs: []
  };
  const groups = options.groups?.length
    ? options.groups
    : [
        {
          key: DEFAULT_GROUP_KEY,
          displayName: 'Default'
        }
      ];

  for (const group of groups) {
    addGroup(state, group);
  }

  const firstGroupKey = groups[0]?.key ?? DEFAULT_GROUP_KEY;
  const invites = options.invites ?? [
    {
      token: DEFAULT_LOCAL_INVITE_TOKEN,
      groupKey: firstGroupKey
    }
  ];

  for (const invite of invites) {
    addInvite(state, invite);
  }

  for (const project of options.projects ?? []) {
    addProjectSeed(state, project);
  }

  return state;
}

function addGroup(state: HubState, seed: HubGroupSeed): void {
  const key = seed.key.trim();

  if (!key) {
    return;
  }

  const group: HubGroup = {
    key,
    displayName: seed.displayName?.trim() || key,
    joinMode: seed.joinMode ?? 'invite'
  };

  if (seed.description !== undefined) {
    group.description = seed.description;
  }

  state.groups.set(key, group);
}

function addInvite(state: HubState, seed: HubInviteSeed): void {
  if (!state.groups.has(seed.groupKey)) {
    return;
  }

  const invite: HubInvite = {
    token: seed.token,
    groupKey: seed.groupKey,
    uses: 0,
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };

  if (seed.expiresAt !== undefined) {
    invite.expiresAt = seed.expiresAt;
  }

  if (seed.maxUses !== undefined) {
    invite.maxUses = seed.maxUses;
  }

  state.invites.set(seed.token, invite);
}

function addProjectSeed(state: HubState, seed: HubProjectSeed): void {
  if (!state.groups.has(seed.groupKey)) {
    return;
  }

  const createdAt = seed.createdAt ?? new Date().toISOString();
  const project: ProjectSummary = {
    id: seed.id,
    projectKey: seed.projectKey ?? seed.id,
    groupKey: seed.groupKey,
    name: seed.name ?? seed.id,
    createdByMemberId: seed.createdByMemberId ?? 'system',
    createdAt
  };

  if (seed.description !== undefined) {
    project.description = seed.description;
  }

  if (seed.access !== undefined) {
    project.access = seed.access;
  }

  state.projects.set(projectMapKey(project.groupKey, project.id), project);
}
