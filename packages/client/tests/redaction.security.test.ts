import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevMeshClientRuntime } from '../src/index.js';

describe('client capture redaction', () => {
  it('redacts sensitive content before writing knowledge JSONL', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-redaction-'));

    try {
      const runtime = createDevMeshClientRuntime({
        projectRoot,
        memberName: 'Xiaoyun'
      });
      await runtime.captureKnowledge({
        type: 'pitfall',
        title: 'Do not paste Authorization: Bearer token-secret',
        summary: 'The callback URL contained https://example.test?token=secret-token',
        content: 'Load .env.local and DATABASE_PASSWORD=super-secret only locally.',
        source: {
          kind: 'manual',
          url: 'https://example.test/path?api_key=hidden-key'
        }
      });

      const jsonl = await readFile(join(projectRoot, '.dev-mesh', 'knowledge', 'extract', 'entries.jsonl'), 'utf8');

      expect(jsonl).toContain('[REDACTED:authorization]');
      expect(jsonl).toContain('token=[REDACTED:url-token]');
      expect(jsonl).toContain('[REDACTED:sensitive-path]');
      expect(jsonl).toContain('DATABASE_PASSWORD=[REDACTED:env-secret]');
      expect(jsonl).toContain('api_key=[REDACTED:url-token]');
      expect(jsonl).not.toContain('token-secret');
      expect(jsonl).not.toContain('secret-token');
      expect(jsonl).not.toContain('super-secret');
      expect(jsonl).not.toContain('hidden-key');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
