import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type {
  ConfigureInput,
  ConfigureResult,
  DoctorCheck,
  McpCommandConfig,
  RemoveInput,
  ToolAdapter
} from '@devmesh/extension-api';

const execFileAsync = promisify(execFile);
const DEFAULT_CLAUDE_MCP_SERVER_NAME = 'devmesh';

export interface ClaudeCodeToolAdapterOptions {
  command?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  serverName?: string;
}

interface ClaudeMcpServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
}

interface ClaudeConfigLookup {
  targetPath: string;
  scope: 'user' | 'project';
  server?: ClaudeMcpServerConfig;
}

export function createClaudeCodeToolAdapter(options: ClaudeCodeToolAdapterOptions = {}): ToolAdapter {
  const serverName = options.serverName ?? DEFAULT_CLAUDE_MCP_SERVER_NAME;

  return {
    id: 'devmesh.adapter.claude-code',
    kind: 'tool-adapter',
    capabilities: ['tool.detect', 'mcp.configure'],
    priority: 20,
    async detect() {
      const probe = await runClaudeCommand(['--version'], options);

      if (!probe.ok) {
        return {
          detected: false,
          name: 'Claude Code',
          reason: 'Claude Code CLI was not found on PATH. Install Claude Code or skip it in dmx init --global if it is not used.'
        };
      }

      const version = firstNonEmptyLine(probe.stdout) ?? firstNonEmptyLine(probe.stderr);

      return {
        detected: true,
        name: 'Claude Code',
        ...(version !== undefined ? { version } : {})
      };
    },
    async isConfigured(projectRoot: string) {
      const config = await findClaudeMcpServerConfig(projectRoot, serverName, options);

      return config?.server?.url !== undefined || config?.server?.command !== undefined;
    },
    async configure(input: ConfigureInput): Promise<ConfigureResult> {
      const scope = input.scope ?? 'user';
      const targetPath = resolveClaudeConfigPath(input.projectRoot, scope, options);
      const current = await readJsonObject(targetPath);
      const next = upsertClaudeMcpServer(current, serverName, input.mcpUrl, input.mcpCommand);
      const changed = JSON.stringify(next) !== JSON.stringify(current);
      const target = describeMcpTarget(input.mcpUrl, input.mcpCommand);

      if (input.dryRun) {
        return {
          changed,
          targetPath,
          message: changed ? `Would configure claude-code for ${target}` : `claude-code is already configured for ${target}`
        };
      }

      if (changed) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeJsonObject(targetPath, next);
      }

      return {
        changed,
        targetPath,
        message: changed ? `Configured claude-code for ${target}` : `claude-code is already configured for ${target}`
      };
    },
    async remove(input: RemoveInput): Promise<void> {
      const scope = input.scope ?? 'user';
      const targetPath = resolveClaudeConfigPath(input.projectRoot, scope, options);
      const current = await readJsonObject(targetPath);
      const next = removeClaudeMcpServer(current, serverName);

      if (JSON.stringify(next) !== JSON.stringify(current)) {
        await writeJsonObject(targetPath, next);
      }
    },
    async doctor(projectRoot: string): Promise<DoctorCheck[]> {
      const checks: DoctorCheck[] = [];
      const detection = await runClaudeCommand(['--version'], options);
      const configured = await findClaudeMcpServerConfig(projectRoot, serverName, options);

      checks.push({
        id: 'adapter.claude-code.cli',
        status: detection.ok ? 'ok' : 'warn',
        message: detection.ok ? 'Claude Code CLI is available.' : 'Claude Code CLI is not available on PATH.',
        ...(detection.ok ? {} : { fixHint: 'Install Claude Code before relying on automatic MCP host configuration.' })
      });

      if (configured === undefined) {
        checks.push({
          id: 'adapter.claude-code.mcp-config',
          status: 'warn',
          message: 'Claude Code DevMesh MCP server is not configured.',
          fixHint: 'Run dmx init --global --tool claude --yes.'
        });
        return checks;
      }

      if (configured.server?.url === undefined && configured.server?.command === undefined) {
        checks.push({
          id: 'adapter.claude-code.mcp-config',
          status: 'error',
          message: `Claude Code DevMesh MCP server exists in ${configured.targetPath} but does not define a url or command.`,
          fixHint: 'Re-run dmx init --global --tool claude --yes.'
        });
        return checks;
      }

      checks.push({
        id: 'adapter.claude-code.mcp-config',
        status: 'ok',
        message: `Claude Code DevMesh MCP server is configured in ${configured.targetPath}.`
      });

      return checks;
    }
  };
}

