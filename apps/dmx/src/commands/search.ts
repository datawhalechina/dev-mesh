import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { parseIntOption } from './shared.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search local project knowledge')
    .argument('<query>', 'search query')
    .option('--limit <n>', 'maximum number of items', parseIntOption, 8)
    .option('--root <path>', 'project root', process.cwd())
    .action(async (query: string, options: { limit: number; root: string }) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });
      const contextPack = await runtime.searchContext({
        query,
        limit: options.limit
      });

      console.log(JSON.stringify(contextPack, null, 2));
    });
}
