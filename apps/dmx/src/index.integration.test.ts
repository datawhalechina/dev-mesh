import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

describe('dmx CLI integration', () => {
  it('initializes a project, captures knowledge, searches it, and reports status', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-cli-'));

    try {
      const init = await runDmx(['init', '--root', projectRoot, '--name', 'Xiaoyun']);
      const capture = await runDmx([
        'capture',
        '--root',
        projectRoot,
        '--name',
        'Xiaoyun',
        '--title',
        'Run focused tests',
        '--summary',
        'Use pnpm test:unit before pushing.',
        '--type',
        'command',
        '--para',
        'resources:test-commands'
      ]);
      const search = await runDmx(['search', 'focused tests', '--root', projectRoot]);
      const status = await runDmx(['status', '--root', projectRoot]);

      const initJson = JSON.parse(init.stdout);
      const captureJson = JSON.parse(capture.stdout);
      const searchJson = JSON.parse(search.stdout);
      const statusJson = JSON.parse(status.stdout);
      const config = await readFile(join(projectRoot, '.dev-mesh', 'config.toml'), 'utf8');

      expect(initJson.storeRoot).toBe(join(projectRoot, '.dev-mesh'));
      expect(config).toContain('display_name = "Xiaoyun"');
      expect(captureJson).toMatchObject({
        title: 'Run focused tests',
        createdBy: {
          displayName: 'Xiaoyun'
        },
        para: {
          category: 'resources',
          key: 'test-commands'
        }
      });
      expect(searchJson.items[0]).toMatchObject({
        id: captureJson.id,
        title: 'Run focused tests'
      });
      expect(statusJson).toMatchObject({
        mode: 'local-only',
        knowledgeItems: 1
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

function runDmx(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = join(repoRoot, 'apps', 'dmx', 'src', 'index.ts');
  const child = spawn(process.execPath, [tsxCli, entry, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
        return;
      }

      reject(new Error(`dmx exited with ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}
