import type { Command } from 'commander';
import { runDaemonSyncOnce } from '@devmesh/client';
import { printJsonOrText } from './output.js';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Trigger a manual sync exchange with joined remote servers')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (options: SyncCommandOptions) => {
      const status = await runDaemonSyncOnce({ projectRoot: options.root });
      printJsonOrText('sync_now', status, options.json);
    });
}

interface SyncCommandOptions {
  root: string;
  json?: boolean;
}
