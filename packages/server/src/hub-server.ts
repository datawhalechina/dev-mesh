import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import Koa, { type Context, type Middleware } from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import type { DevMeshCore } from '@devmesh/core';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import {
  createDefaultWellKnown,
  type CrdtSyncExchangeRequest,
  type CreateProjectRequest,
  type ErrorResponse,
  type JoinRequest,
  type ProjectResponse,
  type ProjectsResponse,
  type SyncPushRequest
} from '@devmesh/protocol';
import {
  createAdminBranch,
  createAdminBranchMergePreview,
  createAdminGroup,
  createAdminGlossary,
  createAdminInvite,
  createAdminKnowledgeEdge,
  createAdminOverview,
  createAdminProject,
  createAdminQualityReview,
  createAdminTaskDigest,
  checkoutAdminProjectBranch,
  disableAdminMember,
  getAdminGlobalProjection,
  listAdminBranches,
  listAdminAuditLogs,
  listAdminCrdtDocuments,
  listAdminGlossary,
  listAdminInvites,
  listAdminKnowledge,
  listAdminKnowledgeEdges,
  listAdminMembers,
  listAdminProjects,
  listAdminReviewQueue,
  publishAdminKnowledgeToBranch,
  publishAdminKnowledgeBatchToBranch,
  revokeAdminInvite,
  rotateAdminMemberAccessToken,
  updateAdminGlossary,
  updateAdminProjectAcl,
  type AdminAuditQuery,
  type AdminBranchMergePreviewInput,
  type AdminBranchInput,
  type AdminCrdtDocumentQuery,
  type AdminGlossaryInput,
  type AdminGlossaryQuery,
  type AdminGroupInput,
  type AdminGlobalProjectionQuery,
  type AdminInviteInput,
  type AdminKnowledgeEdgeInput,
  type AdminKnowledgeEdgeQuery,
  type AdminKnowledgeBranchPublishInput,
  type AdminKnowledgeBranchBulkPublishInput,
  type AdminKnowledgeQuery,
  type AdminMemberDisableInput,
  type AdminProjectBranchInput,
  type AdminProjectAclInput,
  type AdminProjectInput,
  type AdminQualityReviewQuery,
  type AdminTaskDigestQuery
} from './hub-admin.js';
import {
  authenticateHubToken,
  createHubProject,
  createHubState,
  getHubProject,
  joinHubBranch,
  listHubBranchs,
  listHubProjects,
  rotateHubAccessToken,
  type HubAuthContext,
  type HubError,
  type HubResult,
  type HubState,
  type HubStateOptions
} from './hub-state.js';
import { exchangeHubCrdtChanges, materializeHubCrdtDocument } from './hub-crdt-sync.js';
import { createHubProjectBrief } from './hub-knowledge.js';
import { createJsonHubStateStore, type HubStatePersistenceStore } from './hub-persistence.js';
import {
  pullHubSyncEventLog,
  pullHubSyncEvents,
  pushHubSyncEvents,
  replayHubSyncConflicts,
  replayHubSyncKnowledgeSnapshots,
  replayHubSyncTombstones
} from './hub-sync.js';
import { createMeshMcpServer } from './mcp.js';

export interface MeshServerOptions {
  core: DevMeshCore;
  baseUrl?: string;
  logger?: boolean;
  hub?: HubStateOptions;
  hubStatePath?: string;
  hubStateStore?: HubStatePersistenceStore;
}

export interface MeshListenOptions {
  host?: string;
  port?: number;
}

export class KoaHubServer {
  readonly app: Koa;
  private readonly mcpSessions: Map<string, McpHttpSession>;
  private readonly adminMcpSessions: Map<string, McpHttpSession>;
  private httpServer: Server | undefined;

  constructor(app: Koa, mcpSessions: Map<string, McpHttpSession>, adminMcpSessions: Map<string, McpHttpSession>) {
    this.app = app;
    this.mcpSessions = mcpSessions;
    this.adminMcpSessions = adminMcpSessions;
  }