async function runClaudeCommand(
  args: string[],
  options: ClaudeCodeToolAdapterOptions
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(options.command ?? 'claude', args, {
      env: createClaudeProcessEnv(options),
      shell: process.platform === 'win32' && options.command === undefined,
      windowsHide: true
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

function createClaudeProcessEnv(options: ClaudeCodeToolAdapterOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env
  };

  if (options.homeDir !== undefined) {
    env.HOME = options.homeDir;
    env.USERPROFILE = options.homeDir;
  }

  return env;
}

async function findClaudeMcpServerConfig(
  projectRoot: string,
  serverName: string,
  options: ClaudeCodeToolAdapterOptions
): Promise<ClaudeConfigLookup | undefined> {
  const candidates: Array<{ targetPath: string; scope: 'user' | 'project' }> = [
    {
      targetPath: resolveClaudeConfigPath(projectRoot, 'project', options),
      scope: 'project'
    },
    {
      targetPath: resolveClaudeConfigPath(projectRoot, 'user', options),
      scope: 'user'
    }
  ];

  for (const candidate of candidates) {
    const config = await readJsonObject(candidate.targetPath);
    const server = readClaudeMcpServer(config, serverName);

    if (server !== undefined) {
      return {
        ...candidate,
        server
      };
    }
  }

  return undefined;
}

function resolveClaudeConfigPath(
  projectRoot: string,
  scope: 'user' | 'project',
  options: ClaudeCodeToolAdapterOptions
): string {
  if (scope === 'project') {
    return join(projectRoot, '.mcp.json');
  }

  return join(resolveClaudeHome(options), '.claude.json');
}

function resolveClaudeHome(options: ClaudeCodeToolAdapterOptions): string {
  if (options.homeDir !== undefined) {
    return options.homeDir;
  }

  if (process.platform === 'win32') {
    return options.env?.USERPROFILE ?? options.env?.HOME ?? process.env.USERPROFILE ?? process.env.HOME ?? homedir();
  }

  return options.env?.HOME ?? options.env?.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, 'utf8');

    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function writeJsonObject(path: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function upsertClaudeMcpServer(
  config: Record<string, unknown>,
  serverName: string,
  mcpUrl: string,
  mcpCommand?: McpCommandConfig
): Record<string, unknown> {
  const next = cloneJsonObject(config);
  const mcpServers = readObject(next.mcpServers);

  mcpServers[serverName] =
    mcpCommand === undefined
      ? {
          type: 'http',
          url: mcpUrl
        }
      : {
          type: 'stdio',
          command: mcpCommand.command,
          args: mcpCommand.args ?? []
        };
  next.mcpServers = mcpServers;

  return next;
}

function removeClaudeMcpServer(config: Record<string, unknown>, serverName: string): Record<string, unknown> {
  const next = cloneJsonObject(config);
  const mcpServers = readObject(next.mcpServers);

  if (Object.hasOwn(mcpServers, serverName)) {
    delete mcpServers[serverName];
    next.mcpServers = mcpServers;
  }

  return next;
}

function readClaudeMcpServer(config: Record<string, unknown>, serverName: string): ClaudeMcpServerConfig | undefined {
  const mcpServers = readObject(config.mcpServers);
  const server = readObject(mcpServers[serverName]);

  if (Object.keys(server).length === 0) {
    return undefined;
  }

  const result: ClaudeMcpServerConfig = {};

  if (typeof server.type === 'string') {
    result.type = server.type;
  }

  if (typeof server.url === 'string') {
    result.url = server.url;
  }

  if (typeof server.command === 'string') {
    result.command = server.command;
  }

  if (Array.isArray(server.args) && server.args.every((value) => typeof value === 'string')) {
    result.args = server.args;
  }

  return result;
}

function describeMcpTarget(mcpUrl: string, mcpCommand?: McpCommandConfig): string {
  if (mcpCommand === undefined) {
    return mcpUrl;
  }

  return `${mcpCommand.command} ${(mcpCommand.args ?? []).join(' ')}`.trim();
}

function readObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
