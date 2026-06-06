import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { applyEdits, modify, parse, type FormattingOptions, type JSONPath } from 'jsonc-parser';
import type { ConfigureInput, ConfigureResult, DoctorCheck, RemoveInput, ToolAdapter } from '@mcp-dev-mesh/extension-api';

const execFileAsync = promisify(execFile);
const DEFAULT_OPENCODE_MCP_SERVER_NAME = 'dev-mesh';
const DEFAULT_LOCAL_MCP_URL = 'http://127.0.0.1:8722/mcp';
const OPENCODE_CONFIG_FILENAME = 'opencode.json';
const OPENCODE_JSONC_CONFIG_FILENAME = 'opencode.jsonc';
const OPENCODE_PERMISSION_KEY = 'dev-mesh_*';
const JSON_FORMAT: FormattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n'
};

export interface OpencodeToolAdapterOptions {
  command?: string;
  configHome?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  serverName?: string;
}

interface OpencodeMcpServerConfig {
  enabled?: boolean;
  type?: string;
  url?: string;
}

interface OpencodeConfigLookup {
  targetPath: string;
  scope: 'user' | 'project';
  server?: OpencodeMcpServerConfig;
}

export function createOpencodeToolAdapter(options: OpencodeToolAdapterOptions = {}): ToolAdapter {
  const serverName = options.serverName ?? DEFAULT_OPENCODE_MCP_SERVER_NAME;

  return {
    id: 'dev-mesh.adapter.opencode',
    kind: 'tool-adapter',
    capabilities: ['tool.detect', 'mcp.configure'],
    priority: 20,
    async detect() {
      const probe = await runOpencodeCommand(['--version'], options);

      if (!probe.ok) {
        return {
          detected: false,
          name: 'opencode',
          reason: 'opencode CLI was not found on PATH. Install opencode or skip it in dmx init --global if it is not used.'
        };
      }

      const version = firstNonEmptyLine(probe.stdout) ?? firstNonEmptyLine(probe.stderr);

      return {
        detected: true,
        name: 'opencode',
        ...(version !== undefined ? { version } : {})
      };
    },
    async isConfigured(projectRoot: string) {
      const config = await findOpencodeMcpServerConfig(projectRoot, serverName, options);

      return config?.server?.url !== undefined;
    },
    async configure(input: ConfigureInput): Promise<ConfigureResult> {
      const scope = input.scope ?? 'user';
      const targetPath = await resolveOpencodeConfigPath(input.projectRoot, scope, options);
      const current = await readJsoncFile(targetPath);
      const next = upsertOpencodeMcpServer(current, serverName, input.mcpUrl);
      const changed = next !== current;

      if (input.dryRun) {
        return {
          changed,
          targetPath,
          message: changed
            ? `Would configure opencode for ${input.mcpUrl}`
            : `opencode is already configured for ${input.mcpUrl}`
        };
      }

      if (changed) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, next, 'utf8');
      }

      return {
        changed,
        targetPath,
        message: changed ? `Configured opencode for ${input.mcpUrl}` : `opencode is already configured for ${input.mcpUrl}`
      };
    },
    async remove(input: RemoveInput): Promise<void> {
      const scope = input.scope ?? 'user';
      const targetPath = await resolveOpencodeConfigPath(input.projectRoot, scope, options);
      const current = await readJsoncFile(targetPath);
      const next = removeOpencodeMcpServer(current, serverName);

      if (next !== current) {
        await writeFile(targetPath, next, 'utf8');
      }
    },
    async doctor(projectRoot: string): Promise<DoctorCheck[]> {
      const checks: DoctorCheck[] = [];
      const detection = await runOpencodeCommand(['--version'], options);
      const configured = await findOpencodeMcpServerConfig(projectRoot, serverName, options);

      checks.push({
        id: 'adapter.opencode.cli',
        status: detection.ok ? 'ok' : 'warn',
        message: detection.ok ? 'opencode CLI is available.' : 'opencode CLI is not available on PATH.',
        ...(detection.ok ? {} : { fixHint: 'Install opencode before relying on automatic MCP host configuration.' })
      });

      if (configured === undefined) {
        checks.push({
          id: 'adapter.opencode.mcp-config',
          status: 'warn',
          message: 'opencode dev-mesh MCP server is not configured.',
          fixHint: `Run dmx init --global --tool opencode --mcp-url ${DEFAULT_LOCAL_MCP_URL} --yes.`
        });
        return checks;
      }

      if (configured.server?.url === undefined) {
        checks.push({
          id: 'adapter.opencode.mcp-config',
          status: 'error',
          message: `opencode dev-mesh MCP server exists in ${configured.targetPath} but does not define a url.`,
          fixHint: `Re-run dmx init --global --tool opencode --mcp-url ${DEFAULT_LOCAL_MCP_URL} --yes.`
        });
        return checks;
      }

      checks.push({
        id: 'adapter.opencode.mcp-config',
        status: 'ok',
        message: `opencode dev-mesh MCP server is configured in ${configured.targetPath}.`
      });

      return checks;
    }
  };
}

