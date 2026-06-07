import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import Koa, { type Context, type Middleware } from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import type { DevMeshCore } from '@mcp-dev-mesh/core';
import {
  createDefaultWellKnown,
  type CreateProjectRequest,
  type ErrorResponse,
  type JoinRequest,
  type ProjectResponse,
  type ProjectsResponse,
  type SyncPushRequest
} from '@mcp-dev-mesh/protocol';
import {
  createAdminGroup,
  createAdminGlossary,
  createAdminInvite,
  createAdminKnowledgeEdge,
  createAdminOverview,
  createAdminProject,
  createAdminQualityReview,
  createAdminTaskDigest,
  disableAdminMember,
  listAdminAuditLogs,
  listAdminGlossary,
  listAdminInvites,
  listAdminKnowledge,
  listAdminKnowledgeEdges,
  listAdminMembers,
  listAdminProjects,
  listAdminReviewQueue,
  revokeAdminInvite,
  updateAdminGlossary,
  updateAdminProjectAcl,
  type AdminAuditQuery,
  type AdminGlossaryInput,
  type AdminGlossaryQuery,
  type AdminGroupInput,
  type AdminInviteInput,
  type AdminKnowledgeEdgeInput,
  type AdminKnowledgeEdgeQuery,
  type AdminKnowledgeQuery,
  type AdminMemberDisableInput,
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
  joinHubGroup,
  listHubGroups,
  listHubProjects,
  rotateHubAccessToken,
  type HubAuthContext,
  type HubError,
  type HubResult,
  type HubState,
  type HubStateOptions
} from './hub-state.js';
import { createHubProjectBrief } from './hub-knowledge.js';
import {
  pullHubSyncEventLog,
  pullHubSyncEvents,
  pushHubSyncEvents,
  replayHubSyncConflicts,
  replayHubSyncTombstones
} from './hub-sync.js';
import { createMeshMcpServer } from './mcp.js';

export interface MeshServerOptions {
  core: DevMeshCore;
  baseUrl?: string;
  logger?: boolean;
  hub?: HubStateOptions;
}

export interface MeshListenOptions {
  host?: string;
  port?: number;
}

export class KoaHubServer {
  readonly app: Koa;
  private readonly mcpSessions: Map<string, McpHttpSession>;
  private httpServer: Server | undefined;

