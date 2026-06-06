import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ConfigureInput, ConfigureResult, DoctorCheck, RemoveInput, ToolAdapter } from '@mcp-dev-mesh/extension-api';

const execFileAsync = promisify(execFile);
const DEFAULT_CODEX_MCP_SERVER_NAME = 'dev-mesh';
const DEFAULT_LOCAL_MCP_URL = 'http://127.0.0.1:8722/mcp';

export interface CodexToolAdapterOptions {
  codexHome?: string;
  command?: string;
  serverName?: string;
  env?: NodeJS.ProcessEnv;
}

interface CodexConfigLookup {
  targetPath: string;
  scope: 'user' | 'project';
  server?: CodexMcpServerConfig;
}

interface CodexMcpServerConfig {
  url?: string;
}

export function createCodexToolAdapter(options: CodexToolAdapterOptions = {}): ToolAdapter {
  const serverName = options.serverName ?? DEFAULT_CODEX_MCP_SERVER_NAME;

  return {
    id: 'dev-mesh.adapter.codex',
    kind: 'tool-adapter',
    capabilities: ['tool.detect', 'mcp.configure'],
    priority: 20,
    async detect() {
      const probe = await runCodexCommand(['--version'], options);

      if (!probe.ok) {
        return {
          detected: false,
          name: 'Codex',
          reason: 'Codex CLI was not found on PATH. Install Codex or skip it in dmx init --global if it is not used.'
        };
      }

      const version = firstNonEmptyLine(probe.stdout) ?? firstNonEmptyLine(probe.stderr);

      return {
        detected: true,
        name: 'Codex',
        ...(version !== undefined ? { version } : {})
      };
    },
    async isConfigured(projectRoot: string) {
      const config = await findCodexMcpServerConfig(projectRoot, serverName, options);

      return config?.server?.url !== undefined;
    },
    async configure(input: ConfigureInput): Promise<ConfigureResult> {
      const scope = input.scope ?? 'user';
      const targetPath = resolveCodexConfigPath(input.projectRoot, scope, options);
      const current = await readTextFile(targetPath);
      const next = upsertCodexMcpServer(current, serverName, input.mcpUrl);
      const changed = next !== current;

      if (input.dryRun) {
        return {
          changed,
          targetPath,
          message: changed ? `Would configure codex for ${input.mcpUrl}` : `codex is already configured for ${input.mcpUrl}`
        };
      }

      if (changed) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, next, 'utf8');
      }

      return {
        changed,
        targetPath,
        message: changed ? `Configured codex for ${input.mcpUrl}` : `codex is already configured for ${input.mcpUrl}`
      };
    },
    async remove(input: RemoveInput): Promise<void> {
      const scope = input.scope ?? 'user';
      const targetPath = resolveCodexConfigPath(input.projectRoot, scope, options);
      const current = await readTextFile(targetPath);
      const next = removeTomlSection(current, createMcpServerSectionHeader(serverName));

      if (next !== current) {
        await writeFile(targetPath, next, 'utf8');
      }
    },
    async doctor(projectRoot: string): Promise<DoctorCheck[]> {
      const checks: DoctorCheck[] = [];
      const detection = await runCodexCommand(['--version'], options);
      const configured = await findCodexMcpServerConfig(projectRoot, serverName, options);

      checks.push({
        id: 'adapter.codex.cli',
        status: detection.ok ? 'ok' : 'warn',
        message: detection.ok ? 'Codex CLI is available.' : 'Codex CLI is not available on PATH.',
        ...(detection.ok
          ? {}
          : { fixHint: 'Install Codex before relying on automatic MCP host configuration.' })
      });

      if (configured === undefined) {
        checks.push({
          id: 'adapter.codex.mcp-config',
          status: 'warn',
          message: 'Codex dev-mesh MCP server is not configured.',
          fixHint: `Run dmx init --global --tool codex --mcp-url ${DEFAULT_LOCAL_MCP_URL} --yes.`
        });
        return checks;
      }

      if (configured.server?.url === undefined) {
        checks.push({
          id: 'adapter.codex.mcp-config',
          status: 'error',
          message: `Codex dev-mesh MCP server exists in ${configured.targetPath} but does not define a url.`,
          fixHint: `Re-run dmx init --global --tool codex --mcp-url ${DEFAULT_LOCAL_MCP_URL} --yes.`
        });
        return checks;
      }

      checks.push({
        id: 'adapter.codex.mcp-config',
        status: 'ok',
        message: `Codex dev-mesh MCP server is configured in ${configured.targetPath}.`
      });

      return checks;
    }
  };
}

