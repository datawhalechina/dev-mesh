import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureProvider, RawEvent } from '@mcp-dev-mesh/extension-api';
import { describe, expect, it } from 'vitest';
import { createDevMeshClientRuntime } from '../src/index.js';
import { runDaemonAutoCaptureOnce } from '../src/daemon-auto-capture.js';

describe('daemon auto capture', () => {
  it('captures development signals for MCP hosts to summarize', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-auto-capture-'));
    const provider = createStaticProvider({
      id: 'raw_dev_signal_1',
      kind: 'filesystem.snapshot',
      summary: 'Filesystem snapshot: 1 file observed.',
      createdAt: '2026-06-08T00:00:00.000Z',
      payload: {
        files: [
          {
            path: 'src/app.ts',
            event: 'modified',
            size: 120,
            mtime: '2026-06-08T00:00:00.000Z',
            category: 'source'
          }
        ],
        ignored: {},
        policy: {},
        truncated: false
      }
    });

    try {
      const first = await runDaemonAutoCaptureOnce({
        projectRoot,
        providers: [provider],
        now: () => new Date('2026-06-08T00:00:01.000Z')
      });
      const second = await runDaemonAutoCaptureOnce({
        projectRoot,
        providers: [provider],
        now: () => new Date('2026-06-08T00:00:02.000Z')
      });
      const runtime = createDevMeshClientRuntime({ projectRoot });
      const signals = (await runtime.listDevelopmentSignals({ limit: 5 })) as {
        instruction: string;
        signals: Array<{ rawEvent: RawEvent; instruction?: string }>;
      };
      const events = await readAllEvents(projectRoot);
      const extractEntries = await readFile(join(projectRoot, '.dev-mesh', 'knowledge', 'extract', 'entries.jsonl'), 'utf8');

      expect(first).toMatchObject({
        enabled: true,
        collectedEvents: 1,
        capturedEvents: 1,
        skippedEvents: 0
      });
      expect(second).toMatchObject({
        collectedEvents: 1,
        capturedEvents: 0,
        skippedEvents: 1
      });
      expect(events).toContain('"kind":"raw.captured"');
      expect(events).toContain('"mode":"mcp-host"');
      expect(extractEntries).not.toContain('Workspace file activity');
      expect(signals.instruction).toContain('mesh_capture_knowledge');
      expect(signals.signals).toHaveLength(1);
      expect(signals.signals[0]?.rawEvent).toMatchObject({
        kind: 'filesystem.snapshot',
        summary: 'Filesystem snapshot: 1 file observed.'
      });
      expect(signals.signals[0]?.instruction).toContain('mesh_capture_knowledge');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

function createStaticProvider(event: RawEvent): CaptureProvider {
  return {
    id: 'dev-mesh.provider.test-static',
    kind: 'capture-provider',
    capabilities: ['capture.filesystem'],
    priority: 1,
    async detect() {
      return true;
    },
    async *collect() {
      yield event;
    }
  };
}

async function readAllEvents(projectRoot: string): Promise<string> {
  const eventsDir = join(projectRoot, '.dev-mesh', 'events');
  const files = await readdir(eventsDir);
  const chunks = await Promise.all(files.map((file) => readFile(join(eventsDir, file), 'utf8')));

  return chunks.join('\n');
}
