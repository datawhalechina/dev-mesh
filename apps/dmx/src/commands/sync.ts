import type { Command } from 'commander';
import { runDaemonSyncOnce } from '@devmesh/client';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Trigger a manual sync exchange with joined remote servers')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (options: SyncCommandOptions) => {
  const status = await runDaemonSyncOnce({ projectRoot: options.root });
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`Sync completed. Remotes contacted: ${status.remotes.length}. ${status.message}`);
      }
    });
}

interface SyncCommandOptions {
  root: string;
  json?: boolean;
}
