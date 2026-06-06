import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initGlobalConfig, runDevMeshDoctor } from '../src/index.js';

describe('runDevMeshDoctor', () => {
  it('checks store, sync, privacy, and adapters', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-global-'));

    try {
      await initGlobalConfig('Xiaoyun', {
        globalRoot,
        tools: ['codex']
      });

      const result = await runDevMeshDoctor({
        projectRoot,
        globalRoot
      });

      expect(result.projectRoot).toBe(projectRoot);
      expect(result.globalRoot).toBe(globalRoot);
      expect(result.summary.ok).toBeGreaterThan(0);
      expect(result.summary.warn).toBeGreaterThan(0);
      expect(result.summary.error).toBe(0);
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'store.project',
            category: 'store',
            status: 'ok'
          }),
          expect.objectContaining({
            id: 'privacy.redaction',
            category: 'privacy',
            status: 'ok'
          }),
          expect.objectContaining({
            id: 'sync.identity',
            category: 'sync',
            status: 'ok'
          }),
          expect.objectContaining({
            id: 'adapter.codex.detect',
            category: 'adapter',
            status: 'warn'
          })
        ])
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('warns when privacy and sync settings are risky', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-global-'));

    try {
      await runDevMeshDoctor({
        projectRoot,
        globalRoot
      });

      const configPath = join(projectRoot, '.dev-mesh', 'config.toml');
      const config = await readFile(configPath, 'utf8');

      await writeFile(
        configPath,
        config
          .replace('auto_sync = false', 'auto_sync = true')
          .replace('redaction_enabled = true', 'redaction_enabled = false')
          .replace('upload_raw_transcripts = false', 'upload_raw_transcripts = true'),
        'utf8'
      );

      const result = await runDevMeshDoctor({
        projectRoot,
        globalRoot
      });

      expect(result.summary.error).toBeGreaterThan(0);
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'privacy.redaction',
            status: 'error',
            fixHint: expect.stringContaining('redaction_enabled')
          }),
          expect.objectContaining({
            id: 'privacy.raw-transcripts',
            status: 'warn',
            fixHint: expect.stringContaining('upload_raw_transcripts')
          }),
          expect.objectContaining({
            id: 'sync.identity',
            status: 'warn',
            fixHint: expect.stringContaining('dmx join')
          })
        ])
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });
});
