import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { parseIntOption } from './shared.js';

const NODE_KINDS = ['knowledge', 'para', 'type', 'tag', 'member', 'source'] as const;
const EDGE_KINDS = ['authored_by', 'belongs_to_para', 'has_type', 'parent_para', 'sourced_from', 'tagged_with'] as const;

export function registerGraphCommand(program: Command): void {
  const graph = program.command('graph').description('Explore the local DevMesh knowledge graph');

  graph
    .command('explore')
    .description('Explore related knowledge items, PARA nodes, tags, authors, sources, and types')
    .option('--root <path>', 'project root', process.cwd())
    .option('--query <query>', 'query used to select graph seed nodes')
    .option('--id <id>', 'knowledge item id used as a seed node', collectOption, [])
    .option('--depth <n>', 'relationship depth from seed nodes', parseIntOption, 2)
    .option('--limit <n>', 'maximum number of nodes', parseIntOption, 40)
    .option('--node-kind <kind>', 'node kind filter', collectOption, [])
    .option('--edge-kind <kind>', 'edge kind filter', collectOption, [])
    .action(async (options: GraphExploreOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });
      const input: NonNullable<Parameters<typeof runtime.exploreKnowledgeGraph>[0]> = {
        depth: options.depth,
        limit: options.limit
      };

      if (options.query !== undefined) {
        input.query = options.query;
      }

      if (options.id.length > 0) {
        input.ids = options.id;
      }

      if (options.nodeKind.length > 0) {
        input.nodeKinds = options.nodeKind.map(parseNodeKind);
      }

      if (options.edgeKind.length > 0) {
        input.edgeKinds = options.edgeKind.map(parseEdgeKind);
      }

      console.log(JSON.stringify(await runtime.exploreKnowledgeGraph(input), null, 2));
    });
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseNodeKind(value: string): (typeof NODE_KINDS)[number] {
  if (NODE_KINDS.includes(value as (typeof NODE_KINDS)[number])) {
    return value as (typeof NODE_KINDS)[number];
  }

  throw new Error(`Expected --node-kind to be one of ${NODE_KINDS.join(', ')}`);
}

function parseEdgeKind(value: string): (typeof EDGE_KINDS)[number] {
  if (EDGE_KINDS.includes(value as (typeof EDGE_KINDS)[number])) {
    return value as (typeof EDGE_KINDS)[number];
  }

  throw new Error(`Expected --edge-kind to be one of ${EDGE_KINDS.join(', ')}`);
}

interface GraphExploreOptions {
  root: string;
  query?: string;
  id: string[];
  depth: number;
  limit: number;
  nodeKind: string[];
  edgeKind: string[];
}
