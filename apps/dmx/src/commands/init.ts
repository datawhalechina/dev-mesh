import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { createDevMeshClientRuntime, initGlobalConfig, type InitGlobalConfigOptions } from '@mcp-dev-mesh/client';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize global or project Dev Mesh state')
    .option('--global', 'initialize ~/.dev-mesh instead of the current project')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--mcp-url <url>', 'local MCP proxy URL', 'http://127.0.0.1:8722/mcp')
    .option('--yes', 'use defaults without prompting')
    .option('--tool <tool>', 'MCP host tool to register; repeatable', collectOption, [])
    .option('--tools <tools>', 'comma-separated MCP host tools')
    .action(runInitCommand);
}

async function runInitCommand(options: InitCommandOptions): Promise<void> {
  if (options.global) {
    const explicitTools = collectGlobalToolOptions(options.tool, options.tools);
    const tools = explicitTools ?? (await promptGlobalTools(options.yes));
    const initOptions: InitGlobalConfigOptions = {
      mcpUrl: options.mcpUrl
    };

    if (tools !== undefined) {
      initOptions.tools = tools;
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

async function promptGlobalTools(yes?: boolean): Promise<string[] | undefined> {
  if (yes || process.env.CI === '1' || !process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await prompt.question('Register MCP hosts (codex, claude, opencode) [all]: ');
    const trimmed = answer.trim();

    return trimmed ? [trimmed] : undefined;
  } finally {
    prompt.close();
  }
}

interface InitCommandOptions {
  global?: boolean;
  root: string;
  name: string;
  mcpUrl: string;
  yes?: boolean;
  tool?: string[];
  tools?: string;
}
