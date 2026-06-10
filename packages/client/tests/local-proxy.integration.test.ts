import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import { createLocalMcpProxy } from '../src/index.js';

describe('local MCP proxy', () => {
  it('serves core MCP tools and writes captures to the project store', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-local-proxy-'));
    const proxy = await createLocalMcpProxy({
      projectRoot,
      memberName: 'Xiaoyun'
    });
    const url = await proxy.listen({
      host: '127.0.0.1',
      port: 0
    });
    const client = new Client({
      name: 'dev-mesh-local-proxy-test',
      version: '0.1.0'
    });

    try {
      const health = await requestJson(`${url}/healthz`);
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
      await client.connect(transport as never);

      const tools = await client.listTools();
      const statusResult = await client.callTool({
        name: 'mesh_get_status',
        arguments: {}
      });
      const status = JSON.parse(readTextToolResult(statusResult));
      const captureResult = await client.callTool({
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          title: 'Local proxy captures knowledge',
          summary: 'The local proxy should persist MCP capture calls into the current project store.',
          layer: 'canonical',
          tags: ['mcp', 'proxy']
        }
      });
      const captured = JSON.parse(readTextToolResult(captureResult));
      const getResult = await client.callTool({
        name: 'mesh_get_knowledge',
        arguments: {
          id: captured.id
        }
      });
      const fetched = JSON.parse(readTextToolResult(getResult));
      const listResult = await client.callTool({
        name: 'mesh_list_knowledge',
        arguments: {
          layers: ['canonical'],
          limit: 5
        }
      });
      const listed = JSON.parse(readTextToolResult(listResult));
      const previousCaptureResult = await client.callTool({
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          title: 'Previous local proxy graph decision',
          summary: 'This older item should be linked from the newer capture.',
          layer: 'canonical',
          tags: ['mcp', 'proxy']
        }
      });
      const previous = JSON.parse(readTextToolResult(previousCaptureResult));
      const linkResult = await client.callTool({
        name: 'mesh_link_knowledge',
        arguments: {
          kind: 'supersedes',
          fromId: captured.id,
          toId: previous.id,
          reason: 'The newer local proxy decision supersedes the older one.'
        }
      });
      const linked = JSON.parse(readTextToolResult(linkResult));
      const searchResult = await client.callTool({
        name: 'mesh_search_context',
        arguments: {
          query: 'local proxy',
          layers: ['canonical']
        }
      });
      const contextPack = JSON.parse(readTextToolResult(searchResult));
      const graphResult = await client.callTool({
        name: 'mesh_explore_knowledge_graph',
        arguments: {
          ids: [captured.id],
          depth: 1,
          edgeKinds: ['supersedes']
        }
      });
      const graph = JSON.parse(readTextToolResult(graphResult));
      const updateResult = await client.callTool({
        name: 'mesh_update_knowledge',
        arguments: {
          id: captured.id,
          summary: 'The local proxy should persist and update MCP knowledge calls.',
          tags: ['mcp', 'proxy', 'crud'],
          reason: 'Exercise MCP knowledge update.'
        }
      });
      const updated = JSON.parse(readTextToolResult(updateResult));
      const deleteResult = await client.callTool({
        name: 'mesh_delete_knowledge',
        arguments: {
          id: previous.id,
          reason: 'Exercise MCP knowledge tombstones.'
        }
      });
      const deleted = JSON.parse(readTextToolResult(deleteResult));
      const knowledgeJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'canonical', 'entries.jsonl'),
        'utf8'
      );
      const usageJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'usage', `${contextPack.generatedAt.slice(0, 7)}.jsonl`),
        'utf8'
      );
      const edgesJsonl = await readFile(join(projectRoot, '.dev-mesh', 'knowledge', 'edges.jsonl'), 'utf8');

      expect(health.body).toMatchObject({
        status: 'ok',
        service: 'devmesh-local-proxy',
        version: DEV_MESH_VERSION,
        projectRoot,
        mcpUrl: `${url}/mcp`
      });
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'mesh_search_context',
          'mesh_get_status',
          'mesh_get_knowledge',
          'mesh_list_knowledge',
          'mesh_capture_knowledge',
          'mesh_update_knowledge',
          'mesh_delete_knowledge',
          'mesh_capture_task',
          'mesh_rate_knowledge',
          'mesh_link_knowledge',
          'mesh_search_member_experience',
          'mesh_resolve_term',
          'mesh_scan_project_knowledge',
          'mesh_explore_knowledge_graph'
        ])
      );
      expect(captured).toMatchObject({
        title: 'Local proxy captures knowledge',
        layer: 'canonical',
        tags: ['mcp', 'proxy'],
        createdBy: {
          displayName: 'Xiaoyun'
        },
        event: {
          kind: 'knowledge.captured',
          payload: {
            knowledgeId: captured.id
          }
        }
      });
      expect(fetched).toMatchObject({
        id: captured.id,
        title: 'Local proxy captures knowledge'
      });
      expect(listed.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: captured.id
          })
        ])
      );
      expect(status).toMatchObject({
        service: 'devmesh',
        version: DEV_MESH_VERSION,
        mode: 'local-only',
        projectRoot,
        storeRoot: join(projectRoot, '.dev-mesh')
      });
      expect(contextPack.query).toBe('local proxy');
      expect(contextPack.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: captured.id,
            title: 'Local proxy captures knowledge'
          })
        ])
      );
      expect(linked).toMatchObject({
        edge: {
          kind: 'supersedes',
          fromId: captured.id,
          toId: previous.id,
          createdBy: {
            displayName: 'Xiaoyun'
          }
        },
        event: {
          kind: 'knowledge.edge.created'
        }
      });
      expect(graph.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `knowledge:${captured.id}`,
            kind: 'knowledge'
          }),
          expect.objectContaining({
            id: `knowledge:${previous.id}`,
            kind: 'knowledge'
          })
        ])
      );
      expect(graph.edges.map((edge: { kind: string }) => edge.kind)).toEqual(
        expect.arrayContaining(['supersedes'])
      );
      expect(updated).toMatchObject({
        id: captured.id,
        summary: 'The local proxy should persist and update MCP knowledge calls.',
        tags: ['mcp', 'proxy', 'crud'],
        event: {
          kind: 'knowledge.updated'
        }
      });
      expect(deleted).toMatchObject({
        id: previous.id,
        status: 'tombstone',
        event: {
          kind: 'knowledge.deleted'
        }
      });
      expect(knowledgeJsonl).toContain('"title":"Local proxy captures knowledge"');
      expect(knowledgeJsonl).toContain('"status":"tombstone"');
      expect(edgesJsonl).toContain('"kind":"supersedes"');
      expect(edgesJsonl).toContain(`"fromId":"${captured.id}"`);
      expect(usageJsonl).toContain('"kind":"context_pack.hit"');
      expect(usageJsonl).toContain(`"knowledgeId":"${captured.id}"`);
      expect(usageJsonl).toContain('"query":"local proxy"');
    } finally {
      await client.close().catch(() => undefined);
      await proxy.close();
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('initializes the project store when an MCP session starts', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-local-proxy-auto-init-'));
    const proxy = await createLocalMcpProxy({
      projectRoot,
      memberName: 'Xiaoyun'
    });
    const url = await proxy.listen({
      host: '127.0.0.1',
      port: 0
    });
    const client = new Client({
      name: 'dev-mesh-local-proxy-auto-init-test',
      version: '0.1.0'
    });

    try {
      await expect(stat(join(projectRoot, '.dev-mesh'))).rejects.toMatchObject({
        code: 'ENOENT'
      });

      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
      await client.connect(transport as never);
      await client.listTools();

      await expect(readFile(join(projectRoot, '.dev-mesh', 'config.toml'), 'utf8')).resolves.toContain(
        'auto_init = true'
      );
    } finally {
      await client.close().catch(() => undefined);
      await proxy.close();
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

async function requestJson<T = any>(url: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url);
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