  async listen(options: MeshListenOptions = {}): Promise<string> {
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 8721;

    if (this.httpServer !== undefined) {
      throw new Error('Hub server is already listening.');
    }

    const server = createServer(this.app.callback());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.httpServer = server;
    const address = server.address();

    if (address === null || typeof address === 'string') {
      return `http://${host}:${port}`;
    }

    return `http://${host}:${address.port}`;
  }

  get server(): Server | undefined {
    return this.httpServer;
  }

  async close(): Promise<void> {
    await Promise.all([...this.mcpSessions.values(), ...this.adminMcpSessions.values()].map((session) => session.transport.close()));
    this.mcpSessions.clear();
    this.adminMcpSessions.clear();

    if (this.httpServer === undefined) {
      return;
    }

    const server = this.httpServer;
    this.httpServer = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

interface McpHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export async function createHubServer(options: MeshServerOptions): Promise<KoaHubServer> {
  const app = new Koa();
  const baseUrl = options.baseUrl;
  const hubStateStore = resolveHubStateStore(options);
  const hub = hubStateStore === undefined ? createHubState(options.hub) : await hubStateStore.load(options.hub);
  const mcpSessions = new Map<string, McpHttpSession>();
  const adminMcpSessions = new Map<string, McpHttpSession>();
  const router = createHubRouter(options.core, baseUrl, hub, mcpSessions, adminMcpSessions);

  app.use(createErrorMiddleware(options.logger ?? false));
  app.use(createCorsMiddleware());
  app.use(bodyParser());
  if (hubStateStore !== undefined) {
    app.use(createHubStatePersistenceMiddleware(hub, hubStateStore));
  }
  app.use(router.routes());
  app.use(router.allowedMethods());

  return new KoaHubServer(app, mcpSessions, adminMcpSessions);
}

function resolveHubStateStore(options: MeshServerOptions): HubStatePersistenceStore | undefined {
  if (options.hubStatePath !== undefined && options.hubStateStore !== undefined) {
    throw new Error('hubStatePath and hubStateStore cannot be used together.');
  }

  if (options.hubStateStore !== undefined) {
    return options.hubStateStore;
  }

  return options.hubStatePath === undefined ? undefined : createJsonHubStateStore(options.hubStatePath);
}

export async function listenMeshServer(server: KoaHubServer, options: MeshListenOptions = {}): Promise<string> {
  return server.listen(options);
}

function createHubRouter(
  core: DevMeshCore,
  baseUrl: string | undefined,
  hub: HubState,
  mcpSessions: Map<string, McpHttpSession>,
  adminMcpSessions: Map<string, McpHttpSession>
): Router {
  const router = new Router();

  router.get('/healthz', (ctx) => {
    ctx.body = {
      status: 'ok',
      service: 'devmesh',
      version: DEV_MESH_VERSION
    };
  });

  const sendWellKnown = (ctx: Context) => {
    ctx.body = createDefaultWellKnown(resolveBaseUrl(ctx, baseUrl));
  };

  router.get('/.well-known/devmesh', sendWellKnown);

  router.get('/api/v1/groups', (ctx) => {
    ctx.body = {
      groups: listHubBranchs(hub)
    };
  });

  router.post('/api/v1/join', (ctx) => {
    sendHubResult(ctx, joinHubBranch(hub, readBody<JoinRequest>(ctx)));
  });

  router.post('/api/v1/auth/rotate', (ctx) => {
    sendHubResult(ctx, rotateHubAccessToken(hub, readBearerToken(ctx.headers)));
  });

  router.post('/api/v1/sync/push', async (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const result = pushHubSyncEvents(hub, auth.value, readBody<SyncPushRequest>(ctx));

    if (result.ok && result.value.accepted > 0) {
      await replayHubSyncKnowledgeSnapshots(hub, core, {
        branch: auth.value.branch,
        actor: auth.value.memberId
      });
      await replayHubSyncTombstones(hub, core, {
        branch: auth.value.branch,
        actor: auth.value.memberId
      });
      await replayHubSyncConflicts(hub, core, {
        branch: auth.value.branch,
        actor: auth.value.memberId
      });
    }

    sendHubResult(ctx, result);
  });

  router.get('/api/v1/sync/pull', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    ctx.body = pullHubSyncEvents(hub, auth.value, readQueryString(ctx, 'cursor'));
  });

  router.get('/api/v2/projections/global', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const projectKey = readQueryString(ctx, 'projectKey');
    const query: AdminGlobalProjectionQuery = {
      branch: auth.value.branch
    };

    if (projectKey !== undefined) {
      query.projectKey = projectKey;
    }

    ctx.body = getAdminGlobalProjection(hub, query);
  });

