#!/usr/bin/env node
import { Command } from 'commander';
import { createDevMeshClientRuntime, initGlobalConfig } from '@mcp-dev-mesh/client';
import type {
  CaptureKnowledgeInput,
  KnowledgeLayer,
  KnowledgeType,
  KnowledgeVisibility,
  ParaCategory
} from '@mcp-dev-mesh/core';

const program = new Command();

program.name('dmx').description('MCP Dev Mesh local-first CLI').version('0.1.0');

program
  .command('init')
  .description('Initialize global or project Dev Mesh state')
  .option('--global', 'initialize ~/.dev-mesh instead of the current project')
  .option('--root <path>', 'project root', process.cwd())
  .option('--name <displayName>', 'member display name', 'local')
  .action(async (options: { global?: boolean; root: string; name: string }) => {
    if (options.global) {
      const result = await initGlobalConfig(options.name);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const runtime = createDevMeshClientRuntime({
      projectRoot: options.root,
      memberName: options.name
    });
    const store = await runtime.ensureProjectStore();
    console.log(JSON.stringify(store, null, 2));
  });

program
  .command('status')
  .description('Print local Dev Mesh status')
  .option('--root <path>', 'project root', process.cwd())
  .option('--name <displayName>', 'member display name', 'local')
  .action(async (options: { root: string; name: string }) => {
    const runtime = createDevMeshClientRuntime({
      projectRoot: options.root,
      memberName: options.name
    });
    console.log(JSON.stringify(await runtime.status(), null, 2));
  });

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
  .option('--root <path>', 'project root', process.cwd())
  .option('--name <displayName>', 'member display name', 'local')
  .action(
    async (options: {
      title: string;
      summary: string;
      type: KnowledgeType;
      content?: string;
      layer: KnowledgeLayer;
      visibility: KnowledgeVisibility;
      para?: string;
      tag?: string[];
      root: string;
      name: string;
    }) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root,
        memberName: options.name
      });
      const para = parsePara(options.para);
      const capture: CaptureKnowledgeInput = {
        type: options.type,
        title: options.title,
        summary: options.summary,
        layer: options.layer,
        visibility: options.visibility,
        tags: options.tag ?? []
      };

      if (options.content !== undefined) {
        capture.content = options.content;
      }

      if (para !== undefined) {
        capture.para = para;
      }

      const item = await runtime.captureKnowledge(capture);

      console.log(JSON.stringify(item, null, 2));
    }
  );

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

program
  .command('doctor')
  .description('Run basic local diagnostics')
  .option('--root <path>', 'project root', process.cwd())
  .action(async (options: { root: string }) => {
    const runtime = createDevMeshClientRuntime({
      projectRoot: options.root
    });
    const status = await runtime.status();
    console.log(
      JSON.stringify(
        {
          checks: [
            {
              id: 'project-store',
              status: 'ok',
              message: `Project store is available at ${status.storeRoot}`
            },
            {
              id: 'mode',
              status: 'ok',
              message: 'Running in local-only mode'
            }
          ]
        },
        null,
        2
      )
    );
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function parseIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer, received ${value}`);
  }

  return parsed;
}

function parsePara(value?: string): { category: ParaCategory; key: string } | undefined {
  if (!value) {
    return undefined;
  }

  const [category, ...keyParts] = value.split(':');
  const key = keyParts.join(':');

  if (!isParaCategory(category) || !key) {
    throw new Error('Expected --para in the form category:key');
  }

  return {
    category,
    key
  };
}

function isParaCategory(value: string | undefined): value is ParaCategory {
  return value === 'projects' || value === 'areas' || value === 'resources' || value === 'archives';
}
