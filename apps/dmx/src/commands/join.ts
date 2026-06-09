import type { Command } from 'commander';
import { joinServerGroup, type JoinServerOptions } from '@mcp-dev-mesh/client';

export function registerJoinCommand(program: Command): void {
  program
    .command('join')
    .description('Join a remote DevMesh server group')
    .argument('<server>', 'server URL, IP, or host:port')
    .requiredOption('--group <groupKey>', 'server group key')
    .requiredOption('--name <displayName>', 'member display name')
    .option('--handle <handle>', 'member handle')
    .requiredOption('--token <inviteToken>', 'invite token')
    .option('--yes', 'confirm non-interactively')
    .action(async (server: string, options: JoinCommandOptions) => {
      const joinOptions: JoinServerOptions = {
        serverUrl: server,
        groupKey: options.group,
        displayName: options.name,
        inviteToken: options.token
      };

      if (options.handle !== undefined) {
        joinOptions.handle = options.handle;
      }

      const result = await joinServerGroup(joinOptions);

      console.log(JSON.stringify(result, null, 2));
    });
}

interface JoinCommandOptions {
  group: string;
  name: string;
  handle?: string;
  token: string;
  yes?: boolean;
}
