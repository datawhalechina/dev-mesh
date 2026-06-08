import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createDevMeshClientRuntime } from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('project knowledge scan', () => {
  it('returns a project-wide scan package for assistants to summarize', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-project-scan-'));

    try {
      await execFileAsync('git', ['init'], { cwd: projectRoot });
      await writeFile(join(projectRoot, 'README.md'), '# Project\n', 'utf8');
      await writeFile(join(projectRoot, 'src.ts'), 'export const value = 1;\n', 'utf8');
      await writeFile(join(projectRoot, 'notes.md'), 'TODO: summarize the repo.\n', 'utf8');

      const runtime = createDevMeshClientRuntime({ projectRoot });
      const result = (await runtime.scanProjectKnowledge({ limit: 10 })) as {
        instruction: string;
        highlights: { changedFiles: string[]; fileCount: number; todoFiles: string[] };
        signals: Array<{ kind: string; summary: string }>;
      };

      expect(result.instruction).toContain('mesh_capture_knowledge');
      expect(result.signals.map((signal) => signal.kind)).toEqual(
        expect.arrayContaining(['git.snapshot', 'filesystem.snapshot'])
      );
      expect(result.highlights.changedFiles).toEqual(expect.arrayContaining(['README.md', 'src.ts', 'notes.md']));
      expect(result.highlights.todoFiles).toContain('notes.md');
      expect(result.highlights.fileCount).toBeGreaterThan(0);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});
