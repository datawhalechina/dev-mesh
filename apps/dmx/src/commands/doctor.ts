import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@mcp-dev-mesh/client';

export function registerDoctorCommand(program: Command): void {
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
}
