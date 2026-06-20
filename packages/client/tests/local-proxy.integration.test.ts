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
      const statusText = readTextToolResult(statusResult);
      const projectionStatusResult = await client.callTool({
        name: 'mesh_projection_status',
        arguments: {}
      });
      const projectionStatusText = readTextToolResult(projectionStatusResult);
      const branchListResult = await client.callTool({
        name: 'mesh_branch_list',
        arguments: {}
      });
      const branchListText = readTextToolResult(branchListResult);
      const branchCreateResult = await client.callTool({
        name: 'mesh_branch_create',
        arguments: {
          name: 'frontend',
          policy: 'frontend_design',
          base: 'shared'
        }
      });
      const branchCreateText = readTextToolResult(branchCreateResult);
      const branchSwitchResult = await client.callTool({
        name: 'mesh_branch_switch',
        arguments: {
          name: 'frontend',
          policy: 'balanced'
        }
      });
      const branchSwitchText = readTextToolResult(branchSwitchResult);
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
      const captureText = readTextToolResult(captureResult);
      const capturedId = readRequiredField(captureText, 'id');
      const getResult = await client.callTool({
        name: 'mesh_get_knowledge',
        arguments: {
          id: capturedId
        }
      });
      const fetchedText = readTextToolResult(getResult);
      const listResult = await client.callTool({
        name: 'mesh_list_knowledge',
        arguments: {
          layers: ['canonical'],
          limit: 5
        }
      });
      const listedText = readTextToolResult(listResult);
      const mainBranchListResult = await client.callTool({
        name: 'mesh_list_knowledge',
        arguments: {
          branch: 'main',
          layers: ['canonical'],
          limit: 5
        }
      });
      const mainBranchListText = readTextToolResult(mainBranchListResult);
      const frontendBranchListResult = await client.callTool({
        name: 'mesh_list_knowledge',
        arguments: {
          branch: 'frontend',
          layers: ['canonical'],
          limit: 5
        }
      });
      const frontendBranchListText = readTextToolResult(frontendBranchListResult);
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
      const previousText = readTextToolResult(previousCaptureResult);
      const previousId = readRequiredField(previousText, 'id');
      const branchPolicyResult = await client.callTool({
        name: 'mesh_branch_policy',
        arguments: {
          policy: 'durable_only'
        }
      });
      const branchPolicyText = readTextToolResult(branchPolicyResult);
      const linkResult = await client.callTool({
        name: 'mesh_link_knowledge',
        arguments: {
          kind: 'supersedes',
          fromId: capturedId,
          toId: previousId,
          reason: 'The newer local proxy decision supersedes the older one.'
        }
      });
      const linkedText = readTextToolResult(linkResult);
      const searchResult = await client.callTool({
        name: 'mesh_search_context',
        arguments: {
          query: 'local proxy',
          layers: ['canonical']
        }
      });
      const contextText = readTextToolResult(searchResult);
      const contextGeneratedAt = readRequiredField(contextText, 'generatedAt');
      const mainBranchSearchResult = await client.callTool({
        name: 'mesh_search_context',
        arguments: {
          branch: 'main',
          query: 'local proxy',
          layers: ['canonical']
        }
      });
      const mainBranchContextText = readTextToolResult(mainBranchSearchResult);
      const frontendBranchSearchResult = await client.callTool({
        name: 'mesh_search_context',
        arguments: {
          branch: 'frontend',
          query: 'local proxy',
          layers: ['canonical']
        }
      });
      const frontendBranchContextText = readTextToolResult(frontendBranchSearchResult);
      const graphResult = await client.callTool({
        name: 'mesh_explore_knowledge_graph',
        arguments: {
          ids: [capturedId],
          depth: 1,
          edgeKinds: ['supersedes']
        }
      });
      const graphText = readTextToolResult(graphResult);
      const mainBranchGraphResult = await client.callTool({
        name: 'mesh_explore_knowledge_graph',
        arguments: {
          branch: 'main',
          query: 'local proxy',
          depth: 1
        }
      });
      const mainBranchGraphText = readTextToolResult(mainBranchGraphResult);
      const frontendBranchGraphResult = await client.callTool({
        name: 'mesh_explore_knowledge_graph',
        arguments: {
          branch: 'frontend',
          query: 'local proxy',
          depth: 1
        }
      });
      const frontendBranchGraphText = readTextToolResult(frontendBranchGraphResult);
      const updateResult = await client.callTool({
        name: 'mesh_update_knowledge',
        arguments: {
          id: capturedId,
          summary: 'The local proxy should persist and update MCP knowledge calls.',
          tags: ['mcp', 'proxy', 'crud'],
          reason: 'Exercise MCP knowledge update.'
        }
      });
      const updatedText = readTextToolResult(updateResult);
      const deleteResult = await client.callTool({
        name: 'mesh_delete_knowledge',
        arguments: {
          id: previousId,
          reason: 'Exercise MCP knowledge tombstones.'
        }
      });
      const deletedText = readTextToolResult(deleteResult);
      const projectionRebuildResult = await client.callTool({
        name: 'mesh_projection_rebuild',
        arguments: {}
      });
      const projectionRebuildText = readTextToolResult(projectionRebuildResult);
      const knowledgeJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'canonical', 'entries.jsonl'),
        'utf8'
      );
      const usageJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'usage', `${contextGeneratedAt.slice(0, 7)}.jsonl`),
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
          'mesh_projection_status',
          'mesh_projection_rebuild',
          'mesh_branch_list',
          'mesh_branch_create',
          'mesh_branch_switch',
          'mesh_branch_policy',
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
      expect(captureText).toContain('Captured knowledge');
      expect(captureText).toContain('title: Local proxy captures knowledge');
      expect(captureText).toContain('layer: canonical');
      expect(captureText).toContain('tags: mcp, proxy');
      expect(fetchedText).toContain(`id: ${capturedId}`);
      expect(fetchedText).toContain('title: Local proxy captures knowledge');
      expect(listedText).toContain(`id=${capturedId}`);
      expect(mainBranchListText).toContain('items: 0');
      expect(mainBranchListText).not.toContain(capturedId);
      expect(frontendBranchListText).toContain(`id=${capturedId}`);
      expect(statusText).toContain('service: devmesh');
      expect(statusText).toContain(`version: ${DEV_MESH_VERSION}`);
      expect(statusText).toContain('mode: local-only');
      expect(statusText).toContain('activeBranch: main');
      expect(statusText).toContain(`projectRoot: ${projectRoot}`);
      expect(statusText).toContain(`storeRoot: ${join(projectRoot, '.dev-mesh')}`);
      expect(projectionStatusText).toContain('Projection status');
      expect(projectionStatusText).toContain('state:');
      expect(branchListText).toContain('Knowledge branches');
      expect(branchListText).toContain('* main');
      expect(branchListText).toContain('policy=balanced');
      expect(branchCreateText).toContain('frontend');
      expect(branchCreateText).toContain('policy=frontend_design');
      expect(branchCreateText).toContain('shared');
      expect(branchCreateText).toContain('base=true');
      expect(branchSwitchText).toContain('active: frontend');
      expect(branchSwitchText).toContain('* frontend');
      expect(branchPolicyText).toContain('* frontend');
      expect(branchPolicyText).toContain('policy=durable_only');
      expect(contextText).toContain('query: local proxy');
      expect(contextText).toContain(`id=${capturedId}`);
      expect(contextText).toContain('Local proxy captures knowledge');
      expect(mainBranchContextText).toContain('items: 0');
      expect(mainBranchContextText).not.toContain(capturedId);
      expect(frontendBranchContextText).toContain(`id=${capturedId}`);
      expect(linkedText).toContain('Linked knowledge');
      expect(linkedText).toContain('kind: supersedes');
      expect(linkedText).toContain(`fromId: ${capturedId}`);
      expect(linkedText).toContain(`toId: ${previousId}`);
      expect(linkedText).toContain('event: kind=knowledge.edge.created');
      expect(graphText).toContain(`node id=knowledge:${capturedId}`);
      expect(graphText).toContain(`node id=knowledge:${previousId}`);
      expect(graphText).toContain('edge kind=supersedes');
      expect(mainBranchGraphText).toContain('nodes: 0');
      expect(mainBranchGraphText).not.toContain(capturedId);
      expect(frontendBranchGraphText).toContain(`node id=knowledge:${capturedId}`);
      expect(updatedText).toContain(`id: ${capturedId}`);
      expect(updatedText).toContain('summary: The local proxy should persist and update MCP knowledge calls.');
      expect(updatedText).toContain('tags: mcp, proxy, crud');
      expect(updatedText).toContain('event: kind=knowledge.updated');
      expect(deletedText).toContain(`id: ${previousId}`);
      expect(deletedText).toContain('status: tombstone');
      expect(deletedText).toContain('event: kind=knowledge.deleted');
      expect(projectionRebuildText).toContain('Projection rebuilt');
      expect(projectionRebuildText).toContain('documents:');
      expect(knowledgeJsonl).toContain('"title":"Local proxy captures knowledge"');
      expect(knowledgeJsonl).toContain('"branch":"frontend"');
      expect(knowledgeJsonl).toContain('"status":"tombstone"');
      expect(edgesJsonl).toContain('"kind":"supersedes"');
      expect(edgesJsonl).toContain(`"fromId":"${capturedId}"`);
      expect(usageJsonl).toContain('"kind":"context_pack.hit"');
      expect(usageJsonl).toContain(`"knowledgeId":"${capturedId}"`);
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

function readRequiredField(text: string, field: string): string {
  const match = text.match(new RegExp(`^${field}: (.+)$`, 'm'));

  if (match?.[1] === undefined) {
    throw new Error(`Expected field ${field} in tool result:\n${text}`);
  }

  return match[1];
}
