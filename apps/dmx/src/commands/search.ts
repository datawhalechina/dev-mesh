import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { printJsonOrText } from './output.js';
import { parseIntOption } from './shared.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search local project knowledge')
    .argument('<query>', 'search query')
    .option('--limit <n>', 'maximum number of items', parseIntOption, 8)
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (query: string, options: SearchCommandOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });
      const contextPack = await runtime.searchContext({
        query,
        limit: options.limit
      });

      printJsonOrText('mesh_search_context', contextPack, options.json);
    });
}

interface SearchCommandOptions {
  limit: number;
  root: string;
  json?: boolean;
}