async function runCodexCommand(
  args: string[],
  options: CodexToolAdapterOptions
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; stdout: string; stderr: string }> {
  try {
    const env = createCodexProcessEnv(options);
    const result = await execFileAsync(options.command ?? 'codex', args, {
      env,
      shell: process.platform === 'win32' && options.command === undefined
    });

    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const processError = error as { stdout?: string; stderr?: string };

    return {
      ok: false,
      stdout: processError.stdout ?? '',
      stderr: processError.stderr ?? ''
    };
  }
}

function createCodexProcessEnv(options: CodexToolAdapterOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env
  };

  if (options.codexHome !== undefined) {
    env.CODEX_HOME = options.codexHome;
  }

  return env;
}

async function findCodexMcpServerConfig(
  projectRoot: string,
  serverName: string,
  options: CodexToolAdapterOptions
): Promise<CodexConfigLookup | undefined> {
  const candidates: Array<{ targetPath: string; scope: 'user' | 'project' }> = [
    {
      targetPath: resolveCodexConfigPath(projectRoot, 'project', options),
      scope: 'project'
    },
    {
      targetPath: resolveCodexConfigPath(projectRoot, 'user', options),
      scope: 'user'
    }
  ];

  for (const candidate of candidates) {
    const content = await readTextFile(candidate.targetPath);
    const server = readCodexMcpServer(content, serverName);

    if (server !== undefined) {
      return {
        ...candidate,
        server
      };
    }
  }

  return undefined;
}

function resolveCodexConfigPath(
  projectRoot: string,
  scope: 'user' | 'project',
  options: CodexToolAdapterOptions
): string {
  if (scope === 'project') {
    return join(projectRoot, '.codex', 'config.toml');
  }

  return join(resolveCodexHome(options), 'config.toml');
}

function resolveCodexHome(options: CodexToolAdapterOptions): string {
  return options.codexHome ?? options.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

function upsertCodexMcpServer(content: string, serverName: string, mcpUrl: string): string {
  const header = createMcpServerSectionHeader(serverName);
  const section = [header, `url = "${escapeTomlString(mcpUrl)}"`, ''];
  const withoutExisting = removeTomlSection(content, header).trimEnd();

  if (!withoutExisting) {
    return `${section.join('\n')}`;
  }

  return `${withoutExisting}\n\n${section.join('\n')}`;
}

function removeTomlSection(content: string, sectionHeader: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const start = findTomlSectionStart(lines, sectionHeader);

  if (start === -1) {
    return normalizeFinalNewline(content);
  }

  const end = findNextTomlSectionStart(lines, start + 1);
  const next = [...lines.slice(0, start), ...lines.slice(end)].join('\n');

  return normalizeFinalNewline(next);
}

function readCodexMcpServer(content: string, serverName: string): CodexMcpServerConfig | undefined {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const header = createMcpServerSectionHeader(serverName);
  const start = findTomlSectionStart(lines, header);

  if (start === -1) {
    return undefined;
  }

  const end = findNextTomlSectionStart(lines, start + 1);
  const server: CodexMcpServerConfig = {};

  for (const line of lines.slice(start + 1, end)) {
    const value = readTomlStringValue(line, 'url');

    if (value !== undefined) {
      server.url = value;
    }
  }

  return server;
}

function createMcpServerSectionHeader(serverName: string): string {
  return `[mcp_servers.${serverName}]`;
}

function findTomlSectionStart(lines: string[], sectionHeader: string): number {
  return lines.findIndex((line) => line.trim() === sectionHeader);
}

function findNextTomlSectionStart(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (/^\s*\[+[^#\]]+\]+\s*(?:#.*)?$/.test(lines[index] ?? '')) {
      return index;
    }
  }

  return lines.length;
}

function readTomlStringValue(line: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"(.*)"\\s*(?:#.*)?$`).exec(line);

  if (match?.[1] === undefined) {
    return undefined;
  }

  return unescapeTomlString(match[1]);
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeTomlString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFinalNewline(content: string): string {
  if (!content) {
    return '';
  }

  return `${content.trimEnd()}\n`;
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
