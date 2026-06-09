import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

describe('dmx proxy command', () => {
  it('starts the local MCP proxy with CLI options', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-dmx-proxy-'));
    const child = startDmxProxy(['proxy', '--root', projectRoot, '--name', 'Xiaoyun', '--port', '0']);

    try {
      const startup = await readStartupJson(child);
      const health = await requestJson(startup.mcpUrl.replace(/\/mcp$/, '/healthz'));

      expect(startup).toMatchObject({
        status: 'listening',
        mcpUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
        projectRoot
      });
      expect(health.body).toMatchObject({
        status: 'ok',
        service: 'devmesh-local-proxy',
        projectRoot,
        mcpUrl: startup.mcpUrl
      });
    } finally {
      await stopProcess(child);
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

function startDmxProxy(args: string[]): ChildProcessWithoutNullStreams {
  const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = join(repoRoot, 'apps', 'dmx', 'src', 'index.ts');

  return spawn(process.execPath, [tsxCli, entry, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function readStartupJson(child: ChildProcessWithoutNullStreams): Promise<ProxyStartup> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for dmx proxy startup.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 10000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      const completeLines = stdout.endsWith('\n') || stdout.endsWith('\r') ? lines : lines.slice(0, -1);

      for (const line of completeLines) {
        if (!line.trim().startsWith('{')) {
          continue;
        }

        try {
          const startup = JSON.parse(line) as ProxyStartup;
          resolved = true;
          clearTimeout(timer);
          resolve(startup);
          return;
        } catch {
          continue;
        }
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error(`dmx proxy exited before startup with ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
      }
    });
  });
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  const closed = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
  });

  child.kill();
  await closed;
}

async function requestJson<T = any>(url: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url);
  const text = await response.text();

  return {
    status: response.status,
    body: text ? (JSON.parse(text) as T) : ({} as T)
  };
}

interface ProxyStartup {
  status: string;
  url: string;
  mcpUrl: string;
  projectRoot: string;
}
