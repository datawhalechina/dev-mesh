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
  createAdminOverview,
  createAdminProject,
  listAdminAuditLogs,
  listAdminKnowledge,
  listAdminMembers,
  listAdminProjects,
  listAdminReviewQueue,
  type AdminGroupInput,
  type AdminKnowledgeQuery,
  type AdminProjectInput
} from './hub-admin.js';
import {
  authenticateHubToken,
  createHubProject,
  createHubState,
  getHubProject,
  joinHubGroup,
  listHubGroups,
  listHubProjects,
  type HubAuthContext,
  type HubError,
  type HubResult,
  type HubState,
  type HubStateOptions
} from './hub-state.js';
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

  router.post('/api/v1/sync/push', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    const body = readBody<SyncPushRequest>(ctx);

    if (body.clientId !== auth.value.clientId) {
      sendHubError(ctx, {
        statusCode: 403,
        code: 'sync.client_mismatch',
        message: 'clientId must match the authenticated client.'
      });
      return;
    }

    ctx.body = {
      accepted: body.events.length,
      rejected: [],
      cursor: `cur_${auth.value.groupKey}_${Date.now().toString(36)}`
    };
  });

  router.get('/api/v1/sync/pull', (ctx) => {
    const auth = requireHubAuth(hub, ctx.headers);

    if (!auth.ok) {
      sendHubError(ctx, auth.error);
      return;
    }

    ctx.body = {
      cursor: readQueryString(ctx, 'cursor') ?? `cur_${auth.value.groupKey}_${Date.now().toString(36)}`,
      events: []
    };
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

    ctx.body = {
      projectId: project.value.id,
      groupKey: project.value.groupKey,
      items: await core.searchKnowledge({
        query: project.value.projectKey,
        layers: ['canonical'],
        limit: 5
      })
    };
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

  router.get('/api/v1/admin/projects', (ctx) => {
    ctx.body = {
      projects: listAdminProjects(hub)
    };
  });

  router.post('/api/v1/admin/projects', (ctx) => {
    sendHubResult(ctx, createAdminProject(hub, readBody<AdminProjectInput>(ctx)));
  });

  router.get('/api/v1/admin/knowledge', async (ctx) => {
    ctx.body = {
      items: await listAdminKnowledge(core, readAdminKnowledgeQuery(ctx))
    };
  });

  router.get('/api/v1/admin/review-queue', (ctx) => {
    ctx.body = listAdminReviewQueue();
  });

  router.get('/api/v1/admin/audit', (ctx) => {
    ctx.body = listAdminAuditLogs();
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
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
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

function readAdminKnowledgeQuery(ctx: Context): AdminKnowledgeQuery {
  const query: AdminKnowledgeQuery = {};
  const search = readQueryString(ctx, 'query');
  const layer = readQueryString(ctx, 'layer');
  const limit = Number.parseInt(readQueryString(ctx, 'limit') ?? '', 10);

  if (search !== undefined) {
    query.query = search;
  }

  if (layer === 'raw' || layer === 'extract' || layer === 'canonical') {
    query.layer = layer;
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
