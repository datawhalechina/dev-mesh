import type { Command } from 'commander';
import type { RateKnowledgeInput } from '@devmesh/core';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { printJsonOrText } from './output.js';
import { createRateOptions, parseNumberOption } from './shared.js';

export function registerRateCommand(program: Command): void {
  program
    .command('rate')
    .description('Rate a local knowledge item')
    .argument('<id>', 'knowledge item id')
    .option('--rating <score>', 'explicit rating between 0 and 1', parseNumberOption)
    .option('--adoption-delta <delta>', 'adoption score delta between -1 and 1', parseNumberOption)
    .option('--confidence-delta <delta>', 'confidence delta between -1 and 1', parseNumberOption)
    .option('--weight-delta <delta>', 'weight delta', parseNumberOption)
    .option('--reason <reason>', 'feedback reason')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--json', 'print structured JSON')
    .action(runRateCommand);
}

async function runRateCommand(id: string, options: RateCommandOptions): Promise<void> {
  const runtime = createDevMeshClientRuntime({
    projectRoot: options.root,
    memberName: options.name
  });
  const input: RateKnowledgeInput = { id };

  if (options.rating !== undefined) {
    input.rating = options.rating;
  }

  if (options.adoptionDelta !== undefined) {
    input.adoptionDelta = options.adoptionDelta;
  }

  if (options.confidenceDelta !== undefined) {
    input.confidenceDelta = options.confidenceDelta;
  }

  if (options.weightDelta !== undefined) {
    input.weightDelta = options.weightDelta;
  }

  printJsonOrText('mesh_rate_knowledge', await runtime.rateKnowledge(input, createRateOptions(options.reason)), options.json);
}

interface RateCommandOptions {
  rating?: number;
  adoptionDelta?: number;
  confidenceDelta?: number;
  weightDelta?: number;
  reason?: string;
  root: string;
  name: string;
  json?: boolean;
}
