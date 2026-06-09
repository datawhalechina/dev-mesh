import type { Command } from 'commander';
import {
  DEV_MESH_DAEMON_INTERNAL_ENV,
  runLocalMcpDaemon,
  serveLocalMcpStdio,
  type LocalMcpDaemonCommand,
  type LocalMcpDaemonOptions
} from '@mcp-dev-mesh/client';
import { parseIntOption } from './shared.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the DevMesh stdio MCP launcher')
    .option('--mcp', 'serve stdio MCP for host tools')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--global-root <path>', 'global DevMesh root')
    .option('--daemon-idle-ms <number>', 'background daemon idle timeout in milliseconds', parseIntOption)
    .option('--daemon-sync-interval-ms <number>', 'background daemon sync interval in milliseconds', parseIntOption)
    .option('--daemon-capture-interval-ms <number>', 'background daemon auto capture interval in milliseconds', parseIntOption)
    .action(runServeCommand);
}

async function runServeCommand(options: ServeCommandOptions): Promise<void> {
  if (options.mcp !== true) {
    throw new Error('Use dmx serve --mcp to start the stdio MCP launcher.');
  }

  const daemonOptions = createDaemonOptions(options);

  if (process.env[DEV_MESH_DAEMON_INTERNAL_ENV] === '1') {
    await runLocalMcpDaemon(daemonOptions);
    return;
  }

  await serveLocalMcpStdio(daemonOptions);
}

function createDaemonOptions(options: ServeCommandOptions): LocalMcpDaemonOptions {
  const daemonOptions: LocalMcpDaemonOptions = {
    projectRoot: options.root,
    memberName: options.name
  };
  const command = createCurrentServeCommand();

  if (command !== undefined) {
    daemonOptions.command = command;
  }

  if (options.daemonIdleMs !== undefined) {
    daemonOptions.idleMs = options.daemonIdleMs;
  }

  if (options.daemonSyncIntervalMs !== undefined) {
    daemonOptions.syncIntervalMs = options.daemonSyncIntervalMs;
  }

  if (options.daemonCaptureIntervalMs !== undefined) {
    daemonOptions.captureIntervalMs = options.daemonCaptureIntervalMs;
  }

  if (options.globalRoot !== undefined) {
    daemonOptions.globalRoot = options.globalRoot;
  }

  return daemonOptions;
}

function createCurrentServeCommand(): LocalMcpDaemonCommand | undefined {
  const entry = process.argv[1];

  if (entry === undefined) {
    return undefined;
  }

  return {
    command: process.execPath,
    args: [entry, ...process.argv.slice(2)]
  };
}

interface ServeCommandOptions {
  mcp?: boolean;
  root: string;
  name: string;
  globalRoot?: string;
  daemonIdleMs?: number;
  daemonSyncIntervalMs?: number;
  daemonCaptureIntervalMs?: number;
}
