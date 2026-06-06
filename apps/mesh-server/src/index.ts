#!/usr/bin/env node
import { Command } from 'commander';
import { createDevMeshCore } from '@mcp-dev-mesh/core';
import { JsonlKnowledgeRepository } from '@mcp-dev-mesh/local-store';
import { createHubServer, listenMeshServer } from '@mcp-dev-mesh/server';

const program = new Command();

program
  .name('dmx-server')
  .description('MCP Dev Mesh hub server')
  .version('0.1.0')
  .option('--host <host>', 'listen host', '127.0.0.1')
  .option('--port <port>', 'listen port', parseIntOption, 8721)
  .option('--project-root <path>', 'local project root for development storage', process.cwd())
  .action(async (options: { host: string; port: number; projectRoot: string }) => {
    const core = createDevMeshCore({
      projectRoot: options.projectRoot,
      repository: new JsonlKnowledgeRepository(options.projectRoot)
    });
    const baseUrl = `http://${options.host}:${options.port}`;
    const app = await createHubServer({
      core,
      baseUrl
    });
    const url = await listenMeshServer(app, {
      host: options.host,
      port: options.port
    });

    console.log(`MCP Dev Mesh server listening on ${url}`);
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
