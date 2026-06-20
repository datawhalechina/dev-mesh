import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { formatFields, printJsonOrCustomText } from './output.js';

export function registerIndexCommand(program: Command): void {
  const index = program.command('index').description('Manage the local DevMesh index');

  index
    .command('rebuild')
    .description('Rebuild the local project search and graph indexes')
    .option('--root <path>', 'project root', process.cwd())
    .option('--from-crdt', 'rebuild projections from the v2 CRDT document')
    .option('--json', 'print structured JSON')
    .action(async (options: IndexRebuildOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });
      const result = options.fromCrdt === true ? await runtime.rebuildProjectionsFromCrdt() : await runtime.rebuildIndex();

      printJsonOrCustomText(result, options.json, formatIndexRebuildResult);
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
    ['knowledgePath', result.knowledgePath],
    ['searchPath', result.searchPath],
    ['graphPath', result.graphPath],
    ['qualityPath', 'qualityPath' in result ? result.qualityPath : undefined],
    ['qualityCount', 'qualityCount' in result ? result.qualityCount : undefined],
    ['qualityAlgorithmVersion', 'qualityAlgorithmVersion' in result ? result.qualityAlgorithmVersion : undefined],
    ['metadataPath', 'metadataPath' in result ? result.metadataPath : undefined],
    ['crdtPath', 'crdtPath' in result ? result.crdtPath : undefined],
    ['sourceHeads', 'sourceHeads' in result ? result.sourceHeads.length : undefined],
    ['rebuiltAt', result.rebuiltAt]
  ]);
}

type IndexRebuildResult =
  | Awaited<ReturnType<ReturnType<typeof createDevMeshClientRuntime>['rebuildIndex']>>
  | Awaited<ReturnType<ReturnType<typeof createDevMeshClientRuntime>['rebuildProjectionsFromCrdt']>>;

interface IndexRebuildOptions {
  root: string;
  fromCrdt?: boolean;
  json?: boolean;
}
