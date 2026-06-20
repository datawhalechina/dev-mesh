import type { Command } from 'commander';
import { createDevMeshClientRuntime, type KnowledgeBranchListResult } from '@devmesh/client';
import type { KnowledgeBranchPolicyPreset } from '@devmesh/local-store';
import { formatCountedList, formatFields, formatInlineFields, printJsonOrCustomText } from './output.js';

export function registerBranchCommand(program: Command): void {
  const branch = program.command('branch').description('Manage Git-like DevMesh knowledge branches');

  branch
    .command('list', { isDefault: true })
    .description('List knowledge branches for the current project')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (options: BranchJsonOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      printJsonOrCustomText(await runtime.listBranches(), options.json, formatBranchList);
    });

  branch
    .command('switch')
    .alias('checkout')
    .description('Switch the active knowledge branch')
    .argument('<name>', 'knowledge branch name')
    .option('--base <name>', 'optional base branch to read with the active branch')
    .option('--policy <preset>', 'policy preset for newly created branches', parsePolicyPreset)
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (name: string, options: BranchSwitchOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      printJsonOrCustomText(
        await runtime.switchBranch({
          name,
          ...(options.policy === undefined ? {} : { policy: options.policy }),
          ...(options.base === undefined ? {} : { base: options.base })
        }),
        options.json,
        formatBranchList
      );
    });

  branch
    .command('create')
    .description('Create a knowledge branch')
    .argument('<name>', 'knowledge branch name')
    .option('--base <name>', 'optional base branch to read with this project')
    .option('--policy <preset>', 'policy preset', parsePolicyPreset, 'balanced')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (name: string, options: BranchCreateOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      printJsonOrCustomText(
        await runtime.createBranch({
          name,
          policy: options.policy,
          ...(options.base === undefined ? {} : { base: options.base })
        }),
        options.json,
        formatBranchList
      );
    });

  branch
    .command('policy')
    .description('Set a knowledge branch capture policy')
    .argument('<preset>', 'policy preset')
    .option('--branch <name>', 'branch name; defaults to the active branch')
    .option('--root <path>', 'project root', process.cwd())
    .option('--json', 'print structured JSON')
    .action(async (preset: string, options: BranchPolicyOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      printJsonOrCustomText(
        await runtime.setBranchPolicy({
          policy: parsePolicyPreset(preset),
          ...(options.branch === undefined ? {} : { name: options.branch })
        }),
        options.json,
        formatBranchList
      );
    });
}

function formatBranchList(result: KnowledgeBranchListResult): string {
  return [
    formatFields('Knowledge branches', [
      ['active', result.active],
      ['base', result.base]
    ]),
    formatCountedList(
      'Branches',
      result.branches,
      (branch) =>
        `${branch.active ? '*' : ' '} ${branch.name} ${formatInlineFields([
          ['policy', branch.policy],
          ['base', branch.base]
        ])}`,
      'No knowledge branches configured.'
    )
  ].join('\n');
}

function parsePolicyPreset(value: string): KnowledgeBranchPolicyPreset {
  if (
    value === 'balanced' ||
    value === 'durable_only' ||
    value === 'frontend_design' ||
    value === 'backend_design'
  ) {
    return value;
  }

  throw new Error(
    `Unknown branch policy "${value}". Expected balanced, durable_only, frontend_design, or backend_design.`
  );
}

interface BranchJsonOptions {
  root: string;
  json?: boolean;
}

interface BranchSwitchOptions extends BranchJsonOptions {
  base?: string;
  policy?: KnowledgeBranchPolicyPreset;
}

interface BranchCreateOptions extends BranchJsonOptions {
  base?: string;
  policy: KnowledgeBranchPolicyPreset;
}

interface BranchPolicyOptions extends BranchJsonOptions {
  branch?: string;
}
