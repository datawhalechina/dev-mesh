import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initGlobalConfig, runDevMeshDoctor } from '../src/index.js';

describe('runDevMeshDoctor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('checks store, sync, privacy, and adapters', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-global-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-codex-home-'));
    const claudeHome = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-claude-home-'));
    const opencodeConfigHome = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-opencode-config-'));

    try {
      vi.stubEnv('CODEX_HOME', codexHome);
      vi.stubEnv('HOME', claudeHome);
      vi.stubEnv('USERPROFILE', claudeHome);
      vi.stubEnv('XDG_CONFIG_HOME', opencodeConfigHome);

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
            category: 'adapter'
          }),
          expect.objectContaining({
            id: 'adapter.codex.configured',
            category: 'adapter',
            status: 'ok'
          }),
          expect.objectContaining({
            id: 'adapter.codex.mcp-config',
            category: 'adapter',
            status: 'ok'
          })
        ])
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
      await rm(opencodeConfigHome, { recursive: true, force: true });
    }
  }, 30000);

  it('warns when privacy and sync settings are risky', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-global-'));
    const codexHome = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-codex-home-'));
    const claudeHome = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-claude-home-'));
    const opencodeConfigHome = await mkdtemp(join(tmpdir(), 'dev-mesh-doctor-opencode-config-'));

    try {
      vi.stubEnv('CODEX_HOME', codexHome);
      vi.stubEnv('HOME', claudeHome);
      vi.stubEnv('USERPROFILE', claudeHome);
      vi.stubEnv('XDG_CONFIG_HOME', opencodeConfigHome);

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
      await rm(codexHome, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
      await rm(opencodeConfigHome, { recursive: true, force: true });
    }
  }, 30000);
});
