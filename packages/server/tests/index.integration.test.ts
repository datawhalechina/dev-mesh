import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createDevMeshCore, type DevMeshCore } from '@mcp-dev-mesh/core';
import { JsonlKnowledgeRepository } from '@mcp-dev-mesh/local-store';
import { DEFAULT_LOCAL_INVITE_TOKEN } from '../src/hub-state.js';
import { createHubServer, type KoaHubServer, type MeshServerOptions } from '../src/index.js';

describe('hub server HTTP integration', () => {
  it('serves health and well-known metadata with Koa', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const health = await requestJson(`${url}/healthz`);
      const wellKnown = await requestJson(`${url}/.well-known/dev-mesh`);

      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({
        status: 'ok',
        service: 'mcp-dev-mesh'
      });
      expect(wellKnown.status).toBe(200);
      expect(wellKnown.body).toMatchObject({
        baseUrl: url,
        mcpUrl: `${url}/mcp`,
        install: {
          npmPackage: 'mcp-dev-mesh'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('accepts join and sync requests', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore(),
      hub: {
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team'
          }
        ],
        invites: [
          {
            token: 'inv_frontend',
            groupKey: 'frontend-team'
          }
        ]
      }
    });

    try {
      const groups = await requestJson(`${url}/api/v1/groups`);
      const join = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend',
          groupKey: 'frontend-team',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const push = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(join.body.accessToken),
        body: {
          clientId: join.body.clientId,
          events: [
            {
              id: 'evt_1',
              kind: 'knowledge.created',
              payload: {}
            }
          ]
        }
      });
      const pull = await requestJson(`${url}/api/v1/sync/pull?cursor=cur_1`, {
        headers: authHeaders(join.body.accessToken)
      });

      expect(groups.body).toMatchObject({
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team',
            joinMode: 'invite'
          }
        ]
      });
      expect(join.status).toBe(200);
      expect(join.body).toMatchObject({
        memberId: 'member_frontend-team_xiaoyun',
        clientId: expect.stringMatching(/^client_frontend-team_xiaoyun_/),
        groupKey: 'frontend-team',
        accessToken: expect.stringMatching(/^mesh_/),
        expiresAt: expect.any(String)
      });
      expect(push.body).toMatchObject({
        accepted: 1,
        rejected: []
      });
      expect(pull.body).toMatchObject({
        cursor: 'cur_1',
        events: []
      });
    } finally {
      await app.close();
    }
  });

  it('validates invite tokens and scopes projects to the joined group', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore(),
      hub: {
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team'
          },
          {
            key: 'backend-team',
            displayName: 'Backend Team'
          }
        ],
        invites: [
          {
            token: 'inv_frontend',
            groupKey: 'frontend-team'
          },
          {
            token: 'inv_backend',
            groupKey: 'backend-team'
          }
        ]
      }
    });

    try {
      const missingInvite = await requestJson(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          displayName: 'No Token'
        }
      });
      const mismatchedGroup = await requestJson(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend',
          groupKey: 'backend-team',
          displayName: 'Wrong Group'
        }
      });
      const frontendJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const backendJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_backend',
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const frontendProject = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(frontendJoin.body.accessToken),
        body: {
          id: 'shared-dashboard',
          name: 'Shared Dashboard Frontend'
        }
      });
      const backendProject = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(backendJoin.body.accessToken),
        body: {
          id: 'shared-dashboard',
          name: 'Shared Dashboard Backend'
        }
      });

      await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(backendJoin.body.accessToken),
        body: {
          id: 'backend-private',
          name: 'Backend Private'
        }
      });

      const frontendProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(frontendJoin.body.accessToken)
      });
      const backendProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(backendJoin.body.accessToken)
      });
      const backendOnlyBrief = await requestJson(`${url}/api/v1/projects/backend-private/brief`, {
        headers: authHeaders(frontendJoin.body.accessToken)
      });

      expect(missingInvite.status).toBe(401);
      expect(missingInvite.body).toMatchObject({
        error: {
          code: 'join.invite_required'
        }
      });
      expect(mismatchedGroup.status).toBe(403);
      expect(mismatchedGroup.body).toMatchObject({
        error: {
          code: 'join.group_mismatch'
        }
      });
      expect(frontendProject.body.project).toMatchObject({
        id: 'shared-dashboard',
        groupKey: 'frontend-team',
        name: 'Shared Dashboard Frontend'
      });
      expect(backendProject.body.project).toMatchObject({
        id: 'shared-dashboard',
        groupKey: 'backend-team',
        name: 'Shared Dashboard Backend'
      });
      expect(frontendProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'shared-dashboard',
          groupKey: 'frontend-team',
          name: 'Shared Dashboard Frontend'
        })
      ]);
      expect(backendProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'backend-private',
          groupKey: 'backend-team',
          name: 'Backend Private'
        }),
        expect.objectContaining({
          id: 'shared-dashboard',
          groupKey: 'backend-team',
          name: 'Shared Dashboard Backend'
        })
      ]);
      expect(backendOnlyBrief.status).toBe(404);
      expect(backendOnlyBrief.body).toMatchObject({
        error: {
          code: 'project.not_found'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('serves admin data for the Vue management dashboard', async () => {
    const core = createDevMeshCore();
    await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'Admin dashboard lists knowledge',
      summary: 'The management page should show server knowledge and quality signals.'
    });
    const { app, url } = await startHubServer({ core });

    try {
      const group = await requestJson(`${url}/api/v1/admin/groups`, {
        method: 'POST',
        body: {
          key: 'design-team',
          displayName: 'Design Team',
          description: 'Owns UI system decisions.'
        }
      });
      const project = await requestJson(`${url}/api/v1/admin/projects`, {
        method: 'POST',
        body: {
          groupKey: 'design-team',
          id: 'component-library',
          name: 'Component Library'
        }
      });
      const overview = await requestJson(`${url}/api/v1/admin/overview`);
      const groups = await requestJson(`${url}/api/v1/admin/groups`);
      const projects = await requestJson(`${url}/api/v1/admin/projects`);
      const knowledge = await requestJson(`${url}/api/v1/admin/knowledge?layer=canonical`);
      const reviewQueue = await requestJson(`${url}/api/v1/admin/review-queue`);

      expect(group.body).toMatchObject({
        key: 'design-team',
        displayName: 'Design Team'
      });
      expect(project.body).toMatchObject({
        id: 'component-library',
        groupKey: 'design-team',
        name: 'Component Library'
      });
      expect(overview.body).toMatchObject({
        counts: {
          groups: 2,
          projects: 1,
          knowledgeItems: 1
        },
        mcpUrl: `${url}/mcp`
      });
      expect(groups.body.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'design-team',
            projectCount: 1
          })
        ])
      );
      expect(projects.body.projects).toEqual([
        expect.objectContaining({
          id: 'component-library',
          groupKey: 'design-team'
        })
      ]);
      expect(knowledge.body.items).toEqual([
        expect.objectContaining({
          title: 'Admin dashboard lists knowledge',
          layer: 'canonical'
        })
      ]);
      expect(reviewQueue.body).toEqual({
        items: []
      });
    } finally {
      await app.close();
    }
  });

  it('manages invites, disabled members, and audit logs through admin APIs', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const invite = await requestJson(`${url}/api/v1/admin/invites`, {
        method: 'POST',
        body: {
          groupKey: 'default',
          token: 'inv_admin_panel',
          maxUses: 2
        }
      });
      const invites = await requestJson(`${url}/api/v1/admin/invites`);
      const joined = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_admin_panel',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const disabled = await requestJson(`${url}/api/v1/admin/members/${joined.body.memberId}/disable`, {
        method: 'POST',
        body: {
          reason: 'Rotated off the project'
        }
      });
      const rejectedProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(joined.body.accessToken)
      });
      const revoked = await requestJson(`${url}/api/v1/admin/invites/inv_admin_panel`, {
        method: 'DELETE'
      });
      const revokedJoin = await requestJson(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_admin_panel',
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const audit = await requestJson(`${url}/api/v1/admin/audit?limit=10`);
      const memberAudit = await requestJson(`${url}/api/v1/admin/audit?action=member.disabled`);

      expect(invite.body).toMatchObject({
        token: 'inv_admin_panel',
        groupKey: 'default',
        uses: 0,
        maxUses: 2,
        status: 'active'
      });
      expect(invites.body.invites).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            token: 'inv_admin_panel',
            status: 'active'
          })
        ])
      );
      expect(disabled.body).toMatchObject({
        memberId: joined.body.memberId,
        status: 'disabled',
        disabledReason: 'Rotated off the project'
      });
      expect(rejectedProjects.status).toBe(403);
      expect(rejectedProjects.body).toMatchObject({
        error: {
          code: 'auth.member_disabled'
        }
      });
      expect(revoked.body).toMatchObject({
        token: 'inv_admin_panel',
        status: 'revoked',
        revokedBy: 'admin'
      });
      expect(revokedJoin.status).toBe(401);
      expect(revokedJoin.body).toMatchObject({
        error: {
          code: 'join.invite_invalid'
        }
      });
      expect(audit.body.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'invite.created',
            targetId: 'inv_admin_panel'
          }),
          expect.objectContaining({
            action: 'member.joined',
            targetId: joined.body.memberId
          }),
          expect.objectContaining({
            action: 'member.disabled',
            targetId: joined.body.memberId
          }),
          expect.objectContaining({
            action: 'invite.revoked',
            targetId: 'inv_admin_panel'
          })
        ])
      );
      expect(memberAudit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'member.disabled',
          targetId: joined.body.memberId
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('enforces admin-managed project ACLs for project lists and briefs', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const owner = await joinDefaultGroup(url);
      const maintainerJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const created = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(owner.accessToken),
        body: {
          id: 'restricted-dashboard',
          name: 'Restricted Dashboard'
        }
      });
      const acl = await requestJson(`${url}/api/v1/admin/projects/default/restricted-dashboard/acl`, {
        method: 'PUT',
        body: {
          visibility: 'restricted',
          members: [
            {
              memberId: maintainerJoin.body.memberId,
              role: 'maintainer'
            }
          ]
        }
      });
      const ownerProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(owner.accessToken)
      });
      const ownerBrief = await requestJson(`${url}/api/v1/projects/restricted-dashboard/brief`, {
        headers: authHeaders(owner.accessToken)
      });
      const maintainerProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(maintainerJoin.body.accessToken)
      });
      const adminProjects = await requestJson(`${url}/api/v1/admin/projects`);
      const aclAudit = await requestJson(`${url}/api/v1/admin/audit?action=project.acl.updated`);

      expect(created.body.project).toMatchObject({
        id: 'restricted-dashboard',
        access: {
          visibility: 'group',
          members: []
        }
      });
      expect(acl.body).toMatchObject({
        id: 'restricted-dashboard',
        access: {
          visibility: 'restricted',
          members: [
            {
              memberId: maintainerJoin.body.memberId,
              role: 'maintainer'
            }
          ]
        }
      });
      expect(ownerProjects.body.projects).toEqual([]);
      expect(ownerBrief.status).toBe(404);
      expect(ownerBrief.body).toMatchObject({
        error: {
          code: 'project.not_found'
        }
      });
      expect(maintainerProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'restricted-dashboard',
          access: {
            visibility: 'restricted',
            members: [
              {
                memberId: maintainerJoin.body.memberId,
                role: 'maintainer'
              }
            ]
          }
        })
      ]);
      expect(adminProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'restricted-dashboard',
          access: {
            visibility: 'restricted',
            members: [
              {
                memberId: maintainerJoin.body.memberId,
                role: 'maintainer'
              }
            ]
          }
        })
      ]);
      expect(aclAudit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'project.acl.updated',
          targetId: 'restricted-dashboard'
        })
      ]);
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
    const { app, url } = await startHubServer({ core });

    try {
      const joined = await joinDefaultGroup(url);
      const project = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken),
        body: {
          id: 'frontend-dashboard',
          name: 'Frontend Dashboard'
        }
      });
      const brief = await requestJson(`${url}/api/v1/projects/frontend-dashboard/brief`, {
        headers: authHeaders(joined.accessToken)
      });

      expect(project.status).toBe(200);
      expect(project.body.project).toMatchObject({
        id: 'frontend-dashboard',
        groupKey: 'default',
        name: 'Frontend Dashboard',
        createdByMemberId: joined.memberId
      });
      expect(brief.status).toBe(200);
      expect(brief.body).toMatchObject({
        projectId: 'frontend-dashboard',
        groupKey: 'default'
      });
      expect(brief.body.items).toHaveLength(1);
      expect(brief.body.items[0]).toMatchObject({
        layer: 'canonical',
        title: 'frontend-dashboard uses project brief'
      });
    } finally {
      await app.close();
    }
  });

  it('serves MCP tools/list and tools/call over streamable HTTP', async () => {
    const core = createDevMeshCore();
    const { app, url } = await startHubServer({ core });
    const client = new Client({
      name: 'dev-mesh-integration-test',
      version: '0.1.0'
    });

    try {
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
      await client.connect(transport as never);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['mesh_search_context', 'mesh_capture_knowledge'])
      );

      const capture = await client.callTool({
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          title: 'MCP streamable HTTP capture',
          summary: 'tools/call should route through the real MCP transport.',
          layer: 'canonical',
          tags: ['mcp']
        }
      });
      const captured = JSON.parse(readTextToolResult(capture));

      expect(captured).toMatchObject({
        title: 'MCP streamable HTTP capture',
        layer: 'canonical',
        tags: ['mcp']
      });

      const search = await client.callTool({
        name: 'mesh_search_context',
        arguments: {
          query: 'streamable HTTP',
          layers: ['canonical']
        }
      });
      const contextPack = JSON.parse(readTextToolResult(search));

      expect(contextPack).toMatchObject({
        query: 'streamable HTTP',
        items: [
          {
            id: captured.id,
            title: 'MCP streamable HTTP capture',
            quality: {
              qualityScore: expect.any(Number)
            }
          }
        ]
      });
    } finally {
      await client.close().catch(() => undefined);
      await app.close();
    }
  }, 30000);

  it('persists MCP capture, task, and rating calls when backed by the local store', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-server-'));
    const core = createDevMeshCore({
      projectRoot,
      repository: new JsonlKnowledgeRepository(projectRoot)
    });
    const { app, url } = await startHubServer({ core });
    const client = new Client({
      name: 'dev-mesh-local-store-test',
      version: '0.1.0'
    });

    try {
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
      await client.connect(transport as never);

      const captureResult = await client.callTool({
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          title: 'Persist MCP capture locally',
          summary: 'Local-store backed MCP capture should write JSONL and an event.',
          tags: ['mcp', 'local-store']
        }
      });
      const captured = JSON.parse(readTextToolResult(captureResult));
      const taskResult = await client.callTool({
        name: 'mesh_capture_task',
        arguments: {
          title: 'Persist MCP task progress',
          summary: 'Task progress should become searchable task knowledge.',
          status: 'done',
          tags: ['task']
        }
      });
      const task = JSON.parse(readTextToolResult(taskResult));
      const rateResult = await client.callTool({
        name: 'mesh_rate_knowledge',
        arguments: {
          id: captured.id,
          rating: 0,
          confidenceDelta: -0.1
        }
      });
      const rated = JSON.parse(readTextToolResult(rateResult));
      const knowledgeJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'extract', 'entries.jsonl'),
        'utf8'
      );
      const eventsJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'events', `${rated.event.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );
      const ratingsJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'ratings', `${rated.ratingEvent.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );

      expect(captured).toMatchObject({
        title: 'Persist MCP capture locally',
        event: {
          kind: 'knowledge.captured',
          payload: {
            knowledgeId: captured.id
          }
        }
      });
      expect(task).toMatchObject({
        type: 'task',
        summary: '[done] Task progress should become searchable task knowledge.',
        taskStatus: 'done',
        event: {
          kind: 'task.progress.captured'
        }
      });
      expect(rated).toMatchObject({
        id: captured.id,
        quality: {
          rating: 0
        },
        ratingEvent: {
          knowledgeId: captured.id,
          rating: 0,
          confidenceDelta: -0.1
        },
        event: {
          kind: 'knowledge.rated'
        }
      });
      expect(knowledgeJsonl).toContain('"title":"Persist MCP capture locally"');
      expect(knowledgeJsonl).toContain('"title":"Persist MCP task progress"');
      expect(eventsJsonl).toContain('"kind":"knowledge.captured"');
      expect(eventsJsonl).toContain('"kind":"task.progress.captured"');
      expect(eventsJsonl).toContain('"kind":"knowledge.rated"');
      expect(ratingsJsonl).toContain(`"knowledgeId":"${captured.id}"`);
    } finally {
      await client.close().catch(() => undefined);
      await app.close();
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

async function startHubServer(options: Omit<MeshServerOptions, 'baseUrl'>): Promise<{ app: KoaHubServer; url: string }> {
  const app = await createHubServer(options);
  const url = await app.listen({
    host: '127.0.0.1',
    port: 0
  });

  return {
    app,
    url
  };
}

async function joinDefaultGroup(url: string): Promise<JoinResponseBody> {
  const join = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
    method: 'POST',
    body: {
      inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
      displayName: 'Xiaoyun',
      handle: 'xiaoyun'
    }
  });

  return join.body;
}

async function requestJson<T = any>(url: string, init: JsonRequestInit = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    ...(init.headers ?? {})
  };
  let body: string | undefined;

  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? (JSON.parse(text) as T) : ({} as T)
  };
}

function readTextToolResult(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;

  if (text === undefined) {
    throw new Error('Expected a text tool result.');
  }

  return text;
}

function authHeaders(accessToken: string): { authorization: string } {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

interface JsonRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface JoinResponseBody {
  memberId: string;
  clientId: string;
  groupKey: string;
  accessToken: string;
  expiresAt: string;
}