  router.post('/api/v2/sync/exchange', async (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const result = exchangeHubCrdtChanges(hub, auth.value, readBody<CrdtSyncExchangeRequest>(ctx));

    if (!result.ok) {
      sendHubError(ctx, result.error);
      return;
    }

    if (result.value.acceptedChanges.length > 0) {
      const materialized = await materializeHubCrdtDocument(hub, core, result.value.document, auth.value.memberId);

      result.value.projection = {
        materialized: materialized.materialized > 0,
        sourceHeads: materialized.heads,
        updatedAt: new Date().toISOString()
      };
    }

    ctx.body = result.value;
  });

  router.get('/api/v1/federation/sync-events', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const branch = readQueryString(ctx, 'branch') ?? auth.value.branch;

    if (branch !== auth.value.branch) {
      sendHubError(ctx, {
        statusCode: 403,
        code: 'federation.group_mismatch',
        message: 'Federation sync-events can only read the authenticated group.'
      });
      return;
    }

    ctx.body = pullHubSyncEventLog(
      hub,
      branch,
      readQueryString(ctx, 'cursor'),
      readFederationEventLogLimit(ctx)
    );
  });

  router.get('/api/v1/projects', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const body: ProjectsResponse = {
      projects: listHubProjects(hub, auth.value)
    };
    ctx.body = body;
  });

  router.post('/api/v1/projects', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const project = createHubProject(hub, auth.value, readBody<CreateProjectRequest>(ctx));

    if (!project.ok) {
      sendHubError(ctx, project.error);
      return;
    }

    const body: ProjectResponse = {
      project: project.value
    };
    ctx.body = body;
  });

  router.get('/api/v1/projects/:id/brief', async (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const projectId = ctx.params.id;

    if (projectId === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'project.id_required',
        message: 'Project id is required.'
      });
      return;
    }

    const project = getHubProject(hub, auth.value, projectId);

    if (!project.ok) {
      sendHubError(ctx, project.error);
      return;
    }

    ctx.body = await createHubProjectBrief(core, auth.value, project.value);
  });

  router.get('/api/v1/admin/overview', async (ctx) => {
    ctx.body = await createAdminOverview(hub, core, resolveBaseUrl(ctx, baseUrl));
  });

  router.get('/api/v1/admin/groups', (ctx) => {
    ctx.body = {
      groups: listHubBranchs(hub)
    };
  });

  router.post('/api/v1/admin/groups', (ctx) => {
    sendHubResult(ctx, createAdminGroup(hub, readBody<AdminGroupInput>(ctx)));
  });

  router.get('/api/v1/admin/members', (ctx) => {
    ctx.body = {
      members: listAdminMembers(hub)
    };
  });

  router.post('/api/v1/admin/members/:memberId/disable', (ctx) => {
    const memberId = ctx.params.memberId;

    if (memberId === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'admin.member_id_required',
        message: 'Member id is required.'
      });
      return;
    }

    sendHubResult(ctx, disableAdminMember(hub, memberId, readBody<AdminMemberDisableInput>(ctx)));
  });

  router.post('/api/v1/admin/members/:memberId/rotate-token', (ctx) => {
    const memberId = ctx.params.memberId;

    if (memberId === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'admin.member_id_required',
        message: 'Member id is required.'
      });
      return;
    }

    sendHubResult(ctx, rotateAdminMemberAccessToken(hub, memberId));
  });

  router.get('/api/v1/admin/invites', (ctx) => {
    ctx.body = {
      invites: listAdminInvites(hub)
    };
  });

  router.post('/api/v1/admin/invites', (ctx) => {
    sendHubResult(ctx, createAdminInvite(hub, readBody<AdminInviteInput>(ctx)));
  });

  router.delete('/api/v1/admin/invites/:token', (ctx) => {
    const token = ctx.params.token;

    if (token === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'admin.invite_token_required',
        message: 'Invite token is required.'
      });
      return;
    }

    sendHubResult(ctx, revokeAdminInvite(hub, token));
  });

  router.get('/api/v1/admin/projects', (ctx) => {
    ctx.body = {
      projects: listAdminProjects(hub)
    };
  });

  router.get('/api/v1/admin/branches', (ctx) => {
    ctx.body = {
      branches: listAdminBranches(hub)
    };
  });

  router.post('/api/v1/admin/branches', (ctx) => {
    sendHubResult(ctx, createAdminBranch(hub, readBody<AdminBranchInput>(ctx)));
  });

  router.get('/api/v1/admin/branches/merge-preview', async (ctx) => {
    sendHubResult(ctx, await createAdminBranchMergePreview(hub, core, readAdminBranchMergePreviewInput(ctx)));
  });

  router.post('/api/v1/admin/projects', (ctx) => {
    sendHubResult(ctx, createAdminProject(hub, readBody<AdminProjectInput>(ctx)));
  });

  router.put('/api/v1/admin/projects/:branch/:id/branch', (ctx) => {
    const branch = ctx.params.branch;
    const projectId = ctx.params.id;

    if (branch === undefined || projectId === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'admin.project_branch_target_required',
        message: 'Project branch and id are required.'
      });
      return;
    }

    sendHubResult(ctx, checkoutAdminProjectBranch(hub, branch, projectId, readBody<AdminProjectBranchInput>(ctx)));
  });

  router.put('/api/v1/admin/projects/:branch/:id/acl', (ctx) => {
    const branch = ctx.params.branch;
    const projectId = ctx.params.id;

    if (branch === undefined || projectId === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'admin.project_acl_target_required',
        message: 'Project branch and id are required.'
      });
      return;
    }

    sendHubResult(ctx, updateAdminProjectAcl(hub, branch, projectId, readBody<AdminProjectAclInput>(ctx)));
  });

  router.get('/api/v1/admin/glossary', async (ctx) => {
    ctx.body = {
      items: await listAdminGlossary(core, readAdminGlossaryQuery(ctx))
    };
  });

  router.post('/api/v1/admin/glossary', async (ctx) => {
    sendHubResult(ctx, await createAdminGlossary(hub, core, readBody<AdminGlossaryInput>(ctx)));
  });

  router.put('/api/v1/admin/glossary/:id', async (ctx) => {
    const id = ctx.params.id;

    if (id === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'admin.glossary_id_required',
        message: 'Glossary id is required.'
      });
      return;
    }

    sendHubResult(ctx, await updateAdminGlossary(hub, core, id, readBody<AdminGlossaryInput>(ctx)));
  });

  router.get('/api/v1/admin/knowledge', async (ctx) => {
    ctx.body = {
      items: await listAdminKnowledge(core, readAdminKnowledgeQuery(ctx))
    };
  });

  router.get('/api/v1/admin/global-projection', (ctx) => {
    ctx.body = getAdminGlobalProjection(hub, readAdminGlobalProjectionQuery(ctx));
  });

  router.get('/api/v1/admin/crdt-documents', (ctx) => {
    ctx.body = listAdminCrdtDocuments(hub, readAdminCrdtDocumentQuery(ctx));
  });

  router.get('/api/v1/admin/knowledge-edges', (ctx) => {
    ctx.body = {
      edges: listAdminKnowledgeEdges(hub, readAdminKnowledgeEdgeQuery(ctx))
    };
  });

  router.post('/api/v1/admin/knowledge-edges', async (ctx) => {
    sendHubResult(ctx, await createAdminKnowledgeEdge(hub, core, readBody<AdminKnowledgeEdgeInput>(ctx)));
  });

  router.post('/api/v1/admin/knowledge/branch-publish', async (ctx) => {
    sendHubResult(ctx, await publishAdminKnowledgeToBranch(hub, core, readBody<AdminKnowledgeBranchPublishInput>(ctx)));
  });

  router.post('/api/v1/admin/branches/bulk-publish', async (ctx) => {
    sendHubResult(ctx, await publishAdminKnowledgeBatchToBranch(hub, core, readBody<AdminKnowledgeBranchBulkPublishInput>(ctx)));
  });

  router.get('/api/v1/admin/quality-review', async (ctx) => {
    ctx.body = await createAdminQualityReview(core, readAdminQualityReviewQuery(ctx));
  });

  router.get('/api/v1/admin/task-digest', async (ctx) => {
    ctx.body = await createAdminTaskDigest(core, readAdminTaskDigestQuery(ctx));
  });

  router.get('/api/v1/admin/review-queue', (ctx) => {
    ctx.body = listAdminReviewQueue();
  });

  router.get('/api/v1/admin/audit', (ctx) => {
    ctx.body = listAdminAuditLogs(hub, readAdminAuditQuery(ctx));
  });

  router.all('/mcp', async (ctx) => {
    await handleMcpRequest(ctx, core, hub, mcpSessions, false, baseUrl);
  });

  router.all('/api/v1/admin/mcp', async (ctx) => {
    await handleMcpRequest(ctx, core, hub, adminMcpSessions, true, baseUrl);
  });

  return router;
}