async function runOpencodeCommand(
  args: string[],
  options: OpencodeToolAdapterOptions
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(options.command ?? 'opencode', args, {
      env: createOpencodeProcessEnv(options),
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

function createOpencodeProcessEnv(options: OpencodeToolAdapterOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env
  };

  if (options.configHome !== undefined) {
    env.XDG_CONFIG_HOME = options.configHome;
  }

  if (options.homeDir !== undefined) {
    env.HOME = options.homeDir;
    env.USERPROFILE = options.homeDir;
  }

  return env;
}

async function findOpencodeMcpServerConfig(
  projectRoot: string,
  serverName: string,
  options: OpencodeToolAdapterOptions
): Promise<OpencodeConfigLookup | undefined> {
  const candidates: Array<{ targetPath: string; scope: 'user' | 'project' }> = [
    {
      targetPath: await resolveOpencodeConfigPath(projectRoot, 'project', options),
      scope: 'project'
    },
    {
      targetPath: await resolveOpencodeConfigPath(projectRoot, 'user', options),
      scope: 'user'
    }
  ];

  for (const candidate of candidates) {
    const content = await readJsoncFile(candidate.targetPath);
    const server = readOpencodeMcpServer(content, serverName);

    if (server !== undefined) {
      return {
        ...candidate,
        server
      };
    }
  }

  return undefined;
}

async function resolveOpencodeConfigPath(
  projectRoot: string,
  scope: 'user' | 'project',
  options: OpencodeToolAdapterOptions
): Promise<string> {
  if (scope === 'project') {
    return resolveProjectOpencodeConfigPath(projectRoot);
  }

  return join(resolveOpencodeConfigHome(options), 'opencode', OPENCODE_CONFIG_FILENAME);
}

async function resolveProjectOpencodeConfigPath(projectRoot: string): Promise<string> {
  const jsoncPath = join(projectRoot, OPENCODE_JSONC_CONFIG_FILENAME);
  const jsonPath = join(projectRoot, OPENCODE_CONFIG_FILENAME);

  if (await fileExists(jsoncPath)) {
    return jsoncPath;
  }

  if (await fileExists(jsonPath)) {
    return jsonPath;
  }

  return jsonPath;
}

function resolveOpencodeConfigHome(options: OpencodeToolAdapterOptions): string {
  if (options.configHome !== undefined) {
    return options.configHome;
  }

  if (options.env?.XDG_CONFIG_HOME !== undefined) {
    return options.env.XDG_CONFIG_HOME;
  }

  if (process.env.XDG_CONFIG_HOME !== undefined) {
    return process.env.XDG_CONFIG_HOME;
  }

  return join(resolveHomeDir(options), '.config');
}

function resolveHomeDir(options: OpencodeToolAdapterOptions): string {
  if (options.homeDir !== undefined) {
    return options.homeDir;
  }

  if (process.platform === 'win32') {
    return options.env?.USERPROFILE ?? options.env?.HOME ?? process.env.USERPROFILE ?? process.env.HOME ?? homedir();
  }

  return options.env?.HOME ?? options.env?.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function readJsoncFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '{}\n';
    }

    throw error;
  }
}

function upsertOpencodeMcpServer(content: string, serverName: string, mcpUrl: string): string {
  let next = applyJsoncEdit(content, ['mcp', serverName], {
    type: 'remote',
    url: mcpUrl,
    enabled: true
  });

  next = applyJsoncEdit(next, ['permission', OPENCODE_PERMISSION_KEY], 'ask');

  return normalizeFinalNewline(next);
}

function removeOpencodeMcpServer(content: string, serverName: string): string {
  let next = applyJsoncEdit(content, ['mcp', serverName], undefined);

  next = applyJsoncEdit(next, ['permission', OPENCODE_PERMISSION_KEY], undefined);

  return normalizeFinalNewline(next);
}

function applyJsoncEdit(content: string, path: JSONPath, value: unknown): string {
  return applyEdits(
    content,
    modify(content, path, value, {
      formattingOptions: JSON_FORMAT,
      isArrayInsertion: false
    })
  );
}

function readOpencodeMcpServer(content: string, serverName: string): OpencodeMcpServerConfig | undefined {
  const parsed = parseJsoncObject(content);
  const mcp = readObject(parsed.mcp);
  const server = readObject(mcp[serverName]);

  if (Object.keys(server).length === 0) {
    return undefined;
  }

  const result: OpencodeMcpServerConfig = {};

  if (typeof server.enabled === 'boolean') {
    result.enabled = server.enabled;
  }

  if (typeof server.type === 'string') {
    result.type = server.type;
  }

  if (typeof server.url === 'string') {
    result.url = server.url;
  }

  return result;
}

function parseJsoncObject(content: string): Record<string, unknown> {
  const parsed = parse(content, undefined, {
    allowTrailingComma: true,
    disallowComments: false
  });

  return readObject(parsed);
}

function readObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
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
