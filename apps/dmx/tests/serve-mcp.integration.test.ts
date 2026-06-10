import { readFile, rm, stat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

describe('dmx serve --mcp', () => {
  it('serves stdio MCP and starts a shared project daemon on demand', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-stdio-mcp-'));
    const entry = join(repoRoot, 'apps', 'dmx', 'dist', 'index.js');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        entry,
        'serve',
        '--mcp',
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--daemon-idle-ms',
        '1000'
      ],
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: '1'
      } as Record<string, string>,
      stderr: 'pipe'
    });
    const client = new Client({
      name: 'dev-mesh-stdio-test',
      version: '0.1.0'
    });

    try {
      await client.connect(transport as never);

      const tools = await client.listTools();
      const statusResult = await client.callTool({
        name: 'mesh_get_status',
        arguments: {}
      });
      const statusText = readTextToolResult(statusResult);
      const captureResult = await client.callTool({
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          title: 'Stdio launcher starts daemon',
          summary: 'The foreground MCP launcher should start and reuse a project daemon.',
          layer: 'canonical',
          tags: ['stdio', 'daemon']
        }
      });
      const captureText = readTextToolResult(captureResult);
      const daemon = await waitForJson(join(projectRoot, '.dev-mesh', 'daemon.json'));
      const knowledgeJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'canonical', 'entries.jsonl'),
        'utf8'
      );

      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['mesh_get_status', 'mesh_search_context', 'mesh_capture_knowledge'])
      );
      expect(statusText).toContain('DevMesh status');
      expect(statusText).toContain(`version: ${DEV_MESH_VERSION}`);
      expect(statusText).toContain(`projectRoot: ${projectRoot}`);
      expect(statusText).toContain('mcp: entrypoint=stdio-proxy');
      expect(statusText).toContain('daemon: running=true');
      expect(captureText).toContain('Captured knowledge');
      expect(captureText).toContain('title: Stdio launcher starts daemon');
      expect(daemon).toMatchObject({
        projectRoot,
        version: DEV_MESH_VERSION
      });
      expect(knowledgeJsonl).toContain('"title":"Stdio launcher starts daemon"');
    } finally {
      await client.close().catch(() => undefined);
      await stopDaemon(projectRoot);
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

async function waitForJson(path: string): Promise<Record<string, unknown>> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
    try {
      await stat(path);
      return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    } catch {
      await sleep(100);
    }
  }

  throw new Error(`Timed out waiting for ${path}`);
}

async function stopDaemon(projectRoot: string): Promise<void> {
  try {
    const state = JSON.parse(await readFile(join(projectRoot, '.dev-mesh', 'daemon.json'), 'utf8')) as { pid?: number };

    if (typeof state.pid === 'number') {
      process.kill(state.pid, 'SIGTERM');
      await sleep(500);
    }
  } catch {
    // Nothing to stop.
  }
}

function readTextToolResult(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;

  if (text === undefined) {
    throw new Error('Expected a text tool result.');
  }

  return text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
