#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { createDevMeshCore } from '@mcp-dev-mesh/core';
import { JsonlKnowledgeRepository } from '@mcp-dev-mesh/local-store';
import { createHubServer, listenMeshServer, type MeshServerOptions } from '@mcp-dev-mesh/server';
import {
  createPostgresHubStateStore,
  migratePostgresHubStateStore,
  migratePostgresKnowledgeRepository,
  PostgresKnowledgeRepository,
  type PostgresExecutor
} from '@mcp-dev-mesh/storage';
import { Pool } from 'pg';

const program = new Command();

program
  .name('dmx-server')
  .description('MCP Dev Mesh hub server')
  .version('0.1.0')
  .option('--env-file <path>', 'dotenv-style environment file')
  .option('--host <host>', 'listen host')
  .option('--port <port>', 'listen port', parseIntOption)
  .option('--base-url <url>', 'public base URL advertised by discovery')
  .option('--project-root <path>', 'local project root for development storage')
  .option('--hub-state-path <path>', 'JSON file path for Hub state persistence')
  .option('--postgres-url <url>', 'PostgreSQL connection URL for durable storage')
  .option('--postgres-knowledge-table <name>', 'PostgreSQL knowledge table name')
  .option('--postgres-hub-state-table <name>', 'PostgreSQL Hub state table name')
  .option('--logger', 'enable server error logging')
  .action(async (options: MeshServerCliOptions) => {
    await loadEnvFile(options.envFile);
    const config = resolveServerConfig(options);
    const postgres = config.postgresUrl === undefined ? undefined : await createPostgresRuntime(config);
    const core = createDevMeshCore({
      projectRoot: config.projectRoot,
      repository: postgres?.knowledgeRepository ?? new JsonlKnowledgeRepository(config.projectRoot)
    });
    const serverOptions: MeshServerOptions = {
      core,
      baseUrl: config.baseUrl,
      logger: config.logger
    };

    if (postgres?.hubStateStore !== undefined) {
      serverOptions.hubStateStore = postgres.hubStateStore;
    } else if (config.hubStatePath !== undefined) {
      serverOptions.hubStatePath = config.hubStatePath;
    }

    const app = await createHubServer(serverOptions);
    const url = await listenMeshServer(app, {
      host: config.host,
      port: config.port
    });

    console.log(`MCP Dev Mesh server listening on ${url}`);
    installShutdownHandlers(async () => {
      await app.close();
      await postgres?.pool.end();
    });
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

async function loadEnvFile(path: string | undefined): Promise<void> {
  if (path === undefined) {
    return;
  }

  const raw = await readFile(path, 'utf8');

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const assignment = normalizeEnvLine(line);

    if (assignment === undefined) {
      continue;
    }

    const separator = assignment.indexOf('=');

    if (separator <= 0) {
      throw new Error(`Invalid env assignment at ${path}:${index + 1}`);
    }

    const key = assignment.slice(0, separator).trim();
    const value = normalizeEnvValue(assignment.slice(separator + 1).trim());

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env key ${key} at ${path}:${index + 1}`);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeEnvLine(line: string): string | undefined {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }

  return trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
}

function normalizeEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function resolveServerConfig(options: MeshServerCliOptions): MeshServerConfig {
  const host = options.host ?? process.env.DEV_MESH_HOST ?? '127.0.0.1';
  const port = options.port ?? readEnvPort('DEV_MESH_PORT') ?? 8721;
  const projectRoot = options.projectRoot ?? process.env.DEV_MESH_PROJECT_ROOT ?? process.cwd();
  const baseUrl = options.baseUrl ?? process.env.DEV_MESH_BASE_URL ?? `http://${host}:${port}`;
  const config: MeshServerConfig = {
    host,
    port,
    baseUrl: baseUrl.replace(/\/$/, ''),
    projectRoot,
    logger: options.logger ?? readEnvBoolean('DEV_MESH_LOGGER') ?? false
  };
  const hubStatePath = options.hubStatePath ?? process.env.DEV_MESH_HUB_STATE_PATH;
  const postgresUrl = options.postgresUrl ?? process.env.DEV_MESH_POSTGRES_URL;
  const postgresKnowledgeTable = options.postgresKnowledgeTable ?? process.env.DEV_MESH_POSTGRES_KNOWLEDGE_TABLE;
  const postgresHubStateTable = options.postgresHubStateTable ?? process.env.DEV_MESH_POSTGRES_HUB_STATE_TABLE;

  if (hubStatePath !== undefined) {
    config.hubStatePath = hubStatePath;
  }

  if (postgresUrl !== undefined) {
    config.postgresUrl = postgresUrl;
  }

  if (postgresKnowledgeTable !== undefined) {
    config.postgresKnowledgeTable = postgresKnowledgeTable;
  }

  if (postgresHubStateTable !== undefined) {
    config.postgresHubStateTable = postgresHubStateTable;
  }

  return config;
}

function readEnvPort(key: string): number | undefined {
  const value = process.env[key];

  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return parseIntOption(value);
}

function readEnvBoolean(key: string): boolean | undefined {
  const value = process.env[key]?.trim().toLowerCase();

  if (value === undefined || value === '') {
    return undefined;
  }

  if (value === '1' || value === 'true' || value === 'yes') {
    return true;
  }

  if (value === '0' || value === 'false' || value === 'no') {
    return false;
  }

  throw new Error(`Expected ${key} to be a boolean-like value.`);
}

async function createPostgresRuntime(config: MeshServerConfig): Promise<PostgresRuntime> {
  if (config.postgresUrl === undefined) {
    throw new Error('DEV_MESH_POSTGRES_URL or --postgres-url is required for PostgreSQL storage.');
  }

  const pool = new Pool({
    connectionString: config.postgresUrl
  });
  const db = createPoolExecutor(pool);
  const knowledgeOptions = createTableOptions(config.postgresKnowledgeTable);
  const hubStateOptions = createTableOptions(config.postgresHubStateTable);

  await migratePostgresKnowledgeRepository(db, knowledgeOptions);

  const knowledgeRepository = new PostgresKnowledgeRepository(db, knowledgeOptions);
  const runtime: PostgresRuntime = {
    pool,
    knowledgeRepository
  };

  if (config.hubStatePath === undefined) {
    await migratePostgresHubStateStore(db, hubStateOptions);
    runtime.hubStateStore = createPostgresHubStateStore(db, hubStateOptions);
  }

  return runtime;
}

function createTableOptions(tableName: string | undefined): { tableName?: string } {
  return tableName === undefined ? {} : { tableName };
}

function createPoolExecutor(pool: Pool): PostgresExecutor {
  return {
    async query(sql, values) {
      const result = await pool.query(sql, values ? [...values] : undefined);

      return {
        rows: result.rows
      };
    }
  };
}

function installShutdownHandlers(close: () => Promise<void>): void {
  let closing = false;

  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }

    closing = true;
    try {
      await close();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

interface MeshServerCliOptions {
  envFile?: string;
  host?: string;
  port?: number;
  baseUrl?: string;
  projectRoot?: string;
  hubStatePath?: string;
  postgresUrl?: string;
  postgresKnowledgeTable?: string;
  postgresHubStateTable?: string;
  logger?: boolean;
}

interface MeshServerConfig {
  host: string;
  port: number;
  baseUrl: string;
  projectRoot: string;
  hubStatePath?: string;
  postgresUrl?: string;
  postgresKnowledgeTable?: string;
  postgresHubStateTable?: string;
  logger: boolean;
}

interface PostgresRuntime {
  pool: Pool;
  knowledgeRepository: PostgresKnowledgeRepository;
  hubStateStore?: ReturnType<typeof createPostgresHubStateStore>;
}
