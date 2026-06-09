import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createGitProjectScanProvider } from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('createGitProjectScanProvider', () => {
  it('detects git repositories and collects a structured git project scan record', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-provider-git-'));
    const provider = createGitProjectScanProvider({
      now: () => new Date('2026-06-06T10:00:00.000Z')
    });

    try {
      await git(projectRoot, ['init']);
      await git(projectRoot, ['config', 'user.email', 'devmesh@example.test']);
      await git(projectRoot, ['config', 'user.name', 'DevMesh']);
      await writeFile(join(projectRoot, 'README.md'), '# Test\n', 'utf8');
      await git(projectRoot, ['add', 'README.md']);
      await git(projectRoot, ['commit', '-m', 'ABC-123 initial commit']);
      await git(projectRoot, ['checkout', '-b', 'feature/ABC-123-context-capture']);
      await writeFile(join(projectRoot, 'README.md'), '# Test\n\nMore context.\n', 'utf8');

      await expect(provider.detect(projectRoot)).resolves.toBe(true);

      const events = await collect(provider.collect({
        projectRoot,
        metadata: {
          testCommand: 'pnpm test:unit',
          testPassed: true,
          testSummary: '37 tests passed'
        }
      }));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: 'scan_git_20260606T100000000Z',
        kind: 'git.snapshot',
        createdAt: '2026-06-06T10:00:00.000Z',
        source: {
          kind: 'git',
          projectRoot
        },
        payload: {
          branch: 'feature/ABC-123-context-capture',
          headSubject: 'ABC-123 initial commit',
          issueKeys: ['ABC-123'],
          testResult: {
            command: 'pnpm test:unit',
            passed: true,
            summary: '37 tests passed'
          },
          changedFiles: [
            expect.objectContaining({
              path: 'README.md',
              status: 'M',
              additions: 2
            })
          ]
        }
      });
      expect(events[0]?.summary).toContain('Git snapshot on feature/ABC-123-context-capture');
      expect(events[0]?.summary).toContain('tests passed (pnpm test:unit)');
      expect((events[0]?.payload?.headCommit as string | undefined)).toMatch(/^[0-9a-f]{40}$/);
      expect(events[0]?.payload?.diffStat).toContain('README.md');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not detect non-git directories', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-provider-not-git-'));
    const provider = createGitProjectScanProvider();

    try {
      await expect(provider.detect(projectRoot)).resolves.toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

async function git(projectRoot: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', projectRoot, ...args]);
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const item of items) {
    result.push(item);
  }

  return result;
}
