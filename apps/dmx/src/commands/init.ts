import { cancel, intro, isCancel, log, multiselect, note, outro, select, spinner } from '@clack/prompts';
import type { Command } from 'commander';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import {
  createDevMeshClientRuntime,
  initGlobalConfig,
  inspectGlobalToolStatuses,
  type GlobalInitResult,
  type GlobalToolScope,
  type GlobalToolStatus,
  type GlobalToolKey,
  type InitGlobalConfigOptions
} from '@mcp-dev-mesh/client';
import { isCiEnvironment, shouldUseTuiOutput } from './shared.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize global or project Dev Mesh state')
    .option('--global', 'initialize ~/.dev-mesh instead of the current project')
    .option('--project', 'initialize .dev-mesh in the selected project')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--mcp-url <url>', 'local MCP proxy URL', 'http://127.0.0.1:8722/mcp')
    .option('--yes', 'use defaults without prompting')
    .option('--json', 'print machine-readable JSON')
    .option('--tool <tool>', 'MCP host tool to register; repeatable', collectOption, [])
    .option('--tools <tools>', 'comma-separated MCP host tools')
    .option('--scope <scope>', 'MCP host configuration scope for selected tools: user or project', parseScopeOption, 'user')
    .action((options: InitCommandOptions, command: Command) => runInitCommand(withInitCommandSources(options, command)));
}

