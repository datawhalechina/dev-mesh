import type { Command } from 'commander';
import { joinServerGroup, type JoinServerOptions } from '@devmesh/client';
import { formatFields, printJsonOrCustomText } from './output.js';

export function registerJoinCommand(program: Command): void {
  program
    .command('join')
    .description('Join a remote DevMesh server group')
    .argument('<server>', 'server URL, IP, or host:port')
    .requiredOption('--branch <branch>', 'server group key')
    .requiredOption('--name <displayName>', 'member display name')
    .option('--handle <handle>', 'member handle')
    .requiredOption('--token <inviteToken>', 'invite token')
    .option('--yes', 'confirm non-interactively')
    .option('--json', 'print structured JSON')
    .action(async (server: string, options: JoinCommandOptions) => {
      const joinOptions: JoinServerOptions = {
        serverUrl: server,
        branch: options.branch,
        displayName: options.name,
        inviteToken: options.token
      };

      if (options.handle !== undefined) {
        joinOptions.handle = options.handle;
      }

      const result = await joinServerGroup(joinOptions);

      printJsonOrCustomText(result, options.json, formatJoinResult);
    });
}

function formatJoinResult(result: JoinServerResult): string {
  return formatFields('Joined DevMesh server', [
    ['serverUrl', result.serverUrl],
    ['mcpUrl', result.mcpUrl],
    ['branch', result.branch],
    ['memberId', result.memberId],
    ['clientId', result.clientId],
    ['globalRoot', result.globalRoot],
    ['configPath', result.configPath],
    ['identityPath', result.identityPath],
    ['expiresAt', result.expiresAt]
  ]);
}

type JoinServerResult = Awaited<ReturnType<typeof joinServerGroup>>;

interface JoinCommandOptions {
  branch: string;
  name: string;
  handle?: string;
  token: string;
  yes?: boolean;
  json?: boolean;
}
