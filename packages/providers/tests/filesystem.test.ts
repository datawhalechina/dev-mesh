import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileSystemProjectScanProvider } from '../src/index.js';

describe('createFileSystemProjectScanProvider', () => {
  it('collects file metadata while filtering .meshignore and sensitive paths', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-provider-files-'));
    const observedAt = new Date('2026-06-06T10:00:00.000Z');
    const since = new Date('2026-06-06T09:00:00.000Z');
    const old = new Date('2026-06-06T08:00:00.000Z');
    const provider = createFileSystemProjectScanProvider({
      now: () => observedAt
    });

    try {
      await writeProjectFile(projectRoot, '.meshignore', 'generated/**\nnotes/private.md\n', observedAt);
      await writeProjectFile(projectRoot, 'src/app.ts', 'const value = 1; // TODO wire provider\n// FIXME retry later\n', observedAt);
      await writeProjectFile(projectRoot, 'docs/guide.md', '# Guide\n', observedAt);
      await writeProjectFile(projectRoot, 'generated/skip.ts', 'const ignored = true;\n', observedAt);
      await writeProjectFile(projectRoot, 'notes/private.md', 'private note\n', observedAt);
      await writeProjectFile(projectRoot, '.env.local', 'TOKEN=secret\n', observedAt);
      await writeProjectFile(projectRoot, 'cert.pem', '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n', observedAt);
      await writeProjectFile(projectRoot, 'secrets/token.txt', 'secret\n', observedAt);
      await writeProjectFile(projectRoot, 'old.md', 'TODO old note\n', old);

      await expect(provider.detect(projectRoot)).resolves.toBe(true);

      const events = await collect(provider.collect({ projectRoot, since: since.toISOString() }));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: 'scan_fs_20260606T100000000Z',
        kind: 'filesystem.snapshot',
        createdAt: observedAt.toISOString(),
        source: {
          kind: 'filesystem',
          projectRoot
        }
      });

      const payload = events[0]?.payload as {
        files: Array<{
          category: string;
          extension?: string;
          markers?: { fixme?: number; todo?: number };
          path: string;
        }>;
        ignored: Record<string, number>;
        policy: Record<string, number>;
        truncated: boolean;
      };
      const paths = payload.files.map((file) => file.path);

      expect(paths).toEqual(expect.arrayContaining(['.meshignore', 'docs/guide.md', 'src/app.ts']));
      expect(paths).not.toEqual(expect.arrayContaining(['.env.local', 'cert.pem', 'generated/skip.ts', 'notes/private.md', 'old.md', 'secrets/token.txt']));
      expect(payload.files.find((file) => file.path === 'src/app.ts')).toMatchObject({
        category: 'source',
        extension: '.ts',
        markers: {
          fixme: 1,
          todo: 1
        }
      });
      expect(payload.files.find((file) => file.path === 'docs/guide.md')).toMatchObject({
        category: 'docs',
        extension: '.md'
      });
      expect(payload.ignored.privacy).toBeGreaterThanOrEqual(3);
      expect(payload.ignored.meshignore).toBeGreaterThanOrEqual(2);
      expect(payload.policy.meshignoreRules).toBe(2);
      expect(payload.truncated).toBe(false);
      expect(events[0]?.summary).toContain('Filesystem snapshot since 2026-06-06T09:00:00.000Z');
      expect(events[0]?.summary).toContain('TODO/FIXME markers: 1 TODO, 1 FIXME');
      expect(JSON.stringify(events[0])).not.toContain('TOKEN=secret');
      expect(JSON.stringify(events[0])).not.toContain('BEGIN PRIVATE KEY');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not detect missing project roots', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-provider-files-missing-'));
    const provider = createFileSystemProjectScanProvider();

    try {
      await expect(provider.detect(join(projectRoot, 'missing'))).resolves.toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

async function writeProjectFile(projectRoot: string, relativePath: string, content: string, mtime: Date): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
  await utimes(absolutePath, mtime, mtime);
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const item of items) {
    result.push(item);
  }

  return result;
}
