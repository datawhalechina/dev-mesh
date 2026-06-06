import type { Command } from 'commander';
import {
  DEFAULT_LOCAL_PROXY_HOST,
  DEFAULT_LOCAL_PROXY_PORT,
  createLocalMcpProxy,
  type LocalMcpProxy
} from '@mcp-dev-mesh/client';
import { parseIntOption } from './shared.js';

export function registerProxyCommand(program: Command): void {
  program
    .command('proxy')
    .description('Start the local Streamable HTTP MCP proxy')
    .option('--host <host>', 'listen host', DEFAULT_LOCAL_PROXY_HOST)
    .option('--port <number>', 'listen port', parseIntOption, DEFAULT_LOCAL_PROXY_PORT)
    .option('--root <path>', 'project root', process.cwd())
    .option('--name <displayName>', 'member display name', 'local')
    .action(async (options: ProxyCommandOptions) => {
      const proxy = await createLocalMcpProxy({
        projectRoot: options.root,
        memberName: options.name
      });
      const url = await proxy.listen({
        host: options.host,
        port: options.port
      });

      console.log(
        JSON.stringify({
          status: 'listening',
          url,
          mcpUrl: `${url}/mcp`,
          projectRoot: proxy.projectRoot
        })
      );

      await waitForShutdown(proxy);
    });
}

function waitForShutdown(proxy: LocalMcpProxy): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const shutdown = () => {
      if (settled) {
        return;
      }

      settled = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      proxy.close().then(resolve, reject);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

interface ProxyCommandOptions {
  host: string;
  port: number;
  root: string;
  name: string;
}
