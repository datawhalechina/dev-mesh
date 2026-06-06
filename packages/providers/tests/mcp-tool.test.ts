import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMcpToolCallCaptureProvider } from '../src/index.js';

describe('createMcpToolCallCaptureProvider', () => {
  it('normalizes MCP tool calls without storing argument values or result text', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-provider-mcp-tool-'));
    const provider = createMcpToolCallCaptureProvider({
      now: () => new Date('2026-06-06T10:00:00.000Z')
    });

    try {
      await expect(provider.detect(projectRoot)).resolves.toBe(true);

      const events = await collect(
        provider.collect({
          projectRoot,
          metadata: {
            mcpToolCalls: [
              {
                toolName: 'mesh_search_context',
                arguments: {
                  limit: 8,
                  query: 'auth secret query'
                },
                result: {
                  content: [
                    {
                      type: 'text',
                      text: 'This is returned context that should not be stored verbatim.'
                    }
                  ]
                },
                durationMs: 28,
                status: 'succeeded'
              },
              {
                name: 'mesh_capture_knowledge',
                args: {
                  summary: 'do not store this summary value',
                  token: 'super-secret-token'
                },
                error: {
                  code: 'E_AUTH',
                  message: 'Authorization: Bearer super-secret-token failed for https://example.test?api_key=abc123'
                },
                success: false
              }
            ]
          }
        })
      );

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        id: 'raw_mcp_tool_20260606T100000000Z_0',
        kind: 'mcp.tool_call',
        payload: {
          toolName: 'mesh_search_context',
          status: 'succeeded',
          failed: false,
          argumentKeys: ['limit', 'query'],
          durationMs: 28,
          result: {
            kind: 'mcp-content',
            contentItems: 1,
            contentTypes: ['text'],
            textChars: 60
          }
        }
      });
      expect(events[1]).toMatchObject({
        id: 'raw_mcp_tool_20260606T100000000Z_1',
        kind: 'mcp.tool_call',
        payload: {
          toolName: 'mesh_capture_knowledge',
          status: 'failed',
          failed: true,
          argumentKeys: ['summary', 'token'],
          error: {
            code: 'E_AUTH',
            message:
              'Authorization: Bearer [REDACTED:authorization] failed for https://example.test?api_key=[REDACTED:url-token]'
          }
        }
      });
      expect(events[0]?.summary).toContain('MCP tool mesh_search_context succeeded in 28ms');
      expect(events[1]?.summary).toContain('MCP tool mesh_capture_knowledge failed');
      expect(JSON.stringify(events)).not.toContain('auth secret query');
      expect(JSON.stringify(events)).not.toContain('do not store this summary value');
      expect(JSON.stringify(events)).not.toContain('super-secret-token');
      expect(JSON.stringify(events)).not.toContain('returned context');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('yields no events when metadata has no tool calls', async () => {
    const provider = createMcpToolCallCaptureProvider({
      now: () => new Date('2026-06-06T10:00:00.000Z')
    });

    await expect(collect(provider.collect({ projectRoot: process.cwd() }))).resolves.toEqual([]);
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const item of items) {
    result.push(item);
  }

  return result;
}
