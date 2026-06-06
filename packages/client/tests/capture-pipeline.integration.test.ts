import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpToolCallCaptureProvider } from '@mcp-dev-mesh/providers';
import { describe, expect, it } from 'vitest';
import { createDevMeshClientRuntime } from '../src/index.js';

describe('client capture pipeline', () => {
  it('routes provider raw events through extractor into auto-publish or inbox review', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-capture-pipeline-'));
    const runtime = createDevMeshClientRuntime({
      projectRoot,
      memberName: 'Xiaoyun'
    });
    const provider = createMcpToolCallCaptureProvider({
      now: () => new Date('2026-06-06T10:00:00.000Z')
    });

    try {
      const rawEvents = await collect(
        provider.collect({
          projectRoot,
          metadata: {
            mcpToolCalls: [
              {
                toolName: 'mesh_search_context',
                arguments: {
                  query: 'auth context'
                },
                result: {
                  content: [
                    {
                      type: 'text',
                      text: 'returned context should not be stored by provider'
                    }
                  ]
                },
                status: 'succeeded'
              },
              {
                toolName: 'mesh_capture_knowledge',
                arguments: {
                  token: 'super-secret-token'
                },
                error: {
                  message: 'Authorization: Bearer super-secret-token'
                },
                status: 'failed'
              }
            ]
          }
        })
      );

      const published = await runtime.captureRawEvent(rawEvents[0]!);
      const queued = await runtime.captureRawEvent(rawEvents[1]!);
      const highRisk = await runtime.publishExtractProposal({
        type: 'pitfall',
        title: 'High-risk extraction requires review',
        summary: 'Security-sensitive automatic extraction must enter the inbox.',
        metadata: {
          risk: 'high',
          sourceEventKind: 'test'
        }
      });
      const inbox = await runtime.listInbox();
      const items = await runtime.core.listKnowledge({ includeSuperseded: true });
      const eventsJsonl = await readAllEvents(projectRoot);
      const extractJsonl = await readFile(join(projectRoot, '.dev-mesh', 'knowledge', 'extract', 'entries.jsonl'), 'utf8');

      expect(published.results).toHaveLength(1);
      expect(published.results[0]).toMatchObject({
        decision: 'published',
        proposal: {
          type: 'command',
          title: 'MCP tool mesh_search_context succeeded'
        }
      });
      expect(queued.results).toHaveLength(1);
      expect(queued.results[0]).toMatchObject({
        decision: 'queued',
        queueItem: {
          risk: 'medium',
          reason: 'medium-risk automatic extraction from mcp.tool_call.'
        }
      });
      expect(highRisk).toMatchObject({
        decision: 'queued',
        queueItem: {
          risk: 'high',
          reason: 'high-risk automatic extraction from test.'
        }
      });
      expect(inbox.map((item) => item.risk).sort()).toEqual(['high', 'medium']);
      expect(items.map((item) => item.title)).toContain('MCP tool mesh_search_context succeeded');
      expect(eventsJsonl).toContain('"kind":"raw.captured"');
      expect(eventsJsonl).toContain('"kind":"knowledge.captured"');
      expect(eventsJsonl).toContain('"mcp.tool_call"');
      expect(extractJsonl).toContain('"title":"MCP tool mesh_search_context succeeded"');
      expect(eventsJsonl).not.toContain('super-secret-token');
      expect(extractJsonl).not.toContain('returned context should not be stored');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

async function readAllEvents(projectRoot: string): Promise<string> {
  const eventsDir = join(projectRoot, '.dev-mesh', 'events');
  const files = await readdir(eventsDir);
  const chunks = await Promise.all(files.map((file) => readFile(join(eventsDir, file), 'utf8')));

  return chunks.join('\n');
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const item of items) {
    result.push(item);
  }

  return result;
}
