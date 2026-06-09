import type { Command } from 'commander';
import type { CaptureKnowledgeInput, KnowledgeLayer, KnowledgeType, KnowledgeVisibility } from '@devmesh/core';
import { createDevMeshClientRuntime } from '@devmesh/client';
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

  const item = options.review
    ? await runtime.enqueueKnowledgeForReview(capture, createReviewOptions(options.reason))
    : await runtime.captureKnowledge(capture);

  console.log(JSON.stringify(item, null, 2));
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
}
