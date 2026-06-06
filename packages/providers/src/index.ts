import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureContext, CaptureProvider, RawEvent } from '@mcp-dev-mesh/extension-api';

export function createGitCaptureProvider(): CaptureProvider {
  return {
    id: 'dev-mesh.provider.git',
    kind: 'capture-provider',
    capabilities: ['capture.git'],
    priority: 50,
    async detect(projectRoot: string) {
      try {
        await access(join(projectRoot, '.git'));
        return true;
      } catch {
        return false;
      }
    },
    async *collect(ctx: CaptureContext): AsyncIterable<RawEvent> {
      yield {
        id: `raw_${Date.now().toString(36)}`,
        kind: 'git_snapshot',
        summary: 'Git capture provider scaffold detected a project collection request.',
        createdAt: new Date().toISOString(),
        source: {
          kind: 'git',
          projectRoot: ctx.projectRoot
        }
      };
    }
  };
}

export function createBuiltInProviders(): CaptureProvider[] {
  return [createGitCaptureProvider()];
}
