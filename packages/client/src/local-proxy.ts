import { createServer, type Server } from 'node:http';
import Koa, { type Middleware } from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import {
  closeLocalMcpSessions,
  handleLocalMcpRequest,
  type LocalMcpHttpSession
} from './local-mcp-http.js';
import { createDevMeshClientRuntime, type DevMeshClientOptions, type DevMeshClientRuntime } from './runtime.js';

export const DEFAULT_LOCAL_PROXY_HOST = '127.0.0.1';
export const DEFAULT_LOCAL_PROXY_PORT = 8722;

export interface LocalMcpProxyOptions extends DevMeshClientOptions {
  logger?: boolean;
}

export interface LocalMcpProxyListenOptions {
  host?: string;
  port?: number;
}

export class LocalMcpProxy {
  readonly app: Koa;
  readonly runtime: DevMeshClientRuntime;
  private readonly mcpSessions: Map<string, LocalMcpHttpSession>;
  private httpServer: Server | undefined;

  constructor(app: Koa, runtime: DevMeshClientRuntime, mcpSessions: Map<string, LocalMcpHttpSession>) {
    this.app = app;
    this.runtime = runtime;
    this.mcpSessions = mcpSessions;
  }

  get projectRoot(): string {
    return this.runtime.projectRoot;
  }

  get server(): Server | undefined {
    return this.httpServer;
  }

  async listen(options: LocalMcpProxyListenOptions = {}): Promise<string> {
    const host = options.host ?? DEFAULT_LOCAL_PROXY_HOST;
    const port = options.port ?? DEFAULT_LOCAL_PROXY_PORT;

    if (this.httpServer !== undefined) {
      throw new Error('Local MCP proxy is already listening.');
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

  async close(): Promise<void> {
    await closeLocalMcpSessions(this.mcpSessions);

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

export async function createLocalMcpProxy(options: LocalMcpProxyOptions = {}): Promise<LocalMcpProxy> {
  const runtimeOptions: DevMeshClientOptions = {};

  if (options.projectRoot !== undefined) {
    runtimeOptions.projectRoot = options.projectRoot;
  }

  if (options.memberName !== undefined) {
    runtimeOptions.memberName = options.memberName;
  }

  const runtime = createDevMeshClientRuntime(runtimeOptions);
  const mcpSessions = new Map<string, LocalMcpHttpSession>();
  const app = new Koa();
  const router = createLocalProxyRouter(runtime, mcpSessions);

  app.use(createErrorMiddleware(options.logger ?? false));
  app.use(createCorsMiddleware());
  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return new LocalMcpProxy(app, runtime, mcpSessions);
}

export async function listenLocalMcpProxy(
  proxy: LocalMcpProxy,
  options: LocalMcpProxyListenOptions = {}
): Promise<string> {
  return proxy.listen(options);
}

function createLocalProxyRouter(
  runtime: DevMeshClientRuntime,
  mcpSessions: Map<string, LocalMcpHttpSession>
): Router {
  const router = new Router();

  router.get('/healthz', (ctx) => {
    const baseUrl = `${ctx.protocol}://${ctx.host}`.replace(/\/$/, '');

    ctx.body = {
      status: 'ok',
      service: 'mcp-dev-mesh-local-proxy',
      version: '0.1.0',
      projectRoot: runtime.projectRoot,
      mcpUrl: `${baseUrl}/mcp`
    };
  });

  router.all('/mcp', async (ctx) => {
    await handleLocalMcpRequest(ctx, runtime, mcpSessions);
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
          code: 'local_proxy.internal_error',
          message: error instanceof Error ? error.message : 'Unexpected local proxy error.'
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
