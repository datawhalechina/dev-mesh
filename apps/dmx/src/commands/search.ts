import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { printJsonOrText } from './output.js';
import { parseIntOption } from './shared.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search local project knowledge')
    .argument('<query>', 'search query')
    .option('--branch <name>', 'read from a specific knowledge branch without switching checkout')
    .option('--limit <n>', 'maximum number of items', parseIntOption, 8)
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (query: string, options: SearchCommandOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });
      const input: Parameters<typeof runtime.searchContext>[0] = {
        query,
        limit: options.limit
      };

      if (options.branch !== undefined) {
        input.branch = options.branch;
      }

      const contextPack = await runtime.searchContext(input);

      printJsonOrText('mesh_search_context', contextPack, options.json);
    });
}

interface SearchCommandOptions {
  branch?: string;
  limit: number;
  root: string;
  json?: boolean;
}
