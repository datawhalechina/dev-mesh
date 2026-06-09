import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
type MeshServerProcess = ChildProcessByStdio<null, Readable, Readable>;

describe('mesh-server e2e smoke', () => {
  it('starts the server and serves MCP tools over HTTP', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-e2e-'));
    const port = await getFreePort();
    const server = await startMeshServer(projectRoot, port);

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const health = await fetch(`${baseUrl}/healthz`);

      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({
        status: 'ok',
        service: 'devmesh',
        version: DEV_MESH_VERSION
      });

      const mcp = await createMcpSession(`${baseUrl}/mcp`);
      const tools = await mcp.request('tools/list', {});

      expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
        expect.arrayContaining(['mesh_get_status', 'mesh_search_context', 'mesh_capture_knowledge'])
      );
      const status = await mcp.request('tools/call', {
        name: 'mesh_get_status',
        arguments: {}
      });
      const statusResult = JSON.parse(status.result.content[0].text);

      expect(statusResult).toMatchObject({
        service: 'devmesh',
        version: DEV_MESH_VERSION,
        mode: 'local-store',
        projectRoot
      });

      const capture = await mcp.request('tools/call', {
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          layer: 'canonical',
          title: 'E2E smoke captures project knowledge',
          summary: 'The app entrypoint can serve MCP tool calls over Streamable HTTP.',
          tags: ['e2e']
        }
      });
      const captured = JSON.parse(capture.result.content[0].text);

      expect(captured).toMatchObject({
        title: 'E2E smoke captures project knowledge',
        layer: 'canonical'
      });

      const search = await mcp.request('tools/call', {
        name: 'mesh_search_context',
        arguments: {
          query: 'Streamable HTTP',
          layers: ['canonical']
        }
      });
      const contextPack = JSON.parse(search.result.content[0].text);

      expect(contextPack).toMatchObject({
        query: 'Streamable HTTP',
        items: [
          {
            id: captured.id,
            title: 'E2E smoke captures project knowledge'
          }
        ]
      });
    } finally {
      await stopProcess(server);
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('loads deployment settings from an env file', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-env-e2e-'));
    const port = await getFreePort();
    const envFile = join(projectRoot, 'mesh-server.env');
    const hubStatePath = join(projectRoot, 'hub-state.json');
    const baseUrl = `http://127.0.0.1:${port}`;
    await writeFile(
      envFile,
      [
        'DEV_MESH_HOST=127.0.0.1',
        `DEV_MESH_PORT=${port}`,
        `DEV_MESH_BASE_URL=${baseUrl}`,
        `DEV_MESH_PROJECT_ROOT=${projectRoot}`,
        `DEV_MESH_HUB_STATE_PATH=${hubStatePath}`
      ].join('\n'),
      'utf8'
    );
    let joined: JoinResponseBody | undefined;

    try {
      const first = await startMeshServerProcess(['--env-file', envFile]);

      try {
        joined = await requestJson<JoinResponseBody>(`${baseUrl}/api/v1/join`, {
          method: 'POST',
          body: {
            inviteToken: 'devmesh-local-invite',
            displayName: 'Env Deploy',
            handle: 'env-deploy'
          }
        });
        await requestJson(`${baseUrl}/api/v1/projects`, {
          method: 'POST',
          headers: authHeaders(joined.body.accessToken),
          body: {
            id: 'env-file-project',
            name: 'Env File Project'
          }
        });
      } finally {
        await stopProcess(first);
      }

      if (joined === undefined) {
        throw new Error('Expected env-file join to complete before restart.');
      }

      const second = await startMeshServerProcess(['--env-file', envFile]);

      try {
        const projects = await requestJson(`${baseUrl}/api/v1/projects`, {
          headers: authHeaders(joined.body.accessToken)
        });

        expect(projects.status).toBe(200);
        expect(projects.body.projects).toEqual([
          expect.objectContaining({
            id: 'env-file-project',
            createdByMemberId: joined.body.memberId
          })
        ]);
      } finally {
        await stopProcess(second);
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

async function createMcpSession(url: string): Promise<{ request(method: string, params: unknown): Promise<JsonRpcResponse> }> {
  const initialize = await postMcp(url, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'dev-mesh-e2e',
        version: '0.1.0'
      }
    }
  });
  const sessionId = initialize.sessionId;

  if (sessionId === undefined) {
    throw new Error('Expected MCP initialization to return a session id.');
  }

  await postMcp(
    url,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    },
    sessionId
  );

  let nextId = 1;

  return {
    request(method, params) {
      return postMcp(
        url,
        {
          jsonrpc: '2.0',
          id: nextId++,
          method,
          params
        },
        sessionId
      ).then((response) => response.message);
    }
  };
}

async function postMcp(url: string, payload: unknown, sessionId?: string): Promise<McpPostResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json'
  };

  if (sessionId !== undefined) {
    headers['Mcp-Session-Id'] = sessionId;
    headers['Mcp-Protocol-Version'] = '2025-11-25';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const text = await response.text();

  if (response.status === 202) {
    return {
      status: response.status,
      message: {
        jsonrpc: '2.0'
      }
    };
  }

  if (!response.ok) {
    throw new Error(`MCP POST failed with ${response.status}: ${text}`);
  }

  const result: McpPostResult = {
    status: response.status,
    message: readSseJson(text)
  };
  const returnedSessionId = response.headers.get('mcp-session-id');

  if (returnedSessionId !== null) {
    result.sessionId = returnedSessionId;
  }

  return result;
}

function readSseJson(text: string): JsonRpcResponse {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('\n');

  if (!data) {
    throw new Error(`Expected SSE data, received: ${text}`);
  }

  return JSON.parse(data) as JsonRpcResponse;
}

async function startMeshServer(projectRoot: string, port: number): Promise<MeshServerProcess> {
  return startMeshServerProcess(['--host', '127.0.0.1', '--port', String(port), '--project-root', projectRoot]);
}

async function startMeshServerProcess(args: string[]): Promise<MeshServerProcess> {
  const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = join(repoRoot, 'apps', 'mesh-server', 'src', 'index.ts');
  const child = spawn(
    process.execPath,
    [tsxCli, entry, ...args],
    {
      cwd: repoRoot,
      env: createChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  await waitForServer(child);
  return child;
}

function createChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1'
  };

  for (const key of Object.keys(env)) {
    if (key.startsWith('DEV_MESH_')) {
      delete env[key];
    }
  }

  return env;
}

function waitForServer(child: MeshServerProcess): Promise<void> {
  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for mesh-server\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 10000);

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;

      if (stdout.includes('DevMesh server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`mesh-server exited early with ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

async function stopProcess(child: MeshServerProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

function getFreePort(): Promise<number> {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Expected a TCP port from test server.')));
        return;
      }

      server.close(() => resolve(address.port));
    });
  });
}

async function requestJson<T = any>(url: string, init: RequestJsonInit = {}): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers);
  const request: RequestInit = {
    ...init,
    headers
  };

  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
    request.body = JSON.stringify(init.body);
  }

  const response = await fetch(url, request);
  const text = await response.text();

  return {
    status: response.status,
    body: text ? (JSON.parse(text) as T) : ({} as T)
  };
}

function authHeaders(accessToken: string): { authorization: string } {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

interface McpPostResult {
  status: number;
  sessionId?: string;
  message: JsonRpcResponse;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: any;
  error?: unknown;
}

interface JoinResponseBody {
  memberId: string;
  clientId: string;
  groupKey: string;
  accessToken: string;
  syncSigningSecret: string;
  expiresAt: string;
}

interface RequestJsonInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
}
