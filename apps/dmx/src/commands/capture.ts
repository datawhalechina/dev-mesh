import type { Command } from 'commander';
import type { CaptureKnowledgeInput, KnowledgeLayer, KnowledgeType, KnowledgeVisibility } from '@devmesh/core';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { printJsonOrText } from './output.js';
import { createReviewOptions, parsePara } from './shared.js';

export function registerCaptureCommand(program: Command): void {
  program
    .command('capture')
    .description('Capture a local knowledge item')
    .requiredOption('--title <title>', 'knowledge title')
    .requiredOption('--summary <summary>', 'short summary')
    .option('--type <type>', 'knowledge type', 'note')
    .option('--content <content>', 'long-form content')
    .option('--layer <layer>', 'raw, extract, or canonical', 'extract')
    .option('--visibility <visibility>', 'private, project, team, or org', 'project')
    .option('--para <category:key>', 'PARA ref, for example areas:frontend/styles')
    .option('--tag <tag...>', 'tags')
    .option('--review', 'queue this candidate for review instead of publishing immediately')
    .option('--reason <reason>', 'review queue reason')
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .option('--json', 'print structured JSON')
    .action(runCaptureCommand);
}

async function runCaptureCommand(options: CaptureCommandOptions): Promise<void> {
  const runtime = createDevMeshClientRuntime({
    projectRoot: options.root,
    memberName: options.name
  });
  const capture: CaptureKnowledgeInput = {
    type: options.type,
    title: options.title,
    summary: options.summary,
    layer: options.layer,
    visibility: options.visibility,
    tags: options.tag ?? []
  };
  const para = parsePara(options.para);

  if (options.content !== undefined) {
    capture.content = options.content;
  }

  if (para !== undefined) {
    capture.para = para;
  }

  if (options.review === true) {
    const item = await runtime.enqueueKnowledgeForReview(capture, createReviewOptions(options.reason));

    if (options.json === true) {
      printJsonOrText('mesh_capture_knowledge', item, true);
      return;
    }

    printJsonOrText('mesh_capture_knowledge', createReviewQueueTextValue(item), false);
    return;
  }

  const item = await runtime.captureKnowledge(capture);

  printJsonOrText('mesh_capture_knowledge', item, options.json);
}

function createReviewQueueTextValue(item: ReviewQueueTextSource): Record<string, unknown> {
  return {
    id: item.id,
    title: item.input?.title,
    type: item.input?.type,
    layer: item.input?.layer,
    status: 'pending_review',
    summary: item.input?.summary,
    para: item.input?.para,
    tags: item.input?.tags
  };
}

interface CaptureCommandOptions {
  title: string;
  summary: string;
  type: KnowledgeType;
  content?: string;
  layer: KnowledgeLayer;
  visibility: KnowledgeVisibility;
  para?: string;
  tag?: string[];
  review?: boolean;
  reason?: string;
  root: string;
  name: string;
  json?: boolean;
}

interface ReviewQueueTextSource {
  id: string;
  input?: Partial<CaptureKnowledgeInput>;
}
