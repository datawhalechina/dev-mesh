import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@mcp-dev-mesh/client';

export function registerIndexCommand(program: Command): void {
  const index = program.command('index').description('Manage the local Dev Mesh index');

  index
    .command('rebuild')
    .description('Rebuild the local project search index manifest')
    .option('--root <path>', 'project root', process.cwd())
    .action(async (options: { root: string }) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      console.log(JSON.stringify(await runtime.rebuildIndex(), null, 2));
    });
}