function createHubStatePersistenceMiddleware(hub: HubState, store: HubStatePersistenceStore): Middleware {
  return async (ctx, next) => {
    await next();

    if (ctx.method === 'GET' || ctx.method === 'HEAD' || ctx.status >= 500) {
      return;
    }

    await store.save(hub);
  };
}

function createErrorMiddleware(logger: boolean): Middleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (logger) {
        console.error(error);
      }

      ctx.status = 500;
      ctx.body = {
        error: {
          code: 'server.internal_error',
          message: error instanceof Error ? error.message : 'Unexpected server error.'
        }
      };
    }
  };
}

function createCorsMiddleware(): Middleware {
  return async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');

    if (ctx.method === 'OPTIONS') {
      ctx.status = 204;
      return;
    }

    await next();
  };
}

function requireHubAuth(
  hub: HubState,
  headers: Record<string, string | string[] | undefined>
): HubResult<HubAuthContext> {
  return authenticateHubToken(hub, readBearerToken(headers));
}

function sendHubResult<T>(ctx: Context, result: HubResult<T>): void {
  if (result.ok) {
    ctx.body = result.value;
    return;
  }

  sendHubError(ctx, result.error);
}

function sendHubError(ctx: Context, error: HubError): void {
  ctx.status = error.statusCode;
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message
    }
  };
  ctx.body = body;
}

function readBearerToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const value = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;

  if (value === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

async function handleMcpRequest(
  ctx: Context,
  core: DevMeshCore,
  hub: HubState,
  sessions: Map<string, McpHttpSession>,
  admin: boolean,
  baseUrl: string | undefined
): Promise<void> {
  const sessionId = readMcpSessionId(ctx.headers);
  let session = sessionId === undefined ? undefined : sessions.get(sessionId);

  if (session === undefined && sessionId !== undefined) {
    ctx.status = 404;
    ctx.body = {
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: `MCP session ${sessionId} was not found`
      },
      id: null
    };
    return;
  }

  if (session === undefined) {
    session = admin
      ? await createMcpHttpSession(core, hub, sessions, true, resolveBaseUrl(ctx, baseUrl))
      : await createMcpHttpSession(core, hub, sessions, false);
  }

  ctx.respond = false;
  await session.transport.handleRequest(ctx.req, ctx.res, readBody(ctx));
}

async function createMcpHttpSession(
  core: DevMeshCore,
  hub: HubState,
  sessions: Map<string, McpHttpSession>,
  admin: boolean,
  baseUrl?: string
): Promise<McpHttpSession> {
  let session: McpHttpSession;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessioninitialized(sessionId) {
      sessions.set(sessionId, session);
    },
    onsessionclosed(sessionId) {
      sessions.delete(sessionId);
    }
  });
  const server = createMeshMcpServer(core, {
    knowledgeEdges: () => hub.knowledgeEdges,
    async linkKnowledge(input) {
      const edgeInput: AdminKnowledgeEdgeInput = {
        kind: input.kind,
        fromId: input.fromId,
        toId: input.toId
      };

      if (input.reason !== undefined) {
        edgeInput.reason = input.reason;
      }

      if (input.project !== 'auto') {
        edgeInput.branch = input.project;
      }

      const result = await createAdminKnowledgeEdge(hub, core, edgeInput);

      return result.ok
        ? result.value
        : {
            error: result.error
          };
    },
    ...(admin
      ? {
          admin: {
            hub,
            baseUrl: baseUrl ?? 'http://127.0.0.1'
          }
        }
      : {})
  });

  session = {
    server,
    transport
  };
  await server.connect(transport as never);

  return session;
}

