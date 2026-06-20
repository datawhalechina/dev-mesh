import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGlossaryItem,
  createGroup,
  createInvite,
  createKnowledgeEdge,
  disableMember,
  fetchAdminOverview,
  fetchCrdtDocuments,
  fetchGlossary,
  fetchKnowledge,
  fetchKnowledgeEdges,
  fetchQualityReview,
  fetchTaskDigest,
  rotateMemberToken,
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
          service: 'devmesh',
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
      service: 'devmesh',
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

  it('builds superseded knowledge filters and manages knowledge edges', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: []
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          edges: []
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'edge_1',
          kind: 'supersedes',
          fromId: 'can_new',
          toId: 'can_old',
          createdBy: 'admin',
          createdAt: '2026-06-06T00:00:00.000Z'
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    await fetchKnowledge('canonical', 'project brief', true);
    await fetchKnowledgeEdges('contradicts', 'default');
    await createKnowledgeEdge({
      kind: 'supersedes',
      fromId: 'can_new',
      toId: 'can_old',
      branchKey: 'default',
      reason: 'Replaced by the latest canonical item.'
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/knowledge?layer=canonical&query=project+brief&includeSuperseded=true',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/knowledge-edges?kind=contradicts&branchKey=default',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/admin/knowledge-edges',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'supersedes',
          fromId: 'can_new',
          toId: 'can_old',
          branchKey: 'default',
          reason: 'Replaced by the latest canonical item.'
        })
      })
    );
  });

  it('builds quality review filters', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        summary: {
          totalKnowledge: 2,
          needsReview: 1,
          lowQuality: 1,
          lowConfidence: 1,
          lowRating: 0,
          lowAdoption: 1,
          stale: 0,
          nonActive: 0
        },
        items: []
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await fetchQualityReview({
      layer: 'canonical',
      includeSuperseded: true,
      maxQualityScore: 0.55,
      staleDays: 90,
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/quality-review?layer=canonical&includeSuperseded=true&maxQualityScore=0.55&staleDays=90&limit=25',
      expect.any(Object)
    );
  });

  it('builds task digest filters', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        summary: {
          totalTasks: 1,
          todo: 0,
          inProgress: 0,
          blocked: 1,
          done: 0,
          unknown: 0
        },
        entries: []
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await fetchTaskDigest({
      projectKey: 'TASK-123',
      status: 'blocked',
      includeDone: true,
      includeSuperseded: false,
      limit: 20
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/task-digest?projectKey=TASK-123&status=blocked&includeDone=true&includeSuperseded=false&limit=20',
      expect.any(Object)
    );
  });

  it('builds CRDT document status filters', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        documents: []
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    await fetchCrdtDocuments({
      kind: 'project',
      branchKey: 'frontend-team',
      projectKey: 'frontend-dashboard'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/crdt-documents?kind=project&branchKey=frontend-team&projectKey=frontend-dashboard',
      expect.any(Object)
    );
  });

  it('posts invite and member management requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          token: 'inv_design',
          groupKey: 'design-team',
          uses: 0,
          status: 'active',
          createdAt: '2026-06-06T00:00:00.000Z',
          createdBy: 'admin'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          token: 'inv_design',
          groupKey: 'design-team',
          uses: 0,
          status: 'revoked',
          createdAt: '2026-06-06T00:00:00.000Z',
          createdBy: 'admin'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          memberId: 'member_design_xiaoyun',
          status: 'disabled'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          memberId: 'member_design_xiaoyun',
          clientId: 'client_design_xiaoyun',
          groupKey: 'design-team',
          accessToken: 'mesh_rotated',
          expiresAt: '2026-06-13T00:00:00.000Z'
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    await createInvite({
      branchKey: 'design-team',
      token: 'inv_design',
      maxUses: 2
    });
    await revokeInvite('inv_design');
    await disableMember('member_design_xiaoyun', 'Offboarded');
    await rotateMemberToken('member_design_xiaoyun');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          branchKey: 'design-team',
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/admin/members/member_design_xiaoyun/rotate-token',
      expect.objectContaining({
        method: 'POST'
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
      branchKey: 'default',
      projectKey: 'frontend-dashboard',
      term: 'Mesh Client',
      definition: 'Local proxy and capture runtime.',
      aliases: ['local proxy'],
      tags: ['client']
    });
    await updateGlossaryItem('can_mesh_client', {
      branchKey: 'default',
      projectKey: 'frontend-dashboard',
      term: 'Mesh Client',
      definition: 'Local MCP proxy and capture runtime.'
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/glossary?query=mesh+client&branchKey=default&projectKey=frontend-dashboard',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/glossary',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          branchKey: 'default',
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
          branchKey: 'default',
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
