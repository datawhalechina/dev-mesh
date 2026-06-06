import { describe, expect, it } from 'vitest';
import { createDevMeshCore } from '@mcp-dev-mesh/core';
import { createHubServer } from './index.js';

describe('hub server HTTP integration', () => {
  it('serves health and well-known metadata', async () => {
    const app = await createHubServer({
      core: createDevMeshCore(),
      baseUrl: 'http://127.0.0.1:9999'
    });

    try {
      const health = await app.inject({ method: 'GET', url: '/healthz' });
      const wellKnown = await app.inject({ method: 'GET', url: '/.well-known/dev-mesh' });

      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({
        status: 'ok',
        service: 'mcp-dev-mesh'
      });
      expect(wellKnown.statusCode).toBe(200);
      expect(wellKnown.json()).toMatchObject({
        baseUrl: 'http://127.0.0.1:9999',
        mcpUrl: 'http://127.0.0.1:9999/mcp',
        install: {
          npmPackage: 'mcp-dev-mesh'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('accepts join and sync requests', async () => {
    const app = await createHubServer({
      core: createDevMeshCore()
    });

    try {
      const join = await app.inject({
        method: 'POST',
        url: '/api/v1/join',
        payload: {
          groupKey: 'frontend-team',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const push = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        payload: {
          clientId: 'client_xiaoyun',
          events: [
            {
              id: 'evt_1',
              kind: 'knowledge.created',
              payload: {}
            }
          ]
        }
      });
      const pull = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/pull?cursor=cur_1'
      });

      expect(join.statusCode).toBe(200);
      expect(join.json()).toMatchObject({
        memberId: 'member_xiaoyun',
        clientId: 'client_xiaoyun',
        groupKey: 'frontend-team'
      });
      expect(push.json()).toMatchObject({
        accepted: 1,
        rejected: []
      });
      expect(pull.json()).toMatchObject({
        cursor: 'cur_1',
        events: []
      });
    } finally {
      await app.close();
    }
  });

  it('returns a project brief from canonical knowledge', async () => {
    const core = createDevMeshCore();
    await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'frontend-dashboard uses project brief',
      summary: 'The frontend-dashboard project should load canonical context first.',
      para: {
        category: 'projects',
        key: 'frontend-dashboard'
      }
    });
    await core.captureKnowledge({
      type: 'decision',
      layer: 'extract',
      title: 'frontend-dashboard extract note',
      summary: 'Extract notes should not appear in the canonical brief.'
    });
    const app = await createHubServer({ core });

    try {
      const brief = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/frontend-dashboard/brief'
      });

      expect(brief.statusCode).toBe(200);
      expect(brief.json().items).toHaveLength(1);
      expect(brief.json().items[0]).toMatchObject({
        layer: 'canonical',
        title: 'frontend-dashboard uses project brief'
      });
    } finally {
      await app.close();
    }
  });
});
