import type { CreateProjectRequest, ProjectAccess, ProjectSummary, ServerGroupSummary } from '@mcp-dev-mesh/protocol';
import { appendHubAuditLog } from './hub-audit.js';
import type { HubAuthContext, HubResult, HubState } from './hub-model.js';
import { countByGroup, hubError, ok, projectMapKey, slugHandle } from './hub-utils.js';

export function listHubGroups(state: HubState): ServerGroupSummary[] {
  return [...state.groups.values()]
    .map((group) => {
      const summary: ServerGroupSummary = {
        key: group.key,
        displayName: group.displayName,
        joinMode: group.joinMode,
        projectCount: countByGroup(state.projects.values(), group.key),
        memberCount: countByGroup(state.members.values(), group.key)
      };

      if (group.description !== undefined) {
        summary.description = group.description;
      }

      return summary;
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function listHubProjects(state: HubState, auth: HubAuthContext): ProjectSummary[] {
  return [...state.projects.values()]
    .filter((project) => canAccessProject(project, auth))
    .map((project) => withNormalizedAccess(project))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Creates a project inside the authenticated member's group. The caller cannot
 * choose groupKey from the request body; group ownership always comes from the
 * bearer token to keep the ACL rule easy to audit.
 */
export function createHubProject(
  state: HubState,
  auth: HubAuthContext,
  input: CreateProjectRequest
): HubResult<ProjectSummary> {
  const name = input.name?.trim();

  if (!name) {
    return hubError(400, 'project.name_required', 'name is required.');
  }

  const id = slugHandle(input.id ?? input.projectKey ?? name);

  if (!id) {
    return hubError(400, 'project.id_invalid', 'project id could not be derived.');
  }

  const key = projectMapKey(auth.groupKey, id);
  const existing = state.projects.get(key);

  if (existing) {
    return ok(existing);
  }

  const project: ProjectSummary = {
    id,
    projectKey: input.projectKey?.trim() || id,
    groupKey: auth.groupKey,
    name,
    createdByMemberId: auth.memberId,
    createdAt: new Date().toISOString()
  };
  const description = input.description?.trim();

  if (description) {
    project.description = description;
  }

  state.projects.set(key, project);
  appendHubAuditLog(state, {
    actor: auth.memberId,
    action: 'project.created',
    targetType: 'project',
    targetId: project.id,
    groupKey: auth.groupKey,
    payload: {
      projectKey: project.projectKey,
      name: project.name
    }
  });

  return ok(withNormalizedAccess(project));
}

/**
 * Looks up a project only inside the authenticated group. A missing project and
 * a project that exists in another group both return the same 404-shaped error
 * so group boundaries do not leak project ids.
 */
export function getHubProject(state: HubState, auth: HubAuthContext, id: string): HubResult<ProjectSummary> {
  const project = state.projects.get(projectMapKey(auth.groupKey, id));

  if (!project || !canAccessProject(project, auth)) {
    // Return 404 rather than 403 so project ids in other groups are not leaked.
    return hubError(404, 'project.not_found', 'Project was not found in the joined group.');
  }

  return ok(withNormalizedAccess(project));
}

export function normalizeProjectAccess(project: ProjectSummary): ProjectAccess {
  return project.access ?? {
    visibility: 'group',
    members: []
  };
}

export function withNormalizedAccess(project: ProjectSummary): ProjectSummary {
  return {
    ...project,
    access: normalizeProjectAccess(project)
  };
}

export function canAccessProject(project: ProjectSummary, auth: HubAuthContext): boolean {
  if (project.groupKey !== auth.groupKey) {
    return false;
  }

  const access = normalizeProjectAccess(project);

  if (access.visibility === 'group') {
    return true;
  }

  return access.members.some((member) => member.memberId === auth.memberId);
}
