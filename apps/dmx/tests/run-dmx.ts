import { spawn } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

export function runDmx(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string }> {
  const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = join(repoRoot, 'apps', 'dmx', 'src', 'index.ts');
  const child = spawn(process.execPath, [tsxCli, entry, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: '1',
      ...env
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