function readMcpSessionId(headers: Record<string, string | string[] | undefined>): string | undefined {
  const value = headers['mcp-session-id'];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function readBody<T = unknown>(ctx: Context): T {
  return (ctx.request as { body?: T }).body ?? ({} as T);
}

function readQueryString(ctx: Context, key: string): string | undefined {
  const value = ctx.query[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === 'string' ? value : undefined;
}

function readBranchQueryString(ctx: Context): string | undefined {
  return readQueryString(ctx, 'branchKey') ?? readQueryString(ctx, 'branch');
}

function readQueryBoolean(ctx: Context, key: string): boolean | undefined {
  const value = readQueryString(ctx, key)?.toLowerCase();

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  return undefined;
}

function readQueryNumber(ctx: Context, key: string): number | undefined {
  const value = Number.parseFloat(readQueryString(ctx, key) ?? '');

  return Number.isFinite(value) ? value : undefined;
}

function readFederationEventLogLimit(ctx: Context): number | undefined {
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : undefined;
}

function readAdminKnowledgeQuery(ctx: Context): AdminKnowledgeQuery {
  const query: AdminKnowledgeQuery = {};
  const search = readQueryString(ctx, 'query');
  const branchKey = readBranchQueryString(ctx);
  const layer = readQueryString(ctx, 'layer');
  const includeSuperseded = readQueryBoolean(ctx, 'includeSuperseded');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (search !== undefined) {
    query.query = search;
  }

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (layer === 'raw' || layer === 'extract' || layer === 'canonical') {
    query.layer = layer;
  }

  if (includeSuperseded !== undefined) {
    query.includeSuperseded = includeSuperseded;
  }

  if (Number.isFinite(limit) && limit > 0) {
    query.limit = Math.min(limit, 100);
  }

  return query;
}

function readAdminBranchMergePreviewInput(ctx: Context): AdminBranchMergePreviewInput {
  const input: AdminBranchMergePreviewInput = {};
  const sourceBranchKey = readQueryString(ctx, 'sourceBranchKey') ?? readQueryString(ctx, 'sourceGroupKey');
  const targetBranchKey = readQueryString(ctx, 'targetBranchKey') ?? readQueryString(ctx, 'targetBranchKey');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (sourceBranchKey !== undefined) {
    input.sourceBranchKey = sourceBranchKey;
  }

  if (targetBranchKey !== undefined) {
    input.targetBranchKey = targetBranchKey;
  }

  if (Number.isFinite(limit) && limit > 0) {
    input.limit = Math.min(limit, 500);
  }

  return input;
}

function readAdminQualityReviewQuery(ctx: Context): AdminQualityReviewQuery {
  const query: AdminQualityReviewQuery = {};
  const branchKey = readBranchQueryString(ctx);
  const layer = readQueryString(ctx, 'layer');
  const includeSuperseded = readQueryBoolean(ctx, 'includeSuperseded');
  const maxQualityScore = readQueryNumber(ctx, 'maxQualityScore');
  const maxConfidence = readQueryNumber(ctx, 'maxConfidence');
  const maxRating = readQueryNumber(ctx, 'maxRating');
  const maxAdoptionScore = readQueryNumber(ctx, 'maxAdoptionScore');
  const staleDays = readQueryNumber(ctx, 'staleDays');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (layer === 'raw' || layer === 'extract' || layer === 'canonical') {
    query.layer = layer;
  }

  if (includeSuperseded !== undefined) {
    query.includeSuperseded = includeSuperseded;
  }

  if (maxQualityScore !== undefined) {
    query.maxQualityScore = maxQualityScore;
  }

  if (maxConfidence !== undefined) {
    query.maxConfidence = maxConfidence;
  }

  if (maxRating !== undefined) {
    query.maxRating = maxRating;
  }

  if (maxAdoptionScore !== undefined) {
    query.maxAdoptionScore = maxAdoptionScore;
  }

  if (staleDays !== undefined && staleDays > 0) {
    query.staleDays = staleDays;
  }

  if (Number.isFinite(limit) && limit > 0) {
    query.limit = Math.min(limit, 100);
  }

  return query;
}

function readAdminTaskDigestQuery(ctx: Context): AdminTaskDigestQuery {
  const query: AdminTaskDigestQuery = {};
  const branchKey = readBranchQueryString(ctx);
  const projectKey = readQueryString(ctx, 'projectKey');
  const status = readQueryString(ctx, 'status');
  const includeDone = readQueryBoolean(ctx, 'includeDone');
  const includeSuperseded = readQueryBoolean(ctx, 'includeSuperseded');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (projectKey !== undefined) {
    query.projectKey = projectKey;
  }

  if (status === 'todo' || status === 'in_progress' || status === 'blocked' || status === 'done' || status === 'unknown') {
    query.status = status;
  }

  if (includeDone !== undefined) {
    query.includeDone = includeDone;
  }

  if (includeSuperseded !== undefined) {
    query.includeSuperseded = includeSuperseded;
  }

  if (Number.isFinite(limit) && limit > 0) {
    query.limit = Math.min(limit, 100);
  }

  return query;
}

function readAdminKnowledgeEdgeQuery(ctx: Context): AdminKnowledgeEdgeQuery {
  const query: AdminKnowledgeEdgeQuery = {};
  const branchKey = readBranchQueryString(ctx);
  const kind = readQueryString(ctx, 'kind');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (kind === 'supersedes' || kind === 'duplicates' || kind === 'contradicts') {
    query.kind = kind;
  }

  if (Number.isFinite(limit) && limit > 0) {
    query.limit = Math.min(limit, 100);
  }

  return query;
}

function readAdminGlobalProjectionQuery(ctx: Context): AdminGlobalProjectionQuery {
  const query: AdminGlobalProjectionQuery = {};
  const branchKey = readBranchQueryString(ctx);
  const projectKey = readQueryString(ctx, 'projectKey');

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (projectKey !== undefined) {
    query.projectKey = projectKey;
  }

  return query;
}

function readAdminCrdtDocumentQuery(ctx: Context): AdminCrdtDocumentQuery {
  const query: AdminCrdtDocumentQuery = {};
  const kind = readQueryString(ctx, 'kind');
  const branchKey = readBranchQueryString(ctx);
  const projectKey = readQueryString(ctx, 'projectKey');

  if (kind !== undefined) {
    query.kind = kind;
  }

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (projectKey !== undefined) {
    query.projectKey = projectKey;
  }

  return query;
}

function readAdminGlossaryQuery(ctx: Context): AdminGlossaryQuery {
  const query: AdminGlossaryQuery = {};
  const search = readQueryString(ctx, 'query');
  const branchKey = readBranchQueryString(ctx);
  const projectKey = readQueryString(ctx, 'projectKey');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (search !== undefined) {
    query.query = search;
  }

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (projectKey !== undefined) {
    query.projectKey = projectKey;
  }

  if (Number.isFinite(limit) && limit > 0) {
    query.limit = Math.min(limit, 100);
  }

  return query;
}

function readAdminAuditQuery(ctx: Context): AdminAuditQuery {
  const query: AdminAuditQuery = {};
  const branchKey = readBranchQueryString(ctx);
  const action = readQueryString(ctx, 'action');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (branchKey !== undefined) {
    query.branchKey = branchKey;
  }

  if (action !== undefined) {
    query.action = action;
  }

  if (Number.isFinite(limit) && limit > 0) {
    query.limit = Math.min(limit, 100);
  }

  return query;
}

function resolveBaseUrl(ctx: Context, configuredBaseUrl: string | undefined): string {
  if (configuredBaseUrl !== undefined) {
    return configuredBaseUrl.replace(/\/$/, '');
  }

  return `${ctx.protocol}://${ctx.host}`.replace(/\/$/, '');
}
