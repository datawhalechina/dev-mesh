import { intro, note, outro, spinner } from '@clack/prompts';
import type { Command } from 'commander';
import {
  runDevMeshDoctor,
  type DevMeshDoctorCategory,
  type DevMeshDoctorCheck,
  type DevMeshDoctorOptions,
  type DevMeshDoctorResult,
  type DevMeshDoctorStatus
} from '@mcp-dev-mesh/client';
import { shouldUseTuiOutput } from './shared.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run basic local diagnostics')
    .option('--root <path>', 'project root', process.cwd())
    .option('--global-root <path>', 'global Dev Mesh root')
    .option('--mcp-url <url>', 'local MCP proxy URL')
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { root: string; globalRoot?: string; mcpUrl?: string; json?: boolean }) => {
      const doctorOptions: DevMeshDoctorOptions = {
        projectRoot: options.root
      };

      if (options.globalRoot !== undefined) {
        doctorOptions.globalRoot = options.globalRoot;
      }

      if (options.mcpUrl !== undefined) {
        doctorOptions.mcpUrl = options.mcpUrl;
      }

      const tuiOutput = shouldUseTuiOutput({ json: options.json });
      const doctorSpinner = tuiOutput ? spinner() : undefined;

      if (tuiOutput) {
        intro('Dev Mesh doctor');
      }

      doctorSpinner?.start('Running diagnostics');
      const result = await runDevMeshDoctor(doctorOptions);
      doctorSpinner?.stop('Diagnostics complete');

      if (tuiOutput) {
        printDoctorResult(result);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    });
}

function printDoctorResult(result: DevMeshDoctorResult): void {
  note(createDoctorOverview(result), 'Summary');

  for (const category of DOCTOR_CATEGORY_ORDER) {
    const checks = result.checks.filter((check) => check.category === category);

    if (checks.length > 0) {
      note(createDoctorCategorySummary(checks), DOCTOR_CATEGORY_TITLES[category]);
    }
  }

  if (result.summary.error > 0) {
    outro('Doctor found errors. Apply the fix hints above and run dmx doctor again.');
    return;
  }

  if (result.summary.warn > 0) {
    outro('Doctor found warnings. Dev Mesh can run, but the hints above are worth fixing.');
    return;
  }

  outro('Doctor found no local issues.');
}

export function createDoctorOverview(result: DevMeshDoctorResult): string {
  return [
    `Project root: ${result.projectRoot}`,
    `Global root: ${result.globalRoot}`,
    `Checks: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.error} error`
  ].join('\n');
}

export function createDoctorCategorySummary(checks: DevMeshDoctorCheck[]): string {
  return checks.map(formatDoctorCheck).join('\n\n');
}

function formatDoctorCheck(check: DevMeshDoctorCheck): string {
  const lines = [`${formatDoctorStatus(check.status)} ${check.message}`];

  if (check.fixHint !== undefined) {
    lines.push(`Fix: ${check.fixHint}`);
  }

  return lines.join('\n');
}

function formatDoctorStatus(status: DevMeshDoctorStatus): string {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'warn':
      return 'WARN';
    case 'error':
      return 'ERROR';
  }
}

const DOCTOR_CATEGORY_ORDER: DevMeshDoctorCategory[] = ['store', 'privacy', 'sync', 'proxy', 'adapter'];

const DOCTOR_CATEGORY_TITLES: Record<DevMeshDoctorCategory, string> = {
  adapter: 'MCP hosts',
  privacy: 'Privacy',
  proxy: 'Launcher and daemon',
  store: 'Project store',
  sync: 'Sync'
};