  constructor(app: Koa, mcpSessions: Map<string, McpHttpSession>) {
    this.app = app;
    this.mcpSessions = mcpSessions;
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
    await Promise.all([...this.mcpSessions.values()].map((session) => session.transport.close()));
    this.mcpSessions.clear();

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
  const hub = createHubState(options.hub);
  const mcpSessions = new Map<string, McpHttpSession>();
  const router = createHubRouter(options.core, baseUrl, hub, mcpSessions);

  app.use(createErrorMiddleware(options.logger ?? false));
  app.use(createCorsMiddleware());
  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return new KoaHubServer(app, mcpSessions);
}

export async function listenMeshServer(server: KoaHubServer, options: MeshListenOptions = {}): Promise<string> {
  return server.listen(options);
}

function createHubRouter(
  core: DevMeshCore,
  baseUrl: string | undefined,
  hub: HubState,
  mcpSessions: Map<string, McpHttpSession>
): Router {
  const router = new Router();

  router.get('/healthz', (ctx) => {
    ctx.body = {
      status: 'ok',
      service: 'mcp-dev-mesh',
      version: '0.1.0'
    };
  });

  router.get('/.well-known/dev-mesh', (ctx) => {
    ctx.body = createDefaultWellKnown(resolveBaseUrl(ctx, baseUrl));
  });

  router.get('/api/v1/groups', (ctx) => {
    ctx.body = {
      groups: listHubGroups(hub)
    };
  });

  router.post('/api/v1/join', (ctx) => {
    sendHubResult(ctx, joinHubGroup(hub, readBody<JoinRequest>(ctx)));
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
      await replayHubSyncTombstones(hub, core, {
        groupKey: auth.value.groupKey,
        actor: auth.value.memberId
      });
      await replayHubSyncConflicts(hub, core, {
        groupKey: auth.value.groupKey,
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

  router.get('/api/v1/federation/sync-events', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const groupKey = readQueryString(ctx, 'groupKey') ?? auth.value.groupKey;

    if (groupKey !== auth.value.groupKey) {
      sendHubError(ctx, {
        statusCode: 403,
        code: 'federation.group_mismatch',
        message: 'Federation sync-events can only read the authenticated group.'
      });
      return;
    }

    ctx.body = pullHubSyncEventLog(
      hub,
      groupKey,
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
      groups: listHubGroups(hub)
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

  router.post('/api/v1/admin/projects', (ctx) => {
    sendHubResult(ctx, createAdminProject(hub, readBody<AdminProjectInput>(ctx)));
  });

  router.put('/api/v1/admin/projects/:groupKey/:id/acl', (ctx) => {
    const groupKey = ctx.params.groupKey;
    const projectId = ctx.params.id;

    if (groupKey === undefined || projectId === undefined) {
      sendHubError(ctx, {
        statusCode: 400,
        code: 'admin.project_acl_target_required',
        message: 'Project groupKey and id are required.'
      });
      return;
    }

    sendHubResult(ctx, updateAdminProjectAcl(hub, groupKey, projectId, readBody<AdminProjectAclInput>(ctx)));
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

  router.get('/api/v1/admin/knowledge-edges', (ctx) => {
    ctx.body = {
      edges: listAdminKnowledgeEdges(hub, readAdminKnowledgeEdgeQuery(ctx))
    };
  });

  router.post('/api/v1/admin/knowledge-edges', async (ctx) => {
    sendHubResult(ctx, await createAdminKnowledgeEdge(hub, core, readBody<AdminKnowledgeEdgeInput>(ctx)));
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
    await handleMcpRequest(ctx, core, mcpSessions);
  });

  return router;
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
  sessions: Map<string, McpHttpSession>
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
    session = await createMcpHttpSession(core, sessions);
  }

  ctx.respond = false;
  await session.transport.handleRequest(ctx.req, ctx.res, readBody(ctx));
}

async function createMcpHttpSession(
  core: DevMeshCore,
  sessions: Map<string, McpHttpSession>
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
  const server = createMeshMcpServer(core);

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
  const layer = readQueryString(ctx, 'layer');
  const includeSuperseded = readQueryBoolean(ctx, 'includeSuperseded');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (search !== undefined) {
    query.query = search;
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

function readAdminQualityReviewQuery(ctx: Context): AdminQualityReviewQuery {
  const query: AdminQualityReviewQuery = {};
  const layer = readQueryString(ctx, 'layer');
  const includeSuperseded = readQueryBoolean(ctx, 'includeSuperseded');
  const maxQualityScore = readQueryNumber(ctx, 'maxQualityScore');
  const maxConfidence = readQueryNumber(ctx, 'maxConfidence');
  const maxRating = readQueryNumber(ctx, 'maxRating');
  const maxAdoptionScore = readQueryNumber(ctx, 'maxAdoptionScore');
  const staleDays = readQueryNumber(ctx, 'staleDays');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

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
  const projectKey = readQueryString(ctx, 'projectKey');
  const status = readQueryString(ctx, 'status');
  const includeDone = readQueryBoolean(ctx, 'includeDone');
  const includeSuperseded = readQueryBoolean(ctx, 'includeSuperseded');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

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
  const groupKey = readQueryString(ctx, 'groupKey');
  const kind = readQueryString(ctx, 'kind');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (groupKey !== undefined) {
    query.groupKey = groupKey;
  }

  if (kind === 'supersedes' || kind === 'duplicates' || kind === 'contradicts') {
    query.kind = kind;
  }

  if (Number.isFinite(limit) && limit > 0) {
    query.limit = Math.min(limit, 100);
  }

  return query;
}

function readAdminGlossaryQuery(ctx: Context): AdminGlossaryQuery {
  const query: AdminGlossaryQuery = {};
  const search = readQueryString(ctx, 'query');
  const groupKey = readQueryString(ctx, 'groupKey');
  const projectKey = readQueryString(ctx, 'projectKey');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (search !== undefined) {
    query.query = search;
  }

  if (groupKey !== undefined) {
    query.groupKey = groupKey;
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
  const groupKey = readQueryString(ctx, 'groupKey');
  const action = readQueryString(ctx, 'action');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (groupKey !== undefined) {
    query.groupKey = groupKey;
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
