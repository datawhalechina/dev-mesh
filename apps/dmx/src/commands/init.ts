import { clearScreenDown, cursorTo, emitKeypressEvents } from 'node:readline';
import type { Command } from 'commander';
import {
  createDevMeshClientRuntime,
  initGlobalConfig,
  inspectGlobalToolStatuses,
  type GlobalToolScope,
  type GlobalToolStatus,
  type GlobalToolKey,
  type InitGlobalConfigOptions
} from '@mcp-dev-mesh/client';

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
    .option('--tool <tool>', 'MCP host tool to register; repeatable', collectOption, [])
    .option('--tools <tools>', 'comma-separated MCP host tools')
    .option('--scope <scope>', 'MCP host configuration scope for selected tools: user or project', parseScopeOption, 'user')
    .action((options: InitCommandOptions, command: Command) => runInitCommand(withInitCommandSources(options, command)));
}

async function runInitCommand(options: InitCommandOptions): Promise<void> {
  if (shouldRunGlobalInit(options)) {
    const explicitTools = collectGlobalToolOptions(options.tool, options.tools);
    const selection =
      explicitTools === undefined
        ? await promptGlobalTools(
            compactPromptGlobalToolsOptions({
              yes: options.yes,
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
      projectRoot: options.root
    };

    if (selection?.tools !== undefined) {
      initOptions.tools = selection.tools;
    }

    if (selection?.toolScopes !== undefined) {
      initOptions.toolScopes = selection.toolScopes;
    }

    const result = await initGlobalConfig(options.name, initOptions);

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const runtime = createDevMeshClientRuntime({
    projectRoot: options.root,
    memberName: options.name
  });
  const store = await runtime.ensureProjectStore();

  console.log(JSON.stringify(store, null, 2));
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
  if (options.yes || process.env.CI === '1' || !process.stdin.isTTY || !process.stdout.isTTY) {
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
  const state = createGlobalInitTuiState(statuses);

  return runGlobalInitTui(state, process.stdin, process.stdout);
}

export function createGlobalInitTuiState(statuses: GlobalToolStatus[]): GlobalInitTuiState {
  return {
    cursor: 0,
    items: statuses.map((status) => {
      const item: GlobalInitTuiItem = {
        key: status.key,
        displayName: status.displayName,
        detected: status.detected,
        configured: status.configured,
        selected: status.detected || status.configured,
        scope: status.scope
      };

      if (status.reason !== undefined) {
        item.reason = status.reason;
      }

      return item;
    })
  };
}

export function renderGlobalInitTui(state: GlobalInitTuiState): string {
  const rows = state.items.map((item, index) => {
    const cursor = index === state.cursor ? '>' : ' ';
    const checked = item.selected ? 'x' : ' ';
    const name = item.displayName.padEnd(12, ' ');
    const status = describeToolStatus(item).padEnd(29, ' ');
    const scope = `scope: ${item.scope}`;

    return `${cursor} [${checked}] ${name} ${status} ${scope}`;
  });

  const error = state.error === undefined ? [] : ['', state.error];

  return [
    'Dev Mesh Global Init',
    '',
    'Detected tools:',
    ...rows,
    '',
    'Automation: auto_init, auto_reference, auto_capture, and auto_sync are enabled by default.',
    '',
    'Keys: ↑/↓ move, Space toggle, s scope, Enter apply, q cancel.',
    ...error,
    ''
  ].join('\n');
}

export function applyGlobalInitTuiKey(
  state: GlobalInitTuiState,
  key: GlobalInitTuiKey
): { state: GlobalInitTuiState; selection?: GlobalInitSelection; cancelled?: boolean } {
  const next = cloneTuiState(state);
  delete next.error;

  if (key === 'up') {
    next.cursor = (next.cursor - 1 + next.items.length) % next.items.length;
    return { state: next };
  }

  if (key === 'down') {
    next.cursor = (next.cursor + 1) % next.items.length;
    return { state: next };
  }

  const item = next.items[next.cursor];

  if (item === undefined) {
    return { state: next };
  }

  if (key === 'space') {
    item.selected = !item.selected;
    return { state: next };
  }

  if (key === 'scope') {
    item.scope = item.scope === 'user' ? 'project' : 'user';
    return { state: next };
  }

  if (key === 'cancel') {
    return { state: next, cancelled: true };
  }

  if (key === 'enter') {
    const selected = next.items.filter((candidate) => candidate.selected);

    if (selected.length === 0) {
      next.error = 'Select at least one MCP host tool before applying.';
      return { state: next };
    }

    return {
      state: next,
      selection: {
        tools: selected.map((candidate) => candidate.key),
        toolScopes: Object.fromEntries(selected.map((candidate) => [candidate.key, candidate.scope]))
      }
    };
  }

  return { state: next };
}

async function runGlobalInitTui(
  initialState: GlobalInitTuiState,
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream
): Promise<GlobalInitSelection> {
  let state = initialState;
  const rawMode = input.isTTY && typeof input.setRawMode === 'function';

  emitKeypressEvents(input);

  if (rawMode) {
    input.setRawMode(true);
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off('keypress', onKeypress);

      if (rawMode) {
        input.setRawMode(false);
      }
    };

    const render = () => {
      cursorTo(output, 0, 0);
      clearScreenDown(output);
      output.write(renderGlobalInitTui(state));
    };

    const onKeypress = (_chunk: string, key: KeypressInfo = {}) => {
      const action = toGlobalInitTuiKey(key);

      if (action === undefined) {
        return;
      }

      const result = applyGlobalInitTuiKey(state, action);
      state = result.state;

      if (result.cancelled) {
        cleanup();
        output.write('\n');
        reject(new Error('Global init cancelled.'));
        return;
      }

      if (result.selection !== undefined) {
        cleanup();
        output.write('\n');
        resolve(result.selection);
        return;
      }

      render();
    };

    input.on('keypress', onKeypress);
    render();
  });
}

function toGlobalInitTuiKey(key: KeypressInfo): GlobalInitTuiKey | undefined {
  if (key.ctrl === true && key.name === 'c') {
    return 'cancel';
  }

  switch (key.name) {
    case 'up':
    case 'k':
      return 'up';
    case 'down':
    case 'j':
      return 'down';
    case 'space':
      return 'space';
    case 's':
      return 'scope';
    case 'return':
    case 'enter':
      return 'enter';
    case 'q':
    case 'escape':
      return 'cancel';
    default:
      return undefined;
  }
}

function describeToolStatus(item: GlobalInitTuiItem): string {
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

function cloneTuiState(state: GlobalInitTuiState): GlobalInitTuiState {
  const next: GlobalInitTuiState = {
    cursor: state.cursor,
    items: state.items.map((item) => ({ ...item }))
  };

  if (state.error !== undefined) {
    next.error = state.error;
  }

  return next;
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

interface InitCommandOptions {
  global?: boolean;
  project?: boolean;
  root: string;
  rootExplicit?: boolean;
  name: string;
  mcpUrl: string;
  yes?: boolean;
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
}

export interface GlobalInitTuiState {
  cursor: number;
  error?: string;
  items: GlobalInitTuiItem[];
}

interface GlobalInitTuiItem {
  key: GlobalToolKey;
  displayName: string;
  selected: boolean;
  detected: boolean;
  configured: boolean;
  scope: GlobalToolScope;
  reason?: string;
}

type GlobalInitTuiKey = 'up' | 'down' | 'space' | 'scope' | 'enter' | 'cancel';

interface KeypressInfo {
  name?: string;
  ctrl?: boolean;
}
