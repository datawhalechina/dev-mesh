import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { printJsonOrText } from './output.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Print local DevMesh status')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--json', 'print structured JSON')
    .action(async (options: StatusCommandOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root,
        memberName: options.name
      });

      printJsonOrText('mesh_get_status', await runtime.status(), options.json);
    });
}

interface StatusCommandOptions {
  root: string;
  name: string;
  json?: boolean;
}