async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const tuiOutput = shouldUseTuiOutput({ json: options.json });

  if (shouldRunGlobalInit(options)) {
    const explicitTools = collectGlobalToolOptions(options.tool, options.tools);
    const selection =
      explicitTools === undefined
        ? await promptGlobalTools(
            compactPromptGlobalToolsOptions({
              yes: options.yes || options.json,
              mcpUrl: options.mcpUrl,
              projectRoot: options.root,
              defaultScope: options.scope
            })
          )
        : {
            tools: explicitTools,
            toolScopes: createUniformToolScopes(explicitTools, options.scope)
          };
    const initOptions: InitGlobalConfigOptions = {
      mcpUrl: options.mcpUrl,
      projectRoot: options.root,
      mcpCommand: createDmxServeMcpCommand(options)
    };

    if (selection?.tools !== undefined) {
      initOptions.tools = selection.tools;
    }

    if (selection?.toolScopes !== undefined) {
      initOptions.toolScopes = selection.toolScopes;
    }

    const initSpinner = tuiOutput ? spinner() : undefined;
    initSpinner?.start('Writing Dev Mesh global config');
    const result = await initGlobalConfig(options.name, initOptions);
    initSpinner?.stop('Global config ready');

    if (tuiOutput) {
      printGlobalInitResult(result, { showIntro: !didUseGlobalInitTui(selection) });
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    return;
  }

  const initSpinner = tuiOutput ? spinner() : undefined;
  initSpinner?.start('Preparing project store');
  const runtime = createDevMeshClientRuntime({
    projectRoot: options.root,
    memberName: options.name
  });
  const store = await runtime.ensureProjectStore();
  initSpinner?.stop('Project store ready');

  if (tuiOutput) {
    printProjectInitResult(store);
  } else {
    console.log(JSON.stringify(store, null, 2));
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectGlobalToolOptions(tool: string[] = [], tools?: string): string[] | undefined {
  const values = [...tool];

  if (tools !== undefined) {
    values.push(tools);
  }

  return values.length > 0 ? values : undefined;
}

async function promptGlobalTools(options: PromptGlobalToolsOptions): Promise<GlobalInitSelection | undefined> {
  if (options.yes || isCiEnvironment() || !process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }

  const statuses = await inspectGlobalToolStatuses({
    mcpUrl: options.mcpUrl,
    projectRoot: options.projectRoot,
    toolScopes: {
      codex: options.defaultScope,
      claude: options.defaultScope,
      opencode: options.defaultScope
    }
  });

  return runGlobalInitTui(statuses);
}

async function runGlobalInitTui(statuses: GlobalToolStatus[]): Promise<GlobalInitSelection> {
  intro('Dev Mesh init');
  note(createGlobalInitStatusSummary(statuses), 'Detected MCP hosts');
  log.info('Automation defaults: auto_init, auto_reference, auto_capture, and auto_sync are enabled.');
  log.info('MCP hosts will run dmx serve --mcp; the launcher starts or reuses the project daemon.');

  const selectedTools = await multiselect<GlobalToolKey>({
    message: 'Select MCP host tools to configure',
    options: createGlobalInitToolChoices(statuses),
    initialValues: createGlobalInitDefaultTools(statuses),
    required: true,
    maxItems: 6
  });

  if (isCancel(selectedTools)) {
    cancel('Global init cancelled.');
    throw new Error('Global init cancelled.');
  }

  const toolScopes: Partial<Record<GlobalToolKey, GlobalToolScope>> = {};
  const byKey = new Map(statuses.map((status) => [status.key, status]));

  for (const tool of selectedTools) {
    const status = byKey.get(tool);
    const scope = await select<GlobalToolScope>({
      message: `${status?.displayName ?? tool} configuration scope`,
      options: [
        {
          value: 'user',
          label: 'User config',
          hint: 'Available across projects'
        },
        {
          value: 'project',
          label: 'Project config',
          hint: 'Writes into the current project'
        }
      ],
      initialValue: status?.scope ?? 'user'
    });

    if (isCancel(scope)) {
      cancel('Global init cancelled.');
      throw new Error('Global init cancelled.');
    }

    toolScopes[tool] = scope;
  }

  log.info('Configuring selected MCP hosts.');

  return {
    tools: selectedTools,
    toolScopes,
    usedTui: true
  };
}

function printGlobalInitResult(result: GlobalInitResult, options: { showIntro?: boolean } = {}): void {
  if (options.showIntro) {
    intro('Dev Mesh init');
  }

  note(createGlobalInitResultSummary(result), 'Global config');
  note(createGlobalInitToolsSummary(result.tools), 'MCP hosts');

  const attention = createGlobalInitAttentionSummary(result.tools);

  if (attention.length > 0) {
    note(attention, 'Needs attention');
  }

  outro('Open a project with your MCP host to start automatic local knowledge capture.');
}

function printProjectInitResult(store: ProjectInitResult): void {
  intro('Dev Mesh init');
  note(createProjectInitResultSummary(store), 'Project store');
  outro('This project is ready for local knowledge capture.');
}

export function createGlobalInitToolChoices(statuses: GlobalToolStatus[]): GlobalInitToolChoice[] {
  return statuses.map((status) => {
    const hint = [describeToolStatus(status), `scope: ${status.scope}`, status.reason]
      .filter((value): value is string => value !== undefined && value.length > 0)
      .join(' | ');

    return {
      value: status.key,
      label: status.displayName,
      hint
    };
  });
}

export function createGlobalInitDefaultTools(statuses: GlobalToolStatus[]): GlobalToolKey[] {
  return statuses.filter((status) => status.detected || status.configured).map((status) => status.key);
}

export function createGlobalInitStatusSummary(statuses: GlobalToolStatus[]): string {
  return statuses
    .map((status) => `${status.displayName.padEnd(12, ' ')} ${describeToolStatus(status)} (${status.scope})`)
    .join('\n');
}

export function createGlobalInitResultSummary(result: GlobalInitResult): string {
  const selectedTools = result.selectedTools.length > 0 ? result.selectedTools.join(', ') : 'none';

  return [
    `Global root: ${result.globalRoot}`,
    `Config: ${result.configPath}`,
    `Identity: ${result.identityPath}`,
    `Selected tools: ${selectedTools}`,
    'Automation: auto_init, auto_reference, auto_capture, auto_sync'
  ].join('\n');
}

export function createGlobalInitToolsSummary(tools: GlobalToolStatus[]): string {
  const selectedTools = tools.filter((tool) => tool.selected);

  if (selectedTools.length === 0) {
    return 'No MCP host tools selected.';
  }

  return selectedTools.map(formatGlobalToolResult).join('\n');
}

export function createProjectInitResultSummary(store: ProjectInitResult): string {
  return [
    `Project root: ${store.projectRoot}`,
    `Store root: ${store.storeRoot}`,
    `Config: ${store.paths.config}`,
    `Knowledge: ${store.paths.knowledgeDir}`,
    `Events: ${store.paths.eventsDir}`
  ].join('\n');
}

function createGlobalInitAttentionSummary(tools: GlobalToolStatus[]): string {
  return tools
    .filter((tool) => tool.selected && (!tool.configured || tool.reason !== undefined))
    .map((tool) => {
      const reason = tool.reason ?? 'The MCP host configuration was not confirmed.';

      return `${tool.displayName}: ${reason}`;
    })
    .join('\n');
}

function formatGlobalToolResult(tool: GlobalToolStatus): string {
  const target = tool.targetPath === undefined ? '' : ` -> ${tool.targetPath}`;

  return `${tool.displayName.padEnd(12, ' ')} ${describeToolResult(tool)} (${tool.scope})${target}`;
}

function describeToolResult(tool: GlobalToolStatus): string {
  if (tool.configured) {
    return 'configured';
  }

  if (tool.detected) {
    return 'detected, not configured';
  }

  return 'not found';
}

function describeToolStatus(item: Pick<GlobalToolStatus, 'detected' | 'configured'>): string {
  if (item.detected && item.configured) {
    return 'installed, already configured';
  }

  if (item.detected) {
    return 'installed, not configured';
  }

  if (item.configured) {
    return 'configured, CLI not found';
  }

  return 'not found';
}

function compactPromptGlobalToolsOptions(options: {
  yes: boolean | undefined;
  mcpUrl: string;
  projectRoot: string;
  defaultScope: GlobalToolScope;
}): PromptGlobalToolsOptions {
  const promptOptions: PromptGlobalToolsOptions = {
    mcpUrl: options.mcpUrl,
    projectRoot: options.projectRoot,
    defaultScope: options.defaultScope
  };

  if (options.yes !== undefined) {
    promptOptions.yes = options.yes;
  }

  return promptOptions;
}

function createUniformToolScopes(
  tools: string[],
  scope: GlobalToolScope
): Partial<Record<GlobalToolKey, GlobalToolScope>> {
  const scopes: Partial<Record<GlobalToolKey, GlobalToolScope>> = {};

  for (const tool of tools) {
    for (const item of tool.split(',')) {
      const key = normalizeToolKey(item);

      if (key !== undefined) {
        scopes[key] = scope;
      }
    }
  }

  return scopes;
}

function normalizeToolKey(value: string): GlobalToolKey | undefined {
  switch (value.trim().toLowerCase()) {
    case 'codex':
      return 'codex';
    case 'claude':
    case 'claude-code':
    case 'claudecode':
      return 'claude';
    case 'opencode':
    case 'open-code':
      return 'opencode';
    default:
      return undefined;
  }
}

function parseScopeOption(value: string): GlobalToolScope {
  if (value === 'user' || value === 'project') {
    return value;
  }

  throw new Error(`Unknown scope "${value}". Expected one of: user, project.`);
}

function createDmxServeMcpCommand(options: InitCommandOptions): { command: string; args: string[] } {
  const launcher = createCurrentDmxLauncherCommand();
  const args = [...launcher.args, 'serve', '--mcp', '--name', options.name];

  if (options.rootExplicit) {
    args.splice(launcher.args.length + 2, 0, '--root', options.root);
  }

  return {
    command: launcher.command,
    args
  };
}

function createCurrentDmxLauncherCommand(): { command: string; args: string[] } {
  const entry = resolveRunnableDmxEntry(process.argv[1]);

  if (entry !== undefined) {
    return {
      command: resolveWindowlessNodeCommand(),
      args: [entry]
    };
  }

  return {
    command: 'dmx',
    args: []
  };
}

function resolveRunnableDmxEntry(entry: string | undefined): string | undefined {
  if (entry === undefined || !existsSync(entry)) {
    return undefined;
  }

  const extension = extname(entry).toLowerCase();

  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return entry;
  }

  if (extension === '.ts' || extension === '.tsx' || extension === '.cmd' || extension === '.bat' || extension === '.ps1') {
    return undefined;
  }

  try {
    const realEntry = realpathSync(entry);
    const realExtension = extname(realEntry).toLowerCase();

    if (realExtension === '.js' || realExtension === '.mjs' || realExtension === '.cjs') {
      return realEntry;
    }

    return extension === '' ? entry : undefined;
  } catch {
    return extension === '' ? entry : undefined;
  }
}

function resolveWindowlessNodeCommand(): string {
  if (process.platform !== 'win32') {
    return process.execPath;
  }

  const nodewPath = join(dirname(process.execPath), 'nodew.exe');

  return existsSync(nodewPath) ? nodewPath : process.execPath;
}

interface InitCommandOptions {
  global?: boolean;
  project?: boolean;
  root: string;
  rootExplicit?: boolean;
  name: string;
  mcpUrl: string;
  yes?: boolean;
  json?: boolean;
  tool?: string[];
  tools?: string;
  scope: GlobalToolScope;
}

function shouldRunGlobalInit(options: InitCommandOptions): boolean {
  if (options.global) {
    return true;
  }

  if (options.project || options.rootExplicit) {
    return false;
  }

  return true;
}

function withInitCommandSources(options: InitCommandOptions, command: Command): InitCommandOptions {
  return {
    ...options,
    rootExplicit: command.getOptionValueSource('root') !== 'default'
  };
}

interface PromptGlobalToolsOptions {
  yes?: boolean;
  mcpUrl: string;
  projectRoot: string;
  defaultScope: GlobalToolScope;
}

interface GlobalInitSelection {
  tools: GlobalToolKey[];
  toolScopes: Partial<Record<GlobalToolKey, GlobalToolScope>>;
  usedTui?: boolean;
}

function didUseGlobalInitTui(selection: GlobalInitSelection | { tools: string[] } | undefined): boolean {
  return selection !== undefined && 'usedTui' in selection && selection.usedTui === true;
}

export interface GlobalInitToolChoice {
  value: GlobalToolKey;
  label: string;
  hint: string;
}

interface ProjectInitResult {
  projectRoot: string;
  storeRoot: string;
  paths: {
    config: string;
    eventsDir: string;
    knowledgeDir: string;
  };
}
