import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGlossaryItem,
  createGroup,
  createInvite,
  disableMember,
  fetchAdminOverview,
  fetchGlossary,
  fetchKnowledge,
  revokeInvite,
  updateGlossaryItem,
  updateProjectAcl
} from '../src/api.js';

describe('web-admin API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads overview data from the admin API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          service: 'mcp-dev-mesh',
          version: '0.1.0',
          baseUrl: 'http://127.0.0.1:8721',
          mcpUrl: 'http://127.0.0.1:8721/mcp',
          counts: {
            groups: 1,
            members: 2,
            projects: 3,
            knowledgeItems: 4,
            reviewQueue: 0
          },
          sync: {
            status: 'idle',
            joinedGroups: 1
          },
          recentKnowledge: []
        })
      )
    );

    await expect(fetchAdminOverview()).resolves.toMatchObject({
      service: 'mcp-dev-mesh',
      counts: {
        projects: 3
      }
    });
  });

  it('posts group creation requests as JSON', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        key: 'design-team',
        displayName: 'Design Team',
        joinMode: 'invite',
        projectCount: 0,
        memberCount: 0
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await createGroup({
      key: 'design-team',
      displayName: 'Design Team',
      joinMode: 'invite'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/groups',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          key: 'design-team',
          displayName: 'Design Team',
          joinMode: 'invite'
        })
      })
    );
  });

  it('builds knowledge filters with layer and query', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: []
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await fetchKnowledge('canonical', 'project brief');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/knowledge?layer=canonical&query=project+brief', expect.any(Object));
  });

  it('posts invite and member management requests', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        token: 'inv_design',
        groupKey: 'design-team',
        uses: 0,
        status: 'active',
        createdAt: '2026-06-06T00:00:00.000Z',
        createdBy: 'admin'
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await createInvite({
      groupKey: 'design-team',
      token: 'inv_design',
      maxUses: 2
    });
    await revokeInvite('inv_design');
    await disableMember('member_design_xiaoyun', 'Offboarded');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          groupKey: 'design-team',
          token: 'inv_design',
          maxUses: 2
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/invites/inv_design',
      expect.objectContaining({
        method: 'DELETE'
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/admin/members/member_design_xiaoyun/disable',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reason: 'Offboarded'
        })
      })
    );
  });

  it('updates project ACLs through the admin API', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 'component-library',
        groupKey: 'design-team',
        access: {
          visibility: 'restricted',
          members: [
            {
              memberId: 'member_design_xiaoyun',
              role: 'maintainer'
            }
          ]
        }
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await updateProjectAcl('design-team', 'component-library', {
      visibility: 'restricted',
      members: [
        {
          memberId: 'member_design_xiaoyun',
          role: 'maintainer'
        }
      ]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/projects/design-team/component-library/acl',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          visibility: 'restricted',
          members: [
            {
              memberId: 'member_design_xiaoyun',
              role: 'maintainer'
            }
          ]
        })
      })
    );
  });

  it('manages glossary terms through the admin API', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 'can_mesh_client',
        title: 'Mesh Client',
        summary: 'Local proxy and capture runtime.'
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await fetchGlossary('mesh client', 'default', 'frontend-dashboard');
    await createGlossaryItem({
      groupKey: 'default',
      projectKey: 'frontend-dashboard',
      term: 'Mesh Client',
      definition: 'Local proxy and capture runtime.',
      aliases: ['local proxy'],
      tags: ['client']
    });
    await updateGlossaryItem('can_mesh_client', {
      groupKey: 'default',
      projectKey: 'frontend-dashboard',
      term: 'Mesh Client',
      definition: 'Local MCP proxy and capture runtime.'
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/glossary?query=mesh+client&groupKey=default&projectKey=frontend-dashboard',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/glossary',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          groupKey: 'default',
          projectKey: 'frontend-dashboard',
          term: 'Mesh Client',
          definition: 'Local proxy and capture runtime.',
          aliases: ['local proxy'],
          tags: ['client']
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/admin/glossary/can_mesh_client',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          groupKey: 'default',
          projectKey: 'frontend-dashboard',
          term: 'Mesh Client',
          definition: 'Local MCP proxy and capture runtime.'
        })
      })
    );
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers
    }
  });
}
