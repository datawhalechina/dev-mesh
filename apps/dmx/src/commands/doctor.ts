import type { Command } from 'commander';
import { runDevMeshDoctor, type DevMeshDoctorOptions } from '@mcp-dev-mesh/client';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run basic local diagnostics')
    .option('--root <path>', 'project root', process.cwd())
    .option('--global-root <path>', 'global Dev Mesh root')
    .option('--mcp-url <url>', 'local MCP proxy URL')
    .action(async (options: { root: string; globalRoot?: string; mcpUrl?: string }) => {
      const doctorOptions: DevMeshDoctorOptions = {
        projectRoot: options.root
      };

      if (options.globalRoot !== undefined) {
        doctorOptions.globalRoot = options.globalRoot;
      }

      if (options.mcpUrl !== undefined) {
        doctorOptions.mcpUrl = options.mcpUrl;
      }

      const result = await runDevMeshDoctor(doctorOptions);

      console.log(JSON.stringify(result, null, 2));
    });
}
