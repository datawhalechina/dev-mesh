import type { Command } from 'commander';
import type { ExportProjectKnowledgeResult } from '@devmesh/client';
import type {
  KnowledgeLayer,
  KnowledgeStatus,
  KnowledgeType,
  KnowledgeVisibility,
  UpdateKnowledgeInput
} from '@devmesh/core';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { formatFields, printJsonOrCustomText, printJsonOrText } from './output.js';
import { parseIntOption, parseNumberOption, parsePara } from './shared.js';

export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program.command('knowledge').description('Manage local DevMesh knowledge items');

  registerGetCommand(knowledge);
  registerListCommand(knowledge);
  registerExportCommand(knowledge);
  registerUpdateCommand(knowledge);
  registerDeleteCommand(knowledge);
}

function registerGetCommand(parent: Command): void {
  parent
    .command('get')
    .description('Get a local knowledge item by id')
    .argument('<id>', 'knowledge item id')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (id: string, options: JsonOutputOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      printJsonOrText('mesh_get_knowledge', await runtime.getKnowledge(id), options.json);
    });
}

function registerListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List local knowledge items')
    .option('--layer <layer>', 'layer filter: raw, extract, or canonical', collectOption, [])
    .option('--type <type>', 'knowledge type filter', collectOption, [])
    .option('--tag <tag>', 'tag filter', collectOption, [])
    .option('--para <category:key>', 'PARA ref prefix, for example areas:frontend')
    .option('--author <name>', 'author display name, handle, or member id filter')
    .option('--branch <name>', 'read from a specific knowledge branch without switching checkout')
    .option('--include-superseded', 'include superseded and tombstone items')
    .option('--recency-days <n>', 'only include items updated within this many days', parseIntOption)
    .option('--limit <n>', 'maximum number of items', parseIntOption, 20)
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (options: KnowledgeListOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      printJsonOrText('mesh_list_knowledge', await runtime.listKnowledge(createListInput(options)), options.json);
    });
}

function registerExportCommand(parent: Command): void {
  parent
    .command('export')
    .description('Export knowledge JSONL from the v2 CRDT document')
    .option('--path <path>', 'output JSONL path')
    .option('--no-tombstones', 'exclude tombstone items from the export')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (options: KnowledgeExportOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });
      const result = await runtime.exportKnowledge(createExportInput(options));

      printJsonOrCustomText(result, options.json, formatKnowledgeExportResult);
    });
}

function registerUpdateCommand(parent: Command): void {
  parent
    .command('update')
    .description('Update a local knowledge item')
    .argument('<id>', 'knowledge item id')
    .option('--title <title>', 'new title')
    .option('--summary <summary>', 'new summary')
    .option('--content <content>', 'new long-form content')
    .option('--clear-content', 'remove long-form content')
    .option('--type <type>', 'new knowledge type')
    .option('--layer <layer>', 'new layer: raw, extract, or canonical')
    .option('--visibility <visibility>', 'new visibility: private, project, team, or org')
    .option('--status <status>', 'new status: active, superseded, or tombstone')
    .option('--para <category:key>', 'new PARA ref')
    .option('--tag <tag>', 'replace tags with the provided tag list', collectOption, [])
    .option('--confidence <score>', 'new confidence between 0 and 1', parseNumberOption)
    .option('--weight <weight>', 'new ranking weight', parseNumberOption)
    .option('--reason <reason>', 'update reason')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--json', 'print structured JSON')
    .action(async (id: string, options: KnowledgeUpdateOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root,
        memberName: options.name
      });
      const input = createUpdateInput(id, options);

      printJsonOrText(
        'mesh_update_knowledge',
        await runtime.updateKnowledge(input, createMutationOptions(options.reason)),
        options.json
      );
    });
}

function registerDeleteCommand(parent: Command): void {
  parent
    .command('delete')
    .description('Tombstone a local knowledge item')
    .argument('<id>', 'knowledge item id')
    .option('--reason <reason>', 'delete reason')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--json', 'print structured JSON')
    .action(async (id: string, options: KnowledgeDeleteOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root,
        memberName: options.name
      });

      printJsonOrText(
        'mesh_delete_knowledge',
        await runtime.deleteKnowledge({ id }, createMutationOptions(options.reason)),
        options.json
      );
    });
}

function createListInput(options: KnowledgeListOptions): Parameters<ReturnType<typeof createDevMeshClientRuntime>['listKnowledge']>[0] {
  const input: NonNullable<Parameters<ReturnType<typeof createDevMeshClientRuntime>['listKnowledge']>[0]> = {
    limit: options.limit,
    includeSuperseded: options.includeSuperseded === true
  };
  const layers = options.layer.map(parseLayer);

  if (options.branch !== undefined) {
    input.branch = options.branch;
  }

  if (layers.length > 0) {
    input.layers = layers;
  }

  if (options.type.length > 0) {
    input.types = options.type;
  }

  if (options.tag.length > 0) {
    input.tags = options.tag;
  }

  if (options.para !== undefined) {
    const para = parsePara(options.para);

    if (para !== undefined) {
      input.para = para;
    }
  }

  if (options.author !== undefined) {
    input.authorName = options.author;
  }

  if (options.recencyDays !== undefined) {
    input.recencyDays = options.recencyDays;
  }

  return input;
}

