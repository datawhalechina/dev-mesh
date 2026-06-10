import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { formatFields, printJsonOrCustomText } from './output.js';

export function registerIndexCommand(program: Command): void {
  const index = program.command('index').description('Manage the local DevMesh index');

  index
    .command('rebuild')
    .description('Rebuild the local project search and graph indexes')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (options: IndexRebuildOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      printJsonOrCustomText(await runtime.rebuildIndex(), options.json, formatIndexRebuildResult);
    });
}

function formatIndexRebuildResult(result: IndexRebuildResult): string {
  return formatFields('DevMesh index rebuilt', [
    ['documents', result.documentCount],
    ['graphNodes', result.graphNodeCount],
    ['graphEdges', result.graphEdgeCount],
    ['schemaVersion', result.schemaVersion],
    ['indexPath', result.indexPath],
    ['sqlitePath', result.sqlitePath],
    ['graphPath', result.graphPath],
    ['rebuiltAt', result.rebuiltAt]
  ]);
}

type IndexRebuildResult = Awaited<ReturnType<ReturnType<typeof createDevMeshClientRuntime>['rebuildIndex']>>;

interface IndexRebuildOptions {
  root: string;
  json?: boolean;
}
