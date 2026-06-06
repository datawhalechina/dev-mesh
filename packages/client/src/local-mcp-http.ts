import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Context } from 'koa';
import { createLocalMeshMcpServer } from './local-mcp-server.js';
import type { DevMeshClientRuntime } from './runtime.js';

export interface LocalMcpHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export async function closeLocalMcpSessions(sessions: Map<string, LocalMcpHttpSession>): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.transport.close()));
  sessions.clear();
}

export async function handleLocalMcpRequest(
  ctx: Context,
  runtime: DevMeshClientRuntime,
  sessions: Map<string, LocalMcpHttpSession>
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
    session = await createMcpHttpSession(runtime, sessions);
  }

  ctx.respond = false;
  await session.transport.handleRequest(ctx.req, ctx.res, readBody(ctx));
}

async function createMcpHttpSession(
  runtime: DevMeshClientRuntime,
  sessions: Map<string, LocalMcpHttpSession>
): Promise<LocalMcpHttpSession> {
  await runtime.ensureProjectStore();

  let session: LocalMcpHttpSession;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessioninitialized(sessionId) {
      sessions.set(sessionId, session);
    },
    onsessionclosed(sessionId) {
      sessions.delete(sessionId);
    }
  });
  const server = createLocalMeshMcpServer(runtime);

  session = {
    server,
    transport
  };
  await server.connect(transport as never);

  return session;
}

function readMcpSessionId(headers: IncomingHttpHeaders): string | undefined {
  const value = headers['mcp-session-id'];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function readBody<T = unknown>(ctx: Context): T {
  return (ctx.request as { body?: T }).body ?? ({} as T);
}
