import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
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
        service: 'mcp-dev-mesh'
      });

      const mcp = await createMcpSession(`${baseUrl}/mcp`);
      const tools = await mcp.request('tools/list', {});

      expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
        expect.arrayContaining(['mesh_search_context', 'mesh_capture_knowledge'])
      );

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
  const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = join(repoRoot, 'apps', 'mesh-server', 'src', 'index.ts');
  const child = spawn(
    process.execPath,
    [tsxCli, entry, '--host', '127.0.0.1', '--port', String(port), '--project-root', projectRoot],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  await waitForServer(child);
  return child;
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

      if (stdout.includes('MCP Dev Mesh server listening')) {
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
