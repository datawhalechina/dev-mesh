import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDmx } from './run-dmx.js';

describe('dmx doctor', () => {
  it('prints actionable diagnostics for a project and global root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-cli-doctor-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-cli-doctor-global-'));

    try {
      const result = await runDmx(['doctor', '--root', projectRoot, '--global-root', globalRoot]);
      const output = JSON.parse(result.stdout) as DoctorCliOutput;

      expect(output).toMatchObject({
        projectRoot,
        globalRoot,
        summary: {
          error: 0
        }
      });
      expect(output.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'store',
            status: 'ok'
          }),
          expect.objectContaining({
            category: 'privacy',
            status: 'ok'
          }),
          expect.objectContaining({
            category: 'sync',
            status: 'ok'
          }),
          expect.objectContaining({
            category: 'adapter',
            status: 'warn',
            fixHint: expect.any(String)
          })
        ])
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  }, 30000);
});

interface DoctorCliOutput {
  projectRoot: string;
  globalRoot: string;
  summary: {
    ok: number;
    warn: number;
    error: number;
  };
  checks: Array<{
    id: string;
    category: string;
    status: string;
    message: string;
    fixHint?: string;
  }>;
}