function createExportInput(options: KnowledgeExportOptions): Parameters<ReturnType<typeof createDevMeshClientRuntime>['exportKnowledge']>[0] {
  const input: NonNullable<Parameters<ReturnType<typeof createDevMeshClientRuntime>['exportKnowledge']>[0]> = {};

  if (options.path !== undefined) {
    input.path = options.path;
  }

  if (options.tombstones === false) {
    input.includeTombstones = false;
  }

  return input;
}

function createUpdateInput(id: string, options: KnowledgeUpdateOptions): UpdateKnowledgeInput {
  const input: UpdateKnowledgeInput = {
    id
  };

  if (options.title !== undefined) {
    input.title = options.title;
  }

  if (options.summary !== undefined) {
    input.summary = options.summary;
  }

  if (options.content !== undefined && options.clearContent) {
    throw new Error('Use either --content or --clear-content, not both.');
  }

  if (options.content !== undefined) {
    input.content = options.content;
  }

  if (options.clearContent) {
    input.content = null;
  }

  if (options.type !== undefined) {
    input.type = options.type;
  }

  if (options.layer !== undefined) {
    input.layer = parseLayer(options.layer);
  }

  if (options.visibility !== undefined) {
    input.visibility = parseVisibility(options.visibility);
  }

  if (options.status !== undefined) {
    input.status = parseStatus(options.status);
  }

  if (options.para !== undefined) {
    const para = parsePara(options.para);

    if (para !== undefined) {
      input.para = para;
    }
  }

  if (options.tag.length > 0) {
    input.tags = options.tag;
  }

  if (options.confidence !== undefined) {
    input.confidence = options.confidence;
  }

  if (options.weight !== undefined) {
    input.weight = options.weight;
  }

  if (!hasUpdatePatch(input)) {
    throw new Error('Provide at least one knowledge field to update.');
  }

  return input;
}

function formatKnowledgeExportResult(result: ExportProjectKnowledgeResult): string {
  return formatFields('DevMesh knowledge exported', [
    ['knowledge', result.exportedKnowledge],
    ['skippedTombstones', result.skippedTombstones],
    ['heads', result.heads.length],
    ['path', result.path],
    ['crdtPath', result.crdtPath]
  ]);
}

function createMutationOptions(reason?: string): { reason?: string } {
  if (reason === undefined) {
    return {};
  }

  return {
    reason
  };
}

function parseLayer(value: string): KnowledgeLayer {
  if (value === 'raw' || value === 'extract' || value === 'canonical') {
    return value;
  }

  throw new Error(`Expected layer to be raw, extract, or canonical. Received ${value}.`);
}

function parseVisibility(value: string): KnowledgeVisibility {
  if (value === 'private' || value === 'project' || value === 'team' || value === 'org') {
    return value;
  }

  throw new Error(`Expected visibility to be private, project, team, or org. Received ${value}.`);
}

function parseStatus(value: string): KnowledgeStatus {
  if (value === 'active' || value === 'superseded' || value === 'tombstone') {
    return value;
  }

  throw new Error(`Expected status to be active, superseded, or tombstone. Received ${value}.`);
}

function hasUpdatePatch(input: UpdateKnowledgeInput): boolean {
  return Object.entries(input).some(([key, value]) => key !== 'id' && value !== undefined);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface RootOptions {
  root: string;
}

interface JsonOutputOptions extends RootOptions {
  json?: boolean;
}

interface KnowledgeListOptions extends JsonOutputOptions {
  layer: string[];
  type: KnowledgeType[];
  tag: string[];
  para?: string;
  author?: string;
  branch?: string;
  includeSuperseded?: boolean;
  recencyDays?: number;
  limit: number;
}

interface KnowledgeExportOptions extends JsonOutputOptions {
  path?: string;
  tombstones?: boolean;
}

interface KnowledgeUpdateOptions extends JsonOutputOptions {
  title?: string;
  summary?: string;
  content?: string;
  clearContent?: boolean;
  type?: KnowledgeType;
  layer?: string;
  visibility?: string;
  status?: string;
  para?: string;
  tag: string[];
  confidence?: number;
  weight?: number;
  reason?: string;
  name: string;
}

interface KnowledgeDeleteOptions extends JsonOutputOptions {
  reason?: string;
  name: string;
}
