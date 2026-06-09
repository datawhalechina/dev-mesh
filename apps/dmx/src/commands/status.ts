import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Print local DevMesh status')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .action(async (options: { root: string; name: string }) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root,
        memberName: options.name
      });

      console.log(JSON.stringify(await runtime.status(), null, 2));
    });
}
