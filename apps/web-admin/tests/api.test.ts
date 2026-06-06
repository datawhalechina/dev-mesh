import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGroup, fetchAdminOverview, fetchKnowledge } from '../src/api.js';

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
